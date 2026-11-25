import { ChevronLeft, ChevronRight, Star } from 'lucide-react';
import type { StatDef, StatValue } from '../lib/stats';
import { SERIES } from './BarChart';
import { useStore } from '../store';

export function useFavorites() {
  const favorites = useStore((s) => s.data.settings.favorites);
  const mutate = useStore((s) => s.mutate);
  const toggle = (id: string) =>
    mutate((d) => {
      const f = d.settings.favorites;
      d.settings.favorites = f.includes(id) ? f.filter((x) => x !== id) : [...f, id];
    });
  const move = (id: string, dir: -1 | 1) =>
    mutate((d) => {
      const f = d.settings.favorites;
      const i = f.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= f.length) return;
      [f[i], f[j]] = [f[j], f[i]];
    });
  return { favorites, toggle, move };
}

export function StatCard(props: {
  def: StatDef;
  value: StatValue | null;
  favorite: boolean;
  onToggle: () => void;
  onMove?: (dir: -1 | 1) => void;
  showGroup?: boolean;
}) {
  const { def, favorite } = props;
  const v = props.value ?? { value: '—', sub: 'Not available for this view', empty: true };
  const max = v.breakdown ? Math.max(...v.breakdown.map((b) => b.raw), 0) : 0;
  const wide = !!v.breakdown && v.breakdown.length > 0;
  return (
    <div className={`stat-card ${favorite ? 'fav' : ''} ${v.empty ? 'empty' : ''} ${wide ? 'wide' : ''}`} title={def.hint}>
      <div className="s-tools">
        {props.onMove && (
          <>
            <button className="icon-btn move" onClick={() => props.onMove!(-1)} aria-label="Move left" title="Move left">
              <ChevronLeft size={15} />
            </button>
            <button className="icon-btn move" onClick={() => props.onMove!(1)} aria-label="Move right" title="Move right">
              <ChevronRight size={15} />
            </button>
          </>
        )}
        <button
          className={`icon-btn ${favorite ? 'active' : ''}`}
          onClick={props.onToggle}
          aria-label={favorite ? 'Remove from key stats' : 'Add to key stats'}
          title={favorite ? 'Remove from key stats' : 'Pin to key stats'}
        >
          <Star size={16} fill={favorite ? 'currentColor' : 'none'} />
        </button>
      </div>
      <div className="s-label">
        {props.showGroup && def.group ? <span className="muted">{def.group.split(' · ')[0]} · </span> : null}
        {def.label}
      </div>
      <div className="s-value">{v.value}</div>
      {v.sub && <div className={`s-sub ${v.trend ?? ''}`}>{v.sub}</div>}
      {wide && (
        <div className="breakdown">
          {v.breakdown!.slice(0, 8).map((b, i) => (
            <div className="b-row" key={b.label + i}>
              <span className="b-label" title={b.label}>
                {b.label}
              </span>
              <div className="b-track">
                <div
                  className="b-fill"
                  style={{ width: `${max ? (b.raw / max) * 100 : 0}%`, background: b.color ?? SERIES[0] }}
                />
              </div>
              <span className="b-val">{b.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
