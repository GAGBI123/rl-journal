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
}

export interface TrackerEvents {
  onMatchFinished?: (result: LiveMatchResult) => void;
  onPlayers?: (players: { name: string; primaryId?: string }[]) => void;
  onMatchState?: (inMatch: boolean, playlistId?: number) => void;
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
  private emittedGuids: string[] = [];
  private announcedPlayers = false;

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
        const m = this.ensure(guid);
        const game = data?.Game ?? {};
        if (typeof game.PlaylistId === 'number') m.playlistId = game.PlaylistId;
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
        if (!this.announcedPlayers && m.players.size > 0) {
          this.announcedPlayers = true;
          this.events.onPlayers?.([...m.players.values()].map((p) => ({ name: p.name, primaryId: p.primaryId })));
          this.events.onMatchState?.(true, m.playlistId);
        }
        return null;
      }
      case 'GoalScored': {
        // Keep team scores roughly in sync even when UpdateState is disabled.
        const m = this.ensure(guid);
        const team = data?.Scorer?.TeamNum;
        if (typeof team === 'number' && !m.teams.size) {
          // Only used as a fallback when no UpdateState arrives.
          (m as any)._goals = (m as any)._goals ?? {};
          (m as any)._goals[team] = ((m as any)._goals[team] ?? 0) + 1;
        }
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
        if (m && !m.emitted && m.started) result = this.finish(m, true);
        this.current = null;
        this.events.onMatchState?.(false);
        return result;
      }
      default:
        return null;
    }
  }

  private finish(m: CurrentMatch, leftEarly: boolean): LiveMatchResult | null {
    if (m.emitted || m.isReplay) return null;
    m.emitted = true;
    if (m.guid) {
      if (this.emittedGuids.includes(m.guid)) return null;
      this.emittedGuids.push(m.guid);
      if (this.emittedGuids.length > 100) this.emittedGuids.shift();
    }
    let teams = [...m.teams.values()];
    const fallbackGoals = (m as any)._goals as Record<number, number> | undefined;
    if (!teams.length && fallbackGoals) {
      teams = [0, 1].map((t) => ({ teamNum: t, score: fallbackGoals[t] ?? 0 }));
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
    };
    this.events.onMatchFinished?.(result);
    return result;
  }
}
