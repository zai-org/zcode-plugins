"""POLARIS permanent-memory MCP server — commercial-grade single-file edition.

Two transports over the same memory core:
    stdio:  python polaris_mcp_server.py --storage memory.pt
    http:   python polaris_mcp_server.py --storage memory.pt --http 8931
            (streamable HTTP: POST http://127.0.0.1:8931/mcp)

Zero package dependencies beyond torch/numpy: no PYTHONPATH, no cwd
requirement — robust under strict desktop-client spawn environments.

Hardening over the research edition (polaris_mcp_standalone.py):
    · cross-process file lock (msvcrt/fcntl) + read-modify-write on every
      mutating call — two processes can share one storage file safely
    · atomic persistence (tmp + os.replace), no torn writes
    · per-tool argument validation with JSON-RPC -32602 errors
    · full JSON-RPC conformance: -32700 parse / -32600 invalid / -32601
      method errors, id echo (string|number), silent notifications
    · polaris_health operational tool (slots, vectorizer, uptime, pid)
    · remote OpenAI-compatible embedding backend (DeepSeek/Qwen/GLM
      providers via --embedding-base-url, env-overridable)
    · stdio framing is newline-delimited JSON per the MCP spec
      (Content-Length framing on input is auto-detected)

Recall quality (v2.1): recall is TWO-STAGE — a value-space (256-dim)
semantic cosine pre-filter, then a same-polarity + uniform hybrid
composition inside the shortlist (anti-echo-chamber read); the most
relevant hit always leads and gates are cosine-derived. The 16-dim
polarity space alone is too noisy to rank with (measured 4/13 correct vs
13/13 for the value space). Novelty is measured in the value space and
null-calibrated to the store size, so genuinely new text scores ~1.0
regardless of how many slots are stored. HTTP mode accepts an optional
--token (Bearer), rejects non-JSON content types with 415, and emits no
CORS headers (cross-origin browser access is blocked by preflight).

Protocol: MCP JSON-RPC. The initialize response MIRRORS the client's
requested protocolVersion. Every received message and every error is
logged to <storage>.log (timestamped) so connection problems are
diagnosable from the log alone.
"""
from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import re
import sys
import threading
import time
import traceback
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
import torch

VERSION = "2.2.0"

# ---------------------------------------------------------------------------
# cross-process file lock (Windows: msvcrt; POSIX: fcntl)
# ---------------------------------------------------------------------------
if os.name == "nt":
    import msvcrt

    class FileLock:
        def __init__(self, path):
            self.path = path
            self._f = None

        def __enter__(self):
            self._f = open(self.path, "a+b")
            self._f.seek(0, 2)
            if self._f.tell() == 0:            # locked region must exist
                self._f.write(b"\0")
                self._f.flush()
            self._f.seek(0)
            msvcrt.locking(self._f.fileno(), msvcrt.LK_LOCK, 1)
            return self

        def __exit__(self, *exc):
            try:
                self._f.seek(0)
                msvcrt.locking(self._f.fileno(), msvcrt.LK_UNLCK, 1)
            finally:
                self._f.close()
                self._f = None
else:
    import fcntl

    class FileLock:
        def __init__(self, path):
            self.path = path
            self._f = None

        def __enter__(self):
            self._f = open(self.path, "a+")
            fcntl.flock(self._f.fileno(), fcntl.LOCK_EX)
            return self

        def __exit__(self, *exc):
            try:
                fcntl.flock(self._f.fileno(), fcntl.LOCK_UN)
            finally:
                self._f.close()
                self._f = None


def atomic_save(path: str, payload_fn) -> None:
    """payload_fn(f) writes the file content; then replace atomically."""
    tmp = path + f".tmp{os.getpid()}"
    with open(tmp, "w", encoding="utf-8") as f:
        payload_fn(f)
    os.replace(tmp, path)


# ---------------------------------------------------------------------------
# vectorizer: model-free, bounded polarity states (P6: |pi| <= 1)
# ---------------------------------------------------------------------------
_TOKEN = re.compile(r"[\u4e00-\u9fff]|[a-zA-Z0-9]+")


def _h(token: str, salt: int) -> int:
    d = hashlib.blake2b(token.encode("utf-8"), digest_size=8,
                        salt=str(salt).encode()).digest()
    return int.from_bytes(d, "little")


def _basis(d: int, seed: int) -> np.ndarray:
    g = np.random.default_rng(seed)
    b = g.normal(0, 1.0, (d, d)).astype(np.float32)
    return b / np.linalg.norm(b, axis=1, keepdims=True)


class Vectorizer:
    def __init__(self, dim: int = 256, m: int = 16, saturation: float = 1.5):
        self.dim, self.m, self.saturation = dim, m, saturation
        self._b = _basis(dim, 0)
        self._bm = _basis(m, 1000)
        self.name = "hash"

    def _proj(self, text, d, basis, salt):
        v = np.zeros(d, np.float32)
        for tok in _TOKEN.findall(text.lower()):
            i = _h(tok, salt) % d
            v[i] += 1.0 if _h(tok, salt + 1) % 2 else -1.0
        y = v @ basis.T
        n = float(np.linalg.norm(y))
        return y if n < 1e-9 else y / n

    def vector(self, text):
        return self._proj(text, self.dim, self._b, 1)

    def polarity(self, text):
        y = self._proj(text, self.m, self._bm, 2)
        return torch.tanh(torch.tensor(
            self.saturation * y * np.sqrt(self.m), dtype=torch.float32))


# ---------------------------------------------------------------------------
# permanent memory (E4 episodic store + Omega3 consolidation)
# ---------------------------------------------------------------------------
class Memory:
    def __init__(self, dim, m, capacity, k_polar, k_uniform, beta):
        self.dim, self.m, self.capacity = dim, m, capacity
        self.k_polar, self.k_uniform, self.beta = k_polar, k_uniform, beta
        self.values = np.zeros((0, dim), np.float32)
        self.pis = np.zeros((0, m), np.float32)
        self.texts: list[str] = []

    def write(self, vals, pis, texts):
        self.values = np.concatenate([self.values, vals])
        self.pis = np.concatenate([self.pis, pis])
        self.texts.extend(texts)
        if len(self.texts) > self.capacity:            # FIFO
            drop = len(self.texts) - self.capacity
            self.values, self.pis = self.values[drop:], self.pis[drop:]
            self.texts = self.texts[drop:]
        return min(len(texts), self.capacity)

    def recall(self, qval, pi, k_polar=None, k_uniform=None, rng=None):
        kp = self.k_polar if k_polar is None else k_polar
        ku = self.k_uniform if k_uniform is None else k_uniform
        r = len(self.texts)
        if r == 0:
            return [], [], []
        # stage 1: value-space cosine pre-filter (full semantic dims)
        sim = self.values @ qval
        n_cand = min(max(int(4 * (kp + ku)), 16), r)
        cand = np.argsort(-sim)[:n_cand]
        # stage 2: hybrid composition inside the shortlist — same-polarity
        # picks (polarity affinity) + uniform picks (anti-echo-chamber).
        # The value-space top hit is always included, and the final order
        # is by semantic relevance (value cosine).
        chi = (pi.numpy() @ self.pis[cand].T) / self.m
        q = np.atleast_2d(chi)[0]
        n_p = min(kp, n_cand)
        pol_loc = np.argsort(-q)[:n_p].tolist()
        rest_loc = [i for i in range(n_cand) if i not in pol_loc]
        uni_loc = (np.random.default_rng() if rng is None else rng) \
            .choice(rest_loc, size=min(ku, len(rest_loc)),
                    replace=False).tolist()
        sel = sorted(set(pol_loc + uni_loc + [0]),
                     key=lambda i: -sim[cand[i]])
        sel = cand[sel].tolist()                   # original slot indices
        c = sim[sel]
        g = np.exp(self.beta * c - self.beta * c.max())
        g = g / g.sum()
        return [self.texts[i] for i in sel], g.tolist(), sel

    def novelty(self, qval):
        r = len(self.values)
        if r == 0:
            return 1.0
        sim = self.values @ qval
        # expected max cosine of r unrelated unit vectors in dim space
        null_max = (1.0 / np.sqrt(max(self.dim, 1))) \
            * np.sqrt(2.0 * np.log(max(r, 2)))
        denom = max(1.0 - null_max, 1e-3)
        return float(np.clip((1.0 - float(sim.max())) / denom, 0.0, 1.0))

    def forget(self, indices):
        keep = np.ones(len(self.texts), bool)
        for i in indices:
            if 0 <= i < len(self.texts):
                keep[i] = False
        n = int((~keep).sum())
        self.values, self.pis = self.values[keep], self.pis[keep]
        self.texts = [t for j, t in enumerate(self.texts) if keep[j]]
        return n

    def stats(self):
        return {"slots": len(self.texts), "capacity": self.capacity,
                "signature_dim": self.m, "k_polar": self.k_polar,
                "k_uniform": self.k_uniform, "beta": self.beta}

    def save(self, path):
        torch.save({"values": self.values, "pis": self.pis}, path)
        with open(path + ".texts", "w", encoding="utf-8") as f:
            for t in self.texts:
                f.write(t.replace("\n", " ") + "\n")

    def save_atomic(self, path):
        """Torn-write-free persistence: tmp files, then os.replace."""
        tmp_pt = path + f".tmp{os.getpid()}"
        tmp_tx = path + f".texts.tmp{os.getpid()}"
        torch.save({"values": self.values, "pis": self.pis,
                    "vec_type": getattr(self, "vec_type", "hash")}, tmp_pt)
        with open(tmp_tx, "w", encoding="utf-8") as f:
            for t in self.texts:
                f.write(t.replace("\n", " ") + "\n")
        os.replace(tmp_tx, path + ".texts")
        os.replace(tmp_pt, path)

    def load(self, path):
        """Returns True when the tensor payload loaded; False when it is
        missing or corrupt. Texts are loaded in both cases, and a corrupt
        payload is quarantined aside so the caller can rebuild content."""
        self.texts = []
        tp = path + ".texts"
        if os.path.exists(tp):
            with open(tp, encoding="utf-8") as f:
                self.texts = [l.rstrip("\n") for l in f]
        if not os.path.exists(path):
            return False
        try:
            s = torch.load(path, map_location="cpu", weights_only=False)
        except Exception as exc:                     # noqa: BLE001
            try:
                os.replace(path, path + f".corrupt{int(time.time())}")
            except OSError:
                pass
            log(f"WARNING: storage {path} corrupt ({exc}); quarantined, "
                f"{len(self.texts)} texts preserved for rebuild")
            return False
        self.values = np.asarray(s["values"], np.float32)
        self.pis = np.asarray(s["pis"], np.float32)
        self.vec_type = s.get("vec_type", "hash")
        self.texts = self.texts[: len(self.values)]
        return True


def curvature_anchors(traj: np.ndarray, k: int, w: int | None = None):
    """Omega3: curvature anchors with greedy NMS (zero-forgetting skeleton)."""
    t = len(traj)
    if w is None:
        w = max(2, min(1000, t // 6))
    kappa = np.zeros(t)
    if t > 2 * w:
        kappa[w: t - w] = np.linalg.norm(
            traj[2 * w:] - 2 * traj[w: t - w] + traj[: t - 2 * w], axis=1)
    d_min = int(np.clip(t / (2 * max(k, 1)), 2, max(2, 2 * w)))
    chosen = []
    for idx in np.argsort(-kappa):
        if len(chosen) >= k:
            break
        if all(abs(int(idx) - c) >= d_min for c in chosen):
            chosen.append(int(idx))
    return sorted(chosen)


# ---------------------------------------------------------------------------
# semantic vectorizer (local BGE-small-zh) — semantic embeddings projected
# into the SAME bounded value/polarity spaces; hash fallback on failure.
# Embeddings are WHITENED first (BGE whitening: center + standardize by a
# fixed decoy corpus) — without it the embeddings' common component
# dominates the random projection and the polarity geometry collapses to
# noise (benchmark E1/E2 documented the failure mode).
# ---------------------------------------------------------------------------
_DECOYS = [
    "今天天气晴朗适合出门散步", "会议纪要需要在周五前提交",
    "这份报告的数据需要再核对一遍", "中午食堂的饭菜味道不错",
    "请把文件放在桌子的左边", "明天上午十点有客户来访",
    "这个季度的销售额有所增长", "洗手间在走廊的尽头",
    "记得下班前关闭办公室的电源", "地铁早高峰的人流量很大",
    "这份合同还有几个条款需要修改", "项目进度比计划提前了一周",
    "打印机没纸了需要更换墨盒", "阳台上的花需要每天浇水",
    "下午的培训课程改到了三点", "快递已经放在前台了",
    "食堂的菜单每周更新一次", "电梯在维修中请走楼梯",
    "这个月的考勤记录已经生成", "会议室预订系统出现了故障",
    "新员工的工牌已经制作完成", "图书馆的开放时间是早上八点",
    "停车场的车位有些紧张", "空调的温度设置得太低了",
    "文档的版本号需要更新", "假期值班表已经排好了",
    "服务器的例行维护在周日", "咖啡机需要定期清洗",
    "办公用品的采购申请已提交", "消防演习定在下周三",
    "请假流程需要在系统里申请", "电话会议的音质不太好",
    "这个需求已经排入下个迭代", "海报的设计稿已经定稿",
    "茶水间的水箱需要加水", "访客需要在前台登记",
    "预算报表的格式已经统一", "部门的团建活动推迟了",
    "扫描仪的驱动程序需要更新", "早会的时间改到了九点半",
    "这批货物的物流信息已更新", "会议室的投影仪灯泡老化",
    "新版本的功能测试已通过", "发票需要贴在报销单上",
    "门禁卡遗失需要重新补办", "招聘面试安排在周四下午",
    "办公楼的网络出现波动", "绿植养护公司每周来一次",
    "绩效考核表需要按时提交", "仓库的盘点结果已归档",
]


def _whiten_stats(embed_fn, cache_path):
    """(mu, sigma) of the decoy corpus, cached to disk (deterministic for a
    given model — recomputation yields identical numbers)."""
    if cache_path and os.path.exists(cache_path):
        d = np.load(cache_path)
        return d["mu"], d["sigma"]
    embs = np.stack([embed_fn(t) for t in _DECOYS])
    mu = embs.mean(axis=0)
    sigma = embs.std(axis=0) + 1e-6
    if cache_path:
        np.savez(cache_path, mu=mu, sigma=sigma)
    return mu, sigma


class SemanticVectorizer:
    def __init__(self, model_dir: str, dim: int = 256, m: int = 16,
                 saturation: float = 1.5):
        self.model_dir = model_dir
        self.dim, self.m, self.saturation = dim, m, saturation
        self._tok = None
        self._model = None
        self._mu = None
        self._sigma = None
        self._ok = False
        g = np.random.default_rng(7)
        self._p_val = g.normal(0, 1.0, (512, dim)).astype(np.float32)
        self._p_val /= np.linalg.norm(self._p_val, axis=0, keepdims=True)
        self._p_pol = g.normal(0, 1.0, (512, m)).astype(np.float32)
        self._p_pol /= np.linalg.norm(self._p_pol, axis=0, keepdims=True)
        try:
            from transformers import AutoModel, AutoTokenizer
            self._tok = AutoTokenizer.from_pretrained(model_dir)
            self._model = AutoModel.from_pretrained(model_dir)
            self._model.eval()
            self._mu, self._sigma = _whiten_stats(
                self._embed_raw, model_dir + ".whiten.npz")
            self._ok = True
        except Exception as exc:                     # noqa: BLE001
            print(f"[polaris-mcp] semantic model load failed ({exc}); "
                  f"falling back to hash vectorizer", file=sys.stderr,
                  flush=True)

    @property
    def name(self) -> str:
        return "semantic-whitened" if self._ok else "hash"

    def _embed_raw(self, text: str) -> np.ndarray:
        with torch.no_grad():
            enc = self._tok(text, padding=True, truncation=True,
                            max_length=256, return_tensors="pt")
            out = self._model(**enc).last_hidden_state
            mask = enc["attention_mask"].unsqueeze(-1).float()
            e = (out * mask).sum(1) / mask.sum(1).clamp_min(1e-9)
        return e[0].numpy().astype(np.float32)

    def _embed(self, text: str) -> np.ndarray:
        if not self._ok:
            raise RuntimeError("semantic model unavailable")
        return (self._embed_raw(text) - self._mu) / self._sigma

    def vector(self, text):
        if not self._ok:
            raise RuntimeError("semantic model unavailable")
        y = self._embed(text) @ self._p_val
        n = float(np.linalg.norm(y))
        return y if n < 1e-9 else y / n

    def polarity(self, text):
        if not self._ok:
            raise RuntimeError("semantic model unavailable")
        y = self._embed(text) @ self._p_pol
        return torch.tanh(torch.tensor(
            self.saturation * y * np.sqrt(self.m), dtype=torch.float32))


# ---------------------------------------------------------------------------
# remote embedding backend — OpenAI-compatible /v1/embeddings (Qwen DashScope
# compatible-mode, GLM/Zhipu v4, SiliconFlow, ...). DeepSeek has no public
# embeddings endpoint today: keep the local BGE/hash vectorizer there.
# ---------------------------------------------------------------------------
class RemoteVectorizer:
    def __init__(self, base_url: str, api_key: str, model: str,
                 dim: int = 256, m: int = 16, saturation: float = 1.5,
                 timeout: float = 20.0):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.dim, self.m, self.saturation = dim, m, saturation
        self.timeout = timeout
        g = np.random.default_rng(7)
        self._p_val = g.normal(0, 1.0, (4096, dim)).astype(np.float32)
        self._p_val /= np.linalg.norm(self._p_val, axis=0, keepdims=True)
        self._p_pol = g.normal(0, 1.0, (4096, m)).astype(np.float32)
        self._p_pol /= np.linalg.norm(self._p_pol, axis=0, keepdims=True)
        self._cache: dict[str, np.ndarray] = {}
        # warm-up + whitening stats: one batched request proves the
        # endpoint and the key, and calibrates the geometry (BGE whitening
        # principle — the embeddings' common component would otherwise
        # drown the random projection)
        decoys = self._embed(_DECOYS)
        self._mu = np.stack(decoys).mean(axis=0)
        self._sigma = np.stack(decoys).std(axis=0) + 1e-6
        if not np.isfinite(self._mu).all():
            raise RuntimeError("remote embedding endpoint probe failed")
        self.name = f"remote:{model}:whitened"

    def _embed(self, texts: list[str]):
        body = json.dumps({"model": self.model, "input": texts}).encode()
        req = urllib.request.Request(
            self.base_url + "/embeddings", data=body,
            headers={"Content-Type": "application/json",
                     "Authorization": f"Bearer {self.api_key}"})
        with urllib.request.urlopen(req, timeout=self.timeout) as r:
            data = json.loads(r.read().decode("utf-8"))
        rows = sorted(data["data"], key=lambda d: d["index"])
        return [np.asarray(row["embedding"], np.float32) for row in rows]

    def _proj(self, emb, proj):
        y = emb @ proj
        n = float(np.linalg.norm(y))
        return y if n < 1e-9 else y / n

    def _white(self, text):
        e = self._cache.get(text)
        if e is None:
            e = self._embed([text])[0]
            self._cache[text] = e
        d = e.shape[0]
        self._p_val = self._p_val[:d]
        self._p_pol = self._p_pol[:d]
        return (e - self._mu) / self._sigma

    def vector(self, text):
        return self._proj(self._white(text), self._p_val)

    def polarity(self, text):
        y = self._proj(self._white(text), self._p_pol)
        return torch.tanh(torch.tensor(
            self.saturation * y * np.sqrt(self.m), dtype=torch.float32))


# ---------------------------------------------------------------------------
# tool schemas (OpenAI function-calling style input schemas)
# ---------------------------------------------------------------------------
def _schema(props: dict, required: list[str]) -> dict:
    return {"type": "object", "properties": props, "required": required}


def _text_prop(desc: str) -> dict:
    return {"type": "string", "description": desc}


SCHEMAS = {
    "polaris_write": ("Write texts into POLARIS permanent memory "
                      "(FIFO, capacity-capped).",
                      _schema({"texts": {"type": "array",
                                         "items": {"type": "string"},
                                         "description": "texts to remember"}},
                              ["texts"])),
    "polaris_recall": ("Two-stage hybrid recall: value-space semantic "
                       "ranking over a pre-filtered shortlist, composed of "
                       "same-polarity + uniform slots (anti-echo-chamber "
                       "read); the most relevant hit always leads.",
                       _schema({"query": _text_prop("query text")},
                               ["query"])),
    "polaris_auto_remember": ("Novelty-gated automatic memory: writes the "
                              "text only if it is sufficiently new "
                              "(value-space novelty, null-calibrated).",
                              _schema({"text": _text_prop("candidate text"),
                                       "threshold": {
                                           "type": "number",
                                           "description": "novelty gate, "
                                                          "default 0.5"}},
                                      ["text"])),
    "polaris_stats": ("Memory statistics.", _schema({}, [])),
    "polaris_forget": ("Delete memory slots (GDPR-style targeted "
                       "forgetting).",
                       _schema({"indices": {
                           "type": "array", "items": {"type": "integer"},
                           "description": "slot indices to delete"}},
                           ["indices"])),
    "polaris_consolidate": ("Omega3 curvature-anchor consolidation of a text "
                            "trajectory.",
                            _schema({"trajectory": {
                                "type": "array",
                                "items": {"type": "string"},
                                "description": "ordered text trajectory"},
                                "k": {
                                    "type": "integer",
                                    "description": "number of anchors, "
                                                   "default len/100 (>=2)"}},
                                ["trajectory"])),
    "polaris_novelty": ("Novelty score of a text (1 - max semantic "
                        "affinity, null-calibrated to store size).",
                        _schema({"text": _text_prop("text to score")},
                                ["text"])),
    "polaris_health": ("Operational health: slots, vectorizer, uptime, pid.",
                       _schema({}, [])),
}


class ValidationError(ValueError):
    pass


class QuotaExceededError(Exception):
    """Raised when the monthly search quota (free tier) is exhausted."""


def _require(args: dict, name: str, typ):
    if name not in args:
        raise ValidationError(f"missing required argument '{name}'")
    v = args[name]
    if typ == "str" and not isinstance(v, str):
        raise ValidationError(f"argument '{name}' must be a string")
    if typ == "list":
        if not isinstance(v, list):
            raise ValidationError(f"argument '{name}' must be an array")
    return v


# ---------------------------------------------------------------------------
# persistent store: locked read-modify-write, atomic saves
# ---------------------------------------------------------------------------
class Store:
    """Thread-safe + process-safe access to one storage file.

    Every call re-reads the file from disk under the cross-process lock, so
    any number of MCP servers (stdio/http) can share one storage without
    losing writes. The in-process lock serializes threads.
    """

    def __init__(self, args):
        self.args = args
        self.started = time.time()
        self.lock_path = args.storage + ".lock" if args.storage else None
        self._tlock = threading.Lock()
        self.vec = self._make_vectorizer(args)
        self.mem = Memory(args.dim, args.m, args.capacity, args.k_polar,
                          args.k_uniform, 10.0)     # gate temp on value-cosine
        q = getattr(args, "quota", None)
        try:
            self.quota = 1000 if q is None else int(q)  # 0 = unlimited
        except (TypeError, ValueError):
            self.quota = 1000
        self._migrated = False
        if args.storage:
            with self._flock():
                ok = self.mem.load(args.storage)
            if not ok and self.mem.texts:
                self._rebuild_from_texts()
            self._migrate()

    def _rebuild_from_texts(self):
        """Recover a missing/corrupt payload from the preserved texts."""
        log(f"rebuilding {len(self.mem.texts)} slots from preserved texts")
        with self._tlock:
            self.mem.values = np.stack(
                [self.vec.vector(t) for t in self.mem.texts])
            self.mem.pis = np.stack(
                [self.vec.polarity(t).numpy() for t in self.mem.texts])
        self.mem.vec_type = self.vec.name
        if self.args.storage:
            with self._flock():
                self.mem.save_atomic(self.args.storage)

    # ---- vectorizer selection -------------------------------------------
    def _make_vectorizer(self, args):
        base = Vectorizer(dim=args.dim, m=args.m)
        if args.embedding_base_url:
            try:
                return RemoteVectorizer(
                    args.embedding_base_url, args.embedding_api_key or "",
                    args.embedding_model or "text-embedding-v4",
                    dim=args.dim, m=args.m)
            except Exception as exc:                 # noqa: BLE001
                log(f"remote embedding unavailable ({exc}); using local")
        if args.embedding_model:
            sem = SemanticVectorizer(args.embedding_model, dim=args.dim,
                                     m=args.m)
            if sem._ok:
                return sem
        if args.auto_embed:
            guessed = os.path.join(
                os.path.dirname(os.path.abspath(__file__)),
                "..", "models", "bge-small-zh")
            if not os.path.isdir(guessed):
                guessed = os.path.join(
                    os.path.dirname(os.path.dirname(
                        os.path.dirname(os.path.abspath(__file__)))),
                    "models", "bge-small-zh")
            if os.path.isdir(guessed):
                sem = SemanticVectorizer(guessed, dim=args.dim, m=args.m)
                if sem._ok:
                    return sem
        return base

    def _flock(self):
        if not self.lock_path:
            return _NullLock()
        return FileLock(self.lock_path)

    def _load(self):
        if self.args.storage:
            self.mem.load(self.args.storage)

    def _save(self):
        if self.args.storage:
            self.mem.save_atomic(self.args.storage)

    def _migrate(self):
        stored_type = getattr(self.mem, "vec_type", None) or "hash"
        if self.vec.name != stored_type and self.mem.texts:
            log(f"migrating {len(self.mem.texts)} slots "
                f"{stored_type} -> {self.vec.name}")
            with self._tlock:
                self.mem.values = np.stack(
                    [self.vec.vector(t) for t in self.mem.texts])
                self.mem.pis = np.stack(
                    [self.vec.polarity(t).numpy() for t in self.mem.texts])
            with self._flock():
                self.mem.save_atomic(self.args.storage)
        self.mem.vec_type = self.vec.name

    def _quota_path(self):
        return (self.args.storage + ".quota.json") if self.args.storage else None

    def _quota_state(self):
        """Read quota state, rolling over on month change. Caller holds the
        cross-process lock."""
        month = time.strftime("%Y-%m")
        state = {"month": month, "used": 0}
        path = self._quota_path()
        if path and os.path.exists(path):
            try:
                with open(path, encoding="utf-8") as f:
                    state = json.loads(f.read() or "{}")
            except Exception:                        # noqa: BLE001
                state = {"month": month, "used": 0}
        if state.get("month") != month:
            state = {"month": month, "used": 0}
        return state

    def _check_quota(self):
        """Consume one search slot. Caller holds the cross-process lock.
        Returns remaining after this call, raises QuotaExceededError at 0."""
        state = self._quota_state()
        if state["used"] >= self.quota:
            raise QuotaExceededError(
                f"monthly search quota exhausted "
                f"({state['used']}/{self.quota}); free tier resets on the "
                f"1st of next month — upgrade for unlimited searches")
        state["used"] += 1
        atomic_save(self._quota_path(),
                    lambda f: json.dump(state, f, ensure_ascii=False))
        return self.quota - state["used"]

    def _quota_info(self):
        if self.quota <= 0:
            return {"limit": None, "used": 0, "remaining": None,
                    "month": time.strftime("%Y-%m"), "unlimited": True}
        state = self._quota_state()
        return {"limit": self.quota, "used": int(state.get("used", 0)),
                "remaining": max(0, self.quota - int(state.get("used", 0))),
                "month": state.get("month"), "unlimited": False}

    # ---- tool implementations (each acquires the file lock) -------------
    def write(self, texts):
        texts = _require({"texts": texts}, "texts", "list")
        texts = [t for t in texts if isinstance(t, str) and t.strip()]
        if not texts:
            return {"written": 0}
        with self._tlock:
            with self._flock():
                self._load()
                vals = np.stack([self.vec.vector(t) for t in texts])
                pis = torch.stack(
                    [self.vec.polarity(t) for t in texts]).numpy()
                n = self.mem.write(vals, pis, texts)
                self.mem.save_atomic(self.args.storage)
        return {"written": n}

    def recall(self, query):
        query = _require({"query": query}, "query", "str")
        with self._tlock:
            with self._flock():
                if self.quota > 0:
                    self._check_quota()
                self._load()
                texts, gates, idx = self.mem.recall(
                    self.vec.vector(query), self.vec.polarity(query))
        return {"texts": texts, "gates": gates, "indices": idx}

    def auto_remember(self, text, threshold=0.5):
        text = _require({"text": text}, "text", "str")
        if not text.strip():
            return {"remembered": False, "novelty": 1.0}
        with self._tlock:
            with self._flock():
                self._load()
                qval = self.vec.vector(text)
                novelty = self.mem.novelty(qval)
                if novelty >= threshold:
                    pis = self.vec.polarity(text).numpy()[None]
                    n = self.mem.write(qval[None], pis, [text])
                    self._save()
                    return {"remembered": True,
                            "novelty": round(novelty, 3), "written": n,
                            "slots": len(self.mem.texts)}
        return {"remembered": False, "novelty": round(novelty, 3),
                "slots": len(self.mem.texts)}

    def stats(self):
        with self._tlock:
            with self._flock():
                self._load()
                s = self.mem.stats()
        s["vectorizer"] = self.vec.name
        return s

    def forget(self, indices):
        indices = _require({"indices": indices}, "indices", "list")
        with self._tlock:
            with self._flock():
                self._load()
                n = self.mem.forget([int(i) for i in indices
                                     if isinstance(i, (int, float))])
                self.mem.save_atomic(self.args.storage)
        return {"removed": n}

    def consolidate(self, trajectory, k=None):
        trajectory = _require({"trajectory": trajectory}, "trajectory",
                              "list")
        traj = [t for t in trajectory if isinstance(t, str)]
        k = k or max(2, len(traj) // 100)
        with self._tlock:
            pis = np.stack([self.vec.polarity(t).numpy() for t in traj]) \
                if traj else np.zeros((0, self.args.m), np.float32)
        anchors = curvature_anchors(pis, k) if len(pis) > 2 else []
        return {"anchors": anchors}

    def novelty(self, text):
        text = _require({"text": text}, "text", "str")
        with self._tlock:
            with self._flock():
                self._load()
                return {"novelty": self.mem.novelty(self.vec.vector(text))}

    def health(self):
        with self._tlock:
            with self._flock():
                self._load()
                s = self.mem.stats()
                quota = self._quota_info()
        return {"status": "ok", "server": "polaris-memory",
                "version": VERSION, "vectorizer": self.vec.name,
                "slots": s["slots"], "capacity": s["capacity"],
                "storage": self.args.storage,
                "uptime_s": round(time.time() - self.started, 1),
                "pid": os.getpid(), "quota": quota}

    def call(self, name, args):
        if name not in SCHEMAS:
            raise ValueError(f"unknown tool {name}")
        missing = [k for k in SCHEMAS[name][1].get("required", [])
                   if k not in args]
        if missing:
            raise ValidationError(
                f"missing required argument(s): {', '.join(missing)}")
        if name == "polaris_write":
            return self.write(args.get("texts", []))
        if name == "polaris_recall":
            return self.recall(args.get("query", ""))
        if name == "polaris_auto_remember":
            return self.auto_remember(args.get("text", ""),
                                      args.get("threshold", 0.5))
        if name == "polaris_stats":
            return self.stats()
        if name == "polaris_forget":
            return self.forget(args.get("indices", []))
        if name == "polaris_consolidate":
            return self.consolidate(args.get("trajectory", []),
                                    args.get("k"))
        if name == "polaris_novelty":
            return self.novelty(args.get("text", ""))
        if name == "polaris_health":
            return self.health()
        raise ValueError(f"unknown tool {name}")


class _NullLock:
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


# ---------------------------------------------------------------------------
# JSON-RPC dispatch (full conformance)
# ---------------------------------------------------------------------------
def dispatch(store: Store, req) -> dict | None:
    if not isinstance(req, dict) or req.get("jsonrpc") != "2.0":
        return {"jsonrpc": "2.0", "id": None,
                "error": {"code": -32600, "message": "invalid request"}}
    method = req.get("method", "")
    rid = req.get("id")
    is_notification = "id" not in req

    if method == "initialize":
        want = (req.get("params") or {}).get("protocolVersion") \
            or "2025-06-18"
        result = {"protocolVersion": want, "capabilities": {"tools": {}},
                  "serverInfo": {"name": "polaris-memory",
                                 "version": VERSION}}
    elif method == "tools/list":
        result = {"tools": [
            {"name": n, "description": d, "inputSchema": s}
            for n, (d, s) in SCHEMAS.items()]}
    elif method == "tools/call":
        params = req.get("params") or {}
        name = params.get("name")
        if name not in SCHEMAS:
            return {"jsonrpc": "2.0", "id": rid, "error": {
                "code": -32602,
                "message": f"unknown tool '{name}'"}}
        try:
            out = store.call(name, params.get("arguments") or {})
            result = {"content": [{"type": "text", "text": json.dumps(
                out, ensure_ascii=False)}]}
        except ValidationError as exc:
            return {"jsonrpc": "2.0", "id": rid, "error": {
                "code": -32602, "message": str(exc)}}
        except QuotaExceededError as exc:
            return {"jsonrpc": "2.0", "id": rid, "error": {
                "code": -32001, "message": str(exc)}}
        except Exception as exc:                     # noqa: BLE001
            log(f"tool {name} failed: {exc}\n{traceback.format_exc()}")
            return {"jsonrpc": "2.0", "id": rid, "error": {
                "code": -32000, "message": str(exc)}}
    elif method == "ping":
        result = {}
    elif method.startswith("notifications/"):
        return None                                  # silent
    else:
        return {"jsonrpc": "2.0", "id": rid, "error": {
            "code": -32601, "message": f"unknown method {method}"}}

    if is_notification:
        return None
    return {"jsonrpc": "2.0", "id": rid, "result": result}


# ---------------------------------------------------------------------------
# stdio transport (MCP spec: newline-delimited JSON-RPC)
# ---------------------------------------------------------------------------
def _send(msg: dict):
    body = json.dumps(msg, ensure_ascii=False).encode("utf-8")
    sys.stdout.buffer.write(body + b"\n")
    sys.stdout.buffer.flush()


def _read_message():
    # Newline-delimited JSON per the MCP stdio spec; Content-Length header
    # framing (nonstandard) is auto-detected so both kinds of clients work.
    while True:
        line = sys.stdin.buffer.readline()
        if not line:
            return None
        line = line.rstrip(b"\r\n")
        if line:
            break
    if line.startswith(b"{"):
        return json.loads(line)
    headers = {}
    cur = line
    while cur:
        k, _, v = cur.partition(b":")
        headers[k.lower().decode()] = v.strip().decode()
        cur = sys.stdin.buffer.readline()
        if not cur:
            return None
        cur = cur.rstrip(b"\r\n")
    n = int(headers.get("content-length", "0"))
    return json.loads(sys.stdin.buffer.read(n))


def serve_stdio(store):
    log(f"stdio mode ready (storage={store.args.storage})")
    while True:
        try:
            raw = _read_message()
        except json.JSONDecodeError as exc:
            _send({"jsonrpc": "2.0", "id": None, "error": {
                "code": -32700, "message": f"parse error: {exc}"}})
            continue
        if raw is None:
            log("stdin closed, exiting")
            break
        if not isinstance(raw, dict):
            _send({"jsonrpc": "2.0", "id": None, "error": {
                "code": -32600, "message": "invalid request"}})
            continue
        log(f"received: {raw.get('method', '?')} id={raw.get('id')}")
        try:
            resp = dispatch(store, raw)
        except Exception as exc:                     # noqa: BLE001
            log(f"dispatch failed: {exc}")
            resp = {"jsonrpc": "2.0", "id": raw.get("id"), "error": {
                "code": -32603, "message": str(exc)}}
        if resp is not None:
            _send(resp)


# ---------------------------------------------------------------------------
# http transport (streamable HTTP, direct JSON responses)
# ---------------------------------------------------------------------------
class MCPHTTPHandler(BaseHTTPRequestHandler):
    store: Store = None
    token: str | None = None                          # set from --token
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass

    def _reply(self, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authed(self):
        if not MCPHTTPHandler.token:
            return True
        got = self.headers.get("Authorization", "").encode("utf-8")
        want = ("Bearer " + MCPHTTPHandler.token).encode("utf-8")
        return hmac.compare_digest(got, want)

    def do_GET(self):
        if self.path in ("/health", "/mcp"):
            self._reply({"status": "ok", "server": "polaris-memory",
                         "version": VERSION})
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path != "/mcp":
            self.send_response(404)
            self.end_headers()
            return
        if self.headers.get("Content-Type", "").split(";")[0].strip() \
                != "application/json":
            # non-JSON POSTs can skip CORS preflight; refuse them outright
            self.send_response(415)
            self.end_headers()
            return
        if not self._authed():
            self.send_response(401)
            self.send_header("WWW-Authenticate", "Bearer")
            self.end_headers()
            return
        try:
            n = int(self.headers.get("Content-Length", "0"))
            req = json.loads(self.rfile.read(n))
        except Exception:
            self.send_response(400)
            self.end_headers()
            return
        log(f"http received: {req.get('method', '?')} id={req.get('id')}")
        resp = dispatch(MCPHTTPHandler.store, req)
        if resp is None:
            self.send_response(202)
            self.send_header("Content-Length", "0")
            self.end_headers()
        else:
            self._reply(resp)

    def do_OPTIONS(self):
        # no CORS headers: cross-origin preflight fails, browser CSRF blocked
        self.send_response(204)
        self.end_headers()


def serve_http(store, port, token=None):
    MCPHTTPHandler.store = store
    MCPHTTPHandler.token = token
    if not token:
        log("WARNING: http mode without --token is unauthenticated; "
            "any local process can read/write this memory")
    srv = ThreadingHTTPServer(("127.0.0.1", port), MCPHTTPHandler)
    log(f"http mode ready on "
        f"http://127.0.0.1:{srv.server_address[1]}/mcp")
    srv.serve_forever()


# ---------------------------------------------------------------------------
def log(msg: str):
    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}",
          file=sys.stderr, flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--storage", default=None)
    ap.add_argument("--capacity", type=int, default=1024)
    ap.add_argument("--m", type=int, default=16)
    ap.add_argument("--dim", type=int, default=256)
    ap.add_argument("--k-polar", type=int, default=4)
    ap.add_argument("--k-uniform", type=int, default=4)
    ap.add_argument("--http", type=int, default=None,
                    help="serve over HTTP on 127.0.0.1:<port> (0 selects a "
                         "free port) instead of stdio")
    ap.add_argument("--token", default=None,
                    help="require 'Authorization: Bearer <token>' on POST /mcp")
    ap.add_argument("--quota", type=int, default=1000,
                    help="monthly search quota for the free tier "
                         "(0 = unlimited); default 1000")
    ap.add_argument("--embedding-model", default=None,
                    help="local semantic embedding model dir (BGE-small-zh)")
    ap.add_argument("--embedding-base-url", default=None,
                    help="OpenAI-compatible embeddings endpoint, e.g. "
                         "https://dashscope.aliyuncs.com/compatible-mode/v1")
    ap.add_argument("--embedding-api-key", default=None,
                    help="API key for --embedding-base-url")
    ap.add_argument("--no-auto-embed", action="store_true",
                    help="disable auto-detection of ../models/bge-small-zh")
    args = ap.parse_args()

    # environment overrides (container/deployment friendly)
    args.storage = os.environ.get("POLARIS_STORAGE", args.storage)
    args.token = args.token or os.environ.get("POLARIS_TOKEN")
    if "POLARIS_QUOTA" in os.environ:
        try:
            args.quota = int(os.environ["POLARIS_QUOTA"])
        except ValueError:
            pass
    if not args.embedding_base_url:
        args.embedding_base_url = os.environ.get(
            "POLARIS_EMBEDDING_BASE_URL")
        args.embedding_api_key = os.environ.get("POLARIS_EMBEDDING_API_KEY",
                                                args.embedding_api_key)
        args.embedding_model = os.environ.get("POLARIS_EMBEDDING_MODEL",
                                              args.embedding_model)
    args.auto_embed = not args.no_auto_embed

    if not args.storage:
        args.storage = os.path.join(os.path.dirname(
            os.path.abspath(__file__)), "polaris_memory.pt")

    log_path = args.storage + ".log"
    if args.storage and os.environ.get("POLARIS_LOG_STDERR") != "1":
        sys.stderr = open(log_path, "a", encoding="utf-8", buffering=1)
    log(f"starting (storage={args.storage}, http={args.http}, pid={os.getpid()})")

    store = Store(args)
    log(f"ready: vectorizer={store.vec.name}, slots={len(store.mem.texts)}")
    if args.http is not None:
        serve_http(store, args.http, args.token)
    else:
        serve_stdio(store)


if __name__ == "__main__":
    main()
