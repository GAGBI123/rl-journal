import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Clock, Folder, FolderPlus, Hash, Layers, Plus, Save, Sparkles, Timer, Trophy, Watch } from 'lucide-react';
import { useStore } from '../store';
import { confirmDialog, NumberInput, Segmented } from './ui';
import {
  activityById,
  activityToSection,
  addToDay,
  childSections,
  createSection,
  entryNotes,
  entrySessions,
  entryTarget,
  fitSessions,
  findOrCreateActivity,
  findSeason,
  mergeInto,
  sectionActivities,
  sectionLabel,
  sectionPath,
  sortedSections,
} from '../lib/journal';
import { compareEntry } from '../lib/compare';
import { fmtMinutes, fmtNum } from '../lib/format';
import type { Day, Entry, Measure, Season } from '../../shared/model';
import { shortcutLabel } from '../lib/shortcut';
import { isCount, isEnded } from '../../shared/timer';
import { replaceTimerQuestion, timerNoun } from './TimerPill';

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
  const [value, setValue] = useState(() => {
    if (!editing) return '';
    return String((editing.measure === 'amount' ? editing.amount : +(editing.minutes ?? 0).toFixed(2)) ?? '');
  });
  const [wins, setWins] = useState(editing?.wins !== undefined ? String(editing.wins) : '');
  // An entry logged in several sessions has a note per session (edited on the day page, not here).
  // A game entry's description is its own.
  const manySessions = !!editing && !editing.auto && entrySessions(editing).length > 1;
  const [note, setNote] = useState((editing ? (editing.auto ? editing.note : entryNotes(editing)[0]) : '') ?? '');

  const section = sections.find((s) => s.id === sectionId);
  const isGames = section?.kind === 'games';
  const roots = childSections(data, undefined);
  const path = section ? sectionPath(data, section.id) : [];
  const subSections = section ? childSections(data, section.id) : [];

  // The user's order from Settings (built-in modes first, newest last by default).
  const activities = sectionActivities(data, sectionId);

  // Pick sensible defaults when the activity changes.
  useEffect(() => {
    if (editing) return;
    const a = activityId ? activityById(data, activityId) : undefined;
    if (a) {
      setMeasure(a.defaultMeasure);
    } else if (creating) {
      setMeasure(isGames ? 'amount' : 'time');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityId, creating]);

  // Pre-select the first activity of the section (one less click).
  useEffect(() => {
    if (!editing && !activityId && !creating && activities[0]) setActivityId(activities[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionId]);

  const pickSection = (id: string) => {
    setSectionId(id);
    setActivityId(null);
    setCreating(false);
    setNewSection(null);
    lastSectionId = id;
  };

  // New section inside the current one, right from the form.
  const [newSection, setNewSection] = useState<string | null>(null);
  const sameNameActivity =
    newSection !== null && newSection.trim()
      ? activities.find((a) => a.name.trim().toLowerCase() === newSection.trim().toLowerCase())
      : undefined;
  const addSection = () => {
    const name = newSection?.trim();
    if (!name || !section) return;
    const existingSub = subSections.find((s) => s.name.toLowerCase() === name.toLowerCase());
    if (existingSub) {
      pickSection(existingSub.id);
      return;
    }
    let createdId = '';
    mutate((d) => {
      const twin = d.activities.find((a) => a.sectionId === section.id && a.name.trim().toLowerCase() === name.toLowerCase());
      const created = twin ? activityToSection(d, twin.id) : createSection(d, name, section.color, section.id);
      if (created) createdId = created.id;
    });
    toast({
      kind: 'success',
      title: `Section ${sectionLabel(useStore.getState().data, createdId)} added`,
      body: sameNameActivity ? 'Your earlier time is under Overall.' : 'Add the things you do in it with “New”.',
    });
    if (createdId) pickSection(createdId);
  };

  const num = Number(value);
  const base = !value || !Number.isFinite(num) ? 0 : num;
  const winsNum = wins === '' ? undefined : Math.floor(Number(wins));
  const winsInvalid = winsNum !== undefined && measure === 'amount' && (!Number.isFinite(winsNum) || winsNum < 0 || winsNum > num);
  const nameTaken =
    creating && newName.trim() && activities.some((a) => a.name.toLowerCase() === newName.trim().toLowerCase());
  const hasActivity = (activityId && !creating) || (creating && newName.trim().length > 0);
  const valid = !!hasActivity && base > 0 && !winsInvalid;
  // Adding the same activity twice on a day goes into one entry.
  const existing = !editing && activityId && !creating ? entryTarget(day, { activityId, measure }) : undefined;

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
    let mergedTotal: number | undefined;
    mutate((d) => {
      const s = findSeason(d, season.id);
      const target = s?.days.find((x) => x.id === day.id);
      if (!target) return;
      const activity =
        creating && newName.trim()
          ? findOrCreateActivity(d, section.id, newName, measure)
          : d.activities.find((a) => a.id === activityId)!;
      activity.defaultMeasure = measure;
      label = activity.name;
      const old = editing ? target.entries.find((x) => x.id === editing.id) : undefined;
      // Wins given → the other games were losses. Unchanged values keep the recorded results.
      const keepResults = old && old.measure === 'amount' && measure === 'amount' && old.amount === num && old.wins === winsNum;
      const results =
        measure === 'amount' && isGames && winsNum !== undefined
          ? keepResults
            ? { wins: old!.wins, losses: old!.losses }
            : { wins: winsNum, losses: Math.max(0, num - winsNum) }
          : { wins: undefined, losses: undefined };
      const fields =
        measure === 'time'
          ? { measure, minutes: +base.toFixed(2), amount: undefined, wins: undefined, losses: undefined }
          : { measure, amount: num, minutes: undefined, ...results };
      const desc = note.trim() || undefined;
      if (old) {
        const switched = old.activityId !== activity.id || old.measure !== measure;
        const measureChanged = old.measure !== measure;
        const allNotes = entryNotes(old).join('\n') || undefined;
        Object.assign(old, fields, { activityId: activity.id });
        // Game entries keep their own description; so do entries from before 1.10 (one session).
        if (old.auto || !old.sessions) old.note = desc;
        if (old.sessions) {
          // The sessions follow the new total (for games: the part not from tracked matches).
          const tracked = d.matches.filter((m) => m.entryId === old.id).length;
          const hand = measure === 'time' ? +base.toFixed(2) : old.auto ? Math.max(0, num - tracked) : num;
          // Minutes and amounts don't mix: switching between them makes it one session.
          if (measureChanged) old.sessions = [];
          fitSessions(old, hand);
          const only = !old.auto && old.sessions.length === 1 ? old.sessions[0] : undefined;
          const n = manySessions ? (measureChanged ? allNotes : undefined) : desc;
          if (only && (!manySessions || measureChanged)) {
            if (n) only.note = n;
            else delete only.note;
          }
        }
        // Switched to an activity that is already logged today: combine the two.
        const twin = switched ? entryTarget(target, old, d.settings.splitAccounts, old.id) : undefined;
        if (twin) {
          mergeInto(twin, old);
          target.entries = target.entries.filter((x) => x.id !== old.id);
          for (const m of d.matches) if (m.entryId === old.id) m.entryId = twin.id;
        }
      } else {
        const res = addToDay(target, { activityId: activity.id, ...fields, note: desc }, d.settings.splitAccounts, { by: 'hand' });
        if (res.merged) mergedTotal = measure === 'time' ? res.entry.minutes : res.entry.amount;
      }
      setActivityId(activity.id);
    });
    setCreating(false);
    setNewName('');
    setValue('');
    setWins('');
    setNote('');
    const added = measure === 'time' ? fmtMinutes(base) : `${fmtNum(num)}${isGames ? ' games' : ''}`;
    toast({
      kind: 'success',
      title: editing ? 'Entry updated' : mergedTotal !== undefined ? `Added to ${label}` : `Added ${label}`,
      body:
        mergedTotal !== undefined
          ? `+${added} · now ${measure === 'time' ? fmtMinutes(mergedTotal) : `${fmtNum(mergedTotal)}${isGames ? ' games' : ''}`} today`
          : added,
    });
    props.onDone?.();
  };

  // ---- Timer: count the time down now and log it when it ends.
  const activeTimer = useStore((s) => s.timer);
  const canTime = !editing && measure === 'time';
  const startTimer = async (mode: 'down' | 'up') => {
    if (!section || measure !== 'time' || !hasActivity) return;
    if (mode === 'down' && !valid) return;
    // A finished timer waiting for done is logged first when a new one starts: nothing to ask then.
    if (activeTimer && !isEnded(activeTimer)) {
      const ok = await confirmDialog({ ...replaceTimerQuestion(activeTimer), confirmLabel: 'Start new timer' });
      if (!ok) return;
    }
    let actId = activityId ?? '';
    mutate((d) => {
      const activity =
        creating && newName.trim() ? findOrCreateActivity(d, section.id, newName, 'time') : d.activities.find((a) => a.id === activityId)!;
      activity.defaultMeasure = 'time';
      actId = activity.id;
    });
    const fresh = useStore.getState().data;
    const act = activityById(fresh, actId);
    if (!act) return;
    await window.rlj.timerStart({
      activityId: act.id,
      activityName: act.name,
      label: `${sectionLabel(fresh, act.sectionId)} · ${act.name}`,
      color: section.color,
      seasonId: season.id,
      dayId: day.id,
      date: day.date,
      durationMs: mode === 'up' ? 0 : Math.round(base * 60_000),
      note: note.trim() || undefined,
      mode,
    });
    setCreating(false);
    setNewName('');
    setActivityId(act.id);
    setValue('');
    setNote('');
    const { timerHotkey, timerFinishHotkey } = useStore.getState().data.settings;
    const keys = [timerHotkey && `${shortcutLabel(timerHotkey)} pauses`, timerFinishHotkey && `${shortcutLabel(timerFinishHotkey)} stops`].filter(Boolean).join(', ');
    toast(
      mode === 'up'
        ? { kind: 'info', title: `Stopwatch started: ${act.name}`, body: `Stop it when you’re done (■ in the top bar or on this day${keys ? `; in game: ${keys}` : ''}) and the time is added to the day.` }
        : { kind: 'info', title: `Timer started: ${fmtMinutes(base)} ${act.name}`, body: `It’s added to the day when it ends.${keys ? ` In game: ${keys}.` : ''}` },
    );
  };

  const fmtM = (v: number | undefined) => (v === undefined ? '—' : measure === 'time' ? fmtMinutes(v) : fmtNum(v, 1));

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="step">
        <div className="step-label">
          <span className="n">1</span> Section
        </div>
        <div className="chips">
          {roots.map((s) => (
            <button
              key={s.id}
              className={`chip ${path[0]?.id === s.id ? 'on' : ''}`}
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
        {path.length > 1 && (
          <div className="crumbs-inline">
            {path.map((p, i) => (
              <span key={p.id} className="row" style={{ gap: 4, display: 'inline-flex' }}>
                {i > 0 && <ChevronRight size={13} className="muted" />}
                {i < path.length - 1 ? (
                  <button className="crumb-btn" onClick={() => pickSection(p.id)}>
                    {p.name}
                  </button>
                ) : (
                  <b>{p.name}</b>
                )}
              </span>
            ))}
          </div>
        )}
        <div className="chips">
          {subSections.map((s) => (
            <button key={s.id} className="chip folder" style={{ ['--chip-color' as any]: s.color }} onClick={() => pickSection(s.id)} title={`Open ${sectionLabel(data, s.id)}`}>
              <Folder size={14} />
              {s.name}
              <ChevronRight size={13} />
            </button>
          ))}
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
          <button
            className={`chip dashed ${newSection !== null ? 'on' : ''}`}
            style={{ ['--chip-color' as any]: section?.color }}
            title={`Add a section inside ${section?.name ?? 'this section'}`}
            onClick={() => setNewSection(newSection === null ? '' : null)}
          >
            <FolderPlus size={14} /> Section
          </button>
        </div>
        {newSection !== null && (
          <div className="stack" style={{ gap: 6 }}>
            <div className="row">
              <input
                className="input"
                autoFocus
                placeholder={`New section inside ${section?.name ?? ''}, e.g. Freeplay`}
                value={newSection}
                onChange={(e) => setNewSection(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addSection();
                  if (e.key === 'Escape') setNewSection(null);
                }}
              />
              <button className="btn" disabled={!newSection.trim()} onClick={addSection}>
                Create
              </button>
            </div>
            {sameNameActivity && (
              <div className="tiny muted">
                “{sameNameActivity.name}” is already an activity here. It becomes the section, and what you logged so far moves to{' '}
                {sameNameActivity.name} › Overall.
              </div>
            )}
          </div>
        )}
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
          <div className="input-suffix">
            <NumberInput value={value} onChange={setValue} placeholder="0" big onEnter={submit} />
            <span className="suffix">minutes</span>
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

      <div className="step">
        <div className="step-label">
          <span className="n">4</span> Description <span className="muted" style={{ fontWeight: 500 }}>(optional)</span>
        </div>
        {manySessions ? (
          <div className="muted small">
            Logged in {entrySessions(editing!).length} sessions, each with its own note: open “{entrySessions(editing!).length} sessions” on the entry
            to change them. A new total is added to (or taken off) the latest session.
          </div>
        ) : (
          <textarea
            className="input desc"
            rows={2}
            placeholder={isGames ? 'How did it go? e.g. good rotations, lost to kickoffs…' : 'What did you work on? e.g. aerials, dribbles, flicks…'}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && submit()}
          />
        )}
      </div>

      {existing && (
        <div className="callout info" style={{ padding: '8px 10px' }}>
          <Layers size={15} />
          <div className="small">
            Already logged today: {existing.measure === 'time' ? fmtMinutes(existing.minutes) : `${fmtNum(existing.amount)}${isGames ? ' games' : ''}`}. This adds to it.
          </div>
        </div>
      )}

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
        {editing ? 'Save changes' : existing ? 'Add to today’s total' : 'Add to day'}
      </button>
      {canTime && (
        <div className="btn-pair even">
          <button
            className="btn"
            disabled={!valid}
            onClick={() => startTimer('down')}
            title={base > 0 ? `Count down ${fmtMinutes(base)} now. When it ends, it's added to the day by itself.` : 'Enter a time first'}
          >
            <Timer size={16} /> {base > 0 ? `Timer · ${fmtMinutes(base)}` : 'Timer'}
          </button>
          <button
            className="btn"
            disabled={!hasActivity}
            onClick={() => startTimer('up')}
            title="Count up from 0 while you train. Stop it when you're done and the time is added to the day."
          >
            <Watch size={16} /> Stopwatch
          </button>
        </div>
      )}
      {canTime && activeTimer && (
        <div className="tiny muted">
          {isEnded(activeTimer)
            ? `The ${activeTimer.activityName} timer finished. Starting a new one logs it first.`
            : isCount(activeTimer)
            ? `${activeTimer.activityName} is on the overlay. Starting a timer takes it off.`
            : `A ${timerNoun(activeTimer)} is running for ${activeTimer.activityName}. Starting a new one replaces it.`}
        </div>
      )}
    </div>
  );
}
