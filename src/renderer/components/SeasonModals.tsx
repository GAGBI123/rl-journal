import { useEffect, useMemo, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { useStore } from '../store';
import { Field, Modal, NumberInput, Toggle } from './ui';
import { createSeason, DEFAULT_SEASON_DAYS, findSeason, seasonLabel, closeSeason } from '../lib/journal';
import { addDays, formatDate, todayISO } from '../lib/dates';
import { missingSeasons, seasonCalendar, seasonSpan, validSeasons, type SeasonSpan } from '../../shared/rlSeasons';
import type { Season } from '../../shared/model';

export function NewSeasonModal({ onClose }: { onClose: () => void }) {
  const data = useStore((s) => s.data);
  const mutate = useStore((s) => s.mutate);
  const navigate = useStore((s) => s.navigate);
  const today = todayISO();
  const calendar = useMemo(() => seasonCalendar(data.settings.rlSeasons), [data.settings.rlSeasons]);
  const have = data.seasons.map((s) => s.number);
  // Rocket League seasons the user doesn't have yet: the current one first, then older ones.
  const options = useMemo(() => missingSeasons(calendar, have, today), [calendar, have.join(','), today]);
  const first = options[0];
  const maxNumber = Math.max(0, ...have);

  const [rl, setRl] = useState<number | null>(first?.number ?? null);
  const [number, setNumber] = useState(first ? String(first.number) : maxNumber ? String(maxNumber + 1) : '');
  const [name, setName] = useState('');
  const [start, setStart] = useState(first?.start ?? today);
  const [days, setDays] = useState(String(first?.days ?? DEFAULT_SEASON_DAYS));
  const active = data.seasons.filter((s) => s.status === 'active');
  const [closeOthers, setCloseOthers] = useState(true);

  const apply = (span: SeasonSpan | null | undefined) => {
    setRl(span?.number ?? null);
    if (!span) return;
    setNumber(String(span.number));
    setStart(span.start);
    setDays(String(span.days));
  };

  // Newer season dates from GitHub (only when update checks are allowed). Saved for next time.
  useEffect(() => {
    if (!data.settings.updateChecks) return;
    let alive = true;
    window.rlj.fetchSeasons().then((list) => {
      const valid = validSeasons(list);
      if (!alive || !valid.length) return;
      if (JSON.stringify(valid) !== JSON.stringify(data.settings.rlSeasons ?? [])) {
        mutate((d) => {
          d.settings.rlSeasons = valid;
        });
      }
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const num = Number(number);
  const dayCount = Math.floor(Number(days));
  const taken = data.seasons.some((s) => s.number === num);
  const valid = number !== '' && Number.isFinite(num) && num >= 0 && !taken && start && dayCount >= 1 && dayCount <= 400;
  const end = start && dayCount >= 1 ? addDays(start, dayCount) : '';
  // A season that is already over is added as completed and doesn't close the current one.
  const past = !!end && end <= today;
  const span = rl !== null ? seasonSpan(calendar, rl) : null;

  const submit = () => {
    if (!valid) return;
    let id = '';
    mutate((d) => {
      if (closeOthers && !past) {
        for (const s of d.seasons) {
          if (s.status === 'active') {
            s.status = 'closed';
            s.closedAt = new Date().toISOString();
          }
        }
      }
      const created = createSeason(d, num, start, dayCount, name);
      if (past) {
        created.status = 'closed';
        created.closedAt = new Date().toISOString();
      }
      id = created.id;
    });
    onClose();
    navigate({ name: 'season', seasonId: id });
  };

  const fmt = (iso: string) => formatDate(iso, { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <Modal
      title="New season"
      subtitle="Dates are filled in from the Rocket League season calendar. You can add or remove days later."
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!valid} onClick={submit}>
            {past ? 'Add past season' : 'Create season'}
          </button>
        </>
      }
    >
      {options.length > 0 && (
        <Field label="Rocket League season">
          <select
            className="input"
            value={rl ?? ''}
            onChange={(e) => (e.target.value === '' ? setRl(null) : apply(seasonSpan(calendar, Number(e.target.value))))}
          >
            {options.map((o) => (
              <option key={o.number} value={o.number}>
                Season {o.number}
                {today >= o.start && today < o.end ? ' (current)' : ''} · {fmt(o.start)} – {fmt(addDays(o.end, -1))}
                {o.estimated ? ' (estimated)' : ''}
              </option>
            ))}
            <option value="">Custom dates</option>
          </select>
        </Field>
      )}
      {span && (
        <div className="callout info" style={{ padding: '8px 10px', marginBottom: 12 }}>
          <CalendarClock size={15} />
          <div className="small">
            {today >= span.start && today < span.end
              ? `Season ${span.number} is the current season: `
              : span.end <= today
                ? `Season ${span.number} (already over): `
                : `Season ${span.number}: `}
            {fmt(span.start)} to {fmt(addDays(span.end, -1))}, {span.days} days.
            {span.estimated ? ' The end date is an estimate (not announced yet); you can add or remove days later.' : ''}
          </div>
        </div>
      )}
      <div className="grid cols-2">
        <Field label="Season number" help={taken ? <span className="down">Season {num} already exists</span> : undefined}>
          <NumberInput
            value={number}
            onChange={(v) => {
              setNumber(v);
              // Typing a known season number fills in its dates.
              const n = Number(v);
              const known = v !== '' && Number.isInteger(n) ? seasonSpan(calendar, n) : null;
              if (known && known.start <= addDays(today, 120) && !data.seasons.some((s) => s.number === n)) apply(known);
              else setRl(null);
            }}
            placeholder="e.g. 21"
            big
            autoFocus
            onEnter={submit}
            invalid={taken}
          />
        </Field>
        <Field label="Number of days">
          <NumberInput
            value={days}
            onChange={(v) => {
              setDays(v);
              setRl(null);
            }}
            big
            onEnter={submit}
          />
        </Field>
      </div>
      <Field label="Start date" help={end ? `Last day: ${fmt(addDays(end, -1))}${past ? ' · already over, so it is added as completed' : ''}` : undefined}>
        <input
          className="input"
          type="date"
          value={start}
          onChange={(e) => {
            setStart(e.target.value);
            setRl(null);
          }}
        />
      </Field>
      <Field label="Name (optional)">
        <input className="input" value={name} placeholder="e.g. Road to Champ" onChange={(e) => setName(e.target.value)} />
      </Field>
      {active.length > 0 && !past && (
        <Toggle
          title={`Close ${active.map(seasonLabel).join(', ')}`}
          desc="Mark the current active season as over."
          on={closeOthers}
          onChange={setCloseOthers}
        />
      )}
    </Modal>
  );
}

export function EditSeasonModal({ season, onClose }: { season: Season; onClose: () => void }) {
  const data = useStore((s) => s.data);
  const mutate = useStore((s) => s.mutate);
  const [number, setNumber] = useState(String(season.number));
  const [name, setName] = useState(season.name ?? '');
  const num = Number(number);
  const taken = data.seasons.some((s) => s.number === num && s.id !== season.id);
  const valid = number !== '' && Number.isFinite(num) && !taken;
  const submit = () => {
    if (!valid) return;
    mutate((d) => {
      const s = findSeason(d, season.id);
      if (!s) return;
      s.number = num;
      s.name = name.trim() || undefined;
    });
    onClose();
  };
  return (
    <Modal
      title="Edit season"
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!valid} onClick={submit}>
            Save
          </button>
        </>
      }
    >
      <Field label="Season number" help={taken ? <span className="down">Season {num} already exists</span> : undefined}>
        <NumberInput value={number} onChange={setNumber} big autoFocus onEnter={submit} invalid={taken} />
      </Field>
      <Field label="Name (optional)">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
      </Field>
    </Modal>
  );
}

export function CloseSeasonModal({ season, onClose }: { season: Season; onClose: () => void }) {
  const mutate = useStore((s) => s.mutate);
  const toast = useStore((s) => s.toast);
  const today = todayISO();
  // Closing removes the days that haven't happened yet (unless something was logged on them).
  const remaining = season.days.filter((d) => d.date > today && d.entries.length === 0 && !d.note?.trim()).length;
  const submit = () => {
    let removed = 0;
    mutate((d) => {
      removed = closeSeason(d, season.id, today);
    });
    toast({
      kind: 'success',
      title: `${seasonLabel(season)} closed`,
      body: `It now shows as completed on your home screen.${removed ? ` ${removed} remaining day${removed === 1 ? ' was' : 's were'} removed.` : ''}`,
    });
    onClose();
  };
  return (
    <Modal
      title={`Close ${seasonLabel(season)}?`}
      subtitle="The season is marked as over and shown as completed. You can reopen it later."
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn orange" onClick={submit}>
            Close season
          </button>
        </>
      }
    >
      <div className="muted small">
        {remaining > 0
          ? `The ${remaining} remaining day${remaining === 1 ? '' : 's'} after today will be removed. Everything you logged stays.`
          : `All ${season.days.length} days and everything you logged stay.`}
      </div>
    </Modal>
  );
}
