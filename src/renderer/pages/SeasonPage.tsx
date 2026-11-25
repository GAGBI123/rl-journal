import { useMemo, useState } from 'react';
import { BarChart3, Check, CheckCircle2, Dumbbell, Eraser, Flag, Gamepad2, ListChecks, Lock, LockOpen, Pencil, Plus, Trash2, X, Swords } from 'lucide-react';
import { useStore } from '../store';
import { addOneDay, clearDay, currentDate, dayNumber, findSeason, removeLastDay, seasonEndDate, seasonLabel } from '../lib/journal';
import { daySummary } from '../lib/stats';
import { addDays, formatDate } from '../lib/dates';
import { fmtMinutes, fmtNum } from '../lib/format';
import { CloseSeasonModal, EditSeasonModal } from '../components/SeasonModals';
import { confirmDialog, EmptyState } from '../components/ui';
import type { Day } from '../../shared/model';

export function SeasonPage({ seasonId }: { seasonId: string }) {
  const data = useStore((s) => s.data);
  const mutate = useStore((s) => s.mutate);
  const navigate = useStore((s) => s.navigate);
  const toast = useStore((s) => s.toast);
  const season = findSeason(data, seasonId);
  const [modal, setModal] = useState<'close' | 'edit' | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const today = currentDate(data.settings);

  // Calendar rows of 7 days, plus a "+" tile right after the last day.
  const weeks = useMemo(() => {
    if (!season) return [];
    const map = new Map<number, (Day | 'add' | null)[]>();
    const place = (n: number, v: Day | 'add') => {
      const w = Math.floor((n - 1) / 7);
      if (!map.has(w)) map.set(w, new Array(7).fill(null));
      map.get(w)![(((n - 1) % 7) + 7) % 7] = v;
    };
    for (const d of season.days) place(dayNumber(season, d), d);
    const last = season.days[season.days.length - 1];
    place(last ? dayNumber(season, last) + 1 : 1, 'add');
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [season]);

  const totals = useMemo(() => {
    let training = 0;
    let games = 0;
    let active = 0;
    if (season)
      for (const d of season.days) {
        const s = daySummary(data, d);
        training += s.training;
        games += s.games;
        if (s.count) active++;
      }
    return { training, games, active };
  }, [data, season]);

  if (!season) {
    return (
      <div className="page">
        <EmptyState title="Season not found" action={<button className="btn" onClick={() => navigate({ name: 'home' })}>Back to seasons</button>} />
      </div>
    );
  }

  const todayDay = season.days.find((d) => d.date === today);
  const end = seasonEndDate(season);
  const elapsed = season.days.filter((d) => d.date <= today).length;

  const lastDay = season.days[season.days.length - 1];

  /** Clear days: their logged activities, notes and matches are removed; the days stay. */
  const clearDays = async (ids: string[]) => {
    const days = season.days.filter((d) => ids.includes(d.id));
    const entries = days.reduce((n, d) => n + d.entries.length, 0);
    const one = ids.length === 1;
    const ok = await confirmDialog({
      title: one ? `Clear Day ${dayNumber(season, days[0])}?` : `Clear ${ids.length} days?`,
      body: entries
        ? `Deletes the ${entries} logged activit${entries === 1 ? 'y' : 'ies'} and notes on ${one ? 'this day' : 'these days'}. The day${one ? '' : 's'} stay in the season. This can't be undone.`
        : `Removes the notes on ${one ? 'this day' : 'these days'}.`,
      confirmLabel: 'Clear',
      danger: true,
    });
    if (!ok) return;
    mutate((d) => {
      for (const id of ids) clearDay(d, season.id, id);
    });
    setSelected(new Set());
    setSelecting(false);
    toast({ kind: 'success', title: one ? 'Day cleared' : `${ids.length} days cleared` });
  };

  /** Only the last day can be removed, so a season never has gaps. */
  const removeLast = async () => {
    if (!lastDay) return;
    const n = lastDay.entries.length;
    const ok = await confirmDialog({
      title: `Remove Day ${dayNumber(season, lastDay)}?`,
      body: n
        ? `It has ${n} logged activit${n === 1 ? 'y' : 'ies'}, which will be deleted too. This can't be undone.`
        : 'You can add it back with the + after the last day.',
      confirmLabel: 'Remove day',
      danger: n > 0,
    });
    if (!ok) return;
    mutate((d) => {
      removeLastDay(d, season.id);
    });
  };

  const addDay = () =>
    mutate((d) => {
      addOneDay(d, season.id);
    });

  const deleteSeason = async () => {
    const ok = await confirmDialog({
      title: `Delete ${seasonLabel(season)}?`,
      body: 'All days and activities in this season will be permanently deleted. This cannot be undone.',
      confirmLabel: 'Delete season',
      danger: true,
    });
    if (!ok) return;
    mutate((d) => {
      d.seasons = d.seasons.filter((s) => s.id !== season.id);
      d.matches = d.matches.filter((m) => m.seasonId !== season.id);
    });
    navigate({ name: 'home' });
  };

  const reopen = () =>
    mutate((d) => {
      const s = findSeason(d, season.id);
      if (s) {
        s.status = 'active';
        s.closedAt = undefined;
      }
    });

  const toggleSel = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="row" style={{ gap: 12 }}>
            <h1>{seasonLabel(season)}</h1>
            {season.status === 'active' ? (
              <span className="badge active">
                <span className="pill-dot" /> Active
              </span>
            ) : (
              <span className="badge done">
                <CheckCircle2 size={13} /> Completed
              </span>
            )}
          </div>
          <div className="subtitle">
            {formatDate(season.startDate, { month: 'long', day: 'numeric', year: 'numeric' })}
            {end && ` – ${formatDate(end, { month: 'long', day: 'numeric', year: 'numeric' })}`}
            <span className="muted">·</span>
            {season.days.length} days
            {season.status === 'active' && elapsed > 0 && (
              <>
                <span className="muted">·</span> {Math.max(0, season.days.length - elapsed)} left
              </>
            )}
          </div>
        </div>
        <div className="actions">
          {todayDay && (
            <button className="btn primary" onClick={() => navigate({ name: 'day', seasonId: season.id, dayId: todayDay.id })}>
              <Flag size={15} /> Today · Day {dayNumber(season, todayDay)}
            </button>
          )}
          <button className="btn" onClick={() => navigate({ name: 'stats', seasonId: season.id })}>
            <BarChart3 size={15} /> Stats
          </button>
          {season.status === 'active' ? (
            <button className="btn orange" onClick={() => setModal('close')}>
              <Lock size={15} /> Close season
            </button>
          ) : (
            <button className="btn" onClick={reopen}>
              <LockOpen size={15} /> Reopen
            </button>
          )}
          <button className="icon-btn" title="Edit season" aria-label="Edit season" onClick={() => setModal('edit')}>
            <Pencil size={16} />
          </button>
          <button className="icon-btn" title="Delete season" aria-label="Delete season" onClick={deleteSeason}>
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      <div className="summary-strip">
        <div className="card kv">
          <div className="k">Training time</div>
          <div className="v">{fmtMinutes(totals.training)}</div>
        </div>
        <div className="card kv">
          <div className="k">Games played</div>
          <div className="v">{fmtNum(totals.games)}</div>
        </div>
        <div className="card kv">
          <div className="k">Active days</div>
          <div className="v">
            {totals.active}
            <span className="muted" style={{ fontSize: 13, fontWeight: 500 }}> / {elapsed || season.days.length}</span>
          </div>
        </div>
        <div className="card kv">
          <div className="k">Daily avg training</div>
          <div className="v">{fmtMinutes(totals.training / Math.max(1, elapsed))}</div>
        </div>
      </div>

      <div className="section-title">
        <h2>Days</h2>
        <div className="row">
          {selecting ? (
            <>
              <span className="muted small">{selected.size} selected</span>
              <button className="btn danger small" disabled={!selected.size} onClick={() => clearDays([...selected])}>
                <Eraser size={14} /> Clear selected
              </button>
              <button
                className="btn ghost small"
                onClick={() => {
                  setSelecting(false);
                  setSelected(new Set());
                }}
              >
                <X size={14} /> Cancel
              </button>
            </>
          ) : (
            <button className="btn ghost small" onClick={() => setSelecting(true)} disabled={!season.days.length}>
              <ListChecks size={15} /> Select days
            </button>
          )}
        </div>
      </div>

      {season.days.length === 0 ? (
        <EmptyState
          title="No days in this season"
          body="Add a day to start logging."
          action={
            <button className="btn primary" onClick={addDay}>
              <Plus size={15} /> Add a day
            </button>
          }
        />
      ) : (
        weeks.map(([w, days]) => (
          <div className="week-row" key={w}>
            <div className="week-label">Week {w + 1}</div>
            {days.map((d, i) => {
              if (!d) return <div key={i} className="day-empty" />;
              if (d === 'add') {
                const nextDate = lastDay ? addDays(lastDay.date, 1) : season.startDate;
                return (
                  <button
                    key="add"
                    className="day-add"
                    onClick={addDay}
                    title={`Add Day ${lastDay ? dayNumber(season, lastDay) + 1 : 1} (${formatDate(nextDate, { weekday: 'short', month: 'short', day: 'numeric' })})`}
                    aria-label="Add a day"
                  >
                    <Plus size={20} />
                    <span>Add day</span>
                  </button>
                );
              }
              const isLast = d.id === lastDay?.id;
              const hasContent = d.entries.length > 0 || !!d.note?.trim();

              const sum = daySummary(data, d);
              const isToday = d.date === today;
              const future = d.date > today;
              const sel = selected.has(d.id);
              return (
                <div
                  key={d.id}
                  className={`day-card ${isToday ? 'today' : ''} ${future && !sum.count ? 'future' : ''} ${sel ? 'selected' : ''}`}
                  onClick={() => (selecting ? toggleSel(d.id) : navigate({ name: 'day', seasonId: season.id, dayId: d.id }))}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && (selecting ? toggleSel(d.id) : navigate({ name: 'day', seasonId: season.id, dayId: d.id }))}
                >
                  <div className="d-num">
                    Day {dayNumber(season, d)} {isToday && <span className="badge blue" style={{ height: 18, fontSize: 10, marginLeft: 4 }}>Today</span>}
                  </div>
                  <div className="d-date">{formatDate(d.date, { weekday: 'short', month: 'short', day: 'numeric' })}</div>
                  {selecting ? (
                    <div className="d-check">{sel && <Check size={12} />}</div>
                  ) : (
                    <div className="d-tools">
                      {hasContent && (
                        <button
                          className="icon-btn"
                          title="Clear this day"
                          aria-label={`Clear Day ${dayNumber(season, d)}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            clearDays([d.id]);
                          }}
                        >
                          <Eraser size={13} />
                        </button>
                      )}
                      {isLast && (
                        <button
                          className="icon-btn"
                          title="Remove this day (only the last day can be removed)"
                          aria-label={`Remove Day ${dayNumber(season, d)}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            removeLast();
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  )}
                  <div className="d-stats">
                    {sum.training > 0 && (
                      <span>
                        <Dumbbell size={12} color="var(--series-1)" /> {fmtMinutes(sum.training)}
                      </span>
                    )}
                    {sum.normalGames > 0 && (
                      <span>
                        <Gamepad2 size={12} color="var(--series-2)" /> {sum.normalGames} game{sum.normalGames === 1 ? '' : 's'}
                      </span>
                    )}
                    {sum.honorDuels > 0 && (
                      <span>
                        <Swords size={12} color="var(--series-3)" /> {sum.honorDuels} duel{sum.honorDuels === 1 ? '' : 's'}
                      </span>
                    )}
                    {sum.other > 0 && <span className="muted">+{sum.other} more</span>}
                  </div>
                </div>
              );
            })}
          </div>
        ))
      )}

      {modal === 'close' && <CloseSeasonModal season={season} onClose={() => setModal(null)} />}
      {modal === 'edit' && <EditSeasonModal season={season} onClose={() => setModal(null)} />}
    </div>
  );
}
