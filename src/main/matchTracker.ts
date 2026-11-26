// Turns the Rocket League Stats API event stream into finished-match results.
// Pure logic (no sockets) so it can be unit tested.
import type { LiveMatchResult, MatchPlayer } from '../shared/model';

interface CurrentMatch {
  guid?: string;
  playlistId?: number;
  arena?: string;
  players: Map<string, MatchPlayer>;
  teams: Map<number, { teamNum: number; score: number; name?: string }>;
  started: boolean;
  overtime: boolean;
  winnerTeamNum?: number;
  emitted: boolean;
  isReplay: boolean;
  /** How often each player was the camera target during live play (= the player on this PC). */
  targetVotes: Map<string, { name: string; teamNum: number; votes: number }>;
  /** Goals per team from GoalScored events: live ones only, at most one per kickoff. */
  fallbackGoals: Record<number, number>;
  /** A goal was counted since the last kickoff (a second GoalScored before the next kickoff is a replay). */
  goalSinceKickoff: boolean;
  /** A goal replay is playing (GoalReplayStart … GoalReplayEnd, or UpdateState says bReplay). */
  goalReplay: boolean;
  stateReplay: boolean;
  /** The game called the match a no contest (MatchEnded with WinnerTeamNum -1). */
  noContest: boolean;
  /** Ball touches reported with BallHit events. */
  ballHits: number;
  /** The game clock: highest and last value seen, and whether it ever ran down (it doesn't before kickoff). */
  clockMax?: number;
  clockLast?: number;
  clockMoved: boolean;
}

export interface TrackerEvents {
  onMatchFinished?: (result: LiveMatchResult) => void;
  onPlayers?: (players: { name: string; primaryId?: string }[]) => void;
  onMatchState?: (inMatch: boolean, playlistId?: number) => void;
  /** The player controlling the game on this PC, as soon as it is known (also in freeplay). */
  onLocalPlayer?: (player: { name: string; primaryId?: string }) => void;
}

const n = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export function parseEnvelope(raw: string): { Event: string; Data: any }[] {
  const out: { Event: string; Data: any }[] = [];
  const push = (obj: any) => {
    if (!obj || typeof obj.Event !== 'string') return;
    let data = obj.Data;
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch {
        /* keep as string */
      }
    }
    out.push({ Event: obj.Event, Data: data ?? {} });
  };
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) parsed.forEach(push);
    else push(parsed);
    return out;
  } catch {
    // Some transports concatenate several JSON objects; split on top-level boundaries.
    let depth = 0;
    let start = -1;
    let inStr = false;
    let esc = false;
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === '{') {
        if (depth === 0) start = i;
        depth++;
      } else if (c === '}') {
        depth--;
        if (depth === 0 && start >= 0) {
          try {
            push(JSON.parse(raw.slice(start, i + 1)));
          } catch {
            /* skip broken chunk */
          }
          start = -1;
        }
      }
    }
    return out;
  }
}

const samePlayer = (a: { name: string; primaryId?: string }, b: { name: string; primaryId?: string }) =>
  a.primaryId && b.primaryId ? a.primaryId.toLowerCase() === b.primaryId.toLowerCase() : !!a.name && a.name === b.name;

export class MatchTracker {
  private current: CurrentMatch | null = null;
  /** Who played on this PC in the last game of a lobby: a later game there without them (an Honor Duel of two others) was only watched. */
  private lobby: { guid: string; player: { name: string; primaryId?: string } } | null = null;
  private emittedKeys: string[] = [];
  private announcedPlayers = false;
  private lastLocal = '';

  constructor(private events: TrackerEvents = {}) {}

  private newMatch(guid?: string): CurrentMatch {
    this.announcedPlayers = false;
    this.current = {
      guid: guid || undefined,
      players: new Map(),
      teams: new Map(),
      started: false,
      overtime: false,
      emitted: false,
      isReplay: false,
      targetVotes: new Map(),
      fallbackGoals: {},
      goalSinceKickoff: false,
      goalReplay: false,
      stateReplay: false,
      noContest: false,
      ballHits: 0,
      clockMoved: false,
    };
    this.events.onMatchState?.(true);
    return this.current;
  }

  private ensure(guid?: string): CurrentMatch {
    const g = guid || undefined;
    if (!this.current) return this.newMatch(g);
    if (g && this.current.guid && this.current.guid !== g) return this.newMatch(g);
    if (g && !this.current.guid) this.current.guid = g;
    return this.current;
  }

  handle(event: string, data: any): LiveMatchResult | null {
    const guid: string | undefined = data?.MatchGuid || undefined;
    switch (event) {
      case 'MatchCreated':
      case 'MatchInitialized': {
        if (!this.current || (guid && this.current.guid !== guid) || this.current.emitted) this.newMatch(guid);
        return null;
      }
      case 'ReplayCreated': {
        this.ensure(guid).isReplay = true;
        return null;
      }
      case 'GoalReplayStart':
      case 'GoalReplayWillEnd': {
        this.ensure(guid).goalReplay = true;
        return null;
      }
      case 'GoalReplayEnd': {
        this.ensure(guid).goalReplay = false;
        return null;
      }
      case 'BallHit': {
        const m = this.ensure(guid);
        if (!this.replaying(m, data)) m.ballHits++;
        return null;
      }
      case 'ClockUpdatedSeconds': {
        const m = this.ensure(guid);
        if (this.replaying(m, data)) return null;
        this.clock(m, data?.TimeSeconds);
        if (data?.bOvertime) m.overtime = true;
        return null;
      }
      case 'RoundStarted':
      case 'CountdownBegin': {
        const m = this.ensure(guid);
        if (event === 'RoundStarted') m.started = true;
        // A kickoff: any replay is over and the next goal can come.
        m.goalReplay = false;
        m.stateReplay = false;
        m.goalSinceKickoff = false;
        return null;
      }
      case 'PlayerJoined': {
        const m = this.ensure(guid);
        const key = data?.PrimaryId || data?.PlayerName;
        if (key && !m.players.has(key)) {
          m.players.set(key, {
            name: String(data?.PlayerName ?? ''),
            primaryId: data?.PrimaryId || undefined,
            teamNum: -1,
            score: 0,
            goals: 0,
            assists: 0,
            saves: 0,
            shots: 0,
            demos: 0,
          });
        }
        return null;
      }
      case 'UpdateState': {
        let m = this.ensure(guid);
        const game = data?.Game ?? {};
        if (typeof game.PlaylistId === 'number') {
          // Same lobby, different playlist after the match ended (e.g. an Honor Duel): a new game.
          if (m.emitted && m.playlistId !== undefined && m.playlistId !== game.PlaylistId) m = this.newMatch(guid);
          m.playlistId = game.PlaylistId;
        }
        if (game.Arena) m.arena = String(game.Arena);
        m.stateReplay = !!game.bReplay;
        if (!game.bReplay) this.clock(m, game.TimeSeconds);
        if (game.bReplay && !m.started) m.isReplay = true;
        m.overtime = m.overtime || !!game.bOvertime;
        for (const t of game.Teams ?? []) {
          m.teams.set(n(t.TeamNum), { teamNum: n(t.TeamNum), score: n(t.Score), name: t.Name });
        }
        if (game.bHasWinner && game.Winner) {
          const winner = [...m.teams.values()].find((t) => t.name === game.Winner);
          if (winner) m.winnerTeamNum = winner.teamNum;
        }
        for (const p of data?.Players ?? []) {
          const key = p.PrimaryId || p.Name;
          if (!key) continue;
          m.players.set(key, {
            name: String(p.Name ?? ''),
            primaryId: p.PrimaryId || undefined,
            teamNum: n(p.TeamNum, -1),
            score: n(p.Score),
            goals: n(p.Goals),
            assists: n(p.Assists),
            saves: n(p.Saves),
            shots: n(p.Shots),
            demos: n(p.Demos),
            touches: typeof p.Touches === 'number' ? p.Touches : undefined,
          });
        }
        const target = game.bHasTarget ? game.Target : undefined;
        if (target && typeof target.Name === 'string' && target.Name && !game.bReplay && !m.isReplay) {
          const key = `${target.Name}|${n(target.TeamNum, -1)}`;
          const v = m.targetVotes.get(key) ?? { name: target.Name, teamNum: n(target.TeamNum, -1), votes: 0 };
          v.votes++;
          m.targetVotes.set(key, v);
          const local = this.watching(m) ? undefined : this.localPlayer(m);
          const id = local ? `${local.name}|${local.primaryId ?? ''}` : '';
          if (local && id !== this.lastLocal) {
            this.lastLocal = id;
            this.events.onLocalPlayer?.({ name: local.name, primaryId: local.primaryId });
          }
        }
        if (!this.announcedPlayers && m.players.size > 0) {
          this.announcedPlayers = true;
          this.events.onPlayers?.([...m.players.values()].map((p) => ({ name: p.name, primaryId: p.primaryId })));
          this.events.onMatchState?.(true, m.playlistId);
        }
        return null;
      }
      case 'GoalScored': {
        // Counted to catch a last goal the state updates miss. The game sends GoalScored again when a
        // goal replay shows the goal, so replays are skipped, and so is any second goal before the next
        // kickoff (there's always a kickoff between two real goals).
        const m = this.ensure(guid);
        const team = data?.Scorer?.TeamNum;
        if (typeof team !== 'number' || this.replaying(m, data) || m.goalSinceKickoff) return null;
        m.goalSinceKickoff = true;
        m.fallbackGoals[team] = (m.fallbackGoals[team] ?? 0) + 1;
        return null;
      }
      case 'MatchEnded': {
        const m = this.ensure(guid);
        const w = data?.WinnerTeamNum;
        // -1: the game called it a no contest (e.g. a player never joined).
        if (w === -1) m.noContest = true;
        else if (typeof w === 'number' && w >= 0) m.winnerTeamNum = w;
        return this.finish(m, false);
      }
      case 'MatchDestroyed': {
        const m = this.current;
        let result: LiveMatchResult | null = null;
        // Leaving a started online match before it ended counts as a loss.
        if (m && !m.emitted && m.started) result = this.finish(m, true);
        this.current = null;
        this.events.onMatchState?.(false);
        return result;
      }
      default:
        return null;
    }
  }

  /** Is a replay playing right now (events during replays repeat what already happened)? */
  private replaying(m: CurrentMatch, data: any): boolean {
    return m.goalReplay || m.stateReplay || data?.bReplay === true;
  }

  private clock(m: CurrentMatch, seconds: unknown) {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return;
    // Overtime: after running down to 0:00 the clock counts up again a second at a time. (A jump back to
    // the full time, e.g. when the lobby resets, isn't overtime.)
    if (m.clockMoved && m.clockLast !== undefined && m.clockLast <= 1 && seconds > m.clockLast + 0.5 && seconds < 60) m.overtime = true;
    m.clockMax = Math.max(m.clockMax ?? seconds, seconds);
    if (m.clockMax - seconds >= 3) m.clockMoved = true;
    m.clockLast = seconds;
  }

  /**
   * Did the game actually get going? A match cancelled before kickoff (e.g. a player failed to
   * join) has no touches, goals, points or clock time.
   */
  private played(m: CurrentMatch, teams: { score: number }[]): boolean {
    if (m.ballHits > 0 || m.clockMoved) return true;
    if (teams.some((t) => t.score > 0) || Object.values(m.fallbackGoals).some((g) => g > 0)) return true;
    return [...m.players.values()].some((p) => (p.touches ?? 0) > 0 || p.score > 0 || p.goals > 0 || p.shots > 0 || p.saves > 0 || p.demos > 0);
  }

  /**
   * A later game in the same lobby (same match id) that the player from this PC isn't in: they're
   * watching it, like an Honor Duel between two others. The camera then follows someone else.
   */
  private watching(m: CurrentMatch): boolean {
    const lobby = this.lobby;
    if (!lobby || !m.guid || m.guid !== lobby.guid) return false;
    const all = [...m.players.values()];
    // Only the players on a team play; anyone else in the list is watching too.
    const onTeam = all.filter((p) => p.teamNum === 0 || p.teamNum === 1);
    const playing = onTeam.length ? onTeam : all;
    return playing.length > 0 && !playing.some((p) => samePlayer(p, lobby.player));
  }

  /** The player the camera followed most during live play: that's whoever plays on this PC. */
  private localPlayer(m: CurrentMatch): { name: string; primaryId?: string; teamNum: number } | undefined {
    let best: { name: string; teamNum: number; votes: number } | undefined;
    for (const v of m.targetVotes.values()) if (!best || v.votes > best.votes) best = v;
    if (!best) return undefined;
    const b = best;
    const players = [...m.players.values()];
    const p = players.find((x) => x.name === b.name && x.teamNum === b.teamNum) ?? players.find((x) => x.name === b.name);
    return { name: b.name, primaryId: p?.primaryId, teamNum: p && p.teamNum >= 0 ? p.teamNum : b.teamNum };
  }

  private finish(m: CurrentMatch, leftEarly: boolean): LiveMatchResult | null {
    if (m.emitted || m.isReplay) return null;
    m.emitted = true;
    // Only online / LAN matches carry a match id: freeplay, training and offline games never count.
    if (!m.guid) return null;
    // An Honor Duel can follow a match in the same lobby, so the playlist is part of the key.
    const key = `${m.guid}|${m.playlistId ?? ''}`;
    if (this.emittedKeys.includes(key)) return null;
    this.emittedKeys.push(key);
    if (this.emittedKeys.length > 100) this.emittedKeys.shift();
    let teams = [...m.teams.values()].map((t) => ({ ...t }));
    if (!teams.length && Object.keys(m.fallbackGoals).length) {
      teams = [0, 1].map((t) => ({ teamNum: t, score: m.fallbackGoals[t] ?? 0 }));
    } else {
      // The last goal can come after the last state update (an overtime goal ends the game at once).
      // Only that one goal can be missing, so the goal count can add one goal at most.
      for (const t of teams) if ((m.fallbackGoals[t.teamNum] ?? 0) === t.score + 1) t.score++;
    }
    // A tie with a winner: the overtime goal was missed. (Not when time was left: that's a forfeit.)
    const winner = leftEarly ? undefined : teams.find((t) => t.teamNum === m.winnerTeamNum);
    const timeLeft = !m.overtime && (m.clockLast ?? 0) > 0;
    if (winner && !timeLeft && teams.length === 2 && teams.every((t) => t.score === winner.score)) {
      winner.score++;
      m.overtime = true;
    }
    const notStarted = m.noContest || !this.played(m, teams);
    const spectated = !notStarted && this.watching(m);
    const localPlayer = spectated ? undefined : this.localPlayer(m);
    if (localPlayer && !notStarted) this.lobby = { guid: m.guid, player: { name: localPlayer.name, primaryId: localPlayer.primaryId } };
    const result: LiveMatchResult = {
      guid: m.guid,
      endedAt: new Date().toISOString(),
      playlistId: m.playlistId,
      arena: m.arena,
      winnerTeamNum: leftEarly ? undefined : m.winnerTeamNum,
      leftEarly,
      overtime: m.overtime,
      teams,
      players: [...m.players.values()],
      localPlayer,
      ...(spectated ? { spectated: true } : {}),
      ...(notStarted ? { notStarted: true } : {}),
    };
    this.events.onMatchFinished?.(result);
    return result;
  }
}
