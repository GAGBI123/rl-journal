import { useMemo, useState } from 'react';
import { ArrowRightLeft, ChevronDown, ChevronLeft, ChevronRight, Clock, Eye, EyeOff, Gamepad2, Layers, ListChecks, Merge, Moon, NotebookPen, Pencil, Radio, RotateCcw, Split, Trash2, Trophy, Zap } from 'lucide-react';
import { useStore } from '../store';
import {
  activityById,
  canEndDay,
  currentDate,
  dayEntriesOf,
  dayNumber,
  deleteMatch,
  entryAccountParts,
  entryNotes,
  entrySessions,
  findSeason,
  inRecord,
  matchInRecord,
  mergeAccountEntries,
  reopenableDate,
  seasonLabel,
  sectionLabel,
  sortedSections,
  splitEntryByAccount,
} from '../lib/journal';
import { ENTRY_SORTS, MATCH_SORTS, sortEntries, sortMatches } from '../lib/matchSort';
import { SortMenu } from '../components/SortMenu';
import { formatLongDate, todayISO } from '../lib/dates';
import { fmtMinutes, fmtNum } from '../lib/format';
import { daySummary } from '../lib/stats';
import { EntryForm } from '../components/EntryForm';
import { confirmDialog, EmptyState, Modal } from '../components/ui';
import { DayRoutines, StartRoutineModal } from '../components/DayRoutines';
import { RunningTimerCard } from '../components/TimerPill';
import { endCurrentDay, MoveEntryModal, reopenEndedDay } from '../components/DayTools';
import { EntryDetails, entryMatches, looksNotStarted } from '../components/EntryDetails';
import type { Account, Entry, EntrySort, MatchRecord, MatchSort } from '../../shared/model';

export function DayPage({ seasonId, dayId }: { seasonId: string; dayId: string }) {
  const data = useStore((s) => s.data);
  const mutate = useStore((s) => s.mutate);
  const navigate = useStore((s) => s.navigate);
  const season = findSeason(data, seasonId);
  const day = season?.days.find((d) => d.id === dayId);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [noteDraft, setNoteDraft] = useState<string | null>(null);
  const [pickRoutine, setPickRoutine] = useState(false);
  // The entry being moved (or one of its sessions).
  const [moving, setMoving] = useState<{ entry: Entry; sessionId?: string } | null>(null);
  // Entries opened to show each game / session.
  const [openEntries, setOpenEntries] = useState<Set<string>>(() => new Set());
  const toast = useStore((s) => s.toast);

  // Sorting games by wins would show the wins of a day whose record is hidden.
  const gamesSortOptions = ENTRY_SORTS.filter((o) => !day?.hideRecord || !o.record);
  const gamesSort: EntrySort = gamesSortOptions.some((o) => o.value === data.settings.dayGamesSort) ? data.settings.dayGamesSort : 'logged';

  const groups = useMemo(() => {
    if (!day) return [];
    return sortedSections(data)
      .map((section) => {
        const entries = day.entries.filter((e) => activityById(data, e.activityId)?.sectionId === section.id);
        return { section, entries: section.kind === 'games' ? sortEntries(data, entries, gamesSort) : entries };
      })
      .filter((g) => g.entries.length);
  }, [data, day, gamesSort]);

  if (!season || !day) {
    return (
      <div className="page">
        <EmptyState title="Day not found" body="It may have been deleted." action={<button className="btn" onClick={() => navigate({ name: 'home' })}>Back to seasons</button>} />
      </div>
    );
  }

  const idx = season.days.findIndex((d) => d.id === day.id);
  const prev = season.days[idx - 1];
  const next = season.days[idx + 1];
  // The current day (games are logged to it). With "End days yourself" it can still be yesterday after midnight.
  const calendarToday = todayISO();
  const isCurrent = season.status === 'active' && day.date === currentDate(data.settings, calendarToday);
  const endable = isCurrent && canEndDay(data.settings, calendarToday);
  const reopenable = season.status === 'active' && reopenableDate(data.settings, calendarToday) === day.date;
  const sum = daySummary(data, day);
  // Per-day choice: show or hide this day's wins / losses.
  const showRecord = !day.hideRecord;
  const hasRecord = sum.results.length > 0 || sum.honor.known || data.matches.some((m) => m.dayId === day.id && m.result !== 'unknown');
  const toggleRecord = () =>
    mutate((d) => {
      const t = findSeason(d, season.id)?.days.find((x) => x.id === day.id);
      if (!t) return;
      if (t.hideRecord) delete t.hideRecord;
      else t.hideRecord = true;
    });
  const go = (id: string) => navigate({ name: 'day', seasonId: season.id, dayId: id }, { replace: true });

  const remove = async (e: Entry) => {
    const a = activityById(data, e.activityId);
    const ok = await confirmDialog({
      title: `Delete ${a?.name ?? 'entry'}?`,
      body: e.auto ? 'This entry was added by automatic sync. Its tracked match details will be deleted too.' : undefined,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    mutate((d) => {
      const t = findSeason(d, season.id)?.days.find((x) => x.id === day.id);
      if (t) t.entries = t.entries.filter((x) => x.id !== e.id);
      d.matches = d.matches.filter((m) => m.entryId !== e.id);
    });
  };

  const removeMatch = async (m: MatchRecord) => {
    const name = activityById(data, m.activityId)?.name ?? m.mode;
    const entry = day.entries.find((e) => e.id === m.entryId);
    const left = Math.max(0, (entry?.amount ?? 1) - 1);
    const result = m.result === 'win' ? ' Its win is taken off too.' : m.result === 'loss' ? ' Its loss is taken off too.' : '';
    const ok = await confirmDialog({
      title: `Delete this ${name} game?`,
      body: entry
        ? `${name} on this day goes from ${entry.amount ?? 1} to ${left} game${left === 1 ? '' : 's'}${left === 0 ? ' (the entry goes away)' : ''}.${result}`
        : 'Only the tracked match details are deleted.',
      confirmLabel: 'Delete game',
      danger: true,
    });
    if (!ok) return;
    mutate((d) => {
      deleteMatch(d, m.id);
    });
  };

  const saveNote = () => {
    if (noteDraft === null) return;
    mutate((d) => {
      const t = findSeason(d, season.id)?.days.find((x) => x.id === day.id);
      if (t) t.note = noteDraft.trim() || undefined;
    });
    setNoteDraft(null);
  };

  const mergeEntry = (e: Entry) => {
    const name = activityById(data, e.activityId)?.name ?? 'these';
    const n = dayEntriesOf(day, e.activityId, e.measure).length;
    mutate((d) => {
      const merged = mergeAccountEntries(d, season.id, day.id, e.id);
      if (merged) setOpenEntries((s) => new Set(s).add(merged.id));
    });
    toast({ kind: 'success', title: `${name}: ${n} entries merged`, body: 'Later games on any account today join it too. Open it to see each game and account.' });
  };

  const splitEntry = (e: Entry) => {
    mutate((d) => void splitEntryByAccount(d, season.id, day.id, e.id));
  };

  const toggleOpen = (id: string) =>
    setOpenEntries((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const accountOf = (id?: string): Account | undefined => (id ? data.accounts.find((a) => a.id === id) : undefined);

  const matchesToday = data.matches.filter((m) => m.dayId === day.id);
  const matchesOpen = data.settings.dayMatchesOpen;
  const counted = matchesToday.filter((m) => matchInRecord(data, m));
  const matchWins = counted.filter((m) => m.result === 'win').length;
  const matchLosses = counted.filter((m) => m.result === 'loss').length;
  // Sorting by result would show the wins and losses of a day whose record is hidden.
  const sortOptions = MATCH_SORTS.filter((o) => showRecord || !o.record);
  const sort: MatchSort = sortOptions.some((o) => o.value === data.settings.dayMatchesSort) ? data.settings.dayMatchesSort : 'recent';
  const matchGroups = sortMatches(data, matchesToday, sort);
  // Games from 2+ accounts: each game gets its account's colored dot, with a legend above the table.
  const dayAccounts = sortMatches(data, matchesToday, 'account');
  const multiAccount = dayAccounts.length > 1;
  const matchCols = 5 + (showRecord ? 1 : 0);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="row" style={{ gap: 12 }}>
            <h1>Day {dayNumber(season, day)}</h1>
            {isCurrent && (
              <span className="badge blue" title={data.settings.endDayManually ? 'Games are logged to this day until you end it' : undefined}>
                {day.date === calendarToday ? 'Today' : 'Current day'}
              </span>
            )}
            {reopenable && <span className="badge done">Day ended</span>}
            {season.status === 'closed' && <span className="badge done">Season completed</span>}
          </div>
          <div className="subtitle">
            {formatLongDate(day.date)} <span className="muted">·</span>
            <button className="btn ghost small" style={{ padding: '0 6px' }} onClick={() => navigate({ name: 'season', seasonId: season.id })}>
              {seasonLabel(season)}
            </button>
          </div>
        </div>
        <div className="actions">
          {endable && (
            <button className="btn" onClick={() => void endCurrentDay()} title="Done for the day: games you play from now on go to the next day">
              <Moon size={16} /> End day
            </button>
          )}
          {reopenable && (
            <button className="btn" onClick={reopenEndedDay} title="Log games to this day again">
              <RotateCcw size={16} /> Reopen day
            </button>
          )}
          <button className="btn" onClick={() => setPickRoutine(true)} title="Start one of your training routines on this day">
            <ListChecks size={16} /> Start routine
          </button>
          {(hasRecord || !showRecord) && (
            <button
              className={`btn ${showRecord ? '' : 'on-toggle'}`}
              onClick={toggleRecord}
              title={showRecord ? "Hide this day's wins and losses" : "Show this day's wins and losses"}
              aria-pressed={!showRecord}
            >
              {showRecord ? <EyeOff size={16} /> : <Eye size={16} />} {showRecord ? 'Hide record' : 'Show record'}
            </button>
          )}
          <button className="btn" disabled={!prev} onClick={() => prev && go(prev.id)}>
            <ChevronLeft size={16} /> Previous
          </button>
          <button className="btn" disabled={!next} onClick={() => next && go(next.id)}>
            Next <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="summary-strip" style={{ marginBottom: 18 }}>
        <div className="card kv">
          <div className="k">Training</div>
          <div className="v">{fmtMinutes(sum.training)}</div>
        </div>
        <div className="card kv">
          <div className="k">Games</div>
          <div className="v">{fmtNum(sum.normalGames)}</div>
          {showRecord && sum.results.length > 0 && (
            <div className="mode-results">
              {sum.results.map((r) => (
                <span key={r.activityId} title={`${r.name}: ${r.wins} wins, ${r.losses} losses`}>
                  <b>{r.name}</b> <span className="up">{r.wins}W</span> <span className="down">{r.losses}L</span>
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="card kv">
          <div className="k">Honor duels</div>
          <div className="v">{fmtNum(sum.honorDuels)}</div>
          {showRecord && sum.honor.known && (
            <div className="mode-results">
              <span>
                <span className="up">{sum.honor.wins}W</span> <span className="down">{sum.honor.losses}L</span>
              </span>
            </div>
          )}
        </div>
      </div>
      {!showRecord && hasRecord && (
        <div className="muted small record-hidden">
          <EyeOff size={13} /> Wins and losses are hidden for this day.{' '}
          <button className="crumb-btn" onClick={toggleRecord}>
            Show
          </button>
        </div>
      )}

      <div className="day-layout">
        <div className="card entry-form">
          <div className="row between" style={{ marginBottom: 14 }}>
            <h3 style={{ margin: 0, fontSize: 16 }}>Add activity</h3>
            <Zap size={16} color="var(--orange)" />
          </div>
          <EntryForm season={season} day={day} />
        </div>

        <div>
          <RunningTimerCard />
          <DayRoutines season={season} day={day} />
          {groups.length === 0 ? (
            <EmptyState icon={<NotebookPen size={30} />} title="Nothing logged yet" body="Pick a section and add what you did today." />
          ) : (
            groups.map(({ section, entries }) => (
              <div className="entry-group" key={section.id}>
                <div className="g-head">
                  <span className="color-dot" style={{ background: section.color }} />
                  {sectionLabel(data, section.id)}
                  <span className="muted" style={{ fontWeight: 500 }}>· {entries.length}</span>
                  {section.kind === 'games' && entries.length > 1 && (
                    <SortMenu
                      value={gamesSort}
                      options={gamesSortOptions}
                      title={`Sort the ${section.name} entries`}
                      onChange={(v) => mutate((d) => void (d.settings.dayGamesSort = v))}
                    />
                  )}
                </div>
                {entries.map((e) => {
                  const a = activityById(data, e.activityId);
                  const { parts } = e.auto ? entryAccountParts(data, e) : { parts: [] };
                  // One account's games, or games from several accounts merged (games with no known account join either).
                  const known = parts.filter((p) => p.accountId);
                  const merged = !!e.auto && (!!e.auto.merged || known.length > 1);
                  const account = accountOf(merged ? undefined : e.auto?.accountId ?? known[0]?.accountId);
                  // Other entries of this activity today (e.g. the same mode on another account).
                  const siblings = dayEntriesOf(day, e.activityId, e.measure).length;
                  const counts = inRecord(data, e.activityId);
                  const hasResults = (e.wins !== undefined || e.losses !== undefined) && e.measure === 'amount';
                  // Opens to show each game (tracked matches) and each session (timers, routines, added by hand).
                  const games = entryMatches(data.matches, e);
                  const sessions = entrySessions(e);
                  const isGames = section.kind === 'games';
                  const openable = games.length > 0 || sessions.length > 1;
                  const open = openable && openEntries.has(e.id);
                  const gameNotes = games.filter((m) => m.note).length;
                  const notes = entryNotes(e);
                  // Open, each game and session shows its own note (a game entry's own note stays).
                  const shownNotes = open ? (e.auto && e.note?.trim() ? [e.note.trim()] : []) : notes;
                  const openLabel = games.length
                    ? `${games.length} ${games.length === 1 ? 'game' : 'games'}${sessions.length ? ` + ${sessions.length} by hand` : ''}`
                    : `${sessions.length} sessions`;
                  return (
                    <div className={`entry-row ${open ? 'open' : ''}`} key={e.id} style={{ ['--e-color' as any]: section.color }}>
                      <div className="e-bar" />
                      <div className="e-body">
                        <div className="e-main">
                          <div style={{ minWidth: 0 }}>
                            <div className="e-name row" style={{ gap: 8 }}>
                              <span className="e-title">{a?.name ?? 'Unknown'}</span>
                              {e.auto &&
                                (merged ? (
                                  <button
                                    type="button"
                                    className="badge blue acct-badge merged"
                                    aria-expanded={open}
                                    title={open ? 'Hide the games' : 'Show each game and how many were on each account'}
                                    onClick={() => toggleOpen(e.id)}
                                    disabled={!openable}
                                  >
                                    <Radio size={11} /> Auto · {known.length > 1 ? `${known.length} accounts` : accountOf(known[0]?.accountId)?.label ?? 'all accounts'}
                                  </button>
                                ) : (
                                  <span
                                    className={`badge blue acct-badge ${account ? 'tinted' : ''}`}
                                    style={account ? { ['--acct' as any]: account.color } : undefined}
                                    title={account ? `Played on ${account.label}` : 'Logged by the live game connection'}
                                  >
                                    {account ? <span className="acct-dot" /> : <Radio size={11} />} Auto{account ? ` · ${account.label}` : ''}
                                  </span>
                                ))}
                              {openable && (
                                <button
                                  type="button"
                                  className="badge open-badge"
                                  aria-expanded={open}
                                  title={open ? 'Hide' : isGames || games.length ? 'Show each game: score, stats and notes' : 'Show each session, with its own note'}
                                  onClick={() => toggleOpen(e.id)}
                                >
                                  <Layers size={11} /> {openLabel}
                                  <ChevronDown size={11} className="chev" />
                                </button>
                              )}
                            </div>
                            <div className="e-meta">
                              {e.measure === 'time' ? (
                                <span className="row" style={{ gap: 4, display: 'inline-flex' }}>
                                  <Clock size={11} /> {`${+(e.minutes ?? 0).toFixed(2)} min`}
                                </span>
                              ) : (
                                <span>{section.kind === 'games' ? 'Games' : 'Amount'}</span>
                              )}
                              {showRecord && hasResults && counts && (
                                <span>
                                  {' '}
                                  · <span className="up">{e.wins ?? 0}W</span> <span className="down">{e.losses ?? 0}L</span>
                                  {(e.wins ?? 0) + (e.losses ?? 0) < (e.amount ?? 0) && (
                                    <span className="muted"> · {(e.amount ?? 0) - (e.wins ?? 0) - (e.losses ?? 0)} unknown</span>
                                  )}
                                </span>
                              )}
                              {showRecord && hasResults && !counts && (
                                <span title="Private matches are left out of your wins and losses (Settings → Games & logging)"> · not in your record</span>
                              )}
                              {!open && gameNotes > 0 && (
                                <span className="e-notes-hint" title="Open it to read the notes of each game">
                                  {' '}
                                  · <NotebookPen size={11} /> {gameNotes} {gameNotes === 1 ? 'note' : 'notes'}
                                </span>
                              )}
                            </div>
                            {shownNotes.length > 0 && <div className="e-desc">{shownNotes.join('\n')}</div>}
                          </div>
                          <div className="e-value">
                            {e.measure === 'time' ? fmtMinutes(e.minutes) : fmtNum(e.amount)}
                            {e.measure === 'amount' && section.kind === 'games' && <div className="tiny muted" style={{ fontWeight: 500 }}>games</div>}
                          </div>
                          <div className="e-actions">
                            {siblings > 1 && (
                              <button
                                className="icon-btn"
                                title={`Merge the ${siblings} ${a?.name ?? ''} entries of this day into one (you can still see each account's games)`}
                                aria-label="Merge with the other entries of this activity"
                                onClick={() => mergeEntry(e)}
                              >
                                <Merge size={15} />
                              </button>
                            )}
                            {merged && data.settings.splitAccounts && (
                              <button className="icon-btn" title="Split by account: each account's games get their own entry again" aria-label="Split by account" onClick={() => splitEntry(e)}>
                                <Split size={15} />
                              </button>
                            )}
                            <button className="icon-btn" title="Move to another day" aria-label="Move entry to another day" onClick={() => setMoving({ entry: e })}>
                              <ArrowRightLeft size={15} />
                            </button>
                            <button className="icon-btn" title="Edit" aria-label="Edit entry" onClick={() => setEditing(e)}>
                              <Pencil size={15} />
                            </button>
                            <button className="icon-btn" title="Delete" aria-label="Delete entry" onClick={() => remove(e)}>
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </div>
                        {open && (
                          <EntryDetails
                            season={season}
                            day={day}
                            entry={e}
                            games={isGames}
                            showRecord={showRecord}
                            onDeleteMatch={removeMatch}
                            onMoveSession={(s) => setMoving({ entry: e, sessionId: s.id })}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))
          )}

          {matchesToday.length > 0 && (
            <div className={`card matches-card ${matchesOpen ? 'open' : ''}`} style={{ marginTop: 8 }}>
              <div className="matches-head">
                <button
                  className="matches-toggle"
                  aria-expanded={matchesOpen}
                  title={matchesOpen ? 'Hide the matches' : 'Show the matches (from the live game connection)'}
                  onClick={() => mutate((d) => void (d.settings.dayMatchesOpen = !matchesOpen))}
                >
                  <Gamepad2 size={16} />
                  <b>Tracked matches</b>
                  <span className="muted small">· {matchesToday.length}</span>
                  <span className="matches-head-end">
                    {showRecord && matchWins + matchLosses > 0 && (
                      <span className="small">
                        <span className="up">{matchWins}W</span> <span className="muted">–</span> <span className="down">{matchLosses}L</span>
                      </span>
                    )}
                  </span>
                </button>
                {matchesOpen && matchesToday.length > 1 && (
                  <SortMenu
                    value={sort}
                    options={sortOptions}
                    title="Sort the games"
                    onChange={(v) => mutate((d) => void (d.settings.dayMatchesSort = v))}
                  />
                )}
                <button
                  className="matches-chev"
                  aria-label={matchesOpen ? 'Hide the matches' : 'Show the matches'}
                  title={matchesOpen ? 'Hide the matches' : 'Show the matches'}
                  onClick={() => mutate((d) => void (d.settings.dayMatchesOpen = !matchesOpen))}
                >
                  <ChevronDown size={16} className="chev" />
                </button>
              </div>
              {matchesOpen && multiAccount && (
                <div className="m-legend">
                  {dayAccounts.map((g) => (
                    <span key={g.key} style={g.color ? { ['--acct' as any]: g.color } : undefined}>
                      <span className="acct-dot" /> {g.label} <span className="muted">· {g.matches.length}</span>
                    </span>
                  ))}
                </div>
              )}
              {matchesOpen && (
                <div className="m-table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Mode</th>
                        {showRecord && <th>Result</th>}
                        <th title="Your in-game points">Points</th>
                        <th title="Goals / assists / saves / shots">G/A/S/Sh</th>
                        <th>Time</th>
                        <th aria-label="Actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {matchGroups.map((g) => {
                        const gc = g.matches.filter((m) => matchInRecord(data, m));
                        const gw = gc.filter((m) => m.result === 'win').length;
                        const gl = gc.filter((m) => m.result === 'loss').length;
                        return [
                          g.key !== '' || matchGroups.length > 1 ? (
                            <tr className="m-group" key={`g-${g.key}`} style={g.color ? { ['--acct' as any]: g.color } : undefined}>
                              <td colSpan={matchCols}>
                                {sort === 'account' && <span className="acct-dot" />}
                                <b>{g.label}</b> <span className="muted">· {g.matches.length}</span>
                                {showRecord && sort !== 'result' && gw + gl > 0 && (
                                  <span className="m-group-wl">
                                    <span className="up">{gw}W</span> <span className="down">{gl}L</span>
                                  </span>
                                )}
                              </td>
                            </tr>
                          ) : null,
                          ...g.matches.map((m) => {
                            const acc = accountOf(m.accountId);
                            const countsHere = matchInRecord(data, m);
                            return (
                              <tr key={m.id}>
                                <td>
                                  {multiAccount && sort !== 'account' && (
                                    <span className="acct-dot m-acct" style={acc ? { ['--acct' as any]: acc.color } : undefined} title={acc?.label ?? 'Unknown account'} />
                                  )}
                                  <span className="m-mode" title={multiAccount ? `Played on ${acc?.label ?? 'an unknown account'}` : undefined}>
                                    {activityById(data, m.activityId)?.name ?? m.mode}
                                  </span>
                                  {m.note && (
                                    <span className="m-note" title={m.note} aria-label={`Note: ${m.note}`}>
                                      <NotebookPen size={12} />
                                    </span>
                                  )}
                                  {looksNotStarted(m) && (
                                    <span className="badge suspect" title="No touches, points or goals: this match probably never started (e.g. it was cancelled). Delete it if it wasn't a real game.">
                                      Didn't start?
                                    </span>
                                  )}
                                </td>
                                {showRecord && (
                                  <td
                                    className={!countsHere ? 'muted' : m.result === 'win' ? 'up' : m.result === 'loss' ? 'down' : 'muted'}
                                    title={countsHere ? undefined : 'Private match: not counted in your wins and losses (Settings → Games & logging)'}
                                  >
                                    <span className="m-result">
                                      {m.result === 'win' ? (
                                        <>
                                          <Trophy size={13} /> Win
                                        </>
                                      ) : m.result === 'loss' ? (
                                        m.leftEarly ? 'Left early' : 'Loss'
                                      ) : (
                                        'Unknown'
                                      )}
                                      {m.teamScore !== undefined && (
                                        <span className="m-score">
                                          {m.teamScore}–{m.opponentScore ?? 0}
                                          {m.overtime ? ' OT' : ''}
                                        </span>
                                      )}
                                    </span>
                                  </td>
                                )}
                                <td>{m.me ? fmtNum(m.me.score) : '—'}</td>
                                <td>{m.me ? `${m.me.goals}/${m.me.assists}/${m.me.saves}/${m.me.shots}` : '—'}</td>
                                <td className="muted">{new Date(m.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</td>
                                <td className="m-actions">
                                  <button className="icon-btn" title="Delete this game (not yours, cancelled, …)" aria-label="Delete this game" onClick={() => removeMatch(m)}>
                                    <Trash2 size={14} />
                                  </button>
                                </td>
                              </tr>
                            );
                          }),
                        ];
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <div className="card" style={{ marginTop: 14 }}>
            <div className="row" style={{ gap: 8, marginBottom: 8 }}>
              <NotebookPen size={15} />
              <b>Notes</b>
            </div>
            <textarea
              className="input"
              placeholder="How did today go? What did you work on?"
              value={noteDraft ?? day.note ?? ''}
              onChange={(e) => setNoteDraft(e.target.value)}
              onBlur={saveNote}
            />
          </div>
        </div>
      </div>

      {pickRoutine && <StartRoutineModal season={season} day={day} onClose={() => setPickRoutine(false)} />}
      {moving && <MoveEntryModal season={season} day={day} entry={moving.entry} sessionId={moving.sessionId} onClose={() => setMoving(null)} />}
      {editing && (
        <Modal title="Edit entry" onClose={() => setEditing(null)}>
          <EntryForm season={season} day={day} editing={editing} onDone={() => setEditing(null)} />
        </Modal>
      )}
    </div>
  );
}
