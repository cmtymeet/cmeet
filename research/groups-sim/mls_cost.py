#!/usr/bin/env python3
"""Back-of-envelope MLS (RFC 9420) and relay costs for groups of size n.

Ciphersuite 1 (X25519, AES-128-GCM, SHA-256, Ed25519). Sizes are estimates from the RFC
wire formats; the CPU figures are order-of-magnitude assumptions to be replaced by the load test.
"""
import math

LEAF = 300        # LeafNode: enc key 34 + sig key 34 + basic credential ~60 + capabilities ~60 + lifetime 18 + signature 66
PARENT = 70       # ParentNode: enc key 34 + parent hash 33 + unmerged leaves (small)
HPKE_CT = 34 + 32 + 16 + 2   # kem_output + path secret + tag + length
PATH_NODE = 34 + HPKE_CT     # public key + one ciphertext (resolution size 1 in a balanced tree)
KP = 330                     # KeyPackage
HPKE_US = {"native": 60, "wasm": 300}   # microseconds per X25519 HPKE op (assumption)


def tree_bytes(n):
    return n * LEAF + (n - 1) * PARENT


def commit_bytes(n):
    return LEAF + math.ceil(math.log2(max(n, 2))) * PATH_NODE + 120


def row(n):
    d = math.ceil(math.log2(max(n, 2)))
    welcome = tree_bytes(n) + 200            # one Welcome carries the ratchet tree
    fork_total = n * welcome                 # creator uploads one Welcome per member
    ext_join = tree_bytes(n) + 600           # joiner downloads GroupInfo with tree, sends 1 commit
    commit_fan = commit_bytes(n) * (n - 1)   # relay fan-out of one commit
    proc = {k: d * 2 * us / 1000 for k, us in HPKE_US.items()}   # ms per received commit: ~2 HPKE per level + KDF
    create_cpu = {k: (n * 2 * us + n * 20) / 1000 for k, us in HPKE_US.items()}   # n welcomes sealed (ms)
    return n, tree_bytes(n) / 1e3, commit_bytes(n), welcome / 1e3, fork_total / 1e6, ext_join / 1e3, commit_fan / 1e3, proc["wasm"], create_cpu["wasm"]


if __name__ == "__main__":
    print("n | tree kB | commit B | Welcome kB | fork upload MB (n Welcomes) | external-join download kB | commit fan-out kB | commit CPU ms (wasm) | fork CPU ms (wasm)")
    for n in (3, 12, 24, 42, 60, 100, 150, 250, 500, 1000, 2000):
        r = row(n)
        print(f"{r[0]} | {r[1]:.1f} | {r[2]} | {r[3]:.1f} | {r[4]:.2f} | {r[5]:.1f} | {r[6]:.1f} | {r[7]:.2f} | {r[8]:.0f}")
    print()
    print("relay fan-out per room: deliveries/s = n * active_share * msgs_per_active_per_min / 60 * n (each message to n-1 listeners)")
    for n in (42, 100, 150, 250, 500, 1000):
        for share, rate in ((0.1, 0.5), (0.25, 1.0)):
            msgs = n * share * rate / 60
            print(f"n={n} active={share:.0%} rate={rate}/min -> {msgs:.2f} msg/s in, {msgs * (n - 1):.0f} deliveries/s out")
    print()
    print("presence heartbeat (30 s renewal) writes/s for N connected member-room pairs:")
    for N in (1e3, 1e4, 1e5):
        print(f"N={int(N)} -> {N / 30:.0f} renewals/s")
    print()
    print("join storm: commits are serialised per room; one commit per ordering round trip (assume 0.4 s) -> ~2.5 joins/s/room;")
    print("a burst of j simultaneous joins converges in about j * 0.4 s with retries on the losing commits.")
