import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Eye,
  EyeOff,
  FolderOpen,
  Gamepad2,
  Info,
  Pencil,
  Plus,
  Radio,
  RefreshCw,
  Trash2,
  TriangleAlert,
  UserCheck,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useStore } from '../store';
import { confirmDialog, EmptyState, Field, Modal, NumberInput, Segmented, Toggle } from '../components/ui';
import { syncTrackerAccount } from '../syncRuntime';
import { relativeTime, formatDate } from '../lib/dates';
import { uid } from '../lib/format';
import { SECTION_COLORS, seasonLabel } from '../lib/journal';
import { playlistInfo } from '../../shared/playlists';
import type { Account, Platform } from '../../shared/model';
import type { StatsApiStatus } from '../env';

const PLATFORMS: { value: Platform; label: string }[] = [
  { value: 'epic', label: 'Epic' },
  { value: 'steam', label: 'Steam' },
  { value: 'psn', label: 'PlayStation' },
  { value: 'xbl', label: 'Xbox' },
  { value: 'switch', label: 'Switch' },
];

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
              Uses Rocket League's official Stats API. Every match you finish is logged automatically, with mode, result and your stats.
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
                ? `In match${status.playlistId !== undefined ? ` · ${playlistInfo(status.playlistId).mode}` : ''}`
                : 'Connected'}
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
              <li>Add your accounts below with your in-game names so the app knows which player is you (for wins and your stats).</li>
              <li>Finished matches go to today's day in your active season, and you get a notification.</li>
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
          <div className="muted small">Not sure what name to use? Click “That's me” on yourself to link it to an account.</div>
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
      {!liveAccounts.length && <div className="muted small" style={{ marginTop: 10 }}>Add an account with “Live game” turned on to link players.</div>}
    </div>
  );
}

function AccountModal({ account, onClose }: { account?: Account; onClose: () => void }) {
  const accounts = useStore((s) => s.data.accounts);
  const settings = useStore((s) => s.data.settings);
  const mutate = useStore((s) => s.mutate);
  const [label, setLabel] = useState(account?.label ?? (accounts.length ? `Account ${accounts.length + 1}` : 'Main'));
  const [platform, setPlatform] = useState<Platform>(account?.platform ?? 'epic');
  const [username, setUsername] = useState(account?.username ?? '');
  const [names, setNames] = useState((account?.inGameNames ?? []).join(', '));
  const [liveGame, setLiveGame] = useState(account?.liveGame ?? true);
  const [trackerOn, setTrackerOn] = useState(account?.tracker.enabled ?? false);
  const [apiKey, setApiKey] = useState(account?.tracker.apiKey ?? '');
  const [showKey, setShowKey] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);

  const valid = label.trim() && (username.trim() || names.trim());
  const inGameNames = names
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean);

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    const r = await window.rlj.trackerFetch({ platform, username, apiKey, baseUrl: settings.trackerBaseUrl });
    setTesting(false);
    if (r.ok) {
      const top = r.snapshot.playlists
        .filter((p) => p.rating)
        .slice(0, 3)
        .map((p) => `${p.name}: ${p.rating}`)
        .join(' · ');
      setTest({ ok: true, text: `Connected. Found ${r.snapshot.playlists.length} playlists. ${top}` });
    } else setTest({ ok: false, text: r.error });
  };

  const save = () => {
    if (!valid) return;
    mutate((d) => {
      const existing = account && d.accounts.find((a) => a.id === account.id);
      const base: Account = existing ?? {
        id: uid(),
        label: '',
        platform,
        username: '',
        inGameNames: [],
        primaryIds: [],
        liveGame: true,
        tracker: { enabled: false, apiKey: '' },
        color: SECTION_COLORS[d.accounts.length % SECTION_COLORS.length],
        createdAt: new Date().toISOString(),
      };
      const identityChanged = existing && (existing.platform !== platform || existing.username !== username.trim());
      base.label = label.trim();
      base.platform = platform;
      base.username = username.trim();
      base.inGameNames = inGameNames.length ? inGameNames : username.trim() ? [username.trim()] : [];
      base.liveGame = liveGame;
      base.tracker.enabled = trackerOn;
      base.tracker.apiKey = apiKey.trim();
      if (identityChanged) {
        base.tracker.lastSnapshot = undefined;
        base.tracker.lastCheckedAt = undefined;
      }
      if (!existing) d.accounts.push(base);
    });
    onClose();
  };

  return (
    <Modal
      wide
      title={account ? `Edit ${account.label}` : 'Add account'}
      subtitle="Add one entry per Rocket League account you play on."
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
      <div className="grid cols-2">
        <Field label="Label">
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Main, Smurf…" autoFocus />
        </Field>
        <Field label="Platform">
          <select className="input" value={platform} onChange={(e) => setPlatform(e.target.value as Platform)}>
            {PLATFORMS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Username / ID" help="Your Epic display name, Steam ID, PSN or Xbox gamertag — as used on tracker.gg.">
        <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} />
      </Field>
      <Field label="In-game names" help="Comma separated. Used to find you in live matches. Leave empty to use the username.">
        <input className="input" value={names} onChange={(e) => setNames(e.target.value)} placeholder="e.g. MyName, MyOldName" />
      </Field>
      <div>
        <Toggle
          title="Live game (Rocket League Stats API)"
          desc="Log this account's matches from the game on this PC. Recommended."
          on={liveGame}
          onChange={setLiveGame}
        />
        <Toggle
          title="tracker.gg API"
          desc={liveGame ? 'With live game on, tracker.gg is only used for rank/MMR so games are not counted twice.' : 'Poll tracker.gg and add new games from this account automatically.'}
          on={trackerOn}
          onChange={setTrackerOn}
        />
      </div>
      {trackerOn && (
        <div className="stack">
          <Field label="tracker.gg API key (TRN-Api-Key)">
            <div className="row">
              <input
                className="input"
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Paste your API key"
                autoComplete="off"
                spellCheck={false}
              />
              <button className="icon-btn" onClick={() => setShowKey(!showKey)} aria-label={showKey ? 'Hide key' : 'Show key'}>
                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
              <button className="btn" onClick={runTest} disabled={testing || !apiKey.trim() || !username.trim()}>
                {testing ? 'Testing…' : 'Test'}
              </button>
            </div>
          </Field>
          {test && (
            <div className={`callout ${test.ok ? 'good' : 'error'}`}>
              {test.ok ? <CheckCircle2 size={16} /> : <TriangleAlert size={16} />}
              <div>{test.text}</div>
            </div>
          )}
          <div className="callout warn">
            <Info size={16} />
            <div>
              tracker.gg issues API keys per app, and Rocket League isn't always included. If the test fails with 401/403, use the live
              game connection instead. It's official and needs no key. The key is stored only on this PC.
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function AccountCard({ account, onEdit }: { account: Account; onEdit: () => void }) {
  const mutate = useStore((s) => s.mutate);
  const syncing = useStore((s) => !!s.syncing[account.id]);
  const allMatches = useStore((s) => s.data.matches);
  const matches = useMemo(() => allMatches.filter((m) => m.accountId === account.id), [allMatches, account.id]);
  const mmr = useStore((s) => s.data.mmr);
  const toast = useStore((s) => s.toast);
  const ranks = account.tracker.lastSnapshot?.playlists.filter((p) => p.rating !== undefined) ?? [];
  const remove = async () => {
    const ok = await confirmDialog({
      title: `Remove ${account.label}?`,
      body: 'Games already logged stay in your journal. Sync for this account stops.',
      confirmLabel: 'Remove',
      danger: true,
    });
    if (ok)
      mutate((d) => {
        d.accounts = d.accounts.filter((a) => a.id !== account.id);
      });
  };
  const syncNow = async () => {
    const err = await syncTrackerAccount(account.id);
    if (err) toast({ kind: 'error', title: `${account.label}: sync failed`, body: err });
    else toast({ kind: 'info', title: `${account.label} synced` });
  };
  const wins = matches.filter((m) => m.result === 'win').length;
  const losses = matches.filter((m) => m.result === 'loss').length;
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
              {PLATFORMS.find((p) => p.value === account.platform)?.label} · {account.username || account.inGameNames.join(', ') || '—'}
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
        <span className={`badge ${account.liveGame ? 'active' : ''}`}>
          <Radio size={12} /> Live game {account.liveGame ? 'on' : 'off'}
        </span>
        <span className={`badge ${account.tracker.enabled ? (account.tracker.lastError ? 'error' : 'blue') : ''}`}>
          tracker.gg {account.tracker.enabled ? (account.tracker.lastError ? 'error' : 'on') : 'off'}
        </span>
        {matches.length > 0 && (
          <span className="badge">
            {matches.length} tracked · {wins}W {losses}L
          </span>
        )}
      </div>
      {account.liveGame && (
        <div className="small text-2">
          Matches as: {account.inGameNames.length ? account.inGameNames.join(', ') : <span className="down">no in-game name set</span>}
          {account.primaryIds.length > 0 && <span className="muted"> · {account.primaryIds.length} linked ID{account.primaryIds.length > 1 ? 's' : ''}</span>}
        </div>
      )}
      {account.tracker.enabled && (
        <div className="stack" style={{ gap: 8 }}>
          {account.tracker.lastError && (
            <div className="callout error" style={{ padding: '8px 10px' }}>
              <TriangleAlert size={15} />
              <div className="small">{account.tracker.lastError}</div>
            </div>
          )}
          {ranks.length > 0 && (
            <div className="row wrap" style={{ gap: 6 }}>
              {ranks.slice(0, 6).map((p) => {
                const hist = mmr.filter((m) => m.accountId === account.id && m.playlist === p.name);
                const d = hist.length > 1 ? hist[hist.length - 1].rating - hist[0].rating : 0;
                return (
                  <span key={p.name} className="badge" title={[p.tier, p.division].filter(Boolean).join(' · ')}>
                    {p.name.replace('Ranked ', '')}: {p.rating}
                    {d !== 0 && <span className={d > 0 ? 'up' : 'down'}>{d > 0 ? `▲${d}` : `▼${-d}`}</span>}
                  </span>
                );
              })}
            </div>
          )}
          <div className="row between">
            <span className="muted small">
              {account.tracker.lastCheckedAt ? `Checked ${relativeTime(account.tracker.lastCheckedAt)}` : 'Not synced yet'}
            </span>
            <button className="btn small" onClick={syncNow} disabled={syncing}>
              <RefreshCw size={14} className={syncing ? 'spin' : ''} /> {syncing ? 'Syncing…' : 'Sync now'}
            </button>
          </div>
        </div>
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
        <h2>Recently synced games</h2>
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
              return (
                <tr key={m.id} className="clickable" onClick={() => s && navigate({ name: 'day', seasonId: s.id, dayId: m.dayId })}>
                  <td className="muted">
                    {formatDate(m.date)} {new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td>{m.mode}</td>
                  <td className={m.result === 'win' ? 'up' : m.result === 'loss' ? 'down' : 'muted'}>
                    {m.result === 'win' ? 'Win' : m.result === 'loss' ? (m.leftEarly ? 'Left early' : 'Loss') : 'Unknown'}
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
  const settings = useStore((s) => s.data.settings);
  const mutate = useStore((s) => s.mutate);
  const [editing, setEditing] = useState<Account | 'new' | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const trackerAccounts = accounts.filter((a) => a.tracker.enabled).length;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Accounts & Sync</h1>
          <div className="subtitle">Connect your Rocket League accounts so games are logged automatically.</div>
        </div>
        <div className="actions">
          <button className="btn primary" onClick={() => setEditing('new')}>
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
          body="Add each Rocket League account you play on. Use your in-game name so live matches can be matched to you."
          action={
            <button className="btn primary" onClick={() => setEditing('new')}>
              <Plus size={16} /> Add account
            </button>
          }
        />
      )}

      <RecentMatches />

      <div className="section-title">
        <h2>tracker.gg sync</h2>
      </div>
      <div className="card">
        <div className="row between">
          <div>
            <div style={{ fontWeight: 500 }}>Check for new games every</div>
            <div className="muted small">{trackerAccounts} account{trackerAccounts === 1 ? '' : 's'} using tracker.gg</div>
          </div>
          <Segmented
            value={String(settings.trackerPollMinutes)}
            onChange={(v) =>
              mutate((d) => {
                d.settings.trackerPollMinutes = Number(v);
              })
            }
            options={['2', '5', '10', '15', '30'].map((v) => ({ value: v, label: `${v} min` }))}
          />
        </div>
        <button className="btn ghost small" style={{ marginTop: 10 }} onClick={() => setShowAdvanced(!showAdvanced)}>
          {showAdvanced ? 'Hide' : 'Show'} advanced
        </button>
        {showAdvanced && (
          <div style={{ marginTop: 10 }}>
            <Field label="API base URL" help="Default: https://public-api.tracker.gg/v2. Requests go to {base}/rocket-league/standard/profile/{platform}/{user}.">
              <input
                className="input"
                value={settings.trackerBaseUrl}
                onChange={(e) =>
                  mutate((d) => {
                    d.settings.trackerBaseUrl = e.target.value;
                  })
                }
              />
            </Field>
          </div>
        )}
      </div>

      {editing && <AccountModal account={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
