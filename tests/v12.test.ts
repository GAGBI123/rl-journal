// 1.2: sections inside sections, and the training timer.
import { describe, expect, it } from 'vitest';
import {
  activityToSection,
  addToDay,
  createDefaultData,
  createSeason,
  createSection,
  deleteSectionTree,
  descendantSectionIds,
  findOrCreateActivity,
  gamesSection,
  normalizeData,
  sectionLabel,
  sortedSections,
} from '../src/renderer/lib/journal';
import { buildContext, daySummary, statById } from '../src/renderer/lib/stats';
import { applyLiveMatch } from '../src/renderer/lib/sync';
import { earlyMinutes, elapsedMs, fmtClock, pauseTimer, remainingMs, resumeTimer, type TimerState } from '../src/shared/timer';

const TODAY = '2026-11-25';

function setup() {
  const data = createDefaultData();
  const season = createSeason(data, 21, '2026-11-01');
  const day = (date: string) => season.days.find((d) => d.date === date)!;
  return { data, season, day };
}

describe('sections inside sections', () => {
  it('creates Freeplay inside Training, inheriting kind and listing in tree order', () => {
    const { data } = setup();
    const fp = createSection(data, 'Freeplay', '#3b82f6', 'sec-training');
    const flicks = createSection(data, 'Flick drills', '#3b82f6', fp.id);
    expect(fp.kind).toBe('training');
    expect(flicks.kind).toBe('training');
    expect(sectionLabel(data, flicks.id)).toBe('Training › Freeplay › Flick drills');
    expect(sortedSections(data).map((s) => s.name)).toEqual(['Training', 'Freeplay', 'Flick drills', 'Games']);
    expect([...descendantSectionIds(data, 'sec-training')].length).toBe(3);
  });

  it('turns the Freeplay activity into a section and keeps what was logged under Overall', () => {
    const { data, day } = setup();
    addToDay(day(TODAY), { activityId: 'act-freeplay', measure: 'time', minutes: 40, unit: 'min' });
    const sec = activityToSection(data, 'act-freeplay')!;
    expect(sec.name).toBe('Freeplay');
    expect(sec.parentId).toBe('sec-training');
    const overall = data.activities.find((a) => a.id === 'act-freeplay')!;
    expect(overall).toMatchObject({ name: 'Overall', sectionId: sec.id });
    expect(day(TODAY).entries[0].activityId).toBe('act-freeplay');
  });

  it('counts sub-section time in Training totals, the section total and its split', () => {
    const { data, day } = setup();
    const fp = activityToSection(data, 'act-freeplay')!;
    const flicks = findOrCreateActivity(data, fp.id, 'Flicks', 'time');
    addToDay(day(TODAY), { activityId: 'act-freeplay', measure: 'time', minutes: 30, unit: 'min' });
    addToDay(day(TODAY), { activityId: flicks.id, measure: 'time', minutes: 15, unit: 'min' });
    const other = findOrCreateActivity(data, 'sec-training', 'Workshop', 'time');
    addToDay(day(TODAY), { activityId: other.id, measure: 'time', minutes: 20, unit: 'min' });

    const ctx = buildContext(data, { kind: 'all' }, TODAY);
    const v = (id: string) => statById(data, id)!.compute(ctx)!;
    expect(v('training.totalTime').value).toBe('1h 5m');
    expect(v(`sec:${fp.id}:time`).value).toBe('45m');
    const split = v(`sec:${fp.id}:split`);
    expect(split.breakdown?.map((b) => b.label)).toEqual(['Overall', 'Flicks']);
    // Training with a section inside gets its own split: Freeplay (45m) vs Workshop (20m).
    expect(v('sec:sec-training:split').breakdown?.map((b) => `${b.label} ${b.raw}`)).toEqual(['Freeplay 45', 'Workshop 20']);
    expect(statById(data, `act:${flicks.id}:time`)!.label).toBe('Freeplay › Flicks — total time');
    expect(daySummary(data, day(TODAY)).training).toBe(65);
  });

  it('deletes a section with everything inside it', () => {
    const { data, day } = setup();
    const fp = createSection(data, 'Freeplay', '#fff', 'sec-training');
    const inner = createSection(data, 'Inner', '#fff', fp.id);
    const a = findOrCreateActivity(data, inner.id, 'Flicks', 'time');
    addToDay(day(TODAY), { activityId: a.id, measure: 'time', minutes: 10, unit: 'min' });
    expect(deleteSectionTree(data, fp.id)).toBe(1);
    expect(data.sections.some((s) => s.id === fp.id || s.id === inner.id)).toBe(false);
    expect(day(TODAY).entries).toHaveLength(0);
  });

  it('still logs live games after a game mode moved into a sub-section', () => {
    const { data, day } = setup();
    const tourn = createSection(data, 'Grind', '#fff', gamesSection(data).id);
    const r3 = data.activities.find((a) => a.key === 'ranked-3s')!;
    r3.sectionId = tourn.id;
    applyLiveMatch(data, {
      guid: 'G',
      endedAt: new Date(2026, 10, 25, 20).toISOString(),
      playlistId: 13,
      leftEarly: false,
      overtime: false,
      winnerTeamNum: 0,
      teams: [],
      players: [],
    });
    expect(day(TODAY).entries[0].activityId).toBe(r3.id);
    expect(data.activities.filter((a) => a.key === 'ranked-3s')).toHaveLength(1);
  });

  it('repairs sub-sections on load (missing parent, inherited kind)', () => {
    const raw = JSON.parse(JSON.stringify(createDefaultData()));
    raw.sections.push({ id: 'x', name: 'Orphan', color: '#fff', kind: 'other', parentId: 'gone', order: 5 });
    raw.sections.push({ id: 'y', name: 'Sub', color: '#fff', kind: 'other', parentId: 'sec-games', order: 0 });
    raw.seasons = [];
    const d = normalizeData(raw);
    expect(d.sections.find((s) => s.id === 'x')!.parentId).toBeUndefined();
    expect(d.sections.find((s) => s.id === 'y')!.kind).toBe('games');
  });
});

describe('training timer', () => {
  const base = (over: Partial<TimerState> = {}): TimerState => ({
    id: 't',
    activityId: 'act-freeplay',
    activityName: 'Freeplay',
    label: 'Training · Freeplay',
    seasonId: 's',
    dayId: 'd',
    date: TODAY,
    durationMs: 30 * 60_000,
    unit: 'min',
    startedAt: 1_000_000,
    accumulatedMs: 0,
    createdAt: 1_000_000,
    ...over,
  });

  it('counts down on the wall clock and pauses / resumes', () => {
    let t = base();
    expect(remainingMs(t, 1_000_000 + 10 * 60_000)).toBe(20 * 60_000);
    t = pauseTimer(t, 1_000_000 + 10 * 60_000);
    expect(elapsedMs(t, 9_999_999_999)).toBe(10 * 60_000); // frozen while paused
    t = resumeTimer(t, 5_000_000);
    expect(remainingMs(t, 5_000_000 + 5 * 60_000)).toBe(15 * 60_000);
    expect(remainingMs(t, 99_999_999)).toBe(0);
  });

  it('formats the clock and rounds early finishes to whole minutes', () => {
    expect(fmtClock(65_000)).toBe('1:05');
    expect(fmtClock(3_723_000)).toBe('1:02:03');
    expect(fmtClock(0)).toBe('0:00');
    expect(earlyMinutes(base(), 1_000_000 + 20_000)).toBe(0);
    expect(earlyMinutes(base(), 1_000_000 + 40_000)).toBe(1);
    expect(earlyMinutes(base(), 1_000_000 + 12.4 * 60_000)).toBe(12);
  });
});
