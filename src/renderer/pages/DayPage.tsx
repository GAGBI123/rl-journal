import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Clock, Gamepad2, NotebookPen, Pencil, Radio, Trash2, Trophy, Zap } from 'lucide-react';
import { useStore } from '../store';
import { activityById, dayNumber, findSeason, seasonLabel, sortedSections } from '../lib/journal';
import { formatLongDate, todayISO } from '../lib/dates';
import { fmtMinutes, fmtNum } from '../lib/format';
import { daySummary } from '../lib/stats';
import { EntryForm } from '../components/EntryForm';
import { confirmDialog, EmptyState, Modal } from '../components/ui';
import type { Entry } from '../../shared/model';

export function DayPage({ seasonId, dayId }: { seasonId: string; dayId: string }) {
  const data = useStore((s) => s.data);
  const mutate = useStore((s) => s.mutate);
  const navigate = useStore((s) => s.navigate);
  const season = findSeason(data, seasonId);
  const day = season?.days.find((d) => d.id === dayId);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [noteDraft, setNoteDraft] = useState<string | null>(null);

  const groups = useMemo(() => {
    if (!day) return [];
    return sortedSections(data)
      .map((section) => ({
        section,
        entries: day.entries.filter((e) => activityById(data, e.activityId)?.sectionId === section.id),
      }))
      .filter((g) => g.entries.length);
  }, [data, day]);

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
  const isToday = day.date === todayISO();
  const sum = daySummary(data, day);
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

  const saveNote = () => {
    if (noteDraft === null) return;
    mutate((d) => {
      const t = findSeason(d, season.id)?.days.find((x) => x.id === day.id);
      if (t) t.note = noteDraft.trim() || undefined;
    });
    setNoteDraft(null);
  };

  const matchesToday = data.matches.filter((m) => m.dayId === day.id);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="row" style={{ gap: 12 }}>
            <h1>Day {dayNumber(season, day)}</h1>
            {isToday && <span className="badge blue">Today</span>}
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
          {sum.results.length > 0 && (
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
          {sum.honor.known && (
            <div className="mode-results">
              <span>
                <span className="up">{sum.honor.wins}W</span> <span className="down">{sum.honor.losses}L</span>
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="day-layout">
        <div className="card entry-form">
          <div className="row between" style={{ marginBottom: 14 }}>
            <h3 style={{ margin: 0, fontSize: 16 }}>Add activity</h3>
            <Zap size={16} color="var(--orange)" />
          </div>
          <EntryForm season={season} day={day} />
        </div>

        <div>
          {groups.length === 0 ? (
            <EmptyState icon={<NotebookPen size={30} />} title="Nothing logged yet" body="Pick a section and add what you did today." />
          ) : (
            groups.map(({ section, entries }) => (
              <div className="entry-group" key={section.id}>
                <div className="g-head">
                  <span className="color-dot" style={{ background: section.color }} />
                  {section.name}
                  <span className="muted" style={{ fontWeight: 500 }}>· {entries.length}</span>
                </div>
                {entries.map((e) => {
                  const a = activityById(data, e.activityId);
                  const account = e.auto?.accountId ? data.accounts.find((x) => x.id === e.auto!.accountId) : undefined;
                  return (
                    <div className="entry-row" key={e.id} style={{ ['--e-color' as any]: section.color }}>
                      <div className="e-bar" />
                      <div style={{ minWidth: 0 }}>
                        <div className="e-name row" style={{ gap: 8 }}>
                          {a?.name ?? 'Unknown'}
                          {e.auto && (
                            <span className="badge blue" style={{ height: 19, fontSize: 10.5 }}>
                              <Radio size={11} /> Auto{account ? ` · ${account.label}` : ''}
                            </span>
                          )}
                        </div>
                        <div className="e-meta">
                          {e.measure === 'time' ? (
                            <span className="row" style={{ gap: 4, display: 'inline-flex' }}>
                              <Clock size={11} /> {e.unit === 'hr' ? `${+((e.minutes ?? 0) / 60).toFixed(2)} h` : `${e.minutes} min`}
                            </span>
                          ) : (
                            <span>{section.kind === 'games' ? 'Games' : 'Amount'}</span>
                          )}
                          {(e.wins !== undefined || e.losses !== undefined) && e.measure === 'amount' && (
                            <span>
                              {' '}
                              · <span className="up">{e.wins ?? 0}W</span> <span className="down">{e.losses ?? 0}L</span>
                              {(e.wins ?? 0) + (e.losses ?? 0) < (e.amount ?? 0) && (
                                <span className="muted"> · {(e.amount ?? 0) - (e.wins ?? 0) - (e.losses ?? 0)} unknown</span>
                              )}
                            </span>
                          )}
                        </div>
                        {e.note && <div className="e-desc">{e.note}</div>}
                      </div>
                      <div className="e-value">
                        {e.measure === 'time' ? fmtMinutes(e.minutes) : fmtNum(e.amount)}
                        {e.measure === 'amount' && section.kind === 'games' && <div className="tiny muted" style={{ fontWeight: 500 }}>games</div>}
                      </div>
                      <div className="e-actions">
                        <button className="icon-btn" title="Edit" aria-label="Edit entry" onClick={() => setEditing(e)}>
                          <Pencil size={15} />
                        </button>
                        <button className="icon-btn" title="Delete" aria-label="Delete entry" onClick={() => remove(e)}>
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))
          )}

          {matchesToday.length > 0 && (
            <div className="card" style={{ marginTop: 8 }}>
              <div className="row" style={{ marginBottom: 10, gap: 8 }}>
                <Gamepad2 size={16} />
                <b>Tracked matches</b>
                <span className="muted small">from the live game connection</span>
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th>Mode</th>
                    <th>Result</th>
                    <th>Score</th>
                    <th>G / A / S / Sh</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {matchesToday.map((m) => (
                    <tr key={m.id}>
                      <td>{activityById(data, m.activityId)?.name ?? m.mode}</td>
                      <td className={m.result === 'win' ? 'up' : m.result === 'loss' ? 'down' : 'muted'}>
                        {m.result === 'win' ? (
                          <span className="row" style={{ gap: 4 }}>
                            <Trophy size={13} /> Win
                          </span>
                        ) : m.result === 'loss' ? (
                          m.leftEarly ? 'Left early' : 'Loss'
                        ) : (
                          'Unknown'
                        )}
                      </td>
                      <td>{m.teamScore !== undefined ? `${m.teamScore} – ${m.opponentScore ?? 0}${m.overtime ? ' OT' : ''}` : '—'}</td>
                      <td>{m.me ? `${m.me.goals} / ${m.me.assists} / ${m.me.saves} / ${m.me.shots}` : '—'}</td>
                      <td className="muted">{new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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

      {editing && (
        <Modal title="Edit entry" onClose={() => setEditing(null)}>
          <EntryForm season={season} day={day} editing={editing} onDone={() => setEditing(null)} />
        </Modal>
      )}
    </div>
  );
}
