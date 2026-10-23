"""Offline renderer bridge: pinned fingerprints, strict auto-derivation, marker strip."""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import struct
import tempfile
import time

import patch_install as asar

WORKTREE = Path("/Users/smzdm/Projects/AI/zcode-token-usage-statusbar")
MARKER = b"/* zusage-existing-conversation-store:v1"
BEGIN = b"/* zusage-existing-conversation-store:v1 begin */"
END = b"/* zusage-existing-conversation-store:v1 end */"
# 多版本指纹表（新→旧）：客户端官方升级会整体换渲染器资产与混淆名，这里按
# (版本, 资产路径, 原始 sha256, 混淆名三元组) 逐版本钉死，优先于自动推导。
# 表内版本的资产哈希漂移仍拒绝（fail-closed）；表外版本走 derive_target 的
# 严格结构推导——任何一项不唯一/不符即拒绝，绝不对没验证过的 bundle 做字节手术。
HOST_TARGETS = [
    {"version": "3.16.3", "asset": "/out/renderer/assets/styles-CQuzX8si.js",
     "sha256": "f7eaccd11e350ff6f5dbbeecae15107f519e5b644f359bd1142b26d7f4f44115",
     "names": {"key": "kde", "topic": "So", "registry": "hf"},
     "pane": {"anchor": b'"data-testid":Sb(WRe,e),"data-session-id":t??`draft`,',
              "workspacePath": "c", "workspaceIdentity": "l", "remoteSessionId": "u", "paneId": "e"}},
    {"version": "3.16.2", "asset": "/out/renderer/assets/styles-n-UNIiNg.js",
     "sha256": "10ea7c92c2b52a1c4006ced89a1ec2da83996605ffcd9e22190c9dc6b80f8509",
     "names": {"key": "Ede", "topic": "gee", "registry": "hf"},
     "pane": {"anchor": b'"data-testid":hb(WRe,e),"data-session-id":t??`draft`,',
              "workspacePath": "c", "workspaceIdentity": "l", "remoteSessionId": "u", "paneId": "e"}},
    {"version": "3.16.1", "asset": "/out/renderer/assets/styles-CqgV6nRf.js",
     "sha256": "6054041f771950896c1d80bd8c32b241dde9ab414b3eb66d038ca2c578332783",
     "names": {"key": "Ode", "topic": "hee", "registry": "pf"},
     "pane": {"anchor": b'"data-testid":vb(VRe,e),"data-session-id":t??`draft`,',
              "workspacePath": "c", "workspaceIdentity": "l", "remoteSessionId": "u", "paneId": "e"}},
    {"version": "3.15.3", "asset": "/out/renderer/assets/styles-CSpM3qgc.js",
     "sha256": "e3e0496d9ba2432ca995b8fce908333c861e3ad1c3641b5751dbe06441c53ecf",
     "names": {"key": "BYe", "topic": "Nse", "registry": "oE"},
     "pane": {"anchor": b'"data-testid":Oa(Mr,e),"data-session-id":t??`draft`,',
              "workspacePath": "c", "workspaceIdentity": "l", "remoteSessionId": "u", "paneId": "e"}},
]
NEWEST = HOST_TARGETS[0]
ASSET, HOST_VERSION, ASSET_SHA256 = NEWEST["asset"], NEWEST["version"], NEWEST["sha256"]
# 自动推导（derive / 运行时补丁）只认与已登记版本一致的稳定代码形状：
# 会话数据层注册表与 key 函数、acquire 里的 topic 绑定、SessionPane 的
# testid/session-id 锚点、组件参数与 store 生命周期方法。任何一项缺失或
# 命中多于一次即拒绝，宁可降级为 DB 轮询，也不对可疑 bundle 做字节手术。
AUTO_ASSET_RE = re.compile(r"/out/renderer/assets/styles-[^/]+\.js")
AUTO_NAMES = re.compile(
    rb"([A-Za-z_$][\w$]*)=new Map,[A-Za-z_$][\w$]*=`__base__`,[A-Za-z_$][\w$]*=\d+(?:\.\d+)?(?:e\d+)?;"
    rb"function ([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*)\)\{let ([A-Za-z_$][\w$]*)=\3\.workspaceIdentity\?\.trim\(\)\|\|\3\.workspacePath;"
    rb"return`\$\{\3\.remoteSessionId\?\?`__base__`\} \$\{\4\}`\}")
AUTO_TOPIC = re.compile(
    rb"acquire\(e\)\{if\(this\.disposed\)throw Error\(`[^`]*`\);let t=([A-Za-z_$][\w$]*)\(e\),"
    rb"n=[A-Za-z_$][\w$]*\(\),r=this\.entries\.get\(t\)")
AUTO_SESSION = re.compile(rb'"data-session-id":([A-Za-z_$][\w$]*)\?\?`draft`')
AUTO_TESTID = re.compile(rb'("data-testid":[A-Za-z_$][\w$]*\([A-Za-z_$][\w$]*,([A-Za-z_$][\w$]*)\),)$')
AUTO_PANE_PARAM = re.compile(rb"(?:^|,)(paneId|workspacePath|workspaceIdentity|remoteSessionId):([A-Za-z_$][\w$]*)")
AUTO_HEADER = re.compile(rb"function [A-Za-z_$][\w$]*\(\{([^{}]{0,4000}?)\}\)\{")
AUTO_IMPORT = re.compile(rb'import\{([^}]*)\}from"([^"]+)"')
AUTO_PANE_ATTRS = re.compile(
    rb'"data-zusage-scope-version":"1","data-zusage-workspace-path":[A-Za-z_$][\w$]*\?\?``,'
    rb'"data-zusage-workspace-identity":[A-Za-z_$][\w$]*\?\?``,'
    rb'"data-zusage-remote-session-id":[A-Za-z_$][\w$]*\?\?``,"data-zusage-pane-id":[A-Za-z_$][\w$]*,')
# 桥代码模板：标识符占位符按目标版本的混淆名实例化（__ZU_*__ 不与 JS 语法冲突）。
BRIDGE_TEMPLATE = rb'''
/* zusage-existing-conversation-store:v1 begin */
export function getExistingConversationStore(scope) {
  const fields = ["sessionId", "workspacePath", "workspaceIdentity", "remoteSessionId"];
  if (!scope || typeof scope !== "object" || Array.isArray(scope))
    throw new TypeError("Invalid conversation scope");
  const descriptors = Object.getOwnPropertyDescriptors(scope);
  if (Reflect.ownKeys(descriptors).some(key => !fields.includes(key)))
    throw new TypeError("Unknown conversation scope field");
  const checked = Object.create(null);
  for (const key of fields) {
    const d = descriptors[key];
    if (!d) continue;
    if (!("value" in d) || typeof d.value !== "string" ||
        !d.value.trim() || /[\x00-\x1f\x7f]/.test(d.value))
      throw new TypeError("Invalid conversation scope field");
    if ((key === "sessionId" || key === "remoteSessionId") && /\s/.test(d.value))
      throw new TypeError("Invalid conversation identifier");
    if (key === "remoteSessionId" && d.value === "__base__")
      throw new TypeError("Reserved remote identifier");
    checked[key] = d.value;
  }
  if (!checked.sessionId || !checked.workspacePath)
    throw new TypeError("Missing conversation scope field");
  const key = __ZU_KEY_FN__(checked), topic = __ZU_TOPIC_FN__(checked.sessionId);
  const entry = __ZU_REGISTRY__.get(key), layer = entry?.layer;
  const session = layer?.entries.get(topic), store = session?.store;
  const current = () => !!store && __ZU_REGISTRY__.get(key) === entry && !entry.stale &&
    !layer.disposed && layer.entries.get(topic) === session &&
    session.store === store && !store.closed;
  if (!current()) return null;
  // Only consumer reads allocate copies. Never freeze a host-owned object.
  const snapshot = (value, seen = new WeakMap()) => {
    if (value === null || typeof value !== "object") {
      if (typeof value === "function" || typeof value === "symbol")
        throw new TypeError("Unsupported snapshot value");
      return value;
    }
    if (seen.has(value)) return seen.get(value);
    const proto = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && proto !== Object.prototype && proto !== null)
      throw new TypeError("Unsupported snapshot object");
    const result = Array.isArray(value) ? [] : Object.create(null);
    seen.set(value, result);
    for (const key of Reflect.ownKeys(value)) {
      if (Array.isArray(value) && key === "length") continue;
      const d = Object.getOwnPropertyDescriptor(value, key);
      if (!("value" in d)) throw new TypeError("Unsupported snapshot accessor");
      Object.defineProperty(result, key, {
        value: snapshot(d.value, seen), enumerable: d.enumerable,
        writable: false, configurable: false
      });
    }
    if (Array.isArray(value)) result.length = value.length;
    return Object.freeze(result);
  };
  let stopped = false;
  const cancellations = new Set();
  const off = () => {
    if (stopped) return;
    stopped = true;
    for (const cancel of [...cancellations]) cancel();
  };
  const active = () => {
    if (stopped) return false;
    if (current()) return true;
    off();
    return false;
  };
  return Object.freeze({
    getState: () => active() ? snapshot(store.getState()) : null,
    subscribe: callback => {
      if (typeof callback !== "function") throw new TypeError("Invalid callback");
      if (!active()) return () => {};
      let cancelled = false;
      const cancel = () => {
        if (cancelled) return;
        cancelled = true;
        cancellations.delete(cancel);
        try { unsubscribe(); } catch (_) {}
      };
      const unsubscribe = store.subscribe(() => {
        if (cancelled || !active()) return;
        try {
          const result = callback();
          if (result && typeof result.then === "function")
            Promise.resolve(result).catch(() => {});
        } catch (_) {}
      });
      cancellations.add(cancel);
      return cancel;
    },
    off
  });
}
if (typeof globalThis === "object" && globalThis !== null) {
  globalThis.__zusageGetExistingConversationStore = getExistingConversationStore;
  // Read-only acceptance diagnostics: enumerate live registry keys/topics for verification.
  globalThis.__zusageConversationDiagnostics = function () {
    const keys = [], sessions = [];
    for (const [key, entry] of __ZU_REGISTRY__) {
      keys.push(key);
      const layer = entry && entry.layer;
      if (!layer || layer.disposed || entry.stale) continue;
      for (const [topic, session] of layer.entries) {
        const store = session && session.store;
        const state = store && !store.closed && store.getState();
        sessions.push({ key, topic, status: state ? (state.status || "unknown") : "unavailable",
          seq: state && state.snapshot ? state.snapshot.seq : null });
      }
    }
    return { keys, sessions };
  };
}
/* zusage-existing-conversation-store:v1 end */
'''

def bridge_code(target):
    names = target["names"]
    return (BRIDGE_TEMPLATE
            .replace(b"__ZU_KEY_FN__", names["key"].encode())
            .replace(b"__ZU_TOPIC_FN__", names["topic"].encode())
            .replace(b"__ZU_REGISTRY__", names["registry"].encode()))

# 最新目标的桥正文（CLI 默认 / 测试兼容别名）
BRIDGE = bridge_code(NEWEST)


def pane_attributes(target):
    pane = target["pane"]
    return (f'"data-zusage-scope-version":"1",'
            f'"data-zusage-workspace-path":{pane["workspacePath"]}??``,'
            f'"data-zusage-workspace-identity":{pane["workspaceIdentity"]}??``,'
            f'"data-zusage-remote-session-id":{pane["remoteSessionId"]}??``,'
            f'"data-zusage-pane-id":{pane["paneId"]},').encode()


def _original_module(data, target):
    """仅识别精确旧桥/新桥；第三方尾缀只供 remove 保留。"""
    prefix, suffix = data, b""
    has_bridge = MARKER in data
    if has_bridge:
        bridge = bridge_code(target)
        if data.count(MARKER) != 2 or data.count(bridge) != 1:
            raise BridgeError("Bridge marker/content tampered")
        prefix, suffix = data.split(bridge)
    elif b"getExistingConversationStore" in data:
        raise BridgeError("Export name collision")
    anchor = target["pane"]["anchor"]
    patched_anchor = anchor + pane_attributes(target)
    if prefix.count(anchor) != 1:
        raise BridgeError("Missing or duplicate SessionPane anchor")
    if has_bridge and prefix.count(patched_anchor) == 1:
        prefix = prefix.replace(patched_anchor, anchor, 1)
    if _digest(prefix) != target["sha256"]:
        raise BridgeError("Unknown or tampered original module")
    return prefix, suffix


def target_for_module(data):
    """新/旧补丁均须还原到已登记的原始 SHA。"""
    for target in HOST_TARGETS:
        try:
            _original_module(data, target)
        except BridgeError:
            continue
        return target
    return None


class BridgeError(ValueError):
    pass


def _digest(data):
    return hashlib.sha256(data).hexdigest()


def _only(pattern, data, what):
    found = pattern.findall(data)
    if len(found) != 1:
        raise BridgeError(f"Ambiguous {what}: {len(found)} matches")
    return found[0]


def derive_target(version, module, asset, asset_paths):
    """从未登记的原始模块推导指纹（derive CLI 与运行时自动补丁共用）。

    返回与人工登记条目同构的 dict（sha256 取当前模块，另带 derived 标记）；
    任何一项校验不过都抛 BridgeError，调用方按 fail-closed 处理。
    """
    if MARKER in module or b"getExistingConversationStore" in module:
        raise BridgeError("Bridge already present")
    registry, key, _param, _local = _only(AUTO_NAMES, module, "registry/key function")
    topic = _only(AUTO_TOPIC, module, "topic binding")
    session = _only(AUTO_SESSION, module, "SessionPane session attribute")
    if len({registry, key, topic, session}) != 4:
        raise BridgeError("Minified name collision")
    sid = module.index(b'"data-session-id":' + session + b"??`draft`")
    testid = AUTO_TESTID.search(module[:sid])
    if testid is None:
        raise BridgeError("Missing SessionPane testid anchor")
    anchor = testid.group(1) + b'"data-session-id":' + session + b"??`draft`,"
    if module.count(anchor) != 1:
        raise BridgeError("Missing or duplicate SessionPane anchor")
    candidates = []
    for header in AUTO_HEADER.finditer(module[:sid]):
        params = {}
        for name, var in AUTO_PANE_PARAM.findall(header.group(1)):
            if name.decode() in params:
                params = None
                break
            params[name.decode()] = var.decode()
        if params and len(params) == 4:
            candidates.append(params)
    if not candidates:
        raise BridgeError("Missing SessionPane component parameters")
    if len(candidates) != 1:
        raise BridgeError("Ambiguous SessionPane component parameters")
    pane = candidates[0]
    if len(set(pane.values())) != 4:
        raise BridgeError("Ambiguous SessionPane parameter aliases")
    if testid.group(2).decode() != pane["paneId"]:
        raise BridgeError("SessionPane testid pane argument mismatch")
    props = ("workspacePath:{workspacePath},workspaceIdentity:{workspaceIdentity},"
             "remoteSessionId:{remoteSessionId}").format(**pane).encode()
    if props not in module[max(0, sid - 4000):sid]:
        raise BridgeError("SessionPane scope props not passed from parameters")
    for method in (b"getState(){return this.state}", b"async connect(e={})"):
        if module.count(method) != 1:
            raise BridgeError("Unexpected session store shape")
    if b"this.closed=!0" not in module:
        raise BridgeError("Missing session store closed flag")
    reg = registry + b"."
    if module.count(reg + b"get(") < 1 or module.count(reg + b"delete(") < 1:
        raise BridgeError("Registry map usage missing")
    entry = (b"layer:new ", b"stale:!1", b"refCount:1")
    if not any(all(token in module[max(0, at - 600):at] for token in entry)
               for at in (m.start() for m in re.finditer(re.escape(reg + b"set("), module))):
        raise BridgeError("Unexpected registry entry shape")
    imports = []
    for segment, source in AUTO_IMPORT.findall(module):
        if re.search(rb"(?:^|,)[A-Za-z_$][\w$]* as " + re.escape(topic) + rb"(?:,|$)", segment):
            imports.append(source)
    if len(imports) != 1:
        raise BridgeError("Topic function is not a unique module import")
    try:
        source = imports[0].decode("ascii")
    except UnicodeDecodeError:
        raise BridgeError("Non-ASCII topic import source")
    if not source.startswith("./") or "/out/renderer/assets/" + source[2:] not in asset_paths:
        raise BridgeError("Topic import target missing from archive")
    if b"sourceMappingURL" in module:
        raise BridgeError("Unverified source map layout")
    return {"version": version, "asset": asset, "sha256": _digest(module),
            "names": {"key": key.decode(), "topic": topic.decode(), "registry": registry.decode()},
            "pane": dict(pane, anchor=anchor), "derived": True}


def _verify_auto_present(data):
    """表外版本的幂等判定：完整且唯一的桥块与属性串，否则视为不明补丁。"""
    if data.count(BEGIN) != 1 or data.count(END) != 1 or data.count(MARKER) != 2:
        raise BridgeError("Bridge markers tampered")
    start, end = data.index(BEGIN), data.index(END) + len(END)
    # 桥块总以 "\n" + BEGIN 开头、以 END + "\n" 结尾；不满足即不是本模板的补丁
    if start < 1 or data[start - 1:start] != b"\n" or data[end:end + 1] != b"\n":
        raise BridgeError("Bridge markers out of order or misaligned")
    if data.count(b"export function getExistingConversationStore(scope)") != 1:
        raise BridgeError("Bridge content tampered")
    if len(AUTO_PANE_ATTRS.findall(data)) != 1:
        raise BridgeError("Scope attributes tampered")


def _strip_auto_bridge(data):
    """表外版本的回滚路径：按模板剥离桥块与属性串，不依赖版本指纹。"""
    _verify_auto_present(data)
    start, end = data.index(BEGIN), data.index(END) + len(END)
    block = data[start:end]
    if b"__zusageGetExistingConversationStore" not in block:
        raise BridgeError("Bridge content tampered")
    # 两侧换行由 _verify_auto_present 保证；连换行一起剥离可精确复原原字节
    rest = data[:start - 1] + data[end + 1:]
    rest, removed = AUTO_PANE_ATTRS.subn(b"", rest)
    if removed != 1:
        raise BridgeError("Scope attributes tampered")
    if MARKER in rest or b"getExistingConversationStore" in rest:
        raise BridgeError("Bridge content tampered")
    return rest


def _read(stream, nodes, base, path):
    node = nodes.get(path)
    if not node or "offset" not in node or node.get("unpacked") or "link" in node:
        raise BridgeError(f"Missing packed file: {path}")
    stream.seek(base + int(node["offset"]))
    data = stream.read(node["size"])
    if len(data) != node["size"]:
        raise BridgeError(f"Truncated file: {path}")
    if "integrity" in node:
        integrity = node["integrity"]
        block = integrity.get("blockSize")
        if (integrity.get("algorithm") != "SHA256" or type(block) is not int or block <= 0 or
                integrity.get("hash") != _digest(data) or
                integrity.get("blocks") != [_digest(data[i:i + block])
                                           for i in range(0, len(data), block)]):
            raise BridgeError(f"Invalid integrity: {path}")
    return data


def transform_module(data, operation, target=None):
    """精确升级/移除桥和 DOM 属性；第三方尾缀仅在移除时保留。

    target 只在调用方已完成指纹校验（自动推导或已解析命中）时显式传入。
    """
    if operation not in ("patch", "remove"):
        raise BridgeError("Unknown operation")
    if target is None:
        target = target_for_module(data)
    if target is None:
        raise BridgeError("Unknown renderer asset hash")
    original, suffix = _original_module(data, target)
    if operation == "remove":
        return original + suffix
    if suffix:
        raise BridgeError("Unknown patched module suffix")
    anchor = target["pane"]["anchor"]
    return original.replace(anchor, anchor + pane_attributes(target), 1) + bridge_code(target)


def _resolve_target_from(package):
    """按 package.json dict 选目标；版本未登记即拒绝（fail-closed）。"""
    version = package.get("version")
    for target in HOST_TARGETS:
        if version == target["version"]:
            return target
    raise BridgeError(f"Unknown host version: {version}")


def _resolve_target(stream, nodes, base):
    """读 asar 的 package.json，按已登记版本选目标；版本未登记即拒绝。"""
    package = json.loads(_read(stream, nodes, base, "/package.json"))
    version = package.get("version")
    for target in HOST_TARGETS:
        if version == target["version"]:
            return target
    raise BridgeError(f"Unknown host version: {version}")


def _output_path(source, output):
    if Path(output).is_symlink():
        raise BridgeError("Output is a symlink")
    source, output = Path(source).resolve(), Path(output).resolve()
    roots = (WORKTREE.resolve(), Path(tempfile.gettempdir()).resolve())
    if source == output or not any(output.is_relative_to(root) for root in roots):
        raise BridgeError("Output must be a new worktree/temporary file, never an installation")
    # Even a copied application in the authorized roots is not an output target.
    if any(part.endswith(".app") for part in output.parts) or output.parent.name.lower() == "resources":
        raise BridgeError("Refusing application installation directory")
    if output.exists() or Path(output).is_symlink():
        raise BridgeError("Output already exists")
    if not output.parent.is_dir():
        raise BridgeError("Output directory does not exist")
    return source, output


def rewrite_asar(source, output, operation="patch"):
    """Copy the payload with one splice; preserve links, unpacked metadata and holes."""
    source, output = _output_path(source, output)
    before = asar.source_fingerprint(source)
    stage = None
    try:
        with source.open("rb") as stream:
            header, base = asar.read_header(stream)
            nodes = dict(asar.iter_files(header))
            package = json.loads(_read(stream, nodes, base, "/package.json"))
            if (package.get("name"), package.get("type")) != ("@zcode/desktop", "module"):
                raise BridgeError("Unknown host package")
            target = _resolve_target_from(package)
            asset_path = target["asset"]
            original = _read(stream, nodes, base, asset_path)
            if (b"sourceMappingURL" in original or any(
                    path in nodes for path in (asset_path + ".map", asset_path[:-3] + ".map"))):
                raise BridgeError("Unverified source map layout")
            modified = transform_module(original, operation)
            new_header = copy.deepcopy(header)
            new_nodes = dict(asar.iter_files(new_header))
            asset_node = nodes[asset_path]
            start, end = int(asset_node["offset"]), int(asset_node["offset"]) + asset_node["size"]
            payload_size = before["size"] - base
            delta = len(modified) - len(original)
            for path, node in nodes.items():
                if node.get("unpacked") or "link" in node or "files" in node:
                    continue
                offset, size = int(node["offset"]), node["size"]
                if offset < 0 or size < 0 or offset + size > payload_size:
                    raise BridgeError("Invalid packed file bounds")
                if path != asset_path and size and offset < end and offset + size > start:
                    raise BridgeError("Overlapping packed files")
                if offset >= end and path != asset_path:
                    new_nodes[path]["offset"] = str(offset + delta)
            new_nodes[asset_path]["size"] = len(modified)
            new_nodes[asset_path]["integrity"] = asar.compute_integrity(modified)
            encoded = json.dumps(new_header, ensure_ascii=False, separators=(",", ":")).encode()
            padded = (len(encoded) + 7) // 4 * 4
            fd, name = tempfile.mkstemp(prefix=".renderer-bridge-", dir=output.parent)
            stage = Path(name)
            with os.fdopen(fd, "wb") as dest:
                dest.write(struct.pack("<4I", 4, padded + 4, padded, len(encoded)))
                dest.write(encoded)
                dest.write(b"\0" * (padded - len(encoded) - 4))
                stream.seek(base)
                remaining = start
                while remaining:
                    chunk = stream.read(min(asar.BLOCK, remaining))
                    if not chunk:
                        raise BridgeError("Truncated payload")
                    dest.write(chunk)
                    remaining -= len(chunk)
                dest.write(modified)
                stream.seek(base + end)
                shutil.copyfileobj(stream, dest, asar.BLOCK)
                dest.flush()
                os.fsync(dest.fileno())
        if asar.source_fingerprint(source) != before:
            raise BridgeError("Source archive changed")
        # Exclusive publication: never overwrite an existing path, including races.
        os.link(stage, output)
        return output
    finally:
        if stage is not None:
            stage.unlink(missing_ok=True)


STALE_STAGE_SECONDS = 600


def _sweep_stale_stages(directory):
    """清掉早于 STALE_STAGE_SECONDS 的 .zusage-bridge-* 残留（调用方拿到
    replace-failed 后、publish_external_pending 前崩溃的孤儿）。刚创建的
    stage 处在移交窗口内，绝不能删。"""
    now = time.time()
    for stale in Path(directory).glob(".zusage-bridge-*"):
        try:
            if now - stale.stat().st_mtime > STALE_STAGE_SECONDS:
                stale.unlink()
        except OSError:
            pass


def ensure_deployed(asar_path):
    """插件安装/更新链专用：确认目标 asar 带桥，没有则就地补打。

    与 rewrite_asar（CLI/测试，只输出到工作区/临时目录）不同，本函数就是为写
    安装目录设计的：借用 patch_install 同一把 app.asar.zusage.lock 跨进程锁，
    输出临时文件在 asar 同目录后 os.replace 原子换。任何失败都不抛出——桥只是
    实时统计的增强，绝不影响安装/更新主流程。表内版本严格按指纹；表外版本
    先走 derive_target 的严格结构推导，校验不过按 fail-closed 跳过。返回状态：
      {"status": "patched"|"present"|"skipped-unknown"|"skipped-error",
       "version": <客户端版本>, "detail": <说明>}
    例外是发布被系统拒绝（Windows 客户端运行中持有 asar 不带 FILE_SHARE_DELETE、
    或目标目录 ACL 只读）：此时返回 replace-failed，stage 是已构建完整的带桥
    包、source 是发布前 asar 的指纹；调用方应转存待替换链
    （patch_install.publish_external_pending）或删除 stage，不能留在原地。
    """
    try:
        from runtime_lock import file_lock
        asar_path = Path(asar_path)
        with file_lock(asar_path.with_name(asar_path.name + ".zusage.lock")):
            _sweep_stale_stages(asar_path.parent)
            before = asar.source_fingerprint(asar_path)
            with asar_path.open("rb") as stream:
                header, base = asar.read_header(stream)
                nodes = dict(asar.iter_files(header))
                package = json.loads(_read(stream, nodes, base, "/package.json"))
                if (package.get("name"), package.get("type")) != ("@zcode/desktop", "module"):
                    raise BridgeError("Unknown host package")
                version = package.get("version")
                target = next((item for item in HOST_TARGETS if item["version"] == version), None)
                auto = target is None
                if not auto:
                    asset_path = target["asset"]
                    original = _read(stream, nodes, base, asset_path)
                    if MARKER not in original and _digest(original) != target["sha256"]:
                        return {"status": "skipped-unknown", "version": version,
                                "detail": "asset hash mismatch for pinned version (host build drift)"}
                else:
                    modules = {path: _read(stream, nodes, base, path) for path in
                               sorted(path for path in nodes if AUTO_ASSET_RE.fullmatch(path))}
                    marked = [path for path, data in modules.items() if MARKER in data]
                    if marked:
                        if len(marked) != 1:
                            return {"status": "skipped-unknown", "version": version,
                                    "detail": "bridged renderer asset is not unique"}
                        _verify_auto_present(modules[marked[0]])
                        # 其余资产只有在“确实可推导”时才是漏补的 live chunk；
                        # 不可推导的无关 styles-* 不能把幂等 present 变成跳过。
                        for path in modules:
                            if path in marked:
                                continue
                            try:
                                derive_target(version, modules[path], path, set(nodes))
                            except BridgeError:
                                continue
                            return {"status": "skipped-unknown", "version": version,
                                    "detail": "unpatched derivable renderer asset present"}
                        return {"status": "present", "version": version,
                                "detail": "auto-derived bridge already deployed"}
                    derived, errors = [], []
                    for path, data in modules.items():
                        if b"sourceMappingURL" in data or any(
                                sibling in nodes for sibling in (path + ".map", path[:-3] + ".map")):
                            errors.append(f"{path}: unverified source map layout")
                            continue
                        try:
                            derived.append(derive_target(version, data, path, set(nodes)))
                        except BridgeError as error:
                            errors.append(f"{path}: {error}")
                    if not derived:
                        return {"status": "skipped-unknown", "version": version,
                                "detail": "auto-derivation refused: " +
                                          ("; ".join(errors) or "no renderer styles asset")}
                    if len(derived) != 1:
                        return {"status": "skipped-unknown", "version": version,
                                "detail": "auto-derivation ambiguous across renderer assets"}
                    target = derived[0]
                    asset_path, original = target["asset"], modules[target["asset"]]
            _original_module(original, target)
            modified = transform_module(original, "patch", target)
            if modified == original:
                return {"status": "present", "version": version, "detail": "bridge already deployed"}
            fd, name = tempfile.mkstemp(prefix=".zusage-bridge-", dir=str(asar_path.parent))
            stage = Path(name)
            try:
                with os.fdopen(fd, "wb") as dest, asar_path.open("rb") as stream:
                    _rewrite_to(stream, base, nodes, header, asset_path, original, modified, dest)
                    dest.flush()
                    os.fsync(dest.fileno())
                if asar.source_fingerprint(asar_path) != before:
                    raise BridgeError("Source archive changed")
                os.chmod(stage, stat.S_IMODE(asar_path.stat().st_mode))
                try:
                    os.replace(stage, asar_path)
                except OSError as error:
                    # 发布被系统拒绝（客户端占用/目录只读）：stage 是完整可发布的
                    # 带桥包，移交给调用方转存待替换链，绝不静默丢弃（issue #67）。
                    handover = {"status": "replace-failed", "version": version,
                                "detail": str(error), "stage": str(stage), "source": before}
                    stage = None   # 已移交：finally 不得清理
                    return handover
                stage = None
            finally:
                if stage is not None:
                    stage.unlink(missing_ok=True)
        return {"status": "patched", "version": version,
                "detail": "auto-derived bridge deployed" if auto else "bridge deployed"}
    except PermissionError as error:
        # 权限不足要单独可辨：Windows 的 os.access 看不见 ACL（目录恒报可写），
        # 调用方只能按本标记给用户提权指引（issue #67 场景 1）
        return {"status": "skipped-error", "version": None, "detail": str(error),
                "permission": True}
    except Exception as error:  # 安装链的旁路增强：任何异常都只报告
        return {"status": "skipped-error", "version": None, "detail": str(error)}


def remove_deployed(asar_path):
    """卸载链对称清理：只剥离本项目的桥，其余内容不动。

    表内版本按指纹逐版本识别；表外版本（自动推导补的桥）按模板剥离桥块与
    属性串。与 ensure_deployed 同样的锁/原子替换/不抛出约定，状态 dict 同构：
    所有读取与判定都在锁内，发布前复核 source fingerprint，避免用锁外旧布局写坏归档。"""
    try:
        from runtime_lock import file_lock
        asar_path = Path(asar_path)
        with file_lock(asar_path.with_name(asar_path.name + ".zusage.lock")):
            before = asar.source_fingerprint(asar_path)
            with asar_path.open("rb") as stream:
                header, base = asar.read_header(stream)
                nodes = dict(asar.iter_files(header))
                package = json.loads(_read(stream, nodes, base, "/package.json"))
                version = package.get("version")
                target = next((item for item in HOST_TARGETS if item["version"] == version), None)
                auto = target is None
                if auto:
                    bridged = []
                    for path in sorted(path for path in nodes if AUTO_ASSET_RE.fullmatch(path)):
                        data = _read(stream, nodes, base, path)
                        if MARKER in data:
                            bridged.append((path, data))
                    if not bridged:
                        return {"status": "skipped-unknown", "version": version,
                                "detail": "host version not pinned; nothing to remove"}
                    if len(bridged) != 1:
                        return {"status": "skipped-unknown", "version": version,
                                "detail": "multiple bridged renderer assets"}
                    asset_path, original = bridged[0]
                    restored = _strip_auto_bridge(original)
                else:
                    asset_path = target["asset"]
                    original = _read(stream, nodes, base, asset_path)
                    if MARKER not in original:
                        return {"status": "absent", "version": target["version"], "detail": "no bridge present"}
                    restored = transform_module(original, "remove")
            fd, name = tempfile.mkstemp(prefix=".zusage-bridge-", dir=str(asar_path.parent))
            stage = Path(name)
            try:
                with os.fdopen(fd, "wb") as dest, asar_path.open("rb") as stream:
                    _rewrite_to(stream, base, nodes, header, asset_path, original, restored, dest)
                    dest.flush()
                    os.fsync(dest.fileno())
                if asar.source_fingerprint(asar_path) != before:
                    raise BridgeError("Source archive changed")
                os.chmod(stage, stat.S_IMODE(asar_path.stat().st_mode))
                os.replace(stage, asar_path)
                stage = None
            finally:
                if stage is not None:
                    stage.unlink(missing_ok=True)
        return {"status": "removed", "version": version,
                "detail": "auto-derived bridge removed" if auto else "bridge removed"}
    except Exception as error:
        return {"status": "skipped-error", "version": None, "detail": str(error)}


def _rewrite_to(stream, base, nodes, header, asset_path, original, modified, dest):
    """把单拼接结果写入 dest（调用方负责锁与原子发布）。"""
    before = {"size": None}
    new_header = copy.deepcopy(header)
    new_nodes = dict(asar.iter_files(new_header))
    asset_node = nodes[asset_path]
    start, end = int(asset_node["offset"]), int(asset_node["offset"]) + asset_node["size"]
    delta = len(modified) - len(original)
    for path, node in nodes.items():
        if node.get("unpacked") or "link" in node or "files" in node:
            continue
        offset, size = int(node["offset"]), node["size"]
        if path != asset_path and offset >= end:
            new_nodes[path]["offset"] = str(offset + delta)
    new_nodes[asset_path]["size"] = len(modified)
    new_nodes[asset_path]["integrity"] = asar.compute_integrity(modified)
    encoded = json.dumps(new_header, ensure_ascii=False, separators=(",", ":")).encode()
    padded = (len(encoded) + 7) // 4 * 4
    dest.write(struct.pack("<4I", 4, padded + 4, padded, len(encoded)))
    dest.write(encoded)
    dest.write(b"\0" * (padded - len(encoded) - 4))
    stream.seek(base)
    remaining = start
    while remaining:
        chunk = stream.read(min(asar.BLOCK, remaining))
        if not chunk:
            raise BridgeError("Truncated payload")
        dest.write(chunk)
        remaining -= len(chunk)
    dest.write(modified)
    stream.seek(base + end)
    shutil.copyfileobj(stream, dest, asar.BLOCK)


def derive_from_asar(source):
    """CLI 推导入口：读 asar 的渲染资产并返回可粘贴的条目。

    已带桥的安装也接受：先按指纹或标记还原原始模块再推导，维护者可直接对
    真机安装运行。"""
    with Path(source).open("rb") as stream:
        header, base = asar.read_header(stream)
        nodes = dict(asar.iter_files(header))
        package = json.loads(_read(stream, nodes, base, "/package.json"))
        if (package.get("name"), package.get("type")) != ("@zcode/desktop", "module"):
            raise BridgeError("Unknown host package")
        results, errors = [], []
        for path in sorted(path for path in nodes if AUTO_ASSET_RE.fullmatch(path)):
            data = _read(stream, nodes, base, path)
            if b"sourceMappingURL" in data or any(
                    sibling in nodes for sibling in (path + ".map", path[:-3] + ".map")):
                errors.append(f"{path}: unverified source map layout")
                continue
            if MARKER in data:
                try:
                    target = target_for_module(data)
                    data = (transform_module(data, "remove") if target is not None
                            else _strip_auto_bridge(data))
                except BridgeError as error:
                    errors.append(f"{path}: {error}")
                    continue
            try:
                results.append(derive_target(package.get("version"), data, path, set(nodes)))
            except BridgeError as error:
                errors.append(f"{path}: {error}")
    if not results:
        raise BridgeError("No derivable renderer asset: " + ("; ".join(errors) or "none"))
    if len(results) != 1:
        raise BridgeError("Ambiguous renderer assets for derivation")
    return results[0]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("patch", "remove", "derive"))
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path, nargs="?")
    args = parser.parse_args()
    try:
        if args.operation == "derive":
            print(repr(derive_from_asar(args.source)))
            return
        if args.output is None:
            parser.error("output is required for patch/remove")
        print(rewrite_asar(args.source, args.output, args.operation))
    except (BridgeError, OSError, KeyError, AssertionError, struct.error, ValueError) as error:
        parser.exit(1, f"renderer bridge refused: {error}\n")


if __name__ == "__main__":
    main()
