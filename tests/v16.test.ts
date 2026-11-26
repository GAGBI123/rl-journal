// 1.6: days end when the user ends them (games after midnight stay on the open day), and entries
// can be moved to another day.
import { describe, expect, it } from 'vitest';
import {
  entryNotes,
  addToDay,
  canEndDay,
  completeRoutineItem,
  createDefaultData,
  createRoutine,
  createSeason,
  currentDate,
  endDay,
  moveEntry,
  normalizeData,
  reopenableDate,
  reopenDay,
  routineItemState,
  startRoutineOnDay,
} from '../src/renderer/lib/journal';
import { applyLiveMatch } from '../src/renderer/lib/sync';
import { MatchTracker } from '../src/main/matchTracker';
import type { LiveMatchResult } from '../src/shared/model';

function setup() {
  const data = createDefaultData();
  const season = createSeason(data, 24, '2026-11-01');
  const day = (date: string) => season.days.find((d) => d.date === date)!;
  return { data, season, day };
}

let n = 0;
const match = (at: Date, over: Partial<LiveMatchResult> = {}): LiveMatchResult => ({
  guid: `G${++n}`,
  endedAt: at.toISOString(),
  playlistId: 11,
  leftEarly: false,
  overtime: false,
  winnerTeamNum: 0,
  teams: [
    { teamNum: 0, score: 3 },
    { teamNum: 1, score: 1 },
  ],
  players: [{ name: 'Me', primaryId: 'Epic|abc|0', teamNum: 0, score: 400, goals: 2, assists: 1, saves: 1, shots: 4, demos: 0 }],
  localPlayer: { name: 'Me', primaryId: 'Epic|abc|0', teamNum: 0 },
  ...over,
});
const ranked2s = (day: any) => day.entries.find((e: any) => e.activityId === 'act-2s');

describe('ending days yourself', () => {
  it('is on by default, also for older save files', () => {
    expect(createDefaultData().settings.endDayManually).toBe(true);
    expect(normalizeData({ seasons: [], settings: { closeToTray: false } }).settings.endDayManually).toBe(true);
  });

  it('keeps the open day past midnight, until it is ended', () => {
    const { data } = setup();
    data.settings.openDay = '2026-11-25';
    expect(currentDate(data.settings, '2026-11-25')).toBe('2026-11-25');
    expect(currentDate(data.settings, '2026-11-26')).toBe('2026-11-25');
    expect(canEndDay(data.settings, '2026-11-26')).toBe(true);
    expect(endDay(data, '2026-11-26')).toBe('2026-11-26');
    expect(currentDate(data.settings, '2026-11-26')).toBe('2026-11-26');
  });

  it('ending today early sends the next games to tomorrow, and it can be reopened', () => {
    const { data } = setup();
    data.settings.openDay = '2026-11-25';
    expect(endDay(data, '2026-11-25')).toBe('2026-11-26');
    expect(currentDate(data.settings, '2026-11-25')).toBe('2026-11-26');
    // Tomorrow's day can't be ended before it has come.
    expect(canEndDay(data.settings, '2026-11-25')).toBe(false);
    expect(endDay(data, '2026-11-25')).toBeNull();
    expect(reopenableDate(data.settings, '2026-11-25')).toBe('2026-11-25');
    expect(reopenDay(data, '2026-11-25')).toBe(true);
    expect(currentDate(data.settings, '2026-11-25')).toBe('2026-11-25');
    expect(reopenableDate(data.settings, '2026-11-25')).toBeNull();
  });

  it('a day left open for a whole extra day moves on by itself', () => {
    const { data } = setup();
    data.settings.openDay = '2026-11-20';
    expect(currentDate(data.settings, '2026-11-21')).toBe('2026-11-20');
    expect(currentDate(data.settings, '2026-11-22')).toBe('2026-11-22');
    // Nothing to reopen then.
    data.settings.endedDay = '2026-11-19';
    expect(reopenableDate(data.settings, '2026-11-22')).toBeNull();
  });

  it('with the setting off, a new day starts at midnight', () => {
    const { data } = setup();
    data.settings.endDayManually = false;
    data.settings.openDay = '2026-11-25';
    expect(currentDate(data.settings, '2026-11-26')).toBe('2026-11-26');
    expect(canEndDay(data.settings, '2026-11-26')).toBe(false);
  });

  it('logs games after midnight to the open day, and to the next day once it is ended', () => {
    const { data, day } = setup();
    applyLiveMatch(data, match(new Date(2026, 10, 25, 23, 30)));
    expect(data.settings.openDay).toBe('2026-11-25');
    const r = applyLiveMatch(data, match(new Date(2026, 10, 26, 0, 40)));
    expect(r.notification?.body).toContain('still open');
    expect(ranked2s(day('2026-11-25')).amount).toBe(2);
    expect(day('2026-11-26').entries).toHaveLength(0);
    expect(data.matches.every((m) => m.date === '2026-11-25')).toBe(true);

    endDay(data, '2026-11-26');
    applyLiveMatch(data, match(new Date(2026, 10, 26, 1, 0)));
    expect(ranked2s(day('2026-11-26')).amount).toBe(1);
    expect(data.settings.openDay).toBe('2026-11-26');
  });

  it('logs to the calendar day at midnight when the setting is off', () => {
    const { data, day } = setup();
    data.settings.endDayManually = false;
    applyLiveMatch(data, match(new Date(2026, 10, 25, 23, 30)));
    applyLiveMatch(data, match(new Date(2026, 10, 26, 0, 40)));
    expect(ranked2s(day('2026-11-25')).amount).toBe(1);
    expect(ranked2s(day('2026-11-26')).amount).toBe(1);
    expect(data.settings.openDay).toBeUndefined();
  });
});

describe('moving entries to another day', () => {
  it('moves a whole entry, merging it into what the other day has', () => {
    const { data, season, day } = setup();
    const a = day('2026-11-25');
    const b = day('2026-11-26');
    addToDay(a, { activityId: 'act-freeplay', measure: 'time', minutes: 30, note: 'aerials' });
    addToDay(b, { activityId: 'act-freeplay', measure: 'time', minutes: 15 });
    const e = a.entries[0];
    const to = moveEntry(data, { seasonId: season.id, dayId: a.id }, e.id, { seasonId: season.id, dayId: b.id });
    expect(a.entries).toHaveLength(0);
    expect(b.entries).toHaveLength(1);
    expect(to?.minutes).toBe(45);
    expect(entryNotes(to!)).toEqual(['aerials']);
    // Its session goes along, next to the other day's own.
    expect(to!.sessions!.map((s) => s.value)).toEqual([15, 30]);
  });

  it('moves part of a time entry', () => {
    const { data, season, day } = setup();
    const a = day('2026-11-25');
    const b = day('2026-11-26');
    addToDay(a, { activityId: 'act-freeplay', measure: 'time', minutes: 30, note: 'aerials' });
    moveEntry(data, { seasonId: season.id, dayId: a.id }, a.entries[0].id, { seasonId: season.id, dayId: b.id }, { minutes: 10 });
    expect(a.entries[0].minutes).toBe(20);
    expect(entryNotes(a.entries[0])).toEqual(['aerials']);
    expect(b.entries[0].minutes).toBe(10);
    expect(entryNotes(b.entries[0])).toEqual([]);
    expect(b.entries[0].sessions!.map((s) => s.value)).toEqual([10]);
    // Nothing to move: nothing happens.
    expect(moveEntry(data, { seasonId: season.id, dayId: a.id }, a.entries[0].id, { seasonId: season.id, dayId: b.id }, { minutes: 0 })).toBeNull();
    expect(a.entries[0].minutes).toBe(20);
  });

  it('moves picked tracked games with their results and match details', () => {
    const { data, season, day } = setup();
    data.settings.endDayManually = false;
    const a = day('2026-11-25');
    const b = day('2026-11-26');
    applyLiveMatch(data, match(new Date(2026, 10, 25, 22, 0))); // win
    applyLiveMatch(data, match(new Date(2026, 10, 25, 23, 0), { winnerTeamNum: 1 })); // loss
    applyLiveMatch(data, match(new Date(2026, 10, 25, 23, 50))); // win
    const e = ranked2s(a);
    expect([e.amount, e.wins, e.losses]).toEqual([3, 2, 1]);
    const late = data.matches.filter((m) => m.at >= new Date(2026, 10, 25, 23, 0).toISOString());
    moveEntry(data, { seasonId: season.id, dayId: a.id }, e.id, { seasonId: season.id, dayId: b.id }, {
      amount: 2,
      wins: 1,
      losses: 1,
      matchIds: late.map((m) => m.id),
    });
    expect([e.amount, e.wins, e.losses]).toEqual([1, 1, 0]);
    const moved = ranked2s(b);
    expect([moved.amount, moved.wins, moved.losses]).toEqual([2, 1, 1]);
    expect(moved.auto?.source).toBe('game');
    for (const m of late) expect([m.dayId, m.date, m.entryId]).toEqual([b.id, b.date, moved.id]);
    expect(data.matches.filter((m) => m.dayId === a.id)).toHaveLength(1);
  });

  it('never moves more wins or losses than the games moved', () => {
    const { data, season, day } = setup();
    const a = day('2026-11-25');
    const b = day('2026-11-26');
    addToDay(a, { activityId: 'act-2s', measure: 'amount', amount: 5, wins: 3, losses: 2 });
    moveEntry(data, { seasonId: season.id, dayId: a.id }, a.entries[0].id, { seasonId: season.id, dayId: b.id }, { amount: 2, wins: 5, losses: 5 });
    expect([b.entries[0].amount, b.entries[0].wins, b.entries[0].losses]).toEqual([2, 2, 0]);
    expect([a.entries[0].amount, a.entries[0].wins, a.entries[0].losses]).toEqual([3, 1, 2]);
  });

  it('a routine item whose time moved away opens again', () => {
    const { data, season, day } = setup();
    const a = day('2026-11-25');
    const b = day('2026-11-26');
    const r = createRoutine(data, 'Warm-up', [{ activityId: 'act-freeplay', minutes: 20 }]);
    const dr = startRoutineOnDay(a, r);
    completeRoutineItem(a, dr.id, dr.items[0].id);
    expect(a.entries[0].minutes).toBe(20);
    moveEntry(data, { seasonId: season.id, dayId: a.id }, a.entries[0].id, { seasonId: season.id, dayId: b.id }, { minutes: 15 });
    const st = routineItemState(a, dr.items[0].id);
    expect(st.done).toBe(false);
    expect(st.progress).toBe(5);
    expect(st.remaining).toBe(15);
  });
});

describe('watching an Honor Duel of two others', () => {
  const state = (guid: string, playlist: number, target: string, players: [string, string]) => ({
    MatchGuid: guid,
    Players: [
      { Name: players[0], PrimaryId: `Epic|${players[0]}|0`, TeamNum: 0, Score: 100 },
      { Name: players[1], PrimaryId: `Epic|${players[1]}|0`, TeamNum: 1, Score: 50 },
    ],
    Game: {
      PlaylistId: playlist,
      Teams: [
        { Name: 'Blue', TeamNum: 0, Score: 2 },
        { Name: 'Orange', TeamNum: 1, Score: 1 },
      ],
      bHasTarget: true,
      Target: { Name: target, Shortcut: 1, TeamNum: players.indexOf(target) },
    },
  });

  it('the tracker marks a duel in the same lobby without the player from this PC as watched', () => {
    const results: LiveMatchResult[] = [];
    const seen: string[] = [];
    const t = new MatchTracker({ onMatchFinished: (r) => results.push(r), onLocalPlayer: (p) => seen.push(p.name) });
    t.handle('MatchCreated', { MatchGuid: 'L' });
    t.handle('RoundStarted', { MatchGuid: 'L' });
    t.handle('UpdateState', state('L', 13, 'Me', ['Me', 'Friend']));
    t.handle('MatchEnded', { MatchGuid: 'L', WinnerTeamNum: 0 });
    // Friend duels someone else; the camera follows Friend.
    t.handle('UpdateState', state('L', 53, 'Friend', ['Friend', 'Opp']));
    t.handle('RoundStarted', { MatchGuid: 'L' });
    t.handle('UpdateState', state('L', 53, 'Friend', ['Friend', 'Opp']));
    t.handle('MatchEnded', { MatchGuid: 'L', WinnerTeamNum: 0 });
    // Then I duel Friend myself.
    t.handle('UpdateState', state('L', 54, 'Me', ['Me', 'Friend']));
    t.handle('RoundStarted', { MatchGuid: 'L' });
    t.handle('MatchEnded', { MatchGuid: 'L', WinnerTeamNum: 1 });
    expect(results.map((r) => [r.playlistId, r.spectated ?? false, r.localPlayer?.name])).toEqual([
      [13, false, 'Me'],
      [53, true, undefined],
      [54, false, 'Me'],
    ]);
    expect(seen).toEqual(['Me']);
  });

  const duel = (target: string, players: [string, string]): LiveMatchResult => ({
    guid: `D${++n}`,
    endedAt: new Date(2026, 10, 25, 21, 0).toISOString(),
    playlistId: 53,
    leftEarly: false,
    overtime: false,
    winnerTeamNum: 0,
    teams: [
      { teamNum: 0, score: 3 },
      { teamNum: 1, score: 1 },
    ],
    players: players.map((name, i) => ({ name, primaryId: `Epic|${name}|0`, teamNum: i, score: 0, goals: 0, assists: 0, saves: 0, shots: 0, demos: 0 })),
    localPlayer: { name: target, primaryId: `Epic|${target}|0`, teamNum: players.indexOf(target) },
  });
  const honor = (day: any) => day.entries.find((e: any) => e.activityId === 'act-honor-duel');

  it('never logs a watched game', () => {
    const { data, day } = setup();
    expect(applyLiveMatch(data, { ...duel('Friend', ['Friend', 'Opp']), spectated: true, localPlayer: undefined }).logged).toBe(false);
    expect(day('2026-11-25').entries).toHaveLength(0);
    expect(data.accounts).toHaveLength(0);
  });

  it("doesn't log a duel of a player who isn't one of your accounts, or make an account for them", () => {
    const { data, day } = setup();
    applyLiveMatch(data, match(new Date(2026, 10, 25, 20, 0))); // creates my account (Me)
    expect(data.accounts.map((a) => a.label)).toEqual(['Me']);
    const r = applyLiveMatch(data, duel('Friend', ['Friend', 'Opp']));
    expect(r.logged).toBe(false);
    expect(r.notification).toBeUndefined(); // no pop-up
    expect(data.notifications[0].title).toBe('Honor Duel not logged');
    expect(data.accounts.map((a) => a.label)).toEqual(['Me']);
    expect(honor(day('2026-11-25'))).toBeUndefined();
  });

  it('logs the duel for your account when you played it, whoever the camera followed', () => {
    const { data, day } = setup();
    applyLiveMatch(data, match(new Date(2026, 10, 25, 20, 0)));
    expect(applyLiveMatch(data, duel('Opp', ['Me', 'Opp'])).logged).toBe(true);
    expect(honor(day('2026-11-25'))).toMatchObject({ amount: 1, wins: 1, losses: 0, auto: { accountId: data.accounts[0].id } });
    expect(data.accounts).toHaveLength(1);
  });

  it('still makes the first account from an Honor Duel when there are none yet', () => {
    const { data } = setup();
    expect(applyLiveMatch(data, duel('Me', ['Me', 'Opp'])).logged).toBe(true);
    expect(data.accounts.map((a) => a.label)).toEqual(['Me']);
  });
});
