// Behaviour added in 1.1: ranked/casual/honor duel modes, one entry per activity per day,
// player detection, activity order, and migrating 1.0 save files.
import { describe, expect, it } from 'vitest';
import { addToDay, entryNotes, createDefaultData, createSeason, findOrCreateActivity, moveActivity, normalizeData, sectionActivities } from '../src/renderer/lib/journal';
import { daySummary } from '../src/renderer/lib/stats';
import { applyLiveMatch } from '../src/renderer/lib/sync';
import { MatchTracker } from '../src/main/matchTracker';
import { winePathToLinux } from '../src/main/rlInstallLinux';
import type { Day, LiveMatchResult } from '../src/shared/model';

const TODAY = '2026-11-25';
const ME = { localPlayer: { name: 'Me', primaryId: 'Epic|abc|0', teamNum: 0 } };

function setup() {
  const data = createDefaultData();
  const season = createSeason(data, 21, '2026-11-01');
  return { data, season, today: () => season.days.find((d) => d.date === TODAY)! };
}

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

describe('game modes, ranked vs casual and honor duels', () => {
  it('starts with Ranked 1s/2s/3s, Casual 1s/2s/3s and Honor Duel in that order', () => {
    const data = createDefaultData();
    expect(sectionActivities(data, 'sec-games').map((a) => a.name)).toEqual([
      'Ranked 1s',
      'Ranked 2s',
      'Ranked 3s',
      'Casual 1s',
      'Casual 2s',
      'Casual 3s',
      'Honor Duel',
    ]);
  });

  it('logs ranked and casual to their own modes and playlist 53 as Honor Duel with results', () => {
    const { data, today } = setup();
    applyLiveMatch(data, match({ guid: 'R', playlistId: 13, ...ME }));
    applyLiveMatch(data, match({ guid: 'C', playlistId: 3, ...ME }));
    applyLiveMatch(data, match({ guid: 'D', playlistId: 53, winnerTeamNum: 1, ...ME }));
    const byAct = Object.fromEntries(today().entries.map((e) => [e.activityId, e]));
    expect(byAct['act-3s']).toMatchObject({ amount: 1, wins: 1, losses: 0 });
    expect(byAct['act-casual-3s']).toMatchObject({ amount: 1, wins: 1, losses: 0 });
    expect(byAct['act-honor-duel']).toMatchObject({ amount: 1, wins: 0, losses: 1 });
    const sum = daySummary(data, today());
    expect(sum).toMatchObject({ games: 3, normalGames: 2, honorDuels: 1, honor: { wins: 0, losses: 1, known: true } });
    expect(sum.results.map((r) => `${r.name} ${r.wins}-${r.losses}`)).toEqual(['Ranked 3s 1-0', 'Casual 3s 1-0']);
  });

  it('can turn off win/loss tracking separately for games and honor duels', () => {
    const { data, today } = setup();
    data.settings.trackResultsHonorDuel = false;
    applyLiveMatch(data, match({ guid: 'D', playlistId: 53, ...ME }));
    applyLiveMatch(data, match({ guid: 'R', playlistId: 10, ...ME }));
    const duel = today().entries.find((e) => e.activityId === 'act-honor-duel')!;
    expect(duel.amount).toBe(1);
    expect(duel.wins).toBeUndefined();
    expect(duel.losses).toBeUndefined();
    expect(today().entries.find((e) => e.activityId === 'act-1s')).toMatchObject({ amount: 1, wins: 1, losses: 0 });
    expect(data.matches.find((m) => m.guid === 'D')!.result).toBe('unknown');
  });

  it('never logs freeplay, training or offline games', () => {
    const { data, today } = setup();
    expect(applyLiveMatch(data, match({ guid: undefined, playlistId: 13 })).logged).toBe(false);
    expect(applyLiveMatch(data, match({ guid: 'T', playlistId: 9 })).logged).toBe(false);
    expect(applyLiveMatch(data, match({ guid: 'W', playlistId: 19 })).logged).toBe(false);
    expect(today().entries).toHaveLength(0);
    expect(data.activities.some((a) => a.name === 'Training' && a.sectionId === 'sec-games')).toBe(false);
  });

  it('recognises you from the game, creates the account once, and records the win', () => {
    const { data } = setup();
    expect(applyLiveMatch(data, match({ guid: 'A', ...ME })).logged).toBe(true);
    expect(data.accounts).toHaveLength(1);
    expect(data.accounts[0]).toMatchObject({ label: 'Me', platform: 'epic', primaryIds: ['Epic|abc|0'] });
    expect(data.matches[0]).toMatchObject({ result: 'win', accountId: data.accounts[0].id });
    // Renamed in game: still the same account thanks to the platform id.
    applyLiveMatch(data, match({ guid: 'B', winnerTeamNum: 1, localPlayer: { name: 'NewName', primaryId: 'Epic|abc|0', teamNum: 0 } }));
    expect(data.accounts).toHaveLength(1);
    expect(data.matches[1].result).toBe('loss');
    expect(data.settings.lastLocalPlayer?.name).toBe('NewName');
  });

  it('links to an existing account by in-game name', () => {
    const { data } = setup();
    data.accounts.push({ id: 'main', label: 'Main', platform: 'other', inGameNames: ['me'], primaryIds: [], liveGame: true, color: '#fff', createdAt: '' });
    applyLiveMatch(data, match({ guid: 'A', ...ME }));
    expect(data.accounts).toHaveLength(1);
    expect(data.accounts[0]).toMatchObject({ primaryIds: ['Epic|abc|0'], platform: 'epic' });
    expect(data.matches[0].accountId).toBe('main');
  });

  it('adds a later game to the same entry instead of a second one', () => {
    const { data, today } = setup();
    applyLiveMatch(data, match({ guid: 'A', playlistId: 13 })); // player unknown
    applyLiveMatch(data, match({ guid: 'B', playlistId: 13, winnerTeamNum: 1, ...ME }));
    expect(today().entries).toHaveLength(1);
    expect(today().entries[0]).toMatchObject({ activityId: 'act-3s', amount: 2, wins: 0, losses: 1 });
  });
});

describe('one entry per activity per day', () => {
  it('sums amounts, minutes and results', () => {
    const day: Day = { id: 'd', date: TODAY, entries: [] };
    addToDay(day, { activityId: 'act-freeplay', measure: 'time', minutes: 30, note: 'aerials' });
    const r = addToDay(day, { activityId: 'act-freeplay', measure: 'time', minutes: 90, note: 'flicks' });
    expect(r.merged).toBe(true);
    expect(day.entries).toHaveLength(1);
    expect(day.entries[0]).toMatchObject({ minutes: 120 });
    // 1.10: each add is a session of the entry, with its own note.
    expect(day.entries[0].sessions!.map((s) => [s.value, s.note])).toEqual([
      [30, 'aerials'],
      [90, 'flicks'],
    ]);
    expect(entryNotes(day.entries[0])).toEqual(['aerials', 'flicks']);
    addToDay(day, { activityId: 'act-2s', measure: 'amount', amount: 5, wins: 3, losses: 2 });
    addToDay(day, { activityId: 'act-2s', measure: 'amount', amount: 2 });
    expect(day.entries[1]).toMatchObject({ amount: 7, wins: 3, losses: 2 });
    addToDay(day, { activityId: 'act-freeplay', measure: 'amount', amount: 3 });
    expect(day.entries).toHaveLength(3); // a different measure stays separate
  });

});

describe('activity order', () => {
  it('appends new activities last and moves them anywhere', () => {
    const data = createDefaultData();
    const a = findOrCreateActivity(data, 'sec-games', 'Hoops', 'amount');
    const b = findOrCreateActivity(data, 'sec-games', 'Rumble', 'amount');
    expect(sectionActivities(data, 'sec-games').slice(-2).map((x) => x.name)).toEqual(['Hoops', 'Rumble']);
    moveActivity(data, b.id, 0);
    expect(sectionActivities(data, 'sec-games')[0].name).toBe('Rumble');
    moveActivity(data, a.id, 3);
    expect(sectionActivities(data, 'sec-games').map((x) => x.name)).toEqual([
      'Rumble',
      'Ranked 1s',
      'Ranked 2s',
      'Hoops',
      'Ranked 3s',
      'Casual 1s',
      'Casual 2s',
      'Casual 3s',
      'Honor Duel',
    ]);
  });
});

describe('save file migration from 1.0', () => {
  const entry = (id: string, activityId: string, extra: object) => ({ id, activityId, measure: 'amount', createdAt: '', ...extra });
  const act = (id: string, sectionId: string, name: string, createdAt: string, builtIn = false) => ({
    id,
    sectionId,
    name,
    defaultMeasure: sectionId === 'sec-training' ? 'time' : 'amount',
    defaultUnit: 'min',
    builtIn,
    createdAt,
  });
  const rec = (id: string, entryId: string, activityId: string, playlistId: number, result: string, guid?: string) => ({
    id,
    guid,
    at: '',
    date: TODAY,
    seasonId: 's1',
    dayId: 'd25',
    entryId,
    activityId,
    playlistId,
    mode: '',
    result,
    source: 'game',
  });
  const v1 = () => ({
    version: 1,
    seasons: [
      {
        id: 's1',
        number: 21,
        startDate: '2026-11-01',
        status: 'active',
        createdAt: '',
        days: [
          {
            id: 'd25',
            date: TODAY,
            entries: [
              entry('e1', 'act-3s', { amount: 1, wins: 0, losses: 0, auto: { source: 'game' } }),
              entry('e2', 'act-3s', { amount: 1, wins: 0, losses: 1, auto: { source: 'game', accountId: 'a1' } }),
              entry('e3', 'x-training', { amount: 1, wins: 0, losses: 1, auto: { source: 'game' } }),
              entry('e4', 'x-53', { amount: 2, wins: 1, losses: 1, auto: { source: 'game' } }),
              entry('e5', 'act-2s', { amount: 4, wins: 3 }),
              { id: 'e6', activityId: 'act-freeplay', measure: 'time', minutes: 30, unit: 'min', createdAt: '' },
              { id: 'e7', activityId: 'act-freeplay', measure: 'time', minutes: 60, unit: 'hr', createdAt: '' },
            ],
          },
        ],
      },
    ],
    sections: [
      { id: 'sec-training', name: 'Training', color: '#3b82f6', builtIn: true, kind: 'training', order: 0 },
      { id: 'sec-games', name: 'Games', color: '#f97316', builtIn: true, kind: 'games', order: 1 },
    ],
    activities: [
      act('act-freeplay', 'sec-training', 'Freeplay', '2026-11-01', true),
      act('act-1s', 'sec-games', '1s', '2026-11-01', true),
      act('act-2s', 'sec-games', '2s', '2026-11-01', true),
      act('act-3s', 'sec-games', '3s', '2026-11-01', true),
      act('x-workshop', 'sec-games', 'Workshop maps', '2026-11-10'),
      act('x-training', 'sec-games', 'Training', '2026-11-25T18:00'),
      act('x-53', 'sec-games', 'Playlist 53', '2026-11-25T19:00'),
    ],
    accounts: [
      {
        id: 'a1',
        label: 'Main',
        platform: 'epic',
        username: 'PlayerOne',
        inGameNames: [],
        primaryIds: [],
        liveGame: true,
        tracker: { enabled: true, apiKey: 'k' },
        color: '#fff',
        createdAt: '',
      },
    ],
    matches: [
      rec('m1', 'e1', 'act-3s', 13, 'unknown', 'G1'),
      rec('m2', 'e2', 'act-3s', 13, 'loss', 'G2'),
      rec('m3', 'e3', 'x-training', 9, 'loss'),
      rec('m4', 'e4', 'x-53', 53, 'win', 'G4'),
    ],
    mmr: [{ accountId: 'a1', playlist: 'Ranked Doubles 2v2', rating: 1000, at: '' }],
    notifications: [],
    settings: { favorites: ['games.total', 'mmr:a1:Ranked Doubles 2v2'], trackerPollMinutes: 5, countCasualAsRanked: false, ignorePrivateMatches: true },
  });

  it('renames 1s/2s/3s to ranked, adds casual + Honor Duel, keeps custom activities last', () => {
    const d = normalizeData(v1());
    expect(d.version).toBe(3);
    expect(sectionActivities(d, 'sec-games').map((a) => a.name)).toEqual([
      'Ranked 1s',
      'Ranked 2s',
      'Ranked 3s',
      'Casual 1s',
      'Casual 2s',
      'Casual 3s',
      'Honor Duel',
      'Workshop maps',
    ]);
    // Playlist 53 became Honor Duel and kept its games.
    expect(d.activities.find((a) => a.id === 'x-53')).toMatchObject({ name: 'Honor Duel', key: 'honor-duel' });
  });

  it('removes the bogus Training game, merges duplicate entries and keeps everything else', () => {
    const d = normalizeData(v1());
    const day = d.seasons[0].days[0];
    expect(d.activities.some((a) => a.id === 'x-training')).toBe(false);
    expect(d.matches.map((m) => m.id)).toEqual(['m1', 'm2', 'm4']);
    const threes = day.entries.filter((e) => e.activityId === 'act-3s');
    expect(threes).toHaveLength(1);
    expect(threes[0]).toMatchObject({ amount: 2, wins: 0, losses: 1 });
    expect(d.matches.filter((m) => m.activityId === 'act-3s').every((m) => m.entryId === threes[0].id)).toBe(true);
    expect(day.entries.find((e) => e.activityId === 'act-2s')).toMatchObject({ amount: 4, wins: 3, losses: 1 });
    expect(day.entries.find((e) => e.activityId === 'act-freeplay')).toMatchObject({ minutes: 90 });
    expect(day.entries.find((e) => e.activityId === 'act-freeplay')).not.toHaveProperty('unit');
    expect(day.entries.find((e) => e.activityId === 'x-53')).toMatchObject({ amount: 2, wins: 1, losses: 1 });
  });

  it('drops tracker.gg leftovers and keeps the account name as an in-game name', () => {
    const d = normalizeData(v1()) as any;
    expect(d.mmr).toBeUndefined();
    expect(d.accounts[0].tracker).toBeUndefined();
    expect(d.accounts[0].inGameNames).toEqual(['PlayerOne']);
    expect(d.settings.trackerPollMinutes).toBeUndefined();
    expect(d.settings.favorites).toEqual(['games.total']);
    expect(d.settings.trackResultsHonorDuel).toBe(true);
  });

  it('is stable: loading the migrated file again changes nothing', () => {
    const once = normalizeData(v1());
    const twice = normalizeData(JSON.parse(JSON.stringify(once)));
    expect(twice).toEqual(JSON.parse(JSON.stringify(once)));
  });
});

describe('Stats API: who is playing', () => {
  const state = (guid: string | undefined, playlist: number, target: string, team = 0, replay = false) => ({
    MatchGuid: guid,
    Players: [
      { Name: 'Me', PrimaryId: 'Epic|1|0', TeamNum: 0, Score: 100 },
      { Name: 'Them', PrimaryId: 'Steam|2|0', TeamNum: 1, Score: 50 },
    ],
    Game: {
      PlaylistId: playlist,
      Teams: [
        { Name: 'Blue', TeamNum: 0, Score: 2 },
        { Name: 'Orange', TeamNum: 1, Score: 1 },
      ],
      bReplay: replay,
      bHasTarget: true,
      Target: { Name: target, Shortcut: 1, TeamNum: team },
    },
  });

  it('takes the local player from the camera target and reports it', () => {
    const results: LiveMatchResult[] = [];
    const seen: string[] = [];
    const t = new MatchTracker({ onMatchFinished: (r) => results.push(r), onLocalPlayer: (p) => seen.push(`${p.name}|${p.primaryId}`) });
    t.handle('MatchCreated', { MatchGuid: 'M' });
    t.handle('RoundStarted', { MatchGuid: 'M' });
    for (let i = 0; i < 5; i++) t.handle('UpdateState', state('M', 11, 'Me'));
    t.handle('UpdateState', state('M', 11, 'Them', 1, true)); // goal replay of the other player: ignored
    t.handle('MatchEnded', { MatchGuid: 'M', WinnerTeamNum: 0 });
    expect(seen).toEqual(['Me|Epic|1|0']);
    expect(results[0].localPlayer).toEqual({ name: 'Me', primaryId: 'Epic|1|0', teamNum: 0 });
  });

  it('ignores freeplay (no match id) and treats an Honor Duel in the same lobby as a new game', () => {
    const results: LiveMatchResult[] = [];
    const t = new MatchTracker({ onMatchFinished: (r) => results.push(r) });
    t.handle('MatchCreated', {});
    t.handle('RoundStarted', {});
    t.handle('UpdateState', state(undefined, 9, 'Me'));
    t.handle('MatchDestroyed', {});
    expect(results).toHaveLength(0);
    t.handle('MatchCreated', { MatchGuid: 'L' });
    t.handle('RoundStarted', { MatchGuid: 'L' });
    t.handle('UpdateState', state('L', 13, 'Me'));
    t.handle('MatchEnded', { MatchGuid: 'L', WinnerTeamNum: 0 });
    t.handle('UpdateState', state('L', 13, 'Me'));
    t.handle('UpdateState', state('L', 53, 'Me'));
    t.handle('RoundStarted', { MatchGuid: 'L' });
    t.handle('MatchEnded', { MatchGuid: 'L', WinnerTeamNum: 1 });
    expect(results.map((r) => `${r.playlistId}:${r.winnerTeamNum}`)).toEqual(['13:0', '53:1']);
  });
});

describe('Linux install detection helpers', () => {
  it('maps Wine paths into the prefix', () => {
    expect(winePathToLinux('/home/me/Games/epic/drive_c', 'C:\\Program Files\\Epic Games\\rocketleague')).toBe(
      '/home/me/Games/epic/drive_c/Program Files/Epic Games/rocketleague',
    );
  });
});
