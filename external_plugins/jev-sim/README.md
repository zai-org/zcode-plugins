# jev-sim: an in-session decision model

Simulates [Jev](https://typesafe.ai)-style typed decisions with the LLM (GLM) already running in your ZCode session. Turns judgment questions into probabilistic, machine-readable decisions — no external decision-model API, no API key, no data leaves your machine.

## Three primitives

| Primitive | Input | Output | Typical use |
|---|---|---|---|
| Choice | state + question + options | probability per option + NONE outlet | classification, routing, branching |
| Noul | state + proposition | P(true) in 0-1 | boolean judgment, risk screening |
| Score | state + rubric | level distribution + expected value | ranking, quality rating |

## How it works

Jev scores each candidate via token probabilities from sentence completion. Session-model APIs expose no token probabilities (the GLM API has no logprobs), so the protocol compensates with mechanisms validated in the open decision-model community:

1. **Letter readout** — each judge subagent outputs exactly one JSON line (options encoded A-Z)
2. **Option rotation** (cyclic shift, AnyJev's L0 layer) — ask the same question K=3 times with rotated option order, removing position bias; vote disagreement is itself signal
3. **Symmetric framings** (Noul) — positive / reversed / evidence-first views, removing framing bias
4. **Frequency as probability** — K votes, smoothed and normalized into a raw distribution
5. **Temperature-scaling calibration** — fit temperature T on labeled items, `p_cal ∝ p_raw^(1/T)`; instruction models are overconfident, and this step translates "vote unanimity" into "how often this much confidence was historically right"

## Output contract

```json
{
  "primitive": "choice",
  "protocol": "jev-sim/0.2",
  "status": "answer",
  "question": "Which team should handle this email?",
  "decision": { "type": "choice", "choice": "billing-support", "probability": 0.72 },
  "probabilities": [
    { "option": "billing-support", "probability": 0.72 },
    { "option": "legal", "probability": 0.14 },
    { "option": "sales", "probability": 0.14 }
  ],
  "none_probability": 0.02,
  "confidence": 0.72,
  "threshold": 0.6,
  "abstained": false,
  "calibrated": true
}
```

`status` is one of: **answer** (normal decision), **none** (NONE votes won — no option holds, refuse to force a pick), **clarify** (top probability below threshold; ask for more context or escalate). Harness-level errors are reported as errors, never disguised as decisions.

## Usage

After installing, start a new task, select the jev-sim skill in the composer, and hand it a judgment question:

> State: customer email — broken chair on arrival, no support response for three days, threatens a consumer-complaint hotline and a lawyer.
> Question: which team should handle this? Options: marketing / billing-support / legal / sales

**Use for**: classification, routing, boolean judgment, rubric scoring, risk screening.
**Do not use for**: open-ended writing, exact symbol/string lookups, arithmetic, or anything expressible as a deterministic rule — just do those directly.

Calibration (recommended once before first use): `python scripts/calibrate.py --results eval/your-results.jsonl`. It writes `scripts/calibration.json`, applied automatically afterwards. `eval/choice-eval.jsonl` ships a 12-item seed set; see the "calibration workflow" section in SKILL.md.

## Side effects and dependencies

- **Network access: none.** All sampling happens inside the current ZCode session; no external API is called, no data is sent anywhere.
- **Model dependency:** uses the session's built-in LLM (judge subagents via the Agent tool); no extra account or key.
- **Command execution:** runs `python scripts/aggregate.py` and `scripts/calibrate.py` (Python stdlib only) for local aggregation and calibration.
- **File writes:** normal use only prints results to the conversation. Only an explicitly run calibration writes `calibration.json` under the plugin's `scripts/`; the aggregator only reads the votes file you specify.
- **No hooks, no MCP server, no background process, no credentials or user-data collection.**

## Third-party sources and license

- The Choice/Noul/Score primitive taxonomy references public Jev (System One, TypeSafe AI) concepts; this plugin is not affiliated with it.
- The rotation-debiasing idea references the AnyJev paper (Nokia Applied Research, Apache-2.0); no code was copied.
- All plugin code is original. MIT License.

## Test results (2026-10-14, GLM-5.3 as judge)

**Unit tests** (synthetic data, verifying the math): letter→option mapping, smoothing, and gray-zone abstention all correct; the calibrator reduced ECE from 0.125 to 0.042 on synthetic error data (T=1.45, correct softening direction); a golden-section boundary-update bug was found and fixed during testing. The 0.2.0 NONE outlet and status states passed a nine-path smoke test (majority-NONE correctly triggers `none`, vote splits trigger `clarify`, option renormalization correct).

**Live-model evaluation** (12 easy + 8 trap items, 3 rotations each, 60 votes total): 60/60 correct, zero vote splits, self-reported judge confidence 72-100 (mean ~97). Position-bias check: across all three rotations judges answered by option content, not position. Consequence: 20/20 correct degenerates temperature fitting ("all-correct data proves nothing"), so **no calibration.json ships**; output honestly reports `calibrated: false` until you calibrate on your own labeled items.

**Primitive demos**: Choice (email routing, 4 options × 3 rotations) 3/3 unanimous → 0.928; Noul (contract clause, three framings) 0.95/0.98/0.96 → p_true 0.963; Score (5-level rubric) 3/3 → level 4, expected value 3.88.

**Honest conclusion**: GLM-5.3 as judge is highly consistent on well-posed items; frequency probabilities often hit 1.0 (~0.93 after smoothing); abstention and NONE only fire when judges genuinely split. To profile real failure rates, recalibrate on items your business actually gets wrong.

## Known limitations

- Each decision spawns K judge subagents — slower and more session-token-hungry than calling a dedicated decision-model API (you save API cost and privacy)
- Probabilities come from sampling frequency, not token logits; resolution is capped by K (at K=3, non-NONE votes only give 0/⅓/⅔/1)
- Letter readout supports ≤26 options; more requires grouped elimination (see SKILL.md)
- Until calibrated, output reports `calibrated: false` and probabilities skew confident

## Layout

```
.zcode-plugin/plugin.json   plugin manifest
skills/jev-sim/SKILL.md     decision protocol (core)
scripts/aggregate.py        vote aggregation + temperature scaling + NONE/status
scripts/calibrate.py        ECE computation + temperature fitting
eval/choice-eval.jsonl      12-item seed evaluation set
```

## Versions

- 0.2.0 — explicit NONE outlet and three-state `status`; option-cap note with grouped sampling; threshold statement (0.6 default is a starting point); audit fields (protocol/threshold/n_samples/none_probability); EN/CN READMEs
- 0.1.0 — Choice/Noul/Score primitives, rotation sampling, temperature-scaling calibration, 20-item evaluation (60/60 votes correct)
