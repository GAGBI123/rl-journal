import { useMemo, useState } from 'react';
import { BarChart3, CalendarDays, CheckCircle2, ChevronDown, ChevronUp, Dumbbell, Gamepad2, Plus, Star } from 'lucide-react';
import { useStore } from '../store';
import { daySummary, buildContext, statById, type Scope } from '../lib/stats';
import { currentDate, dayNumber, seasonEndDate } from '../lib/journal';
import { formatDate } from '../lib/dates';
import { fmtMinutes, fmtNum } from '../lib/format';
import { NewSeasonModal } from '../components/SeasonModals';
import { StatCard, useFavorites } from '../components/StatCard';
import { Segmented } from '../components/ui';
import type { AppData, Season } from '../../shared/model';

function seasonTotals(data: AppData, season: Season) {
  let training = 0;
  let games = 0;
  let active = 0;
  for (const d of season.days) {
    const s = daySummary(data, d);
    training += s.training;
    games += s.games;
    if (s.count) active++;
  }
  return { training, games, active };
}

function SeasonCard({ season }: { season: Season }) {
  const data = useStore((s) => s.data);
  const navigate = useStore((s) => s.navigate);
  const today = currentDate(data.settings);
  const totals = useMemo(() => seasonTotals(data, season), [data, season]);
  const todayDay = season.days.find((d) => d.date === today);
  const todaySum = todayDay ? daySummary(data, todayDay) : null;
  const elapsed = season.days.filter((d) => d.date <= today).length;
  const pct = season.status === 'closed' ? 100 : Math.min(100, (elapsed / Math.max(1, season.days.length)) * 100);
  const end = seasonEndDate(season);
  const active = season.status === 'active';
  return (
    <div
      className={`card hoverable season-card ${active ? 'active-season' : 'closed'}`}
      onClick={() => navigate({ name: 'season', seasonId: season.id })}
    >
      <div className="ribbon">
        {active ? (
          <span className="badge active">
            <span className="pill-dot" /> Active
          </span>
        ) : (
          <span className="badge done">
            <CheckCircle2 size={13} /> Completed
          </span>
        )}
      </div>
      <div className="s-number">Season</div>
      <div className="s-title">
        {season.number}
        {season.name && <span className="text-2" style={{ fontSize: 16, fontWeight: 500 }}> · {season.name}</span>}
      </div>
      <div className="muted small">
        {formatDate(season.startDate, { month: 'short', day: 'numeric', year: 'numeric' })}
        {end && ` – ${formatDate(end, { month: 'short', day: 'numeric', year: 'numeric' })}`} · {season.days.length} days
      </div>
      <div style={{ marginTop: 14 }}>
        <div className="row between small" style={{ marginBottom: 6 }}>
          <span className="text-2">
            {active ? (todayDay ? `Day ${dayNumber(season, todayDay)} of ${season.days.length}` : elapsed ? `${elapsed} of ${season.days.length} days` : 'Not started') : 'Season over'}
          </span>
          <span className="muted">{Math.round(pct)}%</span>
        </div>
        <div className="progress">
          <div style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="s-meta">
        <div className="kv">
          <div className="k">Training</div>
          <div className="v">{fmtMinutes(totals.training)}</div>
        </div>
        <div className="kv">
          <div className="k">Games</div>
          <div className="v">{fmtNum(totals.games)}</div>
        </div>
        <div className="kv">
          <div className="k">Active days</div>
          <div className="v">{totals.active}</div>
        </div>
      </div>
      {active && todayDay && (
        <div className="row between" style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <div className="row small text-2" style={{ gap: 14 }}>
            <span className="row" style={{ gap: 5 }}>
              <Dumbbell size={14} /> {fmtMinutes(todaySum?.training ?? 0)} today
            </span>
            <span className="row" style={{ gap: 5 }}>
              <Gamepad2 size={14} /> {todaySum?.games ?? 0} games today
            </span>
          </div>
          <button
            className="btn primary small"
            onClick={(e) => {
              e.stopPropagation();
              navigate({ name: 'day', seasonId: season.id, dayId: todayDay.id });
            }}
          >
            <Plus size={15} /> Log today
          </button>
        </div>
      )}
    </div>
  );
}

function KeyStats() {
  const data = useStore((s) => s.data);
  const navigate = useStore((s) => s.navigate);
  const { favorites, toggle } = useFavorites();
  const activeSeason = [...data.seasons].filter((s) => s.status === 'active').sort((a, b) => (a.startDate < b.startDate ? 1 : -1))[0];
  const [scopeKind, setScopeKind] = useState<'season' | 'all'>(activeSeason ? 'season' : 'all');
  const scope: Scope = scopeKind === 'season' && activeSeason ? { kind: 'season', seasonId: activeSeason.id } : { kind: 'all' };
  const ctx = useMemo(() => buildContext(data, scope), [data, scope.kind, (scope as any).seasonId]);
  const defs = favorites.map((id) => statById(data, id)).filter(Boolean);
  if (!data.seasons.length) return null;
  return (
    <>
      <div className="section-title">
        <h2>
          <Star size={14} /> Key stats
        </h2>
        <div className="row">
          {activeSeason && (
            <Segmented
              value={scopeKind}
              onChange={setScopeKind}
              options={[
                { value: 'season', label: `Season ${activeSeason.number}` },
                { value: 'all', label: 'All time' },
              ]}
            />
          )}
          <button className="btn ghost small" onClick={() => navigate({ name: 'stats' })}>
            <BarChart3 size={15} /> All statistics
          </button>
        </div>
      </div>
      {defs.length ? (
        <div className="grid auto">
          {defs.map((def) => (
            <StatCard key={def!.id} def={def!} value={def!.compute(ctx)} favorite onToggle={() => toggle(def!.id)} showGroup />
          ))}
        </div>
      ) : (
        <div className="card muted small">
          Star stats on the Statistics page to pin them here for quick access.
        </div>
      )}
    </>
  );
}

export function HomePage() {
  const data = useStore((s) => s.data);
  const [creating, setCreating] = useState(false);
  const active = data.seasons.filter((s) => s.status === 'active').sort((a, b) => b.number - a.number);
  const closed = data.seasons.filter((s) => s.status === 'closed').sort((a, b) => b.number - a.number || (a.startDate < b.startDate ? 1 : -1));
  // Two rows of cards next to the current season; the rest one click away.
  const [showAll, setShowAll] = useState(false);
  const firstRows = Math.max(2, 6 - active.length);
  const shownClosed = showAll || closed.length <= firstRows + 1 ? closed : closed.slice(0, firstRows);

  if (!data.seasons.length) {
    return (
      <div className="page">
        <div className="hero-empty">
          <div className="hero-ball" />
          <h2>Start your first season</h2>
          <p>
            Every season gets 90 days to log your training and games. Add a season, give it a number, and start tracking your
            progress.
          </p>
          <button className="btn primary large" onClick={() => setCreating(true)}>
            <Plus size={18} /> Add a season
          </button>
        </div>
        {creating && <NewSeasonModal onClose={() => setCreating(false)} />}
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Your seasons</h1>
          <div className="subtitle">
            <CalendarDays size={15} />
            {active.length} active · {closed.length} completed
          </div>
        </div>
        <div className="actions">
          <button className="btn primary" onClick={() => setCreating(true)}>
            <Plus size={16} /> New season
          </button>
        </div>
      </div>

      {/* Completed seasons sit right next to the current one (newest first), not below the stats. */}
      <div className="grid auto-lg">
        {active.map((s) => (
          <SeasonCard key={s.id} season={s} />
        ))}
        {shownClosed.map((s) => (
          <SeasonCard key={s.id} season={s} />
        ))}
      </div>
      {closed.length > shownClosed.length || showAll ? (
        <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
          <button className="btn ghost small" onClick={() => setShowAll((v) => !v)}>
            {showAll ? (
              <>
                <ChevronUp size={15} /> Show fewer completed seasons
              </>
            ) : (
              <>
                <ChevronDown size={15} /> Show all {closed.length} completed seasons
              </>
            )}
          </button>
        </div>
      ) : null}

      <KeyStats />
      {creating && <NewSeasonModal onClose={() => setCreating(false)} />}
    </div>
  );
}
