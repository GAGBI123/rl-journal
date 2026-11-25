import { useState } from 'react';
import { useStore } from '../store';
import { Field, Modal, NumberInput, Toggle } from './ui';
import { addDaysToSeason, createSeason, DEFAULT_SEASON_DAYS, findSeason, seasonLabel } from '../lib/journal';
import { todayISO } from '../lib/dates';
import type { Season } from '../../shared/model';

export function NewSeasonModal({ onClose }: { onClose: () => void }) {
  const data = useStore((s) => s.data);
  const mutate = useStore((s) => s.mutate);
  const navigate = useStore((s) => s.navigate);
  const maxNumber = Math.max(0, ...data.seasons.map((s) => s.number));
  const [number, setNumber] = useState(maxNumber ? String(maxNumber + 1) : '');
  const [name, setName] = useState('');
  const [start, setStart] = useState(todayISO());
  const [days, setDays] = useState(String(DEFAULT_SEASON_DAYS));
  const active = data.seasons.filter((s) => s.status === 'active');
  const [closeOthers, setCloseOthers] = useState(true);

  const num = Number(number);
  const dayCount = Math.floor(Number(days));
  const taken = data.seasons.some((s) => s.number === num);
  const valid = number !== '' && Number.isFinite(num) && num >= 0 && !taken && start && dayCount >= 1 && dayCount <= 400;

  const submit = () => {
    if (!valid) return;
    let id = '';
    mutate((d) => {
      if (closeOthers) {
        for (const s of d.seasons) {
          if (s.status === 'active') {
            s.status = 'closed';
            s.closedAt = new Date().toISOString();
          }
        }
      }
      id = createSeason(d, num, start, dayCount, name).id;
    });
    onClose();
    navigate({ name: 'season', seasonId: id });
  };

  return (
    <Modal
      title="New season"
      subtitle="Each season starts with 90 days. You can add or remove days later."
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!valid} onClick={submit}>
            Create season
          </button>
        </>
      }
    >
      <div className="grid cols-2">
        <Field label="Season number" help={taken ? <span className="down">Season {num} already exists</span> : undefined}>
          <NumberInput value={number} onChange={setNumber} placeholder="e.g. 21" big autoFocus onEnter={submit} invalid={taken} />
        </Field>
        <Field label="Number of days">
          <NumberInput value={days} onChange={setDays} big onEnter={submit} />
        </Field>
      </div>
      <Field label="Start date">
        <input className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
      </Field>
      <Field label="Name (optional)">
        <input className="input" value={name} placeholder="e.g. Road to Champ" onChange={(e) => setName(e.target.value)} />
      </Field>
      {active.length > 0 && (
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

export function AddDaysModal({ season, onClose }: { season: Season; onClose: () => void }) {
  const mutate = useStore((s) => s.mutate);
  const toast = useStore((s) => s.toast);
  const [count, setCount] = useState('7');
  const n = Math.floor(Number(count));
  const valid = n >= 1 && n <= 200;
  const submit = () => {
    if (!valid) return;
    mutate((d) => {
      const s = findSeason(d, season.id);
      if (s) addDaysToSeason(s, n);
    });
    toast({ kind: 'success', title: `Added ${n} day${n === 1 ? '' : 's'} to ${seasonLabel(season)}` });
    onClose();
  };
  return (
    <Modal
      title="Add days"
      subtitle={`New days are added after the last day (currently ${season.days.length} days).`}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!valid} onClick={submit}>
            Add {valid ? n : ''} day{n === 1 ? '' : 's'}
          </button>
        </>
      }
    >
      <Field label="How many days?">
        <NumberInput value={count} onChange={setCount} big autoFocus onEnter={submit} />
      </Field>
      <div className="chips">
        {[1, 7, 14, 30].map((x) => (
          <button key={x} className={`chip ${n === x ? 'on' : ''}`} onClick={() => setCount(String(x))}>
            +{x}
          </button>
        ))}
      </div>
    </Modal>
  );
}

export function CloseSeasonModal({ season, onClose }: { season: Season; onClose: () => void }) {
  const mutate = useStore((s) => s.mutate);
  const toast = useStore((s) => s.toast);
  const today = todayISO();
  const futureEmpty = season.days.filter((d) => d.date > today && d.entries.length === 0).length;
  const [trim, setTrim] = useState(futureEmpty > 0);
  const submit = () => {
    mutate((d) => {
      const s = findSeason(d, season.id);
      if (!s) return;
      s.status = 'closed';
      s.closedAt = new Date().toISOString();
      if (trim) s.days = s.days.filter((x) => !(x.date > today && x.entries.length === 0));
    });
    toast({ kind: 'success', title: `${seasonLabel(season)} closed`, body: 'It now shows as completed on your home screen.' });
    onClose();
  };
  return (
    <Modal
      title={`Close ${seasonLabel(season)}?`}
      subtitle="The season will be marked as over and shown as completed. You can reopen it later."
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
      {futureEmpty > 0 ? (
        <Toggle
          title={`Delete the ${futureEmpty} remaining day${futureEmpty === 1 ? '' : 's'}`}
          desc="Removes empty days after today, for seasons that ended early."
          on={trim}
          onChange={setTrim}
        />
      ) : (
        <div className="muted small">All {season.days.length} days are kept.</div>
      )}
    </Modal>
  );
}
