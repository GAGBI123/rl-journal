// 1.7.1: goal replays send GoalScored again, which made 1.7.0 scores far too high.
import { describe, expect, it } from 'vitest';
import { normalizeData } from '../src/renderer/lib/journal';
import { MatchTracker } from '../src/main/matchTracker';
import type { LiveMatchResult } from '../src/shared/model';

const G = 'GUID-171';

function tracker() {
  const results: LiveMatchResult[] = [];
  const t = new MatchTracker({ onMatchFinished: (r) => results.push(r) });
  return { t, results };
}

const state = (blue: number, orange: number, time: number, replay = false, winner = '') => ({
  MatchGuid: G,
  Players: [
    { Name: 'Me', PrimaryId: 'Epic|Me|0', TeamNum: 0, Score: 100 * blue, Goals: blue, Shots: blue, Assists: 0, Saves: 0, Touches: 10, Demos: 0 },
    { Name: 'Opp', PrimaryId: 'Epic|Opp|0', TeamNum: 1, Score: 100 * orange, Goals: orange, Shots: orange, Assists: 0, Saves: 0, Touches: 10, Demos: 0 },
  ],
  Game: {
    PlaylistId: 6,
    TimeSeconds: time,
    bOvertime: false,
    bReplay: replay,
    Teams: [
      { Name: 'Blue', TeamNum: 0, Score: blue },
      { Name: 'Orange', TeamNum: 1, Score: orange },
    ],
    bHasWinner: !!winner,
    Winner: winner,
    bHasTarget: true,
    Target: { Name: 'Me', Shortcut: 1, TeamNum: 0 },
  },
});

const goal = (t: MatchTracker, team: number) => t.handle('GoalScored', { MatchGuid: G, Scorer: { Name: team ? 'Opp' : 'Me', TeamNum: team }, GoalTime: Math.random() * 300 });
const kickoff = (t: MatchTracker) => {
  t.handle('CountdownBegin', { MatchGuid: G });
  t.handle('RoundStarted', { MatchGuid: G });
};

/** A goal as the game sends it: the goal, the score, then a replay that shows the goal again. */
function scoredWithReplay(t: MatchTracker, team: number, blue: number, orange: number, time: number, how: 'events' | 'state' | 'none') {
  goal(t, team);
  t.handle('UpdateState', state(blue, orange, time));
  if (how === 'events') t.handle('GoalReplayStart', { MatchGuid: G });
  t.handle('UpdateState', state(blue, orange, time, how !== 'none'));
  goal(t, team); // the replay shows the goal again
  goal(t, team);
  if (how === 'events') t.handle('GoalReplayEnd', { MatchGuid: G });
  kickoff(t);
}

describe('goal replays', () => {
  for (const how of ['events', 'state', 'none'] as const) {
    it(`don't add goals (replay seen through ${how})`, () => {
      const { t, results } = tracker();
      t.handle('MatchCreated', { MatchGuid: G });
      kickoff(t);
      t.handle('UpdateState', state(0, 0, 300));
      scoredWithReplay(t, 0, 1, 0, 250, how);
      scoredWithReplay(t, 1, 1, 1, 200, how);
      scoredWithReplay(t, 0, 2, 1, 120, how);
      scoredWithReplay(t, 0, 3, 1, 40, how);
      t.handle('UpdateState', state(3, 1, 0, false, 'Blue'));
      t.handle('MatchEnded', { MatchGuid: G, WinnerTeamNum: 0 });
      expect(results[0].teams.map((x) => x.score)).toEqual([3, 1]);
      expect(results[0].overtime).toBe(false);
    });
  }

  it('still adds an overtime winner the updates missed', () => {
    const { t, results } = tracker();
    kickoff(t);
    t.handle('UpdateState', state(0, 0, 300));
    scoredWithReplay(t, 0, 1, 0, 200, 'events');
    scoredWithReplay(t, 1, 1, 1, 30, 'events');
    t.handle('UpdateState', state(1, 1, 0));
    kickoff(t); // overtime kickoff
    t.handle('ClockUpdatedSeconds', { MatchGuid: G, TimeSeconds: 1, bOvertime: true });
    goal(t, 1);
    t.handle('MatchEnded', { MatchGuid: G, WinnerTeamNum: 1 });
    expect(results[0].teams.map((x) => x.score)).toEqual([1, 2]);
    expect(results[0].overtime).toBe(true);
  });

  it('never adds more than one goal to what the game showed', () => {
    const { t, results } = tracker();
    t.handle('UpdateState', state(0, 0, 300));
    for (let i = 0; i < 6; i++) {
      goal(t, 0);
      kickoff(t);
    }
    t.handle('UpdateState', state(2, 0, 0, false, 'Blue'));
    t.handle('MatchEnded', { MatchGuid: G, WinnerTeamNum: 0 });
    expect(results[0].teams.map((x) => x.score)).toEqual([2, 0]);
  });

  it("a clock jumping back to full time isn't overtime", () => {
    const { t, results } = tracker();
    t.handle('UpdateState', state(0, 0, 300));
    t.handle('UpdateState', state(2, 1, 100));
    t.handle('UpdateState', state(2, 1, 0));
    t.handle('UpdateState', state(2, 1, 300, false, 'Blue'));
    t.handle('MatchEnded', { MatchGuid: G, WinnerTeamNum: 0 });
    expect(results[0].overtime).toBe(false);
  });
});

describe('no contest', () => {
  it('a match the game calls a no contest is not logged as a game', () => {
    const { t, results } = tracker();
    t.handle('UpdateState', state(0, 0, 300));
    t.handle('BallHit', { MatchGuid: G });
    t.handle('MatchEnded', { MatchGuid: G, WinnerTeamNum: -1 });
    expect(results[0].notStarted).toBe(true);
    expect(results[0].winnerTeamNum).toBeUndefined();
  });
});

describe('scores logged by 1.7.0', () => {
  const match = (at: string) => ({
    id: at,
    guid: 'g',
    at,
    date: at.slice(0, 10),
    seasonId: 's',
    dayId: 'd',
    entryId: 'e',
    activityId: 'a',
    mode: 'Private',
    result: 'loss',
    teamScore: 26,
    opponentScore: 14,
    source: 'game',
  });

  it('are removed once, the rest of the game stays', () => {
    const raw = {
      version: 3,
      seasons: [],
      matches: [match('2026-11-25T20:00:00.000Z'), match('2026-11-26T01:37:45.730Z')],
      settings: { settingsRev: 1 },
    };
    const data = normalizeData(raw);
    expect(data.matches[0]).toMatchObject({ teamScore: 26, opponentScore: 14 });
    expect(data.matches[1].teamScore).toBeUndefined();
    expect(data.matches[1].opponentScore).toBeUndefined();
    expect(data.matches[1].result).toBe('loss');
    expect(data.settings.settingsRev).toBe(2);
    // New games after the update keep their scores.
    data.matches.push(match('2026-11-27T10:00:00.000Z') as any);
    expect(normalizeData(data).matches[2]).toMatchObject({ teamScore: 26 });
  });

  it("aren't touched in files that never ran 1.7.0", () => {
    const data = normalizeData({ version: 3, seasons: [], matches: [match('2026-11-26T01:37:45.730Z')], settings: {} });
    expect(data.matches[0].teamScore).toBe(26);
  });
});
