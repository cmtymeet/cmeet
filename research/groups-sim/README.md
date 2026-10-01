# groups-sim

Agent-based simulation behind `todo/active/cvld-gate-architecture/GROUPS-DESIGN.md` (Python 3 + numpy).

| File | Purpose | Runtime |
|---|---|---|
| `sim.py` | the simulation (`python3 sim.py --days 200 --seed 1 --set R=1.0`) | about 1.5 s per 200-day run |
| `sweep.py` | parameter sweeps, writes `results/*.csv` (`python3 sweep.py all`) | about 15 min, 3 seeds each |
| `blockwar.py` | Monte Carlo of one coordinated exclusion fork | seconds |
| `mls_cost.py` | RFC 9420 size and relay-load estimates | instant |
