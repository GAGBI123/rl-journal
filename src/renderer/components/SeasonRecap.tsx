import { useMemo, type ReactNode } from 'react';
import { CalendarCheck, Crosshair, Dumbbell, Flame, Gamepad2, Medal, Swords, Trophy, Users } from 'lucide-react';
import { useStore } from '../store';
import { formatDate } from '../lib/dates';
import { fmtMinutes, fmtNum, fmtPct, plural } from '../lib/format';
import { inRecord } from '../lib/journal';
import { rankedBySize, seasonRecap, winRate, type ModeTotal } from '../lib/recap';
import { HONOR_DUEL_KEY } from '../../shared/playlists';
import type { Season } from '../../shared/model';

const short = (iso: string) => formatDate(iso, { month: 'short', day: 'numeric', year: 'numeric' });

function WL({ t }: { t: { wins: number; losses: number } }) {
  if (!t.wins && !t.losses) return null;
  return (
    <span className="recap-wl">
      <span className="up">{t.wins}W</span> <span className="down">{t.losses}L</span> <span className="muted">· {fmtPct(winRate(t))}</span>
    </span>
  );
}

/** A row with a bar: label, bar (share of the biggest), value. */
function BarRow(props: { label: string; value: number; max: number; color: string; text: string; extra?: ReactNode; title?: string }) {
  return (
    <div className={`recap-row ${props.extra === undefined ? 'plain' : ''}`} title={props.title}>
      <span className="r-label">{props.label}</span>
      <div className="r-track">
        <div className="r-fill" style={{ width: `${props.max ? Math.max(2, (props.value / props.max) * 100) : 0}%`, background: props.color }} />
      </div>
      <span className="r-val">{props.text}</span>
      {props.extra !== undefined && <span className="r-extra">{props.extra}</span>}
    </div>
  );
}

/** End-of-season numbers, shown at the top of a completed season. */
export function SeasonRecap({ season }: { season: Season }) {
  const data = useStore((s) => s.data);
  const navigate = useStore((s) => s.navigate);
  const r = useMemo(() => seasonRecap(data, season), [data, season]);
  const ranked = rankedBySize(r);
  const otherRanked = r.modes.filter((m) => m.key?.startsWith('ranked-') && !['ranked-1s', 'ranked-2s', 'ranked-3s'].includes(m.key));
  const others = r.modes.filter((m) => !m.key?.startsWith('ranked-'));
  const rankedMax = Math.max(1, ...ranked.map((x) => x.mode.games), ...otherRanked.map((m) => m.games));
  const otherMax = Math.max(1, ...others.map((m) => m.games));
  const top = r.topTraining.slice(0, 6);
  const topMax = Math.max(1, ...top.map((t) => t.minutes));
  const t = r.tracked;
  const per = (n: number) => fmtNum(n / Math.max(1, t.games), 2);
  const openDay = (dayId: string) => navigate({ name: 'day', seasonId: season.id, dayId });
  const counts = (m: ModeTotal) => m.key === HONOR_DUEL_KEY || inRecord(data, m.activityId);

  return (
    <section className="recap">
      <div className="recap-head">
        <div className="recap-icon">
          <Trophy size={20} />
        </div>
        <div>
          <h2>Season recap</h2>
          <div className="muted small">
            {short(r.start)} – {short(r.end)} · {plural(r.days, 'day')}
          </div>
        </div>
      </div>

      <div className="recap-hero">
        <div className="card kv">
          <div className="k">
            <Dumbbell size={13} /> Training
          </div>
          <div className="v">{fmtMinutes(r.training)}</div>
          <div className="muted small">{fmtMinutes(r.training / Math.max(1, r.days))} a day on average</div>
        </div>
        <div className="card kv">
          <div className="k">
            <Gamepad2 size={13} /> Games
          </div>
          <div className="v">{fmtNum(r.games)}</div>
          <div className="small">
            {r.record.wins + r.record.losses ? <WL t={r.record} /> : <span className="muted">No results recorded</span>}
          </div>
        </div>
        <div className="card kv">
          <div className="k">
            <Medal size={13} /> Ranked games
          </div>
          <div className="v">{fmtNum(r.ranked.games)}</div>
          <div className="small">{r.ranked.wins + r.ranked.losses ? <WL t={r.ranked} /> : <span className="muted">{plural(r.casual.games, 'casual game')}</span>}</div>
        </div>
        <div className="card kv">
          <div className="k">
            <CalendarCheck size={13} /> Active days
          </div>
          <div className="v">
            {r.activeDays}
            <span className="muted" style={{ fontSize: 14, fontWeight: 500 }}> / {r.days}</span>
          </div>
          <div className="muted small">
            <Flame size={12} style={{ verticalAlign: -2 }} /> Longest streak {plural(r.longestStreak, 'day')}
          </div>
        </div>
      </div>

      <div className="recap-grid">
        <div className="card recap-card">
          <h3>
            <Medal size={15} /> Ranked
          </h3>
          {ranked.map(({ size, mode }) => (
            <BarRow key={size} label={size} value={mode.games} max={rankedMax} color="var(--series-1)" text={fmtNum(mode.games)} extra={<WL t={mode} />} />
          ))}
          {otherRanked.map((m) => (
            <BarRow key={m.activityId} label={m.name.replace(/^Ranked /, '')} title={m.name} value={m.games} max={rankedMax} color="var(--series-4)" text={fmtNum(m.games)} extra={<WL t={m} />} />
          ))}
          {r.ranked.games === 0 && <div className="muted small">No ranked games this season.</div>}
        </div>

        <div className="card recap-card">
          <h3>
            <Swords size={15} /> Casual, duels & more
          </h3>
          {others.map((m) => (
            <BarRow
              key={m.activityId}
              label={m.name}
              value={m.games}
              max={otherMax}
              color={m.key === HONOR_DUEL_KEY ? 'var(--series-3)' : 'var(--series-2)'}
              text={fmtNum(m.games)}
              extra={counts(m) ? <WL t={m} /> : <span className="muted small">not in record</span>}
            />
          ))}
          {!others.length && <div className="muted small">Only ranked this season.</div>}
        </div>

        <div className="card recap-card">
          <h3>
            <Dumbbell size={15} /> Most trained
          </h3>
          {top.map((x, i) => (
            <BarRow key={x.name} label={x.name} value={x.minutes} max={topMax} color={`var(--series-${(i % 5) + 1})`} text={fmtMinutes(x.minutes)} />
          ))}
          {!top.length && <div className="muted small">No training logged.</div>}
          {r.amounts.length > 0 && (
            <div className="recap-amounts muted small">
              {r.amounts.slice(0, 4).map((a) => (
                <span key={a.name}>
                  {a.name}: <b>{fmtNum(a.amount, 2)}</b>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="card recap-card">
          <h3>
            <Trophy size={15} /> Records
          </h3>
          <div className="recap-facts">
            {r.bestTrainingDay && (
              <button className="fact" onClick={() => openDay(r.bestTrainingDay!.day.id)} title="Open that day">
                <span>Best training day</span>
                <b>{fmtMinutes(r.bestTrainingDay.value)}</b>
                <small>Day {r.bestTrainingDay.number} · {formatDate(r.bestTrainingDay.day.date)}</small>
              </button>
            )}
            {r.mostGamesDay && (
              <button className="fact" onClick={() => openDay(r.mostGamesDay!.day.id)} title="Open that day">
                <span>Most games in a day</span>
                <b>{fmtNum(r.mostGamesDay.value)}</b>
                <small>Day {r.mostGamesDay.number} · {formatDate(r.mostGamesDay.day.date)}</small>
              </button>
            )}
            <div className="fact">
              <span>Days trained</span>
              <b>{r.trainingDays}</b>
              <small>{fmtMinutes(r.training / Math.max(1, r.trainingDays))} on those days</small>
            </div>
            <div className="fact">
              <span>Days with games</span>
              <b>{r.gameDays}</b>
              <small>{fmtNum(r.games / Math.max(1, r.gameDays), 1)} games on those days</small>
            </div>
          </div>
        </div>

        {t.games > 0 && (
          <div className="card recap-card">
            <h3>
              <Crosshair size={15} /> Tracked matches · {fmtNum(t.games)}
            </h3>
            <div className="recap-facts">
              <div className="fact">
                <span>Goals / game</span>
                <b>{per(t.goals)}</b>
                <small>{fmtNum(t.goals)} goals</small>
              </div>
              <div className="fact">
                <span>Assists / game</span>
                <b>{per(t.assists)}</b>
                <small>{fmtNum(t.assists)} assists</small>
              </div>
              <div className="fact">
                <span>Saves / game</span>
                <b>{per(t.saves)}</b>
                <small>{fmtNum(t.saves)} saves</small>
              </div>
              <div className="fact">
                <span>Shooting</span>
                <b>{t.shots ? fmtPct(t.goals / t.shots, 1) : '—'}</b>
                <small>{fmtNum(t.shots)} shots</small>
              </div>
              {t.best && (
                <div className="fact wide">
                  <span>Best match</span>
                  <b>{fmtNum(t.best.score)} points</b>
                  <small>
                    {t.best.mode} · {formatDate(t.best.date)} · {t.best.goals}G {t.best.assists}A {t.best.saves}S
                  </small>
                </div>
              )}
              {t.overtime > 0 && (
                <div className="fact">
                  <span>Overtime</span>
                  <b>{t.overtime}</b>
                  <small>{t.overtimeWins} won</small>
                </div>
              )}
            </div>
          </div>
        )}

        {r.accounts.length > 1 && (
          <div className="card recap-card">
            <h3>
              <Users size={15} /> Accounts
            </h3>
            {r.accounts.map((a) => (
              <BarRow key={a.label} label={a.label} value={a.games} max={Math.max(...r.accounts.map((x) => x.games))} color={a.color} text={fmtNum(a.games)} extra={<WL t={a} />} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
