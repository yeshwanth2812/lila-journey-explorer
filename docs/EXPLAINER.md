# LILA BLACK Journey Explorer - plain-language explainer

*For anyone (designer, PM, interviewer) who wants to understand what this is, how to use it, and why it was built this way - no code knowledge needed.*

## 1. The problem in one paragraph
LILA's Level Designers have raw telemetry - rows of "player X was at position Y at time Z" - but cannot *see* it. They need to answer questions like: *Where do players die? Which parts of the map does nobody visit? Is the loot where I expect it?* This tool turns 89,000 telemetry rows (5 days, 796 matches, 3 maps) into pictures on the actual minimap, in a browser, with no install.

## 2. Use it in 2 minutes
Open **https://yeshwanth2812.github.io/lila-journey-explorer/** and try the four **Quick views** at the top left:

| Button | What you see | How to read it |
|---|---|---|
| **Where do players die?** | Glowing blobs on the map | Brighter = more deaths in that spot. These are the level's danger zones. |
| **Where do players go?** | Traffic glow | Dark areas are routes almost nobody takes. |
| **Where is loot taken?** | Loot glow | Bright = heavily looted, dark = ignored. |
| **Watch a match** | A replay of the busiest match | Cyan dot = human player, pink = bots. Markers (loot ◆, kill ●, death ✕, storm ▼) appear as they happen. |

Then refine: pick a **map**, tick **dates**, choose a single **match** to replay, toggle humans/bots/event types, drag the timeline, zoom with the mouse wheel. The **?** button re-opens the help card, and the URL always reflects your view, so you can share a link to exactly what you're looking at.

## 3. How it works (the 4 steps)
1. **Read the raw files.** A Python script reads all 1,243 data files (one per player per match).
2. **Clean and translate.** It fixes the data's quirks (below) and converts each position from *game-world coordinates* to *positions on the minimap picture*.
3. **Pack it small.** The result is a few small files (about 1.7 MB total) saved next to the web page.
4. **Draw it in the browser.** The web page loads those files and draws the map, routes, markers and heatmaps itself. There is no server or database, so it is free to host, fast, and cannot "go down".

**Why this design?** The data is small and never changes while someone is using the tool. Doing the heavy work once, offline, makes the tool instant for the designer and trivial to deploy.

## 4. The "tricky part": putting a game position on a picture
Each event has world coordinates (x, y, z). Three things matter:
- **Use x and z, not y.** y is height; using it puts everything off the map.
- **Scale and shift per map.** `u = (x − origin_x) / scale` gives a 0-1 position across the map. Each map has its own origin and scale.
- **Flip vertically.** Images count rows from the top, the game's z axis counts up from the bottom, so the picture's y is `(1 − v)`.

It is checked three ways: a test reproducing the example from the data README, a check that no point falls outside the map, and a visual check that routes follow the roads on the minimap.

## 5. Data gotchas I found (and what I did)
- **Timestamps are labelled milliseconds but are really seconds** → treated as seconds and shown as time since the match started.
- **Bots vs humans:** the README says "numeric ID = bot", but 17 numeric-ID files behave like humans → classified by what events they contain instead of by file name.
- **Bots also log kill events** (not described in the README) → drawn at the bot's position and labelled as a bot's event.
- **Minimap images differ in size** (up to 9000×9000) → all converted to one 2048×2048 size so one coordinate system works everywhere.
- **One match spans two days; a few straddle midnight** → grouped by the day folder they came from.
- **Repeated loot rows in the same second** → kept; they are plausibly multi-item pickups.

## 6. What the data says (3 insights, details in INSIGHTS.md)
1. **It plays as player-versus-bot.** Humans got 2,245 bot kills but only 3 kills on other humans; 91% of human deaths are caused by bots, 9% by the storm (which only starts killing after ~11 minutes).
2. **Deaths cluster in a few spots.** On Ambrose Valley, 9 map cells hold half of all deaths, and some are 2-2.5× deadlier than their traffic explains.
3. **Big areas are unused.** On Lockdown, the least-visited half of the map gets under 3% of traffic; loot is similarly concentrated.

Every number can be regenerated with `python analysis/insights.py`.

## 7. Likely interview questions - short answers
- **Why no backend/database?** 89k rows, read-only. A server would add cost and failure points for zero benefit; static hosting is free and instant. Trade-off: re-run the pipeline when data changes.
- **Why plain JavaScript and Canvas, not React/WebGL?** ~600 lines of UI; fewer moving parts to review. Canvas handles 60k path segments and 12k markers smoothly. SVG would choke; WebGL is overkill.
- **How do heatmaps work?** Every point "splats" a soft blob into a 256×256 grid; the grid is colour-mapped. Brightness is scaled to the 98th percentile so one extreme hotspot doesn't wash out the rest. They react to every filter and to the timeline.
- **What would you do with more time?** Name points of interest on each map, compare day against day or build against build, add per-player drill-down, export a view as an image, and validate insight #1 against full match rosters.
- **What's the biggest risk in your insights?** Insight 1 may reflect which players were instrumented rather than real behaviour; small samples on Grand Rift (30 deaths); the "playable area" is approximated from the minimap image.
- **How did you use AI?** To move fast on the pipeline and UI, then verified results myself (coordinate tests, reproducible analysis script, visual checks).

## 8. Where things are
`web/` the tool · `pipeline/` data conversion + tests · `analysis/insights.py` reproduces the insights · `docs/` screenshots + walkthrough video · `README.md`, `ARCHITECTURE.md`, `INSIGHTS.md` the submission documents.
