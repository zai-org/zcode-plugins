"""deploy_website: 本地静态伺服。

- 首次 deploy 起一个 python http.server; 之后的 deploy **复用同一端口/URL**,
  只原地替换服务目录内容 —— 每次换端口都会迫使内置浏览器重新导航，
  一次修复迭代平白多 1-2 轮, 且旧 URL 上的浏览器状态全部作废
  (实测两条轨迹: 6 次 deploy 6 次输出完全相同的 visit)
- 重部署后返回稳定 URL；由 ZCode Browser Use 的现有 tab 执行 reload
- 服务的根目录就是 deploy 的 dist, 这样 HTML 里写的 `/assets/...` 等绝对路径不再 404
- 进程登记在 RunContext 上, 生命周期挂 MCP server 进程 (进程退出统一被清理)

website_version_manager 未迁移: CC 下版本管理用 git。
"""
from __future__ import annotations
import os
import re
import shutil
import socket
import subprocess
import time
import uuid
from pathlib import Path

from .run_context import RunContext

_DEPLOYED_KEY = "_deployed_servers"
START_PORT = 8765

# 匹配 build 产物里对本地图片资产的绝对引用 (/assets/foo.jpg 等)。
# 只认图片扩展名, 避免误伤 /assets/index-xxx.js 这类 bundle 自身。
_ASSET_REF_RE = re.compile(
    r"/assets/[\w\-./]+\.(?:png|jpe?g|gif|webp|svg|avif)", re.IGNORECASE)


def _scan_broken_assets(dst: Path) -> list[str]:
    """扫描已构建的 dist, 找出被引用但文件不存在的 /assets/... 图片路径。

    部署前资产自检: 模型常在 JSX 里写了 /assets/x.jpg 却没真放文件
    → 上线就是 broken <img>。public/ 下的资产 Vite 原样拷到 dist 根 (不 hash),
    所以字符串路径会原样留在 bundle/html/css 里, 直接 grep + 查文件存在即可。

    返回被引用但缺失的路径列表 (去重排序)。
    """
    refs: set[str] = set()
    scan_files = [dst / "index.html"]
    assets_dir = dst / "assets"
    if assets_dir.is_dir():
        for p in assets_dir.rglob("*"):
            if p.suffix.lower() in (".js", ".css", ".html"):
                scan_files.append(p)
    for f in scan_files:
        if not f.is_file():
            continue
        try:
            text = f.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        refs.update(_ASSET_REF_RE.findall(text))
    missing = [ref for ref in sorted(refs) if not (dst / ref.lstrip("/")).exists()]
    return missing


def _find_free_port(start: int = START_PORT) -> int:
    """让内核分配空闲端口 (bind 到 0). 并发安全 — 旧版 connect-探测在多 case
    并行时有 TOCTOU race: 两 worker 同时探到 8765 空闲都返回, 后启动的 bind 失败.

    start 参数保留兼容签名, 当前忽略 (内核从 ephemeral 段选).
    """
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _live_server(ctx: RunContext) -> dict | None:
    """最近一个进程还活着的已部署 server (本工作流一次只服务一个站点)。"""
    for d in reversed(getattr(ctx, _DEPLOYED_KEY, [])):
        if d["proc"].poll() is None:
            return d
    return None


def _last_server(ctx: RunContext) -> dict | None:
    """最近登记的 server, 不管进程死活。F10: 用于死进程原端口重启, 避免 URL 漂移。"""
    servers = getattr(ctx, _DEPLOYED_KEY, [])
    return servers[-1] if servers else None


def _spawn_httpd(dst: Path, port: int) -> subprocess.Popen:
    """起 http.server (allow_reuse_address 默认开, 原端口进程死后可立即重绑)。"""
    proc = subprocess.Popen(
        ["python3", "-m", "http.server", str(port), "--bind", "127.0.0.1"],
        cwd=str(dst),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    time.sleep(0.5)
    return proc


def _check_deploy_paths(dst: Path, src: Path) -> bool:
    """Return whether copying is needed; reject overlapping directory trees."""
    dst, src = dst.resolve(), src.resolve()
    if dst == src:
        return False
    if dst in src.parents or src in dst.parents:
        raise ValueError("local_dir and serving directory must not contain each other")
    return True


def _swap_dir_contents(dst: Path, src: Path) -> None:
    """原地替换 dst 的内容为 src 的内容。dst 目录本身保留 —— http.server 按
    启动时记录的路径字符串逐请求解析文件, 目录路径不变即无缝切到新构建。"""
    if not _check_deploy_paths(dst, src):
        return
    for child in dst.iterdir():
        if child.is_dir():
            shutil.rmtree(child)
        else:
            child.unlink()
    for item in src.iterdir():
        if item.is_dir():
            shutil.copytree(item, dst / item.name)
        else:
            shutil.copy2(item, dst / item.name)


def _auto_build_if_stale(dist: Path) -> str:
    """dist 落后于 src 时自动 `npm run build` 再部署。

    旧行为只在部署后警告 stale (模型再补一轮 build + 一轮 deploy); 直接修好
    把每次修复迭代的 build 轮省掉。返回值: "" (无需构建) / 提示文本 / "[ERROR]..."
    (构建失败, 调用方原样返回, 不部署旧构建误导验证)。V2C_DEPLOY_AUTOBUILD=0 关闭。"""
    if os.environ.get("V2C_DEPLOY_AUTOBUILD", "1") == "0":
        return ""
    if dist.name != "dist":
        return ""
    app = dist.parent
    src_dir = app / "src"
    if not (src_dir.is_dir() and (app / "package.json").is_file()):
        return ""
    try:
        dist_mtime = (max((f.stat().st_mtime for f in dist.rglob("*") if f.is_file()),
                          default=0.0) if dist.exists() else 0.0)
        newer = [f for f in src_dir.rglob("*")
                 if f.is_file() and f.stat().st_mtime > dist_mtime + 1.0]
    except OSError:
        return ""
    if not newer:
        return ""
    try:
        proc = subprocess.run(["npm", "run", "build"], cwd=str(app),
                              capture_output=True, text=True, timeout=240)
    except FileNotFoundError:
        return ""   # 无 npm 环境 — 退回部署后 stale 警告路径
    except subprocess.TimeoutExpired:
        return "[ERROR] auto-build 超时 (>240s): npm run build 未完成, 未部署。请手动构建排查。"
    if proc.returncode != 0:
        tail = ((proc.stdout or "") + "\n" + (proc.stderr or ""))[-1500:]
        return ("[ERROR] dist 落后于 src, 自动构建失败 — 未部署 (部署旧构建只会误导验证)。"
                f"修复构建错误后重新 deploy:\n{tail}")
    tail_lines = (proc.stdout or "").strip().splitlines()[-2:]
    return (f"\nℹ️ AUTO-BUILD: {len(newer)} 个 src/ 文件比 dist 新, 已自动 `npm run build` 后部署"
            + (("\n  " + " | ".join(tail_lines)) if tail_lines else ""))


def _scan_testids(dst: Path) -> list[str]:
    """dist 产物里扫 data-testid 常量 — 回执直接列出可用选择器, 验证/录像不用
    靠记忆或回头 grep 源码 (实测一次自遗忘 = 2 条废录像 + ~5 轮找名字)。"""
    ids: set[str] = set()
    pat = re.compile(r"data-testid[=:\"'\s]+[\"']?([A-Za-z0-9_-]+)")
    try:
        files = list(dst.rglob("*.js"))[:40] + list(dst.rglob("*.html"))[:10]
    except OSError:
        return []
    for f in files:
        try:
            ids.update(pat.findall(f.read_text(encoding="utf-8", errors="ignore")))
        except OSError:
            continue
    return sorted(ids)


def deploy_website(args: dict, ctx: RunContext) -> str:
    """首次 deploy 起 http.server; 后续 deploy 复用同端口, 原地替换内容。"""
    local_dir = args["local_dir"]
    type_ = args["type"]   # "static"
    src = ctx.resolve(local_dir)
    build_note = _auto_build_if_stale(src)
    if build_note.startswith("[ERROR]"):
        return build_note
    if not src.exists():
        return f"[ERROR] local_dir not found: {local_dir}"

    serve_root = ctx.work_dir / "serve"
    srv = _live_server(ctx)
    prev = _last_server(ctx) if srv is None else None
    slug = uuid.uuid4().hex[:10] if srv is None and prev is None else None
    dst = (srv or prev)["dst"] if srv or prev else serve_root / slug
    try:
        _check_deploy_paths(dst, src)
    except ValueError as exc:
        return f"[ERROR] {exc}; deployment unchanged. Use a separate build directory."
    serve_root.mkdir(parents=True, exist_ok=True)
    reused = srv is not None
    same_url = reused
    if reused:
        dst = srv["dst"]
        _swap_dir_contents(dst, src)
        port = srv["port"]
    else:
        if prev is not None:
            # F10: 上个 server 进程死了 → 原端口/原目录重启, URL 不漂移
            # (13 任务曾因死进程换新端口, agent 拿旧 URL 验证全失败)
            dst = prev["dst"]
            _swap_dir_contents(dst, src)
            port = prev["port"]
            prev["proc"] = _spawn_httpd(dst, port)
            same_url = True
        else:
            shutil.copytree(src, dst)

            # 选端口 (尽量避免和已 deploy 的撞)
            deployed = getattr(ctx, _DEPLOYED_KEY, [])
            occupied = {d["port"] for d in deployed}
            port = _find_free_port(START_PORT)
            while port in occupied:
                port = _find_free_port(port + 1)

            proc = _spawn_httpd(dst, port)
            deployed.append({"proc": proc, "port": port, "slug": slug, "dst": dst})
            setattr(ctx, _DEPLOYED_KEY, deployed)

    url = f"http://localhost:{port}/"

    # stale-dist 侦测: 改完 src 忘 rebuild 就 deploy 是高频高价事故 (实测一次烧 ~10 轮
    # 排查"修了没生效") — src 下有比 dist 更新的文件就当场提醒。只查客观 mtime, 不拦截。
    stale_note = ""
    src_dir = src.parent / "src"
    if src.name == "dist" and src_dir.is_dir():
        try:
            dist_mtime = max((f.stat().st_mtime for f in src.rglob("*") if f.is_file()),
                             default=0.0)
            newer = [f for f in src_dir.rglob("*")
                     if f.is_file() and f.stat().st_mtime > dist_mtime + 1.0]
            if newer:
                sample = ", ".join(str(f.relative_to(src_dir)) for f in newer[:5])
                stale_note = (
                    f"\n\n⚠️ STALE DIST — {len(newer)} 个 src/ 文件比 dist 构建产物更新"
                    f" (如 {sample})。你可能改了源码但没有 rebuild 就 deploy — 本次部署的是"
                    "旧构建。若确实有未构建的修改: 先 `npm run build` 再重新 deploy_website,"
                    " 不要基于本 URL 验证刚才的修改。")
        except Exception:
            pass

    body = (f"[deployed]\n"
            f"type: {type_}\n"
            f"local_dir: {local_dir}\n"
            f"served_from: {dst}\n"
            f"url: {url}"
            + (" (URL 不变 — 旧部署内容已原地替换)" if reused else "") + "\n"
            f"⚠️ server 挂在 MCP 服务进程里, 会话结束或进程被清理后 URL 失效")
    body += build_note
    if same_url:
        body += "\n[Browser Use] 已保留原 URL；在内置浏览器现有 tab 上 reload 后验证。"
    tids = _scan_testids(dst)
    if tids:
        body += ("\n[data-testid 清单] " + " ".join(tids[:40])
                 + (f" (+{len(tids) - 40} more)" if len(tids) > 40 else "")
                 + " — 录像/hover/click 选择器直接从这里取, 不要凭记忆猜")
    if args.get("need_screenshot"):
        body += ("\n[note] deploy_website 不再持有浏览器。请在同一轮用 ZCode Browser Use "
                 "reload，再调用 tab.screenshot()；settle 用 tab.playwright.waitForTimeout()。")
    body += stale_note

    # 部署前资产自检: 找出引用了但没真放文件的 /assets/ 图片 → broken <img>。
    # 提示给修复选项清单, 不指定唯一动作 (手段选择权归模型)。
    missing = _scan_broken_assets(dst)
    if missing:
        body += (
            "\n\n⚠️ BROKEN IMAGE ASSETS — these /assets/ paths are referenced but "
            "the files do NOT exist (they will render as broken images):\n"
            + "\n".join(f"  - {m}" for m in missing)
        )
        ctx.load_catalog()
        options = [
            "place a real file at that exact path under public/assets/ "
            "(draw it yourself: SVG/canvas/CSS), OR",
            "correct the src reference to a path that actually exists",
        ]
        if ctx.catalog:
            options.insert(0, "pick a matching image from the asset sheet and "
                              "get_asset(ref=...) it into public/assets/, OR")
        body += ("\nFix before considering the task done — any of:\n"
                 + "\n".join(f"  - {o}" for o in options)
                 + "\nThen rebuild + redeploy.")
    return body


def stop_all(ctx: RunContext) -> None:
    """收尾: 杀掉本 ctx 起的全部 http.server (MCP server 进程退出前调)。"""
    for d in getattr(ctx, _DEPLOYED_KEY, []):
        try:
            d["proc"].terminate()
        except Exception:
            pass
