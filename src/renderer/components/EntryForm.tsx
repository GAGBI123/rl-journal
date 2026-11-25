import { useEffect, useMemo, useState } from 'react';
import { Clock, Hash, Plus, Save, Sparkles, Trophy } from 'lucide-react';
import { useStore } from '../store';
import { NumberInput, Segmented } from './ui';
import { activityById, findOrCreateActivity, findSeason, newEntry, sortedSections } from '../lib/journal';
import { compareEntry } from '../lib/compare';
import { fmtMinutes, fmtNum } from '../lib/format';
import type { Day, Entry, Measure, Season, TimeUnit } from '../../shared/model';

let lastSectionId: string | null = null;

function Delta({ cur, base, measure }: { cur: number; base: number | undefined; measure: Measure }) {
  if (base === undefined) return null;
  const d = cur - base;
  const cls = d > 0 ? 'up' : d < 0 ? 'down' : 'flat';
  const txt = measure === 'time' ? fmtMinutes(Math.abs(d)) : fmtNum(Math.abs(d), 1);
  return (
    <span className={`c-delta ${cls}`}>
      {d > 0 ? '▲' : d < 0 ? '▼' : '='} {d === 0 ? 'same' : txt}
    </span>
  );
}

export function EntryForm(props: { season: Season; day: Day; editing?: Entry; onDone?: () => void }) {
  const data = useStore((s) => s.data);
  const mutate = useStore((s) => s.mutate);
  const toast = useStore((s) => s.toast);
  const { season, day, editing } = props;
  const sections = sortedSections(data);
  const editingActivity = editing ? activityById(data, editing.activityId) : undefined;

  const [sectionId, setSectionId] = useState<string>(
    editingActivity?.sectionId ?? (lastSectionId && sections.some((s) => s.id === lastSectionId) ? lastSectionId : sections[0]?.id),
  );
  const [activityId, setActivityId] = useState<string | null>(editing?.activityId ?? null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [measure, setMeasure] = useState<Measure>(editing?.measure ?? 'time');
  const [unit, setUnit] = useState<TimeUnit>(editing?.unit ?? 'min');
  const [value, setValue] = useState(() => {
    if (!editing) return '';
    if (editing.measure === 'amount') return String(editing.amount ?? '');
    const m = editing.minutes ?? 0;
    return String(editing.unit === 'hr' ? +(m / 60).toFixed(2) : m);
  });
  const [wins, setWins] = useState(editing?.wins !== undefined ? String(editing.wins) : '');
  const [note, setNote] = useState(editing?.note ?? '');

  const section = sections.find((s) => s.id === sectionId);
  const isGames = section?.kind === 'games';

  const usage = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of data.seasons) for (const d of s.days) for (const e of d.entries) map.set(e.activityId, (map.get(e.activityId) ?? 0) + 1);
    return map;
  }, [data.seasons]);

  const activities = data.activities
    .filter((a) => a.sectionId === sectionId)
    .sort((a, b) => (usage.get(b.id) ?? 0) - (usage.get(a.id) ?? 0) || a.createdAt.localeCompare(b.createdAt));

  // Pick sensible defaults when the activity changes.
  useEffect(() => {
    if (editing) return;
    const a = activityId ? activityById(data, activityId) : undefined;
    if (a) {
      setMeasure(a.defaultMeasure);
      setUnit(a.defaultUnit);
    } else if (creating) {
      setMeasure(isGames ? 'amount' : 'time');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityId, creating]);

  // Pre-select the most used activity of the section (one less click).
  useEffect(() => {
    if (!editing && !activityId && !creating && activities[0]) setActivityId(activities[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionId]);

  const pickSection = (id: string) => {
    setSectionId(id);
    setActivityId(null);
    setCreating(false);
    lastSectionId = id;
  };

  const num = Number(value);
  const base = !value || !Number.isFinite(num) ? 0 : measure === 'time' ? (unit === 'hr' ? num * 60 : num) : num;
  const winsNum = wins === '' ? undefined : Math.floor(Number(wins));
  const winsInvalid = winsNum !== undefined && measure === 'amount' && (winsNum < 0 || winsNum > num);
  const nameTaken =
    creating && newName.trim() && activities.some((a) => a.name.toLowerCase() === newName.trim().toLowerCase());
  const hasActivity = (activityId && !creating) || (creating && newName.trim().length > 0);
  const valid = !!hasActivity && base > 0 && !winsInvalid;

  const cmp = useMemo(() => {
    if (!activityId || creating) return null;
    return compareEntry(data, {
      date: day.date,
      seasonId: season.id,
      activityId,
      measure,
      pending: base,
      excludeEntryId: editing?.id,
    });
  }, [data, day.date, season.id, activityId, creating, measure, base, editing?.id]);

  const submit = () => {
    if (!valid || !section) return;
    let label = '';
    mutate((d) => {
      const s = findSeason(d, season.id);
      const target = s?.days.find((x) => x.id === day.id);
      if (!target) return;
      const activity =
        creating && newName.trim()
          ? findOrCreateActivity(d, section.id, newName, measure, unit)
          : d.activities.find((a) => a.id === activityId)!;
      activity.defaultMeasure = measure;
      if (measure === 'time') activity.defaultUnit = unit;
      label = activity.name;
      const fields: Partial<Entry> =
        measure === 'time'
          ? { measure, minutes: +base.toFixed(2), unit, amount: undefined, wins: undefined, losses: undefined }
          : {
              measure,
              amount: num,
              minutes: undefined,
              unit: undefined,
              wins: isGames ? winsNum : undefined,
              losses: editing?.auto?.source === 'game' && winsNum !== undefined ? Math.max(0, num - winsNum) : undefined,
            };
      if (editing) {
        const e = target.entries.find((x) => x.id === editing.id);
        if (e) Object.assign(e, fields, { activityId: activity.id, note: note.trim() || undefined });
      } else {
        target.entries.push(newEntry({ activityId: activity.id, ...(fields as any), note: note.trim() || undefined }));
      }
      setActivityId(activity.id);
    });
    setCreating(false);
    setNewName('');
    setValue('');
    setWins('');
    setNote('');
    toast({
      kind: 'success',
      title: editing ? 'Entry updated' : `Added ${label}`,
      body: measure === 'time' ? fmtMinutes(base) : `${fmtNum(num)}${isGames ? ' games' : ''}`,
    });
    props.onDone?.();
  };

  const fmtM = (v: number | undefined) => (v === undefined ? '—' : measure === 'time' ? fmtMinutes(v) : fmtNum(v, 1));

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="step">
        <div className="step-label">
          <span className="n">1</span> Section
        </div>
        <div className="chips">
          {sections.map((s) => (
            <button
              key={s.id}
              className={`chip ${s.id === sectionId ? 'on' : ''}`}
              style={{ ['--chip-color' as any]: s.color }}
              onClick={() => pickSection(s.id)}
            >
              <span className="swatch" />
              {s.name}
            </button>
          ))}
        </div>
      </div>

      <div className="step">
        <div className="step-label">
          <span className="n">2</span> {isGames ? 'Mode' : 'What did you do?'}
        </div>
        <div className="chips">
          {activities.map((a) => (
            <button
              key={a.id}
              className={`chip ${a.id === activityId && !creating ? 'on' : ''}`}
              style={{ ['--chip-color' as any]: section?.color }}
              onClick={() => {
                setActivityId(a.id);
                setCreating(false);
              }}
            >
              {a.name}
            </button>
          ))}
          <button
            className={`chip dashed ${creating ? 'on' : ''}`}
            style={{ ['--chip-color' as any]: section?.color }}
            onClick={() => {
              setCreating(true);
              setActivityId(null);
            }}
          >
            <Plus size={14} /> New
          </button>
        </div>
        {creating && (
          <input
            className={`input ${nameTaken ? 'invalid' : ''}`}
            autoFocus
            placeholder={isGames ? 'e.g. Hoops, Tournament…' : 'e.g. Aerial training, Workshop map…'}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        )}
        {nameTaken && <div className="tiny muted">That one already exists — it will be used.</div>}
      </div>

      <div className="step">
        <div className="step-label">
          <span className="n">3</span> Time or amount
        </div>
        <Segmented
          full
          value={measure}
          onChange={setMeasure}
          options={[
            { value: 'time', label: <><Clock size={14} /> Time</> },
            { value: 'amount', label: <><Hash size={14} /> Amount</> },
          ]}
        />
        {measure === 'time' ? (
          <div className="row" style={{ alignItems: 'stretch' }}>
            <div style={{ flex: 1 }}>
              <NumberInput value={value} onChange={setValue} placeholder="0" big onEnter={submit} />
            </div>
            <Segmented
              value={unit}
              onChange={setUnit}
              options={[
                { value: 'min', label: 'Minutes' },
                { value: 'hr', label: 'Hours' },
              ]}
            />
          </div>
        ) : (
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <NumberInput value={value} onChange={setValue} placeholder={isGames ? 'Games played' : 'Amount'} big onEnter={submit} />
            </div>
            {isGames && (
              <div style={{ width: 130 }}>
                <NumberInput value={wins} onChange={setWins} placeholder="Wins (opt.)" big onEnter={submit} invalid={winsInvalid} />
              </div>
            )}
          </div>
        )}
      </div>

      <input className="input" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />

      {cmp && (
        <div className="compare">
          <div className="c-item">
            <div className="c-k">Today{base > 0 && cmp.todayBefore > 0 ? ' (with this)' : ''}</div>
            <div className="c-v">
              {base > 0 && cmp.todayBefore > 0 ? (
                <>
                  <span className="muted" style={{ fontWeight: 500 }}>{fmtM(cmp.todayBefore)} → </span>
                  {fmtM(cmp.todayAfter)}
                </>
              ) : (
                fmtM(cmp.todayAfter)
              )}
            </div>
          </div>
          <div className="c-item">
            <div className="c-k">Yesterday</div>
            <div className="c-v">
              {fmtM(cmp.yesterday)}
              <Delta cur={cmp.todayAfter} base={cmp.yesterday} measure={measure} />
            </div>
          </div>
          <div className="c-item">
            <div className="c-k">Your average{cmp.averageDays ? ` (${cmp.averageDays} days)` : ''}</div>
            <div className="c-v">
              {fmtM(cmp.average)}
              <Delta cur={cmp.todayAfter} base={cmp.average} measure={measure} />
            </div>
          </div>
          <div className="c-item">
            <div className="c-k">Season average</div>
            <div className="c-v">
              {fmtM(cmp.seasonAverage)}
              <Delta cur={cmp.todayAfter} base={cmp.seasonAverage} measure={measure} />
            </div>
          </div>
          {cmp.best !== undefined && (
            <div className="c-item" style={{ gridColumn: 'span 2' }}>
              <div className="c-k">Best day</div>
              <div className="c-v row" style={{ gap: 8 }}>
                {fmtM(cmp.best)}
                {cmp.todayAfter > cmp.best && (
                  <span className="badge orange">
                    <Sparkles size={12} /> New personal best
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
      {creating && newName.trim() && <div className="muted small">First time logging “{newName.trim()}” — nothing to compare yet.</div>}

      <button className="btn primary large" disabled={!valid} onClick={submit}>
        {editing ? <Save size={17} /> : isGames ? <Trophy size={17} /> : <Plus size={17} />}
        {editing ? 'Save changes' : 'Add to day'}
      </button>
    </div>
  );
}
