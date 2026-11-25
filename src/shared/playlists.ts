// Rocket League playlist IDs (as reported by the Stats API) mapped to journal game modes.

/**
 * match:    an online game that is logged.
 * private:  online private match / third-party (logged only if the user allows it).
 * practice: freeplay, training, workshop, offline — never logged.
 */
export type PlaylistKind = 'match' | 'private' | 'practice';

export interface PlaylistInfo {
  /** Stable activity key in the Games section. */
  key: string;
  /** Activity name used when the mode is first logged. */
  mode: string;
  ranked: boolean;
  kind: PlaylistKind;
  honorDuel?: boolean;
}

/** Game modes every journal starts with, in their default order. */
export const DEFAULT_GAME_MODES: { key: string; name: string }[] = [
  { key: 'ranked-1s', name: 'Ranked 1s' },
  { key: 'ranked-2s', name: 'Ranked 2s' },
  { key: 'ranked-3s', name: 'Ranked 3s' },
  { key: 'casual-1s', name: 'Casual 1s' },
  { key: 'casual-2s', name: 'Casual 2s' },
  { key: 'casual-3s', name: 'Casual 3s' },
  { key: 'honor-duel', name: 'Honor Duel' },
];

export const HONOR_DUEL_KEY = 'honor-duel';
/** Playlist the game reports during an Honor Duel (seen in-game). */
export const HONOR_DUEL_PLAYLIST = 53;

const m = (key: string, mode: string, ranked = false): PlaylistInfo => ({ key, mode, ranked, kind: 'match' });
const practice = (mode: string): PlaylistInfo => ({ key: 'practice', mode, ranked: false, kind: 'practice' });

const P: Record<number, PlaylistInfo> = {
  1: m('casual-1s', 'Casual 1s'),
  2: m('casual-2s', 'Casual 2s'),
  3: m('casual-3s', 'Casual 3s'),
  4: m('casual-chaos', 'Casual Chaos'),
  6: { key: 'private', mode: 'Private Match', ranked: false, kind: 'private' },
  7: practice('Season (offline)'),
  8: practice('Exhibition'),
  9: practice('Training'),
  10: m('ranked-1s', 'Ranked 1s', true),
  11: m('ranked-2s', 'Ranked 2s', true),
  12: m('ranked-3s', 'Ranked 3s', true),
  13: m('ranked-3s', 'Ranked 3s', true),
  15: m('snow-day', 'Snow Day'),
  16: m('rocket-labs', 'Rocket Labs'),
  17: m('hoops', 'Hoops'),
  18: m('rumble', 'Rumble'),
  19: practice('Workshop'),
  20: practice('Custom training editor'),
  21: practice('Custom training'),
  22: m('tournament', 'Tournament', true),
  23: m('dropshot', 'Dropshot'),
  24: practice('Local match'),
  26: { key: 'external', mode: 'External match', ranked: false, kind: 'private' },
  27: m('ranked-hoops', 'Ranked Hoops', true),
  28: m('ranked-rumble', 'Ranked Rumble', true),
  29: m('ranked-dropshot', 'Ranked Dropshot', true),
  30: m('ranked-snow-day', 'Ranked Snow Day', true),
  31: m('ghost-hunt', 'Ghost Hunt'),
  32: m('beach-ball', 'Beach Ball'),
  33: m('spike-rush', 'Spike Rush'),
  34: m('tournament', 'Tournament', true),
  35: m('rocket-labs', 'Rocket Labs'),
  37: m('dropshot-rumble', 'Dropshot Rumble'),
  38: m('heatseeker', 'Heatseeker'),
  41: m('boomer-ball', 'Boomer Ball'),
  43: m('heatseeker-2s', 'Heatseeker Doubles'),
  44: m('winter-breakaway', 'Winter Breakaway'),
  46: m('gridiron', 'Gridiron'),
  47: m('super-cube', 'Super Cube'),
  48: m('tactical-rumble', 'Tactical Rumble'),
  49: m('spring-loaded', 'Spring Loaded'),
  50: m('speed-demon', 'Speed Demon'),
  52: m('gotham-rumble', 'Gotham City Rumble'),
  [HONOR_DUEL_PLAYLIST]: { key: HONOR_DUEL_KEY, mode: 'Honor Duel', ranked: false, kind: 'match', honorDuel: true },
  54: m('knockout', 'Knockout'),
};

export function playlistInfo(id: number | undefined | null): PlaylistInfo {
  if (id === undefined || id === null) return { key: 'unknown', mode: 'Unknown mode', ranked: false, kind: 'practice' };
  return P[id] ?? m(`playlist-${id}`, `Playlist ${id}`);
}

/** Names that only ever came from non-match playlists (used to clean up old bad logs). */
export const PRACTICE_MODE_NAMES = new Set(
  [...Object.values(P).filter((p) => p.kind === 'practice').map((p) => p.mode), 'Unknown mode'].map((n) => n.toLowerCase()),
);

/** Key for an activity name from older versions ("1s" → ranked-1s, "Playlist 53" → honor-duel). */
export function keyForLegacyName(name: string): string | undefined {
  const n = name.trim().toLowerCase();
  const legacy: Record<string, string> = { '1s': 'ranked-1s', '2s': 'ranked-2s', '3s': 'ranked-3s' };
  if (legacy[n]) return legacy[n];
  if (n === `playlist ${HONOR_DUEL_PLAYLIST}`) return HONOR_DUEL_KEY;
  const def = DEFAULT_GAME_MODES.find((d) => d.name.toLowerCase() === n);
  if (def) return def.key;
  const known = Object.values(P).find((p) => p.kind === 'match' && p.mode.toLowerCase() === n);
  return known?.key;
}
