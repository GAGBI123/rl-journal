import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, FolderOpen, Gamepad2, Pencil, Plus, Radio, Trash2, TriangleAlert, UserCheck, Wifi, WifiOff } from 'lucide-react';
import { useStore } from '../store';
import { confirmDialog, EmptyState, Field, Modal, NumberInput, Toggle } from '../components/ui';
import { formatDate } from '../lib/dates';
import { accountForPlayer } from '../lib/sync';
import { uid } from '../lib/format';
import { SECTION_COLORS, seasonLabel } from '../lib/journal';
import { playlistInfo } from '../../shared/playlists';
import type { Account } from '../../shared/model';
import type { StatsApiStatus } from '../env';



function LiveGameSection() {
  const status = useStore((s) => s.liveStatus);
  const settings = useStore((s) => s.data.settings);
  const mutate = useStore((s) => s.mutate);
  const [ini, setIni] = useState<StatsApiStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string; path?: string } | null>(null);

  const refresh = (dir?: string) => window.rlj.statsApiStatus(dir).then(setIni);
  useEffect(() => {
    refresh();
  }, []);

  const setup = async (dir?: string) => {
    setBusy(true);
    try {
      const r = await window.rlj.statsApiSetup(dir ?? ini?.installDir);
      setResult(r);
      if (r.ok && r.webPort && r.webPort !== settings.liveGamePort) {
        mutate((d) => {
          d.settings.liveGamePort = r.webPort!;
        });
      }
      await refresh(dir ?? ini?.installDir);
    } finally {
      setBusy(false);
    }
  };

  const choose = async () => {
    const dir = await window.rlj.statsApiChooseDir();
    if (dir) {
      await refresh(dir);
      await setup(dir);
    }
  };

  const connected = status.state === 'connected';
  const accounts = useStore((s) => s.data.accounts);
  const lastPlayer = useStore((s) => s.data.settings.lastLocalPlayer);
  const player = status.state === 'connected' ? status.player ?? lastPlayer : undefined;
  const playerLabel = player ? accountForPlayer(accounts, player)?.label ?? player.name : undefined;
  return (
    <div className="card">
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
          <div className="avatar" style={{ background: 'linear-gradient(135deg,#3b8cf0,#7b5cff)' }}>
            <Gamepad2 size={20} />
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>Live game connection</div>
            <div className="muted small">
              Uses Rocket League's official Stats API. Every online match you finish is logged automatically: ranked or casual, the mode, win or loss, and your stats.
            </div>
          </div>
        </div>
        <span className={`status-pill ${status.state}`} style={{ cursor: 'default' }}>
          {connected ? <Wifi size={13} /> : <WifiOff size={13} />}
          {status.state === 'disabled'
            ? 'Off'
            : status.state === 'waiting'
              ? 'Waiting for Rocket League'
              : status.inMatch
                ? `In match${status.playlistId !== undefined ? ` · ${playlistInfo(status.playlistId).mode}` : ''}${playerLabel ? ` · ${playerLabel}` : ''}`
                : `Connected${playerLabel ? ` · ${playerLabel}` : ''}`}
        </span>
      </div>

      <div style={{ marginTop: 10 }}>
        <Toggle
          title="Auto-log games from Rocket League"
          desc={`Listens on ws://localhost:${settings.liveGamePort} while the app is open (also when minimized to the tray).`}
          on={settings.liveGameEnabled}
          onChange={(v) =>
            mutate((d) => {
              d.settings.liveGameEnabled = v;
            })
          }
        />
      </div>

      {settings.liveGameEnabled && (
        <div className="stack" style={{ marginTop: 8 }}>
          {ini && !ini.found && (
            <div className="callout warn">
              <TriangleAlert size={16} />
              <div>
                Couldn't find your Rocket League install automatically.{' '}
                <button className="btn small" style={{ marginLeft: 6 }} onClick={choose}>
                  <FolderOpen size={14} /> Choose folder
                </button>
              </div>
            </div>
          )}
          {ini?.found && (
            <div className={`callout ${ini.enabled ? 'good' : 'warn'}`}>
              {ini.enabled ? <CheckCircle2 size={16} /> : <TriangleAlert size={16} />}
              <div style={{ flex: 1 }}>
                {ini.enabled ? (
                  <>
                    Stats API is enabled in <code>{ini.file?.split('\\').slice(-1)[0]}</code> (port {ini.webPort}, {ini.packetSendRate} updates/sec).
                  </>
                ) : ini.file ? (
                  <>The Stats API is turned off in your game config. Enable it once, then restart Rocket League.</>
                ) : (
                  <>Found Rocket League but no Stats API config file. Update the game, then try again.</>
                )}
                <div className="row wrap" style={{ marginTop: 8 }}>
                  {!ini.enabled && ini.file && (
                    <button className="btn primary small" disabled={busy} onClick={() => setup()}>
                      Enable Stats API
                    </button>
                  )}
                  {ini.file && (
                    <button className="btn small" onClick={() => window.rlj.statsApiReveal(ini.file!)}>
                      <FolderOpen size={14} /> Show file
                    </button>
                  )}
                  <button className="btn ghost small" onClick={choose}>
                    Different install folder
                  </button>
                </div>
              </div>
            </div>
          )}
          {result && (
            <div className={`callout ${result.ok ? 'good' : 'error'}`}>
              {result.ok ? <CheckCircle2 size={16} /> : <TriangleAlert size={16} />}
              <div>
                {result.message}
                {!result.ok && result.path && (
                  <div style={{ marginTop: 6 }}>
                    Manual fix: open <code>{result.path}</code> and set this under <code>[TAGame.MatchStatsExporter_TA]</code>:
                    <pre className="code" style={{ marginTop: 6 }}>{'PacketSendRate=2\nPort=49123\nWebPort=49124'}</pre>
                  </div>
                )}
              </div>
            </div>
          )}
          <details className="small text-2">
            <summary style={{ cursor: 'pointer' }}>How it works</summary>
            <ol className="steps" style={{ marginTop: 8 }}>
              <li>Click <b>Enable Stats API</b> (or set <code>PacketSendRate</code> above 0 in <code>TAGame\Config\TAStatsAPI.ini</code> yourself).</li>
              <li>Restart Rocket League. The game then streams match events to this PC only.</li>
              <li>Play. The app sees which player you control, so your account is detected by itself (also when you switch accounts).</li>
              <li>Finished matches go to today's day in your active season, and you get a notification. Freeplay, training and offline games are not logged.</li>
            </ol>
          </details>
          <div className="row">
            <Field label="WebSocket port">
              <div style={{ width: 120 }}>
                <NumberInput
                  value={String(settings.liveGamePort)}
                  onChange={(v) =>
                    mutate((d) => {
                      d.settings.liveGamePort = Math.min(65535, Math.max(1, Math.floor(Number(v) || 49124)));
                    })
                  }
                />
              </div>
            </Field>
          </div>
        </div>
      )}
    </div>
  );
}

function LastMatchPlayers() {
  const live = useStore((s) => s.livePlayers);
  const saved = useStore((s) => s.data.settings.lastMatchPlayers);
  const accounts = useStore((s) => s.data.accounts);
  const mutate = useStore((s) => s.mutate);
  const toast = useStore((s) => s.toast);
  const players = live.length ? live : saved ?? [];
  const [target, setTarget] = useState<string>('');
  if (!players.length) return null;
  const liveAccounts = accounts.filter((a) => a.liveGame);
  const link = (p: { name: string; primaryId?: string }) => {
    const accId = target || liveAccounts[0]?.id;
    if (!accId) return;
    mutate((d) => {
      const a = d.accounts.find((x) => x.id === accId);
      if (!a) return;
      if (p.primaryId && !a.primaryIds.includes(p.primaryId)) a.primaryIds.push(p.primaryId);
      if (!a.inGameNames.some((n) => n.toLowerCase() === p.name.toLowerCase())) a.inGameNames.push(p.name);
    });
    toast({ kind: 'success', title: `Linked ${p.name}`, body: 'Future matches with this player will count as yours.' });
  };
  const isMine = (p: { name: string; primaryId?: string }) =>
    accounts.some((a) => (p.primaryId && a.primaryIds.includes(p.primaryId)) || a.inGameNames.some((n) => n.toLowerCase() === p.name.toLowerCase()));
  return (
    <div className="card">
      <div className="row between">
        <div>
          <div style={{ fontWeight: 600 }}>Players in your {live.length ? 'current' : 'last'} match</div>
          <div className="muted small">You're detected automatically. If a match ever shows “Not matched”, click “That's me” on yourself.</div>
        </div>
        {liveAccounts.length > 1 && (
          <select className="input" style={{ width: 200 }} value={target || liveAccounts[0].id} onChange={(e) => setTarget(e.target.value)}>
            {liveAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                Link to {a.label}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="chips" style={{ marginTop: 12 }}>
        {players.map((p, i) => (
          <div key={(p.primaryId ?? p.name) + i} className="chip" style={{ cursor: 'default' }}>
            {p.name || 'Unknown'}
            <span className="muted tiny">{p.primaryId?.split('|')[0]}</span>
            {isMine(p) ? (
              <span className="badge active" style={{ height: 20 }}>
                <UserCheck size={12} /> You
              </span>
            ) : liveAccounts.length ? (
              <button className="btn small ghost" style={{ height: 24 }} onClick={() => link(p)}>
                That's me
              </button>
            ) : null}
          </div>
        ))}
      </div>
      {!liveAccounts.length && <div className="muted small" style={{ marginTop: 10 }}>Your account appears here after your first match.</div>}
    </div>
  );
}

function AccountModal({ account, onClose }: { account?: Account; onClose: () => void }) {
  const accounts = useStore((s) => s.data.accounts);
  const mutate = useStore((s) => s.mutate);
  const [label, setLabel] = useState(account?.label ?? (accounts.length ? `Account ${accounts.length + 1}` : 'Main'));
  const [names, setNames] = useState((account?.inGameNames ?? []).join(', '));
  const [liveGame, setLiveGame] = useState(account?.liveGame ?? true);

  const inGameNames = names
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean);
  const valid = label.trim().length > 0;

  const save = () => {
    if (!valid) return;
    mutate((d) => {
      const existing = account && d.accounts.find((a) => a.id === account.id);
      const base: Account = existing ?? {
        id: uid(),
        label: '',
        platform: 'other',
        inGameNames: [],
        primaryIds: [],
        liveGame: true,
        color: SECTION_COLORS[d.accounts.length % SECTION_COLORS.length],
        createdAt: new Date().toISOString(),
      };
      base.label = label.trim();
      base.inGameNames = inGameNames;
      base.liveGame = liveGame;
      if (!existing) d.accounts.push(base);
    });
    onClose();
  };

  return (
    <Modal
      title={account ? `Edit ${account.label}` : 'Add account'}
      subtitle="Accounts are detected by themselves when you play. Add one here only to set a name in advance."
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!valid} onClick={save}>
            {account ? 'Save' : 'Add account'}
          </button>
        </>
      }
    >
      <Field label="Name in the app">
        <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Main, Smurf…" autoFocus />
      </Field>
      <Field label="In-game names" help="Comma separated. Optional: the app also recognizes you by your account ID once you've played a match.">
        <input className="input" value={names} onChange={(e) => setNames(e.target.value)} placeholder="e.g. MyName, MyOldName" />
      </Field>
      <Toggle title="Log this account's games" desc="Matches played on this account are added to your season automatically." on={liveGame} onChange={setLiveGame} />
      {account && account.primaryIds.length > 0 && (
        <div className="muted small">
          Linked account ID{account.primaryIds.length > 1 ? 's' : ''}: {account.primaryIds.map((id) => id.split('|').slice(0, 1).join('')).join(', ')}
        </div>
      )}
    </Modal>
  );
}

const PLATFORM_LABEL: Record<string, string> = { epic: 'Epic', steam: 'Steam', psn: 'PlayStation', xbl: 'Xbox', switch: 'Switch', other: '' };

function AccountCard({ account, onEdit }: { account: Account; onEdit: () => void }) {
  const mutate = useStore((s) => s.mutate);
  const allMatches = useStore((s) => s.data.matches);
  const status = useStore((s) => s.liveStatus);
  const matches = useMemo(() => allMatches.filter((m) => m.accountId === account.id), [allMatches, account.id]);
  const playingNow = status.state === 'connected' && !!status.player && !!accountForPlayer([account], status.player);
  const remove = async () => {
    const ok = await confirmDialog({
      title: `Remove ${account.label}?`,
      body: 'Games already logged stay in your journal. If you play on this account again, it is added back.',
      confirmLabel: 'Remove',
      danger: true,
    });
    if (ok)
      mutate((d) => {
        d.accounts = d.accounts.filter((a) => a.id !== account.id);
      });
  };
  const wins = matches.filter((m) => m.result === 'win').length;
  const losses = matches.filter((m) => m.result === 'loss').length;
  const platform = PLATFORM_LABEL[account.platform] ?? '';
  return (
    <div className="card account-card">
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div className="row" style={{ gap: 12 }}>
          <div className="avatar" style={{ background: account.color }}>
            {account.label.slice(0, 1).toUpperCase()}
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{account.label}</div>
            <div className="muted small">
              {[platform, account.inGameNames.join(', ')].filter(Boolean).join(' · ') || 'Not seen in a match yet'}
            </div>
          </div>
        </div>
        <div className="row" style={{ gap: 2 }}>
          <button className="icon-btn" title="Edit" aria-label="Edit account" onClick={onEdit}>
            <Pencil size={15} />
          </button>
          <button className="icon-btn" title="Remove" aria-label="Remove account" onClick={remove}>
            <Trash2 size={15} />
          </button>
        </div>
      </div>
      <div className="row wrap" style={{ gap: 6 }}>
        {playingNow && (
          <span className="badge active">
            <span className="pill-dot" /> Playing now
          </span>
        )}
        <span className={`badge ${account.liveGame ? 'active' : ''}`}>
          <Radio size={12} /> Auto-logging {account.liveGame ? 'on' : 'off'}
        </span>
        {matches.length > 0 && (
          <span className="badge">
            {matches.length} tracked · {wins}W {losses}L
          </span>
        )}
      </div>
      {account.primaryIds.length === 0 && account.inGameNames.length === 0 && (
        <div className="small down">No name or linked ID yet. Play a match and it links by itself.</div>
      )}
    </div>
  );
}

function RecentMatches() {
  const data = useStore((s) => s.data);
  const navigate = useStore((s) => s.navigate);
  const recent = [...data.matches].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 15);
  if (!recent.length) return null;
  return (
    <>
      <div className="section-title">
        <h2>Recently logged games</h2>
      </div>
      <div className="card" style={{ padding: '6px 10px' }}>
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              <th>Mode</th>
              <th>Result</th>
              <th>Score</th>
              <th>Account</th>
              <th>Logged to</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((m) => {
              const s = data.seasons.find((x) => x.id === m.seasonId);
              const a = data.accounts.find((x) => x.id === m.accountId);
              const act = data.activities.find((x) => x.id === m.activityId);
              return (
                <tr key={m.id} className="clickable" onClick={() => s && navigate({ name: 'day', seasonId: s.id, dayId: m.dayId })}>
                  <td className="muted">
                    {formatDate(m.date)} {new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td>{act?.name ?? m.mode}</td>
                  <td className={m.result === 'win' ? 'up' : m.result === 'loss' ? 'down' : 'muted'}>
                    {m.result === 'win' ? 'Win' : m.result === 'loss' ? (m.leftEarly ? 'Left early' : 'Loss') : '—'}
                  </td>
                  <td>{m.teamScore !== undefined ? `${m.teamScore} – ${m.opponentScore ?? 0}` : '—'}</td>
                  <td>{a?.label ?? <span className="muted">Not matched</span>}</td>
                  <td className="muted">{s ? seasonLabel(s) : 'Deleted season'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function AccountsPage() {
  const accounts = useStore((s) => s.data.accounts);
  const [editing, setEditing] = useState<Account | 'new' | null>(null);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Accounts & Sync</h1>
          <div className="subtitle">Games you play are logged automatically, for every account you play on.</div>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => setEditing('new')}>
            <Plus size={16} /> Add account
          </button>
        </div>
      </div>

      <div className="stack" style={{ gap: 14 }}>
        <LiveGameSection />
        <LastMatchPlayers />
      </div>

      <div className="section-title">
        <h2>Accounts</h2>
        <span className="muted small">{accounts.length} connected</span>
      </div>
      {accounts.length ? (
        <div className="grid auto-lg">
          {accounts.map((a) => (
            <AccountCard key={a.id} account={a} onEdit={() => setEditing(a)} />
          ))}
        </div>
      ) : (
        <EmptyState
          title="No accounts yet"
          body="Play a match with Rocket League open and your account is added by itself. You can also add one now."
          action={
            <button className="btn" onClick={() => setEditing('new')}>
              <Plus size={16} /> Add account
            </button>
          }
        />
      )}

      <RecentMatches />

      {editing && <AccountModal account={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
