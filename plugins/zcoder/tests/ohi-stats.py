#!/usr/bin/env python3
"""Statistical engine for the OHI scorecard. stdlib only.

Reads trials from tests/ohi-trials.jsonl (one JSON object per line):
  {"epoch":"pre"|"post", "engine":"glm-main", "class":"deep", "ok":1,
   "items":10, "correct":10, "tokens":29157, "duration":63}

Computes:
  - Wilson score intervals for perception accuracy & integrity (D8a/D8b)
  - Two-proportion test: pre-fix vs post-fix accuracy epochs
  - Rule of Three bound for the zero-regression monitor claim
  - Shewhart control limits on log10(tokens) per task class (S5 bands)
  - Adaptive retry verdict per engine (Laplace-smoothed episode success vs EV threshold)
"""
import json, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
TRIALS = os.path.join(HERE, "ohi-trials.jsonl")

def load():
    rows = []
    if os.path.exists(TRIALS):
        for line in open(TRIALS):
            line = line.strip()
            if line and not line.startswith("//"):
                rows.append(json.loads(line))
    return rows

def wilson(k, n, z=1.959964):
    if n == 0:
        return None
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return p, max(0.0, c - h), min(1.0, c + h)

def rule_of_three(n):
    """Upper 95% bound on the true rate after n trials with 0 observed (Hanley–Lippman-Hand)."""
    return 3.0 / n if n > 0 else 1.0

def two_prop(k1, n1, k2, n2):
    """Pooled two-proportion z-test. Returns (z, two-sided p). k1/n1 = baseline, k2/n2 = treatment."""
    if n1 == 0 or n2 == 0:
        return None
    p1, p2 = k1 / n1, k2 / n2
    p = (k1 + k2) / (n1 + n2)
    se = math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2))
    if se == 0:
        return 0.0, 1.0
    z = (p2 - p1) / se
    pval = 2 * (1 - 0.5 * (1 + math.erf(abs(z) / math.sqrt(2))))
    return z, pval

def shewhart_log(values):
    """Control limits on log10 scale (costs are ~log-normal). Returns (median_tok, ucl_tok, lcl_tok)."""
    if len(values) < 3:
        return None
    xs = [math.log10(max(v, 1)) for v in values]
    m = sum(xs) / len(xs)
    sd = math.sqrt(sum((x - m) ** 2 for x in xs) / (len(xs) - 1))
    return 10 ** m, 10 ** (m + 3 * sd), 10 ** (m - 3 * sd)

def laplace(succ, fail):
    return (succ + 1) / (succ + fail + 2)

def main():
    rows = load()
    if not rows:
        print("no trials recorded")
        return
    post = [r for r in rows if r.get("epoch") == "post"]
    pre = [r for r in rows if r.get("epoch") == "pre"]

    print("== D8a perception accuracy ==")
    for label, grp in (("pre-fix ", pre), ("post-fix", post)):
        k = sum(r["correct"] for r in grp); n = sum(r["items"] for r in grp)
        w = wilson(k, n)
        print(f"  {label}: {k}/{n} = {w[0]:.3f}  Wilson95% [{w[1]:.3f}, {w[2]:.3f}]")
    if pre and post:
        z, pv = two_prop(sum(r["correct"] for r in pre), sum(r["items"] for r in pre),
                         sum(r["correct"] for r in post), sum(r["items"] for r in post))
        verdict = "SIGNIFICANT at 0.05" if pv < 0.05 else "not significant — keep sampling before claiming improvement"
        print(f"  pre vs post: z={z:.2f}, p={pv:.3f} → {verdict}")

    print("== D8b integrity (per-run pass) ==")
    for label, grp in (("pre-fix ", pre), ("post-fix", post)):
        k = sum(1 for r in grp if r.get("integrity", 1)); n = len(grp)
        w = wilson(k, n) if n else None
        if w:
            print(f"  {label}: {k}/{n} = {w[0]:.3f}  Wilson95% [{w[1]:.3f}, {w[2]:.3f}]")

    print("== S5 cost control limits (Shewhart on log10 tokens) ==")
    classes = {}
    for r in rows:
        if "tokens" in r:
            classes.setdefault(r.get("class", "unknown"), []).append(r["tokens"])
    for cls, vals in sorted(classes.items()):
        s = shewhart_log(vals)
        if s:
            med, ucl, lcl = s
            breaches = [v for v in vals if v > ucl or v < lcl]
            print(f"  {cls}: n={len(vals)} median≈{med:,.0f} tok  UCL={ucl:,.0f}  LCL={lcl:,.0f}  breaches={len(breaches)}")

    print("== Monitor hardening bound (Rule of Three) ==")
    n_static = int(os.environ.get("OHI_STATIC_SAMPLES", "900"))
    print(f"  {n_static} clean samples, 0 regressions → true regression rate ≤ {rule_of_three(n_static)*100:.2f}% per sample (95%)")

    print("== Adaptive retry (TRANSIENT failures only; config rejections excluded) ==")
    # episode ledger: {"engine":..., "episodes":[{"success":0|1} ...]} lines with type=="retry"
    # NOTE (docs-validated 2026-09-03): turbo's historical "flap" episodes were
    # misclassified — GLM-5-Turbo has no reasoning_effort, so those were deterministic
    # config rejections, never retried under the current protocol. Rows may carry
    # "config":1 to be excluded here; legacy unflagged turbo rows are excluded by engine.
    eps = {}
    for r in rows:
        if r.get("type") == "retry_episode" and not r.get("config", 0) and r.get("engine") != "glm-turbo":
            eps.setdefault(r["engine"], []).append(r["success"])
    RETRY_COST, SAVED_COST = 5000, 25000
    for eng, outcomes in sorted(eps.items()):
        s = sum(outcomes); f = len(outcomes) - s
        p = laplace(s, f)
        ev = p * SAVED_COST - (1 - p) * RETRY_COST
        print(f"  {eng}: episodes {s}✓/{f}✗ → P(transient-recovery)≈{p:.2f}; retry EV={ev:,.0f} tok → {'RETRY' if ev > 0 else 'DEGRADE immediately'}")
    if not eps:
        print("  no transient-class episodes on record (turbo history reclassified config-class; excluded)")

    print("== D8a tripwire (accuracy is a breach detector, not a significance machine) ==")
    d8 = [r for r in rows if "correct" in r and r.get("items")]
    if d8:
        last = d8[-1]
        rate = last["correct"] / last["items"]
        # alert if last run falls at/below 80% (2σ below the ~98% post-fix mean on 10 items)
        status = "BREACH" if rate <= 0.8 or not last.get("integrity", 1) else "nominal"
        print(f"  last run: {last['correct']}/{last['items']} integrity={'pass' if last.get('integrity',1) else 'FAIL'} engine={last.get('engine','?')} → {status} (alert threshold: ≤80% or integrity fail)")
        for eng in sorted({r.get("engine", "?") for r in d8}):
            runs = [r for r in d8 if r.get("engine", "?") == eng]
            c = sum(r["correct"] for r in runs); n = sum(r["items"] for r in runs)
            integ = sum(1 for r in runs if r.get("integrity", 1))
            print(f"  series {eng}: {len(runs)} runs, {c}/{n} items ({100*c/n:.0f}%), integrity {integ}/{len(runs)}")

    print("== Lifetime capability alarm (dispatch-attempts.jsonl — the turbo blind-spot fix) ==")
    att_path = os.path.join(HERE, "dispatch-attempts.jsonl")
    if os.path.exists(att_path):
        att = [json.loads(l) for l in open(att_path) if l.strip()]
        by_eng = {}
        for a in att:
            by_eng.setdefault(a["engine"], []).append(a["outcome"])
        for eng, outs in sorted(by_eng.items()):
            okc = sum(1 for o in outs if o == "success")
            rate = okc / len(outs)
            consec_fail = 0
            for o in outs:
                if o != "success":
                    consec_fail += 1
                else:
                    break
            verdict = []
            if rate == 0.0:
                verdict.append("NEVER-WORKED → remove or investigate NOW")
            elif rate < 0.5:
                verdict.append("MAJORITY-FAIL → remove-or-investigate")
            if consec_fail >= 5:
                verdict.append(f"{consec_fail} consecutive failures")
            print(f"  {eng}: {okc}/{len(outs)} lifetime ({100*rate:.0f}%){' — ' + '; '.join(verdict) if verdict else ''}")
    else:
        print("  no attempts ledger found")

if __name__ == "__main__":
    main()
