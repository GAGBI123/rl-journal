// 1.8: end-of-season recap and seasons exported as text files.
import { describe, expect, it } from 'vitest';
import { addToDay, closeSeason, createDefaultData, createSeason, findOrCreateActivity } from '../src/renderer/lib/journal';
import { applyLiveMatch } from '../src/renderer/lib/sync';
import { rankedBySize, seasonRecap } from '../src/renderer/lib/recap';
import { allSeasonTexts, dayText, seasonFileName, seasonText } from '../src/renderer/lib/textExport';
import type { LiveMatchResult } from '../src/shared/model';

const ME = { name: 'Me', primaryId: 'Epic|me|0', teamNum: 0 };
let n = 0;
const game = (endedAt: string, playlistId: number, won: boolean): LiveMatchResult => ({
  guid: `R${++n}`,
  endedAt,
  playlistId,
  leftEarly: false,
  overtime: n % 4 === 0,
  winnerTeamNum: won ? 0 : 1,
  teams: [
    { teamNum: 0, score: won ? 3 : 1 },
    { teamNum: 1, score: won ? 1 : 3 },
  ],
  players: [
    { name: 'Me', primaryId: ME.primaryId, teamNum: 0, score: 200 + n * 10, goals: 1, assists: 1, saves: 2, shots: 4, demos: 0 },
    { name: 'Opp', primaryId: 'Steam|1|0', teamNum: 1, score: 100, goals: 1, assists: 0, saves: 0, shots: 2, demos: 0 },
  ],
  localPlayer: ME,
});

/** A closed 10-day season: training on days 1-3 and 5, ranked + casual + a duel, a hand-logged day. */
function setup() {
  const data = createDefaultData();
  data.settings.endDayManually = false;
  const season = createSeason(data, 21, '2026-10-01', 10, 'Road to Champ');
  const training = data.sections.find((s) => s.kind === 'training')!;
  const aerials = findOrCreateActivity(data, training.id, 'Aerial control', 'time');
  const pack = findOrCreateActivity(data, training.id, 'Shooting pack', 'amount');
  const d = (i: number) => season.days[i];
  addToDay(d(0), { activityId: 'act-freeplay', measure: 'time', minutes: 30 });
  addToDay(d(0), { activityId: aerials.id, measure: 'time', minutes: 20, note: 'flip resets' });
  addToDay(d(1), { activityId: 'act-freeplay', measure: 'time', minutes: 90 });
  addToDay(d(2), { activityId: aerials.id, measure: 'time', minutes: 15 });
  addToDay(d(2), { activityId: pack.id, measure: 'amount', amount: 50 });
  addToDay(d(4), { activityId: 'act-freeplay', measure: 'time', minutes: 10 });
  addToDay(d(4), { activityId: 'act-2s', measure: 'amount', amount: 4, wins: 3, losses: 1 }); // by hand
  d(4).note = 'Good session\nfelt fast';
  const at = (day: number, h: number) => new Date(2026, 9, 1 + day, h, 0).toISOString();
  applyLiveMatch(data, game(at(1, 20), 10, true)); // ranked 1s
  applyLiveMatch(data, game(at(1, 21), 11, false)); // ranked 2s
  applyLiveMatch(data, game(at(2, 20), 11, true));
  applyLiveMatch(data, game(at(2, 21), 2, true)); // casual 2s
  applyLiveMatch(data, game(at(2, 22), 53, false)); // honor duel
  applyLiveMatch(data, game(at(2, 23), 6, true)); // private
  closeSeason(data, season.id, '2026-10-10');
  return { data, season };
}

describe('season recap', () => {
  it('adds up the season', () => {
    const { data, season } = setup();
    const r = seasonRecap(data, season, '2026-12-01');
    expect(r.days).toBe(10);
    expect(r.activeDays).toBe(4);
    expect(r.trainingDays).toBe(4);
    expect(r.gameDays).toBe(3);
    expect(r.longestStreak).toBe(3);
    expect(r.training).toBe(165);
    expect(r.topTraining).toEqual([
      { name: 'Freeplay', minutes: 130 },
      { name: 'Aerial control', minutes: 35 },
    ]);
    expect(r.amounts).toEqual([{ name: 'Shooting pack', amount: 50 }]);
    expect(r.bestTrainingDay).toMatchObject({ number: 2, value: 90 });
    expect(r.ranked).toMatchObject({ games: 7, wins: 5, losses: 2 });
    expect(r.casual).toMatchObject({ games: 1, wins: 1, losses: 0 });
    expect(r.honor).toMatchObject({ games: 1, wins: 0, losses: 1 });
    // Games without honor duels: 7 ranked + 1 casual + 1 private.
    expect(r.games).toBe(9);
    expect(r.record).toEqual({ wins: 7, losses: 2 });
    expect(r.mostGamesDay).toMatchObject({ number: 5, value: 4 });
    expect(rankedBySize(r).map((x) => [x.size, x.mode.games])).toEqual([
      ['1vs1', 1],
      ['2vs2', 6],
      ['3vs3', 0],
    ]);
    expect(r.modes.map((m) => m.name)).toEqual(['Ranked 1s', 'Ranked 2s', 'Casual 2s', 'Honor Duel', 'Private Match']);
    expect(r.tracked).toMatchObject({ games: 6, goals: 6, saves: 12, shots: 24 });
    expect(r.tracked.best?.mode).toBe('Private Match');
  });

  it('leaves private matches out of the record when asked', () => {
    const { data, season } = setup();
    data.settings.privateInRecord = false;
    const r = seasonRecap(data, season);
    expect(r.games).toBe(9);
    expect(r.record).toEqual({ wins: 6, losses: 2 });
  });
});

describe('text export', () => {
  it('writes a day like the Notepad template', () => {
    const { data, season } = setup();
    const lines = dayText(data, season, season.days[4]);
    expect(lines[0]).toMatch(/^-{100}$/);
    expect(lines[1]).toBe('day 5'); // no date: days go by number
    expect(lines.slice(2, 4)).toEqual(['---------', '-------------------------------------']);
    expect(lines).toContain('Freeplay : 10 min');
    // Training not done that day stays in with an x.
    expect(lines).toContain('Aerial control : x');
    expect(lines).toContain('Shooting pack : x');
    expect(lines).toContain('notes: Good session');
    expect(lines).toContain('       felt fast');
    expect(lines).toContain('total training time : 10 min');
    expect(lines.slice(-3)).toEqual(['1vs1 matches: x', '2vs2 matches: 4 (3W 1L)', '3vs3 matches: x']);
  });

  it('lists games other than ranked 1s/2s/3s as their own lines, with descriptions', () => {
    const { data, season } = setup();
    const lines = dayText(data, season, season.days[2]);
    expect(lines).toContain('Aerial control : 15 min');
    expect(lines).toContain('Shooting pack : 50');
    expect(lines).toContain('Casual 2s matches : 1 (1W 0L)');
    expect(lines).toContain('Honor Duel : 1 (0W 1L)');
    expect(lines).toContain('Private Match : 1 (1W 0L)');
    expect(lines).toContain('total training time : 15 min');
    expect(lines).toContain('2vs2 matches: 1 (1W 0L)');
    expect(dayText(data, season, season.days[0])).toContain('Aerial control : 20 min - flip resets');
    const rest = dayText(data, season, season.days[3]);
    for (const l of ['Freeplay : x', 'Aerial control : x', 'Shooting pack : x', 'total training time : x', '1vs1 matches: x', '2vs2 matches: x', '3vs3 matches: x']) {
      expect(rest).toContain(l);
    }
  });

  it('hides wins and losses on days that hide their record', () => {
    const { data, season } = setup();
    season.days[4].hideRecord = true;
    expect(dayText(data, season, season.days[4]).slice(-2)[0]).toBe('2vs2 matches: 4');
  });

  it('writes the whole season with the totals at the end, Windows line endings', () => {
    const { data, season } = setup();
    const text = seasonText(data, season, '2026-12-01');
    expect(text.split('\r\n')[0]).toBe('RL Journal - Season 21 · Road to Champ');
    expect(text).not.toMatch(/[^\r]\n/);
    expect(text.match(/^day \d+\r$/gm)).toHaveLength(10);
    expect(text).toContain('Season 21 · Road to Champ (end of season)');
    expect(text).toContain('Total ranked games in 10 days: 7');
    expect(text).toContain('2vs2: 6 (4W 2L, 67% won)');
    expect(text).toContain('Total training time: 2h 45m (165 min)');
    expect(text).toContain('Longest streak: 3 days in a row');
    expect(text).toContain('Most games in a day: 4 on day 5\r\n');
    expect(text).toMatch(/Best match: .* on day \d+ \(/);
  });

  it('names one file per season, never twice the same', () => {
    const { data, season } = setup();
    createSeason(data, 22, '2026-10-11', 5);
    createSeason(data, 22, '2026-10-16', 5);
    expect(seasonFileName(season)).toBe('RL Journal - Season 21 - Road to Champ.txt');
    expect(allSeasonTexts(data, '2026-10-20').map((f) => f.name)).toEqual([
      'RL Journal - Season 21 - Road to Champ.txt',
      'RL Journal - Season 22.txt',
      'RL Journal - Season 22 (2).txt',
    ]);
    // A season still going only lists the days up to today.
    const live = allSeasonTexts(data, '2026-10-12')[1].content;
    expect(live.match(/^day \d+\r$/gm)).toHaveLength(2);
    expect(live).toContain('(season so far)');
  });
});
