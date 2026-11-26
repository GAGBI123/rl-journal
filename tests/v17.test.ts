// 1.7: cancelled matches aren't logged, single tracked games can be deleted, private matches are
// logged by default, looks + custom colors.
import { describe, expect, it } from 'vitest';
import { createDefaultData, createSeason, deleteMatch, normalizeData } from '../src/renderer/lib/journal';
import { applyLiveMatch } from '../src/renderer/lib/sync';
import { customVars, effectiveColors, mix } from '../src/renderer/lib/theme';
import { MatchTracker } from '../src/main/matchTracker';
import type { LiveMatchResult } from '../src/shared/model';

const G = 'GUID-1';

function tracker() {
  const results: LiveMatchResult[] = [];
  const t = new MatchTracker({ onMatchFinished: (r) => results.push(r) });
  return { t, results };
}

const player = (name: string, team: number, stats: Partial<Record<'Score' | 'Goals' | 'Shots' | 'Saves' | 'Touches' | 'Demos', number>> = {}) => ({
  Name: name,
  PrimaryId: `Epic|${name}|0`,
  TeamNum: team,
  Score: 0,
  Goals: 0,
  Shots: 0,
  Assists: 0,
  Saves: 0,
  Touches: 0,
  Demos: 0,
  ...stats,
});

const state = (opts: { blue?: number; orange?: number; time?: number; overtime?: boolean; touches?: number; winner?: string; playlist?: number } = {}) => ({
  MatchGuid: G,
  Players: [player('Me', 0, { Touches: opts.touches ?? 0, Score: (opts.touches ?? 0) * 10 }), player('Opp', 1, { Touches: opts.touches ?? 0 })],
  Game: {
    PlaylistId: opts.playlist ?? 10,
    TimeSeconds: opts.time ?? 300,
    bOvertime: !!opts.overtime,
    Teams: [
      { Name: 'Blue', TeamNum: 0, Score: opts.blue ?? 0 },
      { Name: 'Orange', TeamNum: 1, Score: opts.orange ?? 0 },
    ],
    bHasWinner: !!opts.winner,
    Winner: opts.winner ?? '',
    bHasTarget: true,
    Target: { Name: 'Me', Shortcut: 1, TeamNum: 0 },
  },
});

describe('matches that never got going', () => {
  it('a match cancelled before kickoff is reported as not started', () => {
    const { t, results } = tracker();
    t.handle('MatchCreated', { MatchGuid: G });
    t.handle('PlayerJoined', { MatchGuid: G, PlayerName: 'Me', PrimaryId: 'Epic|Me|0' });
    t.handle('UpdateState', state());
    t.handle('UpdateState', state());
    t.handle('MatchEnded', { MatchGuid: G, WinnerTeamNum: 0 });
    expect(results).toHaveLength(1);
    expect(results[0].notStarted).toBe(true);
  });

  it('leaving at kickoff of a match nobody played in counts as not started too', () => {
    const { t, results } = tracker();
    t.handle('MatchCreated', { MatchGuid: G });
    t.handle('UpdateState', state());
    t.handle('RoundStarted', { MatchGuid: G });
    t.handle('UpdateState', state({ time: 299 }));
    t.handle('MatchDestroyed', { MatchGuid: G });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ leftEarly: true, notStarted: true });
  });

  it('any touch, goal, point or running clock means it was played', () => {
    const touched = tracker();
    touched.t.handle('UpdateState', state({ touches: 1 }));
    touched.t.handle('MatchEnded', { MatchGuid: G, WinnerTeamNum: 0 });
    expect(touched.results[0].notStarted).toBeUndefined();

    const hit = tracker();
    hit.t.handle('UpdateState', state());
    hit.t.handle('BallHit', { MatchGuid: G });
    hit.t.handle('MatchEnded', { MatchGuid: G, WinnerTeamNum: 0 });
    expect(hit.results[0].notStarted).toBeUndefined();

    // Nobody touched the ball, but the clock ran (e.g. everyone was AFK): still a game.
    const clock = tracker();
    clock.t.handle('UpdateState', state({ time: 300 }));
    clock.t.handle('ClockUpdatedSeconds', { MatchGuid: G, TimeSeconds: 250, bOvertime: false });
    clock.t.handle('MatchEnded', { MatchGuid: G, WinnerTeamNum: 0 });
    expect(clock.results[0].notStarted).toBeUndefined();
  });

  it("isn't logged, and the bell says why", () => {
    const data = createDefaultData();
    createSeason(data, 24, '2026-11-01');
    const r = applyLiveMatch(data, {
      guid: 'X',
      endedAt: new Date(2026, 10, 26, 20, 0).toISOString(),
      playlistId: 11,
      leftEarly: false,
      overtime: false,
      winnerTeamNum: 0,
      teams: [
        { teamNum: 0, score: 0 },
        { teamNum: 1, score: 0 },
      ],
      players: [{ name: 'Me', teamNum: 0, score: 0, goals: 0, assists: 0, saves: 0, shots: 0, demos: 0 }],
      localPlayer: { name: 'Me', teamNum: 0 },
      notStarted: true,
    });
    expect(r.logged).toBe(false);
    expect(data.matches).toHaveLength(0);
    expect(data.accounts).toHaveLength(0);
    expect(data.notifications[0]).toMatchObject({ kind: 'info', title: 'Ranked 2s game not logged' });
  });
});

describe('final scores', () => {
  it('adds the overtime goal that came after the last update (a tie with a winner)', () => {
    const { t, results } = tracker();
    t.handle('UpdateState', state({ blue: 2, orange: 2, time: 120, touches: 5 }));
    t.handle('UpdateState', state({ blue: 2, orange: 2, time: 0, touches: 6 }));
    t.handle('MatchEnded', { MatchGuid: G, WinnerTeamNum: 0 });
    expect(results[0].teams.map((x) => x.score)).toEqual([3, 2]);
    expect(results[0].overtime).toBe(true);
  });

  it('the clock counting up again after it ran out means overtime', () => {
    const { t, results } = tracker();
    t.handle('UpdateState', state({ blue: 1, orange: 1, time: 10, touches: 5 }));
    t.handle('UpdateState', state({ blue: 1, orange: 1, time: 0, touches: 5 }));
    t.handle('UpdateState', state({ blue: 1, orange: 1, time: 12, touches: 7 }));
    t.handle('MatchEnded', { MatchGuid: G, WinnerTeamNum: 1 });
    expect(results[0].overtime).toBe(true);
    expect(results[0].teams.map((x) => x.score)).toEqual([1, 2]);
  });

  it('counts goals the updates missed', () => {
    const { t, results } = tracker();
    t.handle('UpdateState', state({ blue: 0, orange: 0, time: 200, touches: 3 }));
    t.handle('GoalScored', { MatchGuid: G, Scorer: { Name: 'Me', TeamNum: 0 } });
    t.handle('UpdateState', state({ blue: 1, orange: 0, time: 100, touches: 6 }));
    t.handle('RoundStarted', { MatchGuid: G });
    t.handle('GoalScored', { MatchGuid: G, Scorer: { Name: 'Me', TeamNum: 0 } });
    t.handle('UpdateState', state({ blue: 1, orange: 0, time: 0, touches: 9 }));
    t.handle('MatchEnded', { MatchGuid: G, WinnerTeamNum: 0 });
    expect(results[0].teams.map((x) => x.score)).toEqual([2, 0]);
    expect(results[0].overtime).toBe(false);
  });

  it("doesn't touch a tie that ended with time left (a forfeit)", () => {
    const { t, results } = tracker();
    t.handle('UpdateState', state({ blue: 1, orange: 1, time: 140, touches: 5 }));
    t.handle('MatchEnded', { MatchGuid: G, WinnerTeamNum: 0 });
    expect(results[0].teams.map((x) => x.score)).toEqual([1, 1]);
    expect(results[0].overtime).toBe(false);
  });
});

describe('deleting a tracked game', () => {
  function logged(results: ('win' | 'loss')[]) {
    const data = createDefaultData();
    createSeason(data, 24, '2026-11-01');
    results.forEach((res, i) =>
      applyLiveMatch(data, {
        guid: `M${i}`,
        endedAt: new Date(2026, 10, 26, 20, i).toISOString(),
        playlistId: 11,
        leftEarly: false,
        overtime: false,
        winnerTeamNum: res === 'win' ? 0 : 1,
        teams: [
          { teamNum: 0, score: res === 'win' ? 3 : 1 },
          { teamNum: 1, score: res === 'win' ? 1 : 3 },
        ],
        players: [{ name: 'Me', teamNum: 0, score: 300, goals: 1, assists: 0, saves: 1, shots: 2, demos: 0, touches: 20 }],
        localPlayer: { name: 'Me', teamNum: 0 },
      }),
    );
    const day = data.seasons[0].days.find((d) => d.date === '2026-11-26')!;
    return { data, entry: () => day.entries.find((e) => e.activityId === 'act-2s'), day };
  }

  it('takes one game and its result off the entry', () => {
    const { data, entry } = logged(['win', 'win', 'loss']);
    expect(entry()).toMatchObject({ amount: 3, wins: 2, losses: 1 });
    const win = data.matches.find((m) => m.result === 'win')!;
    expect(deleteMatch(data, win.id)).toBe(true);
    expect(entry()).toMatchObject({ amount: 2, wins: 1, losses: 1 });
    expect(data.matches).toHaveLength(2);
    const loss = data.matches.find((m) => m.result === 'loss')!;
    deleteMatch(data, loss.id);
    expect(entry()).toMatchObject({ amount: 1, wins: 1, losses: 0 });
  });

  it('removes the entry with its last game', () => {
    const { data, entry, day } = logged(['loss']);
    deleteMatch(data, data.matches[0].id);
    expect(entry()).toBeUndefined();
    expect(day.entries).toHaveLength(0);
    expect(data.matches).toHaveLength(0);
  });

  it('never leaves more results than games when the entry was edited by hand', () => {
    const { data, entry } = logged(['win', 'win', 'win']);
    const e = entry()!;
    e.amount = 2; // the user lowered the count but kept 3 wins
    deleteMatch(data, data.matches.find((m) => m.result === 'win')!.id);
    expect(entry()).toMatchObject({ amount: 1, wins: 1, losses: 0 });
  });
});

describe('settings in 1.7', () => {
  it('logs private matches by default, also for older files that had them ignored', () => {
    expect(createDefaultData().settings.ignorePrivateMatches).toBe(false);
    const old = normalizeData({ version: 3, seasons: [], settings: { ignorePrivateMatches: true } });
    expect(old.settings.ignorePrivateMatches).toBe(false);
    expect(old.settings.settingsRev).toBe(2);
    // Turned on again by the user afterwards: stays on.
    const again = normalizeData({ ...old, settings: { ...old.settings, ignorePrivateMatches: true } });
    expect(again.settings.ignorePrivateMatches).toBe(true);
  });

  it('logs a private match unless the user turned that off', () => {
    const data = createDefaultData();
    createSeason(data, 24, '2026-11-01');
    const m: LiveMatchResult = {
      guid: 'P1',
      endedAt: new Date(2026, 10, 26, 20, 0).toISOString(),
      playlistId: 6,
      leftEarly: false,
      overtime: false,
      winnerTeamNum: 0,
      teams: [
        { teamNum: 0, score: 2 },
        { teamNum: 1, score: 0 },
      ],
      players: [{ name: 'Me', teamNum: 0, score: 200, goals: 2, assists: 0, saves: 0, shots: 3, demos: 0 }],
      localPlayer: { name: 'Me', teamNum: 0 },
    };
    expect(applyLiveMatch(data, m).logged).toBe(true);
    data.settings.ignorePrivateMatches = true;
    expect(applyLiveMatch(data, { ...m, guid: 'P2' }).logged).toBe(false);
  });

  it('uses the Aurora look by default and keeps only valid custom colors', () => {
    expect(createDefaultData().settings.theme).toBe('aurora');
    const d = normalizeData({ version: 3, seasons: [], settings: { theme: 'neon', customColors: { accent: '#FF0000', text: 'red', bogus: '#000000' } } });
    expect(d.settings.theme).toBe('aurora');
    expect(d.settings.customColors).toEqual({ accent: '#FF0000' });
    expect(normalizeData({ version: 3, seasons: [], settings: { theme: 'classic', customColors: { text: 'x' } } }).settings).toMatchObject({ theme: 'classic' });
    expect(normalizeData({ version: 3, seasons: [], settings: { customColors: { text: 'x' } } }).settings.customColors).toBeUndefined();
  });
});

describe('custom colors', () => {
  it('only changes what the user picked, on top of the look', () => {
    expect(customVars({ theme: 'aurora' })).toEqual({});
    const v = customVars({ theme: 'classic', customColors: { accent: '#ff0000' } });
    expect(v['--blue']).toBe('#ff0000');
    expect(v['--blue-2']).toBe(mix('#ff0000', '#000000', 0.16));
    expect(v['--bg']).toBeUndefined();
    expect(effectiveColors({ theme: 'classic', customColors: { accent: '#ff0000' } }).background).toBe('#070b16');
  });

  it('muted text follows the text and background colors', () => {
    const v = customVars({ theme: 'aurora', customColors: { background: '#000000', text: '#ffffff' } });
    expect(v['--text']).toBe('#ffffff');
    expect(v['--muted']).toBe('#808080');
    expect(v['--panel']).toBe(effectiveColors({ theme: 'aurora' }).surface);
  });
});
