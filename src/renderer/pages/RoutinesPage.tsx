// Training routines: saved lists of trainings with a time each, started on a day and ticked off.
import { useState } from 'react';
import { ArrowDown, ArrowUp, Copy, ListChecks, Pencil, Play, Plus, Trash2, X } from 'lucide-react';
import { useStore } from '../store';
import { confirmDialog, EmptyState, Field, Modal, NumberInput } from '../components/ui';
import {
  activityById,
  createRoutine,
  dayForDate,
  findOrCreateActivity,
  findSeason,
  routineMinutes,
  sectionActivities,
  sectionLabel,
  sectionById,
  sortedSections,
  startRoutineOnDay,
} from '../lib/journal';
import { fmtMinutes, uid } from '../lib/format';
import { todayISO } from '../lib/dates';
import { startRoutineItemTimer } from '../lib/routineTimer';
import type { Routine } from '../../shared/model';

const NEW = '__new__';

interface DraftItem {
  key: string;
  activityId: string;
  minutes: string;
  note: string;
  /** For a new activity typed in the editor. */
  newName?: string;
  newSectionId?: string;
}

export function RoutinesPage() {
  const data = useStore((s) => s.data);
  const mutate = useStore((s) => s.mutate);
  const navigate = useStore((s) => s.navigate);
  const toast = useStore((s) => s.toast);
  const [editing, setEditing] = useState<Routine | 'new' | null>(null);
  const today = dayForDate(data, todayISO());

  const startToday = async (r: Routine, runNow: boolean) => {
    if (!today) {
      toast({ kind: 'info', title: 'No season covers today', body: 'Add a season first (Seasons → New season).' });
      return;
    }
    let dayRoutineId = '';
    let firstId = '';
    mutate((d) => {
      const day = findSeason(d, today.season.id)?.days.find((x) => x.id === today.day.id);
      if (!day) return;
      const dr = startRoutineOnDay(day, r);
      dayRoutineId = dr.id;
      firstId = dr.items[0]?.id ?? '';
    });
    navigate({ name: 'day', seasonId: today.season.id, dayId: today.day.id });
    if (runNow && firstId) await startRoutineItemTimer({ seasonId: today.season.id, dayId: today.day.id, dayRoutineId, itemId: firstId });
  };

  const remove = async (r: Routine) => {
    const ok = await confirmDialog({
      title: `Delete “${r.name}”?`,
      body: 'Days you already ran it on keep their checklist and logged time.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (ok) mutate((d) => void (d.routines = d.routines.filter((x) => x.id !== r.id)));
  };

  const duplicate = (r: Routine) =>
    mutate((d) => {
      createRoutine(d, `${r.name} (copy)`, r.items.map(({ activityId, minutes, note }) => ({ activityId, minutes, note })));
    });

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Routines</h1>
          <div className="subtitle">Save the trainings you do and for how long. Start a routine on any day and just work through the list.</div>
        </div>
        <div className="actions">
          <button className="btn primary" onClick={() => setEditing('new')}>
            <Plus size={16} /> New routine
          </button>
        </div>
      </div>

      {data.routines.length === 0 ? (
        <EmptyState
          icon={<ListChecks size={30} />}
          title="No routines yet"
          body="For example a warm-up: Freeplay 10 min, Aerials 15 min, Kickoffs 5 min. Each item can run its own timer, one after another."
          action={
            <button className="btn primary" onClick={() => setEditing('new')}>
              <Plus size={15} /> Create a routine
            </button>
          }
        />
      ) : (
        <div className="grid routine-grid">
          {data.routines.map((r) => (
            <div key={r.id} className="card routine-saved">
              <div className="row between" style={{ marginBottom: 8, gap: 8 }}>
                <b className="ellipsis" style={{ fontSize: 16 }}>{r.name}</b>
                <div className="row" style={{ gap: 2 }}>
                  <button className="icon-btn" title="Edit" aria-label="Edit routine" onClick={() => setEditing(r)}>
                    <Pencil size={15} />
                  </button>
                  <button className="icon-btn" title="Duplicate" aria-label="Duplicate routine" onClick={() => duplicate(r)}>
                    <Copy size={15} />
                  </button>
                  <button className="icon-btn" title="Delete" aria-label="Delete routine" onClick={() => remove(r)}>
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
              <div className="muted small" style={{ marginBottom: 10 }}>
                {r.items.length} item{r.items.length === 1 ? '' : 's'} · {fmtMinutes(routineMinutes(r.items))} total
              </div>
              <div className="routine-list">
                {r.items.map((i, n) => {
                  const a = activityById(data, i.activityId);
                  const sec = a ? sectionById(data, a.sectionId) : undefined;
                  return (
                    <div key={i.id} className="rl-row">
                      <span className="color-dot" style={{ background: sec?.color ?? 'var(--muted)' }} />
                      <span className="muted">{n + 1}.</span>
                      <span className="ellipsis" style={{ flex: 1 }}>
                        {a?.name ?? 'Deleted activity'}
                        {i.note && <span className="muted"> · {i.note}</span>}
                      </span>
                      <b>{fmtMinutes(i.minutes)}</b>
                    </div>
                  );
                })}
              </div>
              <div className="row" style={{ gap: 8, marginTop: 14 }}>
                <button className="btn small primary" disabled={!r.items.length} onClick={() => startToday(r, true)} title="Add it to today and start the first timer">
                  <Play size={14} /> Start today
                </button>
                <button className="btn small" disabled={!r.items.length} onClick={() => startToday(r, false)} title="Add it to today as a checklist">
                  Add to today
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && <RoutineEditor routine={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function RoutineEditor({ routine, onClose }: { routine?: Routine; onClose: () => void }) {
  const data = useStore((s) => s.data);
  const mutate = useStore((s) => s.mutate);
  const toast = useStore((s) => s.toast);
  // Training-type sections (not Games: games are counted, not timed).
  const sections = sortedSections(data).filter((s) => s.kind !== 'games');
  const firstActivity = sections.map((s) => sectionActivities(data, s.id)[0]).find(Boolean);
  const blank = (): DraftItem => ({ key: uid(), activityId: firstActivity?.id ?? NEW, minutes: '', note: '', newSectionId: sections[0]?.id });
  const [name, setName] = useState(routine?.name ?? '');
  const [items, setItems] = useState<DraftItem[]>(
    routine?.items.length
      ? routine.items.map((i) => ({ key: i.id, activityId: i.activityId, minutes: String(i.minutes), note: i.note ?? '', newSectionId: sections[0]?.id }))
      : [blank()],
  );

  const update = (key: string, patch: Partial<DraftItem>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  const move = (idx: number, dir: -1 | 1) =>
    setItems((list) => {
      const next = [...list];
      const [x] = next.splice(idx, 1);
      next.splice(Math.max(0, Math.min(next.length, idx + dir)), 0, x);
      return next;
    });

  const itemOk = (i: DraftItem) => Number(i.minutes) > 0 && (i.activityId !== NEW ? !!i.activityId : !!i.newName?.trim() && !!i.newSectionId);
  const filled = items.filter((i) => i.minutes !== '' || i.activityId === NEW);
  const valid = name.trim().length > 0 && filled.length > 0 && filled.every(itemOk);
  const total = items.reduce((a, i) => a + (Number(i.minutes) > 0 ? Number(i.minutes) : 0), 0);

  const save = () => {
    if (!valid) return;
    mutate((d) => {
      const list = filled.map((i) => {
        const activityId = i.activityId === NEW ? findOrCreateActivity(d, i.newSectionId!, i.newName!, 'time').id : i.activityId;
        return { activityId, minutes: Math.round(Number(i.minutes) * 100) / 100, note: i.note.trim() || undefined };
      });
      if (routine) {
        const r = d.routines.find((x) => x.id === routine.id);
        if (!r) return;
        r.name = name.trim();
        r.items = list.map((i, n) => ({ ...i, id: routine.items[n]?.id ?? uid() }));
      } else {
        createRoutine(d, name, list);
      }
    });
    toast({ kind: 'success', title: routine ? 'Routine saved' : `Routine “${name.trim()}” created`, body: `${filled.length} item${filled.length === 1 ? '' : 's'} · ${fmtMinutes(total)}` });
    onClose();
  };

  return (
    <Modal
      title={routine ? 'Edit routine' : 'New routine'}
      subtitle="Pick what you train and for how many minutes. The order is the order you'll do them in."
      onClose={onClose}
      wide
      footer={
        <>
          <span className="muted small" style={{ marginRight: 'auto' }}>
            Total: <b>{fmtMinutes(total)}</b>
          </span>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!valid} onClick={save}>
            {routine ? 'Save' : 'Create routine'}
          </button>
        </>
      }
    >
      <Field label="Name">
        <input className="input" autoFocus value={name} placeholder="e.g. Warm-up, Mechanics day, Before ranked" onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="stack" style={{ gap: 8 }}>
        {items.map((i, idx) => (
          <div key={i.key} className="routine-edit-row">
            <span className="muted small" style={{ width: 18, textAlign: 'right' }}>
              {idx + 1}.
            </span>
            <div className="stack" style={{ gap: 6, flex: 1, minWidth: 0 }}>
              <div className="row" style={{ gap: 6 }}>
                <select
                  className="input"
                  style={{ flex: 1, minWidth: 0 }}
                  value={i.activityId}
                  onChange={(e) => update(i.key, { activityId: e.target.value })}
                >
                  {sections.map((s) => {
                    const acts = sectionActivities(data, s.id);
                    if (!acts.length) return null;
                    return (
                      <optgroup key={s.id} label={sectionLabel(data, s.id)}>
                        {acts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </optgroup>
                    );
                  })}
                  <option value={NEW}>+ New activity…</option>
                </select>
                <div className="input-suffix small-suffix" style={{ width: 120 }}>
                  <NumberInput value={i.minutes} onChange={(v) => update(i.key, { minutes: v })} placeholder="0" onEnter={save} />
                  <span className="suffix">min</span>
                </div>
              </div>
              {i.activityId === NEW && (
                <div className="row" style={{ gap: 6 }}>
                  <input
                    className="input"
                    style={{ flex: 1 }}
                    placeholder="New activity, e.g. Air roll shots"
                    value={i.newName ?? ''}
                    onChange={(e) => update(i.key, { newName: e.target.value })}
                  />
                  <select className="input" style={{ width: 190 }} value={i.newSectionId} onChange={(e) => update(i.key, { newSectionId: e.target.value })}>
                    {sections.map((s) => (
                      <option key={s.id} value={s.id}>
                        in {sectionLabel(data, s.id)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <input
                className="input small-input"
                placeholder="Note (optional), e.g. focus on recoveries"
                value={i.note}
                onChange={(e) => update(i.key, { note: e.target.value })}
              />
            </div>
            <div className="stack" style={{ gap: 2 }}>
              <button className="icon-btn" title="Move up" aria-label="Move up" disabled={idx === 0} onClick={() => move(idx, -1)}>
                <ArrowUp size={14} />
              </button>
              <button className="icon-btn" title="Move down" aria-label="Move down" disabled={idx === items.length - 1} onClick={() => move(idx, 1)}>
                <ArrowDown size={14} />
              </button>
              <button
                className="icon-btn"
                title="Remove"
                aria-label="Remove item"
                disabled={items.length === 1}
                onClick={() => setItems((list) => list.filter((x) => x.key !== i.key))}
              >
                <X size={14} />
              </button>
            </div>
          </div>
        ))}
        <button className="btn ghost small" style={{ alignSelf: 'flex-start' }} onClick={() => setItems((l) => [...l, blank()])}>
          <Plus size={14} /> Add item
        </button>
      </div>
    </Modal>
  );
}
