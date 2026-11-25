// Rocket League playlist IDs (as reported by the Stats API) mapped to journal game modes.

export interface PlaylistInfo {
  /** Journal activity name inside the Games section. */
  mode: string;
  ranked: boolean;
  /** Offline, private or training playlists — ignorable. */
  private?: boolean;
}

const P: Record<number, PlaylistInfo> = {
  1: { mode: 'Casual 1s', ranked: false },
  2: { mode: 'Casual 2s', ranked: false },
  3: { mode: 'Casual 3s', ranked: false },
  4: { mode: 'Casual Chaos', ranked: false },
  6: { mode: 'Private Match', ranked: false, private: true },
  7: { mode: 'Season (offline)', ranked: false, private: true },
  8: { mode: 'Exhibition', ranked: false, private: true },
  9: { mode: 'Training', ranked: false, private: true },
  10: { mode: '1s', ranked: true },
  11: { mode: '2s', ranked: true },
  13: { mode: '3s', ranked: true },
  15: { mode: 'Snow Day', ranked: false },
  16: { mode: 'Rocket Labs', ranked: false },
  17: { mode: 'Hoops', ranked: false },
  18: { mode: 'Rumble', ranked: false },
  19: { mode: 'Workshop', ranked: false, private: true },
  22: { mode: 'Tournament', ranked: true },
  23: { mode: 'Dropshot', ranked: false },
  24: { mode: 'Local Match', ranked: false, private: true },
  26: { mode: 'FaceIt', ranked: false, private: true },
  27: { mode: 'Hoops', ranked: true },
  28: { mode: 'Rumble', ranked: true },
  29: { mode: 'Dropshot', ranked: true },
  30: { mode: 'Snow Day', ranked: true },
  34: { mode: 'Tournament', ranked: true },
  38: { mode: 'Heatseeker', ranked: false },
  41: { mode: 'Boomer Ball', ranked: false },
  43: { mode: 'Heatseeker', ranked: false },
  46: { mode: 'Gridiron', ranked: false },
  47: { mode: 'Super Cube', ranked: false },
  48: { mode: 'Tactical Rumble', ranked: false },
  50: { mode: 'Speed Demon', ranked: false },
  54: { mode: 'Knockout', ranked: false },
};

export function playlistInfo(id: number | undefined, countCasualAsRanked = false): PlaylistInfo {
  if (id === undefined || id === null) return { mode: 'Unknown mode', ranked: false };
  const info = P[id];
  if (!info) return { mode: `Playlist ${id}`, ranked: false };
  if (countCasualAsRanked && (id === 1 || id === 2 || id === 3)) {
    return { mode: ['1s', '2s', '3s'][id - 1], ranked: false };
  }
  return info;
}

/** Map tracker.gg playlist names ("Ranked Doubles 2v2") to journal modes. */
export function trackerPlaylistToMode(name: string, countCasualAsRanked = false): string | null {
  const n = name.toLowerCase();
  if (n.includes('duel') || n.includes('1v1')) return n.includes('un-ranked') || n.includes('casual') ? (countCasualAsRanked ? '1s' : 'Casual 1s') : '1s';
  if (n.includes('doubles') || n.includes('2v2')) return n.includes('un-ranked') || n.includes('casual') ? (countCasualAsRanked ? '2s' : 'Casual 2s') : '2s';
  if (n.includes('standard') || n.includes('3v3')) return n.includes('un-ranked') || n.includes('casual') ? (countCasualAsRanked ? '3s' : 'Casual 3s') : '3s';
  if (n.includes('un-ranked') || n.includes('casual')) return 'Casual';
  if (n.includes('hoops')) return 'Hoops';
  if (n.includes('rumble')) return 'Rumble';
  if (n.includes('dropshot')) return 'Dropshot';
  if (n.includes('snow')) return 'Snow Day';
  if (n.includes('tournament')) return 'Tournament';
  if (n.includes('heatseeker')) return 'Heatseeker';
  return name.trim() || null;
}
