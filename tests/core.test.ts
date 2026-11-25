import { describe, expect, it } from 'vitest';
import { addDays, diffDays, weekStart } from '../src/renderer/lib/dates';
import {
  addDaysToSeason,
  createDefaultData,
  createSeason,
  dayNumber,
  ensureSyncDay,
  newEntry,
  normalizeData,
} from '../src/renderer/lib/journal';
import { allStats, buildContext, statById, timeline } from '../src/renderer/lib/stats';
import { compareEntry } from '../src/renderer/lib/compare';
import { applyLiveMatch } from '../src/renderer/lib/sync';
import { MatchTracker, parseEnvelope } from '../src/main/matchTracker';
import { applyStatsApiSettings } from '../src/main/statsApiConfig';
import type { LiveMatchResult } from '../src/shared/model';

const TODAY = '2026-11-25';

function setup() {
  const data = createDefaultData();
  const season = createSeason(data, 21, '2026-11-01');
  return { data, season };
}

function log(data: ReturnType<typeof createDefaultData>, seasonId: string, date: string, activityId: string, v: { minutes?: number; amount?: number; wins?: number }) {
  const s = data.seasons.find((x) => x.id === seasonId)!;
  const d = s.days.find((x) => x.date === date)!;
  d.entries.push(
    newEntry({
      activityId,
      measure: v.minutes !== undefined ? 'time' : 'amount',
      minutes: v.minutes,
      unit: v.minutes !== undefined ? 'min' : undefined,
      amount: v.amount,
      wins: v.wins,
    }),
  );
}

describe('dates', () => {
  it('adds and diffs days across month/DST boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30');
    expect(diffDays('2026-11-01', '2026-11-25')).toBe(24);
    expect(weekStart('2026-11-25')).toBe('2026-11-23'); // Wednesday -> Monday
  });
});

describe('seasons & days', () => {
  it('creates 90 days by default and numbers them from the start date', () => {
    const { season } = setup();
    expect(season.days).toHaveLength(90);
    expect(season.days[0].date).toBe('2026-11-01');
    expect(season.days[89].date).toBe(addDays('2026-11-01', 89));
    expect(dayNumber(season, season.days[24])).toBe(25);
  });

  it('adds days after the last one, even after deleting days', () => {
    const { season } = setup();
    season.days = season.days.slice(0, 60);
    addDaysToSeason(season, 3);
    expect(season.days).toHaveLength(63);
    expect(dayNumber(season, season.days[62])).toBe(63);
  });

  it('ensureSyncDay appends missing days past the end of an active season', () => {
    const { data, season } = setup();
    season.days = season.days.slice(0, 10); // ends Nov 10
    const hit = ensureSyncDay(data, '2026-11-12')!;
    expect(hit.created).toBe(true);
    expect(hit.day.date).toBe('2026-11-12');
    expect(season.days).toHaveLength(12);
  });

  it('ensureSyncDay ignores closed seasons', () => {
    const { data, season } = setup();
    season.status = 'closed';
    expect(ensureSyncDay(data, '2026-11-05')).toBeNull();
  });

  it('normalizeData repairs partial files', () => {
    const d = normalizeData({ seasons: [{ id: 'x', number: 1, startDate: '2026-01-01', status: 'active', days: [{ id: 'a', date: '2026-01-02' }] }] });
    expect(d.sections.some((s) => s.kind === 'games')).toBe(true);
    expect(d.seasons[0].days[0].entries).toEqual([]);
    expect(d.settings.trackResultsGames).toBe(true);
    expect(d.settings.autoUpdate).toBe(true);
  });
});

describe('statistics', () => {
  it('computes training totals, averages, games by mode and win rate', () => {
    const { data, season } = setup();
    log(data, season.id, '2026-11-20', 'act-freeplay', { minutes: 30 });
    log(data, season.id, '2026-11-21', 'act-freeplay', { minutes: 90 });
    log(data, season.id, '2026-11-21', 'act-2s', { amount: 10, wins: 6 });
    log(data, season.id, '2026-11-22', 'act-3s', { amount: 4, wins: 1 });
    const ctx = buildContext(data, { kind: 'season', seasonId: season.id }, TODAY);
    const v = (id: string) => statById(data, id)!.compute(ctx)!;
    expect(v('training.totalTime').value).toBe('2h');
    expect(v('games.total').value).toBe('14');
    expect(v('games.winRate').value).toBe('50.0%');
    expect(v('training.avgActiveDay').value).toBe('1h');
    // 25 days elapsed (Nov 1..25), 120 minutes total -> 4.8 min/day
    expect(v('training.dailyAvg').value).toBe('5m');
    expect(v('games.mostPlayed').value).toBe('Ranked 2s');
    const byMode = v('games.byMode');
    expect(byMode.breakdown?.map((b) => b.label)).toEqual(['Ranked 2s', 'Ranked 3s']);
    expect(v('record.bestTrainingDay').value).toBe('1h 30m');
    expect(v('streak.longest').value).toBe('3 days');
  });

  it('every stat computes without throwing on empty data', () => {
    const { data, season } = setup();
    for (const scope of [{ kind: 'all' } as const, { kind: 'season', seasonId: season.id } as const]) {
      const ctx = buildContext(data, scope, TODAY);
      for (const def of allStats(data)) expect(() => def.compute(ctx)).not.toThrow();
      expect(() => timeline(ctx)).not.toThrow();
    }
  });

  it('current streak counts back from yesterday when today is empty', () => {
    const { data, season } = setup();
    for (const d of ['2026-11-22', '2026-11-23', '2026-11-24']) log(data, season.id, d, 'act-freeplay', { minutes: 10 });
    const ctx = buildContext(data, { kind: 'season', seasonId: season.id }, TODAY);
    expect(statById(data, 'streak.current')!.compute(ctx)!.value).toBe('3 days');
  });
});

describe('compare while adding', () => {
  it('compares against yesterday and the average per active day', () => {
    const { data, season } = setup();
    log(data, season.id, '2026-11-23', 'act-freeplay', { minutes: 60 });
    log(data, season.id, '2026-11-24', 'act-freeplay', { minutes: 30 });
    log(data, season.id, '2026-11-25', 'act-freeplay', { minutes: 10 });
    const c = compareEntry(data, { date: TODAY, seasonId: season.id, activityId: 'act-freeplay', measure: 'time', pending: 20 });
    expect(c.todayBefore).toBe(10);
    expect(c.todayAfter).toBe(30);
    expect(c.yesterday).toBe(30);
    expect(c.average).toBe(45);
    expect(c.best).toBe(60);
  });
});

const match = (over: Partial<LiveMatchResult> = {}): LiveMatchResult => ({
  guid: 'G1',
  endedAt: new Date(2026, 10, 25, 20, 0).toISOString(),
  playlistId: 11,
  leftEarly: false,
  overtime: false,
  winnerTeamNum: 0,
  teams: [
    { teamNum: 0, score: 3 },
    { teamNum: 1, score: 1 },
  ],
  players: [
    { name: 'Me', primaryId: 'Epic|abc|0', teamNum: 0, score: 400, goals: 2, assists: 1, saves: 1, shots: 4, demos: 0 },
    { name: 'Them', primaryId: 'Steam|1|0', teamNum: 1, score: 200, goals: 1, assists: 0, saves: 2, shots: 2, demos: 1 },
  ],
  ...over,
});

describe('live game sync', () => {
  it('logs a won 2s match to today for the matching account and dedupes by guid', () => {
    const { data, season } = setup();
    data.accounts.push({ id: 'acc1', label: 'Main', platform: 'epic', inGameNames: ['me'], primaryIds: [], liveGame: true, color: '#fff', createdAt: '' });
    const r = applyLiveMatch(data, match());
    expect(r.logged).toBe(true);
    const day = season.days.find((d) => d.date === TODAY)!;
    expect(day.entries).toHaveLength(1);
    expect(day.entries[0]).toMatchObject({ activityId: 'act-2s', amount: 1, wins: 1, losses: 0 });
    expect(data.matches[0]).toMatchObject({ result: 'win', teamScore: 3, opponentScore: 1, accountId: 'acc1' });
    expect(applyLiveMatch(data, match()).logged).toBe(false);
    applyLiveMatch(data, match({ guid: 'G2', winnerTeamNum: 1 }));
    expect(day.entries[0]).toMatchObject({ amount: 2, wins: 1, losses: 1 });
    expect(data.notifications[0].kind).toBe('sync');
  });

  it('skips private matches and creates new modes in the Games section', () => {
    const { data, season } = setup();
    expect(applyLiveMatch(data, match({ playlistId: 6, guid: 'P' })).logged).toBe(false);
    expect(applyLiveMatch(data, match({ playlistId: 27, guid: 'H' })).logged).toBe(true);
    const hoops = data.activities.find((a) => a.name === 'Ranked Hoops')!;
    expect(hoops.sectionId).toBe('sec-games');
    expect(hoops.order).toBe(7); // after the 7 built-in modes
    // unknown player -> result unknown, not counted in wins/losses
    const e = season.days.find((d) => d.date === TODAY)!.entries[0];
    expect(e).toMatchObject({ amount: 1, wins: 0, losses: 0 });
  });

  it('reports when there is no active season', () => {
    const data = createDefaultData();
    const r = applyLiveMatch(data, match());
    expect(r.logged).toBe(false);
    expect(r.notification?.kind).toBe('error');
  });
});

describe('Stats API match tracker', () => {
  it('emits one result per match with players, playlist and winner', () => {
    const results: LiveMatchResult[] = [];
    const t = new MatchTracker({ onMatchFinished: (r) => results.push(r) });
    const g = { MatchGuid: 'ABC' };
    t.handle('MatchCreated', g);
    t.handle('RoundStarted', g);
    t.handle('UpdateState', {
      MatchGuid: 'ABC',
      Players: [{ Name: 'Me', PrimaryId: 'Epic|1|0', TeamNum: 1, Score: 300, Goals: 1, Shots: 3, Assists: 0, Saves: 2, Demos: 1 }],
      Game: { PlaylistId: 13, Arena: 'Stadium_P', Teams: [{ Name: 'Blue', TeamNum: 0, Score: 0 }, { Name: 'Orange', TeamNum: 1, Score: 2 }], bOvertime: false },
    });
    t.handle('MatchEnded', { MatchGuid: 'ABC', WinnerTeamNum: 1 });
    t.handle('PodiumStart', g);
    t.handle('MatchDestroyed', g);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ guid: 'ABC', playlistId: 13, winnerTeamNum: 1, leftEarly: false });
    expect(results[0].players[0]).toMatchObject({ name: 'Me', teamNum: 1, goals: 1, saves: 2 });
  });

  it('counts leaving mid-match, ignores menus and replays', () => {
    const results: LiveMatchResult[] = [];
    const t = new MatchTracker({ onMatchFinished: (r) => results.push(r) });
    t.handle('MatchCreated', { MatchGuid: 'X' });
    t.handle('MatchDestroyed', { MatchGuid: 'X' }); // never started
    t.handle('MatchCreated', { MatchGuid: 'Y' });
    t.handle('RoundStarted', { MatchGuid: 'Y' });
    t.handle('MatchDestroyed', { MatchGuid: 'Y' });
    t.handle('ReplayCreated', { FileName: 'r' });
    t.handle('RoundStarted', {});
    t.handle('MatchEnded', { WinnerTeamNum: 0 });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ guid: 'Y', leftEarly: true });
  });

  it('parses envelopes, including string-encoded Data and concatenated messages', () => {
    expect(parseEnvelope('{"Event":"MatchEnded","Data":"{\\"WinnerTeamNum\\":1}"}')[0].Data.WinnerTeamNum).toBe(1);
    expect(parseEnvelope('{"Event":"A","Data":{}}{"Event":"B","Data":{"s":"}{"}}').map((e) => e.Event)).toEqual(['A', 'B']);
  });
});

describe('Stats API ini setup', () => {
  it('enables the exporter while keeping other settings', () => {
    const ini = '[Other]\nFoo=1\n\n[TAGame.MatchStatsExporter_TA]\nPacketSendRate=0\nPort=49123\nWebPort=49124\n';
    const r = applyStatsApiSettings(ini, { PacketSendRate: 2, Port: 49123, WebPort: 49124 });
    expect(r.changed).toBe(true);
    expect(r.text).toContain('Foo=1');
    expect(r.text).toContain('PacketSendRate=2');
    expect(r.text.match(/WebPort=/g)).toHaveLength(1);
    const again = applyStatsApiSettings(r.text, { PacketSendRate: 2, Port: 49123, WebPort: 49124 });
    expect(again.changed).toBe(false);
  });

  it('adds the section when missing and keeps a custom port', () => {
    const r = applyStatsApiSettings('[TAGame.MatchStatsExporter_TA]\nWebPort=50000\n', { PacketSendRate: 2, Port: 49123, WebPort: 49124 });
    expect(r.final.WebPort).toBe(50000);
    const r2 = applyStatsApiSettings('', { PacketSendRate: 2, Port: 49123, WebPort: 49124 });
    expect(r2.text).toContain('[TAGame.MatchStatsExporter_TA]');
  });
});
