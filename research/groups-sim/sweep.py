#!/usr/bin/env python3
"""Parameter sweeps for the groups simulation. Writes results/*.csv.

Usage: python3 sweep.py [baseline|sweep|all]
"""
import csv, itertools, sys, os, statistics
from dataclasses import replace
from sim import Params, Sim

SEEDS = (1, 2, 3)
DAYS = 200
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "results")
NAN = float("nan")

COLS = [("trough", lambda m: m["trough_share"]), ("tiny", lambda m: m["tiny_share"]), ("overfull", lambda m: m["overfull_share"]),
        ("passive", lambda m: m["passive_seat_share"]), ("meansize", lambda m: m["mean_size"]),
        ("fis", lambda m: m["fission_per_1000_group_days"]), ("fus", lambda m: m["fusion_per_1000_group_days"]),
        ("conn14", lambda m: m["newcomer_connected_14d"]), ("conn30", lambda m: m["newcomer_connected_30d"]),
        ("med_days", lambda m: m["newcomer_median_days_to_connection"] or NAN),
        ("exh_occ", lambda m: m["share_ever_exhausted_by_kind"].get("occasional", 0)),
        ("exh_lur", lambda m: m["share_ever_exhausted_by_kind"].get("lurker", 0)),
        ("exh_act", lambda m: m["share_ever_exhausted_by_kind"].get("active", 0)),
        ("tm_expo", lambda m: m["tm_exposure_share_of_member_days"]), ("excl", lambda m: m["exclusion_forks"]),
        ("gang_win", lambda m: m["gang_victim_in_larger_fork"] if m["gang_victim_in_larger_fork"] is not None else NAN),
        ("paid", lambda m: m["cost_paid_over_full"] if m["cost_paid_over_full"] is not None else NAN)]


def run(p0, **kw):
    rows = []
    for sd in SEEDS:
        m = Sim(replace(p0, days=DAYS, seed=sd, **kw)).run()
        rows.append([f(m) for _, f in COLS])
    return [round(statistics.fmean(c), 3) for c in zip(*rows)]


def table(name, grid, base):
    keys = list(grid)
    with open(os.path.join(OUT, name + ".csv"), "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(keys + [c for c, _ in COLS])
        for vals in itertools.product(*grid.values()):
            r = run(base, **dict(zip(keys, vals)))
            w.writerow(list(vals) + r)
            print(dict(zip(keys, vals)), dict(zip([c for c, _ in COLS], r)), flush=True)


if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "all"
    os.makedirs(OUT, exist_ok=True)
    base = Params()
    if what in ("baseline", "all"):
        table("baseline", {"econ": [0, 1], "p_greet": [0.12, 0.3]}, base)
    if what in ("sweep", "all"):
        table("sweep_refill_cap", {"R": [0.5, 0.75, 1.0, 1.5], "C": [5.0, 10.0, 20.0]}, base)
        table("sweep_weight", {"w_min": [0.15, 0.25, 0.4], "w_small": [0.75, 1.5, 3.0], "w_big": [1.5, 3.0, 6.0]}, base)
        table("sweep_tau", {"tau": [0.5, 1.0, 2.0, 3.0]}, base)
        table("sweep_nhi", {"n_hi": [40, 50, 60, 75], "n_lo": [5, 7, 9]}, base)
        table("sweep_welcome", {"p_greet": [0.0, 0.12, 0.3, 0.5], "p_wave": [0.2, 0.35, 0.6]}, base)
        table("sweep_conflict", {"p_follow_block": [0.0, 0.08, 0.2, 0.4], "c_fork": [0.0, 2.0, 5.0], "fork_cooldown": [7, 14, 28]}, base)
