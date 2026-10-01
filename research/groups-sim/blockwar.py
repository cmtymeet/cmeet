#!/usr/bin/env python3
"""Monte Carlo of one coordinated exclusion fork: B blockers in a group of n try to fork away from an
innocent victim; every bystander follows the blockers with probability f. Reports how often the victim
stays in the larger fork (which keeps the listing of a public room) and the mean size of the forks.
Nobody is expelled: the victim stays where they are, the blockers leave.
"""
import numpy as np

rng = np.random.default_rng(7)
print("n  B  f    P(victim in larger fork)  mean blockers' fork size  mean remaining size")
for n in (8, 12, 20, 42, 60):
    for B in (3, 5, 8):
        if B >= n - 2: continue
        for f in (0.05, 0.2, 0.4, 0.6):
            by = n - B - 1                      # bystanders without victim
            follow = rng.binomial(by, f, size=20000)
            fork = B + follow
            rest = n - fork
            win = (rest >= fork).mean()         # tie goes to the older lineage, i.e. the victim's group
            print(f"{n:<3}{B:<3}{f:<5}{win:<26.3f}{fork.mean():<26.1f}{rest.mean():.1f}")
