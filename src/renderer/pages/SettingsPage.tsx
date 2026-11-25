import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, Clock, Download, Folder, FolderInput, FolderOpen, FolderPlus, GripVertical, Hash, Plus, RefreshCw, Timer, Trash2, Upload } from 'lucide-react';
import { useStore } from '../store';
import { confirmDialog, Field, Modal, Segmented, Toggle } from '../components/ui';
import {
  activityToSection,
  childSections,
  createSection,
  deleteSectionTree,
  descendantSectionIds,
  moveActivity,
  moveSection,
  nextActivityOrder,
  normalizeData,
  SECTION_COLORS,
  sectionActivities,
  sectionLabel,
  sortedSections,
} from '../lib/journal';
import { relativeTime } from '../lib/dates';
import { uid } from '../lib/format';
import type { Measure, Section } from '../../shared/model';

const HOTKEYS = [
  { value: 'Control+Alt+P', label: 'Ctrl + Alt + P' },
  { value: 'Control+Shift+P', label: 'Ctrl + Shift + P' },
  { value: 'Alt+P', label: 'Alt + P' },
  { value: 'F8', label: 'F8' },
  { value: 'F9', label: 'F9' },
  { value: '', label: 'Off' },
];

const FINISH_HOTKEYS = [
  { value: 'Control+Alt+O', label: 'Ctrl + Alt + O' },
  { value: 'Control+Shift+O', label: 'Ctrl + Shift + O' },
  { value: 'Alt+O', label: 'Alt + O' },
  { value: 'F10', label: 'F10' },
  { value: '', label: 'Off' },
];

function countEntries(data: ReturnType<typeof useStore.getState>['data'], pred: (activityId: string) => boolean) {
  let n = 0;
  for (const s of data.seasons) for (const d of s.days) for (const e of d.entries) if (pred(e.activityId)) n++;
  return n;
}

function InlineName({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => {
    const t = v.trim();
    if (t && t !== value) onSave(t);
    else setV(value);
  };
  return (
    <input
      className="input"
      style={{ height: 32, maxWidth: 260 }}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

function NewSectionModal({ parentId, onClose }: { parentId?: string; onClose: () => void }) {
  const data = useStore((s) => s.data);
  const mutate = useStore((s) => s.mutate);
  const toast = useStore((s) => s.toast);
  const [name, setName] = useState('');
  const [parent, setParent] = useState<string>(parentId ?? '');
  const parentSection = parent ? data.sections.find((s) => s.id === parent) : undefined;
  const [color, setColor] = useState(parentSection?.color ?? SECTION_COLORS[data.sections.length % SECTION_COLORS.length]);
  const siblings = childSections(data, parent || undefined);
  const taken = siblings.some((s) => s.name.toLowerCase() === name.trim().toLowerCase());
  // An activity with the same name in the parent becomes the new section (its history moves to "Overall").
  const twin = parent ? sectionActivities(data, parent).find((a) => a.name.trim().toLowerCase() === name.trim().toLowerCase()) : undefined;
  const valid = !!name.trim() && !taken;
  const save = () => {
    if (!valid) return;
    let label = '';
    mutate((d) => {
      const created = twin ? activityToSection(d, twin.id) : createSection(d, name, color, parent || undefined);
      if (created && !twin) created.color = color;
      if (created) label = sectionLabel(d, created.id);
    });
    toast({ kind: 'success', title: `Section ${label} added`, body: twin ? `What you logged as “${twin.name}” is now under ${twin.name} › Overall.` : undefined });
    onClose();
  };
  return (
    <Modal
      title="New section"
      subtitle="Sections group the things you do. Put a section inside another one to split it up, e.g. Freeplay inside Training."
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!valid} onClick={save}>
            Add section
          </button>
        </>
      }
    >
      <Field label="Name" help={taken ? <span className="down">There is already a section with that name here</span> : 'e.g. Freeplay, Replay review, Coaching'}>
        <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
      </Field>
      <Field label="Inside" help={twin ? `“${twin.name}” is already an activity there. It becomes this section, and its logged time moves to ${twin.name} › Overall.` : undefined}>
        <select
          className="input"
          value={parent}
          onChange={(e) => {
            setParent(e.target.value);
            const p = data.sections.find((s) => s.id === e.target.value);
            if (p) setColor(p.color);
          }}
        >
          <option value="">Nothing (top level)</option>
          {sortedSections(data).map((s) => (
            <option key={s.id} value={s.id}>
              {sectionLabel(data, s.id)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Color">
        <div className="color-pick">
          {SECTION_COLORS.map((c) => (
            <button key={c} className={c === color ? 'on' : ''} style={{ background: c }} onClick={() => setColor(c)} aria-label={`Color ${c}`} />
          ))}
        </div>
      </Field>
    </Modal>
  );
}

function SectionsManager() {
  const data = useStore((s) => s.data);
  const mutate = useStore((s) => s.mutate);
  const toast = useStore((s) => s.toast);
  const [adding, setAdding] = useState<{ parentId?: string } | null>(null);
  const [newAct, setNewAct] = useState<Record<string, string>>({});
  // Drag-to-reorder state: which activity is dragged and where it would land.
  const [drag, setDrag] = useState<{ id: string; sectionId: string } | null>(null);
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);

  const move = (activityId: string, index: number) =>
    mutate((d) => {
      moveActivity(d, activityId, index);
    });

  const finishDrag = () => {
    if (drag && drop && drop.id !== drag.id) {
      const list = sectionActivities(data, drag.sectionId).filter((a) => a.id !== drag.id);
      const at = list.findIndex((a) => a.id === drop.id);
      if (at >= 0) move(drag.id, at + (drop.after ? 1 : 0));
    }
    setDrag(null);
    setDrop(null);
  };

  const deleteActivity = async (id: string, name: string) => {
    const n = countEntries(data, (a) => a === id);
    const ok = await confirmDialog({
      title: `Delete “${name}”?`,
      body: n ? `${n} logged entr${n === 1 ? 'y uses' : 'ies use'} it and will be deleted too. This can't be undone.` : 'It is not used anywhere yet.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    mutate((d) => {
      d.activities = d.activities.filter((a) => a.id !== id);
      for (const s of d.seasons) for (const day of s.days) day.entries = day.entries.filter((e) => e.activityId !== id);
      d.matches = d.matches.filter((m) => m.activityId !== id);
    });
  };

  const deleteSection = async (sec: Section) => {
    const tree = descendantSectionIds(data, sec.id);
    const ids = new Set(data.activities.filter((a) => tree.has(a.sectionId)).map((a) => a.id));
    const n = countEntries(data, (a) => ids.has(a));
    const subs = tree.size - 1;
    const ok = await confirmDialog({
      title: `Delete section “${sectionLabel(data, sec.id)}”?`,
      body: `${subs ? `Its ${subs} section${subs === 1 ? '' : 's'} inside, ` : 'Its '}${ids.size} activit${ids.size === 1 ? 'y' : 'ies'}${
        n ? ` and ${n} logged entries` : ''
      } will be deleted. This can't be undone.`,
      confirmLabel: 'Delete section',
      danger: true,
    });
    if (!ok) return;
    mutate((d) => {
      deleteSectionTree(d, sec.id);
    });
  };

  const turnIntoSection = async (activityId: string, name: string, sectionName: string) => {
    const n = countEntries(data, (a) => a === activityId);
    const ok = await confirmDialog({
      title: `Turn “${name}” into a section?`,
      body: `“${name}” becomes a section inside ${sectionName}, so you can add things inside it (e.g. ${name} › Flicks). ${
        n ? `Your ${n} logged entr${n === 1 ? 'y moves' : 'ies move'} to ${name} › Overall, ` : ''
      }and its statistics include everything inside it.`,
      confirmLabel: 'Turn into section',
    });
    if (!ok) return;
    mutate((d) => {
      activityToSection(d, activityId);
    });
    toast({ kind: 'success', title: `${name} is now a section`, body: 'Add the things you do in it below.' });
  };

  const addActivity = (sectionId: string, kind: Section['kind']) => {
    const name = (newAct[sectionId] ?? '').trim();
    if (!name) return;
    if (data.activities.some((a) => a.sectionId === sectionId && a.name.toLowerCase() === name.toLowerCase())) return;
    mutate((d) => {
      d.activities.push({
        id: uid(),
        sectionId,
        name,
        defaultMeasure: kind === 'games' ? 'amount' : 'time',
        defaultUnit: 'min',
        order: nextActivityOrder(d, sectionId),
        createdAt: new Date().toISOString(),
      });
    });
    setNewAct({ ...newAct, [sectionId]: '' });
  };

  const renderSection = (sec: Section, depth: number): ReactNode => {
    const acts = sectionActivities(data, sec.id);
    const subs = childSections(data, sec.id);
    const siblings = childSections(data, sec.parentId);
    const pos = siblings.findIndex((s) => s.id === sec.id);
    return (
      <div className={depth ? 'sub-section' : ''} key={sec.id} style={depth ? { ['--sub-color' as any]: sec.color } : undefined}>
        <div className="row between" style={{ marginBottom: 8 }}>
          <div className="row" style={{ minWidth: 0 }}>
            {depth > 0 && (
              <div className="order-ctl">
                <div className="arrows">
                  <button aria-label={`Move ${sec.name} up`} title="Move up" disabled={pos <= 0} onClick={() => mutate((d) => moveSection(d, sec.id, pos - 1))}>
                    <ChevronUp size={13} />
                  </button>
                  <button
                    aria-label={`Move ${sec.name} down`}
                    title="Move down"
                    disabled={pos === siblings.length - 1}
                    onClick={() => mutate((d) => moveSection(d, sec.id, pos + 1))}
                  >
                    <ChevronDown size={13} />
                  </button>
                </div>
              </div>
            )}
            {depth > 0 ? <Folder size={15} color={sec.color} /> : <span className="color-dot" style={{ background: sec.color }} />}
            <InlineName
              value={sec.name}
              onSave={(v) =>
                mutate((d) => {
                  const s = d.sections.find((x) => x.id === sec.id);
                  if (s) s.name = v;
                })
              }
            />
            {sec.builtIn && <span className="badge">Built-in</span>}
          </div>
          <div className="row" style={{ gap: 2 }}>
            <button className="icon-btn" title={`Add a section inside ${sec.name}`} aria-label={`Add a section inside ${sec.name}`} onClick={() => setAdding({ parentId: sec.id })}>
              <FolderPlus size={15} />
            </button>
            {!sec.builtIn && (
              <button className="icon-btn" title="Delete section" aria-label={`Delete section ${sec.name}`} onClick={() => deleteSection(sec)}>
                <Trash2 size={15} />
              </button>
            )}
          </div>
        </div>
        {acts.map((a, i) => (
          <div
            className={`act-row ${drag?.id === a.id ? 'dragging' : ''} ${drop?.id === a.id && drag?.id !== a.id ? (drop.after ? 'drop-after' : 'drop-before') : ''}`}
            key={a.id}
            draggable={drag?.id === a.id}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', a.id);
            }}
            onDragOver={(e) => {
              if (!drag || drag.sectionId !== sec.id) return;
              e.preventDefault();
              const r = e.currentTarget.getBoundingClientRect();
              const after = e.clientY > r.top + r.height / 2;
              if (drop?.id !== a.id || drop.after !== after) setDrop({ id: a.id, after });
            }}
            onDrop={(e) => {
              e.preventDefault();
              finishDrag();
            }}
            onDragEnd={finishDrag}
          >
            <div className="order-ctl">
              <span className="grip" title="Drag to move" onMouseDown={() => setDrag({ id: a.id, sectionId: sec.id })} onMouseUp={() => !drop && setDrag(null)}>
                <GripVertical size={15} />
              </span>
              <div className="arrows">
                <button aria-label={`Move ${a.name} up`} title="Move up" disabled={i === 0} onClick={() => move(a.id, i - 1)}>
                  <ChevronUp size={13} />
                </button>
                <button aria-label={`Move ${a.name} down`} title="Move down" disabled={i === acts.length - 1} onClick={() => move(a.id, i + 1)}>
                  <ChevronDown size={13} />
                </button>
              </div>
              <span className="order-num">{i + 1}</span>
            </div>
            <InlineName
              value={a.name}
              onSave={(v) =>
                mutate((d) => {
                  const x = d.activities.find((y) => y.id === a.id);
                  if (x) x.name = v;
                })
              }
            />
            <div style={{ marginLeft: 'auto' }} title="Default measure when adding">
              <Segmented
                value={a.defaultMeasure}
                onChange={(m: Measure) =>
                  mutate((d) => {
                    const x = d.activities.find((y) => y.id === a.id);
                    if (x) x.defaultMeasure = m;
                  })
                }
                options={[
                  { value: 'time', label: <Clock size={13} /> },
                  { value: 'amount', label: <Hash size={13} /> },
                ]}
              />
            </div>
            {!a.key && (
              <button
                className="icon-btn"
                title="Turn into a section (to add things inside it)"
                aria-label={`Turn ${a.name} into a section`}
                onClick={() => turnIntoSection(a.id, a.name, sec.name)}
              >
                <FolderInput size={14} />
              </button>
            )}
            <button className="icon-btn" title="Delete" aria-label={`Delete ${a.name}`} onClick={() => deleteActivity(a.id, a.name)}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <div className="row" style={{ marginTop: 10 }}>
          <input
            className="input"
            style={{ height: 32 }}
            placeholder={`Add to ${sec.name}…`}
            value={newAct[sec.id] ?? ''}
            onChange={(e) => setNewAct({ ...newAct, [sec.id]: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && addActivity(sec.id, sec.kind)}
          />
          <button className="btn small" onClick={() => addActivity(sec.id, sec.kind)} aria-label={`Add to ${sec.name}`}>
            <Plus size={14} />
          </button>
        </div>
        {subs.map((s) => renderSection(s, depth + 1))}
      </div>
    );
  };

  return (
    <>
      <div className="section-title">
        <h2>Sections & activities</h2>
        <button className="btn small" onClick={() => setAdding({})}>
          <Plus size={14} /> New section
        </button>
      </div>
      <div className="grid auto-lg">
        {childSections(data, undefined).map((sec) => (
          <div className="card settings-list" key={sec.id}>
            {renderSection(sec, 0)}
          </div>
        ))}
      </div>
      {adding && <NewSectionModal parentId={adding.parentId} onClose={() => setAdding(null)} />}
    </>
  );
}

function UpdatesCard({ version }: { version: string }) {
  const update = useStore((s) => s.update);
  const auto = useStore((s) => s.data.settings.autoUpdate);
  const checks = useStore((s) => s.data.settings.updateChecks);
  const mutate = useStore((s) => s.mutate);
  const [busy, setBusy] = useState(false);
  const check = async () => {
    setBusy(true);
    try {
      await window.rlj.checkForUpdates();
    } finally {
      setBusy(false);
    }
  };
  let status: ReactNode = null;
  let action: ReactNode = (
    <button className="btn" disabled={busy || update.state === 'checking'} onClick={check}>
      <RefreshCw size={15} className={update.state === 'checking' ? 'spin' : ''} /> Check for updates
    </button>
  );
  switch (update.state) {
    case 'unsupported':
      status = update.reason;
      action = null;
      break;
    case 'idle':
      status = checks ? 'Checks for new versions every few hours.' : 'Automatic checks are off.';
      break;
    case 'checking':
      status = 'Checking…';
      break;
    case 'none':
      status = <>You have the latest version. Checked {relativeTime(update.lastCheck)}.</>;
      break;
    case 'available':
      status = (
        <>
          Version <b>{update.version}</b> is available.
        </>
      );
      action = (
        <button className="btn primary" onClick={() => window.rlj.installUpdate()}>
          <Download size={15} /> Install update
        </button>
      );
      break;
    case 'downloading':
      status = (
        <>
          Downloading version {update.version}… {update.percent}%
        </>
      );
      action = null;
      break;
    case 'downloaded':
      status = auto ? (
        <>
          Version <b>{update.version}</b> is ready. It installs by itself when you aren't using the app, or now:
        </>
      ) : (
        <>
          Version <b>{update.version}</b> is ready to install.
        </>
      );
      action = (
        <button className="btn primary" onClick={() => window.rlj.installUpdate()}>
          <RefreshCw size={15} /> Restart and update
        </button>
      );
      break;
    case 'installing':
      status = <>Installing version {update.version}. The app restarts in a moment…</>;
      action = null;
      break;
    case 'error':
      status = <span className="down">{update.message}</span>;
      break;
  }
  return (
    <div className="card">
      <div className="update-row">
        <div>
          <div style={{ fontWeight: 600 }}>RL Journal {version}</div>
          <div className="muted small" style={{ marginTop: 2 }}>
            {status}
          </div>
        </div>
        {action}
      </div>
      {update.state !== 'unsupported' && (
        <div style={{ marginTop: 8 }}>
          <Toggle
            title="Check for updates"
            desc="Every few hours the app asks GitHub if there's a new version. Nothing about you or your journal is sent. Off: only when you click Check for updates."
            on={checks}
            onChange={(v) =>
              mutate((d) => {
                d.settings.updateChecks = v;
              })
            }
          />
          {checks && (
            <Toggle
              title="Install updates automatically"
              desc="Downloads new versions by itself and installs them when you aren't in a match or using the app, then tells you. Off: you get a notification and install with one click."
              on={auto}
              onChange={(v) =>
                mutate((d) => {
                  d.settings.autoUpdate = v;
                })
              }
            />
          )}
        </div>
      )}
    </div>
  );
}

export function SettingsPage() {
  const data = useStore((s) => s.data);
  const settings = data.settings;
  const mutate = useStore((s) => s.mutate);
  const replaceData = useStore((s) => s.replaceData);
  const toast = useStore((s) => s.toast);
  const [version, setVersion] = useState('');
  const isLinux = window.rlj.platform === 'linux';
  const [folder, setFolder] = useState('');
  useEffect(() => {
    window.rlj.version().then(setVersion);
    window.rlj.dataFolder().then(setFolder);
  }, []);

  const set = <K extends keyof typeof settings>(k: K, v: (typeof settings)[K]) =>
    mutate((d) => {
      d.settings[k] = v;
    });

  const exportData = async () => {
    const ok = await window.rlj.exportData(JSON.stringify(data, null, 2));
    if (ok) toast({ kind: 'success', title: 'Backup exported' });
  };

  const importData = async () => {
    const raw = await window.rlj.importData().catch(() => null);
    if (!raw) return;
    const parsed = normalizeData(raw);
    if (!Array.isArray((raw as any).seasons)) {
      toast({ kind: 'error', title: 'Not an RL Journal backup' });
      return;
    }
    const ok = await confirmDialog({
      title: 'Replace your journal with this backup?',
      body: `The backup has ${parsed.seasons.length} season(s). Your current data will be replaced. Export a backup first if you want to keep it.`,
      confirmLabel: 'Import and replace',
      danger: true,
    });
    if (!ok) return;
    replaceData(parsed);
    toast({ kind: 'success', title: 'Backup imported' });
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <div className="subtitle">Sections, sync behaviour and your data.</div>
        </div>
      </div>

      <SectionsManager />

      <div className="section-title">
        <h2>Sync & notifications</h2>
      </div>
      <div className="card">
        <Toggle title="Desktop notifications" desc="Show a notification when a game is logged automatically." on={settings.systemNotifications} onChange={(v) => set('systemNotifications', v)} />
        <Toggle title="Keep running in the tray when closed" desc="Needed for automatic logging while the window is closed." on={settings.closeToTray} onChange={(v) => set('closeToTray', v)} />
        <Toggle
          title={isLinux ? 'Start when I log in' : 'Start with Windows'}
          desc="Starts minimized to the tray so games keep being logged."
          on={settings.startWithWindows}
          onChange={(v) => set('startWithWindows', v)}
        />
        <Toggle
          title="Track wins and losses for auto-logged games"
          desc="Ranked, casual and all other modes. Off: only the number of games is logged."
          on={settings.trackResultsGames}
          onChange={(v) => set('trackResultsGames', v)}
        />
        <Toggle
          title="Track wins and losses for auto-logged honor duels"
          desc="Off: honor duels are only counted."
          on={settings.trackResultsHonorDuel}
          onChange={(v) => set('trackResultsHonorDuel', v)}
        />
        <Toggle
          title="Ignore private matches"
          desc="Private and third-party matches are not logged. Freeplay, training, workshop and offline games are never logged."
          on={settings.ignorePrivateMatches}
          onChange={(v) => set('ignorePrivateMatches', v)}
        />
      </div>

      <div className="section-title">
        <h2>Timer & in-game overlay</h2>
      </div>
      <div className="card">
        <div className="muted small" style={{ marginBottom: 6 }}>
          <Timer size={13} style={{ verticalAlign: -2 }} /> On any day, pick what you're doing, then click <b>Timer</b> (counts down the time you enter and logs it when it ends) or <b>Stopwatch</b> (counts up until you stop it, then logs the time).
        </div>
        <Toggle
          title="Show the timer on top of Rocket League"
          desc="A small timer at the top of the screen while the game runs, with a pause button. Works with the game in Borderless or Windowed mode. In Fullscreen, Windows draws the game over everything else, so use Borderless."
          on={settings.timerOverlay}
          onChange={(v) => set('timerOverlay', v)}
        />
        {settings.timerOverlay && (
          <div className="row between" style={{ padding: '10px 0' }}>
            <div>
              <div style={{ fontWeight: 500 }}>Overlay position</div>
              <div className="muted small">Top of the screen the game is on.</div>
            </div>
            <Segmented
              value={settings.overlayPosition}
              onChange={(v) => set('overlayPosition', v)}
              options={[
                { value: 'top-left', label: 'Left' },
                { value: 'top-center', label: 'Center' },
                { value: 'top-right', label: 'Right' },
              ]}
            />
          </div>
        )}
        <div className="row between" style={{ padding: '10px 0', alignItems: 'flex-start' }}>
          <div style={{ paddingRight: 16 }}>
            <div style={{ fontWeight: 500 }}>Pause / resume shortcut</div>
            <div className="muted small">
              Works while you're in game, where the game keeps the mouse to itself. It's only active while a timer runs.
            </div>
          </div>
          <select className="input" style={{ width: 170 }} value={settings.timerHotkey} onChange={(e) => set('timerHotkey', e.target.value)}>
            {HOTKEYS.map((h) => (
              <option key={h.value} value={h.value}>
                {h.label}
              </option>
            ))}
          </select>
        </div>
        <div className="row between" style={{ padding: '10px 0', alignItems: 'flex-start' }}>
          <div style={{ paddingRight: 16 }}>
            <div style={{ fontWeight: 500 }}>Done shortcut</div>
            <div className="muted small">Stops the stopwatch (or ends a timer early) and logs the time so far. Also works in game.</div>
          </div>
          <select className="input" style={{ width: 170 }} value={settings.timerFinishHotkey} onChange={(e) => set('timerFinishHotkey', e.target.value)}>
            {FINISH_HOTKEYS.map((h) => (
              <option key={h.value} value={h.value}>
                {h.label}
              </option>
            ))}
          </select>
        </div>
        <Toggle title="Play a sound when a timer ends" on={settings.timerSound} onChange={(v) => set('timerSound', v)} />
      </div>

      <div className="section-title">
        <h2>Updates</h2>
      </div>
      <UpdatesCard version={version} />

      <div className="section-title">
        <h2>Your data</h2>
      </div>
      <div className="card">
        <div className="muted small" style={{ marginBottom: 12 }}>
          Everything is stored locally on this computer{folder ? <> in <code>{folder}</code></> : null}. A daily backup is kept for 14 days.
          Installing an update or running the installer again never replaces your journal.
        </div>
        <div className="row wrap">
          <button className="btn" onClick={exportData}>
            <Download size={15} /> Export backup
          </button>
          <button className="btn" onClick={importData}>
            <Upload size={15} /> Import backup
          </button>
          <button className="btn ghost" onClick={() => window.rlj.openDataFolder()}>
            <FolderOpen size={15} /> Open data folder
          </button>
        </div>
      </div>
      <div className="muted tiny" style={{ marginTop: 24, textAlign: 'center' }}>
        RL Journal {version} · Not affiliated with Psyonix or Epic Games.
      </div>
    </div>
  );
}
