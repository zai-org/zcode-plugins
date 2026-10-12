---
name: datascience-compe
description: AI数据竞赛全流程助手—面向天池/Kaggle/Ch平台的数据科学竞赛，覆盖赛道分析→Baseline→上探→融合→提交→复盘全生命周期。触发词"打比赛/竞赛baseline/模型融合/提交策略/过拟合诊断/特征工程"
---

# 数据竞赛全流程助手

面向数据科学竞赛（天池、Kaggle、KDD Cup、DataFountain 等）的完整工作流方法论。

## 何时调用

用户说"打比赛"、"竞赛 baseline"、"特征工程"、"模型融合"、"提交策略"、"过拟合诊断"、"比赛复盘"时触发。

## 方法论：六阶段工作流

### 阶段 1 — 赛道分析（Day 1，花 30% 时间）

**目标**：用最少的精力搞清楚"这是什么题、该用什么武器"。

**执行顺序**：
```
STEP 1 任务识别
  读比赛描述 → 判断类型：
  ├── 表格 → XGBoost / LightGBM / CatBoost 起手
  ├── NLP（文本分类/NER/问答）→ transformers (BERT/RoBERTa/DeBERTa)
  ├── 图像 → CNN (ResNet/EfficientNet) / ViT
  ├── 时序 → LSTM / Transformer / 时序特征工程
  ├── 多模态 → 以上组合
  └── 推荐/CTR → Wide&Deep / DeepFM / DCN

STEP 2 评估指标
  ├── Accuracy / F1 / AUC / RMSE / MAP@K
  └── ⚠️ 搞清楚优化方向：有的指标是越大越好，有的越小越好

STEP 3 数据摸底
  ├── 训练集/测试集大小
  ├── 标签分布（极度不平衡？）
  ├── 缺失值比例
  ├── 字段类型（数值/类别/文本/时间/ID）
  └── ⚠️ 数据泄露检查：测试集有没有训练时看不到的未来信息

STEP 4 快速 Baseline（1 小时内出第一个提交）
  → 不调参、不做特征工程、不做验证，直接交
  → 目的：打通提交流程 + 拿到排行榜基准分
  → 没有 baseline 的分，所有优化都是盲人摸象

检查点：baseline 提交后才有"优化"的参考系。禁止在 baseline 之前做复杂工作。
```

### 阶段 2 — 验证策略（和 baseline 同时搭）

**核心原则**：本地验证分和 LB（Leaderboard）分必须对齐。不对齐 = 白忙。

```
验证策略选择：
├── 数据有时间顺序 → 时序切分（不能随机！）
├── 类别极度不平衡 → Stratified K-Fold
├── 一般情况 → 5-Fold CV（stratified if classification）
└── 样本极少 (<1000) → Leave-One-Out 或 Repeated CV

关键检查：
  LB score ≈ local CV score ± 0.005 → 对齐，可以信任本地实验
  LB score >> local CV score → 过拟合 / 验证策略错了
  LB score << local CV score → 数据分布不一致 / 提交通错了
```

### 阶段 3 — 上探优化（花 50% 时间）

**按收益从高到低排列**：

```
优先级 1：特征工程（表格/NLP 都适用）
  ├── 表格：交叉特征、目标编码、统计特征（groupby stats）
  ├── NLP：TF-IDF + 传统模型（有时比 BERT 还强）、预训练 embeddings
  └── 通用：缺失值模式作为特征、特征交互

优先级 2：模型调参
  ├── XGBoost/LightGBM：先 n_estimators + learning_rate，再 max_depth + min_child_weight
  ├── BERT 类：learning_rate (2e-5 ~ 5e-5) + epochs + warmup + dropout
  └── 工具：Optuna / Ray Tune 做超参搜索（别手调）

优先级 3：数据增强
  ├── NLP：回译、EDA（同义词替换/随机插入/交换/删除）
  ├── 图像：flip/crop/color jitter/CutMix
  └── 表格：SMOTE（少类别）、Mixup

优先级 4：模型融合（最后做）
  → 见阶段 4

反模式（别做的事）：
  ❌ 在 baseline 之前调参
  ❌ 不看数据直接堆模型
  ❌ 一次改多个变量（不知道哪个起作用）
  ❌ 用复杂模型解决简单问题（KNN 能赢别用 Transformer）
```

### 阶段 4 — 模型融合（花 15% 时间，最后一周）

**核心**：融合的核心不是模型多，是模型**多样性**。

```
Step 1 多样性评估
  ├── 不同架构（树模型 + NN + 线性模型）
  ├── 不同特征集
  ├── 不同预训练权重（bert-base vs roberta-large）
  └── 不同训练数据子集（KFold 的不同 fold 模型）

Step 2 融合策略（按复杂度递增）
  ├── 平均融合：多个模型预测概率直接平均（最简单，常够用）
  ├── 加权平均：按 CV 分数加权（weight ∝ CV_score）
  ├── Stacking：用另一层模型学习如何组合
  └── Blending：Holdout 预测训练 meta-learner

Step 3 融合数量
  ├── 2-3 个足够（收益递减严重）
  └── 5+ 个模型融合收益 < 1%，不值得

关键公式：
  融合收益 = f(模型相关性)
  相关性越低 → 融合收益越高
  两个一样的模型融合 = 零收益
```

### 阶段 5 — 提交策略（最后 2-3 天）

```
剩余时间充裕（>3 天）：
  ├── 每次提交间隔 ≥ 2 小时（Kaggle 限制）
  ├── 每次只改一个变量
  └── 记录每次提交的 local CV + LB score

剩余时间紧张（<1 天）：
  ├── 选 local CV 最高的 2-3 个方案提交
  ├── 别在最后 2 小时换全新方案（来不及验证）
  └── 用融合版本冲榜

提交前检查清单：
  □ 预测范围正确（分类概率在 0-1，回归无负数）
  □ 提交格式和 sample_submission 完全一致
  □ 行数和测试集行数一致
  □ ID 列没有乱序
  □ 没有 NaN/Inf
```

### 阶段 6 — 赛后复盘（比赛结束后）

```
必做：
  ├── 拉冠军方案（Top 1/3/5/10），对比差距在哪
  ├── 记录：什么策略有效、什么浪费时间
  └── 保存最佳代码 + 权重，下次复用

复盘问题：
  1. 你的 final score 和冠军差多少？差距来自哪？
  2. 哪个阶段花的时间不值？
  3. 验证策略和 LB 对齐吗？（不对齐 = 所有实验不可信）
  4. 融合提了多少分？
  5. 如果重来，你会怎么改时间分配？
```

## 过拟合诊断速查

```
症状：local CV 很高，LB 低
├── 原因 1：验证策略不对（时序数据用了随机切分）→ 改用时间切分
├── 原因 2：在测试集信息上做了特征 → 检查特征计算是否用了全量数据
├── 原因 3：标签泄露（特征包含标签相关信息）→ 逐个特征排查
└── 原因 4：模型太复杂、样本太少 → 简化模型/加正则化

症状：local CV 波动大（±0.01+）
├── 原因：数据少 / 验证折数不够 → 用 RepeatedKFold
└── 原因：模型不稳定 → seed ensemble（不同 seed 训多个取平均）

症状：提交分数每次都不一样（差 0.001-0.003）
└── 正常：dropout/batch 的随机性导致，用 seed 固定 + TTA 平均
```

## 竞赛类型速查表

| 数据类型 | 首选模型 | Baseline 时间 | 关键陷阱 |
|---|---|---|---|
| 表格（中小） | XGBoost/LightGBM | 30min | 类别编码 / 缺失值处理 |
| 表格（大/高维） | CatBoost + NN | 1-2h | 特征选择 / 内存爆炸 |
| 文本分类 | BERT/ RoBERTa | 1h | 类别不平衡 / max_len |
| 命名实体识别 | BERT-CRF / Span | 2h | 实体嵌套 / 边界模糊 |
| 图像分类 | EfficientNet / ViT | 1h | 数据增强 / 预训练权重 |
| 目标检测 | YOLO / FasterRCNN | 2-4h | 锚框调参 / 多尺度 |
| 时序预测 | LGBM + 特征工程 | 1h | **不能用随机验证** |
| CTR/推荐 | DeepFM / DCN | 2h | 特征交叉 / 负采样 |

## 时间分配模板

| 比赛时长 | 分析+Baseline | 上探优化 | 融合冲刺 | 缓冲 |
|---|---|---|---|---|
| 1 周 | 1 天 | 4 天 | 1.5 天 | 0.5 天 |
| 2 周 | 2 天 | 8 天 | 3 天 | 1 天 |
| 1 月 | 3 天 | 18 天 | 6 天 | 3 天 |

## 代码结构模板

```
project/
├── data/
│   ├── raw/                 # 原始数据（只读）
│   ├── interim/             # 中间处理结果
│   └── processed/           # 最终特征集
├── notebooks/
│   ├── 01_eda.ipynb         # 探索性分析
│   ├── 02_baseline.ipynb    # baseline
│   ├── 03_feature_eng.ipynb # 特征工程
│   └── 04_ensemble.ipynb    # 融合
├── src/
│   ├── features.py          # 特征构建
│   ├── models.py            # 模型定义
│   ├── validation.py        # 验证策略
│   └── ensemble.py          # 融合逻辑
├── submissions/              # 每次提交 + 分数记录
│   ├── submission_v1_0.8543.csv
│   └── ...
├── experiments.csv          # 实验记录表
└── README.md                # 比赛信息 + 最终方案
```

## 实验记录表格式

```csv
date,version,model,features,local_cv,lb_score,notes,time_spent
2026-10-04,v0.1,LGBM_300,raw,0.8234,0.8123,baseline,30min
2026-10-04,v0.2,LGBM_500,raw+cross,0.8456,0.8312,added cross features,1h
```

## 注意事项

- 比赛前期（前 1/3 时间）比后期提分容易 10 倍——前期花时间理解数据是值得的
- 排行榜的 shake-up 很常见：最后一周翻盘是常态，别过早放弃
- 私有 LB 和公开 LB 分布可能不同——别在公开 LB 上过拟合
- 提交次数有限时：选 CV 最高的提交，别赌没验证的方案
