#!/usr/bin/env python3
"""reference-verify 机核层：清单门控 + CrossRef/arXiv 官方事实抽取 + 链接活性检查。

用法:
  uv run ref_machine_check.py manuscript.tex                     # 内嵌 thebibliography
  uv run ref_machine_check.py refs.bib --tex manuscript.tex      # 外部 .bib
选项: --json out.json --md out.md --skip-links

产出 markdown（默认 stdout）与 JSON 两份"机核事实表"：每条引用的 DOI/arXiv 编号、
CrossRef 官方记录、arXiv 官方记录（含 journal_ref/comment，预印本升级的关键字段）、
条目内 URL 的 HTTP 状态。事实抽取全部经官方 API，零模型回忆。
"""
import argparse
import json
import re
import subprocess
import sys
import time
from html import unescape
from pathlib import Path

DOI_RE = re.compile(r"doi\.org/(10\.[^}\s\"']+)")
ARXIV_URL_RE = re.compile(r"arxiv\.org/abs/([0-9]{4}\.[0-9]{4,5})")
ARXIV_TEXT_RE = re.compile(r"arXiv:([0-9]{4}\.[0-9]{4,5})", re.I)
URL_RE = re.compile(r"\\url\{([^}]+)\}|\\href\{([^}]+)\}")
LABEL_YEAR_RE = re.compile(r"\((\d{4})\)")
TAIL_YEAR_RE = re.compile(r"\b(?:19|20)\d{2}\b")


def curl(url: str, timeout: int = 30, retries: int = 3) -> str | None:
    """GET via curl（尊重代理环境变量），空返回/非零退出则重试。"""
    for _ in range(retries):
        try:
            r = subprocess.run(
                ["curl", "-sS", "--max-time", str(timeout), url],
                capture_output=True, text=True, timeout=timeout + 10,
            )
            if r.returncode == 0 and r.stdout.strip():
                return r.stdout
        except subprocess.TimeoutExpired:
            pass
        time.sleep(2)
    return None


def link_status(url: str) -> str:
    try:
        r = subprocess.run(
            ["curl", "-sSL", "-o", "/dev/null", "-w", "%{http_code}",
             "--max-time", "25", "--retry", "2", url],
            capture_output=True, text=True, timeout=60,
        )
        return r.stdout.strip() or f"exit {r.returncode}"
    except subprocess.TimeoutExpired:
        return "timeout"


def guess_year(raw: str, label: str) -> str:
    m = LABEL_YEAR_RE.search(label)
    if m:
        return m.group(1)
    years = TAIL_YEAR_RE.findall(raw)
    return "".join(years[-1]) if years else ""


def extract_ids(raw: str) -> tuple[str, str]:
    dm = DOI_RE.search(raw)
    am = ARXIV_URL_RE.search(raw) or ARXIV_TEXT_RE.search(raw)
    return (dm.group(1).rstrip(".") if dm else "", am.group(1) if am else "")


def extract_urls(raw: str) -> list[str]:
    out = []
    for m in URL_RE.finditer(raw):
        u = m.group(1) or m.group(2)
        if u and u.startswith("http"):
            out.append(u)
    return out


def parse_tex(text: str) -> list[dict]:
    entries = []
    for m in re.finditer(
        r"^\\bibitem(?:\[((?:[^\[\]])*)\])?\{([^}]+)\}[ \t]*(.*)$", text, re.M
    ):
        raw = m.group(3)
        doi, arxiv = extract_ids(raw)
        entries.append({
            "key": m.group(2), "label": m.group(1) or "", "raw": raw.strip(),
            "line": text.count("\n", 0, m.start()) + 1,
            "doi": doi, "arxiv": arxiv,
            "year_guess": guess_year(raw, m.group(1) or ""),
            "urls": extract_urls(raw),
        })
    return entries


def parse_bib(text: str) -> list[dict]:
    entries, starts = [], [
        m for m in re.finditer(r"@(\w+)\s*\{\s*([^,\s]+)\s*,", text)
        if m.group(1).lower() not in ("comment", "string", "preamble")
    ]
    for i, m in enumerate(starts):
        end = starts[i + 1].start() if i + 1 < len(starts) else len(text)
        body = text[m.start():end]
        def field(name: str) -> str:
            pat = r"^\s*" + name + r'\s*=\s*[{"](.+?)[}"]\s*,?\s*$'
            fm = re.search(pat, body, re.M | re.I)
            return fm.group(1).strip() if fm else ""
        raw = " ".join(body.split())[:400]
        doi = field("doi") or (DOI_RE.search(body).group(1) if DOI_RE.search(body) else "")
        arxiv = field("eprint") or ""
        if not arxiv:
            am = ARXIV_URL_RE.search(body) or ARXIV_TEXT_RE.search(body)
            arxiv = am.group(1) if am else ""
        entries.append({
            "key": m.group(2), "label": "", "raw": raw,
            "doi": doi, "arxiv": arxiv,
            "year_guess": field("year"), "urls": extract_urls(body),
        })
    return entries


def cite_keys_of(tex_text: str) -> set[str]:
    keys = set()
    for m in re.finditer(r"\\cite[tp]?\{([^}]*)\}", tex_text):
        for k in m.group(1).split(","):
            if k.strip():
                keys.add(k.strip())
    return keys


def crossref_fact(doi: str) -> dict:
    raw = curl(f"https://api.crossref.org/works/{doi}")
    if raw is None:
        return {"ok": False, "error": "fetch failed"}
    try:
        m = json.loads(raw)["message"]
        issued = (m.get("issued", {}).get("date-parts") or [[None]])[0]
        return {
            "ok": True,
            "title": (m.get("title") or [""])[0],
            "first_author": (m.get("author") or [{}])[0].get("family", "")
                            or (m.get("author") or [{}])[0].get("name", ""),
            "year": issued[0] if issued else None,
            "container": (m.get("container-title") or [""])[0],
            "url": f"https://doi.org/{doi}",
        }
    except (KeyError, IndexError, json.JSONDecodeError) as e:
        return {"ok": False, "error": f"parse: {e}"}


def arxiv_fact(aid: str) -> dict:
    raw = curl(f"https://export.arxiv.org/api/query?id_list={aid}")
    if raw is None:
        return {"ok": False, "error": "fetch failed (arXiv 批量 id_list 会截断，此处已用单条)"}
    for en in raw.split("<entry>")[1:]:
        if not re.search(r"abs/" + re.escape(aid), en):
            continue
        def tag(name: str) -> str:
            tm = re.search(rf"<{name}>(.*?)</{name}>", en, re.S)
            return unescape(tm.group(1)).strip() if tm else ""
        def ns(name: str) -> str:
            nm = re.search(rf"<arxiv:{name}[^>]*>(.*?)</arxiv:{name}>", en, re.S)
            return unescape(nm.group(1)).strip() if nm else ""
        return {
            "ok": True, "title": tag("title"),
            "first_author": tag("name"),
            "year": tag("published")[:4],
            "journal_ref": ns("journal_ref"), "comment": ns("comment"),
            "url": f"https://arxiv.org/abs/{aid}",
        }
    return {"ok": False, "error": "API 返回中无该编号"}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("source", help=".tex（thebibliography）或 .bib 文件")
    ap.add_argument("--tex", help="引用键所在手稿（.bib 模式做门控用）")
    ap.add_argument("--json", dest="json_path")
    ap.add_argument("--md", dest="md_path")
    ap.add_argument("--skip-links", action="store_true")
    args = ap.parse_args()

    src = Path(args.source)
    if not src.exists():
        print(f"error: {src} 不存在", file=sys.stderr)
        return 1
    text = src.read_text(encoding="utf-8", errors="replace")

    if src.suffix == ".bib":
        entries, mode = parse_bib(text), "bib"
    else:
        entries, mode = parse_tex(text), "thebibliography"

    cite_file = src if mode == "thebibliography" else (
        Path(args.tex) if args.tex else None
    )
    cites = cite_keys_of(cite_file.read_text(encoding="utf-8", errors="replace")) \
        if cite_file and cite_file.exists() else set()
    entry_keys = [e["key"] for e in entries]
    uncited = [k for k in entry_keys if cites and k not in cites]
    missing = sorted(cites - set(entry_keys)) if cites else []

    print(f"解析 {mode}：{len(entries)} 条；引用键 {len(cites)} 个", file=sys.stderr)

    crossref_cache: dict[str, dict] = {}
    arxiv_cache: dict[str, dict] = {}
    for e in entries:
        if e["doi"] and e["doi"] not in crossref_cache:
            crossref_cache[e["doi"]] = crossref_fact(e["doi"])
            time.sleep(1)
        if e["arxiv"] and e["arxiv"] not in arxiv_cache:
            arxiv_cache[e["arxiv"]] = arxiv_fact(e["arxiv"])
            time.sleep(3)

    link_cache: dict[str, str] = {}
    if not args.skip_links:
        for e in entries:
            for u in e["urls"]:
                if u not in link_cache:
                    link_cache[u] = link_status(u)

    results = []
    for i, e in enumerate(entries):
        r = dict(e)
        r["index"] = i + 1
        r["crossref"] = crossref_cache.get(e["doi"]) if e["doi"] else None
        r["arxiv"] = arxiv_cache.get(e["arxiv"]) if e["arxiv"] else None
        r["link_status"] = {u: link_cache[u] for u in e["urls"]} if not args.skip_links else {}
        results.append(r)

    lines = [
        "# 机核事实表（reference-verify 阶段 1 产出）",
        "",
        f"- 源：`{args.source}`（{mode}，{len(entries)} 条）；引用键 {len(cites)} 个",
    ]
    if uncited:
        lines.append(f"- **未被正文引用的 bibitem（{len(uncited)}）**：{', '.join(uncited)}")
    if missing:
        lines.append(f"- **正文引用但缺 bibitem（{len(missing)}）**：{', '.join(missing)}")
    lines.append("- 链接状态为原始 HTTP 码；403 多为出版社反爬而非死链，2xx/3xx 均算活")
    for r in results:
        lines += ["", f"## {r['index']}. `{r['key']}`"
                  + (f"（{args.source}:{r['line']}）" if r.get("line") else "")
                  + (f"（年份≈{r['year_guess']}）" if r["year_guess"] else ""),
                  f"- raw: {r['raw'][:220]}{'…' if len(r['raw']) > 220 else ''}"]
        if r["crossref"] is not None:
            c = r["crossref"]
            lines.append("- CrossRef: " + (
                f"题名「{c['title']}」/ 首作者 {c['first_author']} / 年 {c['year']} / "
                f"{c['container']} — {c['url']}" if c["ok"] else f"**{c['error']}**"))
        if r["arxiv"] is not None:
            a = r["arxiv"]
            extra = f" / journal_ref「{a['journal_ref']}」" if a["journal_ref"] else ""
            extra += f" / comment「{a['comment']}」" if a["comment"] else ""
            lines.append("- arXiv: " + (
                f"题名「{a['title']}」/ 首作者 {a['first_author']} / 发布 {a['year']}"
                f"{extra} — {a['url']}" if a["ok"] else f"**{a['error']}**"))
        for u, s in r["link_status"].items():
            lines.append(f"- link: {s} ← {u}")

    md = "\n".join(lines)
    if args.md_path:
        Path(args.md_path).write_text(md + "\n", encoding="utf-8")
    else:
        print(md)
    if args.json_path:
        Path(args.json_path).write_text(
            json.dumps({"mode": mode, "entries": results, "uncited": uncited,
                        "missing": missing}, ensure_ascii=False, indent=1),
            encoding="utf-8",
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
