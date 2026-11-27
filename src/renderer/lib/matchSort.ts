// Orders for the tracked matches and the game entries on the day page.
import type { AppData, Entry, EntrySort, MatchRecord, MatchSort } from '../../shared/model';
import { modeRank, playlistInfo } from '../../shared/playlists';
import { inRecord } from './journal';

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

/**
 * Where a game mode goes when sorted by mode: Ranked 1s → 2s → 3s → other ranked → casual … (see
 * modeRank), then the activity's own position. Used by the tracked matches and the game entries, so
 * both list the modes in the same order. `fallbackKey` is for an activity that no longer exists.
 */
export function modeOrder(data: AppData, activityId: string, fallbackKey?: string): number {
  const a = data.activities.find((x) => x.id === activityId);
  return modeRank(a?.key ?? fallbackKey) * 1e6 + (a?.order ?? 0) * 1e3;
}

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
      for (const m of list) rankOf.set(m.activityId, modeOrder(data, m.activityId, playlistInfo(m.playlistId).key));
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

// ---------------------------------------------------------------- game entries

export const ENTRY_SORTS: { value: EntrySort; label: string; hint: string; record?: boolean }[] = [
  // 'logged' (the saved value since 1.9.1) = most recent first since 1.10.2.
  { value: 'logged', label: 'Most recent', hint: 'The mode you played last at the top' },
  { value: 'mode', label: 'Game mode', hint: 'Like the tracked matches: ranked 1s, 2s, 3s, then casual, Honor Duels, private matches, then your own modes' },
  { value: 'account', label: 'Account', hint: 'Each account’s games together, merged and hand-added ones last' },
  { value: 'games', label: 'Most games', hint: 'The modes you played most first' },
  { value: 'wins', label: 'Most wins', hint: 'The modes you won most first', record: true },
];

export const ENTRY_SORT_VALUES = ENTRY_SORTS.map((o) => o.value);

/**
 * Sort a day's entries of a games section. Ties keep the order they were logged in; 'mode' puts the
 * same mode on different accounts next to each other (in account order).
 */
export function sortEntries(data: AppData, entries: Entry[], sort: EntrySort): Entry[] {
  if (!ENTRY_SORT_VALUES.includes(sort)) sort = 'logged';
  // When an entry was last added to: its latest game or session (when it was created, for older entries).
  const lastAt = (e: Entry): number => {
    const times = [...data.matches.filter((m) => m.entryId === e.id).map((m) => m.at), ...(e.sessions ?? []).map((s) => s.at)].map((t) => Date.parse(t) || 0);
    return times.length ? Math.max(...times) : Date.parse(e.createdAt) || 0;
  };
  const accIdx = new Map(data.accounts.map((a, i) => [a.id, i]));
  // An entry's account: its own, the one account its tracked games came from, merged (several) or by hand.
  const accountRank = (e: Entry): number => {
    if (!e.auto) return 1e4 + 1;
    if (e.auto.merged) return 1e4;
    const own = new Set(data.matches.filter((m) => m.entryId === e.id && m.accountId).map((m) => m.accountId!));
    if (e.auto.accountId) own.add(e.auto.accountId);
    if (own.size > 1) return 1e4;
    const id = [...own][0];
    return id ? accIdx.get(id) ?? 999 : 1e4;
  };
  const rows = entries.map((e, i) => ({
    e,
    i,
    mode: modeOrder(data, e.activityId),
    account: accountRank(e),
    games: e.measure === 'amount' ? e.amount ?? 0 : 0,
    // Private matches left out of the record (Settings → Games & logging) don't count as wins here either.
    wins: inRecord(data, e.activityId) ? e.wins ?? 0 : 0,
    losses: e.losses ?? 0,
    last: sort === 'logged' ? lastAt(e) : 0,
  }));
  type Row = (typeof rows)[number];
  const by: Record<EntrySort, (a: Row, b: Row) => number> = {
    logged: (a, b) => b.last - a.last || b.i - a.i,
    mode: (a, b) => a.mode - b.mode || a.account - b.account,
    account: (a, b) => a.account - b.account || a.mode - b.mode,
    games: (a, b) => b.games - a.games || a.mode - b.mode,
    wins: (a, b) => b.wins - a.wins || a.losses - b.losses || a.mode - b.mode,
  };
  const cmp = by[sort];
  return rows.sort((a, b) => cmp(a, b) || a.i - b.i).map((r) => r.e);
}
