// 1.8: tracked matches sort, games per account (merge / split), private matches left out of the record.
import { describe, expect, it } from 'vitest';
import {
  addToDay,
  completeRoutineItem,
  createDefaultData,
  createRoutine,
  createSeason,
  entryAccountParts,
  inRecord,
  mergeAccountEntries,
  moveEntry,
  normalizeData,
  routineItemState,
  splitEntryByAccount,
  startRoutineOnDay,
} from '../src/renderer/lib/journal';
import { buildContext, daySummary, statById } from '../src/renderer/lib/stats';
import { applyLiveMatch } from '../src/renderer/lib/sync';
import { sortMatches } from '../src/renderer/lib/matchSort';
import { modeRank } from '../src/shared/playlists';
import type { LiveMatchResult } from '../src/shared/model';

const TODAY = '2026-11-25';
const MAIN = { name: 'Main', primaryId: 'Epic|main|0', teamNum: 0 };
const ALT = { name: 'Alt', primaryId: 'Epic|alt|0', teamNum: 0 };

function setup() {
  const data = createDefaultData();
  data.settings.endDayManually = false;
  const season = createSeason(data, 21, '2026-11-01');
  return { data, season, today: () => season.days.find((d) => d.date === TODAY)! };
}

let n = 0;
const game = (who: typeof MAIN, over: Partial<LiveMatchResult> = {}): LiveMatchResult => {
  n++;
  return {
    guid: `G${n}`,
    endedAt: new Date(2026, 10, 25, 18, n).toISOString(),
    playlistId: 11,
    leftEarly: false,
    overtime: false,
    winnerTeamNum: 0,
    teams: [
      { teamNum: 0, score: 3 },
      { teamNum: 1, score: 1 },
    ],
    players: [
      { name: who.name, primaryId: who.primaryId, teamNum: 0, score: 300 + n, goals: 1, assists: 0, saves: 1, shots: 3, demos: 0 },
      { name: 'Them', primaryId: 'Steam|9|0', teamNum: 1, score: 100, goals: 1, assists: 0, saves: 0, shots: 1, demos: 0 },
    ],
    localPlayer: who,
    ...over,
  };
};

const accountId = (data: ReturnType<typeof setup>['data'], name: string) => data.accounts.find((a) => a.label === name)!.id;

describe('games per account', () => {
  it('gives each account its own entry for a mode, next to each other', () => {
    const { data, today } = setup();
    applyLiveMatch(data, game(MAIN));
    applyLiveMatch(data, game(MAIN, { playlistId: 2 })); // Casual 2s
    applyLiveMatch(data, game(ALT, { winnerTeamNum: 1 }));
    applyLiveMatch(data, game(MAIN));
    const entries = today().entries;
    expect(entries.map((e) => [e.activityId, e.amount])).toEqual([
      ['act-2s', 2],
      ['act-2s', 1],
      ['act-casual-2s', 1],
    ]);
    expect(entries[0].auto).toEqual({ source: 'game', accountId: accountId(data, 'Main') });
    expect(entries[1].auto).toEqual({ source: 'game', accountId: accountId(data, 'Alt') });
    expect(entries[1]).toMatchObject({ wins: 0, losses: 1 });
    // Day totals still add both accounts up.
    expect(daySummary(data, today()).results.find((r) => r.activityId === 'act-2s')).toMatchObject({ games: 3, wins: 2, losses: 1 });
  });

  it('lets the first account take a hand-logged entry; the next account gets its own', () => {
    const { data, today } = setup();
    addToDay(today(), { activityId: 'act-2s', measure: 'amount', amount: 2, wins: 1, losses: 1 });
    applyLiveMatch(data, game(MAIN));
    applyLiveMatch(data, game(ALT));
    expect(today().entries.map((e) => e.amount)).toEqual([3, 1]);
    expect(entryAccountParts(data, today().entries[0])).toMatchObject({ parts: [{ games: 1 }], byHand: 2 });
  });

  it('adds games by hand to the hand-logged entry, the only entry, or a new one', () => {
    const { data, today } = setup();
    applyLiveMatch(data, game(MAIN));
    addToDay(today(), { activityId: 'act-2s', measure: 'amount', amount: 1 });
    expect(today().entries).toHaveLength(1);
    applyLiveMatch(data, game(ALT));
    addToDay(today(), { activityId: 'act-2s', measure: 'amount', amount: 4 });
    expect(today().entries.map((e) => [e.amount, !!e.auto])).toEqual([
      [2, true],
      [1, true],
      [4, false],
    ]);
  });

  it('keeps all accounts in one entry with "keep apart" off (and still knows the accounts)', () => {
    const { data, today } = setup();
    data.settings.splitAccounts = false;
    applyLiveMatch(data, game(MAIN));
    applyLiveMatch(data, game(ALT));
    expect(today().entries).toHaveLength(1);
    expect(today().entries[0].auto).toEqual({ source: 'game', merged: true });
    expect(entryAccountParts(data, today().entries[0]).parts.map((p) => p.games)).toEqual([1, 1]);
  });

  it('merges a mode’s entries into one; later games on any account join it', () => {
    const { data, season, today } = setup();
    applyLiveMatch(data, game(MAIN));
    applyLiveMatch(data, game(ALT, { winnerTeamNum: 1 }));
    applyLiveMatch(data, game(ALT));
    const [first, second] = today().entries;
    const merged = mergeAccountEntries(data, season.id, today().id, second.id)!;
    expect(merged.id).toBe(first.id);
    expect(today().entries).toHaveLength(1);
    expect(merged).toMatchObject({ amount: 3, wins: 2, losses: 1, auto: { source: 'game', merged: true } });
    expect(data.matches.every((m) => m.entryId === merged.id)).toBe(true);
    applyLiveMatch(data, game(MAIN));
    expect(today().entries).toHaveLength(1);
    const { parts, byHand } = entryAccountParts(data, merged);
    expect(parts).toEqual([
      { accountId: accountId(data, 'Main'), games: 2, wins: 2, losses: 0 },
      { accountId: accountId(data, 'Alt'), games: 2, wins: 1, losses: 1 },
    ]);
    expect(byHand).toBe(0);
  });

  it('splits a merged entry by account again', () => {
    const { data, season, today } = setup();
    data.settings.splitAccounts = false;
    applyLiveMatch(data, game(MAIN));
    applyLiveMatch(data, game(ALT, { winnerTeamNum: 1 }));
    applyLiveMatch(data, game(MAIN, { winnerTeamNum: 1 }));
    addToDay(today(), { activityId: 'act-2s', measure: 'amount', amount: 1, wins: 1, losses: 0 });
    data.settings.splitAccounts = true;
    const out = splitEntryByAccount(data, season.id, today().id, today().entries[0].id);
    expect(out).toHaveLength(2);
    // Main played first and keeps the game added by hand.
    expect(today().entries.map((e) => ({ amount: e.amount, wins: e.wins, losses: e.losses, acc: e.auto?.accountId }))).toEqual([
      { amount: 3, wins: 2, losses: 1, acc: accountId(data, 'Main') },
      { amount: 1, wins: 0, losses: 1, acc: accountId(data, 'Alt') },
    ]);
    expect(data.matches.filter((m) => m.entryId === out[1].id)).toHaveLength(1);
    // New games go to their own account's entry again.
    applyLiveMatch(data, game(ALT));
    expect(today().entries.map((e) => e.amount)).toEqual([3, 2]);
  });

  it('moves an account’s entry to that account’s entry on the other day', () => {
    const { data, season, today } = setup();
    applyLiveMatch(data, game(MAIN));
    applyLiveMatch(data, game(ALT));
    const other = season.days.find((d) => d.date === '2026-11-24')!;
    const alt = today().entries[1];
    moveEntry(data, { seasonId: season.id, dayId: today().id }, today().entries[0].id, { seasonId: season.id, dayId: other.id });
    moveEntry(data, { seasonId: season.id, dayId: today().id }, alt.id, { seasonId: season.id, dayId: other.id });
    expect(other.entries.map((e) => e.auto?.accountId)).toEqual([accountId(data, 'Main'), accountId(data, 'Alt')]);
    expect(today().entries).toHaveLength(0);
  });

  it('counts every account’s games towards a routine item', () => {
    const { data, today } = setup();
    const r = createRoutine(data, 'Grind', [{ activityId: 'act-2s', kind: 'amount', minutes: 0, amount: 5 }]);
    const dr = startRoutineOnDay(today(), r);
    applyLiveMatch(data, game(MAIN));
    applyLiveMatch(data, game(ALT));
    expect(routineItemState(today(), dr.items[0].id)).toMatchObject({ progress: 2, remaining: 3 });
    completeRoutineItem(today(), dr.id, dr.items[0].id);
    expect(today().entries.reduce((a, e) => a + (e.amount ?? 0), 0)).toBe(5);
  });

  it('marks entries from before 1.8 that hold several accounts as merged (once)', () => {
    const { data, today } = setup();
    data.settings.splitAccounts = false;
    applyLiveMatch(data, game(MAIN));
    applyLiveMatch(data, game(ALT));
    today().entries[0].auto = { source: 'game' }; // how 1.7 stored it
    delete (data.settings as any).dayMatchesSort;
    const once = normalizeData(JSON.parse(JSON.stringify(data)));
    const twice = normalizeData(JSON.parse(JSON.stringify(once)));
    const e = once.seasons[0].days.find((d) => d.date === TODAY)!.entries[0];
    expect(e.auto).toEqual({ source: 'game', merged: true });
    expect(twice).toEqual(once);
    expect(once.settings.dayMatchesSort).toBe('recent');
    expect(once.settings.splitAccounts).toBe(false);
    expect(normalizeData({ seasons: [] }).settings).toMatchObject({ splitAccounts: true, privateInRecord: true });
  });
});

describe('sorting tracked matches', () => {
  function day() {
    const { data, today } = setup();
    // Played in this order: casual 2s, honor duel, ranked 3s, private, ranked 1s, ranked 2s, ranked 1s
    for (const p of [2, 53, 13, 6, 10, 11, 10]) applyLiveMatch(data, game(p === 11 ? ALT : MAIN, { playlistId: p, winnerTeamNum: p === 13 ? 1 : 0 }));
    return { data, list: data.matches.filter((m) => m.dayId === today().id) };
  }

  it('puts ranked 1s/2s/3s first, then casual, then honor duels and private matches, newest first inside', () => {
    const { data, list } = day();
    const groups = sortMatches(data, list, 'mode');
    expect(groups.map((g) => g.label)).toEqual(['Ranked 1s', 'Ranked 2s', 'Ranked 3s', 'Casual 2s', 'Honor Duel', 'Private Match']);
    const r1 = groups[0].matches.map((m) => Date.parse(m.at));
    expect(r1[0]).toBeGreaterThan(r1[1]);
    expect(modeRank('ranked-hoops')).toBeGreaterThan(modeRank('ranked-3s'));
    expect(modeRank('ranked-hoops')).toBeLessThan(modeRank('casual-1s'));
    expect(modeRank('rumble')).toBeGreaterThan(modeRank('casual-3s'));
    expect(modeRank('rumble')).toBeLessThan(modeRank('honor-duel'));
    expect(modeRank('external')).toBe(modeRank('private'));
  });

  it('sorts by most recent, oldest, account, result and points', () => {
    const { data, list } = day();
    const recent = sortMatches(data, list, 'recent');
    expect(recent).toHaveLength(1);
    expect(recent[0].matches.map((m) => m.playlistId)).toEqual([10, 11, 10, 6, 13, 53, 2]);
    expect(sortMatches(data, list, 'oldest')[0].matches.map((m) => m.playlistId)).toEqual([2, 53, 13, 6, 10, 11, 10]);
    expect(sortMatches(data, list, 'account').map((g) => [g.label, g.matches.length])).toEqual([
      ['Main', 6],
      ['Alt', 1],
    ]);
    expect(sortMatches(data, list, 'result').map((g) => [g.label, g.matches.length])).toEqual([
      ['Wins', 6],
      ['Losses', 1],
    ]);
    const pts = sortMatches(data, list, 'points')[0].matches.map((m) => m.me!.score);
    expect([...pts].sort((a, b) => b - a)).toEqual(pts);
  });
});

describe('private matches left out of the record', () => {
  it('still logs them as games, without counting their wins and losses', () => {
    const { data, today } = setup();
    applyLiveMatch(data, game(MAIN, { playlistId: 6 }));
    applyLiveMatch(data, game(MAIN, { playlistId: 11, winnerTeamNum: 1 }));
    const priv = data.activities.find((a) => a.key === 'private')!;
    expect(daySummary(data, today()).results.map((r) => r.name)).toEqual(['Ranked 2s', 'Private Match']);

    data.settings.privateInRecord = false;
    expect(inRecord(data, priv.id)).toBe(false);
    const sum = daySummary(data, today());
    expect(sum.games).toBe(2);
    expect(sum.results.map((r) => r.name)).toEqual(['Ranked 2s']);
    const ctx = buildContext(data, { kind: 'all' }, TODAY);
    expect(statById(data, 'games.winRate')?.compute(ctx)?.sub).toBe('0W – 1L');
    expect(statById(data, 'live.matches')?.compute(ctx)?.sub).toContain('0W – 1L');
    // The stored results are kept, so switching back brings them back.
    expect(today().entries.find((e) => e.activityId === priv.id)).toMatchObject({ wins: 1, losses: 0 });
  });

  it("doesn't log them at all with Don't log", () => {
    const { data, today } = setup();
    data.settings.ignorePrivateMatches = true;
    expect(applyLiveMatch(data, game(MAIN, { playlistId: 6 })).logged).toBe(false);
    expect(today().entries).toHaveLength(0);
  });
});
