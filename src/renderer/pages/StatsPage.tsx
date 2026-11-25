import { useMemo, useState } from 'react';
import { BarChart3, Search, Star } from 'lucide-react';
import { useStore } from '../store';
import { allStats, buildContext, CATEGORIES, seasonSummaries, timeline, type Scope, type StatCategory, type StatDef } from '../lib/stats';
import { gamesSection, seasonLabel } from '../lib/journal';
import { fmtMinutes, fmtNum, fmtPct } from '../lib/format';
import { StatCard, useFavorites } from '../components/StatCard';
import { BarChart, SERIES, type BarSeries } from '../components/BarChart';
import type { TimelineBucket } from '../lib/stats';

export function StatsPage({ initialSeasonId }: { initialSeasonId?: string }) {
  const data = useStore((s) => s.data);
  const navigate = useStore((s) => s.navigate);
  const { favorites, toggle, move } = useFavorites();
  const [scopeId, setScopeId] = useState<string>(initialSeasonId ?? 'all');
  const [category, setCategory] = useState<StatCategory | 'All'>('All');
  const [query, setQuery] = useState('');

  const scope: Scope = scopeId === 'all' || !data.seasons.some((s) => s.id === scopeId) ? { kind: 'all' } : { kind: 'season', seasonId: scopeId };
  const ctx = useMemo(() => buildContext(data, scope), [data, scopeId]);
  const defs = useMemo(() => allStats(data), [data]);
  const values = useMemo(() => new Map(defs.map((d) => [d.id, d.compute(ctx)])), [defs, ctx]);

  const favDefs = favorites.map((id) => defs.find((d) => d.id === id)).filter((d): d is StatDef => !!d);

  const q = query.trim().toLowerCase();
  const visible = defs.filter((d) => {
    if (category !== 'All' && d.category !== category) return false;
    if (q && !`${d.label} ${d.group ?? ''} ${d.category}`.toLowerCase().includes(q)) return false;
    const v = values.get(d.id);
    // Hide stats that don't apply to this scope, and empty per-activity stats unless searched.
    if (v === null) return false;
    if (d.category === 'Activities' && v?.empty && !q) return false;
    return true;
  });

  const byCategory = CATEGORIES.map((c) => ({ c, list: visible.filter((d) => d.category === c) })).filter((x) => x.list.length);

  const { buckets, unit } = useMemo(() => timeline(ctx), [ctx]);
  const gameActs = data.activities.filter((a) => a.sectionId === gamesSection(data).id);
  const usedGameActs = gameActs.filter((a) => buckets.some((b) => b.gamesByActivity[a.id]));
  const gameSeries: BarSeries<TimelineBucket>[] = usedGameActs.slice(0, 7).map((a) => ({
    key: a.id,
    label: a.name,
    // Color follows the entity's position in the Games section, never its rank.
    color: SERIES[Math.min(gameActs.indexOf(a), 6) + 1] ?? SERIES[7],
    get: (b) => b.gamesByActivity[a.id] ?? 0,
  }));
  if (usedGameActs.length > 7) {
    const rest = new Set(usedGameActs.slice(7).map((a) => a.id));
    gameSeries.push({
      key: 'other',
      label: 'Other',
      color: '#5d6884',
      get: (b) => Object.entries(b.gamesByActivity).reduce((acc, [k, v]) => acc + (rest.has(k) ? v : 0), 0),
    });
  }
  const trainingSeries: BarSeries<TimelineBucket>[] = [{ key: 'training', label: 'Training', color: SERIES[0], get: (b) => b.training }];
  const summaries = useMemo(() => (scope.kind === 'all' ? seasonSummaries(data) : []), [data, scope.kind]);

  const seasons = [...data.seasons].sort((a, b) => b.number - a.number);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Statistics</h1>
          <div className="subtitle">
            <BarChart3 size={15} /> {ctx.elapsedDates.length} days · {ctx.entries.length} activities logged
          </div>
        </div>
        <div className="actions">
          <select className="input" style={{ width: 230 }} value={scope.kind === 'all' ? 'all' : scopeId} onChange={(e) => setScopeId(e.target.value)} aria-label="Statistics scope">
            <option value="all">All time</option>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>
                {seasonLabel(s)}
                {s.status === 'closed' ? ' (completed)' : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="section-title">
        <h2>
          <Star size={14} /> Key stats
        </h2>
        <span className="muted small">Shown on your home screen · hover a card to reorder</span>
      </div>
      {favDefs.length ? (
        <div className="grid auto">
          {favDefs.map((d) => (
            <StatCard key={d.id} def={d} value={values.get(d.id) ?? null} favorite onToggle={() => toggle(d.id)} onMove={(dir) => move(d.id, dir)} showGroup />
          ))}
        </div>
      ) : (
        <div className="card muted small">Click the ☆ on any stat below to pin it here and on your home screen.</div>
      )}

      <div className="section-title">
        <h2>Charts</h2>
      </div>
      <div className="grid cols-2">
        <div className="card chart-card">
          <h3>Training time per {unit}</h3>
          <div className="muted small">All activities in the Training section</div>
          <BarChart
            data={buckets}
            series={trainingSeries}
            format={(v) => fmtMinutes(v)}
            tickUnit={(max) => (max >= 120 ? 60 : max >= 30 ? 15 : 1)}
            tickFormat={(v) => (v === 0 ? '0' : fmtMinutes(v))}
            emptyText="No training logged yet"
          />
        </div>
        <div className="card chart-card">
          <h3>Games per {unit} by mode</h3>
          <div className="muted small">All modes stacked</div>
          <BarChart
            data={buckets}
            series={gameSeries.length ? gameSeries : [{ key: 'none', label: 'Games', color: SERIES[1], get: () => 0 }]}
            format={(v) => fmtNum(v)}
            emptyText="No games logged yet"
          />
        </div>
      </div>

      {scope.kind === 'all' && summaries.length > 0 && (
        <>
          <div className="section-title">
            <h2>Season comparison</h2>
          </div>
          <div className="card" style={{ padding: '6px 10px' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Season</th>
                  <th>Status</th>
                  <th>Active days</th>
                  <th>Training</th>
                  <th>Daily avg training</th>
                  <th>Games</th>
                  <th>Win rate</th>
                </tr>
              </thead>
              <tbody>
                {summaries.map((s) => (
                  <tr key={s.season.id} className="clickable" onClick={() => setScopeId(s.season.id)}>
                    <td>
                      <b>{seasonLabel(s.season)}</b>
                    </td>
                    <td>{s.season.status === 'active' ? <span className="badge active">Active</span> : <span className="badge done">Completed</span>}</td>
                    <td>
                      {s.activeDays} / {s.season.days.length}
                    </td>
                    <td>{fmtMinutes(s.training)}</td>
                    <td>{fmtMinutes(s.dailyTraining)}</td>
                    <td>{fmtNum(s.games)}</td>
                    <td>{fmtPct(s.winRate, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="section-title" style={{ flexWrap: 'wrap' }}>
        <h2>All statistics</h2>
        <div className="row" style={{ position: 'relative' }}>
          <Search size={15} style={{ position: 'absolute', left: 11, color: 'var(--muted)' }} />
          <input className="input" style={{ width: 240, paddingLeft: 32, height: 34 }} placeholder="Search stats…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>
      <div className="cat-tabs" style={{ marginBottom: 6 }}>
        {(['All', ...CATEGORIES] as const).map((c) => (
          <button key={c} className={`chip ${category === c ? 'on' : ''}`} onClick={() => setCategory(c)}>
            {c}
          </button>
        ))}
      </div>

      {byCategory.length === 0 && <div className="card muted small" style={{ marginTop: 12 }}>No stats match.</div>}
      {byCategory.map(({ c, list }) => {
        if (c === 'Activities') {
          const groups = new Map<string, StatDef[]>();
          for (const d of list) groups.set(d.group ?? '', [...(groups.get(d.group ?? '') ?? []), d]);
          return (
            <div key={c}>
              <div className="group-title" style={{ marginTop: 24, fontSize: 15, color: 'var(--text)' }}>
                {c}
              </div>
              {[...groups].map(([g, ds]) => (
                <div key={g}>
                  <div className="group-title">{g}</div>
                  <div className="grid auto">
                    {ds.map((d) => (
                      <StatCard key={d.id} def={d} value={values.get(d.id) ?? null} favorite={favorites.includes(d.id)} onToggle={() => toggle(d.id)} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          );
        }
        return (
          <div key={c}>
            <div className="group-title" style={{ marginTop: 24, fontSize: 15, color: 'var(--text)' }}>
              {c}
            </div>
            <div className="grid auto">
              {list.map((d) => (
                <StatCard key={d.id} def={d} value={values.get(d.id) ?? null} favorite={favorites.includes(d.id)} onToggle={() => toggle(d.id)} />
              ))}
            </div>
          </div>
        );
      })}

      {data.seasons.length === 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <b>No seasons yet.</b> <span className="muted">Statistics appear once you log activities.</span>{' '}
          <button className="btn small primary" style={{ marginLeft: 8 }} onClick={() => navigate({ name: 'home' })}>
            Add a season
          </button>
        </div>
      )}
    </div>
  );
}
