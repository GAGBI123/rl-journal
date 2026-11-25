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
  fallbackGoals: Record<number, number>;
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

export class MatchTracker {
  private current: CurrentMatch | null = null;
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
      case 'RoundStarted':
      case 'CountdownBegin': {
        const m = this.ensure(guid);
        if (event === 'RoundStarted') m.started = true;
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
          const local = this.localPlayer(m);
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
        // Fallback score keeping for when UpdateState never arrives.
        const m = this.ensure(guid);
        const team = data?.Scorer?.TeamNum;
        if (typeof team === 'number') m.fallbackGoals[team] = (m.fallbackGoals[team] ?? 0) + 1;
        return null;
      }
      case 'MatchEnded': {
        const m = this.ensure(guid);
        if (typeof data?.WinnerTeamNum === 'number') m.winnerTeamNum = data.WinnerTeamNum;
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
    let teams = [...m.teams.values()];
    if (!teams.length && Object.keys(m.fallbackGoals).length) {
      teams = [0, 1].map((t) => ({ teamNum: t, score: m.fallbackGoals[t] ?? 0 }));
    }
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
      localPlayer: this.localPlayer(m),
    };
    this.events.onMatchFinished?.(result);
    return result;
  }
}
