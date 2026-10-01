#!/usr/bin/env python3
"""Agent-based simulation of cmtymeet groups with the seat economy.

Standard library plus numpy only. One step = one day. See ../../../../../../todo/active/
cvld-gate-architecture/GROUPS-DESIGN.md for the model and the parameter meaning.

Usage:  python3 sim.py [--days 150] [--seed 1] [--set R=1.0 --set econ=0]
Prints one JSON object with the measured metrics.
"""
import argparse, json, math, sys
from dataclasses import dataclass, fields
import numpy as np


@dataclass
class Params:
    # world
    days: int = 150
    warmup: int = 50
    n0: int = 320
    arrivals: float = 1.2        # newcomers per day
    K: int = 8                   # interest clusters
    # seat economy (crbk settings in the design)
    econ: int = 1                # 0 = seat economy off (baseline)
    R: float = 1.0               # refill, seat points (sp) per day
    C: float = 10.0              # balance cap (sp), not hoardable
    w_min: float = 0.25          # weight in the trough (sp/day for a fully passive seat)
    w_small: float = 1.5         # extra weight at the tiny end
    n_lo: int = 7                # below this the weight rises
    w_big: float = 3.0           # extra weight at the cap
    n_hi: int = 60               # above this the weight rises
    cap: int = 100               # hard group cap
    tau: float = 1.0             # activity points per 7 days that make a seat free
    c_fork: float = 2.0          # seat points an exclusion fork costs its initiator
    beta: float = 1.2            # how strongly joiners avoid expensive groups
    fork_cooldown: int = 14      # days between exclusion forks per person
    # thresholds
    circle_max: int = 12
    ingroup_max: int = 42
    shrink_public: int = 36      # public -> ingroup (hysteresis)
    shrink_ingroup: int = 10     # ingroup -> circle (hysteresis)
    open_days: int = 21          # an opening room must reach 43 within this time
    # behaviour of people
    p_follow_block: float = 0.08 # share of bystanders who follow an exclusion fork of blockers
    p_follow_harm: float = 0.45
    p_greet: float = 0.3         # chance an active member greets a joiner; 0.12 without the welcome reward, assumed 0.3 with it
    p_wave: float = 0.35         # chance per qualifying interaction day that a Wave is sent
    gang_period: int = 14
    frac_gang: float = 0.04
    frac_tm: float = 0.02
    seed: int = 1


# ---------------------------------------------------------------- weight curve
def weight(n, p):
    v = p.w_min
    if n < p.n_lo:
        v += p.w_small * ((p.n_lo - n) / (p.n_lo - 2)) ** 2
    if n > p.n_hi:
        v += p.w_big * ((n - p.n_hi) / (p.cap - p.n_hi)) ** 2
    return v


LAMBDA = {"active": 2.0, "occasional": 0.25, "lurker": 0.02, "newcomer": 0.8, "tm": 1.5, "blocker": 0.6}
REACT = {"active": 3.0, "occasional": 0.6, "lurker": 0.15, "newcomer": 1.0, "tm": 1.0, "blocker": 1.0}
DESIRED = {"active": 4, "occasional": 2, "lurker": 3, "newcomer": 2, "tm": 3, "blocker": 3}
WAVE_CAP, WAVE_REFILL = 5.0, 1 / 3


class Person:
    __slots__ = ("id", "kind", "base", "cluster", "x", "balance", "groups", "act", "contacts", "waves",
                 "arrival", "first_conn", "tol", "last_fork", "gang", "joined", "exh", "bonus_week")

    def __init__(s, pid, kind, cluster, rng, day, newcomer=False):
        s.id, s.base, s.cluster = pid, kind, cluster
        s.kind = "newcomer" if newcomer else kind
        s.x = rng.random()
        s.balance = 5.0
        s.groups, s.act, s.contacts = set(), {}, set()
        s.waves, s.arrival, s.first_conn = 3.0, day, None
        s.tol = 2 + rng.exponential(2.0)
        s.last_fork, s.gang, s.joined, s.exh, s.bonus_week = -999, None, {}, 0, 0.0


class Group:
    __slots__ = ("id", "members", "cluster", "level", "listed", "seed", "born", "opening", "deadline",
                 "waitlist", "harm_day")

    def __init__(s, gid, cluster, day):
        s.id, s.members, s.cluster, s.born = gid, set(), cluster, day
        s.level, s.listed, s.seed, s.opening, s.deadline = "C", False, False, False, 0
        s.waitlist = set()


def level_for(n, p):
    return "C" if n <= p.circle_max else ("I" if n <= p.ingroup_max else "P")


class Sim:
    def __init__(s, p: Params):
        s.p = p
        s.rng = np.random.default_rng(p.seed)
        s.persons, s.groups = {}, {}
        s.pid = s.gid = 0
        s.pairs = {}
        s.harm = {}
        s.stat = dict(fission=0, fusion=0, upfork=0, opening_ok=0, opening_fail=0, excl_fork=0, gang_attacks=0,
                      gang_victim_larger=0, gang_followers=0, gang_attack_size=0, welcomes=0, welcome_credit=0.0,
                      exhaust_exits=0, forced_by_kind={}, seat_days_by_kind={}, passive_seat_days=0, seat_days=0,
                      cost_paid=0.0, cost_full=0.0, harm_events=0, harm_member_days=0, tm_member_days=0,
                      member_days=0, unhappy_exits=0, joins=0, joins_denied=0, dissolved=0, fork_cost=0.0,
                      group_days=0, hit_by_kind={}, count_by_kind={})
        s.snap = []
        s.newcomers = []
        s.gangs = []
        s.init_world()

    # ------------------------------------------------------------ setup
    def draw_kind(s):
        r = s.rng.random()
        p = s.p
        if r < p.frac_tm: return "tm"
        if r < p.frac_tm + p.frac_gang: return "blocker"
        r = s.rng.random()
        return "active" if r < 0.22 else ("occasional" if r < 0.70 else "lurker")

    def new_person(s, day, newcomer=False):
        kind = s.draw_kind()
        pr = Person(s.pid, kind, int(s.rng.integers(s.p.K)), s.rng, day, newcomer)
        s.persons[s.pid] = pr
        s.pid += 1
        if kind == "tm" or kind == "blocker":
            pass
        return pr

    def new_group(s, cluster, members, day):
        g = Group(s.gid, cluster, day)
        s.gid += 1
        s.groups[g.id] = g
        for m in members:
            s.add(g, m, day, welcome=False)
        g.level = level_for(len(g.members), s.p)
        return g

    def add(s, g, pr, day, welcome=True):
        g.members.add(pr.id)
        pr.groups.add(g.id)
        pr.act[g.id] = [0.0] * 7
        pr.joined[g.id] = day

    def remove(s, g, pr):
        g.members.discard(pr.id)
        pr.groups.discard(g.id)
        pr.act.pop(g.id, None)
        pr.joined.pop(g.id, None)
        s.harm.pop((pr.id, g.id), None)

    def init_world(s):
        p = s.p
        for _ in range(p.n0):
            s.new_person(-100)
        byc = {}
        for pr in s.persons.values():
            byc.setdefault(pr.cluster, []).append(pr.id)
        for c, ids in byc.items():  # contact graph inside clusters
            for a in ids:
                for b in ids:
                    if a < b and s.rng.random() < 5 / max(len(ids), 1):
                        s.persons[a].contacts.add(b); s.persons[b].contacts.add(a)
        # gangs
        bl = [x.id for x in s.persons.values() if x.kind == "blocker"]
        for i in range(0, len(bl), 5):
            chunk = bl[i:i + 5]
            c = s.persons[chunk[0]].cluster
            for m in chunk:
                s.persons[m].cluster = c
                s.persons[m].gang = i // 5
            for a in chunk:
                for b in chunk:
                    if a != b: s.persons[a].contacts.add(b)
            s.gangs.append(chunk)
        # initial groups
        for c, ids in byc.items():
            ids = [i for i in s.persons if s.persons[i].cluster == c]
            made = 0
            while made < len(ids) / 6:
                n = int(min(max(3, round(s.rng.lognormal(math.log(8), 0.6))), 30, len(ids)))
                mem = list(s.rng.choice(ids, size=n, replace=False))
                s.new_group(c, [s.persons[m] for m in mem], -100)
                made += 1
        # admin standing rooms: public from the start, seeds
        for c in range(min(4, p.K)):
            ids = list(s.persons)
            mem = list(s.rng.choice(ids, size=45, replace=False))
            g = s.new_group(c, [s.persons[m] for m in mem], -100)
            g.seed, g.listed, g.level = True, True, "P"

    # ------------------------------------------------------------ helpers
    def act_a(s, pr, gid):
        return min(1.0, sum(pr.act[gid]) / s.p.tau)

    def contact_in(s, pr, g):
        return any(c in g.members for c in pr.contacts)

    def dissolve(s, g):
        for m in list(g.members):
            s.remove(g, s.persons[m])
        s.groups.pop(g.id, None)
        s.stat["dissolved"] += 1

    def can_join(s, pr, g):
        p = s.p
        n = len(g.members)
        if pr.id in g.members: return False
        if g.listed or g.opening:
            return n < (p.cap if g.level == "P" else p.ingroup_max + 1 + 0)  # opening room takes the 43rd
        if g.level == "C": return n < p.circle_max and s.contact_in(pr, g)
        return n < p.ingroup_max and s.contact_in(pr, g)

    def fork_off(s, g, movers, day, level_hint=None, opening=False):
        """Create a new group from `movers` of g (who leave g). Returns the new group."""
        cl = g.cluster
        movers = [m for m in movers if m in g.members]
        for m in movers:
            s.remove(g, s.persons[m])
        ng = s.new_group(cl, [s.persons[m] for m in movers], day)
        if opening:
            ng.opening, ng.listed, ng.deadline = True, True, day + s.p.open_days
        if len(g.members) < 3:
            s.dissolve(g)
        return ng

    # ------------------------------------------------------------ daily step
    def step(s, day):
        p, rng, st = s.p, s.rng, s.stat
        slot = day % 7
        # arrivals
        for _ in range(rng.poisson(p.arrivals)):
            pr = s.new_person(day, newcomer=True)
            s.newcomers.append(pr.id)
        # ---- activity, posting, harm
        posters = {}
        for pr in s.persons.values():
            k = len(pr.groups)
            if pr.kind == "newcomer" and day - pr.arrival > 30:
                pr.kind = pr.base
            if day - pr.arrival < 0: continue
            pr.waves = min(WAVE_CAP, pr.waves + WAVE_REFILL)
            if day % 7 == 0: pr.bonus_week = 0.0
            if k == 0: continue
            lam, rea = LAMBDA[pr.kind] / k, REACT[pr.kind] / k
            for gid in pr.groups:
                pts = pr.act[gid]
                pts[slot] = 0.0
                posts = rng.poisson(lam)
                reacts = rng.poisson(rea) if pr.kind != "lurker" else (1 if rng.random() < 0.02 else 0)
                pts[slot] += min(posts, 2) + 0.3 * min(reacts, 4)
                if posts > 0:
                    posters.setdefault(gid, []).append(pr.id)
                    if pr.kind == "tm" and rng.random() < 0.4:
                        g = s.groups[gid]
                        att = 1 / (1 + len(g.members) / 40)
                        for m in g.members:
                            if m != pr.id and rng.random() < att:
                                s.harm[(m, gid)] = s.harm.get((m, gid), 0) + 1
                                st["harm_events"] += 1
        # ---- budget
        for pr in list(s.persons.values()):
            if not pr.groups: continue
            counted = day >= p.warmup
            kind = pr.kind
            costs = {}
            for gid in pr.groups:
                g = s.groups[gid]
                a = s.act_a(pr, gid)
                costs[gid] = (weight(len(g.members), p) * (1 - a), a)
                if counted:
                    st["seat_days"] += 1
                    st["seat_days_by_kind"][kind] = st["seat_days_by_kind"].get(kind, 0) + 1
                    if a < 0.2: st["passive_seat_days"] += 1
                    st["cost_full"] += weight(len(g.members), p)
            if not p.econ:
                if counted: st["cost_paid"] += 0
                for gid in list(pr.groups):  # inertia: passive seats are dropped rarely even for free
                    if costs[gid][1] < 0.2 and rng.random() < 0.004:
                        s.remove(s.groups[gid], pr)
                continue
            pr.balance = min(p.C, pr.balance + p.R)
            total = sum(c for c, _ in costs.values())
            exhausted = False
            while total > pr.balance and costs:
                gid = max(costs, key=lambda x: costs[x][0])
                total -= costs.pop(gid)[0]
                s.remove(s.groups[gid], pr)
                exhausted = True
                st["exhaust_exits"] += 1
                if counted:
                    st["forced_by_kind"][pr.base] = st["forced_by_kind"].get(pr.base, 0) + 1
            if exhausted and counted:
                pass
            pr.exh += 1 if exhausted else 0
            pr.balance -= total
            if counted: st["cost_paid"] += total
        # ---- interactions and connections
        for gid, ps in posters.items():
            if gid not in s.groups: continue
            g = s.groups[gid]
            if len(ps) < 2: continue
            for x in ps:
                y = ps[int(rng.integers(len(ps)))]
                if y == x: continue
                key = (min(x, y), max(x, y))
                s.pairs[key] = s.pairs.get(key, 0) + 1
                if s.pairs[key] >= 3:
                    px, py = s.persons[x], s.persons[y]
                    if y in px.contacts: continue
                    snd = px if px.waves >= py.waves else py
                    rcv = py if snd is px else px
                    if snd.waves >= 1 and rng.random() < p.p_wave:
                        snd.waves -= 1
                        if rng.random() < 0.6:
                            px.contacts.add(y); py.contacts.add(x)
                            for q in (px, py):
                                if q.first_conn is None: q.first_conn = day
        # ---- troublemaker response (exit, then exclusion fork)
        for gid in list(s.groups):
            g = s.groups.get(gid)
            if g is None: continue
            tms = [m for m in g.members if s.persons[m].kind == "tm"]
            if day >= p.warmup:
                st["group_days"] += 1
                st["member_days"] += len(g.members)
                if tms: st["tm_member_days"] += len(g.members)
            for m in list(g.members):
                k = (m, gid)
                if k in s.harm: s.harm[k] *= 0.85
            if not tms: continue
            unhappy = [m for m in g.members if s.harm.get((m, gid), 0) > s.persons[m].tol and s.persons[m].kind != "tm"]
            if day >= p.warmup: st["harm_member_days"] += len(unhappy)
            if len(unhappy) >= max(2, math.ceil(0.12 * len(g.members))):
                init = s.persons[unhappy[int(rng.integers(len(unhappy)))]]
                if day - init.last_fork >= p.fork_cooldown:
                    init.last_fork = day
                    if p.econ: init.balance = max(0.0, init.balance - p.c_fork); st["fork_cost"] += p.c_fork
                    movers = set(unhappy) | {m for m in g.members if s.persons[m].kind != "tm" and m not in unhappy
                                             and rng.random() < p.p_follow_harm}
                    if len(movers) >= 3 and len(g.members) - len(movers) >= 1:
                        s.fork_off(g, movers, day)
                        st["excl_fork"] += 1
            else:
                for m in unhappy:
                    if rng.random() < 0.25:
                        s.remove(g, s.persons[m]); st["unhappy_exits"] += 1
        # ---- gangs (coordinated blockers)
        if day >= 20 and day % p.gang_period == 0:
            for chunk in s.gangs:
                for gid, g in list(s.groups.items()):
                    mem_g = [m for m in chunk if m in g.members and day - s.persons[m].last_fork >= p.fork_cooldown]
                    if len(mem_g) >= 3 and len(g.members) >= 8 and gid in s.groups:
                        victims = [m for m in g.members if m not in chunk and s.persons[m].kind in ("active", "occasional")]
                        if not victims: continue
                        v = victims[int(rng.integers(len(victims)))]
                        init = s.persons[mem_g[0]]
                        init.last_fork = day
                        if p.econ: st["fork_cost"] += p.c_fork
                        movers = set(mem_g) | {m for m in g.members if m not in chunk and m != v and rng.random() < p.p_follow_block}
                        rest = len(g.members) - len(movers)
                        st["gang_attacks"] += 1
                        st["gang_followers"] += len(movers) - len(mem_g)
                        st["gang_attack_size"] += len(g.members)
                        if rest >= len(movers): st["gang_victim_larger"] += 1
                        if len(movers) >= 3 and rest >= 1:
                            s.fork_off(g, movers, day)
                        break
        # ---- joining and creating
        glist = list(s.groups.values())
        for pr in list(s.persons.values()):
            k = len(pr.groups)
            need = k < DESIRED[pr.kind]
            if rng.random() < (0.08 if need else 0.004):
                if p.econ and pr.balance < 3 * p.w_min * 3: continue
                newc = pr.kind == "newcomer" and not pr.contacts
                cands, ws = [], []
                for g in glist:
                    if g.id not in s.groups or pr.id in g.members: continue
                    if newc and not (g.listed or g.opening): continue
                    n = len(g.members)
                    if not s.can_join(pr, g):
                        if (g.listed or g.opening or s.contact_in(pr, g)) and n >= (p.circle_max if g.level == "C" else p.ingroup_max):
                            if g.level != "P": g.waitlist.add(pr.id); s.stat["joins_denied"] += 1
                        continue
                    aff = 1.0 if g.cluster == pr.cluster else 0.15
                    wgt = aff * math.sqrt(n + 1) * (math.exp(-p.beta * weight(n + 1, p) * (0.5 if pr.kind in ("active", "newcomer") else 1.0)) if p.econ else 1.0)
                    cands.append(g); ws.append(wgt)
                if cands:
                    ws = np.array(ws); g = cands[int(rng.choice(len(cands), p=ws / ws.sum()))]
                    s.add(g, pr, day); st["joins"] += 1
                    # welcome by active members (earns reciprocity; no Wave is spent by the joiner)
                    act = [m for m in g.members if m != pr.id and sum(s.persons[m].act[g.id]) > 0]
                    for m in act[:20]:
                        if rng.random() < p.p_greet:
                            q = s.persons[m]
                            s.pairs[(min(m, pr.id), max(m, pr.id))] = s.pairs.get((min(m, pr.id), max(m, pr.id)), 0) + 3
                            if q.bonus_week < 1.0:
                                q.waves = min(WAVE_CAP, q.waves + 0.25); q.bonus_week += 0.25
                                st["welcome_credit"] += 0.25
                            q.act[g.id][slot] += 2
                            st["welcomes"] += 1
                elif rng.random() < 0.3 and len(pr.contacts) >= 2 and k < DESIRED[pr.kind] + 1:
                    pool = list(pr.contacts)
                    n_inv = min(len(pool), int(rng.integers(2, 5)))
                    inv = [pool[i] for i in rng.choice(len(pool), size=n_inv, replace=False)]
                    inv = [m for m in inv if len(s.persons[m].groups) < DESIRED[s.persons[m].kind] + 1 and rng.random() < 0.5]
                    if len(inv) >= 2:
                        g = s.new_group(pr.cluster, [pr] + [s.persons[m] for m in inv], day)
        # ---- levels, fission, fusion, up-forks
        for gid in list(s.groups):
            g = s.groups.get(gid)
            if g is None: continue
            n = len(g.members)
            if n < 3: s.dissolve(g); continue
            if g.opening:
                if n >= p.ingroup_max + 1:
                    g.opening, g.level = False, "P"; st["opening_ok"] += 1
                elif day >= g.deadline:
                    g.opening, g.listed = False, False; g.level = level_for(n, p); st["opening_fail"] += 1
                continue
            if not g.seed:  # hysteresis: only toward more privacy, and only after shrinking
                if g.level == "P" and n <= p.shrink_public: g.level, g.listed = "I", False
                if g.level == "I" and n <= p.shrink_ingroup: g.level = "C"
            # up-fork at the boundary when people are waiting
            if g.level == "C" and n >= p.circle_max and g.waitlist and rng.random() < 0.1:
                movers = {m for m in g.members if rng.random() < 0.8}
                wl = {w for w in g.waitlist if w in s.persons and w not in g.members}
                if len(movers) + len(wl) >= p.circle_max + 1:
                    ng = s.fork_off(g, movers, day)
                    for w in wl: s.add(ng, s.persons[w], day)
                    ng.level = "I"; st["upfork"] += 1
                g.waitlist = set()
            elif g.level == "I" and n >= p.ingroup_max and g.waitlist and rng.random() < 0.1:
                movers = {m for m in g.members if rng.random() < 0.6}
                if len(movers) >= 8:
                    ng = s.fork_off(g, movers, day, opening=True)
                    for w in g.waitlist:
                        if w in s.persons and w not in ng.members and len(ng.members) < p.ingroup_max + 1:
                            s.add(ng, s.persons[w], day)
                    st["upfork"] += 1
                g.waitlist = set()
            # fission
            if n > p.n_hi and gid in s.groups:
                wr = weight(n, p) / p.w_min - 1
                rate = 0.01 + (0.3 * min(1.0, wr) if p.econ else 0.0)
                if rng.random() < rate:
                    mem = sorted(g.members, key=lambda m: s.persons[m].x)
                    half = mem[n // 2:]
                    movers = [m for m in half if rng.random() < 0.85]
                    if len(movers) >= 3 and n - len(movers) >= 3:
                        ng = s.fork_off(g, movers, day); st["fission"] += 1
                        ng.level = level_for(len(ng.members), p)
                        if ng.level == "P": ng.listed = True
        # fusion of small groups
        small = [g for g in s.groups.values() if len(g.members) < p.n_lo and not g.opening]
        for g in small:
            if g.id not in s.groups: continue
            n = len(g.members)
            rate = 0.01 + (0.3 * min(1.0, (weight(n, p) / p.w_min - 1) / 3) if p.econ else 0.0)
            if rng.random() >= rate: continue
            best, bj = None, 0.0
            for h in s.groups.values():
                if h.id == g.id or h.opening or h.cluster != g.cluster: continue
                u = len(g.members | h.members)
                if u > p.circle_max: continue
                j = len(g.members & h.members) / u
                if j > bj: best, bj = h, j
            if best is not None and bj >= 0.4:
                union = g.members | best.members
                movers = [m for m in union if rng.random() < 0.85]
                if len(movers) >= 3:
                    for m in movers:
                        for old in (g, best):
                            if m in old.members: s.remove(old, s.persons[m])
                    ng = s.new_group(g.cluster, [s.persons[m] for m in movers], day)
                    st["fusion"] += 1
                    for old in (g, best):
                        if old.id in s.groups and len(old.members) < 3: s.dissolve(old)
        # ---- snapshot
        if day >= p.warmup and day % 5 == 0:
            s.snap.append([len(g.members) for g in s.groups.values()])

    # ------------------------------------------------------------ results
    def run(s):
        for d in range(s.p.days):
            s.step(d)
        return s.metrics()

    def metrics(s):
        p, st = s.p, s.stat
        sizes = [x for sn in s.snap for x in sn]
        seats = np.array(sizes, dtype=float)
        tot = seats.sum() or 1.0
        bands = {"3-6": (3, 6), "7-12": (7, 12), "13-42": (13, 42), "43-60": (43, 60), "61-100": (61, 100)}
        seat_share = {b: round(float(seats[(seats >= lo) & (seats <= hi)].sum() / tot), 3) for b, (lo, hi) in bands.items()}
        trough = float(seats[(seats >= p.n_lo) & (seats <= p.n_hi)].sum() / tot)
        gd = max(st["group_days"], 1)
        # newcomers (arrived after warmup start, tenure >= 30 days)
        nc = [s.persons[i] for i in s.newcomers if s.p.days - s.persons[i].arrival >= 30 and s.persons[i].arrival >= p.warmup - 30]
        tt = [(q.first_conn - q.arrival) for q in nc if q.first_conn is not None]
        within = lambda d: round(sum(1 for q in nc if q.first_conn is not None and q.first_conn - q.arrival <= d) / max(len(nc), 1), 3)
        by_kind = {}
        for q in s.persons.values():
            by_kind.setdefault(q.base, []).append(q)
        ex = {}
        for kind, lst in by_kind.items():
            sd = st["seat_days_by_kind"].get(kind, 0)
            forced = st["forced_by_kind"].get(kind, 0)
            ex[kind] = round(1000 * forced / max(sd, 1), 2)
        ex_share = {k: round(sum(1 for q in v if q.exh > 0) / len(v), 3) for k, v in by_kind.items()}
        gal = st["gang_attacks"]
        return {
            "params": {f.name: getattr(p, f.name) for f in fields(p)},
            "groups_end": len(s.groups), "persons_end": len(s.persons),
            "mean_size": round(float(seats.mean()), 1) if len(seats) else 0,
            "seat_share_by_band": seat_share, "trough_share": round(trough, 3),
            "tiny_share": seat_share["3-6"], "overfull_share": seat_share["61-100"],
            "passive_seat_share": round(st["passive_seat_days"] / max(st["seat_days"], 1), 3),
            "cost_paid_over_full": round(st["cost_paid"] / max(st["cost_full"], 1e-9), 3) if p.econ else None,
            "fission_per_1000_group_days": round(1000 * st["fission"] / gd, 2),
            "fusion_per_1000_group_days": round(1000 * st["fusion"] / gd, 2),
            "upforks": st["upfork"], "opening_ok": st["opening_ok"], "opening_fail": st["opening_fail"],
            "newcomers_measured": len(nc), "newcomer_connected_14d": within(14), "newcomer_connected_30d": within(30),
            "newcomer_median_days_to_connection": float(np.median(tt)) if tt else None,
            "newcomer_never_connected": round(sum(1 for q in nc if q.first_conn is None) / max(len(nc), 1), 3),
            "welcomes": st["welcomes"],
            "exhaust_exits_per_1000_seat_days_by_kind": ex, "share_ever_exhausted_by_kind": ex_share,
            "tm_exposure_share_of_member_days": round(st["tm_member_days"] / max(st["member_days"], 1), 3),
            "harm_events": st["harm_events"], "unhappy_member_days": st["harm_member_days"],
            "exclusion_forks": st["excl_fork"], "unhappy_exits": st["unhappy_exits"],
            "gang_attacks": gal,
            "gang_victim_in_larger_fork": round(st["gang_victim_larger"] / gal, 3) if gal else None,
            "gang_mean_bystander_followers": round(st["gang_followers"] / gal, 2) if gal else None,
            "gang_mean_group_size": round(st["gang_attack_size"] / gal, 1) if gal else None,
        }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--set", action="append", default=[])
    ap.add_argument("--days", type=int)
    ap.add_argument("--seed", type=int)
    a = ap.parse_args()
    p = Params()
    for kv in a.set:
        k, v = kv.split("=")
        setattr(p, k, type(getattr(p, k))(float(v)) if not isinstance(getattr(p, k), int) else int(float(v)))
    if a.days: p.days = a.days
    if a.seed: p.seed = a.seed
    print(json.dumps(Sim(p).run(), indent=1))


if __name__ == "__main__":
    main()
