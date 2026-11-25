import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, Clock, Download, FolderOpen, GripVertical, Hash, Plus, RefreshCw, Trash2, Upload } from 'lucide-react';
import { useStore } from '../store';
import { confirmDialog, Field, Modal, Segmented, Toggle } from '../components/ui';
import { moveActivity, nextActivityOrder, normalizeData, SECTION_COLORS, sectionActivities, sortedSections } from '../lib/journal';
import { relativeTime } from '../lib/dates';
import { uid } from '../lib/format';
import type { Measure, Section } from '../../shared/model';

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

function NewSectionModal({ onClose }: { onClose: () => void }) {
  const data = useStore((s) => s.data);
  const mutate = useStore((s) => s.mutate);
  const [name, setName] = useState('');
  const [color, setColor] = useState(SECTION_COLORS[(data.sections.length) % SECTION_COLORS.length]);
  const taken = data.sections.some((s) => s.name.toLowerCase() === name.trim().toLowerCase());
  const valid = name.trim() && !taken;
  const save = () => {
    if (!valid) return;
    mutate((d) => {
      const s: Section = { id: uid(), name: name.trim(), color, kind: 'other', order: Math.max(0, ...d.sections.map((x) => x.order)) + 1 };
      d.sections.push(s);
    });
    onClose();
  };
  return (
    <Modal
      title="New section"
      subtitle="Sections group the things you do, like Training and Games."
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
      <Field label="Name" help={taken ? <span className="down">A section with that name exists</span> : 'e.g. Replay review, Coaching, Workshop maps'}>
        <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
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
  const [adding, setAdding] = useState(false);
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
    const ids = new Set(data.activities.filter((a) => a.sectionId === sec.id).map((a) => a.id));
    const n = countEntries(data, (a) => ids.has(a));
    const ok = await confirmDialog({
      title: `Delete section “${sec.name}”?`,
      body: `Its ${ids.size} activit${ids.size === 1 ? 'y' : 'ies'}${n ? ` and ${n} logged entries` : ''} will be deleted. This can't be undone.`,
      confirmLabel: 'Delete section',
      danger: true,
    });
    if (!ok) return;
    mutate((d) => {
      d.sections = d.sections.filter((s) => s.id !== sec.id);
      d.activities = d.activities.filter((a) => !ids.has(a.id));
      for (const s of d.seasons) for (const day of s.days) day.entries = day.entries.filter((e) => !ids.has(e.activityId));
    });
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

  return (
    <>
      <div className="section-title">
        <h2>Sections & activities</h2>
        <button className="btn small" onClick={() => setAdding(true)}>
          <Plus size={14} /> New section
        </button>
      </div>
      <div className="grid auto-lg">
        {sortedSections(data).map((sec) => {
          const acts = sectionActivities(data, sec.id);
          return (
            <div className="card settings-list" key={sec.id}>
              <div className="row between" style={{ marginBottom: 8 }}>
                <div className="row">
                  <span className="color-dot" style={{ background: sec.color }} />
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
                {!sec.builtIn && (
                  <button className="icon-btn" title="Delete section" aria-label="Delete section" onClick={() => deleteSection(sec)}>
                    <Trash2 size={15} />
                  </button>
                )}
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
                    <span
                      className="grip"
                      title="Drag to move"
                      onMouseDown={() => setDrag({ id: a.id, sectionId: sec.id })}
                      onMouseUp={() => !drop && setDrag(null)}
                    >
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
                <button className="btn small" onClick={() => addActivity(sec.id, sec.kind)}>
                  <Plus size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {adding && <NewSectionModal onClose={() => setAdding(false)} />}
    </>
  );
}

function UpdatesCard({ version }: { version: string }) {
  const update = useStore((s) => s.update);
  const auto = useStore((s) => s.data.settings.autoUpdate);
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
      status = 'Checks for new versions every few hours.';
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
            title="Install updates automatically"
            desc="Downloads new versions by itself and installs them when you aren't in a match or using the app, then tells you. Off: you get a notification and install with one click."
            on={auto}
            onChange={(v) =>
              mutate((d) => {
                d.settings.autoUpdate = v;
              })
            }
          />
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
