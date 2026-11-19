"""Offline mobile-relay stash injection: pinned fingerprints for the desktop main bundle.

桌面主进程 app.asar 的 out/main/index.js 里，webRemoteControlManager 创建桥接协议后
（Q.relayProtocol=Ce 赋值链）没有任何对外暴露点；mobile-relay 需要拿到
relayProtocol.protocol（AcknowledgedRelayProtocol 的合法 send/onMessage 入口，
seq/ack 语义归宿主协议栈）才能把用量 chips 推上官方中继。本模块按
MOBILE_RELAY_TARGETS 指纹表在锚点后注入一段逗号表达式，把
{p: <relay>.protocol, b: <bridge>} push 进 globalThis.__zusageRelayStash：
mobile-relay.cjs（主进程热换模块）消费 stash 推送，宿主 bundle 其余字节不动。

第二注入（uplink，specs/mobile-relay-uplink-binding.md）：把 transport options 的
onRawTransportPayload 箭头函数包一层——载荷带 zuUp 标记时推入
{frame: <原帧>, b: <当前桥>, relay: <该桥的 relayProtocol>} 并返回 true
（帧在 acceptPayload 严格 seq 校验之前被消费），其余帧原样走官方路径。

机制镜像 renderer_bridge.py：剥 patch_install 注入尾缀后按原始前缀 SHA256 校验、
表外版本走严格推导、asar 单拼接重写（offset 位移 + integrity 重算）、
同目录 stage + os.replace 原子替换、replace-failed 移交待替换链。
与 renderer_bridge 的差异：目标是主 bundle（会被 patch_install 追加尾缀，须兼容
有/无尾缀两种形态）；补丁是锚点处中段注入（非尾缀桥块）；remove 反向剥离注入即可。
补丁的存在不产生任何数据流（stash/队列无人生产即闲置），运行时开关由
mobile-relay.cjs 读 config 的 mobile_relay.enabled 控制，本模块不读配置。
"""
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
import time
from contextlib import nullcontext

import patch_install as asar

ASSET = "/out/main/index.js"
# 注入表达式（逗号表达式元素，求值后结果被丢弃）：stash 属宿主 bundle，本项目只 append。
STASH = "__zusageRelayStash"
# patch_install 的注入尾缀（entry 末尾 dynamic import 行）；剥掉后才是原始前缀。
_INJECT_TAIL_RE = re.compile(
    rb'\n;import\("[^"]*"\)\.then\(\(\) => null, \(e\) => console\.error\([^\n]*\);\s*$')
# 桥接创建点：bridge.relayProtocol=<sym>,bridge.disposeBridge=...（混淆名随版本轮换）
_ANCHOR_RE = re.compile(rb"\b(\w+)\.relayProtocol=(\w+),\1\.disposeBridge\b")
# 注入串自身即补丁标记（符号随锚点）；remove/检测按它定位，不依赖原始锚点连续存在
_INJECT_RE = re.compile(
    rb"\(globalThis\.__zusageRelayStash=globalThis\.__zusageRelayStash\|\|\[\]\)"
    rb"\.push\(\{p:(\w+)\.protocol,b:(\w+)\}\),")
# uplink 钩子原始锚点：onRawTransportPayload:s(ve=>Fg(ye,ve),"onRawTransportPayload")
# ——包装符号(s)/箭头参数(ve)/原调用(Fg)/运行时(ye)随版本轮换，稳定的是属性名与
# 字符串标签；body 必须恰为「单次调用」形态（3.18.1 实测），复杂化时 derive 拒绝。
_UPLINK_ANCHOR_RE = re.compile(
    rb'onRawTransportPayload:(\w+)\((\w+)=>(\w+)\((\w+),\2\),"onRawTransportPayload"\)')
# 两代必须匹配完整回调，避免将游离的中段误认为可安全剥离的补丁。
_UPLINK_V1_RE = re.compile(
    rb'onRawTransportPayload:(?P<w>\w+)\((?P<p>\w+)=>'
    rb'\((?P=p)&&(?P=p)\.zuUp\?\(\(globalThis\.'
    rb'__zusageRelayUplinkQueue=globalThis\.__zusageRelayUplinkQueue\|\|\[\]\)\.push\((?P=p)\),'
    rb'true\):0\)\|\|(?P<f>\w+)\((?P<r>\w+),(?P=p)\),"onRawTransportPayload"\)')
# v2 回调（新/旧代共用）：箭头体捕获一次桥并入队；差异只在属性值是否带代际 marker。
_V2_HEAD = rb'(?P<w>\w+)\((?P<p>\w+)=>'
_V2_VALUE = (
    rb'\((?P=p)&&(?P=p)\.zuUp\?\(\((?P<b>\w+)\)=>\(\(globalThis\.'
    rb'__zusageRelayUplinkQueue=globalThis\.__zusageRelayUplinkQueue\|\|\[\]\)\.push\('
    rb'\{frame:(?P=p),b:(?P=b),relay:(?P=b)\?(?P=b)\.relayProtocol:void 0\}\),true\)\)'
    rb'\((?P<r>\w+)\.currentBridge\):0\)\|\|(?P<f>\w+)\((?P=r),(?P=p)\)')
_V2_SUFFIX = rb',"onRawTransportPayload"\)'
# 新代在 transport options 构造时（announce / 首帧之前）于属性值内用逗号表达式写
# 代际 marker：onRawTransportPayload:(globalThis.__zusageRelayUplinkGeneration=2,<原包装>)。
# 已安装的旧 v2（无 marker）仍可识别、剥离与升级；两种形态起始字节不同，
# 不会互相嵌套命中。
UPLINK_GENERATION = 2
_UPLINK_GENERATION_MARKER = b"__zusageRelayUplinkGeneration"
_UPLINK_V2_RE = re.compile(rb'onRawTransportPayload:' + _V2_HEAD + _V2_VALUE + _V2_SUFFIX)
_UPLINK_V2_MARKED_RE = re.compile(
    rb'onRawTransportPayload:\(globalThis\.' + _UPLINK_GENERATION_MARKER
    + b"=" + str(UPLINK_GENERATION).encode() + b","
    + _V2_HEAD + _V2_VALUE + _V2_SUFFIX + rb'\)')
_ROUTE_RE = re.compile(
    rb'function (?P<f>\w+)\((?P<r>\w+),(?P<p>\w+)\)\{let (?P<b>\w+)=(?P=r)\.currentBridge;'
    rb'return!(?P=b)\|\|(?P=b)\.degraded\?!1:(?P=b)\.relayProtocol\?\.acceptPayload\((?P=p)\)\?\?!1\}')
_UPLINK_MARKER = b"__zusageRelayUplinkQueue"
_STASH_MARKER = STASH.encode()
# 指纹表（新→旧）：版本以 asar package.json 为准，SHA 是剥尾缀后的原始 bundle。
MOBILE_RELAY_TARGETS = [
    {
        "version": "3.18.1",
        "asset": ASSET,
        # 剥 patch_install 注入尾缀后的原始 bundle 指纹（以实测为准；尾缀差异
        # 不影响——校验永远发生在剥尾缀之后）
        "sha256": "9f414b7c9391de3a92d6373511df1374a6f270ae260ce802647ef0a05fe5cde8",
        "anchor": b"relayProtocol=Ce,Q.disposeBridge",
        "anchor2": b'onRawTransportPayload:s(ve=>Fg(ye,ve),"onRawTransportPayload")',
    },
]


class RelayPatchError(ValueError):
    pass


def _digest(data):
    return hashlib.sha256(data).hexdigest()


def _read(stream, nodes, base, path):
    node = nodes.get(path)
    if not node or "offset" not in node or node.get("unpacked") or "link" in node:
        raise RelayPatchError(f"Missing packed file: {path}")
    stream.seek(base + int(node["offset"]))
    data = stream.read(node["size"])
    if len(data) != node["size"]:
        raise RelayPatchError(f"Truncated file: {path}")
    return data


def inject_for(anchor):
    """锚点 → 注入表达式。锚点形如 relayProtocol=<r>,<b>.disposeBridge；
    注入串插在 `relayProtocol=<r>,` 之后，捕获 <r>.protocol 与 <b> 整体。
    两侧都必须显式 globalThis.：主 bundle 是 ESM（严格模式），对未声明标识符
    赋值会 ReferenceError 炸掉桥接创建点。"""
    m = re.fullmatch(rb"relayProtocol=(\w+),(\w+)\.disposeBridge", anchor)
    if not m:
        raise RelayPatchError("Malformed anchor")
    relay, bridge = m.group(1), m.group(2)
    g = b"globalThis." + STASH.encode()
    return b"(" + g + b"=" + g + b"||[]).push({p:" + relay + b".protocol,b:" + bridge + b"}),"


def inject_for_uplink(anchor2):
    """包裹原回调；一次捕获当前桥，保持帧、桥和 relay 的对象身份。

    整个属性值（原包装调用）被外层逗号表达式包裹：marker 在 transport options
    构造时立即求值，announce 与任何帧都发生在其后，消费者据此在首帧前确认代际。"""
    m = _UPLINK_ANCHOR_RE.fullmatch(anchor2)
    if not m:
        raise RelayPatchError("Malformed uplink anchor")
    head = b"onRawTransportPayload:"
    if not anchor2.startswith(head):
        raise RelayPatchError("Malformed uplink anchor")
    wrapper, param, _fn, runtime = m.groups()
    bridge = b"__zuBridge"
    while bridge in m.groups():
        bridge += b"_"
    arrow = head + wrapper + b"(" + param + b"=>"
    mid = (b"(" + param + b"&&" + param + b".zuUp?((" + bridge + b")=>(("
           b"globalThis.__zusageRelayUplinkQueue=globalThis.__zusageRelayUplinkQueue||[]).push("
           b"{frame:" + param + b",b:" + bridge + b",relay:" + bridge + b"?" + bridge
           + b".relayProtocol:void 0}),true))(" + runtime + b".currentBridge):0)||")
    wrapped = arrow + mid + anchor2[len(arrow):]
    return (head + b"(globalThis." + _UPLINK_GENERATION_MARKER + b"="
            + str(UPLINK_GENERATION).encode() + b"," + wrapped[len(head):] + b")")


def _injection_state(prefix):
    """只接受完整、唯一的已知指纹；未知或混合代际一律拒绝。"""
    stash = list(_INJECT_RE.finditer(prefix))
    uplinks = ([(1, m) for m in _UPLINK_V1_RE.finditer(prefix)]
               + [(2, m) for m in _UPLINK_V2_RE.finditer(prefix)]
               + [(2, m) for m in _UPLINK_V2_MARKED_RE.finditer(prefix)])
    if len(stash) > 1 or prefix.count(_STASH_MARKER) != 2 * len(stash):
        raise RelayPatchError("Unknown or duplicate stash inject")
    if len(uplinks) > 1 or prefix.count(_UPLINK_MARKER) != 2 * len(uplinks):
        raise RelayPatchError("Unknown or duplicate uplink inject")
    marked = len(_UPLINK_V2_MARKED_RE.findall(prefix))
    if prefix.count(_UPLINK_GENERATION_MARKER) != marked:
        raise RelayPatchError("Unknown or duplicate uplink generation marker")
    return stash[0] if stash else None, uplinks[0] if uplinks else None


def _strip_injects(prefix):
    """剥离已知两代注入，逐字节还原 pristine 前缀。"""
    stash, uplink = _injection_state(prefix)
    if uplink:
        _generation, match = uplink
        original = (b'onRawTransportPayload:' + match.group('w') + b'(' + match.group('p')
                    + b'=>' + match.group('f') + b'(' + match.group('r') + b','
                    + match.group('p') + b'),"onRawTransportPayload")')
        prefix = prefix[:match.start()] + original + prefix[match.end():]
    if stash:
        match = _INJECT_RE.search(prefix)
        prefix = prefix[:match.start()] + prefix[match.end():]
    return prefix


def _derive_uplink_anchor(prefix):
    """表外版本需唯一匹配回调及其读取 currentBridge 的原始路由函数。"""
    matches = list(_UPLINK_ANCHOR_RE.finditer(prefix))
    if len(matches) != 1:
        raise RelayPatchError("Uplink anchor not derivable (missing or ambiguous)")
    match = matches[0]
    routes = [route for route in _ROUTE_RE.finditer(prefix) if route.group('f') == match.group(3)]
    if len(routes) != 1:
        raise RelayPatchError("Uplink bridge route not derivable (missing or ambiguous)")
    return match.group(0)


def _split_tail(data):
    """剥 patch_install 注入尾缀（有则剥，无则原样）。返回 (前缀, 尾缀)。"""
    m = _INJECT_TAIL_RE.search(data)
    if not m:
        return data, b""
    return data[:m.start()], data[m.start():]


def transform_module(data, operation, target=None):
    """apply 升级旧代并补齐两段；remove 剥离已知注入并保留尾缀。"""
    if operation not in ("apply", "remove"):
        raise RelayPatchError("Unknown operation")
    prefix, tail = _split_tail(data)
    pristine = _strip_injects(prefix)
    if operation == "remove":
        return pristine + tail
    # 始终从 pristine 重建，避免旧代和新代叠加；两个锚点都必须唯一。
    anchor = (target or {}).get("anchor")
    if anchor is None:
        anchor = _derive_anchor(pristine)
    anchor2 = (target or {}).get("anchor2")
    if anchor2 is None:
        anchor2 = _derive_uplink_anchor(pristine)
    if pristine.count(anchor) != 1:
        raise RelayPatchError("Missing or duplicate relay anchor")
    if pristine.count(anchor2) != 1:
        raise RelayPatchError("Missing or duplicate uplink anchor")
    inject = inject_for(anchor)
    split = anchor.split(b",", 1)[0] + b","  # relayProtocol=<sym>,
    patched_anchor = split + inject + anchor[len(split):]
    result = pristine.replace(anchor, patched_anchor, 1)
    result = result.replace(anchor2, inject_for_uplink(anchor2), 1)
    return result + tail


def _derive_anchor(prefix):
    """表外版本的严格推导：全 bundle 唯一的 bridge.relayProtocol 赋值锚点。"""
    matches = _ANCHOR_RE.findall(prefix)
    if len(matches) != 1:
        raise RelayPatchError("Relay anchor not derivable (missing or ambiguous)")
    bridge, relay = matches[0]   # 捕获组1=桥接宿主对象（Q），组2=relay 协议实例（Ce）
    return b"relayProtocol=" + relay + b"," + bridge + b".disposeBridge"


def _resolve_target(package, data):
    """指纹表优先；表外版本推导锚点。已打补丁的资产先剥离两段注入得到原始前缀
    再做 SHA/锚点校验（注入恰好插在锚点中间，未剥离时锚点不连续）。"""
    version = package.get("version")
    prefix, _tail = _split_tail(data)
    pristine = _strip_injects(prefix)
    target = next((t for t in MOBILE_RELAY_TARGETS if t["version"] == version), None)
    if target is not None:
        if _digest(pristine) != target["sha256"]:
            raise RelayPatchError(f"asset hash mismatch for pinned version {version}")
        if pristine.count(target["anchor"]) != 1:
            raise RelayPatchError("Pinned anchor drift")
        if pristine.count(target.get("anchor2", b"\x00")) != 1:
            raise RelayPatchError("Pinned uplink anchor drift")
        return dict(target, derived=False)
    anchor = _derive_anchor(pristine)
    anchor2 = _derive_uplink_anchor(pristine)
    return {"version": version, "asset": ASSET, "anchor": anchor,
            "anchor2": anchor2, "derived": True}


def _rewrite_to(stream, base, nodes, header, asset_path, original, modified, dest):
    """单拼接重写：目标区间替换、后方 offset 位移、integrity 重算。"""
    new_header = copy.deepcopy(header)
    new_nodes = dict(asar.iter_files(new_header))
    asset_node = nodes[asset_path]
    start, end = int(asset_node["offset"]), int(asset_node["offset"]) + asset_node["size"]
    delta = len(modified) - len(original)
    payload_size = stream.seek(0, os.SEEK_END) - base
    for path, node in nodes.items():
        if node.get("unpacked") or "link" in node or "files" in node:
            continue
        offset, size = int(node["offset"]), node["size"]
        if offset < 0 or size < 0 or offset + size > payload_size:
            raise RelayPatchError("Invalid packed file bounds")
        if path != asset_path and size and offset < end and offset + size > start:
            raise RelayPatchError("Overlapping packed files")
        if offset >= end and path != asset_path:
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
            raise RelayPatchError("Truncated payload")
        dest.write(chunk)
        remaining -= len(chunk)
    dest.write(modified)
    stream.seek(base + end)
    shutil.copyfileobj(stream, dest, asar.BLOCK)


def _load(source):
    """打开 asar 并完成目标解析；返回重写所需全部上下文。"""
    stream = source.open("rb")
    try:
        header, base = asar.read_header(stream)
        nodes = dict(asar.iter_files(header))
        package = json.loads(_read(stream, nodes, base, "/package.json"))
        if (package.get("name"), package.get("type")) != ("@zcode/desktop", "module"):
            raise RelayPatchError("Unknown host package")
        original = _read(stream, nodes, base, ASSET)
        target = _resolve_target(package, original)
        if b"sourceMappingURL" in original or any(
                path in nodes for path in (ASSET + ".map", ASSET[:-3] + ".map")):
            raise RelayPatchError("Unverified source map layout")
        return stream, base, nodes, header, package, original, target
    except Exception:
        stream.close()
        raise


def rewrite_asar(source, output, operation="apply"):
    """CLI/测试用：产出新 asar 文件，绝不就地改（输出必须在临时目录/工作区）。"""
    source, output = Path(source), Path(output)
    if output.exists():
        raise RelayPatchError("Output already exists")
    before = asar.source_fingerprint(source)
    stream, base, nodes, header, _package, original, target = _load(source)
    stage = None
    try:
        modified = transform_module(original, operation, target)
        fd, name = asar.bounded_mkstemp(prefix=".mobile-relay-", dir=str(output.parent))
        stage = Path(name)
        with os.fdopen(fd, "wb") as dest:
            _rewrite_to(stream, base, nodes, header, ASSET, original, modified, dest)
            dest.flush()
            os.fsync(dest.fileno())
        if asar.source_fingerprint(source) != before:
            raise RelayPatchError("Source archive changed")
        os.chmod(stage, stat.S_IMODE(source.stat().st_mode))
        os.link(stage, output)
        return {"status": "patched" if operation == "apply" else "removed",
                "version": target.get("version"), "detail": "ok", "output": str(output)}
    finally:
        if stage is not None:
            stage.unlink(missing_ok=True)
        stream.close()


_STALE_SECONDS = 600


def _sweep_stale_stages(directory):
    now = time.time()
    for stale in Path(directory).glob(".mobile-relay-*"):
        try:
            if now - stale.stat().st_mtime > _STALE_SECONDS:
                stale.unlink()
        except OSError:
            pass


def ensure_deployed(asar_path, _locked=False, _cli_safe=False):
    """安装/更新链专用：确认目标 asar 带 stash 注入，没有则就地补打。

    与 renderer_bridge.ensure_deployed 同款约定：patch_install 同一把
    app.asar.zusage.lock 跨进程锁、同目录 stage + os.replace 原子替换、
    任何失败只报告不抛出（本注入是 mobile-relay 的增强，绝不影响安装主流程）。
    replace-failed 时移交 stage 给待替换链（调用方转存或删除）。
    """
    stage = None
    stream = None
    try:
        from runtime_lock import file_lock
        asar_path = Path(asar_path)
        with (nullcontext() if _locked else file_lock(asar_path.with_name(asar_path.name + ".zusage.lock"))):
            before = asar.source_fingerprint(asar_path)
            stream, base, nodes, header, package, original, target = _load(asar_path)
            version = package.get("version")
            modified = transform_module(original, "apply", target)
            stream.close()   # Windows：replace 前必须释放源句柄
            stream = None
            if modified == original:
                return {"status": "present", "version": version, "detail": "stash already deployed"}
            if not _cli_safe:
                _sweep_stale_stages(asar_path.parent)
            fd, name = asar.bounded_mkstemp(prefix=".mobile-relay-", dir=str(asar_path.parent))
            stage = Path(name)
            with os.fdopen(fd, "wb") as dest, asar_path.open("rb") as rstream:
                _rewrite_to(rstream, base, nodes, header, ASSET, original, modified, dest)
                dest.flush()
                os.fsync(dest.fileno())
            if asar.source_fingerprint(asar_path) != before:
                raise RelayPatchError("Source archive changed")
            os.chmod(stage, stat.S_IMODE(asar_path.stat().st_mode))
            try:
                os.replace(stage, asar_path)
            except OSError as error:
                handover = {"status": "replace-failed", "version": version,
                            "detail": str(error), "stage": str(stage), "source": before}
                stage = None   # 已移交，finally 不得清理
                return handover
            stage = None
        return {"status": "patched", "version": target.get("version"),
                "detail": "derived stash deployed" if target.get("derived") else "stash deployed"}
    except PermissionError as error:
        return {"status": "skipped-error", "version": None, "detail": str(error), "permission": True}
    except Exception as error:  # 旁路增强：任何异常都只报告
        return {"status": "skipped-error", "version": None, "detail": str(error)}
    finally:
        if stream is not None:
            stream.close()
        if _cli_safe and stage is not None:
            try:
                stage.unlink(missing_ok=True)
            except OSError:
                pass


def apply_cli(asar_path):
    """Apply under the target lock without consuming any existing pending state."""
    from runtime_lock import file_lock
    path = Path(asar_path)
    pending = path.with_name("app.asar.zusage.tmp")
    try:
        with file_lock(path.with_name(path.name + ".zusage.lock")):
            for candidate in (pending, pending.with_name(pending.name + ".json")):
                try:
                    candidate.lstat()
                except FileNotFoundError:
                    continue
                return {"status": "deferred", "detail": "existing pending operation"}
            result = ensure_deployed(path, _locked=True, _cli_safe=True)
            if result.get("status") == "replace-failed":
                try:
                    Path(result["stage"]).unlink(missing_ok=True)
                except OSError as error:
                    return {"status": "deferred", "detail": f"stage cleanup failed: {error}"}
                return {"status": "deferred", "version": result.get("version"),
                        "detail": result.get("detail")}
            return result
    except TimeoutError as error:
        return {"status": "deferred", "detail": str(error)}
    except OSError as error:
        return {"status": "skipped-error", "detail": str(error)}


def check_deployed(asar_path):
    """只读自检：patched（两段均为当前代）/partial（缺段或旧代）/absent/error。
    marked 字段区分新代（transport 构造时写代际 marker）与已安装的旧 v2；
    旧 v2 仍按 patched 报告，下一次 apply 会原地升级为 marked v2。"""
    try:
        asar_path = Path(asar_path)
        stream, _base, _nodes, _header, package, original, target = _load(asar_path)
        stream.close()
        prefix, _tail = _split_tail(original)
        stash, uplink = _injection_state(prefix)
        stash_present = bool(stash)
        generation = uplink[0] if uplink else None
        marked = bool(uplink and uplink[1].re is _UPLINK_V2_MARKED_RE)
        if stash_present and generation == 2:
            status = "patched"
        elif stash_present or uplink:
            status = "partial"
        else:
            status = "absent"
        return {"status": status, "stash": stash_present, "uplink": bool(uplink),
                "uplink_generation": generation, "marked": marked,
                "version": package.get("version"),
                "derived": bool(target.get("derived")), "detail": "ok"}
    except Exception as error:
        return {"status": "error", "version": None, "detail": str(error)}


def remove_deployed(asar_path, _locked=False):
    """卸载链对称清理两段已知注入，其余字节（含第三方尾缀）不动。

    `_locked=True` 与 ensure_deployed 同语义：调用方已持有目标 asar 锁。
    任何失败只报告不抛出，并清理由本次创建的 stage（不碰其他调用留下的）。"""
    stage = None
    stream = None
    try:
        from runtime_lock import file_lock
        asar_path = Path(asar_path)
        with (nullcontext() if _locked else file_lock(asar_path.with_name(asar_path.name + ".zusage.lock"))):
            before = asar.source_fingerprint(asar_path)
            stream, base, nodes, header, _package, original, target = _load(asar_path)
            modified = transform_module(original, "remove", target)
            stream.close()   # Windows：replace 前必须释放源句柄
            stream = None
            if modified == original:
                return {"status": "absent", "version": target.get("version"), "detail": "nothing to remove"}
            fd, name = asar.bounded_mkstemp(prefix=".mobile-relay-", dir=str(asar_path.parent))
            stage = Path(name)
            with os.fdopen(fd, "wb") as dest, asar_path.open("rb") as rstream:
                _rewrite_to(rstream, base, nodes, header, ASSET, original, modified, dest)
                dest.flush()
                os.fsync(dest.fileno())
            if asar.source_fingerprint(asar_path) != before:
                raise RelayPatchError("Source archive changed")
            os.chmod(stage, stat.S_IMODE(asar_path.stat().st_mode))
            os.replace(stage, asar_path)
            stage = None
        return {"status": "removed", "version": target.get("version"), "detail": "ok"}
    except Exception as error:
        return {"status": "error", "version": None, "detail": str(error)}
    finally:
        if stream is not None:
            stream.close()
        if stage is not None:
            try:
                stage.unlink(missing_ok=True)
            except OSError:
                pass


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("command", choices=("check", "apply", "remove", "rewrite"))
    parser.add_argument("--asar", required=True)
    parser.add_argument("--output", help="rewrite 命令的目标路径（须不存在）")
    args = parser.parse_args(argv)
    if args.command == "check":
        print(json.dumps(check_deployed(args.asar), ensure_ascii=False))
        return 0
    if args.command == "rewrite":
        if not args.output:
            parser.error("rewrite requires --output")
        print(json.dumps(rewrite_asar(args.asar, args.output,
                                      "apply"), ensure_ascii=False))
        return 0
    fn = apply_cli if args.command == "apply" else remove_deployed
    print(json.dumps(fn(args.asar), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
