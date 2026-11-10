# Insights from the Journey Explorer

All numbers come from the 5-day dataset (796 matches, 799 human journeys). **Every figure is reproducible with `python analysis/insights.py`** (stdlib + Pillow, reads `web/data`), and you can eyeball them in the tool: use the Heatmap modes with *Humans only*, and the stats panel. Grid statistics use a 16×16 grid over the minimap (one cell ≈ 56 m on Ambrose Valley) unless noted.

---

## 1. LILA BLACK currently plays as PvE: bots are the only opposition players meet

**What caught my eye.** Open any heatmap in *Kill zones* mode - the whole picture is bot fights. Switching on the PvP markers shows almost nothing.

**Evidence.**
- 793 of 796 matches contain at most one human journey; only 3 have two.
- Humans made **2,245 bot kills but only 3 human kills** (0.13%).
- Of **446 human deaths: 404 (90.6%) bots, 39 (8.7%) storm, 3 (0.7%) another human.**
- 55.6% of human journeys end in death (Ambrose 55.7%, Grand Rift 50.8%, Lockdown 56.7%); median death at 4:20 into the match.
- The storm is a late threat: the **first storm death is at 10:55**, all 39 fall between 10:55 and 14:47 - after most players have already died or left.

**Actionable?** Yes (with one caveat: if this is only a sampling effect of who was instrumented, re-check with full match rosters).
- Metrics affected: *deaths per match by killer type*, *time-to-first-death*, *survival/extraction rate*, *PvP encounter rate*, early-session retention (new players dying to bots repeatedly).
- Actions: (a) treat bot placement, patrol routes and aggro ranges as **the** difficulty lever of level design; (b) if PvP is intended, matchmaking/population is the bottleneck, not map layout; (c) pull the storm in earlier on maps where nobody is forced to move before minute 10, or accept that the storm is only decoration.

**Why a Level Designer should care.** Sight lines, cover and spawn spacing are being tested against AI, not people. Tuning for player-vs-player flow right now optimises something almost nobody experiences.

---

## 2. Deaths cluster in a handful of cells, and a few of them are far deadlier than their traffic explains

**What caught my eye.** In *Death zones* mode the heat collapses into a few hot spots (see `docs/03-heatmap-deaths.png`); on Grand Rift the corridor running through the Mine Pit lights up almost alone.

**Evidence.** (human deaths: Ambrose 317, Lockdown 99, Grand Rift 30)
- **Ambrose Valley:** 9 of 129 visited cells hold **50%** of all deaths; 23 cells hold 80%. The worst cells, centred at minimap px (288,544), (544,544), (352,544) and (544,608), take 5.7-7.9% of deaths each while attracting only 2.0-3.5% of traffic. Three of the four run at **2.2-2.9 deaths per 100 position samples vs a median of 1.17** for any busy cell (≥1% of traffic) - roughly 2-2.5× deadlier than their footfall (the fourth is 1.7).
- **Lockdown:** a single cell around world (94, -31) holds **12.1% of deaths for 3.6% of traffic**; another near px (416,416) has 3.7 deaths/100 samples vs a 0.74 median (5×).
- **Grand Rift** (small sample, 30 deaths): the central Mine Pit corridor has the top 3 death cells.

**Actionable?** Yes.
- Metrics: *deaths per visit* (lethality) by zone, *time-to-first-death*, *death-spread* (share of deaths in the top 10 cells), loot taken before death.
- Actions: for each lethal cell decide if it is intended. If it is an objective, keep it but add readable cover / an escape route so it is hard-but-fair. If it is accidental (open sightline into a chokepoint, bots funnelled by geometry), break it up or move a bot patrol/spawn. Re-measure lethality after the change - the goal is not zero, it is a deliberate curve.

**Why a Level Designer should care.** Raw kill counts only show where players are; *deaths per visit* shows where the level itself is doing the killing. That is the part of the map the designer actually controls.

---

## 3. Big parts of each map are almost unused, while loot and traffic pile into ~10% of the area

**What caught my eye.** *Traffic* mode on Lockdown (`docs/04-lockdown-traffic.png`): bright rings around a few compounds with dark "lakes" between them.

**Evidence.** (playable area approximated from minimap brightness; 32×32 grid for traffic)
- **Lockdown:** 54% of playable cells receive <0.1% of traffic each; the busiest 10% of cells take **48%** of all movement while the bottom half of cells get **2.8%**.
- **Ambrose Valley:** 45% of playable cells receive <0.1% of traffic; top 10% take 43%, bottom half 10.4%. **Grand Rift:** 40% / 39% / 10.6%.
- Loot follows the same shape: on Ambrose **one cell (south-western cluster, world ≈ (-61,-332)) accounts for 5.9% of all 9,955 pickups** and the top 10 of 100 loot cells give 47%; Lockdown top-10 = 49.7%, Grand Rift 43.0%.

**Actionable?** Yes.
- Metrics: *map utilisation* (% of playable area above a traffic threshold), *loot dispersion* (share of loot in top-10 cells), *time to first loot*, *distinct routes per match*.
- Actions: first check *why* cold zones are cold (reachability, no reason to go there, long exposed approach). Then add loot tiers, objectives or extraction options there, and thin out the over-farmed compounds. Re-run the heatmaps: the target is a flatter traffic distribution without raising lethality (insight 2).

**Why a Level Designer should care.** Half of the authored space is carrying ~3-10% of play. Either it is wasted art/content budget, or it is a reachable opportunity to create new routes, flanks and risk/reward choices without building anything new.

---

## Caveats (read before acting on any of this)
- **Possible sampling effect (insight 1):** the near-absence of PvP may reflect which players were instrumented, not real play. Confirm with full match rosters.
- **Small samples:** Grand Rift has 59 matches and only 30 human deaths; treat its hot spots as leads, not conclusions.
- **Playable area is approximated** from minimap brightness (cells darker than a threshold are treated as void), so unused-area percentages are ±a few points.
- **Locations are given as minimap pixel / world coordinates** because only Grand Rift's minimap carries labels. Open the tool, set *Death zones* / *Loot*, and zoom to those coordinates to name the exact compounds.
- Feb 14 is a partial day, so day-by-day comparisons should exclude it.
