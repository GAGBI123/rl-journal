// Applies finished live-game matches to the journal.
// All functions mutate the given draft and return what happened, for notifications.
import type { Account, AppData, AppNotification, LiveMatchResult, LocalPlayer, MatchPlayer, Platform } from '../../shared/model';
import { playlistInfo } from '../../shared/playlists';
import { isoFromTimestamp } from './dates';
import { uid } from './format';
import { addToDay, currentDate, dayNumber, ensureSyncDay, findOrCreateActivity, gamesSection, SECTION_COLORS, seasonLabel } from './journal';

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

const same = (a?: string, b?: string) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/** The account a player belongs to (by linked platform id first, then by in-game name). */
export function accountForPlayer(accounts: Account[], p: LocalPlayer | undefined): Account | undefined {
  if (!p) return undefined;
  return (
    (p.primaryId && accounts.find((a) => a.primaryIds.some((id) => same(id, p.primaryId)))) ||
    accounts.find((a) => a.inGameNames.some((n) => same(n, p.name)))
  );
}

/** Find which configured account (if any) played in this match, by names / ids only. */
export function identifyMe(accounts: Account[], players: MatchPlayer[]): { account: Account; player: MatchPlayer } | null {
  for (const account of accounts.filter((a) => a.liveGame)) {
    const player = players.find((p) => accountForPlayer([account], p));
    if (player) return { account, player };
  }
  return null;
}

export function platformFromId(primaryId?: string): Platform {
  const p = (primaryId ?? '').split('|')[0].toLowerCase();
  if (p === 'epic') return 'epic';
  if (p === 'steam') return 'steam';
  if (p.startsWith('ps')) return 'psn';
  if (p.startsWith('xbox')) return 'xbl';
  if (p === 'switch') return 'switch';
  return 'other';
}

/**
 * Who played this match on this PC. The game reports the player the camera follows (you),
 * which is matched to an account. A player seen for the first time becomes a new account.
 */
function resolveMe(
  data: AppData,
  result: LiveMatchResult,
  honorDuel = false,
): { account?: Account; player?: MatchPlayer; created?: boolean; watched?: string } {
  const local = result.localPlayer;
  if (local) {
    const player =
      result.players.find((p) => (local.primaryId && same(p.primaryId, local.primaryId)) || (same(p.name, local.name) && p.teamNum === local.teamNum)) ??
      ({ name: local.name, primaryId: local.primaryId, teamNum: local.teamNum, score: 0, goals: 0, assists: 0, saves: 0, shots: 0, demos: 0 } as MatchPlayer);
    const id = local.primaryId ?? player.primaryId;
    let account = accountForPlayer(data.accounts, { name: local.name, primaryId: id });
    let created = false;
    // Honor Duels are played in a lobby after a match, where friends watch them. The camera then
    // follows one of the players, so an unknown player there is someone else, not a new account.
    if (!account && honorDuel && data.accounts.some((a) => a.liveGame)) {
      const me = identifyMe(data.accounts, result.players);
      return me ? { account: me.account, player: me.player } : { watched: local.name || 'Someone else' };
    }
    if (!account) {
      account = {
        id: uid(),
        label: local.name || 'My account',
        platform: platformFromId(id),
        inGameNames: local.name ? [local.name] : [],
        primaryIds: id ? [id] : [],
        liveGame: true,
        color: SECTION_COLORS[data.accounts.length % SECTION_COLORS.length],
        createdAt: new Date().toISOString(),
      };
      data.accounts.push(account);
      created = true;
    } else {
      // Remember the platform id / current name so renames keep matching.
      if (id && !account.primaryIds.some((x) => same(x, id))) account.primaryIds.push(id);
      if (local.name && !account.inGameNames.some((n) => same(n, local.name))) account.inGameNames.push(local.name);
      if (account.platform === 'other' && id) account.platform = platformFromId(id);
    }
    return { account, player, created };
  }
  const me = identifyMe(data.accounts, result.players);
  return me ? { account: me.account, player: me.player } : {};
}

export function applyLiveMatch(data: AppData, result: LiveMatchResult): SyncOutcome {
  const settings = data.settings;
  const info = playlistInfo(result.playlistId);
  // Only online / LAN matches have a match id. Freeplay, training and offline games never count.
  if (!result.guid || info.kind === 'practice') return { logged: false };
  // Watching someone else's game (e.g. an Honor Duel between two others in the lobby) never counts.
  if (result.spectated) return { logged: false };
  if (info.kind === 'private' && settings.ignorePrivateMatches) return { logged: false };
  if (data.matches.some((m) => m.guid === result.guid && m.playlistId === result.playlistId)) return { logged: false };

  if (result.players.length) {
    settings.lastMatchPlayers = result.players.map((p) => ({ name: p.name, primaryId: p.primaryId }));
  }
  const { account, player, created, watched } = resolveMe(data, result, !!info.honorDuel);
  if (watched) {
    // Only in the bell, no pop-up: most likely the user was watching a friend's duel.
    notify(data, {
      kind: 'info',
      title: 'Honor Duel not logged',
      body: `${watched} played it, and that's not one of your accounts, so you were probably watching. If it was you, add that name to your account in Accounts.`,
    });
    return { logged: false };
  }
  if (account && !account.liveGame) return { logged: false };
  if (account && player) {
    const local = result.localPlayer;
    settings.lastLocalPlayer = local ? { name: local.name, primaryId: local.primaryId ?? player.primaryId } : { name: player.name, primaryId: player.primaryId };
  }

  let outcome: 'win' | 'loss' | 'unknown' = 'unknown';
  let teamScore: number | undefined;
  let opponentScore: number | undefined;
  if (player && player.teamNum >= 0) {
    const mine = result.teams.find((t) => t.teamNum === player.teamNum);
    const theirs = result.teams.find((t) => t.teamNum !== player.teamNum);
    teamScore = mine?.score;
    opponentScore = theirs?.score;
    if (result.leftEarly) outcome = 'loss';
    else if (result.winnerTeamNum !== undefined && result.winnerTeamNum >= 0) outcome = result.winnerTeamNum === player.teamNum ? 'win' : 'loss';
    else if (teamScore !== undefined && opponentScore !== undefined && teamScore !== opponentScore) outcome = teamScore > opponentScore ? 'win' : 'loss';
  }
  const trackResults = info.honorDuel ? settings.trackResultsHonorDuel : settings.trackResultsGames;
  if (!trackResults) outcome = 'unknown';

  // The current day: with "End days yourself" a game after midnight still goes to the day that's open.
  const played = isoFromTimestamp(result.endedAt);
  const date = currentDate(settings, played);
  if (settings.endDayManually) settings.openDay = date;
  const target = ensureSyncDay(data, date);
  if (!target) {
    const n = notify(data, {
      kind: 'error',
      title: 'Game not logged',
      body: `A ${info.mode} game finished, but there is no active season for ${date}. Create or reopen a season.`,
    });
    return { logged: false, notification: n };
  }
  const activity = findOrCreateActivity(data, gamesSection(data).id, info.mode, 'amount', info.key);
  const { entry } = addToDay(target.day, {
    activityId: activity.id,
    measure: 'amount',
    amount: 1,
    ...(trackResults ? { wins: outcome === 'win' ? 1 : 0, losses: outcome === 'loss' ? 1 : 0 } : {}),
    auto: { source: 'game', accountId: account?.id },
  });

  data.matches.push({
    id: uid(),
    guid: result.guid,
    at: result.endedAt,
    date,
    seasonId: target.season.id,
    dayId: target.day.id,
    entryId: entry.id,
    activityId: activity.id,
    accountId: account?.id,
    playlistId: result.playlistId,
    mode: activity.name,
    arena: result.arena,
    result: outcome,
    leftEarly: result.leftEarly || undefined,
    me: player,
    teamScore,
    opponentScore,
    overtime: result.overtime || undefined,
    source: 'game',
  });

  const score = teamScore !== undefined && opponentScore !== undefined ? ` ${teamScore}–${opponentScore}` : '';
  const res =
    outcome === 'win' ? `Win${score}` : outcome === 'loss' ? (result.leftEarly ? 'Left early (loss)' : `Loss${score}`) : score ? `Score${score}` : 'Game';
  const who = account ? ` · ${account.label}` : '';
  const open = date < played ? ' (the day is still open)' : date > played ? ' (next day: today was ended)' : '';
  const n = notify(data, {
    kind: 'sync',
    title: `${activity.name} game logged`,
    body: `${res}${who} → ${seasonLabel(target.season)}, Day ${dayNumber(target.season, target.day)}${target.created ? ' (day added)' : ''}${open}`,
    target: { seasonId: target.season.id, dayId: target.day.id },
  });
  if (created && account) {
    notify(data, {
      kind: 'info',
      title: `New account: ${account.label}`,
      body: 'Detected from the game and added to Accounts. Rename it there if you like.',
    });
  }
  return { logged: true, notification: n };
}
