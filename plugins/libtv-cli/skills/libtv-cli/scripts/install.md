# 一键安装 LibTV CLI（`libtv`）

**一键安装**脚本从官方静态站按本机平台下载对应的 zip，解压后把可执行文件安装到 **`~/.libtv`** 下的 **`libtv`**（Windows 为 **`libtv.exe`**）。

**一键安装**脚本路径：**`scripts/install-libtv-cli.sh`**（macOS / Linux）、**`scripts/install-libtv-cli.ps1`** 与 **`scripts/install-libtv-cli.bat`**（Windows）。

---

## 安装入口发现（activity 接口，权威来源）

最新版本号、各平台一键安装脚本 URL、skill 包 zip URL，统一由 www landing-activity 渠道接口下发，**直接取用字段里的完整 URL，不要再按 `…/cli/<version>/…` 自行拼接**（拼错版本段会和发布脱节）：

**`https://api2.liblib.art/api/www/landing-activities/getById?id=240`**

响应的 **`data.linkUrl`** 是一段 JSON 字符串，解析后形如：

```json
{
  "version": "1.0.2",
  "install": {
    "CMD": "https://liblibai-web-static.liblib.cloud/cli/latest/install-libtv-cli.bat",
    "PowerShell": "https://liblibai-web-static.liblib.cloud/cli/latest/install-libtv-cli.ps1",
    "shell": "https://liblibai-web-static.liblib.cloud/cli/latest/install-libtv-cli.sh"
  },
  "skill": "https://liblibai-web-static.liblib.cloud/cli/1.0.2/libtv-cli-skill.zip"
}
```

| 字段                 | 含义                                                         |
| -------------------- | ------------------------------------------------------------ |
| `version`            | 最新 CLI 版本号                                              |
| `install.shell`      | macOS / Linux 一键安装脚本 URL（`curl -fsSL <url> \| bash`） |
| `install.PowerShell` | Windows PowerShell 一键安装脚本 URL                          |
| `install.CMD`        | Windows cmd / 双击运行的 `.bat` URL                          |
| `skill`              | 该版本 skill 包（含本文档 + install 脚本）zip 的下载 URL     |

---

## 远端 zip（按平台分包，脚本内部行为）

install 脚本拿到 `version` 后，会按本机平台**在脚本内部**拼出 CLI 二进制 zip 的下载 URL 并拉取（这一段是脚本自己做，使用者无需关心）：

**`https://liblibai-web-static.liblib.cloud/cli/<version>/<zip>`**

其中 **`<version>`** 取自上面 activity 接口的 **`.version`**（脚本不再内置默认版本号，避免和发布脱节）。**`<zip>`** 按本机平台取：

| 平台                | 文件名                    |
| ------------------- | ------------------------- |
| macOS Apple Silicon | `libtv-macos-arm64.zip`   |
| macOS Intel         | `libtv-macos-x64.zip`     |
| Linux x86_64        | `libtv-linux-x64.zip`     |
| Linux arm64         | `libtv-linux-arm64.zip`   |
| Windows x86_64      | `libtv-windows-amd64.zip` |
| Windows arm64       | `libtv-windows-arm64.zip` |

**压缩包内容**：zip 根目录或任一子目录中需包含 **`libtv`** 或 **`libtv.exe`**；脚本解压后在临时目录中查找并复制到安装目录。

走下载需要 **`curl` 或 `wget`**（Windows 上由 PowerShell 的 `Invoke-WebRequest` 负责）；解压需要 **`unzip`**（Windows 上由 `Expand-Archive` 负责）。脚本**不会**用 **`rm`** 清理：解压目录与下载得到的临时 zip 会留在系统临时目录下，可自行删除；安装目标仍由 **`cp -f`（Windows `Copy-Item -Force`）覆盖**以便升级。

---

## macOS / Linux

```bash
chmod +x scripts/install-libtv-cli.sh
./scripts/install-libtv-cli.sh
```

默认安装到 **`~/.libtv/libtv`**。脚本会按 **`$SHELL`** 尝试检测 **`~/.zshrc`**、**`~/.zprofile`**、**`~/.bashrc`** 等（与 [nvm install.sh](https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh) 的 profile 检测类似），若找到且尚未写入过标记行，则**追加**一行 **`export PATH="<安装目录绝对路径>:$PATH"`**；未找到 profile 时只打印需自行追加的两行内容。新开终端或对该文件执行 **`source ~/.zshrc`**（路径以实际为准）后生效。

---

## Windows

在 **PowerShell** 中进入 skill 根目录后执行：

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\scripts\install-libtv-cli.ps1
```

或双击 / 在 cmd 中运行 **`scripts\install-libtv-cli.bat`**（内部仍调用 PowerShell）。

也可以不下载 skill 包，直接执行最新安装脚本——脚本 URL 取自上面 activity 接口的 **`install.PowerShell`** 字段（下例用的就是它当前的值）：

```powershell
Invoke-WebRequest `
  -Uri "https://liblibai-web-static.liblib.cloud/cli/latest/install-libtv-cli.ps1" `
  -UseBasicParsing | Invoke-Expression
```

默认安装到 **`%USERPROFILE%\.libtv\libtv.exe`**。若用户 PATH 中尚未包含 **`%USERPROFILE%\.libtv`**，脚本会**写入当前用户的 Path 环境变量**（需重开终端）。

---

## 更新 / 整目录替换 skill

每个版本的 skill 包（里面就是这套 install 脚本 + `SKILL.md` 等）的下载 URL 由 activity 接口的 **`skill`** 字段直接下发，**不要再手工拼 `…/cli/<version>/libtv-cli-skill.zip`**。

由于 `skill` 与 `version` 同出自一次 activity 响应，二者**天然同版本**：直接拿 `skill` 字段下载、整目录替换，再在该目录下执行 install 脚本（脚本会解析同一个 `version`），即可保证 `libtv` 与这套 skill 文档**版本一致**。

**步骤**：

1. 请求 **`https://api2.liblib.art/api/www/landing-activities/getById?id=240`**，解析 `data.linkUrl` JSON，取 **`skill`** 字段（zip URL）。
2. 下载该 `skill` zip。
3. **整体替换** skill 目录：先**删除**当前 skill 目录，再**新建**同名空目录、把 zip **解压进去**——目的是让 skill 目录与 zip 内容**严格 1:1**，**避免新版本里已删除的旧文件残留**（`unzip -o` / `Expand-Archive -Force` 都**只会覆盖同名文件**，不会清理旧版独有的文件）。
4. **`cd` 切到该 skill 目录**，在该目录下执行 install 脚本（`./scripts/install-libtv-cli.sh` 或 `.\scripts\install-libtv-cli.ps1`）。

> skill 目录里其它文件（`commands/` 等）也需与该版本严格一致，所以要**整目录替换**而非覆盖；skill 目录不应放任何用户私有文件（`.libtv/` 在 skill 目录的兄弟目录、不会被波及）。

```bash
# macOS / Linux：取 activity 下发的 skill zip URL，整目录替换并安装
SKILL_DIR=<你的 skill 目录>            # 即含 SKILL.md / scripts/ 的目录的绝对路径
LINK_URL="$(curl -fsSL 'https://api2.liblib.art/api/www/landing-activities/getById?id=240' \
  | tr -d '\\' | grep -oE '"skill"[[:space:]]*:[[:space:]]*"[^"]+"' | head -n1 | sed -E 's/.*"([^"]+)"[[:space:]]*$/\1/')"
curl -fL -o /tmp/libtv-cli-skill.zip "$LINK_URL"
rm -rf "$SKILL_DIR"                    # 删除旧 skill 目录，避免旧文件残留
mkdir -p "$SKILL_DIR"
unzip -q /tmp/libtv-cli-skill.zip -d "$SKILL_DIR"
cd "$SKILL_DIR"                        # 必须在该目录下执行 install 脚本
chmod +x scripts/install-libtv-cli.sh
./scripts/install-libtv-cli.sh
```

```powershell
# Windows：取 activity 下发的 skill zip URL，整目录替换并安装
$SkillDir = '<你的 skill 目录>'        # 即含 SKILL.md / scripts\ 的目录的绝对路径
$resp = Invoke-RestMethod -Uri 'https://api2.liblib.art/api/www/landing-activities/getById?id=240' -UseBasicParsing
$skillUrl = (ConvertFrom-Json $resp.data.linkUrl).skill   # 直接取 skill 字段，无需拼接
Invoke-WebRequest -Uri $skillUrl -OutFile $env:TEMP\libtv-cli-skill.zip
Remove-Item -Recurse -Force $SkillDir -ErrorAction SilentlyContinue  # 删除旧 skill 目录
New-Item -ItemType Directory -Path $SkillDir -Force | Out-Null
Expand-Archive -Path $env:TEMP\libtv-cli-skill.zip -DestinationPath $SkillDir -Force
cd $SkillDir                           # 必须在该目录下执行 install 脚本
.\scripts\install-libtv-cli.ps1
```

---

## 一键安装完成后

执行 **`libtv --help`**，并按 [SKILL.md](../SKILL.md) 中的 **`libtv login`** 完成登录。
