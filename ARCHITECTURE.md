# Architecture

**Live tool:** **[https://yeshwanth2812.github.io/lila-journey-explorer/](https://yeshwanth2812.github.io/lila-journey-explorer/)** · **Stack:** Python (offline data pipeline) → static JSON → vanilla JS + Canvas 2D (no framework, no build step).

## Why this stack
The dataset is tiny (89k rows, 1.7 MB as JSON). A backend or database would add latency, cost and an ops surface for zero benefit, so the pipeline runs **once, offline**, and the app is a **static site** that any host (Netlify / Vercel / GitHub Pages) serves for free. A designer opens a link and it works - nothing to install or sign in to. Plain ES modules + Canvas 2D keep the bundle at ~25 KB of code and let me draw 60k path segments + 12k markers smoothly, with no dependency to audit or upgrade.

## Data flow
```
player_data/February_*/*.nakama-0 (1,243 parquet files)
   │  pipeline/build_data.py  (pyarrow, or bundled pure-python reader)
   │   decode event bytes → classify human/bot → rebase ts → world→UV → quantise
   ▼
web/data/index.json          match list + counts (150 KB, loaded at start → powers filters & match list)
web/data/<Map>.json          every journey on one map as parallel arrays t[],u[],v[],e[] (lazy-loaded per map, 0.1–1 MB, ~40% of that gzipped)
web/maps/<Map>.webp          minimaps resized to 2048² (≈190 KB each instead of 9000² JPEG)
   ▼  browser: data.js precomputes pixel coords → viewer.js draws minimap, heatmap, paths, markers → main.js owns state/filters/playback
```
Filtering, the timeline and heatmaps all run client-side on the selected matches, so every interaction is instant. Filter state is mirrored into the URL hash (`#map=Lockdown&heat=deaths&match=<id>`) so a designer can share an exact view.

## Coordinate mapping (the tricky part)
Per the README: `u = (x − origin_x)/scale`, `v = (z − origin_z)/scale`, `pixel_x = u·1024`, `pixel_y = (1 − v)·1024`. Points to get right:
1. **Use `x` and `z`; ignore `y`.** `y` is elevation (e.g. 100-162 on Ambrose) and would put every point off the map.
2. **Flip Y once, in one place** (`data.js`): image origin is top-left, world +z points "up" the map.
3. **Per-map origin/scale** (Ambrose 900/-370/-473, GrandRift 581/-290/-290, Lockdown 1000/-500/-500).
4. **Minimaps are not all 1024²:** 4320², 2160×2158 and 9000². I normalise each to a square 2048² image and draw it into a 1024-unit logical canvas, so README pixel coordinates stay the single coordinate space for every map and for zoom/pan.
5. **Verified three ways:** (a) `pipeline/tests/test_mapping.py` reproduces the README's worked example (-301.45, -355.55 → 78, 890) and the corner cases; (b) 0 of 89,104 points fall outside [0,1]² on any map; (c) visual check - paths follow roads, bridges and building footprints on all three maps (see `docs/`).
Quantisation: UV stored as integers ×10⁴ (≈0.1 px) to keep JSON small.

## Data quirks & assumptions
| What I found | What I did |
|---|---|
| `ts` is typed *timestamp[ms]* but the values (~1.77e9) are **epoch seconds** (Feb 10-14 2026; position samples are exactly 5 apart; interpreted as ms they'd be 1970-01-21) | Treat as seconds; show **match-relative time** = ts − earliest ts in that match, so all players in a match align. Longest match = 14:50. |
| README says bots have numeric ids, humans UUIDs. **17 numeric-id files contain `Position`/`Loot`** (human event types), and none contain `BotPosition` | Classify by **event evidence** (`BotPosition` ⇒ bot, `Position` ⇒ human), filename only as fallback. |
| Kill events are logged on the *actor's* file, and bot files also contain `BotKill`/`BotKilled` (README only describes human files) | Draw every event at its file owner's position; the tooltip says Human/Bot. Events on bot journeys are therefore "bot-vs-bot/other" combat - flagged by pink-vs-cyan ownership. |
| 793 of 796 matches have ≤1 human journey; PvP events = 6 total | Tool still supports PvP markers; I call this out in `INSIGHTS.md` rather than treating it as a bug. May reflect sampling of who was instrumented. |
| 1 match has files in two day folders; 4 matches' UTC date ≠ folder date (near midnight) | Day = folder of the earliest file; filters use the folder, as in the dataset. |
| 1,505 rows duplicate (user, match, ts, event, x, z) - mostly `Loot` (multi-item pickups in the same second) | Kept: they are plausibly real pickups; dropping would undercount loot. |
| Sub-second ordering is impossible (1 s resolution) | Stable sort preserves file order for same-second events. |
| Feb 14 is a partial day | Shown as-is; counts for that day are not comparable. |
| Heatmap "playable area" for dead-zone analysis is not in the data | Approximated from minimap brightness (cells darker than a threshold = void). Used only in `INSIGHTS.md`. |

## Trade-offs
| Decision | Alternative | Why |
|---|---|---|
| Static site + pre-built JSON | API + DB (FastAPI/DuckDB) | Data is small and read-only; static = free, instant, zero ops. Cost: re-run pipeline when data changes. |
| One JSON per map, lazy-loaded | One file / per-match files | Ambrose is 1 MB (≈0.36 MB gzipped) and aggregate heatmaps need all matches anyway; per-match files would mean ~800 requests. |
| Canvas 2D | SVG / WebGL / deck.gl | SVG chokes at 60k segments; WebGL is overkill and harder to maintain for ~100k points. |
| Client-side Gaussian-splat heatmap (256² grid, p98-normalised) | Pre-rendered PNG tiles | Heatmaps respond to every filter, day, match and the time cursor. p98 normalisation stops one hotspot from washing out the rest. |
| No framework / bundler | React + Vite | ~600 lines of UI; fewer moving parts, no `npm install` to review the code. Cost: manual DOM updates. |
| Pure-python parquet reader fallback | Require pyarrow | Pipeline runs anywhere with only Pillow. Used when pyarrow is absent. |
| Bot/human by event evidence | Filename rule | Fixes 17 misclassified journeys. |
