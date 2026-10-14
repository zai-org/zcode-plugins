# 风格条目 / 案例记录 模板

新增风格、沉淀案例时照此填写。

## A. 风格条目模板

目录：`assets/styles/<风格 id>/`

```
<风格 id>/
├── meta.yaml
├── prompt.positive.txt
├── prompt.negative.txt
└── ref.jpg
```

### meta.yaml

```yaml
name: 江南春·水印木刻          # 中文风格名
id: jiangnan-muke              # 目录名，kebab-case
summary: 米白纸底、平涂色块、短刻痕，套色/水印木刻风
best_for: [古典诗词, 山水, 江南, 田园]   # 适用题材
mood: [清雅, 静谧, 悠远]                 # 情绪基调
default:
  size: 1024x1536              # 默认尺寸
  quality: high
  variants: 1                  # 默认张数
positive_file: prompt.positive.txt
negative_file: prompt.negative.txt
ref: ref.jpg
```

### prompt.positive.txt

风格的正向配方，用 `{SUBJECT}` 占位主体。**必须包含部件级描述**（各类物件被概括成什么），不要只写抽象形容词。

### prompt.negative.txt

风格要避免的东西，越具体越好。

## B. 案例记录模板

文件：`assets/cases/YYYY-MM-DD-<slug>.md`

```markdown
# 案例：<标题>

- **日期**：YYYY-MM-DD
- **风格**：<风格 id>
- **原始输入**：<原文>
- **意象清单**：<主体 / 景物 / 色彩 / 情绪 / 时空>
- **最终提示词**：<完整正向提示词>
- **负向**：<负向约束>
- **参数**：size=<...> quality=<...> 张数=<...>
- **参考图**：<path 或 无>
- **成图**：`assets/cases/images/YYYY-MM-DD-<slug>.jpg`（技能内自包含副本）｜原始输出：<path>
- **是否采纳**：是 / 否
- **用户评价 / 可提炼的规则**：<用户怎么说；能沉淀成什么通用规则>
```

> 「可提炼的规则」一栏最重要 —— 它是把单次经验升级为风格配方的接口。
