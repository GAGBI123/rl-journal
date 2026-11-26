// Ending the current day ("End days yourself") and moving an entry to another day.
import { useState } from 'react';
import { useStore } from '../store';
import {
  activityById,
  canEndDay,
  currentDate,
  dayForDate,
  dayNumber,
  endDay,
  entrySessions,
  findSeason,
  moveEntry,
  reopenDay,
  seasonLabel,
  sectionOfActivity,
  type MovePart,
} from '../lib/journal';
import { addDays, formatDate, todayISO } from '../lib/dates';
import { fmtMinutes, fmtNum } from '../lib/format';
import { confirmDialog, Field, Modal, NumberInput } from './ui';
import type { Day, Entry, MatchRecord, Season } from '../../shared/model';

const longDate = (iso: string) => formatDate(iso, { weekday: 'long', month: 'short', day: 'numeric' });

/** Ask, then end the current day: games after that go to the next day. */
export async function endCurrentDay() {
  const { data, mutate, toast } = useStore.getState();
  const today = todayISO();
  if (!canEndDay(data.settings, today)) return;
  const date = currentDate(data.settings, today);
  const hit = dayForDate(data, date);
  const name = hit ? `Day ${dayNumber(hit.season, hit.day)}` : 'the day';
  const nextDate = addDays(date, 1);
  const ok = await confirmDialog({
    title: `End ${name}?`,
    body: `Games you play from now on are logged to the next day (${longDate(nextDate)}). If you end it by mistake, you can reopen it.`,
    confirmLabel: 'End day',
  });
  if (!ok) return;
  mutate((d) => void endDay(d, todayISO()));
  const next = dayForDate(useStore.getState().data, nextDate);
  toast({
    kind: 'success',
    title: `${name === 'the day' ? 'Day' : name} ended`,
    body: next ? `Games now go to Day ${dayNumber(next.season, next.day)} (${longDate(nextDate)}).` : `Games now go to the next day (${longDate(nextDate)}).`,
    view: next ? { name: 'day', seasonId: next.season.id, dayId: next.day.id } : undefined,
  });
}

/** Make the day that was just ended the current day again. */
export function reopenEndedDay() {
  const { mutate, toast } = useStore.getState();
  let ok = false;
  mutate((d) => void (ok = reopenDay(d, todayISO())));
  if (ok) toast({ kind: 'info', title: 'Day reopened', body: 'Games are logged to it again until you end it.' });
}

const resultLabel = (m: MatchRecord) => (m.result === 'win' ? 'Win' : m.result === 'loss' ? (m.leftEarly ? 'Left early' : 'Loss') : 'Unknown');
const toInt = (v: string) => (v.trim() === '' ? 0 : Math.floor(Number(v)));

/** Move an entry, or part of it (some of its sessions, or one), to another day. */
export function MoveEntryModal({ season, day, entry, sessionId, onClose }: { season: Season; day: Day; entry: Entry; sessionId?: string; onClose: () => void }) {
  const data = useStore((s) => s.data);
  const mutate = useStore((s) => s.mutate);
  const toast = useStore((s) => s.toast);
  const activity = activityById(data, entry.activityId);
  const isGames = sectionOfActivity(data, entry.activityId)?.kind === 'games';
  const showRecord = !day.hideRecord;
  const cur = currentDate(data.settings);

  // This season first, then the others, newest first.
  const seasons = [season, ...data.seasons.filter((s) => s.id !== season.id).sort((a, b) => (a.startDate < b.startDate ? 1 : -1))];
  const idx = season.days.findIndex((d) => d.id === day.id);
  const suggested = season.days[idx + 1] ?? season.days[idx - 1];
  const [target, setTarget] = useState(suggested ? `${season.id}|${suggested.id}` : '');

  const total = entry.measure === 'time' ? entry.minutes ?? 0 : entry.amount ?? 0;
  const [minutes, setMinutes] = useState(String(+(entry.minutes ?? 0).toFixed(2)));

  // Games from the live connection, oldest first: pick which ones go.
  const tracked = data.matches.filter((m) => m.entryId === entry.id).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const [picked, setPicked] = useState<Set<string>>(() => new Set(tracked.map((m) => m.id)));
  const hasRecord = entry.wins !== undefined || entry.losses !== undefined;
  // The rest of the entry was added by hand.
  const handTotal = Math.max(0, (entry.amount ?? 0) - tracked.length);
  const handWinsMax = Math.max(0, Math.min(handTotal, (entry.wins ?? 0) - tracked.filter((m) => m.result === 'win').length));
  const handLossesMax = Math.max(0, Math.min(handTotal - handWinsMax, (entry.losses ?? 0) - tracked.filter((m) => m.result === 'loss').length));
  const [hand, setHand] = useState(String(handTotal));
  const [handWins, setHandWins] = useState(String(handWinsMax));
  const [handLosses, setHandLosses] = useState(String(handLossesMax));
  // An entry logged in several sessions (and no tracked games): pick which sessions go. One session
  // can also be moved from the entry's list on the day page.
  const sessions = entrySessions(entry);
  const bySession = !!sessionId || (sessions.length > 1 && !tracked.length);
  const [pickedSessions, setPickedSessions] = useState<Set<string>>(() => new Set(sessionId ? [sessionId] : sessions.map((s) => s.id)));
  const fmtValue = (v: number) => (entry.measure === 'time' ? fmtMinutes(v) : `${fmtNum(v, 2)}${isGames ? (v === 1 ? ' game' : ' games') : ''}`);

  let part: MovePart;
  let invalid = false;
  let resultsTooMany = false;
  let what: string;
  if (bySession) {
    const sum = sessions.filter((s) => pickedSessions.has(s.id)).reduce((a, s) => a + s.value, 0);
    invalid = sum <= 0;
    part = { sessionIds: [...pickedSessions] };
    what = fmtValue(sum);
  } else if (entry.measure === 'time') {
    const m = Number(minutes || 0);
    invalid = !(m > 0) || m > total + 1e-9;
    part = { minutes: m };
    what = fmtMinutes(m);
  } else {
    const sel = tracked.filter((m) => picked.has(m.id));
    const h = toInt(hand);
    const hw = hasRecord && showRecord ? toInt(handWins) : h >= handTotal ? handWinsMax : 0;
    const hl = hasRecord && showRecord ? toInt(handLosses) : h >= handTotal ? handLossesMax : 0;
    resultsTooMany = hw + hl > h;
    invalid = h < 0 || h > handTotal || hw > handWinsMax || hl > handLossesMax || resultsTooMany;
    const amount = sel.length + h;
    if (amount <= 0) invalid = true;
    part = {
      amount,
      wins: sel.filter((m) => m.result === 'win').length + hw,
      losses: sel.filter((m) => m.result === 'loss').length + hl,
      matchIds: sel.map((m) => m.id),
    };
    what = isGames ? `${fmtNum(amount)} game${amount === 1 ? '' : 's'}` : fmtNum(amount);
  }
  if (!target) invalid = true;

  const submit = () => {
    if (invalid) return;
    const [seasonId, dayId] = target.split('|');
    let moved = false;
    mutate((d) => {
      moved = !!moveEntry(d, { seasonId: season.id, dayId: day.id }, entry.id, { seasonId, dayId }, part);
    });
    onClose();
    if (!moved) return;
    const s = findSeason(useStore.getState().data, seasonId);
    const to = s?.days.find((x) => x.id === dayId);
    toast({
      kind: 'success',
      title: `Moved ${what} ${activity?.name ?? ''}`.trim(),
      body: s && to ? `To ${seasonLabel(s)}, Day ${dayNumber(s, to)} (${longDate(to.date)}).` : undefined,
      view: s && to ? { name: 'day', seasonId: s.id, dayId: to.id } : undefined,
    });
  };

  const toggle = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };

  return (
    <Modal
      title={`Move ${activity?.name ?? 'entry'}`}
      subtitle="Move it to another day. It's added to what that day already has."
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={invalid} onClick={submit}>
            Move {what}
          </button>
        </>
      }
    >
      <Field label="To">
        <select className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
          {seasons.map((s) => (
            <optgroup key={s.id} label={seasonLabel(s)}>
              {s.days
                .filter((d) => d.id !== day.id)
                .map((d) => (
                  <option key={d.id} value={`${s.id}|${d.id}`}>
                    Day {dayNumber(s, d)} · {formatDate(d.date, { weekday: 'short', month: 'short', day: 'numeric' })}
                    {d.date === cur && s.status === 'active' ? ' (current day)' : ''}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </Field>

      {bySession && (
        <Field
          label={
            <span className="row between" style={{ width: '100%' }}>
              <span>
                Sessions · {pickedSessions.size} of {sessions.length}
              </span>
              {sessions.length > 1 && (
                <span className="row" style={{ gap: 4 }}>
                  <button type="button" className="crumb-btn" onClick={() => setPickedSessions(new Set(sessions.map((s) => s.id)))}>
                    All
                  </button>
                  <span className="muted">·</span>
                  <button type="button" className="crumb-btn" onClick={() => setPickedSessions(new Set())}>
                    None
                  </button>
                </span>
              )}
            </span>
          }
        >
          <div className="move-list">
            {sessions.map((s) => (
              <label key={s.id} className={`move-row ${pickedSessions.has(s.id) ? 'on' : ''}`}>
                <input
                  type="checkbox"
                  checked={pickedSessions.has(s.id)}
                  onChange={() => {
                    const next = new Set(pickedSessions);
                    if (next.has(s.id)) next.delete(s.id);
                    else next.add(s.id);
                    setPickedSessions(next);
                  }}
                />
                <span className="move-time">{new Date(s.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                <b>{fmtValue(s.value)}</b>
                <span className="muted move-arena">{s.note ?? ''}</span>
              </label>
            ))}
          </div>
        </Field>
      )}

      {!bySession && entry.measure === 'time' && (
        <Field label="Minutes to move" help={`of ${fmtMinutes(total)}`}>
          <NumberInput value={minutes} onChange={setMinutes} invalid={invalid && minutes !== ''} onEnter={submit} autoFocus />
        </Field>
      )}

      {!bySession && entry.measure === 'amount' && tracked.length > 0 && (
        <Field
          label={
            <span className="row between" style={{ width: '100%' }}>
              <span>
                Tracked games · {picked.size} of {tracked.length}
              </span>
              <span className="row" style={{ gap: 4 }}>
                <button type="button" className="crumb-btn" onClick={() => setPicked(new Set(tracked.map((m) => m.id)))}>
                  All
                </button>
                <span className="muted">·</span>
                <button type="button" className="crumb-btn" onClick={() => setPicked(new Set())}>
                  None
                </button>
              </span>
            </span>
          }
        >
          <div className="move-list">
            {tracked.map((m) => (
              <label key={m.id} className={`move-row ${picked.has(m.id) ? 'on' : ''}`}>
                <input type="checkbox" checked={picked.has(m.id)} onChange={() => toggle(m.id)} />
                <span className="move-time">{new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                {showRecord && (
                  <span className={m.result === 'win' ? 'up' : m.result === 'loss' ? 'down' : 'muted'}>
                    {resultLabel(m)}
                    {m.teamScore !== undefined ? ` ${m.teamScore}–${m.opponentScore ?? 0}` : ''}
                  </span>
                )}
                <span className="muted move-arena">{m.arena ?? ''}</span>
              </label>
            ))}
          </div>
        </Field>
      )}

      {!bySession && entry.measure === 'amount' && handTotal > 0 && (
        <Field label={tracked.length ? 'Games added by hand' : isGames ? 'Games to move' : 'Amount to move'}>
          <div className="move-counts">
            <div>
              <NumberInput value={hand} onChange={setHand} invalid={toInt(hand) > handTotal} onEnter={submit} autoFocus={!tracked.length} />
              <div className="help">{isGames || tracked.length ? 'games' : 'amount'}, of {fmtNum(handTotal)}</div>
            </div>
            {hasRecord && showRecord && handWinsMax + handLossesMax > 0 && (
              <>
                <div>
                  <NumberInput value={handWins} onChange={setHandWins} invalid={toInt(handWins) > handWinsMax || resultsTooMany} onEnter={submit} />
                  <div className="help">wins, of {handWinsMax}</div>
                </div>
                <div>
                  <NumberInput value={handLosses} onChange={setHandLosses} invalid={toInt(handLosses) > handLossesMax || resultsTooMany} onEnter={submit} />
                  <div className="help">losses, of {handLossesMax}</div>
                </div>
              </>
            )}
          </div>
          {resultsTooMany && <div className="help down">More wins and losses than games.</div>}
        </Field>
      )}
    </Modal>
  );
}
