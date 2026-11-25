// Connects to the official Rocket League Stats API (local WebSocket) and reports finished matches.
import WebSocket from 'ws';
import type { LiveMatchResult, LiveStatus } from '../shared/model';
import { MatchTracker, parseEnvelope } from './matchTracker';

export interface LiveGameCallbacks {
  onStatus: (status: LiveStatus) => void;
  onMatch: (result: LiveMatchResult) => void;
  onPlayers: (players: { name: string; primaryId?: string }[]) => void;
}

export class LiveGameClient {
  private ws: WebSocket | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private enabled = false;
  private port = 49124;
  private status: LiveStatus = { state: 'disabled' };
  private tracker: MatchTracker;

  constructor(private cb: LiveGameCallbacks) {
    this.tracker = new MatchTracker({
      onMatchFinished: (r) => this.cb.onMatch(r),
      onPlayers: (p) => this.cb.onPlayers(p),
      onMatchState: (inMatch, playlistId) => {
        if (this.status.state === 'connected') this.setStatus({ state: 'connected', inMatch, playlistId });
      },
    });
  }

  getStatus() {
    return this.status;
  }

  configure(enabled: boolean, port: number) {
    const changed = enabled !== this.enabled || port !== this.port;
    this.enabled = enabled;
    this.port = port || 49124;
    if (!changed && (this.ws || this.retryTimer)) return;
    this.teardown();
    if (enabled) this.connect();
    else this.setStatus({ state: 'disabled' });
  }

  private setStatus(s: LiveStatus) {
    this.status = s;
    this.cb.onStatus(s);
  }

  private teardown() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (this.ws) {
      this.ws.removeAllListeners();
      try {
        this.ws.terminate();
      } catch {
        /* ignore */
      }
    }
    this.ws = null;
  }

  private scheduleRetry() {
    if (!this.enabled || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, 5000);
  }

  private connect() {
    if (!this.enabled) return;
    const ws = new WebSocket(`ws://127.0.0.1:${this.port}`, { handshakeTimeout: 3000 });
    this.ws = ws;
    if (this.status.state !== 'waiting') this.setStatus({ state: 'waiting', detail: 'Waiting for Rocket League…' });
    ws.on('open', () => this.setStatus({ state: 'connected', inMatch: false }));
    ws.on('message', (buf) => {
      for (const msg of parseEnvelope(buf.toString())) {
        try {
          this.tracker.handle(msg.Event, msg.Data);
        } catch (err) {
          console.error('Stats API event failed', msg.Event, err);
        }
      }
    });
    const lost = () => {
      if (this.ws !== ws) return;
      ws.removeAllListeners();
      this.ws = null;
      if (this.enabled) {
        this.setStatus({ state: 'waiting', detail: 'Waiting for Rocket League…' });
        this.scheduleRetry();
      }
    };
    ws.on('close', lost);
    ws.on('error', lost);
  }

  stop() {
    this.enabled = false;
    this.teardown();
  }
}
