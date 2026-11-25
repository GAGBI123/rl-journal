// Applies automatic sync results (live game matches, tracker.gg snapshots) to the journal.
// All functions mutate the given draft and return what happened, for notifications.
import type { Account, AppData, AppNotification, LiveMatchResult, MatchPlayer, TrackerSnapshot } from '../../shared/model';
import { playlistInfo, trackerPlaylistToMode } from '../../shared/playlists';
import { isoFromTimestamp } from './dates';
import { uid } from './format';
import { dayNumber, ensureSyncDay, findOrCreateActivity, gamesSection, newEntry, seasonLabel } from './journal';

export interface SyncOutcome {
  logged: boolean;
  notification?: AppNotification;
}

function notify(data: AppData, n: Omit<AppNotification, 'id' | 'at' | 'read'>): AppNotification {
  const full: AppNotification = { id: uid(), at: new Date().toISOString(), read: false, ...n };
  data.notifications.unshift(full);
  if (data.notifications.length > 150) data.notifications.length = 150;
  return full;
}

/** Find which configured account (if any) played in this match. */
export function identifyMe(accounts: Account[], players: MatchPlayer[]): { account: Account; player: MatchPlayer } | null {
  const candidates = accounts.filter((a) => a.liveGame);
  for (const account of candidates) {
    const ids = new Set(account.primaryIds.map((x) => x.toLowerCase()));
    const names = new Set(account.inGameNames.map((x) => x.trim().toLowerCase()).filter(Boolean));
    const player = players.find(
      (p) => (p.primaryId && ids.has(p.primaryId.toLowerCase())) || names.has(p.name.trim().toLowerCase()),
    );
    if (player) return { account, player };
  }
  return null;
}

function addGames(
  data: AppData,
  date: string,
  mode: string,
  count: number,
  source: 'game' | 'tracker',
  accountId: string | undefined,
  result?: 'win' | 'loss' | 'unknown',
) {
  const target = ensureSyncDay(data, date);
  if (!target) return null;
  const section = gamesSection(data);
  const activity = findOrCreateActivity(data, section.id, mode, 'amount');
  let entry = target.day.entries.find(
    (e) => e.auto?.source === source && e.auto.accountId === accountId && e.activityId === activity.id && e.measure === 'amount',
  );
  if (!entry) {
    entry = newEntry({
      activityId: activity.id,
      measure: 'amount',
      amount: 0,
      ...(source === 'game' ? { wins: 0, losses: 0 } : {}),
      auto: { source, accountId },
    });
    target.day.entries.push(entry);
  }
  entry.amount = (entry.amount ?? 0) + count;
  if (result === 'win') entry.wins = (entry.wins ?? 0) + 1;
  if (result === 'loss') entry.losses = (entry.losses ?? 0) + 1;
  return { ...target, activity, entry };
}

export function applyLiveMatch(data: AppData, result: LiveMatchResult): SyncOutcome {
  const settings = data.settings;
  const info = playlistInfo(result.playlistId, settings.countCasualAsRanked);
  if (info.private && settings.ignorePrivateMatches) return { logged: false };
  if (result.guid && data.matches.some((m) => m.guid === result.guid)) return { logged: false };

  const me = identifyMe(data.accounts, result.players);
  if (result.players.length) {
    settings.lastMatchPlayers = result.players.map((p) => ({ name: p.name, primaryId: p.primaryId }));
  }
  let outcome: 'win' | 'loss' | 'unknown' = 'unknown';
  let teamScore: number | undefined;
  let opponentScore: number | undefined;
  if (me && me.player.teamNum >= 0) {
    const mine = result.teams.find((t) => t.teamNum === me.player.teamNum);
    const theirs = result.teams.find((t) => t.teamNum !== me.player.teamNum);
    teamScore = mine?.score;
    opponentScore = theirs?.score;
    if (result.leftEarly) outcome = 'loss';
    else if (result.winnerTeamNum !== undefined) outcome = result.winnerTeamNum === me.player.teamNum ? 'win' : 'loss';
  }

  const date = isoFromTimestamp(result.endedAt);
  const added = addGames(data, date, info.mode, 1, 'game', me?.account.id, outcome);
  if (!added) {
    const n = notify(data, {
      kind: 'error',
      title: 'Game not logged',
      body: `A ${info.mode} game finished, but there is no active season for ${date}. Create or reopen a season.`,
    });
    return { logged: false, notification: n };
  }
  data.matches.push({
    id: uid(),
    guid: result.guid,
    at: result.endedAt,
    date,
    seasonId: added.season.id,
    dayId: added.day.id,
    entryId: added.entry.id,
    activityId: added.activity.id,
    accountId: me?.account.id,
    playlistId: result.playlistId,
    mode: info.mode,
    arena: result.arena,
    result: outcome,
    leftEarly: result.leftEarly || undefined,
    me: me?.player,
    teamScore,
    opponentScore,
    overtime: result.overtime || undefined,
    source: 'game',
  });

  const score = teamScore !== undefined && opponentScore !== undefined ? ` ${teamScore}–${opponentScore}` : '';
  const res = outcome === 'win' ? `Win${score}` : outcome === 'loss' ? (result.leftEarly ? 'Left early' : `Loss${score}`) : 'Result unknown';
  const who = me ? ` · ${me.account.label}` : '';
  const n = notify(data, {
    kind: 'sync',
    title: `${info.mode} game logged`,
    body: `${res}${who} → ${seasonLabel(added.season)}, Day ${dayNumber(added.season, added.day)}${added.created ? ' (day added)' : ''}`,
    target: { seasonId: added.season.id, dayId: added.day.id },
  });
  return { logged: true, notification: n };
}

export function applyTrackerSnapshot(data: AppData, accountId: string, snap: TrackerSnapshot): SyncOutcome {
  const account = data.accounts.find((a) => a.id === accountId);
  if (!account) return { logged: false };
  const prev = account.tracker.lastSnapshot;
  account.tracker.lastSnapshot = snap;
  account.tracker.lastCheckedAt = snap.at;
  account.tracker.lastError = undefined;

  // Rank / MMR history (only store changes).
  for (const p of snap.playlists) {
    if (p.rating === undefined) continue;
    const last = [...data.mmr].reverse().find((m) => m.accountId === accountId && m.playlist === p.name);
    if (!last || last.rating !== p.rating) {
      data.mmr.push({ accountId, playlist: p.name, rating: p.rating, tier: p.tier, division: p.division, at: snap.at });
    }
  }

  if (!prev) {
    const n = notify(data, {
      kind: 'info',
      title: `${account.label} connected to tracker.gg`,
      body: account.liveGame
        ? 'Rank tracking is on. Games for this account come from the live game connection.'
        : 'Starting point saved. New games will be added to your season automatically.',
    });
    return { logged: false, notification: n };
  }
  // When the live game connection covers this account, tracker.gg is only used for rank,
  // otherwise every game would be counted twice.
  if (account.liveGame) return { logged: false };

  const date = isoFromTimestamp(snap.at);
  const parts: string[] = [];
  let total = 0;
  let target: ReturnType<typeof addGames> = null;
  for (const p of snap.playlists) {
    const before = prev.playlists.find((x) => x.name === p.name);
    if (!before) continue;
    const delta = p.matchesPlayed - before.matchesPlayed;
    // Negative = new competitive season reset; huge = data glitch. Both are skipped.
    if (delta <= 0 || delta > 150) continue;
    const mode = trackerPlaylistToMode(p.name, data.settings.countCasualAsRanked);
    if (!mode) continue;
    const added = addGames(data, date, mode, delta, 'tracker', accountId);
    if (!added) {
      const n = notify(data, {
        kind: 'error',
        title: 'Games not logged',
        body: `tracker.gg reported ${delta} new ${mode} game(s) for ${account.label}, but there is no active season for today.`,
      });
      return { logged: false, notification: n };
    }
    target = added;
    total += delta;
    parts.push(`${mode} ×${delta}`);
  }
  if (!total || !target) return { logged: false };
  const n = notify(data, {
    kind: 'sync',
    title: `${total} new game${total === 1 ? '' : 's'} from ${account.label}`,
    body: `${parts.join(', ')} → ${seasonLabel(target.season)}, Day ${dayNumber(target.season, target.day)}`,
    target: { seasonId: target.season.id, dayId: target.day.id },
  });
  return { logged: true, notification: n };
}
