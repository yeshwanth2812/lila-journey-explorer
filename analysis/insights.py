#!/usr/bin/env python3
"""Reproduces every number quoted in INSIGHTS.md from the generated web/data/*.json.

    python analysis/insights.py            # needs only Python 3 + Pillow (Pillow only for the playable-area mask)

Definitions: human = journey without BotPosition (pipeline rule). Death = Killed | BotKilled | KilledByStorm
on a human journey. Grids are over the minimap UV square. 'Playable' cells = minimap brightness > 25 (approximation).
"""
import json, os, statistics as st
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web")
E = dict(Position=0, BotPosition=1, Loot=2, Kill=3, Killed=4, BotKill=5, BotKilled=6, KilledByStorm=7)
idx = json.load(open(f"{ROOT}/data/index.json")); Q = idx["q"]

def load(m): return json.load(open(f"{ROOT}/data/{m}.json"))["matches"]
def journeys(matches, human=True):
    for m in matches:
        for p in m["p"]:
            if p["bot"] != human: yield m, p
def grid(points, G):
    g = [[0] * G for _ in range(G)]
    for u, v in points: g[min(G - 1, int(v / Q * G))][min(G - 1, int(u / Q * G))] += 1
    return g
def pts(matches, codes, human=True):
    for _, p in journeys(matches, human):
        for t, u, v, e in zip(p["t"], p["u"], p["v"], p["e"]):
            if e in codes: yield u, v
def flat(g): return [c for r in g for c in r]

allm = {k: load(k) for k in idx["maps"]}
H = [(m, p) for k in allm for m, p in journeys(allm[k])]
print("== Insight 1: who kills whom ==")
n_h = {}; 
for k in allm:
    for m in allm[k]: n_h[m["id"]] = sum(not p["bot"] for p in m["p"])
print("matches", len(n_h), "| with <=1 human journey", sum(v <= 1 for v in n_h.values()), "| with >=2", sum(v >= 2 for v in n_h.values()))
cnt = lambda c: sum(e == c for _, p in H for e in p["e"])
print("human journeys", len(H), "| bot kills by humans", cnt(5), "| PvP kills", cnt(3))
d = {c: cnt(c) for c in (6, 7, 4)}; tot = sum(d.values())
print("human deaths", tot, {n: f"{d[c]} ({d[c]/tot:.1%})" for n, c in (("bot", 6), ("storm", 7), ("pvp", 4))})
died = lambda p: any(e in (4, 6, 7) for e in p["e"])
for k in allm:
    js = list(journeys(allm[k])); print(f"  {k}: journeys {len(js)}, died {sum(died(p) for _, p in js)/len(js):.1%}")
dt = [t for _, p in H for t, e in zip(p["t"], p["e"]) if e in (4, 6)]
storm = [t for _, p in H for t, e in zip(p["t"], p["e"]) if e == 7]
print(f"median death (non-storm) {st.median(dt)/60:.2f} min | storm deaths {len(storm)} between {min(storm)}s and {max(storm)}s")

print("\n== Insight 2: death clustering & lethality (16x16 grid) ==")
G = 16
for k, ms in allm.items():
    T = grid(pts(ms, {0}), G); D = grid(pts(ms, {4, 6, 7}), G)
    tt, dd = sum(flat(T)), sum(flat(D)); s = sorted(flat(D), reverse=True); acc = 0
    need = {}
    for i, c in enumerate(s, 1):
        acc += c
        for th in (.5, .8):
            if acc / dd >= th and th not in need: need[th] = i
    busy = [(D[j][i] / T[j][i] * 100, i, j) for j in range(G) for i in range(G) if T[j][i] >= tt * .01]
    print(f"{k}: deaths {dd}, visited cells {sum(c > 0 for c in flat(T))}, cells for 50%/80% of deaths {need[.5]}/{need[.8]}, median busy-cell deaths/100 samples {st.median(b[0] for b in busy):.2f}")
    top = sorted(((D[j][i], i, j) for j in range(G) for i in range(G)), reverse=True)[:4]
    for c, i, j in top:
        print(f"   cell px({int((i+.5)/G*1024)},{int((1-(j+.5)/G)*1024)}) deaths {c} = {c/dd:.1%} of deaths, {T[j][i]/tt:.1%} of traffic, {c/max(1,T[j][i])*100:.1f}/100 samples")

print("\n== Insight 3: unused area & loot concentration ==")
try:
    from PIL import Image
    G = 32
    for k, ms in allm.items():
        im = Image.open(f"{ROOT}/maps/{k}.webp").convert("L").resize((G * 8, G * 8))
        px = im.load(); play = [[sum(px[i * 8 + a, (G - 1 - j) * 8 + b] for a in range(8) for b in range(8)) / 64 > 25 for i in range(G)] for j in range(G)]
        T = grid(pts(ms, {0, 1}, True), G); Tb = grid(pts(ms, {0, 1}, False), G)
        T = [[a + b for a, b in zip(r1, r2)] for r1, r2 in zip(T, Tb)]; tot = sum(flat(T))
        cells = sorted((T[j][i] for j in range(G) for i in range(G) if play[j][i]), reverse=True); n = len(cells)
        print(f"{k}: playable cells {n}, <0.1% traffic each {sum(c < tot*.001 for c in cells)/n:.0%}, top10% cells {sum(cells[:n//10])/tot:.0%}, bottom half {sum(cells[n//2:])/tot:.1%}")
except ImportError:
    print("(Pillow not installed - skipping playable-area figures)")
G = 16
for k, ms in allm.items():
    L = grid(pts(ms, {2}), G); s = sorted(flat(L), reverse=True); tot = sum(s)
    print(f"{k}: loot {tot}, top cell {s[0]/tot:.1%}, top 10 cells {sum(s[:10])/tot:.1%}, cells with loot {sum(c>0 for c in s)}")
