#!/usr/bin/env python3
"""Pareto-frontier analysis for skill-forge trials ledgers. stdlib only.

Hermes port (GEPA core, MIT): GEPA accepts a candidate when it EXPANDS the
Pareto frontier over per-task scores, not when it wins on a scalar average —
per-instance dominance survives mixed profiles that averaging destroys. We
adapt that to binary per-scenario verdicts:

  variant A dominates B  iff  for every scenario B was tried on:
    - A was tried on it too (n_A >= n_B — dominance needs evidence, and
      more evidence at the same rate is itself informative), and
    - A's pass rate on it >= B's, with a STRICT win on at least one scenario.

The frontier is the set of undominated variants. A candidate worth promoting
must enter the frontier; promote.py G3 encodes the same dominance pairwise.

Modes:
  pareto.py <trials.jsonl>                          summary + frontier
  pareto.py <trials.jsonl> --target                 next mutation target
  pareto.py <trials.jsonl> --plateau <promotions.jsonl>   stop-rule check
  pareto.py <trials.jsonl> --json                   machine-readable

Plateau rule (hermes "regenerate eval data when the loop stalls"): if the
last 2 promotions both failed to ADD a variant to the frontier, the text-
mutation loop has stalled — write a NEW SCENARIO next (mined from sessions
or weak-spots), not another body mutation. A stalled frontier with a 1-
scenario suite means the skill is overfit to that scenario, not solved.
"""
import json
import sys


def load(path):
    try:
        return [json.loads(l) for l in open(path) if l.strip()]
    except FileNotFoundError:
        sys.exit(f"no such ledger: {path}")


def profile(rows):
    """variant -> {scenario: (passes, trials)}"""
    out = {}
    for r in rows:
        v, s = r["variant"], r["scenario"]
        k, n = out.setdefault(v, {}).get(s, (0, 0))
        out[v][s] = (k + (1 if r["verdict"] == "pass" else 0), n + 1)
    return out


def dominates(a, b, prof):
    """True iff variant a dominates variant b (see module docstring)."""
    strict = False
    for s, (kb, nb) in prof[b].items():
        if s not in prof[a]:
            return False, f"coverage gap: {a} untried on {s}"
        ka, na = prof[a][s]
        if na < nb:
            return False, f"evidence deficit: {a} {na} trials on {s} vs {b} {nb}"
        ra, rb = ka / na, kb / nb
        if ra < rb:
            return False, f"{s}: rate {ra:.2f} < {rb:.2f}"
        if ra > rb:
            strict = True
    return strict, "dominates" if strict else "equal profile (non-dominating)"


def frontier(prof):
    members = sorted(prof)
    front, dominated = [], {}
    for v in members:
        beaten_by = [o for o in members if o != v and dominates(o, v, prof)[0]]
        if beaten_by:
            dominated[v] = beaten_by
        else:
            front.append(v)
    return front, dominated


def best_variant(prof, front, promo_rows):
    """Frontier member to defend/extend: the last promoted variant if it is
    still on the frontier, else the frontier member with the most trials."""
    if promo_rows:
        cur = promo_rows[-1]["to_variant"]
        if cur in front:
            return cur
    return max(front, key=lambda v: sum(n for _, n in prof[v].values()))


def target(rows, prof, front, promo_rows):
    """Next mutation target: lowest pass-rate scenario of the best frontier
    variant, with its failing trial ids for MUTATION.md citation (G4)."""
    v = best_variant(prof, front, promo_rows)
    scen = sorted(prof[v].items(), key=lambda kv: (kv[1][0] / kv[1][1], kv[0]))
    s, (k, n) = scen[0]
    fails = [f"{r['run']}" for r in rows
             if r["variant"] == v and r["scenario"] == s and r["verdict"] != "pass"]
    return v, s, k, n, fails


def _parse_ts(t):
    from datetime import datetime
    for fmt in ("ISO",):
        try:
            return datetime.fromisoformat(t.replace("Z", "+00:00"))
        except ValueError:
            pass
    try:
        return datetime.strptime(t, "%Y%m%dT%H%M%SZ").replace(tzinfo=datetime.now().astimezone().tzinfo)
    except ValueError:
        return None


def plateau(promo_path, rows):
    """Point-in-time replay: a promotion 'expanded the frontier' iff its
    to_variant was on the frontier computed from trials recorded UP TO that
    promotion's ts (judging old promotions against today's frontier would be
    anachronistic evidence). If the last 2 promotions both failed to join
    their contemporary frontier, the text-mutation loop has stalled — write a
    NEW SCENARIO next (mined from sessions or weak-spots), not another body
    mutation. A stalled frontier with a 1-scenario suite means the skill is
    overfit to that scenario, not solved."""
    try:
        promos = [json.loads(l) for l in open(promo_path) if l.strip()]
    except FileNotFoundError:
        return "NO-PROMOTIONS", "no promotions.jsonl — nothing to check"
    if len(promos) < 2:
        return "INSUFFICIENT", (f"{len(promos)} promotion(s) on record — "
                                "plateau verdict needs >= 2")
    verdicts = []
    for p in promos[-2:]:
        cut = _parse_ts(p.get("ts", ""))
        if cut is None:
            return "INSUFFICIENT", f"promotion ts unparsable: {p.get('ts')!r}"
        prof_t = profile([r for r in rows if (_parse_ts(r["ts"]) or cut) <= cut])
        front_t, _ = frontier(prof_t)
        verdicts.append((p["to_variant"], p["to_variant"] in front_t))
    stalled = [v for v, on in verdicts if not on]
    if len(stalled) == 2:
        return "PLATEAU", (f"last 2 promotions ({', '.join(stalled)}) never entered their "
                           "contemporary frontier — write a NEW SCENARIO next, not a body mutation")
    return "ALIVE", ("recent promotions joined their contemporary frontier: "
                     + "; ".join(f"{v}={'on' if on else 'off'}" for v, on in verdicts))


def main():
    args = sys.argv[1:]
    if not args or args[0] in ("-h", "--help"):
        sys.exit(__doc__)
    rows = load(args[0])
    if not rows:
        sys.exit("ledger empty")
    prof = profile(rows)
    front, dominated = frontier(prof)
    promo_rows = []
    promo_path = None
    if "--plateau" in args:
        promo_path = args[args.index("--plateau") + 1]
        try:
            promo_rows = [json.loads(l) for l in open(promo_path) if l.strip()]
        except FileNotFoundError:
            pass

    if "--json" in args:
        print(json.dumps({
            "variants": {v: {s: {"k": k, "n": n} for s, (k, n) in sv.items()}
                         for v, sv in prof.items()},
            "frontier": front,
            "dominated": dominated,
            "target": dict(zip(("variant", "scenario", "k", "n", "failing_runs"),
                               target(rows, prof, front, promo_rows))),
        }, indent=2))
        return

    print(f"ledger: {len(rows)} trials, {len(prof)} variants")
    for v in sorted(prof):
        cells = "  ".join(f"{s}={k}/{n}" for s, (k, n) in sorted(prof[v].items()))
        tag = "FRONTIER" if v in front else f"dominated by {dominated[v]}"
        print(f"  {v:<32} {cells}   [{tag}]")
    print(f"frontier: {front}")

    v, s, k, n, fails = target(rows, prof, front, promo_rows)
    print(f"NEXT MUTATION TARGET -> variant {v}, scenario {s} ({k}/{n} pass)"
          + (f" — cite failing runs: {', '.join(fails)}" if fails else " — no fails on record: target the weakest rate or add a harder scenario"))

    if promo_path:
        st, detail = plateau(promo_path, rows)
        print(f"PLATEAU CHECK [{st}]: {detail}")


if __name__ == "__main__":
    main()
