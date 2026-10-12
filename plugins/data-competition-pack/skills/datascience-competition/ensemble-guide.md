# 模型融合指南

## 核心原则

融合的上限 = 模型多样性的上限
两个一样的模型融合 = 零收益
三个相关性 0.9 的模型融合 ≈ 零收益
三个相关性 < 0.7 的模型融合 → 显著提升

## 相关性评估

```python
import numpy as np
from scipy.stats import pearsonr, kendalltau

def prediction_correlation(preds_a, preds_b):
    """评估两个模型预测的相关性"""
    pearson_r, _ = pearsonr(preds_a, preds_b)
    kendall_tau, _ = kendalltau(np.argsort(preds_a), np.argsort(preds_b))
    return pearson_r, kendall_tau

# 用法: 对验证集预测，相关性 < 0.8 才值得融合
```

## 融合策略选择

| 策略 | 适用场景 | 预期提升 | 复杂度 |
|---|---|---|---|
| 平均（概率） | 任何情况 | 0.5-2% | ★☆☆ |
| 加权平均（按 CV） | 模型质量差异大 | 1-3% | ★★☆ |
| Rank 平均 | 概率尺度不一致 | 1-2% | ★★☆ |
| Stacking | 时间充裕 | 1-3% | ★★★ |
| Blending | 有 holdout 集 | 1-2% | ★★★ |

## 加权平均公式

```python
# 按 CV 分数加权（分数越高权重越大）
weights = np.array([cv1, cv2, cv3])
weights = weights / weights.sum()  # 归一化
ensemble_pred = w1*pred1 + w2*pred2 + w3*pred3
```

## Stacking 实现模板

```python
from sklearn.linear_model import Ridge
from sklearn.model_selection import StratifiedKFold

def stacking_oof(base_models, X_train, y_train, X_test, n_folds=5):
    """OOF 预测训练 stacking meta-learner"""
    kf = StratifiedKFold(n_splits=n_folds, shuffle=True, random_state=42)
    
    # 第一层：各模型的 OOF 预测
    train_meta = np.zeros((X_train.shape[0], len(base_models)))
    test_meta = np.zeros((X_test.shape[0], len(base_models))
    
    for i, model in enumerate(base_models):
        test_folds = []
        for train_idx, val_idx in kf.split(X_train, y_train):
            model.fit(X_train[train_idx], y_train[train_idx])
            train_meta[val_idx, i] = model.predict_proba(X_train[val_idx])[:, 1]
            test_folds.append(model.predict_proba(X_test)[:, 1])
        test_meta[:, i] = np.mean(test_folds, axis=0)
    
    # 第二层：meta-learner
    meta_model = Ridge(alpha=1.0)
    meta_model.fit(train_meta, y_train)
    return meta_model.predict(test_meta)
```

## 多样性制造方法

```
1. 架构多样性
   XGBoost + LightGBM + CatBoost（同类型但实现不同）
   BERT-base + RoBERTa-large + DeBERTa-v3
   CNN (ResNet) + Transformer (ViT)

2. 数据多样性
   不同 K-Fold 的模型
   不同数据增强策略
   不同特征子集

3. 训练多样性
   不同随机种子
   不同预训练权重
   不同学习率调度
```

## 天池/Kaggle 实战数据

| 比赛 | 冠军融合 | 融合收益 |
|---|---|---|
| Kaggletabular (常见) | 3-5 个 LGBM + 1-2 个 NN | 0.5-1.5% |
| Kaggle NLP | 3-4 个不同预训练模型 | 1-3% |
| 天池 CV | 多尺度 + 多 backbone | 1-2% |
| 天池表格 | 树模型 + NN + 线性模型 | 0.5-2% |

经验：融合在第 5 名→第 3 名时作用最大（差距小时 0.1% 决定名次），Top 1 的差距通常不在融合。
