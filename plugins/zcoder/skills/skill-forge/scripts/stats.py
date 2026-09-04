#!/usr/bin/env python3
"""Statistical engine for skill-forge trials ledgers. stdlib only.

Honest-stats stance (validated 2026-09-03 + OHI power analysis): at plugin
scale (~2-10 trials/variant) improvements are DISCRIMINATIVE, not significant
(~300 items/arm needed for small effects). So:
  - Wilson intervals describe each variant; wide = honest ignorance.
  - --compare reports the two-proportion z-test but refuses to call n<20
    comparisons significant (prints 'descriptive only').
  - --thompson picks which variant deserves the NEXT trial (Beta-Bernoulli
    posterior sampling). This is a DECISION procedure, not a measurement:
    seeded by the ledger's own hash, so the same data always yields the same
    recommendation — determinism where it matters.
  - --rank lists skills by Wilson LOWER bound ascending (weakest first) —
    the idle loop's target selector.

Usage:
  stats.py <trials.jsonl> [--compare A B] [--thompson] [--rank <evals-root>]
"""
import glob
import hashlib
import json
import math
import os
import random
import sys

Z = 1.959964


def wilson(k, n):
    if n == 0:
        return None
    p = k / n
    d = 1 + Z * Z / n
    c = (p + Z * Z / (2 * n)) / d
    h = Z * math.sqrt(p * (1 - p) / n + Z * Z / (4 * n * n)) / d
    return p, max(0.0, c - h), min(1.0, c + h)


def two_prop(k1, n1, k2, n2):
    p1, p2 = k1 / n1, k2 / n2
    p = (k1 + k2) / (n1 + n2)
    se = math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2))
    if se == 0:
        return 0.0, 1.0
    z = (p2 - p1) / se
    return z, 2 * (1 - 0.5 * (1 + math.erf(abs(z) / math.sqrt(2))))


def load(path):
    return [json.loads(l) for l in open(path) if l.strip()]


def per_variant(rows):
    out = {}
    for r in rows:
        v = r["variant"]
        out.setdefault(v, []).append(r)
    return out


def report(path):
    rows = load(path)
    oracle_mix_warning(path)
    pv = per_variant(rows)
    print(f"ledger: {len(rows)} trials, {len(pv)} variants")
    for v, vr in sorted(pv.items()):
        k = sum(1 for r in vr if r["verdict"] == "pass")
        w = wilson(k, len(vr))
        fails = [r for r in vr if r["verdict"] != "pass"]
        print(f"  {v:<28} {k}/{len(vr)} pass  Wilson95 [{w[1]:.2f}, {w[2]:.2f}]"
              + (f"  fails: {sorted({f['run'] for f in fails})}" if fails else ""))
        for f in fails:
            print(f"    FAIL {f['scenario']}/{f['run']}: {f['reason'][:100]}")
    # scenario matrix per variant
    scen = sorted({r["scenario"] for r in rows})
    if scen:
        print("  scenario matrix (pass/trials):")
        for v, vr in sorted(pv.items()):
            cells = []
            for s in scen:
                sr = [r for r in vr if r["scenario"] == s]
                cells.append(f"{s}={sum(1 for r in sr if r['verdict']=='pass')}/{len(sr)}")
            print(f"    {v:<28} {' '.join(cells)}")


def compare(path, a, b):
    rows = load(path)
    pv = per_variant(rows)
    if a not in pv or b not in pv:
        sys.exit(f"need both variants in ledger; have {sorted(pv)}")
    ka = sum(1 for r in pv[a] if r["verdict"] == "pass")
    kb = sum(1 for r in pv[b] if r["verdict"] == "pass")
    z, p = two_prop(ka, len(pv[a]), kb, len(pv[b]))
    wa, wb = wilson(ka, len(pv[a])), wilson(kb, len(pv[b]))
    print(f"{a}: {ka}/{len(pv[a])} [{wa[1]:.2f},{wa[2]:.2f}]  vs  "
          f"{b}: {kb}/{len(pv[b])} [{wb[1]:.2f},{wb[2]:.2f}]")
    # Session blocking (2026-09-03 finding: byte-identical v1 dispatches went
    # 0/2 in one session and 2/2 in another — cross-session trials are NOT
    # exchangeable; comparisons are valid within-session only).
    for v in (a, b):
        by_sess = {}
        for r in pv[v]:
            s = r.get("session", "legacy")
            by_sess.setdefault(s, [0, 0])
            by_sess[s][1] += 1
            by_sess[s][0] += 1 if r["verdict"] == "pass" else 0
        parts = [f"{s}: {k}/{n}" for s, (k, n) in sorted(by_sess.items())]
        if parts:
            print(f"  {v} by session: {'; '.join(parts)}")
    for v in (a, b):
        sess_pass = {}
        for r in pv[v]:
            sess_pass.setdefault(r.get("session", "legacy"), []).append(r["verdict"] == "pass")
        rates = {s: sum(x) / len(x) for s, x in sess_pass.items() if x}
        if len(rates) > 1 and len(set(rates.values())) > 1:
            print(f"  WARNING: {v} outcome differs across sessions {rates} — subject "
                  f"non-stationarity; treat cross-session pooling as confounded and "
                  f"re-run as same-session interleaved A/B.")
    print(f"two-proportion z={z:.3f}, p={p:.3f}", end=" ")
    n = len(pv[a]) + len(pv[b])
    if n < 20:
        print(f"— n={n} < 20: DESCRIPTIVE ONLY (do not claim significance)")
    elif p < 0.05:
        print("— significant at p<0.05")
    else:
        print("— not significant")


def thompson(path, draws=2000):
    pv = per_variant(load(path))
    if len(pv) < 2:
        sys.exit("thompson needs >=2 variants")
    # seed from ledger content: same data -> same recommendation
    seed = int(hashlib.sha256(open(path, "rb").read()).hexdigest()[:8], 16)
    rng = random.Random(seed)
    post = {}
    for v, vr in sorted(pv.items()):
        k = sum(1 for r in vr if r["verdict"] == "pass")
        post[v] = (k + 1, len(vr) - k + 1)  # Beta(1+k, 1+n-k)
    samples = {v: [rng.betavariate(*a_b) for _ in range(draws)] for v, a_b in post.items()}
    wins = {v: 0 for v in post}
    for i in range(draws):
        best = max(samples, key=lambda v: samples[v][i])
        wins[best] += 1
    means = {v: a / (a + b) for v, (a, b) in post.items()}
    rec = max(wins, key=wins.get)
    print("posterior means:", {v: f"{m:.2f}" for v, m in means.items()})
    print("thompson win-share:", {v: f"{w/draws:.0%}" for v, w in wins.items()})
    print(f"NEXT TRIAL -> {rec} (seeded by ledger hash; decision procedure, not measurement)")


def current_variant(evals_root, skill):
    """The live variant = last promotion's to_variant; None if never promoted."""
    promo = os.path.join(evals_root, skill, "promotions.jsonl")
    if not os.path.exists(promo):
        return None
    rows = [json.loads(l) for l in open(promo) if l.strip()]
    return rows[-1]["to_variant"] if rows else None


def rank(evals_root):
    """Rank skills by Wilson LOWER bound of the CURRENT (promoted) variant —
    pooling all history understates the live incumbent (audited 2026-09-03:
    yaml-json-convert ranked 2/4 when its live v2 was 2/2)."""
    results = []
    for ledger in sorted(glob.glob(os.path.join(evals_root, "*", "trials.jsonl"))):
        skill = os.path.basename(os.path.dirname(ledger))
        rows = load(ledger)
        if not rows:
            continue
        cur = current_variant(evals_root, skill)
        if cur:
            rows = [r for r in rows if r["variant"] == cur] or rows
        k = sum(1 for r in rows if r["verdict"] == "pass")
        w = wilson(k, len(rows))
        results.append((w[1], skill, k, len(rows), cur or "all"))
    if not results:
        sys.exit("no trials found")
    print("skills by Wilson LOWER bound of CURRENT variant (weakest first):")
    for lb, skill, k, n, cur in sorted(results):
        print(f"  {skill:<32} {k}/{n} pass  LB={lb:.2f}  (variant: {cur})")


def oracle_mix_warning(path):
    rows = load(path)
    seen = {}
    for r in rows:
        o = r.get("oracle", "legacy")
        seen.setdefault((r["skill"], r["scenario"]), set()).add(o)
    mixes = {k: v for k, v in seen.items() if len(v) > 1}
    if mixes:
        print("WARNING: oracle versions mixed within a scenario (baseline comparability broken):")
        for (skill, scen), vers in sorted(mixes.items()):
            print(f"  {skill}/{scen}: {sorted(vers)}")
        print("  (pre-2026-09-03 rows carry no oracle hash; treat as legacy)")


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    path = sys.argv[1]
    if "--rank" in sys.argv:
        rank(sys.argv[sys.argv.index("--rank") + 1])
        return
    if "--compare" in sys.argv:
        i = sys.argv.index("--compare")
        compare(path, sys.argv[i + 1], sys.argv[i + 2])
        return
    if "--thompson" in sys.argv:
        thompson(path)
        return
    report(path)


if __name__ == "__main__":
    main()
