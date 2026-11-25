import { useEffect, useState } from 'react';
import { Clock, Download, FolderOpen, Hash, Plus, Trash2, Upload } from 'lucide-react';
import { useStore } from '../store';
import { confirmDialog, Field, Modal, Segmented, Toggle } from '../components/ui';
import { normalizeData, SECTION_COLORS, sortedSections } from '../lib/journal';
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
          const acts = data.activities.filter((a) => a.sectionId === sec.id);
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
              {acts.map((a) => (
                <div className="act-row" key={a.id}>
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

export function SettingsPage() {
  const data = useStore((s) => s.data);
  const settings = data.settings;
  const mutate = useStore((s) => s.mutate);
  const replaceData = useStore((s) => s.replaceData);
  const toast = useStore((s) => s.toast);
  const [version, setVersion] = useState('');
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
        <Toggle title="Windows notifications" desc="Show a notification when games are added from your accounts." on={settings.systemNotifications} onChange={(v) => set('systemNotifications', v)} />
        <Toggle title="Keep running in the tray when closed" desc="Needed for automatic sync while the window is closed." on={settings.closeToTray} onChange={(v) => set('closeToTray', v)} />
        <Toggle title="Start with Windows" desc="Launches minimized to the tray so games keep syncing." on={settings.startWithWindows} onChange={(v) => set('startWithWindows', v)} />
        <Toggle title="Ignore private, offline and training matches" desc="Exhibition, private matches, workshop and local games are not logged." on={settings.ignorePrivateMatches} onChange={(v) => set('ignorePrivateMatches', v)} />
        <Toggle
          title="Count casual games as 1s / 2s / 3s"
          desc="Off: casual games are logged separately as “Casual 2s” and so on."
          on={settings.countCasualAsRanked}
          onChange={(v) => set('countCasualAsRanked', v)}
        />
      </div>

      <div className="section-title">
        <h2>Your data</h2>
      </div>
      <div className="card">
        <div className="muted small" style={{ marginBottom: 12 }}>
          Everything is stored locally on this PC{folder ? <> in <code>{folder}</code></> : null}. A daily backup is kept for 14 days.
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
        RL Journal {version} · Not affiliated with Psyonix, Epic Games or Tracker Network.
      </div>
    </div>
  );
}
