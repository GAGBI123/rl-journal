import { useState } from 'react';
import { useStore } from '../store';
import { Field, Modal, NumberInput, Toggle } from './ui';
import { createSeason, DEFAULT_SEASON_DAYS, findSeason, seasonLabel, closeSeason } from '../lib/journal';
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
