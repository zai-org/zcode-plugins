# PR 自动评审协议（独立第二通道）

> 版本（批 172）。来源：super-agent 采用工程实战（REGRESS-2026-169/170，
> 2026-11-02 沙箱首飞 PR#6）+ 官方 auto-merge 安全模型的替代设计（其模型
> 依赖 GitHub 分支保护，私有仓无 Pro 不可用——本协议以自家门禁链替代）。
> 本文是 PR 自动评审的**唯一属主文档**：评审自动化 prompt 与本协议冲突时，
> 以本文为准并回写 prompt。

一句话原则：**评审者与执行者分权，机器只裁"验证完备+判据相符"，
模糊一律升级人类，拒绝权永远留人。**

## 为什么需要独立评审

super-agent 的 worker 已经受提交门禁约束（测试绿才能 commit）——但那是
执行者**自环境**的验证。独立评审补三件事：①hermetic 复核（全新 clone
重跑测试，防环境漂移与自报失真）；②需求保真度的机器可判部分（清单验收
判据逐条对照 diff 与测试证据）；③把"合并"这个不可逆动作的决定权放在
执行体之外的第二通道。

## 评审协议（给评审 agent 的教程）

对注册表（见下节）中每个仓库的每张 `state=open` 且作者为该仓 agent 账号
的 PR，**顺序执行六步判据**。任何一步失败或模糊 → 该 PR 进入升级态，
不再继续后续步骤（早停省算力）。

1. **【边界】** PR 的 diff 文件集必须 ⊆ PR 内所含清单（`.regress/manifests/
   *.md`，随 PR 提交）的 `planned_changes` ∪ `.regress/**`（治理产物自身
   允许入 diff）。同时逐文件对照该仓 `.regress/config.json` 的
   `boundary.forbidden`——触禁改区即失败。PR 内无清单 = 升级（不是拒绝：
   可能是清单缺失的流程违规，让人裁）。
2. **【体量·记录性】** `gh pr diff <N>` 总行数（增+删）对照该仓
   `pr_review.max_diff_lines`（缺省 200）。**2026-11-02 人类策略升级
   （不冲突默认合并）：本判据降级为记录性——超限不拦截、不升级，仅在
   合并 subject 与 journal 事件里注明**。阻断判据见决策段。
3. **【描述】** PR body 需含该仓 `pr_review.require_pr_sections` 的每一段
   （缺省：背景/改动/验证）。缺段 = 升级。
4. **【验证·hermetic 重跑】** 不信 PR 描述里的"测试已过"：
   ```
   TMP=$(mktemp -d /tmp/prrev-XXXX)
   git clone --quiet https://github.com/<repo>.git $TMP/repo
   git -C $TMP/repo fetch --quiet origin pull/<N>/head && git -C $TMP/repo checkout --quiet FETCH_HEAD
   python3 ~/.zcode/regress-guard-hooks/lib/test_runner.py $TMP/repo
   rm -rf $TMP   # 用后即清
   ```
   退出码 0 且 JSON `status=passed` 才算过（test_runner 自动探测
   jest/vitest/pytest/mvn/gradle/go，timeout/parallel 读该仓 .regress 配置
   ——与提交门禁同一事实源）。失败/超时 = 升级。
5. **【判据】** 读 PR 内清单的验收要点/EARS 行，逐条对照 diff 与第 4 步
   测试结果找证据。**任一条找不到可对应的证据，或判据本身含糊到无法
   机械对照 = 升级**。此步禁止发挥想象补证据。
6. **【人类信号】** `gh pr view <N> --json reviews`：存在
   `CHANGES_REQUESTED` 状态的 review → 不动该 PR，升级。

**决策（不冲突默认合并，2026-11-02 起）**：**阻断项**=①边界、③描述、
④hermetic 测试、⑤判据对照、⑥人类信号，外加 mergeable≠MERGEABLE——
阻断项全过即**默认合并**（`gh pr merge <N> --merge --subject
"auto-review: passed …"`，体量超限时 subject 附注明）；任一阻断项失败或
模糊 → 升级（单条 chat 推送：PR 链接+卡在哪条判据）。体量②为记录性
判据不阻断。**没有自动拒绝态**：机器不合时只升级，关闭/拒绝由人执行。

**红线**：永不 force push；永不操作注册表之外的仓库；token 永不回显；
不创建/修改/删除任何定时任务；同轮多 PR 的升级合并为一条推送；每张 PR
的判定（六步逐项结果）落 `journal add pr_review` 事件；任何工具连续失败
×2 → 停手记 backlog。

## 项目接入指南（适配不同项目）

新项目接入 = 三步，全部缺省可推导：

1. **注册**：工作区 `.regress/pr-review-repos.json` 数组加一行
   `{"repo": "<owner>/<name>", "agent_login": "<agent 账号>", "since": "<接入日>"}`。
   评审自动化只认这张表——不在表里的仓永不触碰。
2. **仓内配置（可选）**：目标仓 `.regress/config.json` 加 `pr_review` 块：
   `{"max_diff_lines": 200, "require_pr_sections": ["背景","改动","验证"],
   "agent_login": "..."}`——全缺省时用上文缺省值。**测试命令零配置**：
   test_runner 按仓自动探测（pytest/jest/vitest/npm-test/mvn/gradle/go）。
3. **worker 侧约定**：目标仓 `AGENTS.md` 按 regress-sandbox 模板写机器通道
   协议（立 in-progress 清单+验收判据 EARS 化+PR 描述三段+行尾套件计数）
   ——评审六步的判据原料全部来自 worker 按协议产的清单与描述。

## 接入专题（批175 补）

**双分支仓（开发/发布分流）**：默认分支应设为**开发分支**（如 dev）——
super-agent 的 worktree 基线与 CI 观察都锚定 origin/HEAD，默认分支若为
发布分支（main），agent 会基于过时基线工作制造冲突风暴。发布门
（dev→main 的合并）永远由人把持，评审自动化不触碰。

**`pr_review.test_cmd` 覆盖**：多项目仓/非标测试栈（test_runner 自动探测
不可用）在仓 `.regress/config.json` 声明 `pr_review.test_cmd`——评审 ④
在 hermetic clone 内执行该命令（shell 语义），exit 0=过，输出尾行进
journal 作证据。未声明则维持 test_runner 自动探测。**计数口径（批177）**：
test_cmd 输出尾行若非 `{passed,total}` JSON（如 pnpm 多步链），④与合并
主题行标 **`exit0`**（以 exit code 为准的诚实口径）而非误导性的 `-1/-1`；
⑤的"全绿"措辞行在此口径下仍按 exit code 对账。

**治理随仓分发模式**（worker 的 hermetic clone 里守卫由此生效）：
- 提交 `.regress/config.json`（执行阀/禁改区/pr_review 配置）与
  `.regress/manifests/`（工单清单随 PR 入库）进仓
- `.gitignore` 排除 `.regress/` 运行态（journal/history/test-cache/
  .expect-commit/tmp/ 等）——配置与清单入库，状态留本地

## 验收要点

- When 评审自动化处理一张 agent PR，Then 阻断项（边界/描述/hermetic/
  判据对照/人类信号）逐条执行且结果逐项落 journal（pr_review 事件），
  任一阻断项失败即停后续步骤；体量超限只记录不阻断。
- When hermetic 重跑，Then 必须是全新 clone + PR head 检出，
  通过与否以 test_runner 退出码与 JSON 为准，不以 PR 描述自报为准。
- When 阻断项全过且 mergeable，Then 默认合并（subject 带 auto-review
  审计前缀）；任一失败或模糊，Then 只升级不拒绝，升级推送单条合并。
- When 影子模式（前两轮），Then 全协议执行+落账+推送建议，但绝不 merge。
- 来源与证据链：本协议每条判据的形态先例见 decisions.md 2026-11-02
  各条目（首飞 PR#6 三拦三修、PR#8 冲突恢复环、PR#16 新策略首例
  hermetic 418/418=判据有效性的实证底）。

## 边界（不做）

- 不判断"需求值不值得做"（人在 issue 里已经裁过）——只判"实现验证完备
  且与清单判据相符"。
- 不替代分支保护（私有仓不可用）：本协议是应用层闸门，不是 GitHub 层
  的强制状态检查。
- 不自动关闭/拒绝 PR；不处理冲突状态（mergeable=false 的 PR 直接升级）。
- 评审自动化不修改 super-agent 服务与其 prompts（分权：它只读 PR 面）。

## 事件化架构（批174，v2.7.4）

机械层与判断层分离，触发源可替换：

```
PR 事件 ──> 触发源（当前=每 3 分钟 systemd timer 兜底扫描 pr_gate --sweep；
            未来=GitHub webhook 经 VPS 中继，pr_gate 入口不变）
      ──> pr_gate.py 机械全判据（零 LLM：①③④⑤机械化⑥）
            ├─ 全过 + auto-merge 档 ──> 合并+关单+journal(pr_review mode:machine)+WeCom 推送
            └─ 红/含糊 ──> 升级评论+journal+推送（人裁；LLM 判断层量大再议）
```

**⑤判据机械化口径**（保守，"该升不升"=假阴性通道）：清单验收行含已验
标记（门禁盖过 ✅/已验）=过；含 N/N 且与 hermetic 结果一致=过、不一致=
矛盾升级；含"全绿/全过"且测试全过=过；**其余一律含糊升级不猜**。

**仓级分档 `pr_review.mode`（舰队化）**：`auto-merge`（缺省，阻断项全过
即合并）/ `human-merge`（机械全过也只评论建议，人执行合并）/
`review-only`（只落账不评论）。配置随仓分发（.regress/config.json），
评审器从 hermetic clone 读权威值。

## 修订说明

- 2026-11-02 批172 建立：六步判据+两态决策+影子模式纪律+三步接入指南，
  随沙箱 PR#6/7 狗粮校准。

- 2026-11-02 批173：合并策略升级（人类口谕"不冲突默认合并"）——体量②降级
  记录性，决策改阻断项表述；阻断=边界/描述/hermetic/判据对照/人类信号/冲突。

- 2026-11-02 批174：事件化架构（机械层 pr_gate 产品化+3 分钟 timer 兜底
  +⑤判据机械化+仓级分档）；webhook（秒级）列 Phase 2（需 VPS 入站中继，
  现 VPS 仅出网代理）。
