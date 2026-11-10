// Shared constants: event metadata (must match EVENTS order in pipeline/build_data.py)
export const MAP_SIZE = 1024; // logical canvas units == minimap pixels in the README

export const EV = { Position: 0, BotPosition: 1, Loot: 2, Kill: 3, Killed: 4, BotKill: 5, BotKilled: 6, KilledByStorm: 7 };

// glyph: circle = something the player did, x = something that happened to the player
export const EVENT_META = {
  [EV.Loot]:          { key: 'Loot',          label: 'Loot pickup',               color: '#facc15', glyph: 'diamond', size: 4.5 },
  [EV.BotKill]:       { key: 'BotKill',       label: 'Killed a bot',              color: '#fb923c', glyph: 'circle',  size: 5 },
  [EV.BotKilled]:     { key: 'BotKilled',     label: 'Killed by a bot',           color: '#ef4444', glyph: 'cross',   size: 6 },
  [EV.Kill]:          { key: 'Kill',          label: 'Killed a human (PvP)',      color: '#4ade80', glyph: 'circle',  size: 7 },
  [EV.Killed]:        { key: 'Killed',        label: 'Killed by a human (PvP)',   color: '#4ade80', glyph: 'cross',   size: 7 },
  [EV.KilledByStorm]: { key: 'KilledByStorm', label: 'Died to the storm',         color: '#a78bfa', glyph: 'triangle', size: 7 },
};
export const MARKER_CODES = Object.keys(EVENT_META).map(Number);

export const COLORS = { human: '#22d3ee', bot: '#f472b6' };

export const HEAT_MODES = {
  traffic: { label: 'Traffic',     codes: [EV.Position, EV.BotPosition], gamma: 0.55 },
  kills:   { label: 'Kill zones',  codes: [EV.Kill, EV.BotKill],         gamma: 0.8 },
  deaths:  { label: 'Death zones', codes: [EV.Killed, EV.BotKilled, EV.KilledByStorm], gamma: 0.8 },
  storm:   { label: 'Storm deaths', codes: [EV.KilledByStorm],           gamma: 0.8 },
  loot:    { label: 'Loot',        codes: [EV.Loot],                     gamma: 0.6 },
};

export const fmtTime = s => { s = Math.max(0, Math.round(s)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
export const dayLabel = d => d.replace('February_', 'Feb ');
