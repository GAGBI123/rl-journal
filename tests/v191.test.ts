// 1.9.1: sort the entries of the games section on the day page.
import { describe, expect, it } from 'vitest';
import { addToDay, createDefaultData, createSeason, normalizeData } from '../src/renderer/lib/journal';
import { applyLiveMatch } from '../src/renderer/lib/sync';
import { ENTRY_SORTS, sortEntries, sortMatches } from '../src/renderer/lib/matchSort';
import type { AppData, Day, EntrySort, LiveMatchResult } from '../src/shared/model';

const TODAY = '2026-11-25';
const MAIN = { name: 'Main', primaryId: 'Epic|main|0' };
const ALT = { name: 'Alt', primaryId: 'Epic|alt|0' };

let n = 0;
const game = (who: typeof MAIN, playlistId: number, won = true): LiveMatchResult => {
  n++;
  return {
    guid: `S${n}`,
    endedAt: new Date(2026, 10, 25, 18, n).toISOString(),
    playlistId,
    leftEarly: false,
    overtime: false,
    winnerTeamNum: won ? 0 : 1,
    teams: [
      { teamNum: 0, score: won ? 3 : 1 },
      { teamNum: 1, score: won ? 1 : 3 },
    ],
    players: [
      { name: who.name, primaryId: who.primaryId, teamNum: 0, score: 300, goals: 1, assists: 0, saves: 1, shots: 3, demos: 0, touches: 20 },
      { name: 'Opp', primaryId: 'Epic|opp|0', teamNum: 1, score: 200, goals: 0, assists: 0, saves: 0, shots: 1, demos: 0, touches: 10 },
    ],
    localPlayer: { name: who.name, primaryId: who.primaryId },
  } as LiveMatchResult;
};

function setup() {
  const data = createDefaultData();
  data.settings.endDayManually = false;
  const season = createSeason(data, 21, '2026-11-01');
  const today = () => season.days.find((d) => d.date === TODAY)!;
  return { data, today };
}

const names = (data: AppData, day: Day, sort: EntrySort) =>
  sortEntries(data, day.entries, sort).map((e) => {
    const a = data.activities.find((x) => x.id === e.activityId)!;
    const acc = data.accounts.find((x) => x.id === e.auto?.accountId);
    return acc ? `${a.name} (${acc.label})` : a.name;
  });

describe('sorting the games section', () => {
  function day() {
    const { data, today } = setup();
    // Played: casual 2s, honor duel, ranked 3s (loss), ranked 1s on Alt, ranked 2s ×3, ranked 1s on Main.
    applyLiveMatch(data, game(MAIN, 2));
    applyLiveMatch(data, game(MAIN, 53));
    applyLiveMatch(data, game(MAIN, 13, false));
    applyLiveMatch(data, game(ALT, 10));
    for (let i = 0; i < 3; i++) applyLiveMatch(data, game(MAIN, 11, i < 2));
    applyLiveMatch(data, game(MAIN, 10));
    // A mode of the user's own (no game key), added by hand.
    data.activities.push({ id: 'act-kbm', sectionId: 'sec-games', name: 'KBM matches', defaultMeasure: 'amount', order: 99, createdAt: '' });
    addToDay(today(), { activityId: 'act-kbm', measure: 'amount', amount: 4 });
    return { data, day: today() };
  }

  it('keeps the logged order by default', () => {
    const { data, day: d } = day();
    expect(data.settings.dayGamesSort).toBe('logged');
    expect(sortEntries(data, d.entries, 'logged')).toEqual(d.entries);
    expect(sortEntries(data, d.entries, 'logged')).not.toBe(d.entries);
  });

  it('sorts by game mode in the same order as the tracked matches', () => {
    const { data, day: d } = day();
    const altFirst = data.accounts[0].label === 'Alt';
    expect(names(data, d, 'mode')).toEqual([
      ...(altFirst ? ['Ranked 1s (Alt)', 'Ranked 1s (Main)'] : ['Ranked 1s (Main)', 'Ranked 1s (Alt)']),
      'Ranked 2s (Main)',
      'Ranked 3s (Main)',
      'Casual 2s (Main)',
      'Honor Duel (Main)',
      'KBM matches',
    ]);
    // Same mode order as the tracked matches sorted by game mode.
    const matchModes = sortMatches(data, data.matches.filter((m) => m.dayId === d.id), 'mode').map((g) => g.key);
    const entryModes = [...new Set(sortEntries(data, d.entries, 'mode').map((e) => e.activityId))].filter((id) => matchModes.includes(id));
    expect(entryModes).toEqual(matchModes);
  });

  it('sorts by account, most games and most wins', () => {
    const { data, day: d } = day();
    const acc = names(data, d, 'account');
    const first = data.accounts[0].label;
    // Each account's entries together (in game-mode order), the hand-added one last.
    expect(acc.slice(-1)).toEqual(['KBM matches']);
    expect(acc.slice(0, -1).map((x) => x.match(/\((.*)\)/)![1])).toEqual(first === 'Main' ? ['Main', 'Main', 'Main', 'Main', 'Main', 'Alt'] : ['Alt', 'Main', 'Main', 'Main', 'Main', 'Main']);
    expect(names(data, d, 'games').slice(0, 2)).toEqual(['KBM matches', 'Ranked 2s (Main)']);
    expect(names(data, d, 'wins')[0]).toBe('Ranked 2s (Main)');
    // The loss sorts after the modes with a win.
    expect(names(data, d, 'wins').indexOf('Ranked 3s (Main)')).toBeGreaterThan(names(data, d, 'wins').indexOf('Honor Duel (Main)'));
  });

  it('puts merged entries after the single-account ones', () => {
    const { data, day: d } = day();
    const r1 = d.entries.filter((e) => e.activityId === 'act-1s');
    expect(r1).toHaveLength(2);
    r1[1].auto = { source: 'game', merged: true };
    expect(names(data, d, 'account').slice(-2)[0]).toBe('Ranked 1s');
  });

  it('marks the record sort and checks the saved setting', () => {
    expect(ENTRY_SORTS.filter((o) => o.record).map((o) => o.value)).toEqual(['wins']);
    const { data } = setup();
    (data.settings as any).dayGamesSort = 'nonsense';
    expect(normalizeData(JSON.parse(JSON.stringify(data))).settings.dayGamesSort).toBe('logged');
    data.settings.dayGamesSort = 'mode';
    const once = normalizeData(JSON.parse(JSON.stringify(data)));
    expect(once.settings.dayGamesSort).toBe('mode');
    expect(normalizeData(JSON.parse(JSON.stringify(once)))).toEqual(once);
  });
});
