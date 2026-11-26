// 1.10: games and sessions inside an entry. Every time something is added to an entry (by hand, a
// timer or a routine) it's a session with its own note; tracked games get notes too.
import { describe, expect, it } from 'vitest';
import {
  addToDay,
  completeRoutineItem,
  createDefaultData,
  createRoutine,
  createSeason,
  deleteSession,
  entryNotes,
  entrySessions,
  fitSessions,
  moveEntry,
  normalizeData,
  routineItemState,
  setMatchNote,
  startRoutineOnDay,
  undoRoutineItem,
  updateSession,
} from '../src/renderer/lib/journal';
import { applyLiveMatch } from '../src/renderer/lib/sync';
import type { Entry, LiveMatchResult } from '../src/shared/model';

function setup() {
  const data = createDefaultData();
  const season = createSeason(data, 24, '2026-11-01');
  const day = (date: string) => season.days.find((d) => d.date === date)!;
  const at = (date: string) => ({ seasonId: season.id, dayId: day(date).id });
  return { data, season, day, at };
}

const freeplay = (e: Entry[]) => e.find((x) => x.activityId === 'act-freeplay')!;

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

describe('sessions of an entry', () => {
  it('keeps each add as a session with its own note; the total is their sum', () => {
    const { day } = setup();
    const d = day('2026-11-25');
    addToDay(d, { activityId: 'act-freeplay', measure: 'time', minutes: 5, note: 'dribbling' }, true, { by: 'timer' });
    addToDay(d, { activityId: 'act-freeplay', measure: 'time', minutes: 10 }, true, { by: 'hand' });
    const e = freeplay(d.entries);
    expect(d.entries).toHaveLength(1);
    expect(e.minutes).toBe(15);
    expect(e.note).toBeUndefined();
    expect(e.sessions!.map((s) => [s.value, s.note, s.by])).toEqual([
      [5, 'dribbling', 'timer'],
      [10, undefined, 'hand'],
    ]);
  });

  it('turns an entry from before 1.10 into its first session when more is added', () => {
    const { day } = setup();
    const d = day('2026-11-25');
    const old: Entry = { id: 'old', activityId: 'act-freeplay', measure: 'time', minutes: 20, note: 'aerials', createdAt: '2026-11-25T10:00:00.000Z' };
    d.entries.push(old);
    // Before anything is added it reads as one session, with the entry's note.
    expect(entrySessions(old)).toEqual([{ id: 'old-0', value: 20, note: 'aerials', at: '2026-11-25T10:00:00.000Z' }]);
    addToDay(d, { activityId: 'act-freeplay', measure: 'time', minutes: 10, note: 'flicks' });
    expect(old.minutes).toBe(30);
    expect(old.note).toBeUndefined();
    expect(old.sessions!.map((s) => [s.value, s.note, s.at === '2026-11-25T10:00:00.000Z'])).toEqual([
      [20, 'aerials', true],
      [10, 'flicks', false],
    ]);
    expect(entryNotes(old)).toEqual(['aerials', 'flicks']);
  });

  it('changes or deletes one session; the entry follows and goes away when empty', () => {
    const { data, day, at } = setup();
    const d = day('2026-11-25');
    addToDay(d, { activityId: 'act-freeplay', measure: 'time', minutes: 5 });
    addToDay(d, { activityId: 'act-freeplay', measure: 'time', minutes: 10 });
    const e = freeplay(d.entries);
    const [a, b] = e.sessions!;
    expect(updateSession(data, at('2026-11-25').seasonId, at('2026-11-25').dayId, e.id, a.id, { value: 8, note: '  wall reads ' })).toBe(true);
    expect(e.minutes).toBe(18);
    expect(e.sessions![0]).toMatchObject({ value: 8, note: 'wall reads' });
    updateSession(data, at('2026-11-25').seasonId, at('2026-11-25').dayId, e.id, a.id, { note: '' });
    expect(e.sessions![0].note).toBeUndefined();
    expect(deleteSession(data, at('2026-11-25').seasonId, at('2026-11-25').dayId, e.id, b.id)).toBe(true);
    expect(e.minutes).toBe(8);
    expect(e.sessions).toHaveLength(1);
    deleteSession(data, at('2026-11-25').seasonId, at('2026-11-25').dayId, e.id, a.id);
    expect(d.entries).toHaveLength(0);
    expect(updateSession(data, at('2026-11-25').seasonId, at('2026-11-25').dayId, e.id, 'nope', { value: 1 })).toBe(false);
  });

  it('can change the one session of an entry from before 1.10', () => {
    const { data, day, at } = setup();
    const d = day('2026-11-25');
    d.entries.push({ id: 'old', activityId: 'act-freeplay', measure: 'time', minutes: 20, note: 'aerials', createdAt: '2026-11-25T10:00:00.000Z' });
    const { seasonId, dayId } = at('2026-11-25');
    expect(updateSession(data, seasonId, dayId, 'old', 'old-0', { value: 25, note: 'aerials, resets' })).toBe(true);
    expect(d.entries[0]).toMatchObject({ minutes: 25, sessions: [{ id: 'old-0', value: 25, note: 'aerials, resets' }] });
    expect(d.entries[0].note).toBeUndefined();
  });

  it('follows a new total typed in: more goes on the latest session, less comes off the latest', () => {
    const { day } = setup();
    const d = day('2026-11-25');
    addToDay(d, { activityId: 'act-freeplay', measure: 'time', minutes: 5, note: 'a' });
    addToDay(d, { activityId: 'act-freeplay', measure: 'time', minutes: 10, note: 'b' });
    const e = freeplay(d.entries);
    e.minutes = 20;
    fitSessions(e, 20);
    expect(e.sessions!.map((s) => s.value)).toEqual([5, 15]);
    e.minutes = 3;
    fitSessions(e, 3);
    expect(e.sessions!.map((s) => [s.value, s.note])).toEqual([[3, 'a']]);
  });
});

describe('sessions and routines', () => {
  it('unticking a routine item takes off exactly what it logged, even with sessions after it', () => {
    const { data, day } = setup();
    const d = day('2026-11-25');
    const r = createRoutine(data, 'Warm-up', [{ activityId: 'act-freeplay', minutes: 15 }]);
    const dr = startRoutineOnDay(d, r);
    completeRoutineItem(d, dr.id, dr.items[0].id, 15, undefined, 'timer');
    addToDay(d, { activityId: 'act-freeplay', measure: 'time', minutes: 7, note: 'extra' });
    const e = freeplay(d.entries);
    expect(e.sessions!.map((s) => [s.value, s.by, s.routineItemId === dr.items[0].id])).toEqual([
      [15, 'timer', true],
      [7, undefined, false],
    ]);
    undoRoutineItem(d, dr.id, dr.items[0].id);
    expect(e.minutes).toBe(7);
    expect(e.sessions!.map((s) => [s.value, s.note])).toEqual([[7, 'extra']]);
  });

  it('a routine item opens again when a session it relied on is shortened', () => {
    const { data, day, at } = setup();
    const d = day('2026-11-25');
    const r = createRoutine(data, 'Warm-up', [{ activityId: 'act-freeplay', minutes: 15 }]);
    const dr = startRoutineOnDay(d, r);
    completeRoutineItem(d, dr.id, dr.items[0].id);
    const e = freeplay(d.entries);
    expect(routineItemState(d, dr.items[0].id).done).toBe(true);
    updateSession(data, at('2026-11-25').seasonId, at('2026-11-25').dayId, e.id, e.sessions![0].id, { value: 10 });
    expect(routineItemState(d, dr.items[0].id)).toMatchObject({ done: false, remaining: 5 });
  });
});

describe('moving sessions', () => {
  it('moves picked sessions with their notes', () => {
    const { data, day, at } = setup();
    const a = day('2026-11-25');
    addToDay(a, { activityId: 'act-freeplay', measure: 'time', minutes: 5, note: 'one' });
    addToDay(a, { activityId: 'act-freeplay', measure: 'time', minutes: 10, note: 'two' });
    addToDay(a, { activityId: 'act-freeplay', measure: 'time', minutes: 20, note: 'three' });
    const e = freeplay(a.entries);
    const to = moveEntry(data, at('2026-11-25'), e.id, at('2026-11-26'), { sessionIds: [e.sessions![1].id] });
    expect(e.minutes).toBe(25);
    expect(e.sessions!.map((s) => s.note)).toEqual(['one', 'three']);
    expect(to!.minutes).toBe(10);
    expect(to!.sessions!.map((s) => [s.value, s.note])).toEqual([[10, 'two']]);
    // All sessions picked = the whole entry.
    moveEntry(data, at('2026-11-25'), e.id, at('2026-11-26'), { sessionIds: e.sessions!.map((s) => s.id) });
    expect(a.entries).toHaveLength(0);
    expect(to!.minutes).toBe(35);
    expect(to!.sessions!.map((s) => s.note)).toEqual(['two', 'one', 'three']);
  });

  it('moves minutes off the latest sessions, splitting one if needed', () => {
    const { data, day, at } = setup();
    const a = day('2026-11-25');
    addToDay(a, { activityId: 'act-freeplay', measure: 'time', minutes: 5, note: 'one' });
    addToDay(a, { activityId: 'act-freeplay', measure: 'time', minutes: 10, note: 'two' });
    const e = freeplay(a.entries);
    const to = moveEntry(data, at('2026-11-25'), e.id, at('2026-11-26'), { minutes: 12 });
    expect(e.sessions!.map((s) => [s.value, s.note])).toEqual([[3, 'one']]);
    expect(to!.sessions!.map((s) => [s.value, s.note])).toEqual([
      [2, undefined],
      [10, 'two'],
    ]);
  });
});

describe('games', () => {
  it('tracked games are not sessions; games added by hand to a game entry are', () => {
    const { data, day } = setup();
    applyLiveMatch(data, match(new Date(2026, 10, 25, 20, 0)));
    applyLiveMatch(data, match(new Date(2026, 10, 25, 20, 10)));
    const e = day('2026-11-25').entries.find((x) => x.activityId === 'act-2s')!;
    expect(e.amount).toBe(2);
    expect(e.sessions).toBeUndefined();
    expect(entrySessions(e)).toEqual([]);
    addToDay(day('2026-11-25'), { activityId: 'act-2s', measure: 'amount', amount: 1, note: 'with a friend' });
    expect(e.amount).toBe(3);
    expect(e.sessions!.map((s) => [s.value, s.note])).toEqual([[1, 'with a friend']]);
  });

  it('a game gets a note of its own', () => {
    const { data } = setup();
    applyLiveMatch(data, match(new Date(2026, 10, 25, 20, 0)));
    const m = data.matches[0];
    expect(setMatchNote(data, m.id, '  lost every kickoff ')).toBe(true);
    expect(m.note).toBe('lost every kickoff');
    setMatchNote(data, m.id, '');
    expect(m.note).toBeUndefined();
    expect(setMatchNote(data, 'nope', 'x')).toBe(false);
  });
});

describe('loading sessions', () => {
  it('drops broken sessions, keeps their sum equal to the total, and changes nothing the second time', () => {
    const raw = {
      version: 3,
      seasons: [
        {
          id: 's',
          number: 24,
          startDate: '2026-11-01',
          status: 'active',
          createdAt: '2026-11-01T00:00:00.000Z',
          days: [
            {
              id: 'd',
              date: '2026-11-01',
              entries: [
                {
                  id: 'e1',
                  activityId: 'act-freeplay',
                  measure: 'time',
                  minutes: 30,
                  createdAt: '2026-11-01T10:00:00.000Z',
                  sessions: [{ id: 'a', value: 10, at: '2026-11-01T10:00:00.000Z', note: '' }, { value: 'x' }, null, { id: 'b', value: 5 }],
                },
                { id: 'e2', activityId: 'act-freeplay', measure: 'time', minutes: 5, createdAt: '2026-11-01T11:00:00.000Z', sessions: 'nope' },
              ],
            },
          ],
        },
      ],
      matches: [{ id: 'm', note: '   ', source: 'game' }],
    };
    const data = normalizeData(raw);
    const [e1, e2] = data.seasons[0].days[0].entries;
    expect(e1.sessions!.map((s) => [s.id, s.value, s.note, s.at])).toEqual([
      ['a', 10, undefined, '2026-11-01T10:00:00.000Z'],
      ['b', 20, undefined, '2026-11-01T10:00:00.000Z'],
    ]);
    expect(e2.sessions).toBeUndefined();
    expect(data.matches[0].note).toBeUndefined();
    expect(normalizeData(JSON.parse(JSON.stringify(data)))).toEqual(data);
  });
});
