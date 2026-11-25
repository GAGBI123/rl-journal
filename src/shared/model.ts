// Core data model shared by the main and renderer processes.

export type Measure = 'time' | 'amount';
export type TimeUnit = 'min' | 'hr';
export type Platform = 'epic' | 'steam' | 'psn' | 'xbl' | 'switch';
export type SyncSource = 'game' | 'tracker';

export interface Section {
  id: string;
  name: string;
  color: string;
  /** Built-in sections (Training, Games) can be renamed but not deleted. */
  builtIn?: boolean;
  /** Marks the section whose amount-entries count as "games" (enables wins). */
  kind?: 'training' | 'games' | 'other';
  order: number;
}

export interface Activity {
  id: string;
  sectionId: string;
  name: string;
  defaultMeasure: Measure;
  defaultUnit: TimeUnit;
  builtIn?: boolean;
  createdAt: string;
}

export interface Entry {
  id: string;
  activityId: string;
  measure: Measure;
  /** Stored in minutes when measure === 'time'. */
  minutes?: number;
  /** The unit the user typed the time in (display only). */
  unit?: TimeUnit;
  /** Count when measure === 'amount'. */
  amount?: number;
  /** Optional wins for game entries. */
  wins?: number;
  /**
   * Optional explicit losses. When absent, losses = amount - wins.
   * Auto-synced entries set it so games with unknown results don't skew win rate.
   */
  losses?: number;
  note?: string;
  createdAt: string;
  /** Set when the entry was created by an automatic sync. */
  auto?: { source: SyncSource; accountId?: string };
}

export interface Day {
  id: string;
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  entries: Entry[];
  note?: string;
}

export interface Season {
  id: string;
  number: number;
  name?: string;
  startDate: string;
  status: 'active' | 'closed';
  closedAt?: string;
  createdAt: string;
  days: Day[];
}

export interface TrackerPlaylistStat {
  name: string;
  matchesPlayed: number;
  rating?: number;
  tier?: string;
  division?: string;
}

export interface TrackerSnapshot {
  at: string;
  playlists: TrackerPlaylistStat[];
  overview: Record<string, number>;
}

export interface Account {
  id: string;
  label: string;
  platform: Platform;
  /** Platform username / Epic display name / Steam ID used by tracker.gg. */
  username: string;
  /** In-game names used to find you in live matches (Stats API). */
  inGameNames: string[];
  /** Platform IDs ("Epic|abc|0") seen in live matches and linked to this account. */
  primaryIds: string[];
  liveGame: boolean;
  tracker: {
    enabled: boolean;
    apiKey: string;
    lastSnapshot?: TrackerSnapshot;
    lastCheckedAt?: string;
    lastError?: string;
  };
  color: string;
  createdAt: string;
}

export interface MatchPlayer {
  name: string;
  primaryId?: string;
  teamNum: number;
  score: number;
  goals: number;
  assists: number;
  saves: number;
  shots: number;
  demos: number;
  touches?: number;
}

/** A single game recorded by the live game connection. */
export interface MatchRecord {
  id: string;
  guid?: string;
  at: string;
  date: string;
  seasonId: string;
  dayId: string;
  entryId: string;
  activityId: string;
  accountId?: string;
  playlistId?: number;
  mode: string;
  arena?: string;
  result: 'win' | 'loss' | 'unknown';
  leftEarly?: boolean;
  me?: MatchPlayer;
  teamScore?: number;
  opponentScore?: number;
  overtime?: boolean;
  source: SyncSource;
}

export interface MmrPoint {
  accountId: string;
  playlist: string;
  rating: number;
  tier?: string;
  division?: string;
  at: string;
}

export interface AppNotification {
  id: string;
  at: string;
  title: string;
  body: string;
  read: boolean;
  kind: 'sync' | 'info' | 'error';
  /** Optional navigation target. */
  target?: { seasonId: string; dayId?: string };
}

export interface Settings {
  favorites: string[];
  trackerPollMinutes: number;
  liveGameEnabled: boolean;
  liveGamePort: number;
  ignorePrivateMatches: boolean;
  countCasualAsRanked: boolean;
  systemNotifications: boolean;
  closeToTray: boolean;
  startWithWindows: boolean;
  trackerBaseUrl: string;
  /** Players seen in the last live match, used for "that's me" linking. */
  lastMatchPlayers?: { name: string; primaryId?: string }[];
}

export interface AppData {
  version: 1;
  seasons: Season[];
  sections: Section[];
  activities: Activity[];
  accounts: Account[];
  matches: MatchRecord[];
  mmr: MmrPoint[];
  notifications: AppNotification[];
  settings: Settings;
}

/** Payload sent from the main process when a live match finishes. */
export interface LiveMatchResult {
  guid?: string;
  endedAt: string;
  playlistId?: number;
  arena?: string;
  winnerTeamNum?: number;
  leftEarly: boolean;
  overtime: boolean;
  teams: { teamNum: number; score: number; name?: string }[];
  players: MatchPlayer[];
}

export type LiveStatus =
  | { state: 'disabled' }
  | { state: 'waiting'; detail?: string }
  | { state: 'connected'; inMatch: boolean; playlistId?: number };

export type TrackerFetchResult =
  | { ok: true; snapshot: TrackerSnapshot }
  | { ok: false; status?: number; error: string };

export interface StatsApiSetupResult {
  ok: boolean;
  path?: string;
  message: string;
  needsRestart?: boolean;
}
