# 笔记模板参考

本文件提供两份内容：
1. **空白 HTML 模板**——回写 Zotero 时套用
2. **真实示例**——基于 Hasani Goodarzi et al. (2024) 的清理版笔记，展示一篇合格笔记的深度和格式

---

## 一、空白 HTML 模板（回写 Zotero 用）

把 `[...]` 替换成实际内容。数学公式务必用 `<span class="math">$...$</span>`。

```html
<h1>元信息</h1>
<table>
<tbody>
<tr><th>字段</th><th>内容</th></tr>
<tr><td>标题</td><td>[英文原题]</td></tr>
<tr><td>作者</td><td>[作者团队]</td></tr>
<tr><td>期刊</td><td>[venue], [年份]</td></tr>
<tr><td>DOI</td><td>[...]</td></tr>
<tr><td>Zotero key</td><td>[item_key]</td></tr>
</tbody>
</table>

<h1>一句话总结</h1>
<p>[问题]建模为[模型]，采用[方法]求解。案例研究采用[数据/网络]。结果表明[核心结论，带关键数字]。</p>

<h1>关键词</h1>
<ul>
<li>[keyword1]</li>
<li>[keyword2]</li>
<li>[keyword3]</li>
</ul>

<h1>相关工作与问题定位</h1>
<h2>涉及的研究脉络</h2>
<ul>
<li><strong>脉络1（如：网络设计中的中断风险）</strong>：这条线在做什么 + 本文与它的差异</li>
<li><strong>脉络2（如：多式联运的可持续性）</strong>：…</li>
</ul>
<h2>问题收敛</h2>
<p>作者综合/区别这几条脉络，如何落到本文的具体问题：[…]</p>

<h1>研究问题</h1>
<h2>问题要素</h2>
<ul>
<li><strong>研究对象</strong>：[什么系统/网络]</li>
<li><strong>实体/参数</strong>：[节点、流、订单、容量等]</li>
<li><strong>扰动来源</strong>：[中断/风险从哪来]</li>
</ul>

<h1>数学模型</h1>
<p>建模方法：[MILP / 两阶段随机规划 / 鲁棒优化 / ...]</p>

<h2>目标函数</h2>
<p>[写清 min/max 什么，包含哪些成本项]</p>

<h2>决策变量</h2>
<table>
<tbody>
<tr><th>符号</th><th>含义</th></tr>
<tr><td><span class="math">$X_{ij}^{km}$</span></td><td>[含义]</td></tr>
<tr><td><span class="math">$[符号]$</span></td><td>[含义]</td></tr>
</tbody>
</table>

<h2>约束条件</h2>
<ul>
<li>[约束 1]</li>
<li>[约束 2]</li>
</ul>

<h2>其他说明</h2>
<p>[韧性/风险/可持续性等核心概念在本模型中如何量化，分点写，带公式和变量符号]</p>

<h1>求解方法</h1>
<ul>
<li><strong>[算法名]</strong>：[一句话原理]</li>
</ul>

<h1>案例研究</h1>
<ul>
<li><strong>数据集</strong>：[来源、如何收集]</li>
<li><strong>研究场景</strong>：[网络规模、订单量、场景数等]</li>
</ul>

<h1>实验结果</h1>
<p>[核心数字结论 + 数字意味着什么；反直觉发现单独点出]</p>

<h1>关键图表</h1>
<ul>
<li><strong>Fig. X [图名]</strong>：[这张图展示了什么]</li>
<li><strong>Fig. Y [图名]</strong>：[这张图展示了什么]</li>
</ul>
```

---

## 二、真实示例（Hasani Goodarzi et al., 2024）

> 来源条目 item_key: `6XL3KWIB`。这份笔记展示了：
> - 元信息卡放最顶部，Zotero 现成字段
> - 相关工作在前、研究问题在后——脉络 → 收敛 → 具体问题，漏斗式
> - 决策变量用表格 + `<span class="math">` 渲染符号
> - "其他说明"用四个维度深入拆解"韧性如何量化"——这是本技能最看重的部分

### Markdown 展示版（对话里用）

```
# 元信息
| 字段 | 内容 |
|---|---|
| 标题 | Evaluating the sustainability and resilience of an intermodal transport network leveraging consolidation strategies |
| 作者 | Hasani Goodarzi, Jabbarzadeh, Fahimnia, Paquet |
| 期刊 | Transportation Research Part E, 2024 |
| DOI | 10.1016/j.tre.2024.103616 |
| Zotero key | 6XL3KWIB |

# 一句话总结
Intermodal freight transport 问题，建模为两阶段随机规划（MIP），采用 Lagrangian relaxation and valid inequalities 求解。案例研究采用 UK transportation network（road/rail/water 三种方式，数据从 UK transport system 收集）。结果表明韧性投资具有极高的"杠杆效应"：只需将总运输成本的 0.3%~0.4% 投入事前准备和事后恢复，就能使系统总预期成本降低约 3%~4.7%，预期延迟成本削减 24.6%。

# 关键词
- resilient intermodal network
- vulnerability of transportation networks to disruptions
- scenario-based two-stage stochastic model
- Lagrangian relaxation and valid inequalities

# 相关工作与问题定位
## 涉及的研究脉络
- **多式联运网络设计**：研究 road/rail/water 间的货流分配、终端与运输方式组合以降本增效。本文在此基础上引入随机中断场景
- **运输网络的脆弱性与韧性**：关注网络在中断下的表现，常用事前加固 + 事后恢复。本文把这类韧性策略整合进多式联运语境
- **可持续性/绿色运输**：量化运输的碳排放/环境成本。本文把环境成本纳入目标函数，与韧性做权衡
- **集并策略（consolidation）**：合并小批量货件以提升车辆利用率。本文创新点在于把集并放进随机规划，考察其对韧性的影响
## 问题收敛
已有研究多单独看"可持续性"或"韧性"，少有在多式联运网络里把两者连同集并放进一个随机优化框架联合决策；集并对韧性的影响尚不清晰 → 本文建场景化两阶段随机规划，联合优化运输+韧性+环境成本，并量化集并策略对韧性的杠杆作用

# 研究问题
## 问题要素
- 研究对象：由 road/rail/water 三种运输方式组成的多式联运网络
- 实体/参数：O-D 对集合 K，r^k 为订单 k 的运输箱量；各链路容量、运输时间、成本
- 扰动来源：网络运输容量受随机中断影响，可通过事前准备（preparedness）和事后恢复（recovery）缓解

# 数学模型
建模方法：基于场景的两阶段随机规划（MIP）
## 目标函数
min(运输成本 + 韧性成本 + 环境可持续性成本)，按场景概率求期望
## 决策变量
| 符号 | 含义 |
|---|---|
| $X_{ijs}^{km}$ | 场景 s 下订单 k 用方式 m 在链路 (i,j) 上的流量（集装箱计） |
| $Z_{ijs}^{km}$ | 二元，场景 s 下订单 k 是否用方式 m 经过链路 (i,j) |
| $U_{s}^{k}$ | 场景 s 下订单 k 无法满足的货物量（lost sales） |
| $\gamma_{ijs}^{mw}$ | 二元，场景 s 下是否对链路 (i,j) 方式 m 实施恢复活动 w |
| $\beta_{ij}^{mp}$ | 二元，是否对链路 (i,j) 方式 m 采取准备活动 p |
| $con_{ijs}^{m}$ | 场景 s 下链路 (i,j) 方式 m 的集并操作次数 |
| $Y_{ij}^{m}$ | 链路 (i,j) 方式 m 的车辆总数（车队规模） |
| $DL_{ks}$ | 场景 s 下订单 k 的运输延迟 |
| $Ari_{ks}$ | 场景 s 下订单 k 到达目的地的时间 |
## 约束条件
- 流量守恒约束（需求满足 + lost sales）
- 容量约束（受中断场景影响）
- 各场景下集并后的车辆数
- 集并前的各订单车辆数
- 集并操作次数
## 其他说明（韧性如何量化）
本文没有用单一传统韧性指数，而是用**基于成本与性能的经济量化方法**，把韧性融入两阶段随机规划，权衡"韧性投入"与"中断后果"。四个维度：
1. **投资端（韧性投入）**：事前准备活动 p → 容量提升 $\Delta q_{pij}^{\prime m}$ + 固定投资成本 $h_{pij}^m$；事后恢复活动 w → 容量恢复 $\Delta q_{wij}^m$ + 运输时间调整 $t_{wij}^{\prime m}$ + 操作成本 $a_{wij}^m$
2. **风险端（中断破坏力）**：场景 s 下链路容量下降比例 $g_{mijs}$、运输时间增加比例 $\delta_{mijs}$
3. **惩罚端（韧性绩效）**：缺货损失 $u_k \times U_k^s$（需求满足能力）、延迟惩罚 $u'_k \times DL_{ks}$（时效恢复能力）
4. **资源端（韧性预算）**：约束 (12) 规定事前+事后+交互成本之和 ≤ 韧性预算上限 A

# 求解方法
- Lagrangian relaxation + valid inequalities：对复杂约束做松弛得到下界，配合有效不等式加速 MIP 求解

# 案例研究
- 数据集：UK transportation system 收集的真实数据
- 研究场景：包含 road/rail/water 三种方式的多式联运网络，多场景随机中断

# 实验结果
韧性投资杠杆效应显著：总成本的 0.3%~0.4% 投入准备+恢复 → 总预期成本降 3%~4.7%、预期延迟成本降 24.6%。说明在有限韧性预算下，事前+事后组合投资能以小博大。

# 关键图表
- Fig. X 多式联运网络图：展示了 UK 网络的节点、链路与三种运输方式的空间布局
- Fig. Y 关键/半关键链路加固图：标注了灾前应优先加固（retrofit）的链路位置
```

### HTML 回写版（zotero_manage_note 的 note_text）

```html
<h1>元信息</h1>
<table>
<tbody>
<tr><th>字段</th><th>内容</th></tr>
<tr><td>标题</td><td>Evaluating the sustainability and resilience of an intermodal transport network leveraging consolidation strategies</td></tr>
<tr><td>作者</td><td>Hasani Goodarzi, Jabbarzadeh, Fahimnia, Paquet</td></tr>
<tr><td>期刊</td><td>Transportation Research Part E, 2024</td></tr>
<tr><td>DOI</td><td>10.1016/j.tre.2024.103616</td></tr>
<tr><td>Zotero key</td><td>6XL3KWIB</td></tr>
</tbody>
</table>

<h1>一句话总结</h1>
<p>Intermodal freight transport 问题，建模为两阶段随机规划（MIP），采用 Lagrangian relaxation and valid inequalities 求解。案例研究采用 UK transportation network（road/rail/water 三种方式，数据从 UK transport system 收集）。结果表明<strong>韧性投资具有极高的"杠杆效应"</strong>：只需将总运输成本的 <strong>0.3%~0.4%</strong> 投入事前准备和事后恢复，就能使系统总预期成本降低约 <strong>3%~4.7%</strong>，预期延迟成本削减 <strong>24.6%</strong>。</p>

<h1>关键词</h1>
<ul>
<li>resilient intermodal network</li>
<li>vulnerability of transportation networks to disruptions</li>
<li>scenario-based two-stage stochastic model</li>
<li>Lagrangian relaxation and valid inequalities</li>
</ul>

<h1>相关工作与问题定位</h1>
<h2>涉及的研究脉络</h2>
<ul>
<li><strong>多式联运网络设计</strong>：研究 road/rail/water 间的货流分配、终端与运输方式组合以降本增效。本文在此基础上引入随机中断场景</li>
<li><strong>运输网络的脆弱性与韧性</strong>：关注网络在中断下的表现，常用事前加固 + 事后恢复。本文把这类韧性策略整合进多式联运语境</li>
<li><strong>可持续性/绿色运输</strong>：量化运输的碳排放/环境成本。本文把环境成本纳入目标函数，与韧性做权衡</li>
<li><strong>集并策略（consolidation）</strong>：合并小批量货件以提升车辆利用率。本文创新点在于把集并放进随机规划，考察其对韧性的影响</li>
</ul>
<h2>问题收敛</h2>
<p>已有研究多单独看"可持续性"或"韧性"，少有在多式联运网络里把两者连同集并放进一个随机优化框架联合决策；集并对韧性的影响尚不清晰 → 本文建场景化两阶段随机规划，联合优化运输+韧性+环境成本，并量化集并策略对韧性的杠杆作用。</p>

<h1>研究问题</h1>
<h2>问题要素</h2>
<ul>
<li><strong>研究对象</strong>：由 road/rail/water 三种运输方式组成的多式联运网络</li>
<li><strong>实体/参数</strong>：O-D 对集合 K，<span class="math">$r^k$</span> 为订单 k 的运输箱量；各链路容量、运输时间、成本</li>
<li><strong>扰动来源</strong>：网络运输容量受随机中断影响，可通过事前准备（preparedness）和事后恢复（recovery）缓解</li>
</ul>

<h1>数学模型</h1>
<p>建模方法：基于场景的两阶段随机规划（MIP）</p>
<h2>目标函数</h2>
<p>min(运输成本 + 韧性成本 + 环境可持续性成本)，按场景概率求期望</p>
<h2>决策变量</h2>
<table>
<tbody>
<tr><th>符号</th><th>含义</th></tr>
<tr><td><span class="math">$X_{ijs}^{km}$</span></td><td>场景 s 下订单 k 用方式 m 在链路 (i,j) 上的流量（集装箱计）</td></tr>
<tr><td><span class="math">$Z_{ijs}^{km}$</span></td><td>二元，场景 s 下订单 k 是否用方式 m 经过链路 (i,j)</td></tr>
<tr><td><span class="math">$U_{s}^{k}$</span></td><td>场景 s 下订单 k 无法满足的货物量（lost sales）</td></tr>
<tr><td><span class="math">$\gamma_{ijs}^{mw}$</span></td><td>二元，场景 s 下是否对链路 (i,j) 方式 m 实施恢复活动 w</td></tr>
<tr><td><span class="math">$\beta_{ij}^{mp}$</span></td><td>二元，是否对链路 (i,j) 方式 m 采取准备活动 p</td></tr>
<tr><td><span class="math">$Y_{ij}^{m}$</span></td><td>链路 (i,j) 方式 m 的车辆总数（车队规模）</td></tr>
<tr><td><span class="math">$DL_{ks}$</span><td>场景 s 下订单 k 的运输延迟</td></tr>
</tbody>
</table>
<h2>约束条件</h2>
<ul>
<li>流量守恒约束（需求满足 + lost sales）</li>
<li>容量约束（受中断场景影响）</li>
<li>各场景下集并后的车辆数</li>
<li>集并操作次数</li>
</ul>
<h2>其他说明（韧性如何量化）</h2>
<p>本文没有用单一传统韧性指数，而是用<strong>基于成本与性能的经济量化方法</strong>，把韧性融入两阶段随机规划，权衡"韧性投入"与"中断后果"。四个维度：</p>
<ul>
<li><strong>投资端</strong>：事前准备 p → 容量提升 <span class="math">$\Delta q_{pij}^{\prime m}$</span> + 投资 <span class="math">$h_{pij}^m$</span>；事后恢复 w → 容量恢复 <span class="math">$\Delta q_{wij}^m$</span> + 成本 <span class="math">$a_{wij}^m$</span></li>
<li><strong>风险端</strong>：容量下降 <span class="math">$g_{mijs}$</span>、时间增加 <span class="math">$\delta_{mijs}$</span></li>
<li><strong>惩罚端</strong>：缺货 <span class="math">$u_k U_k^s$</span>、延迟 <span class="math">$u'_k DL_{ks}$</span></li>
<li><strong>资源端</strong>：约束 (12) 事前+事后+交互成本 ≤ 韧性预算 A</li>
</ul>

<h1>求解方法</h1>
<ul>
<li><strong>Lagrangian relaxation + valid inequalities</strong>：对复杂约束松弛得下界，配合有效不等式加速 MIP 求解</li>
</ul>

<h1>案例研究</h1>
<ul>
<li><strong>数据集</strong>：UK transportation system 收集的真实数据</li>
<li><strong>研究场景</strong>：road/rail/water 多式联运网络，多场景随机中断</li>
</ul>

<h1>实验结果</h1>
<p>韧性投资杠杆效应显著：总成本的 <strong>0.3%~0.4%</strong> 投入准备+恢复 → 总预期成本降 <strong>3%~4.7%</strong>、预期延迟成本降 <strong>24.6%</strong>。说明有限韧性预算下，事前+事后组合投资能以小博大。</p>

<h1>关键图表</h1>
<ul>
<li><strong>多式联运网络图</strong>：展示了 UK 网络的节点、链路与三种运输方式的空间布局</li>
<li><strong>关键/半关键链路加固图</strong>：标注了灾前应优先加固（retrofit）的链路位置</li>
</ul>
```
