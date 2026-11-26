# Galadon

面向 agent 工程的五阶段循环：

```text
Spec -> Build -> Verify -> Ship -> Learn
```

Galadon 初始化一个最小工程阵地，然后让 agent 每次只做当前阶段。内核只认阶段、
产物和门禁；其余全部是端口：

| 端口 | 作用 | 内置实现 | 由谁替换 |
|---|---|---|---|
| `RolePort` | 谁来做 | `solo`、`six-ring`、`orchestrator` | `ports.role` |
| `TemplatePort` | 模板树：profile 与版式骨架 | profile `web`、`api`、`static` | `ports.template` |
| `DeployPort` | 构建、迁移、发布、探活、回滚 | `local`、`ssh` | `ports.deploy` |

项目在 `galadon.yaml` 里替换端口，不动五阶段循环（见[端口](#端口)）。

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

工作区里 agent 直接用插件自带的 `bin/galadon`；以 zip 安装的插件不带可执行位，
此时用 `bash bin/galadon` 运行。自己想用 CLI 时，可以调插件目录下的
`bin/galadon`，或：

```bash
pip install <插件目录>   # 或 pipx install <插件目录>
```

依赖 Python 3.10+ 与 `PyYAML`。

## 快速开始

```bash
galadon init --template api --role solo   # 空目录；非空目录加 --force，只补缺、不覆盖
galadon next                              # 当前阶段 + 一个下一步
```

`init` 从不覆盖：目录里已有的文件原样保留并列出来，所以对有历史的项目用
`--force` 也是安全的。

之后交给 agent：它读 `galadon.yaml`，只做当前阶段，跑 `galadon check`，
直到循环走到 `learn`。默认 `none` 版式下，第一道门是 spec：`init` 写入的
`spec/spec.md` 是 TODO 存根，所以在写完它之前 `check` 报
"spec/spec.md still contains TODO"。`init` 同时故意把 `checks.build` 与
`checks.test` 留空，所以 spec 写完后 `check` 会响亮失败并提示
"no checks configured — declare checks.build/checks.test"，直到声明真实命令；
非 `none` 版式则自带填好的 spec 与真实检查命令（见下文）。

## 门禁

`next` 给出一个阶段和一个动作，`check` 跑当前这道门；`ship` 在构建、在碰任何
主机**之前**，只要下面任一条成立就拒绝：

- 这轮已经发布过：写 retro，或跑 `galadon new`；
- 工作区有未提交或未跟踪的改动（git 答不上话算出错，不算干净）；
- spec 里 `## Acceptance` 下还有没勾的验收项；
- 目标是受保护环境，却没带 `--yes-prod`。

一次绿色的 `check` 绑定在它当时验证的 commit 与未提交文件上。之后再改项目，
`next` 会把你退回 `verify`；把 check 过的内容原样提交不算改动。没有 git 管理
的项目不做绑定。

`ship --dry-run` 打印计划，以及真发布会被拒绝的全部原因；它不跑检查、不写任何
东西。`check` 失败时会打印失败命令的 stderr，而不只是退出码。

`galadon new` 把检查记录、发布记录和 retro 一起归档，所以下一轮有自己的
`learn` 阶段。

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
`.agents/`），渲染时映射回来。同一份 `.gitignore` 让这些槽位进不了任何 clone，
所以 `next`、`check`、`ship` 会把缺的槽位补建出来，并在 stderr 上说明。

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

`ship` 没有真实探针就不算成功。受保护环境必须在同一次调用里带 `--yes-prod`。
`new` 把上一轮的 checks、release 记录与 retro 归档到 `.galadon/history/`，回到
`build` 开始下一轮。

## 多环境

`deploy.envs` 给每个环境一份自己的目标与探针，`--env` 选其一；`deploy.env` 是
默认环境。环境可以覆盖除 `adapter` 以外的任意 deploy 设置；`options` 按键合并。

```yaml
deploy:
  adapter: ssh
  env: test
  artifact: dist
  probe_expect: "{{COMMIT}}"
  options:
    service: demo
    run_user: demo
    exec_start: "/usr/bin/python3 /srv/demo/current/server.py"
  envs:
    test:
      options: {host: test.example.com, remote_root: /srv/demo}
      probe_url: "https://test.example.com/health.json"
    prod:
      options: {host: demo.example.com, remote_root: /srv/demo}
      probe_url: "https://demo.example.com/health.json"
```

点名一个没定义的环境会报错，所以发布记录不会再记在一个根本没发过去的目标上。
名字以 `prod` 开头的环境受保护，设了 `protected: true` 的也一样；对它发布、
bootstrap 或 teardown，都必须在同一次调用里带 `--yes-prod`。

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

`ssh` 适配器的 `deploy.options`：

| 选项 | 含义 |
|---|---|
| `host`、`user`、`remote_root`、`service` | 必填：发到哪、重启哪个服务 |
| `domain`、`listen`、`exec_start`、`caddy_block` | `bootstrap` 必填 |
| `run_user`（默认 `galadon`）、`manage_user`（默认 `true`） | 服务账号 |
| `environment_file` | 目标机上的绝对路径，写进 unit 的 `EnvironmentFile=` |
| `remote_migrate` | 在目标机、新版本目录内、切换 `current` 之前执行的命令；失败则 `current` 不动 |
| `keep_releases`（默认 `5`） | 除在线版与上一版外保留的版本数；`0` 表示全留 |
| `search_index`（默认 `false`） | `true` 去掉 `noindex` 头和 `robots.txt` 屏蔽 |
| `probe_ready_seconds`（默认 `15`） | 探针等服务起来的最长时间 |

`keep_releases` 与 `probe_ready_seconds` 对 `local` 同样生效。`deploy.migrate`
在发版的这台机器上执行；`options.remote_migrate` 在目标机上执行——数据库迁移
属于后者。

探针会等服务起来：连接被拒，以及反代在上游重启期间回的 502/503/504，都会在
`probe_ready_seconds` 内重试。其他任何 HTTP 状态都是终局，并且仍必须带上本次
构建的 commit。

`deploy.adapter: local` 使用同一套发布树，根目录为 `deploy.options.root`
（默认 `.galadon/deploy`）：`releases/<时间戳>-<版本>`、原子切换 `current`、
保留 `previous`、独占 `shared/deploy.lock`。锁被占用时拒绝发布；探针失败时
把 `current` 恢复到 `previous` 并重新探针，然后以非零退出并指明当前在线的版本。
两个适配器对「失败的正是首个版本」的处理一致：没有可恢复的上一版，所以摘掉
`current`（`ssh` 还会停服务），并在发布记录里写明。

## 端口

```yaml
ports:
  role: "team.roles:Pair"        # 提供 assign(phase) -> 角色名列表
  template: "./scaffold"         # 模板树：base/、profiles/、layouts/
  deploy: "team.deploy:Nomad"    # 一个 DeployPort
```

每项都指向项目内的代码或模板。指向类时由 Galadon 实例化。`DeployPort` 需提供
`describe`、`build`、`migrate`、`release`、`probe`、`rollback`、`bootstrap`、
`teardown` 和 `name`；`preflight` 可选。`RolePort` 需提供 `assign(phase)`。模板根
可以增加 profile，`--template` 随之接受。`k8s` 仍只是声明、没有实现：接一个就
走这条路。

## 副作用

指向重要机器之前请先读这一段。

- `bootstrap` 会在远端写入：系统用户（`options.manage_user: false` 可关闭）、
  `<remote_root>/{releases,shared}`、systemd unit，以及反代配置里一个带 marker 的
  block。改反代配置前先备份，`caddy validate` 不过就恢复且不 reload。除非设了
  `options.search_index: true`，否则每个受管站点都对搜索引擎隐藏（`noindex` 加
  全站 disallow 的 `robots.txt`）。
- `ship` 写入不可变发布目录、原子切换 `current` 并保留 `previous`；`ssh`
  适配器还会重启服务。随后探活；探活失败回滚到 `previous`、重新探针并以非零退出；
  若是首个版本则改为摘掉 `current`。切换成功后，删除超出 `options.keep_releases`
  的最旧版本，在线版与上一版永不删除，并在发布记录里列出。
- `teardown --yes` 删除 unit、marker block、发布目录和系统用户；远端目录必须
  仍带 bootstrap 写的 marker 才会执行。
- 所有远端写操作先打印目标；受保护环境还必须在同一次调用里带 `--yes-prod`。

## 边界

- `DeployPort` 目前只有 `local` 与 `ssh`（systemd + Caddy）。`k8s` 只有声明，
  调用即 fail-loud。
- 仅支持 macOS 与 Linux：适配器依赖 `fcntl` 与 `/bin/sh`。
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
- `galadon.yaml` 只由一个加载器解释：不认识的键是错误，该有值却留空的键也是。

## 开发

```bash
PYTHONPATH=src python3 -m galadon --help
python3 -m unittest discover -s tests -v
node --test tests/test_plugin.mjs
```
