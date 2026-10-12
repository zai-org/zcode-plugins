# 过拟合诊断与修复速查

## 诊断流程

```
Local CV vs LB 对比
│
├── CV ≈ LB (±0.005) → ✅ 验证可信，正常优化
│
├── CV >> LB → ❌ 过拟合 / 验证泄漏
│   ├── 检查 1: 时序数据用了随机切分？→ 改为时间切分
│   ├── 检查 2: 特征计算用了全量数据（含测试集）→ 只用训练集统计
│   ├── 检查 3: 目标编码在全集上做 → 改为 K-Fold 内部编码
│   ├── 检查 4: 特征与标签有数据泄漏 → 逐特征相关性排查
│   └── 修复: 加正则化 / 简化模型 / Dropout / Early Stopping
│
├── CV << LB → ⚠️ 异常（比过拟合更危险）
│   ├── 检查 1: 提交格式错了（ID 乱序 / 列名不对）
│   ├── 检查 2: 预测区间不对（概率 vs 类别标签搞混）
│   └── 检查 3: 测试集分布与训练集不同（domain shift）
│
└── CV 波动大 → ⚠️ 验证不稳定
    ├── 样本太少 → RepeatedKFold / Leave-One-Out
    └── 模型不稳定 → Seed Ensemble（不同种子训练取平均）
```

## 常用正则化手段

| 场景 | 手段 |
|---|---|
| 树模型 | max_depth↓ / min_child_weight↑ / subsample↓ / colsample_bytree↓ / reg_lambda↑ |
| 神经网络 | Dropout↑ / weight_decay↑ / Early Stopping / 数据增强 |
| 特征过多 | L1 正则 / 特征选择（SHAP importance 筛选 Top-K） |
| 样本极少 | 数据增强 / 迁移学习 / 简化模型 |
| 训练-测试分布不一致 | 域适应 / 时序切分 / 特征对齐 |

## Kaggle 经验法则

- CV-LB gap < 0.005 → 健康
- CV-LB gap 0.005-0.01 → 轻度过拟合，注意
- CV-LB gap > 0.01 → 严重，验证策略大概率错了
- 私有 LB shake-up 平均 ±1-2 名（Top 10% 以内）
