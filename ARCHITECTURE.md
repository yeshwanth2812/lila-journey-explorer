# Architecture

**Live tool:** [https://yeshwanth2812.github.io/lila-journey-explorer/](https://yeshwanth2812.github.io/lila-journey-explorer/)

## What I built with, and why
Python offline pipeline → static JSON → vanilla JS + Canvas 2D, hosted as a static site (GitHub Pages; Netlify/Vercel configs included). The data is small (89k rows, 1.7 MB as JSON) and read-only, so a backend or database would add cost and failure points for no benefit. A designer just opens a link. Plain ES modules (~700 lines) draw 60k path segments and 12k markers smoothly with no dependencies to audit.

## Data flow
```
1,243 parquet files → pipeline/build_data.py → web/data/index.json (match list, loaded at start)
                                             → web/data/<Map>.json (journeys as t[],u[],v[],e[]; lazy-loaded per map)
                                             → web/maps/<Map>.webp (minimaps resized to 2048²)
browser: data.js (pixel coords) → viewer.js (canvas: map, heatmap, paths, markers, pins) ← main.js (filters, playback, URL state)
```
The pipeline decodes event bytes, classifies human/bot, rebases time, maps coordinates and quantises. Filters, timeline, heatmaps and hotspot ranking then run client-side on the selected matches, so every interaction is instant.

## Coordinate mapping
`u = (x − origin_x)/scale`, `v = (z − origin_z)/scale`, `pixel_x = u·1024`, `pixel_y = (1 − v)·1024`, with per-map origin/scale from the data README.
1. **Use `x` and `z`; drop `y`**, which is elevation.
2. **Flip Y once** (`data.js`): images count rows from the top, world z counts up.
3. **Minimaps are not 1024²** (the README says they are; real sizes are 4320², 2160×2158, 9000²). Each is resized to a square 2048² and drawn into a 1024-unit canvas, so README pixel coordinates are the single coordinate space for every map and for zoom/pan.
4. **Verified:** `pipeline/tests/test_mapping.py` reproduces the README example (-301.45, -355.55 → 78, 890); 0 of 89,104 points fall outside the map; paths visibly follow roads and buildings on all three maps.

## Assumptions where the data was ambiguous
| Issue | Decision |
|---|---|
| README says `ts` is "time elapsed within the match" in ms, but values are ~1.77e9, consistent with **epoch seconds** (Feb 10-14 2026; samples 5 apart; match spans ≤ 890) | Treat as seconds; show time since the match's first event so all players align. |
| README: numeric id = bot. 17 numeric-id files contain `Position`/`Loot` (human events) | Classify by event evidence (`BotPosition` ⇒ bot); filename only as fallback. |
| README says bots emit `BotKill`/`BotKilled` but defines them from the human's view | Draw every event at its file owner's position; tooltip says Human/Bot. |
| README says matches have "multiple humans"; here 793 of 796 have one. PvP events: 6 | Supported but flagged in INSIGHTS as a possible sampling effect. |
| 4 matches' UTC date ≠ folder date; 1 match spans two folders | Day = folder of earliest file. |
| 1,505 duplicate rows, mostly `Loot` in the same second | Kept (plausible multi-item pickups). |
| "Playable area" is not in the data | Approximated from minimap brightness; only used in INSIGHTS. |

## Trade-offs
| Decision | Alternative | Why |
|---|---|---|
| Static site, pre-built JSON | API + DB | Read-only small data → free, instant, zero ops. Cost: re-run pipeline when data changes. |
| One JSON per map | Per-match files | Aggregate heatmaps need all matches; ~800 requests would be slower. |
| Canvas 2D | SVG / WebGL | SVG chokes at 60k segments; WebGL is overkill. |
| Client-side heatmap (256² grid, p98-normalised) | Pre-rendered tiles | Reacts to every filter and the time cursor; p98 stops one hotspot washing out the rest. |
| No framework | React + Vite | ~700 lines of UI; nothing to install. Cost: manual DOM updates. |
| Bundled parquet reader as default | Require pyarrow | Runs with only Pillow; verified on all 1,243 files. pyarrow is opt-in (`--engine pyarrow`). |
