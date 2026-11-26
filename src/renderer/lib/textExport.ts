// Seasons as plain text files for Notepad: one file per season, one block per day, the season's totals at the end.
import type { AppData, Day, Entry, Season } from '../../shared/model';
import { HONOR_DUEL_KEY } from '../../shared/playlists';
import { formatDate, todayISO } from './dates';
import { fmtMinutes, fmtNum, fmtPct } from './format';
import { dayNumber, inRecord, seasonLabel, sortedSections } from './journal';
import { rankedBySize, seasonRecap, winRate, type ModeTotal } from './recap';

const LINE = '-'.repeat(100);
const EQUALS = '='.repeat(100);
const RANKED_SIZES: Record<string, string> = { 'ranked-1s': '1vs1', 'ranked-2s': '2vs2', 'ranked-3s': '3vs3' };

const minutes = (m: number) => `${fmtNum(Math.round(m * 100) / 100, 2)} min`;
const wl = (w: number, l: number) => `${w}W ${l}L`;
const date = (iso: string) => formatDate(iso, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

/** File name for a season's text export ("RL Journal - Season 21.txt"). */
export function seasonFileName(season: Season) {
  const name = season.name?.trim() ? ` - ${season.name.trim()}` : '';
  return `RL Journal - Season ${season.number}${name}.txt`.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '');
}

function results(e: Entry, show: boolean, counts: boolean) {
  if (!show || e.measure !== 'amount' || (e.wins === undefined && e.losses === undefined)) return '';
  if (!counts) return ' (not in record)';
  return ` (${wl(e.wins ?? 0, e.losses ?? 0)})`;
}

/** One day as text: what was done, the training total, then ranked 1vs1 / 2vs2 / 3vs3 games. */
export function dayText(data: AppData, season: Season, day: Day): string[] {
  const out = [LINE, `day ${dayNumber(season, day)} (${date(day.date)})`, '---------', '-------------------------------------'];
  const showRecord = !day.hideRecord;
  const acts = new Map(data.activities.map((a) => [a.id, a]));
  const lines: string[] = [];
  let training = 0;
  const ranked = new Map<string, { games: number; wins: number; losses: number; known: boolean }>();
  // Section order, then the activity order inside each section.
  for (const section of sortedSections(data)) {
    const entries = day.entries
      .filter((e) => acts.get(e.activityId)?.sectionId === section.id)
      .sort((a, b) => (acts.get(a.activityId)?.order ?? 0) - (acts.get(b.activityId)?.order ?? 0));
    for (const e of entries) {
      const a = acts.get(e.activityId)!;
      if (e.measure === 'time' && section.kind === 'training') training += e.minutes ?? 0;
      const size = a.key ? RANKED_SIZES[a.key] : undefined;
      if (size && e.measure === 'amount') {
        const r = ranked.get(size) ?? { games: 0, wins: 0, losses: 0, known: false };
        r.games += e.amount ?? 0;
        r.wins += e.wins ?? 0;
        r.losses += e.losses ?? 0;
        r.known ||= e.wins !== undefined || e.losses !== undefined;
        ranked.set(size, r);
        if (e.note?.trim()) lines.push(`${size} notes: ${e.note.trim()}`);
        continue;
      }
      const games = section.kind === 'games' && e.measure === 'amount';
      const value = e.measure === 'time' ? minutes(e.minutes ?? 0) : fmtNum(e.amount ?? 0, 2);
      const label = games && !/match|duel/i.test(a.name) ? `${a.name} matches` : a.name;
      const note = e.note?.trim() ? ` - ${e.note.trim().replace(/\s*\n\s*/g, '; ')}` : '';
      lines.push(`${label} : ${value}${results(e, showRecord, inRecord(data, a.id))}${note}`);
    }
  }
  if (!day.entries.length) out.push('nothing logged (rest day)');
  for (const l of lines) out.push(l, '');
  if (day.note?.trim()) {
    const [first, ...rest] = day.note.trim().split(/\r?\n/);
    out.push(`notes: ${first}`, ...rest.map((l) => `       ${l}`), '');
  }
  if (day.entries.length) {
    out.push(`total training time : ${minutes(training)}${training >= 60 ? ` (${fmtMinutes(training)})` : ''}`, '');
    for (const size of ['1vs1', '2vs2', '3vs3']) {
      const r = ranked.get(size);
      out.push(`${size} matches: ${r ? fmtNum(r.games) : 0}${r && r.known && showRecord ? ` (${wl(r.wins, r.losses)})` : ''}`);
    }
  }
  return out;
}

function modeLine(m: ModeTotal) {
  const rate = winRate(m);
  return `${fmtNum(m.games)}${m.wins + m.losses ? ` (${wl(m.wins, m.losses)}, ${fmtPct(rate)} won)` : ''}`;
}

/** The season's totals, like an end-of-season write-up. */
export function recapText(data: AppData, season: Season, today = todayISO()): string[] {
  const r = seasonRecap(data, season, today);
  const done = season.status === 'closed';
  const out = [EQUALS, `${seasonLabel(season)} (${done ? 'end of season' : 'season so far'})`, LINE];
  out.push(`Total ranked games in ${r.days} days: ${fmtNum(r.ranked.games)}`);
  for (const { size, mode } of rankedBySize(r)) out.push(`${size}: ${modeLine(mode)}`);
  const otherRanked = r.modes.filter((m) => m.key?.startsWith('ranked-') && !RANKED_SIZES[m.key]);
  for (const m of otherRanked) out.push(`${m.name}: ${modeLine(m)}`);
  out.push('');
  const others = r.modes.filter((m) => !m.key?.startsWith('ranked-'));
  if (others.length) {
    out.push('Other games');
    for (const m of others) out.push(`${m.name}: ${m.key === HONOR_DUEL_KEY || inRecord(data, m.activityId) ? modeLine(m) : `${fmtNum(m.games)} (not in record)`}`);
    out.push('');
  }
  out.push(`All games (no honor duels): ${fmtNum(r.games)}${r.record.wins + r.record.losses ? ` (${wl(r.record.wins, r.record.losses)}, ${fmtPct(winRate(r.record))} won)` : ''}`);
  if (r.mostGamesDay) out.push(`Most games in a day: ${fmtNum(r.mostGamesDay.value)} on day ${r.mostGamesDay.number} (${date(r.mostGamesDay.day.date)})`);
  out.push('');
  out.push(`Total training time: ${fmtMinutes(r.training)} (${minutes(r.training)})`);
  out.push(`Average training: ${fmtMinutes(r.training / Math.max(1, r.days))} a day, ${fmtMinutes(r.training / Math.max(1, r.trainingDays))} on days you trained`);
  if (r.bestTrainingDay) out.push(`Best training day: ${fmtMinutes(r.bestTrainingDay.value)} on day ${r.bestTrainingDay.number} (${date(r.bestTrainingDay.day.date)})`);
  if (r.topTraining.length) {
    out.push('Most trained:');
    r.topTraining.slice(0, 8).forEach((t, i) => out.push(`  ${i + 1}. ${t.name}: ${fmtMinutes(t.minutes)}`));
  }
  if (r.amounts.length) {
    out.push('Counted:');
    for (const a of r.amounts.slice(0, 8)) out.push(`  ${a.name}: ${fmtNum(a.amount, 2)}`);
  }
  out.push('');
  out.push(`Active days: ${r.activeDays} of ${r.days} (${r.trainingDays} with training, ${r.gameDays} with games)`);
  out.push(`Longest streak: ${r.longestStreak} day${r.longestStreak === 1 ? '' : 's'} in a row`);
  if (r.tracked.games) {
    const t = r.tracked;
    const per = (n: number) => fmtNum(n / t.games, 2);
    out.push('');
    out.push(`Tracked matches: ${fmtNum(t.games)}`);
    out.push(`Per game: ${per(t.goals)} goals, ${per(t.assists)} assists, ${per(t.saves)} saves, ${per(t.shots)} shots`);
    if (t.shots) out.push(`Shooting: ${fmtPct(t.goals / t.shots, 1)} (${t.goals} goals from ${t.shots} shots)`);
    if (t.overtime) out.push(`Overtime games: ${t.overtime} (${t.overtimeWins} won)`);
    if (t.best) out.push(`Best match: ${fmtNum(t.best.score)} points, ${t.best.mode} on ${date(t.best.date)} (${t.best.goals}G ${t.best.assists}A ${t.best.saves}S)`);
    for (const a of r.accounts) out.push(`On ${a.label}: ${fmtNum(a.games)} games${a.wins + a.losses ? ` (${wl(a.wins, a.losses)})` : ''}`);
  }
  out.push(EQUALS);
  return out;
}

/** A whole season as one text file (Windows line endings, so Notepad shows it right everywhere). */
export function seasonText(data: AppData, season: Season, today = todayISO()): string {
  const last = season.status === 'closed' ? season.days[season.days.length - 1]?.date ?? today : today;
  const days = season.days.filter((d) => d.date <= last || d.entries.length || d.note?.trim());
  const first = season.days[0]?.date ?? season.startDate;
  const out = [
    `RL Journal - ${seasonLabel(season)}`,
    `${date(first)} - ${date(season.days[season.days.length - 1]?.date ?? first)} (${season.days.length} days${season.status === 'closed' ? ', completed' : ''})`,
    `Exported ${date(today)}`,
    '',
  ];
  for (const day of days) out.push(...dayText(data, season, day));
  out.push(LINE, '', '', ...recapText(data, season, today), '');
  return out.join('\r\n');
}

/** Every season that has days, as { name, content } files. */
export function allSeasonTexts(data: AppData, today = todayISO()) {
  const used = new Set<string>();
  return [...data.seasons]
    .filter((s) => s.days.length)
    .sort((a, b) => a.number - b.number || a.startDate.localeCompare(b.startDate))
    .map((s) => {
      // Two seasons with the same number and name get "(2)", "(3)", … so neither file is overwritten.
      let name = seasonFileName(s);
      for (let i = 2; used.has(name.toLowerCase()); i++) name = seasonFileName(s).replace(/\.txt$/, ` (${i}).txt`);
      used.add(name.toLowerCase());
      return { name, content: seasonText(data, s, today) };
    });
}
