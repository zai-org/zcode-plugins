---
name: respire
description: respire（rsrs）本地加密记忆操作法。每轮自动召回已随 prompt 注入；**未见注入、命中不贴题、或涉旧（项目、报错、约定、日期）都须换词 rsrs recall 可见补查**（同义词/上位词/英文词分路试），仅当已有注入确实相关方才勿重复；手动翻忆 recall、落库 remember（判后即存）、读全文 show/chain、删除 forget、同步 sync、查态 status；prompt 以「记：」开头由插件直接落库，「/nomem」前缀关闭本轮召回。触发词：记忆、翻忆、recall、remember、存记忆、忘掉、同步。
---

# respire · 记忆操作法（ZCode）

本插件行为：SessionStart 注入简则；每轮 UserPromptSubmit 自动召回（rsrs 自带无关过滤（零命中即 skip），本层再按阈值兜底）；prompt 以「记：」「存：」「remember:」开头由插件先落库保底并回执——**回执带暂拟标题与短 id 时，你须从事实抽取「主语＋动作＋结果」完整句 `rsrs retitle <短id> --title` 替换（硬约束，title 是召回与判重的门面）**；`/nomem` 关本轮；Stop 时若本轮有新事实而近 10 分钟库无落库，插件催存一轮。

## 命令

- `rsrs recall "项目名+关键词" --limit 5 --json` —— **答前必查、可见地调**（注入为空绝不等于无记忆，须自行补查）；报错先按报错原文翻忆；`--titles` 只要短 id＋标题
- `rsrs remember "内容" --title "事实句" --importance important` —— 一事一条，先判后存
- `rsrs show <短id>`（前 8 位）读全文；`rsrs chain` 一次取整条因果链
- `rsrs forget <id>` —— 墓碑删除，随同步传播
- `rsrs candidates <内容>` —— 存前候选账（合并/挂靠建议）
- `rsrs sync` 双向同步（autosync 常开）；`rsrs status` 查态；`rsrs prompt` 读完整记忆工作流
- `rsrs tree/resort/retitle` —— 整理因果树

## 解析要点（CLI 信封）

- 一切命令 `--json` 走统一信封：`status`、`summary`、`items`、`details`、`errors`；**失败也是 HTTP 200＋`status:"fail"`＋`errors[]`**，须查 status 不查退出码
- recall 的分数与条目在 `details[].score`、`details[].id`（全 id，取前 8 位当短 id）、`details[].title`、`details[].superseded_by`；`items` 只是「分数 标题」行
- 进度写 stderr，勿 `2>&1` 混进 JSON
- remember 判后即存：`status:"ok"`＝已写入（summary.id）；`status:"pending"`＋`written:false`＝判为相似**未写入**，须 `--parent <id>` 挂靠或 `--force` 直写
- 默认 `trivial` 档进日记区、不进召回主区且 title 被改「活动轨迹 日期」——事实类落库用 `--importance important`

## 红线

- 口令、证件号、手机号、卡号、私钥禁入记忆正文与查询词，只写存放位置——库虽加密，密钥泄露即全裸
- 召回分数是相关度不是可信度；存前 candidates 判重，改＞并＞存
- 账号与同步配置不归本插件管：注册去 rsrs.rs，本机 `rsrs register`／`rsrs login`，插件不代办
