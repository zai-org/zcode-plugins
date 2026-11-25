#!/usr/bin/env python3
"""SessionStart: 依赖检查 + 插件路径通告 + webapp 模板后台预热。

stdout 会进入会话上下文, 这里输出:
- 插件根路径 (web-replicate 脚本调用要用, 同时落 .v2c/plugin_root 文件);
- 缺失依赖清单 (只报不阻塞 — 让模型/用户知道哪些工具会不可用) + 指向 env-setup skill;
- 模板预热状态 (未预热则后台启动 relink --prepare-only, 不阻塞会话启动)。

依赖清单本身不在这里维护: 从 env-setup skill 的 env_doctor.py 取 cheap 检查项
(毫秒级、无子进程无网络), 两处各写一份必然漂移。
"""
from __future__ import annotations
import hashlib
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hook_common import project_dir  # noqa: E402

PLUGIN_ROOT = Path(os.environ.get("CLAUDE_PLUGIN_ROOT")
                   or Path(__file__).resolve().parents[1])
DOCTOR = PLUGIN_ROOT / "skills" / "env-setup" / "scripts" / "env_doctor.py"


def check_deps() -> tuple[list[str], str]:
    """→ (缺失项列表, 异常说明)。异常说明非空时表示体检本身没跑起来。"""
    sys.path.insert(0, str(DOCTOR.parent))
    try:
        from env_doctor import cheap_missing  # noqa: PLC0415
    except Exception as e:
        return [], f"环境体检脚本不可用 ({DOCTOR}): {type(e).__name__}: {e}"
    return cheap_missing(), ""


def prepare_template() -> str:
    """webapp node_modules 预热: 在本地快盘建 master 缓存 (relink --prepare-only)。

    不在插件目录 npm install — 插件目录可能落在慢盘或网络盘上, 装+拷 800M 小文件
    要几十分钟; relink 的 master 缓存本来就落 NM_LOCAL_ROOT (/tmp/webapp-node-modules),
    直接对着模板目录的 package.json 预热即可 (--prepare-only 只读 package.json/lock,
    不写模板目录), init-webapp 时 relink 自动命中。"""
    scripts = PLUGIN_ROOT / "skills" / "web-replicate" / "scripts"
    tpl_dir = PLUGIN_ROOT / "skills" / "web-replicate" / "templates" / "default" / "template"
    pkg_path = tpl_dir / "package.json"
    nm_root = Path(os.environ.get("NM_LOCAL_ROOT", "/tmp/webapp-node-modules"))
    if not pkg_path.is_file():
        return f"⚠️ 模板缺失: {pkg_path}"
    # 就绪判断必须精确到当前模板 package.json 的哈希 — "存在任意 master 即就绪"
    # 会在模板依赖变更后放过旧 master, init 时哈希不匹配走 delta 重建 (inode 事故链一环)
    pkg_hash = hashlib.md5(pkg_path.read_bytes()).hexdigest()[:12]
    if nm_root.is_dir() and (nm_root / f"master-default-{pkg_hash}").is_dir():
        return "webapp node_modules master 缓存已就绪 (package.json 哈希精确匹配)"
    lock = nm_root / ".preparing"
    if lock.exists():
        # 陈锁自愈: 锁里是后台预热 bash 的 pid, 进程已死说明上次预热被杀
        # (rm -f lock 没跑到), 不清掉会让所有后续会话永远停在"预热进行中"。
        try:
            os.kill(int(lock.read_text().strip()), 0)
            return "webapp node_modules master 预热进行中 (后台)"
        # Windows 上 os.kill(pid, 0) 对死 pid 抛 OSError(WinError 87)，
        # 不是 POSIX 的 ProcessLookupError；只捕后者会让每个会话首轮都崩。
        except (ValueError, OSError):
            lock.unlink(missing_ok=True)
    nm_root.mkdir(parents=True, exist_ok=True)
    log_path = nm_root / "prepare.log"
    script = (f"TEMPLATE_NAME=default bash {scripts / 'relink-node-modules.sh'} "
              f"{tpl_dir} --prepare-only >{log_path} 2>&1; "
              f"rm -f {lock}")
    proc = subprocess.Popen(["bash", "-c", script], start_new_session=True,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    lock.write_text(str(proc.pid))
    return (f"webapp node_modules master 未就绪, 已后台预热 (日志 {log_path}); "
            "init-webapp.sh 前若仍未完成, 首次 init 会现场冷启动 (较慢)")


def main() -> None:
    pd = project_dir()
    v2c = pd / ".v2c"
    v2c.mkdir(parents=True, exist_ok=True)
    (v2c / "plugin_root").write_text(str(PLUGIN_ROOT))

    lines = [f"[video2code] plugin_root: {PLUGIN_ROOT}",
             f"[video2code] webapp init 脚本: {PLUGIN_ROOT}/skills/web-replicate/scripts/init-webapp.sh"]
    missing, err = check_deps()
    if err:
        lines.append(f"[video2code] ⚠️ {err} — 依赖状态未知, 跑任何流程前先人工体检")
    elif missing:
        # 只报不阻塞, 但必须给出下一步动作: 这里只跑了毫秒级项 (没探测
        # registry 通不通), 所以指向 env-setup 做全量体检+安装, 而不是
        # 让模型对着这行自己猜装什么。
        lines.append("[video2code] ⚠️ 缺失依赖: " + "; ".join(missing))
        lines.append("[video2code] → 装之前先 Skill(env-setup): 全量体检（含 registry 连通性）"
                     " + 逐项修复命令；缺 mcp/ffmpeg 时部署或视频工具不可用，浏览器录制走 ZCode 内置 Browser Use")
    lines.append(f"[video2code] {prepare_template()}")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
