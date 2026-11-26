// Orders for the tracked matches on the day page.
import type { AppData, MatchRecord, MatchSort } from '../../shared/model';
import { modeRank, playlistInfo } from '../../shared/playlists';

export interface MatchGroup {
  /** '' when the list isn't grouped. */
  key: string;
  label: string;
  color?: string;
  matches: MatchRecord[];
}

export const MATCH_SORTS: { value: MatchSort; label: string; hint: string; record?: boolean }[] = [
  { value: 'recent', label: 'Most recent', hint: 'Newest game first' },
  { value: 'oldest', label: 'Oldest first', hint: 'In the order you played them' },
  { value: 'mode', label: 'Game mode', hint: 'Ranked 1s, 2s, 3s, then casual, then Honor Duels and private matches' },
  { value: 'account', label: 'Account', hint: 'Each account’s games together' },
  { value: 'result', label: 'Result', hint: 'Wins, then losses', record: true },
  { value: 'points', label: 'Most points', hint: 'Your best games first (in-game score)' },
];

const time = (m: MatchRecord) => Date.parse(m.at) || 0;
const newest = (a: MatchRecord, b: MatchRecord) => time(b) - time(a);

function grouped(list: MatchRecord[], keyOf: (m: MatchRecord) => string, order: (key: string) => number | string, labelOf: (m: MatchRecord) => string, colorOf?: (m: MatchRecord) => string | undefined): MatchGroup[] {
  const map = new Map<string, MatchGroup>();
  for (const m of [...list].sort(newest)) {
    const key = keyOf(m);
    const g = map.get(key) ?? { key, label: labelOf(m), color: colorOf?.(m), matches: [] };
    g.matches.push(m);
    map.set(key, g);
  }
  return [...map.values()].sort((a, b) => {
    const x = order(a.key);
    const y = order(b.key);
    return typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
  });
}

/**
 * Sort a day's tracked matches. Grouped orders (mode, account, result) come back as groups, newest
 * first inside each; the others as one group with key ''.
 */
export function sortMatches(data: AppData, list: MatchRecord[], sort: MatchSort): MatchGroup[] {
  const one = (matches: MatchRecord[]): MatchGroup[] => [{ key: '', label: '', matches }];
  switch (sort) {
    case 'oldest':
      return one([...list].sort((a, b) => time(a) - time(b)));
    case 'points':
      return one([...list].sort((a, b) => (b.me?.score ?? -1) - (a.me?.score ?? -1) || newest(a, b)));
    case 'mode': {
      const acts = new Map(data.activities.map((a) => [a.id, a]));
      const rankOf = new Map<string, number>();
      for (const m of list) {
        const a = acts.get(m.activityId);
        // Ranked 1s → 2s → 3s → other ranked → casual … then the activity's own position, then the name.
        rankOf.set(m.activityId, modeRank(a?.key ?? playlistInfo(m.playlistId).key) * 1e6 + (a?.order ?? 0) * 1e3);
      }
      return grouped(
        list,
        (m) => m.activityId,
        (k) => rankOf.get(k) ?? 0,
        (m) => acts.get(m.activityId)?.name ?? m.mode,
      );
    }
    case 'account': {
      const idx = new Map(data.accounts.map((a, i) => [a.id, i]));
      const acc = (m: MatchRecord) => data.accounts.find((a) => a.id === m.accountId);
      return grouped(
        list,
        (m) => m.accountId ?? '',
        (k) => (k ? idx.get(k) ?? 999 : 1000),
        (m) => acc(m)?.label ?? 'Unknown account',
        (m) => acc(m)?.color,
      );
    }
    case 'result': {
      const order = { win: 0, loss: 1, unknown: 2 } as const;
      const label = { win: 'Wins', loss: 'Losses', unknown: 'Result unknown' } as const;
      return grouped(
        list,
        (m) => m.result,
        (k) => order[k as keyof typeof order] ?? 3,
        (m) => label[m.result],
      );
    }
    default:
      return one([...list].sort(newest));
  }
}
