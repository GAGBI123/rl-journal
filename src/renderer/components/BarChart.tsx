import { useLayoutEffect, useMemo, useRef, useState } from 'react';

export interface BarSeries<T> {
  key: string;
  label: string;
  color: string;
  get: (d: T) => number;
}

/** Validated categorical order (dark steps) — assigned by entity order, never cycled. */
export const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#0ca30c', '#9085e9', '#e66767'];

function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * exp;
}

/** Evenly spaced round ticks. `unit` lets time axes step in whole hours (unit = 60). */
function niceTicks(maxValue: number, unit = 1, count = 4): number[] {
  const scaled = maxValue / unit;
  if (scaled <= 0) return [0, unit];
  let step = niceStep(scaled / count);
  if (unit > 1 && step < 1 && scaled > 1) step = 1;
  const top = Math.ceil(scaled / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let t = 0; t <= top + 1e-9; t += step) ticks.push(+(t * unit).toFixed(6));
  return ticks;
}

/** Rect with rounded top corners only (data-end), square at the baseline. */
function topRounded(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

export function BarChart<T extends { key: string; label: string; isToday?: boolean }>(props: {
  data: T[];
  series: BarSeries<T>[];
  format: (v: number) => string;
  height?: number;
  /** Format for axis ticks (defaults to format). */
  tickFormat?: (v: number) => string;
  /** Step ticks in multiples of this (e.g. 60 for hours on a minutes axis). */
  tickUnit?: number | ((max: number) => number);
  emptyText?: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);
  const height = props.height ?? 220;

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const { data, series } = props;
  const totals = useMemo(() => data.map((d) => series.reduce((a, s) => a + Math.max(0, s.get(d)), 0)), [data, series]);
  const rawMax = Math.max(0, ...totals);
  const unit = typeof props.tickUnit === 'function' ? props.tickUnit(rawMax) : props.tickUnit && rawMax >= props.tickUnit * 2 ? props.tickUnit : 1;
  const ticks = niceTicks(rawMax, unit);
  const max = ticks[ticks.length - 1] || 1;
  const padL = 46;
  const padR = 8;
  const padT = 8;
  const padB = 26;
  const innerW = Math.max(10, width - padL - padR);
  const innerH = height - padT - padB;
  const n = Math.max(1, data.length);
  const slot = innerW / n;
  const barW = Math.max(2, Math.min(28, slot - Math.max(2, slot * 0.28)));
  const y = (v: number) => padT + innerH - (v / max) * innerH;
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(innerW / 64))));
  const tf = props.tickFormat ?? props.format;
  const hasData = totals.some((t) => t > 0);

  const hovered = hover !== null ? data[hover] : null;
  const tipLeft = hover !== null ? Math.min(Math.max(padL + slot * hover + slot / 2 - 75, 0), width - 160) : 0;

  return (
    <div className="chart-wrap" ref={wrap}>
      {series.length > 1 && (
        <div className="legend" style={{ marginBottom: 8 }}>
          {series.map((s) => (
            <span key={s.key}>
              <i style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      <svg width={width} height={height} role="img" aria-label="Bar chart" onMouseLeave={() => setHover(null)}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={width - padR} y1={y(t)} y2={y(t)} stroke={i === 0 ? 'var(--axis)' : 'var(--grid)'} strokeWidth={1} />
            <text x={padL - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--muted)" className="mono">
              {tf(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = padL + slot * i + (slot - barW) / 2;
          let acc = 0;
          const segs = series
            .map((s) => ({ s, v: Math.max(0, s.get(d)) }))
            .filter((x) => x.v > 0);
          return (
            <g key={d.key}>
              {hover === i && <rect x={padL + slot * i} y={padT} width={slot} height={innerH} fill="rgba(255,255,255,0.035)" />}
              {segs.map(({ s, v }, si) => {
                const y0 = y(acc);
                acc += v;
                const y1 = y(acc);
                const isTop = si === segs.length - 1;
                // 2px surface gap between stacked segments
                const h = Math.max(0, y0 - y1 - (si > 0 ? 2 : 0));
                const top = y1;
                return isTop ? (
                  <path key={s.key} d={topRounded(x, top, barW, h, 4)} fill={s.color} />
                ) : (
                  <rect key={s.key} x={x} y={top} width={barW} height={h} fill={s.color} />
                );
              })}
              {d.isToday && (
                <circle cx={x + barW / 2} cy={padT + innerH + 6} r={2.5} fill="var(--blue)" />
              )}
              {i % labelEvery === 0 && (
                <text x={padL + slot * i + slot / 2} y={height - 6} textAnchor="middle" fontSize={11} fill="var(--muted)">
                  {d.label}
                </text>
              )}
              <rect
                x={padL + slot * i}
                y={padT}
                width={slot}
                height={innerH + padB}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
              />
            </g>
          );
        })}
        {!hasData && (
          <text x={padL + innerW / 2} y={padT + innerH / 2} textAnchor="middle" fill="var(--muted)" fontSize={13}>
            {props.emptyText ?? 'No data yet'}
          </text>
        )}
      </svg>
      {hovered && (
        <div className="chart-tooltip" style={{ left: tipLeft, top: 34 }}>
          <div className="tt-title">{hovered.label}</div>
          {series.map((s) => (
            <div className="tt-row" key={s.key}>
              {series.length > 1 && <i style={{ background: s.color }} />}
              {s.label}
              <b>{props.format(s.get(hovered))}</b>
            </div>
          ))}
          {series.length > 1 && (
            <div className="tt-row" style={{ borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 4 }}>
              Total<b>{props.format(totals[hover!])}</b>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
