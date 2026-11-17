# 账号登录

`login` 动作让场景在录制前打开登录页、填写账号、提交，并等待明确的成功条件。
场景只保存账号 ID；用户名、选择器和密码环境变量保存在仓库外的本地账户文件中。

## 1. 创建账户文件

默认路径是 `~/.config/malo-browser/accounts.json`，可用
`MALO_BROWSER_ACCOUNTS` 指向其他位置。文件必须：

- 位于 git worktree 之外；loader 会拒绝仓库内路径
- 权限为 `0600`；group/world readable/writable 会直接失败
- 是普通文件，不是符号链接
- `origin` 与 `login_url` 必须同源
- `success_selector` 或 `success_url` 至少配置一个
- 只允许已知字段；明文 `password` 字段会被拒绝

```json
{
  "schema_version": 1,
  "accounts": {
    "work-demo": {
      "origin": "https://app.example.com",
      "login_url": "https://app.example.com/login",
      "username": "demo@example.com",
      "password_env": "WORK_DEMO_PASSWORD",
      "username_selector": "input[name=email]",
      "password_selector": "input[name=password]",
      "submit_selector": "button[type=submit]",
      "success_selector": "[data-testid=dashboard]"
    }
  }
}
```

```bash
install -d -m 700 ~/.config/malo-browser
chmod 600 ~/.config/malo-browser/accounts.json
```

密码只通过 `password_env` 指向的环境变量传入。不要写进场景、账户 JSON、
命令行参数或 shell 历史：

```bash
read -rs WORK_DEMO_PASSWORD
export WORK_DEMO_PASSWORD
export MALO_BROWSER_ACCOUNTS="$HOME/.config/malo-browser/accounts.json"
```

## 2. 在场景中登录

```yaml
steps:
  - id: sign-in
    action: login
    account_id: work-demo
    timeout_ms: 15000
```

`login` 按以下顺序执行，任一步失败都会停止：

1. 加载账户配置并解析 `password_env`
2. 确认登录地址在当前场景的 `allow` 安全边界内
3. 打开登录页，并在输入前再次核对页面来源
4. 等待用户名、密码和提交按钮可见
5. 通过真实鼠标/键盘事件填写并提交
6. 等待 `success_selector` 或 `success_url`

录制证据中的步骤详情固定为 `signed in with account "<account_id>"`。密码不会进入
场景变量、Runner 快照、SSE、错误详情或 evidence JSON；账户文件中的用户名和
`password_env` 也不会出现在步骤详情中。

## 3. 本地证明场景

仓库内置 `fixtures/scenes/login-demo`，使用真实 DOM 表单和 `demo://` 页面。
账户文件中的 `fixture` 项可以用以下值：

```json
{
  "schema_version": 1,
  "accounts": {
    "fixture": {
      "origin": "demo://scene/login-demo",
      "login_url": "demo://scene/login-demo/index.html",
      "username": "demo@example.test",
      "password_env": "MALO_BROWSER_FIXTURE_PASSWORD",
      "username_selector": "input[name=email]",
      "password_selector": "input[name=password]",
      "submit_selector": "button[type=submit]",
      "success_selector": "#signed-in"
    }
  }
}
```

```bash
MALO_BROWSER_ACCOUNTS=/path/outside/git/accounts.json \
MALO_BROWSER_FIXTURE_PASSWORD="fixture-only" \
npx electron . --mode=app --autorun=login-demo \
  --scenes=fixtures/scenes --out=evidence --headless=true
```

成功时 stdout 输出 `{"status":"passed",...}`，录制目录中的 evidence 包含：

```json
{
  "action": "login",
  "status": "passed",
  "detail": "signed in with account \"fixture\""
}
```

## 4. 失败排查

| 错误 / 现象 | 原因 | 修复 |
|---|---|---|
| `E_ACCOUNT_NOT_FOUND` | 账户文件不存在，或 `account_id` 不在文件中 | 检查 `MALO_BROWSER_ACCOUNTS` 与报错列出的 `available` ID |
| `E_ACCOUNT_INVALID` + `0600` | 文件权限过宽 | `chmod 600 <accounts.json>` |
| `E_ACCOUNT_INVALID` + `outside a git worktree` | 账户文件放在仓库内 | 移到 `~/.config/malo-browser/` 等仓库外位置 |
| `E_ACCOUNT_INVALID` + `same origin` | `origin` 与 `login_url` 不同源 | 使用目标站点的同一 origin；SSO 跳转当前不支持 |
| `E_ACCOUNT_INVALID` + `environment variable` | `password_env` 没有值 | 在启动 Electron 的同一 shell 中导出该变量 |
| `E_ACCOUNT_INVALID` + `moved from` | 登录页导航到了其他来源 | 检查重定向；动作会在输入任何凭据前停止 |
| `E_NAV_BLOCKED` | 登录页不在场景 `allow` 中 | 把登录页 origin 加入场景 `allow` |
| `E_STEP_TIMEOUT` / `E_SELECTOR_NOT_FOUND` | 字段或成功条件选择器不匹配 | 检查四个 selector；必要时改用 `success_url` |

当前边界：不处理 MFA、CAPTCHA、跨源 SSO 跳转、登录重试或多步验证码。每个账号只做
一次确定性尝试，不会因超时自动重复提交。
