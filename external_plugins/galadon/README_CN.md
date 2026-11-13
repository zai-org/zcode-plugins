# Galadon

面向 agent 工程的五阶段循环：

```text
Spec -> Build -> Verify -> Ship -> Learn
```

Galadon 初始化一个最小工程阵地，然后让 agent 每次只做当前阶段。内核只认阶段、
产物和门禁；其余全部是端口：

| 端口 | 作用 | 参考实现 |
|---|---|---|
| `RolePort` | 谁来做 | `solo` |
| `TemplatePort` | 写哪份 `docs/profile.md`；代码骨架由 `--layout`/`--stack` 决定 | `web`、`api`、`static` |
| `DeployPort` | 构建、迁移、发布、探活、回滚 | `local`、`ssh` |

内置实现只是例子。项目可以替换任意端口，不需要改五阶段循环。

## 安装

插件自带 skill 和 CLI，装插件即可，不需要额外步骤。

```bash
# DeepSeek Harness
dsh plugin --profile headless add <路径或仓库>

# ZCode
zcode plugins install galadon@<marketplace>

# Codex
codex plugin add galadon@<marketplace>
```

工作区里 agent 直接用插件自带的 `bin/galadon`。自己想用 CLI 时，可以调
插件目录下的 `bin/galadon`，或：

```bash
pip install <插件目录>   # 或 pipx install <插件目录>
```

依赖 Python 3.10+ 与 `PyYAML`。

## 快速开始

```bash
galadon init --template api --role solo   # 空目录；非空目录加 --force
galadon next                              # 当前阶段 + 一个下一步
```

之后交给 agent：它读 `galadon.yaml`，只做当前阶段，跑 `galadon check`，
直到循环走到 `learn`。默认 `none` 版式下，第一道门是 spec：`init` 写入的
`spec/spec.md` 是 TODO 存根，所以在写完它之前 `check` 报
"spec/spec.md still contains TODO"。`init` 同时故意把 `checks.build` 与
`checks.test` 留空，所以 spec 写完后 `check` 会响亮失败并提示
"no checks configured — declare checks.build/checks.test"，直到声明真实命令；
非 `none` 版式则自带填好的 spec 与真实检查命令（见下文）。

## 版式（Layouts）

`init --layout` 补的是「一个工程内部怎么分层」：这套层从三个互不相关的真实
生产项目里抽出，默认 `none` 保持 0.2.x 行为：只生成基础模板，不做版式契约校验。

| 版式 | 适用 | 生成 |
|---|---|---|
| `none`（默认） | 只要五阶段循环 | 基础模板 |
| `webapp` | 前后端一体的产品 | `server/`、`src/`（python 栈）、`web/`、`e2e/`、`tests/`、`scripts/`、`deploy/`、`openspec/`、`spec/{spec.md,INDEX.md,TESTING.md,CONSTITUTION.md,domains/}`、`wiki/{knowledge,progress,runbook}/`、`.agents/`、`config.md` |
| `service` | 纯后端或定时任务 | `server/`、`src/`（python 栈）、`tests/`、`scripts/`、`deploy/`、`openspec/`、`spec/{spec.md,INDEX.md,TESTING.md,CONSTITUTION.md,domains/}`、`wiki/{knowledge,progress,runbook}/`、`.agents/`、`config.md` |
| `plugin` | 可分发 agent 插件 | `bin/<project>`、`src/<project>/`、`skills/<project>/`、`docs/`、`tests/`、`scripts/`、`openspec/`、`spec/{spec.md,INDEX.md,TESTING.md,CONSTITUTION.md,domains/}`、`wiki/{knowledge,progress,runbook}/`、`.agents/`、`config.md` |

`python` 栈另外生成 `src/<package>/` 代码根；`node` 栈把入口放在
`server/index.js`（`webapp`、`service`）或 `src/index.js`（`plugin`），所以
`webapp`、`service` 在 `node` 栈下没有 `src/`。

每个非 `none` 版式还带 `spec/` 真值层：`INDEX.md`（活的功能索引）、
`domains/README.md`（每个领域一份行为契约）、`TESTING.md`（改动到检查的触发
矩阵）、`CONSTITUTION.md`（硬规则）。这四个文件只在
`templates/layouts/_shared/` 存一份，先于各版式自己的 `common/` 层渲染，所以
版式可以覆盖，而 `none` 保持不变。跨版式逐字节相同的文件也只在 `_shared/` 存
一份（`.agents/` 槽位与 README、`wiki/`、`openspec/`、`scripts/` 的 README、
`.gitignore`、`openspec/config.yaml`）；不同的那几个由 `plugin` 保留自己的版本。

`--stack` 决定代码骨架与真实检查命令：

| 栈 | build | test |
|---|---|---|
| `python`（默认） | `python3 -m compileall -f -q src server`；plugin 为 `src` + `bash -n bin/<project>` | `python3 -m unittest discover -s tests -v` |
| `node` | `node --check <版式入口>`；plugin 为 + `bash -n bin/<project>` | `npm test`（`node --test tests/`） |
| `none` | — | — |

非 `none` 版式配 `--stack python|node` 时自带至少一个真跑的测试，`init` 完
`galadon check` 就是绿的；`--stack none` 没有检查命令，会响亮失败；
build 会编译/语法校验版式交付的每个源码根目录，并对 plugin 的 bash wrapper
用 `bash -n`（两种栈都覆盖），入口文件写坏会直接失败而不是假绿。
同时校验目录契约：`AGENTS.md`、`openspec/config.yaml`、`spec/INDEX.md`、
`spec/domains/`、`spec/TESTING.md`、`spec/CONSTITUTION.md`、`wiki/` 三个目录、
`.agents/` 六个槽位、非空 checks、`.gitignore` 里的 `out/` 与 `.agents/`——
缺项直接失败并点名。模板里 `.agents/` 存成 `__agents__/`（本仓库 gitignore 了
`.agents/`），渲染时映射回来。

`galadon.yaml` 的 `paths:` 迁移阶段产物（`spec`、`evidence`、`retro`、`release`）。
缺省值与 0.2.x 完全一致；版式把 retro 放到 `wiki/progress/retro.md`，因为 retro
属于短期进度，不属于长期知识层。

```bash
galadon init --layout webapp --stack node --template web
galadon init --list-layouts        # 稳定输出：版式与栈
```

## 命令

```bash
galadon init --template web --role solo
galadon init --layout webapp --stack python --template web
galadon next
galadon check
galadon new
galadon bootstrap --env test
galadon ship --env test
galadon teardown --env test --yes
```

`ship` 没有真实探针就不算成功。生产发布必须在当前会话显式加 `--yes-prod`。
`new` 把上一轮的 checks 与 release 记录归档到 `.galadon/history/`，回到 `build`
开始下一轮。

## 远程部署

`deploy.adapter: ssh` 把产物发到一台跑 systemd + 反向代理的机器：多版本目录、
原子切换 `current`/`previous`、部署锁、按 commit 校验的 JSON 探针。

```yaml
deploy:
  adapter: ssh
  env: test
  build: "mkdir -p dist && cp server.py dist/ && git rev-parse --short HEAD > dist/commit.txt"
  probe_url: "https://demo.example.com/health.json"
  probe_expect: "{{COMMIT}}"
  artifact: "dist"
  options:
    host: 203.0.113.10
    user: root
    remote_root: /srv/demo
    service: demo
    domain: demo.example.com
    listen: 127.0.0.1:18790
    exec_start: "/usr/bin/python3 /srv/demo/current/server.py"
    caddy_block: demo
```

`bootstrap` 负责系统用户、发布目录、systemd unit 和带 marker 的反代 block
（改前备份、`caddy validate` 失败即恢复）。`teardown --yes` 只删除还带
bootstrap marker 的远端目录。

`deploy.adapter: local` 使用同一套发布树，根目录为 `deploy.options.root`
（默认 `.galadon/deploy`）：`releases/<时间戳>-<版本>`、原子切换 `current`、
保留 `previous`、独占 `shared/deploy.lock`。锁被占用时拒绝发布；探针失败时
把 `current` 恢复到 `previous` 并重新探针，然后以非零退出并指明当前在线的版本。

## 副作用

指向重要机器之前请先读这一段。

- `bootstrap` 会在远端写入：系统用户（`options.manage_user: false` 可关闭）、
  `<remote_root>/{releases,shared}`、systemd unit，以及反代配置里一个带 marker 的
  block。改反代配置前先备份，`caddy validate` 不过就恢复且不 reload。
- `ship` 写入不可变发布目录、原子切换 `current` 并保留 `previous`；`ssh`
  适配器还会重启服务。随后探活；探活失败自动回滚到 `previous`、重新探针并以
  非零退出。
- `teardown --yes` 删除 unit、marker block、发布目录和系统用户；远端目录必须
  仍带 bootstrap 写的 marker 才会执行。
- 所有远端写操作先打印目标；`--env prod` 还必须同一次调用带 `--yes-prod`。

## 边界

- `DeployPort` 目前只有 `local` 与 `ssh`（systemd + Caddy）。`k8s` 只有声明，
  调用即 fail-loud。
- `ssh` 适配器假定目标机有 root 权限、`rsync`、`flock`、`systemctl`。
- 反代块依赖名为 `access_log` 的 Caddy snippet；没有这个 snippet 的机器需要自己
  实现一个 `DeployPort`。
- `ssh` 适配器要求探针返回带 `commit` 字段的 JSON，且与本次构建一致；`local`
  适配器要求配置 `deploy.probe_expect` 并精确比较：JSON 响应体里的 `commit`
  字段必须与之相等，非 JSON 响应体必须与之完全相等。

## 设计约束

- 一个阶段只有一个产物和一个门。
- 内核不 import SSH、Kubernetes、Jira 或通知 SDK。
- 六环是 `RolePort` 的预设，不是内核。
- git 内容不能给生产发布授权。
- 失败必须响亮；不静默兜底，不把部分成功说成成功。

## 开发

```bash
PYTHONPATH=src python3 -m galadon --help
python3 -m unittest discover -s tests -v
node --test tests/test_plugin.mjs
```
