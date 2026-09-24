# Domain Gates — Detected Per Manuscript, Composed Freely

The skill itself is domain-agnostic; these gates are loadable knowledge packs. A reviewer loads **only the sections matching the domains detected in the material** — never all of them. A multi-domain paper (OR + ML + LLM, simulation + optimization, …) composes several gates; when two composed gates interact (e.g., an LLM component feeding a solver), check the coupling explicitly: does the weakness of one component undermine the other's evaluation? A domain with no built-in gate is still fully reviewable — it runs on the general discipline, the two-track rigor floors, and the concern taxonomy, and it is a signal to extend this file (protocol at the bottom).

Domain detection comes from the claims map plus obvious signals: solver/framework imports (Gurobi, CPLEX, OR-Tools, Pyomo, CVXPY, JuMP, PyTorch, JAX, transformers), problem vocabulary (stochastic, robust, recourse, two-stage, VRP, scheduling, inventory, location), algorithm names (Benders, column generation, ADMM, PHA, Lagrangian), ML+OR vocabulary (predict-then-optimize, neural solver, RL for optimization), LLM/agent vocabulary (GPT, LLM, prompt, fine-tune, agent, tool-use, RAG, multi-agent).

## Two-track rigor floors (INFORMS OR editorial standard — always apply)

Evaluate on two separate tracks regardless of domain:

- **Mathematical rigor**: assumption plausibility, formulation correctness, derivations and proofs, theoretical properties (convergence, complexity, optimality bounds).
- **Empirical rigor**: experimental design, statistical validity (seeds, variance), reproducibility (environment, seeds, instance generation), baseline fairness.

Empirical floors (a violation is a red-flag candidate):

- **Out-of-sample evaluation** — good in-sample fit does not establish prediction/decision performance; SAA/training-set results alone cannot support conclusions.
- **Defensible data** — real data, or generation with a stated basis.
- **No straw-man baselines** — compare against current methods / commercial solvers / domain heuristics, not only weak or outdated ones.
- **Off-the-shelf test** — an ML component that merely composes existing techniques without substantive methodological novelty is treated as incremental (OR editorial boards discourage such papers).

Sanity anchors for arbitration: a production plan with $x = -5$ units contradicts the model's own non-negativity; a VSS of 0.01%–0.10% cannot support "stochastic modeling is valuable here" without a secondary metric (e.g., constraint satisfaction probability, service level).

## Gate 1 — Mathematical Programming

**LP / IP / MIP**
- Formulation compared against alternative formulations (if applicable)?
- Valid inequalities / cutting planes discussed for MIP?
- Branch-and-bound behavior analyzed (nodes, cuts)?

**NLP / MINLP**
- Convexity properly characterized?
- Optimality conditions (KKT) verified or discussed?
- Sensitivity analysis for key parameters?
- For MINLP: relaxation quality discussed?

**Constraint Programming**
- Propagation mechanisms explained? Search strategy justified?

## Gate 2 — Stochastic / Robust Optimization

**Stochastic Programming**
- Scenario generation justified and realistic?
- Number of scenarios sufficient for solution stability?
- **VSS** computed and discussed? **EVPI** or similar provided?
- Multi-stage: non-anticipativity handled correctly?
- In-sample vs out-of-sample performance separated?

**Robust Optimization**
- Uncertainty set justified (box, ellipsoidal, polyhedral)?
- Price of robustness analyzed?
- Tractable reformulations derived correctly?
- Quality-vs-conservatism trade-off discussed?

**Distributionally Robust**
- Ambiguity set construction justified?
- Moment-based / distance-based sets appropriate?

## Gate 3 — Decomposition Algorithms

**Benders**
- Feasibility and optimality cuts correctly derived?
- Convergence behavior analyzed (iterations, cuts)?
- Acceleration discussed (Pareto-optimal cuts, trust region)?

**Column Generation / Branch-and-Price**
- Pricing problem correctly formulated?
- Column stabilization against degeneracy?
- Branching rule appropriate?

**ADMM**
- Splitting strategy justified? Penalty tuning discussed?
- Convergence criteria and residuals tracked?

**Progressive Hedging (PHA)**
- Penalty selection justified? Thresholds appropriate?
- Comparison against the extensive form (DEP) included?
- Primal/dual residuals reported?
- Parallelization benefit quantified (if claimed)?

**Lagrangian Relaxation**
- Bound quality analyzed? Multiplier update rule sound?

## Gate 4 — Network / Combinatorial Optimization

**VRP**
- Standard benchmarks (Solomon, Gehring-Homberger, CVRPLib)?
- Fair comparison to state-of-the-art?
- Instance variety tested (clustered / random / mixed)?
- Heuristics: quality-vs-time trade-off analyzed?
- Practical constraints realistic (time windows, capacity, multi-depot)?

**TSP** — TSPLib used? Optimality proven or gap reported?
**Network flow** — scale appropriate for the method? Specialized vs general solvers compared?
**Graph/matching** — complexity class discussed? Approximation ratio / heuristic quality analyzed for NP-hard problems?

## Gate 5 — Application Domains

**Scheduling** — machine environments realistic? Objective appropriate? Instance sizes representative? Compared against dispatching rules / heuristics?
**Facility location** — cost parameters realistic and sourced? Demand justified? Capacity constraints realistic?
**Inventory** — demand distributions plausible? Holding/stockout ratio justified? Horizon appropriate?
**Supply chain / logistics** — motivated by real operations? Parameters sourced? Topology representative?
**Maritime / container logistics** — vessel characteristics realistic? Transshipment times and capacity considered? Seasonality discussed?

## Gate 6 — ML+OR Intersection

**General**
- Train/validation/test split sound? Instance-generation process described?
- Multiple seeds with variance reported? Overfitting addressed?
- Generalization to unseen instances evaluated?

**RL for optimization** — state/action design justified? Reward aligned with the optimization objective? Training convergence analyzed? Fair comparison against OR methods (heuristics, solvers)? Train-vs-test instance scale discussed? Training-vs-inference compute reported?
**Predict-then-optimize** — cost of prediction error integrated? SPO-type loss or similar used? Compared against two-stage approaches? Impact of prediction error on decision quality quantified?
**Data-driven optimization** — data quality/quantity sufficient? Preprocessing described? Robustness to noise/outliers? SAA convergence discussed?
**Neural solvers (GNN, attention)** — architecture justified by problem structure? Compared against commercial solvers? Limitations (scale, generalization) discussed? Training distribution representative of test?
**End-to-end learning** — differentiation through optimization handled? Gradient computation (explicit/implicit) discussed? Compared against surrogate-loss approaches?

## Gate 7 — LLM & Agent Components

For papers where an LLM (or LLM-based agent) is part of the method: optimization-in-the-loop, solution generation or repair, data/instance generation, prediction, or multi-agent orchestration.

**LLM in the pipeline**
- Output stochasticity handled: fixed decoding or multi-run variance reported, like any stochastic algorithm?
- Prompt sensitivity: do conclusions survive reasonable prompt rewordings, or are they prompt-fitted?
- Fair baselines: compared against non-LLM alternatives (heuristics, solvers, small task-specific models), not only against weaker LLM variants?
- Cost and latency reported where deployment relevance is claimed?
- **Benchmark contamination**: could test instances/eval questions have appeared in pretraining data? Is any decontamination or held-out verification attempted?
- When LLM output feeds a solver/model: error rate of generated artifacts, repair mechanism, and its success rate quantified — not just exemplars?

**Agents / multi-agent**
- Protocol reproducible: tools, memory, turn limits, stopping rules stated?
- Success rates over multiple runs (not cherry-picked trajectories)?
- Ablation against simpler alternatives (single call, plain pipeline, no agent)?

**Evaluation**
- Eval set isolation from any training/fine-tuning data explicitly discussed?
- Human evaluation, if used: annotator count, agreement reported?
- Failure cases analyzed, not only aggregate scores?

## Extending the gate set

When a manuscript's domain has no gate here, review it on the general discipline and two-track floors, then add a gate in a follow-up edit. A new gate needs exactly three things:

1. **Detection signals** — vocabulary/structure that triggers loading it.
2. **Checkable items** — each with a clear pass/fail, not impressions.
3. **Domain red lines** — failure modes specific to that domain (data leakage for ML+OR, benchmark contamination for LLM, cross-hardware runtimes for computational OR).

Keep gates focused; when a domain's list grows past ~15 items, split it by subfamily (as the OR gates above do).
