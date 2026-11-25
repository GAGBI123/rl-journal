import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, BarChart3, Bell, CheckCircle2, House, Info, Link2, ListChecks, Moon, RotateCcw, Settings, TriangleAlert, X } from 'lucide-react';
import { useStore, type View } from './store';
import { ConfirmHost } from './components/ui';
import { TimerPill } from './components/TimerPill';
import { HomePage } from './pages/HomePage';
import { SeasonPage } from './pages/SeasonPage';
import { DayPage } from './pages/DayPage';
import { StatsPage } from './pages/StatsPage';
import { AccountsPage } from './pages/AccountsPage';
import { SettingsPage } from './pages/SettingsPage';
import { RoutinesPage } from './pages/RoutinesPage';
import { canEndDay, currentDate, dayForDate, dayNumber, findSeason, reopenableDate, seasonLabel } from './lib/journal';
import { endCurrentDay, reopenEndedDay } from './components/DayTools';
import { relativeTime, todayISO } from './lib/dates';
import { playlistInfo } from '../shared/playlists';
import { accountForPlayer } from './lib/sync';

function Sidebar() {
  const view = useStore((s) => s.view);
  const navigate = useStore((s) => s.navigate);
  const data = useStore((s) => s.data);
  const calendarToday = todayISO();
  const cur = currentDate(data.settings, calendarToday);
  const today = dayForDate(data, cur);
  const endable = canEndDay(data.settings, calendarToday);
  const reopenable = !endable && reopenableDate(data.settings, calendarToday);
  const items: { icon: typeof House; label: string; view: View; match: View['name'][] }[] = [
    { icon: House, label: 'Seasons', view: { name: 'home' }, match: ['home', 'season', 'day'] },
    { icon: ListChecks, label: 'Routines', view: { name: 'routines' }, match: ['routines'] },
    { icon: BarChart3, label: 'Statistics', view: { name: 'stats' }, match: ['stats'] },
    { icon: Link2, label: 'Accounts & Sync', view: { name: 'accounts' }, match: ['accounts'] },
    { icon: Settings, label: 'Settings', view: { name: 'settings' }, match: ['settings'] },
  ];
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <span />
        </div>
        <div className="brand-name">
          RL Journal
          <small>TRAIN · PLAY · TRACK</small>
        </div>
      </div>
      <nav className="nav">
        {items.map((it) => (
          <button
            key={it.label}
            className={`nav-item ${it.match.includes(view.name) ? 'active' : ''}`}
            onClick={() => navigate(it.view)}
          >
            <it.icon size={18} />
            {it.label}
          </button>
        ))}
      </nav>
      <div className="sidebar-footer">
        {today && (
          <button
            className="season-mini"
            onClick={() => navigate({ name: 'day', seasonId: today.season.id, dayId: today.day.id })}
            title={cur === calendarToday ? 'Open today' : 'Open the current day (games are logged to it until you end it)'}
          >
            <div className="label">{cur === calendarToday ? 'Today' : 'Current day'}</div>
            <div className="title">
              {seasonLabel(today.season)} · Day {dayNumber(today.season, today.day)}
            </div>
            <div className="progress">
              <div style={{ width: `${Math.min(100, (dayNumber(today.season, today.day) / Math.max(1, today.season.days.length)) * 100)}%` }} />
            </div>
          </button>
        )}
        {today && endable && (
          <button className="btn small end-day-btn" onClick={() => void endCurrentDay()} title="Done for the day: games you play from now on go to the next day">
            <Moon size={14} /> End day
          </button>
        )}
        {today && reopenable && (
          <button className="btn small ghost end-day-btn" onClick={reopenEndedDay} title="Log games to the day you ended again">
            <RotateCcw size={14} /> Reopen previous day
          </button>
        )}
      </div>
    </aside>
  );
}

function LivePill() {
  const status = useStore((s) => s.liveStatus);
  const navigate = useStore((s) => s.navigate);
  const accounts = useStore((s) => s.data.accounts);
  const lastPlayer = useStore((s) => s.data.settings.lastLocalPlayer);
  if (status.state === 'disabled') return null;
  // The account playing on this PC: from the game right now, or the last one seen.
  const player = status.state === 'connected' ? status.player ?? lastPlayer : undefined;
  const who = player ? accountForPlayer(accounts, player)?.label ?? player.name : '';
  let label: string;
  if (status.state === 'waiting') label = 'Game: waiting';
  else if (status.inMatch && status.playlistId === undefined) label = `In match${who ? ` · ${who}` : ''}`;
  else if (status.inMatch) {
    const info = playlistInfo(status.playlistId);
    const where = status.playlistId === undefined ? '' : info.kind === 'practice' ? info.mode : `${info.mode}`;
    label = info.kind === 'practice' ? `${where || 'Training'}${who ? ` · ${who}` : ''}` : `In match${where ? ` · ${where}` : ''}${who ? ` · ${who}` : ''}`;
  } else label = `Game connected${who ? ` · ${who}` : ''}`;
  return (
    <button className={`status-pill ${status.state}`} onClick={() => navigate({ name: 'accounts' })} title={who ? `Live game connection · playing as ${who}` : 'Live game connection'}>
      <span className={`pill-dot ${status.state === 'connected' && status.inMatch ? 'pulse' : ''}`} />
      {label}
    </button>
  );
}

function UpdatePill() {
  const update = useStore((s) => s.update);
  const navigate = useStore((s) => s.navigate);
  if (update.state === 'available' || update.state === 'downloaded') {
    return (
      <div className="update-banner" title={update.state === 'downloaded' ? 'Restart to finish updating' : 'A new version is available'}>
        <span className="clickable" onClick={() => navigate({ name: 'settings' })}>
          Update {update.version}
        </span>
        <button onClick={() => window.rlj.installUpdate()}>{update.state === 'downloaded' ? 'Restart' : 'Install'}</button>
      </div>
    );
  }
  if (update.state === 'installing') return <div className="update-banner">Updating…</div>;
  return null;
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const notifications = useStore((s) => s.data.notifications);
  const mutate = useStore((s) => s.mutate);
  const navigate = useStore((s) => s.navigate);
  const unread = notifications.filter((n) => !n.read).length;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  const toggle = () => {
    setOpen(!open);
  };
  const markAll = () =>
    mutate((d) => {
      d.notifications.forEach((n) => (n.read = true));
    });
  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button className="icon-btn" onClick={toggle} aria-label="Notifications" title="Notifications">
        <Bell size={17} />
        {unread > 0 && <span className="dot">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="popover">
          <div className="p-head">
            <b>Notifications</b>
            <div className="row">
              {unread > 0 && (
                <button className="btn ghost small" onClick={markAll}>
                  Mark all read
                </button>
              )}
              {notifications.length > 0 && (
                <button
                  className="btn ghost small"
                  onClick={() =>
                    mutate((d) => {
                      d.notifications = [];
                    })
                  }
                >
                  Clear
                </button>
              )}
            </div>
          </div>
          {notifications.length === 0 && <div className="muted small" style={{ padding: '10px 10px 16px' }}>No notifications yet. Synced games will show up here.</div>}
          {notifications.slice(0, 40).map((n) => (
            <div
              key={n.id}
              className={`notif ${n.kind} ${n.read ? '' : 'unread'}`}
              onClick={() => {
                mutate((d) => {
                  const x = d.notifications.find((y) => y.id === n.id);
                  if (x) x.read = true;
                });
                if (n.target) {
                  const season = findSeason(useStore.getState().data, n.target.seasonId);
                  if (season) {
                    const day = n.target.dayId && season.days.find((x) => x.id === n.target!.dayId);
                    navigate(day ? { name: 'day', seasonId: season.id, dayId: day.id } : { name: 'season', seasonId: season.id });
                  }
                  setOpen(false);
                }
              }}
            >
              <div className="n-icon">
                {n.kind === 'error' ? <TriangleAlert size={15} /> : n.kind === 'sync' ? <CheckCircle2 size={15} /> : <Info size={15} />}
              </div>
              <div style={{ minWidth: 0 }}>
                <div className="n-title">{n.title}</div>
                <div className="n-body">{n.body}</div>
                <div className="tiny muted">{relativeTime(n.at)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TopBar() {
  const view = useStore((s) => s.view);
  const history = useStore((s) => s.history);
  const back = useStore((s) => s.back);
  const data = useStore((s) => s.data);
  const crumbs = useMemo(() => {
    const out: string[] = [];
    if (view.name === 'home') out.push('Seasons');
    if (view.name === 'season' || view.name === 'day') {
      const s = findSeason(data, view.seasonId);
      out.push('Seasons');
      if (s) out.push(seasonLabel(s));
      if (view.name === 'day' && s) {
        const d = s.days.find((x) => x.id === view.dayId);
        if (d) out.push(`Day ${dayNumber(s, d)}`);
      }
    }
    if (view.name === 'routines') out.push('Routines');
    if (view.name === 'stats') out.push('Statistics');
    if (view.name === 'accounts') out.push('Accounts & Sync');
    if (view.name === 'settings') out.push('Settings');
    return out;
  }, [view, data]);
  return (
    <header className="topbar">
      {history.length > 0 && view.name !== 'home' && (
        <button className="icon-btn" onClick={back} aria-label="Back" title="Back">
          <ArrowLeft size={17} />
        </button>
      )}
      <div className="crumbs">
        {crumbs.map((c, i) => (
          <span key={i} className="row" style={{ gap: 6 }}>
            {i > 0 && <span>/</span>}
            {i === crumbs.length - 1 ? <b>{c}</b> : c}
          </span>
        ))}
      </div>
      <div className="spacer" />
      <UpdatePill />
      <TimerPill />
      <LivePill />
      <Notifications />
    </header>
  );
}

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  const navigate = useStore((s) => s.navigate);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast ${t.kind} ${t.view ? 'clickable' : ''}`}
          onClick={() => {
            if (t.view) navigate(t.view);
            dismiss(t.id);
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="t-title">{t.title}</div>
            {t.body && <div className="t-body">{t.body}</div>}
          </div>
          <button
            className="icon-btn"
            style={{ width: 24, height: 24 }}
            onClick={(e) => {
              e.stopPropagation();
              dismiss(t.id);
            }}
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

class PageErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error('Page crashed', error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page">
        <div className="callout error">
          <TriangleAlert size={16} />
          <div>
            <b>Something went wrong on this page.</b> Your data is safe.
            <div className="tiny muted" style={{ marginTop: 4 }}>{String(this.state.error.message)}</div>
            <button className="btn small" style={{ marginTop: 10 }} onClick={() => useStore.getState().navigate({ name: 'home' })}>
              Back to seasons
            </button>
          </div>
        </div>
      </div>
    );
  }
}

function CurrentPage() {
  const view = useStore((s) => s.view);
  switch (view.name) {
    case 'home':
      return <HomePage />;
    case 'season':
      return <SeasonPage key={view.seasonId} seasonId={view.seasonId} />;
    case 'day':
      return <DayPage key={view.dayId} seasonId={view.seasonId} dayId={view.dayId} />;
    case 'stats':
      return <StatsPage initialSeasonId={view.seasonId} />;
    case 'routines':
      return <RoutinesPage />;
    case 'accounts':
      return <AccountsPage />;
    case 'settings':
      return <SettingsPage />;
  }
}

export function App() {
  const loaded = useStore((s) => s.loaded);
  const view = useStore((s) => s.view);
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [view]);
  if (!loaded) return <div className="splash">Loading your journal…</div>;
  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <TopBar />
        <main className="content" ref={contentRef}>
          <PageErrorBoundary key={JSON.stringify(view)}>
            <CurrentPage />
          </PageErrorBoundary>
        </main>
      </div>
      <Toasts />
      <ConfirmHost />
    </div>
  );
}
