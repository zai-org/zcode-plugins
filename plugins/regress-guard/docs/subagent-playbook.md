# 子代理实现手册（肌肉记忆移植版）

> 用途：把主会话 ~20 批（v1.66→v1.85）攒下的流程纪律与已知坑移交给并行子代理。
> 你（子代理）领到一份清单（.regress/manifests/REGRESS-2026-0XX-*.md），按本手册
> 实现到自测通过为止；**集成阶段（git/门禁/发布/清单盖章）回主会话串行**。
> 每条坑都带标本出处——不是风格偏好，是真实翻过车的地方。

## 一、你的边界纪律（先读这个）

1. **不跑任何 git 写命令**（add/commit/push/amend 都不行）——门禁是 PreToolUse
   钩子，git 提交会被拦；集成是主会话的活。
2. **不改 .regress/manifests/ 下任何文件**——清单由主会话管理（指纹守卫会拦外部改动）。
3. **只实现 + 自测**：自测 = 跑你自己批的测试文件（`python3 -m pytest tests/test_<你的>.py -q`），
   **不跑全量**——全量留给主会话门禁（有缓存也只在同树时才命中）。
4. 只动清单 `planned_changes` 声明的文件；要扩界就停下来报告，别绕（边界守卫会拦，
   拦了就是拦了）。
5. 复用既有接口前**先读它的函数签名**（见坑 #7）。

## 二、实现阶段已知坑（按踩坑频率排序）

### #1 指纹守卫：Read→Edit→Read→Edit（两连 Edit 必翻车）
对同一文件连续两次 Edit，第二次必被 🪞 拦（"文件指纹不匹配"）——第一次 Edit
本身就让读取态过期。纪律：每次 Edit 前重 Read 目标段落。
标本：074 pre_commit_guard.py 两连 Edit；run4-6 每批至少一次。

### #2 锚点不中：别盲猜，Read 实文
Edit 的 old_string 必须逐字符匹配（含缩进）。不中时禁止基于记忆改拼——Read
目标行区间，按实文重写锚点。**行号会漂**（别的钩子/会话改过文件），记忆里的
行号只当近似值。
标本：073 post_install_check 101/104 行"戳"字混合，两次不中后 Read 实文才落。

### #3 gen_reference 顺序：加完所有测试文件之后、跑全量之前
`python3 scripts/gen_reference.py` 从测试目录推导计数写 README 派生区。顺序
错了 `test_check_passes_on_fresh_generation` 会真红（它抓的是真实计数漂移，
不是误报——074 又验证了一次）。
标本：074 加 `test_key_staged_equals_unstaged` 后忘了重新 gen，全量 1 failed。

### #4 git 三步分立 + 被拦重试必须重新 add
复合命令（add 与 commit 串在一起）会被 PreToolUse 拦截，**整条没跑**但
你以为是 add 成了 commit 没成——暂存悄悄丢失。纪律：暂存 → `git status --short`
核对 → 提交，三个独立 Bash 调用。**被拦后重试尤其危险**：重试命令必须重新
暂存并重新 status 验证——077 标本：重试只跑提交命令，提交里只剩旧暂存
（ac0bdf1 实际只含 playbook 8 行，清单宣称的测试文件漏提交，run8 边界检查才逮住）。
标本：run5 某批暂存丢失；run7 077 重试丢暂存（更隐蔽）。
姊妹坑：**文档文本里出现提交命令字样同样触发门禁**（heredoc 写文档被拦实证）——
文档写入用 Edit 工具或改措辞。
**机器位（v1.87/091）**：此形态已由门禁直接拦（reason=compound_stage_commit），
教学消息自带正确姿势——本条从纪律位退役为背景知识，但引号/heredoc 载荷文本
仍可能骗过你的眼睛，理解原理依然有用。

### #5 门禁跑的是已装副本：install.sh 先于门禁
门禁钩子从安装位（~/.zcode/...）执行，不是从工作树。改了代码不 `bash install.sh`
就 commit = 门禁拿旧代码验证新提交。纪律：全量绿 → install.sh → add → commit。
标本：058 鸡生蛋问题（timeout 钮修完门禁还是旧值）。

### #6 发布双坑（主会话专用，子代理不发布，备档）
- Git Data API 发树必须带 `git ls-files -s` 的**真实 mode**（本仓 15 个 100755
  脚本，全发 100644 树 sha 必不等）。
- 等值校验走 **ref→commit→tree 两跳链**；`GET /git/trees/main` 回显的是请求
  对象 sha 不是根树 sha，直查必伪报 MISMATCH。
标本：074 发布三跑（mode 坑→校验伪影→链式校验通过）。

### #7 复用接口先读签名：第一参/字段名别靠猜
本仓有既成接口（rules_ledger.match() 第一参是 project_dir 不是查询串；条目
字段叫 sig 不叫 signature）。用错不报错，只是永远查空——比崩溃更隐蔽。
纪律：调用陌生函数前先 Read 它的定义处。
标本：069 两次读错 match() 接口。

### #8 测试隔离：共享文件名/硬编码路径会互相覆盖
tmp_path 里多个用例写同名文件、或硬编码 "proj" 路径，后写的覆盖先写的，
表现为"前面的用例随机红"。纪律：文件名带 marker（`stub-{marker.name}.sh`），
_mk 类工厂函数加 name= 参数。
标本：057 通道 stub 互相覆盖；057 _mk 路径冲突。

### #9 时间戳方向：谁晚谁是"新"
"内容钉 ts 晚于信任表 ts = 人重新授信过"这类方向判断，方向反了规则永远走
不到（deny 分支不可达 = 测试全绿但功能没验证）。写这类测试前先在纸上标一遍
时间轴。
标本：072 内容钉 08:00 早于表 09:00，deny 不可达，测试假绿。

### #10 EARS 验收行三件齐才算判据，勾了才算验过
`- When 条件，则 结果（验：命令）` 三件齐；验完在行尾加 ✅（v1.73 起任意位置
计勾）。缺（验：命令）= 不完整判据，门禁会拦（acceptance_missing/open）。
标本：v1.73 前行尾只有 ✅ 没命令被拦的整族。

### #11 heredoc/引号载荷会骗过你自己 grep 的眼睛
边界守卫标本四连：heredoc 里的路径、引号里的命令词、载荷文本里的 `>=3`——
写拦截规则时先想"载荷和真写操作的区分特征是什么"，别在原文上改正则。
标本：v1.77/1.82 边界守卫四标本。

### #12 门禁 120s 默认超时：全量 >120s 的项目要配 test_runner.timeout
`.regress/config.json` 的 `test_runner.timeout`（秒）。本仓设 300（套件 ~119s
余量小）。新项目套件涨过 120s 会表现为"0 通过 + 超时"——不是测试坏了。
标本：058（v1.69）。

### #13 门禁拦的是整条 Bash 命令，时机=命令提交瞬间
命令串里含 `git commit` 字样就触发，门禁验的是**彼时**的工作树——复合命令
（`seed && install && add && git commit`）里的步骤在门禁放行后才跑，内层 commit
不会被二次拦截。推论：想用测试缓存播种，seed 必须是**独立的前置调用**（命令串
不含 git commit），下一提交调用才会命中；把 seed 和 commit 放同一复合命令 =
seed 与门禁全量并行双跑（想省的以并发形态重演）。
标本：076 取证（guard_version 1.85.1 事件与 0 秒计时矛盾旋梯）。

### #14 gen_reference 无 dry-run：任何调用都是真写
`scripts/gen_reference.py` 不校验未知参数——`--dry-run` 会被静默忽略并**真执行
刷新**（改 README 派生区=边界外写入）。想检查一致性用 `--check`；别的 flag 一律
别传。
标本：run8 波1-C 臂（--dry-run 真写后外科还原）。

## 三、批流程七步（你在第 4 步）

1. 清单落盘（主会话）——tier S/M/L、scan 三行、understood_intent 三件、EARS 验收、rollback
2. 顾问预审化石 + plan_approve --provisional（主会话）
3. **实现**（←你在这里：Read 相关文件 ≥2 → 改 planned_changes 声明的文件）
4. **自测**（←你在这里：本批测试文件绿 + gen_reference 刷新派生区）
5. 集成（主会话）：install.sh → git 三步 → 门禁（全量或缓存命中）
6. 发布（主会话）：Git Data API 全树替换 + ref→commit→tree 等值校验
7. 落账（主会话）：journal task_done / advisor_adoption、清单 ✅、decisions

## 四、自测通过的判据

- 你的测试文件全绿（`python3 -m pytest tests/test_<你的>.py -q`）
- 没动边界外的文件（`git status --short` 里只有清单声明的路径）
- gen_reference 已刷新且 `--check` 过（`python3 scripts/gen_reference.py && python3 scripts/gen_reference.py --check`）
- 报告：改了什么/测试结果/有没有踩上面的坑/有没有计划外发现
