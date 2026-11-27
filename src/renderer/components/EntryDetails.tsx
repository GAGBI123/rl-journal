// 1.10: an entry opened on the day page: each game (tracked match) or each session, with notes.
import { useEffect, useRef, useState } from 'react';
import { ArrowRightLeft, Check, Hand, ListChecks, NotebookPen, Pencil, Timer, TimerReset, Trash2, Trophy, X } from 'lucide-react';
import { useStore } from '../store';
import { activityById, deleteSession, entryAccountParts, entrySessions, inRecord, matchInRecord, setMatchNote, updateSession } from '../lib/journal';
import { fmtMinutes, fmtNum } from '../lib/format';
import { confirmDialog, NumberInput } from './ui';
import type { Account, Day, Entry, EntrySession, MatchRecord, Season, SessionSource } from '../../shared/model';

/** A logged game with no sign of play: most likely a match that was cancelled before kickoff. */
export const looksNotStarted = (m: MatchRecord) =>
  !!m.me && !m.me.touches && !m.me.score && !m.me.goals && !m.me.shots && !m.me.saves && !m.teamScore && !m.opponentScore;

/** The tracked games of an entry, in the order they were played. */
export const entryMatches = (matches: MatchRecord[], entry: Entry) =>
  matches.filter((m) => m.entryId === entry.id).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

const SOURCES: Record<SessionSource, { label: string; icon: typeof Timer }> = {
  timer: { label: 'Timer', icon: Timer },
  stopwatch: { label: 'Stopwatch', icon: TimerReset },
  routine: { label: 'Routine', icon: ListChecks },
  hand: { label: 'Added', icon: Hand },
};

/** "8:05 PM": the time only (never the date, also for games played after midnight on an open day). */
function when(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** A note under a game or session: click to write or change it; Enter saves, Esc cancels. */
function NoteLine(props: { note?: string; editing: boolean; setEditing: (v: boolean) => void; onSave: (note: string) => void; placeholder: string }) {
  const [draft, setDraft] = useState(props.note ?? '');
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (props.editing) {
      setDraft(props.note ?? '');
      requestAnimationFrame(() => {
        const el = ref.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      });
    }
  }, [props.editing]);
  if (props.editing) {
    const save = () => {
      props.setEditing(false);
      if (draft.trim() !== (props.note ?? '').trim()) props.onSave(draft);
    };
    return (
      <div className="ed-note-edit">
        <textarea
          ref={ref}
          className="input"
          rows={1}
          value={draft}
          placeholder={props.placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              save();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              props.setEditing(false);
            }
          }}
        />
        <span className="tiny muted">Enter saves · Shift + Enter for a new line · Esc cancels</span>
      </div>
    );
  }
  if (!props.note) return null;
  return (
    <button type="button" className="ed-note" title="Change the note" onClick={() => props.setEditing(true)}>
      {props.note}
    </button>
  );
}

function GameRow(props: {
  m: MatchRecord;
  n: number;
  account?: Account;
  showAccount: boolean;
  showRecord: boolean;
  onDelete: (m: MatchRecord) => void;
}) {
  const { m } = props;
  const data = useStore((s) => s.data);
  const mutate = useStore((s) => s.mutate);
  const [noting, setNoting] = useState(false);
  const counts = matchInRecord(data, m);
  const result = m.result === 'win' ? 'Win' : m.result === 'loss' ? (m.leftEarly ? 'Forfeit' : 'Loss') : 'Unknown';
  const score = m.teamScore !== undefined ? `${m.teamScore}–${m.opponentScore ?? 0}${m.overtime ? ' OT' : ''}` : '';
  return (
    <div className="ed-row">
      <div className="ed-line">
        <span className="ed-n">#{props.n}</span>
        <span className="ed-time">{when(m.at)}</span>
        {props.showAccount && (
          <span className="acct-dot" style={props.account ? { ['--acct' as any]: props.account.color } : undefined} title={props.account?.label ?? 'Unknown account'} />
        )}
        {props.showRecord ? (
          <span
            className={`ed-result ${!counts ? 'muted' : m.result === 'win' ? 'up' : m.result === 'loss' ? 'down' : 'muted'}`}
            title={counts ? undefined : 'Private match: not counted in your wins and losses (Settings → Games & logging)'}
          >
            {m.result === 'win' && <Trophy size={12} />} {result}
            {score && <span className="ed-score">{score}</span>}
          </span>
        ) : (
          <span className="ed-result muted">{activityById(data, m.activityId)?.name ?? m.mode}</span>
        )}
        {m.me ? (
          <span className="ed-stats" title="Your points, then goals / assists / saves / shots">
            <b>{fmtNum(m.me.score)}</b> pts <span className="muted">·</span> {m.me.goals}/{m.me.assists}/{m.me.saves}/{m.me.shots}
          </span>
        ) : (
          <span className="ed-stats muted">No stats</span>
        )}
        {looksNotStarted(m) && (
          <span className="badge suspect" title="No touches, points or goals: this match probably never started (e.g. it was cancelled). Delete it if it wasn't a real game.">
            Didn't start?
          </span>
        )}
        <span className="ed-actions">
          <button className={`icon-btn ${m.note ? 'has-note' : ''}`} title={m.note ? 'Change the note' : 'Add a note about this game'} aria-label="Note about this game" onClick={() => setNoting(true)}>
            <NotebookPen size={14} />
          </button>
          <button className="icon-btn" title="Delete this game (not yours, cancelled, …)" aria-label="Delete this game" onClick={() => props.onDelete(m)}>
            <Trash2 size={14} />
          </button>
        </span>
      </div>
      <NoteLine
        note={m.note}
        editing={noting}
        setEditing={setNoting}
        placeholder="How did this game go? e.g. lost kickoffs, good saves…"
        onSave={(note) => mutate((d) => void setMatchNote(d, m.id, note))}
      />
    </div>
  );
}

function SessionRow(props: {
  s: EntrySession;
  n: number;
  season: Season;
  day: Day;
  entry: Entry;
  /** Games added by hand to a game entry (counted, no timer). */
  games: boolean;
  canMove: boolean;
  onMove: (s: EntrySession) => void;
}) {
  const { s, entry } = props;
  const mutate = useStore((st) => st.mutate);
  const [noting, setNoting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const time = entry.measure === 'time';
  const fmt = (v: number) => (time ? fmtMinutes(v) : `${fmtNum(v, 2)}${props.games ? (v === 1 ? ' game' : ' games') : ''}`);
  const src = SOURCES[s.by ?? 'hand'] ?? SOURCES.hand;
  const Icon = src.icon;
  const num = Number(value || 0);
  const valid = value !== '' && num > 0 && (!props.games || Number.isInteger(num));
  const where = { seasonId: props.season.id, dayId: props.day.id };

  const startEdit = () => {
    setValue(String(+s.value.toFixed(2)));
    setEditing(true);
  };
  const save = () => {
    if (!valid) return;
    setEditing(false);
    if (num !== s.value) mutate((d) => void updateSession(d, where.seasonId, where.dayId, entry.id, s.id, { value: num }));
  };
  const remove = async () => {
    const left = (time ? entry.minutes ?? 0 : entry.amount ?? 0) - s.value;
    const ok = await confirmDialog({
      title: `Delete this ${fmt(s.value)} session?`,
      body: left > 0 ? `It comes off the day: ${fmt(left)} left in this entry.` : 'It was all of this entry, so the entry goes away.',
      confirmLabel: 'Delete session',
      danger: true,
    });
    if (ok) mutate((d) => void deleteSession(d, where.seasonId, where.dayId, entry.id, s.id));
  };

  return (
    <div className="ed-row">
      <div className="ed-line">
        <span className="ed-n">#{props.n}</span>
        <span className="ed-time">{when(s.at)}</span>
        <span className="ed-src" title={src.label === 'Added' ? 'Added by hand' : `From a ${src.label.toLowerCase()}`}>
          <Icon size={12} /> {src.label}
        </span>
        {editing ? (
          <span className="ed-value-edit">
            <NumberInput value={value} onChange={setValue} onEnter={save} invalid={!valid} autoFocus />
            <span className="muted small">{time ? 'min' : props.games ? 'games' : ''}</span>
            <button className="icon-btn" title="Save" aria-label="Save" onClick={save} disabled={!valid}>
              <Check size={14} />
            </button>
            <button className="icon-btn" title="Cancel" aria-label="Cancel" onClick={() => setEditing(false)}>
              <X size={14} />
            </button>
          </span>
        ) : (
          <span className="ed-value">{fmt(s.value)}</span>
        )}
        <span className="ed-actions">
          <button className={`icon-btn ${s.note ? 'has-note' : ''}`} title={s.note ? 'Change the note' : 'Add a note about this session'} aria-label="Note about this session" onClick={() => setNoting(true)}>
            <NotebookPen size={14} />
          </button>
          {!editing && (
            <button className="icon-btn" title={time ? 'Change the minutes' : 'Change the amount'} aria-label="Edit this session" onClick={startEdit}>
              <Pencil size={14} />
            </button>
          )}
          {props.canMove && (
            <button className="icon-btn" title="Move this session to another day" aria-label="Move this session" onClick={() => props.onMove(s)}>
              <ArrowRightLeft size={14} />
            </button>
          )}
          <button className="icon-btn" title="Delete this session" aria-label="Delete this session" onClick={remove}>
            <Trash2 size={14} />
          </button>
        </span>
      </div>
      <NoteLine
        note={s.note}
        editing={noting}
        setEditing={setNoting}
        placeholder="What did you work on? e.g. flicks off the wall…"
        onSave={(note) => mutate((d) => void updateSession(d, where.seasonId, where.dayId, entry.id, s.id, { note }))}
      />
    </div>
  );
}

/** What's inside an entry: its account totals (merged game entries), its games and its sessions. */
export function EntryDetails(props: {
  season: Season;
  day: Day;
  entry: Entry;
  games: boolean;
  showRecord: boolean;
  onDeleteMatch: (m: MatchRecord) => void;
  onMoveSession: (s: EntrySession) => void;
}) {
  const { entry, day } = props;
  const data = useStore((s) => s.data);
  const accountOf = (id?: string): Account | undefined => (id ? data.accounts.find((a) => a.id === id) : undefined);
  const matches = entryMatches(data.matches, entry);
  const sessions = entrySessions(entry);
  const { parts } = entry.auto ? entryAccountParts(data, entry) : { parts: [] };
  const counts = inRecord(data, entry.activityId);
  const multiAccount = new Set(matches.map((m) => m.accountId ?? '')).size > 1;
  // Games added by hand before 1.10 (or to a game entry without a session list): only a count.
  // Games and sessions numbered in the order they were played (#1 = first), the latest at the top.
  const rows = [...matches.map((m) => ({ m, s: undefined, at: m.at })), ...sessions.map((s) => ({ m: undefined, s, at: s.at }))]
    .map((r, i) => ({ ...r, t: Date.parse(r.at) || 0, i }))
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .map((r, i) => ({ ...r, n: i + 1 }))
    .reverse();
  const handLeft =
    entry.measure === 'amount' && entry.auto ? Math.max(0, (entry.amount ?? 0) - matches.length - sessions.reduce((a, s) => a + s.value, 0)) : 0;

  return (
    <div className="entry-details">
      {multiAccount && parts.length > 1 && (
        <div className="ed-accounts">
          {parts.map((p) => {
            const acc = accountOf(p.accountId);
            return (
              <span key={p.accountId ?? '-'} style={acc ? { ['--acct' as any]: acc.color } : undefined}>
                <span className="acct-dot" /> {acc?.label ?? 'Unknown account'} <span className="muted">· {fmtNum(p.games)}</span>
                {props.showRecord && counts && p.wins + p.losses > 0 && (
                  <span className="small">
                    {' '}
                    <span className="up">{p.wins}W</span> <span className="down">{p.losses}L</span>
                  </span>
                )}
              </span>
            );
          })}
        </div>
      )}
      {rows.map(({ m, s, n }) =>
        m ? (
          <GameRow
            key={m.id}
            m={m}
            n={n}
            account={accountOf(m.accountId)}
            showAccount={multiAccount}
            showRecord={props.showRecord}
            onDelete={props.onDeleteMatch}
          />
        ) : (
          <SessionRow
            key={s!.id}
            s={s!}
            n={n}
            season={props.season}
            day={day}
            entry={entry}
            games={props.games}
            canMove={sessions.length > 1 || matches.length > 0}
            onMove={props.onMoveSession}
          />
        ),
      )}
      {handLeft > 0 && (
        <div className="ed-row">
          <div className="ed-line">
            <span className="ed-n" />
            <span className="ed-src">
              <Hand size={12} /> Added by hand
            </span>
            <span className="ed-value">
              {fmtNum(handLeft)} {props.games ? (handLeft === 1 ? 'game' : 'games') : ''}
            </span>
          </div>
        </div>
      )}
      {!matches.length && !sessions.length && !handLeft && <div className="muted small">Nothing in it yet.</div>}
    </div>
  );
}
