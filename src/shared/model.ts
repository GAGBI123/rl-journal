// Core data model shared by the main and renderer processes.

export type Measure = 'time' | 'amount';
export type TimeUnit = 'min' | 'hr';
export type Platform = 'epic' | 'steam' | 'psn' | 'xbl' | 'switch' | 'other';

/** Current save-file schema. Older files are migrated in normalizeData(). */
export const DATA_VERSION = 2;

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
  /**
   * Stable id for game modes the live game connection logs to ("ranked-3s", "honor-duel", …).
   * Lets the user rename an activity without breaking automatic logging.
   */
  key?: string;
  /** Position inside its section (lower = first). */
  order: number;
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
  /** Wins among the games of this entry whose result is known. */
  wins?: number;
  /** Losses among the games of this entry whose result is known. */
  losses?: number;
  /** Optional description of what was done (e.g. "aerials, flicks"). */
  note?: string;
  createdAt: string;
  /** Set when (part of) the entry was added by the live game connection. */
  auto?: { source: 'game'; accountId?: string };
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

export interface Account {
  id: string;
  label: string;
  platform: Platform;
  /** In-game names used to find you in live matches. */
  inGameNames: string[];
  /** Platform IDs ("Epic|abc|0") seen in live matches and linked to this account. */
  primaryIds: string[];
  /** Log this account's matches automatically. */
  liveGame: boolean;
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
  source: 'game';
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

export interface LocalPlayer {
  name: string;
  primaryId?: string;
}

export interface Settings {
  favorites: string[];
  liveGameEnabled: boolean;
  liveGamePort: number;
  ignorePrivateMatches: boolean;
  /** Record wins and losses for auto-logged games (all modes except Honor Duel). */
  trackResultsGames: boolean;
  /** Record wins and losses for auto-logged Honor Duels. */
  trackResultsHonorDuel: boolean;
  systemNotifications: boolean;
  closeToTray: boolean;
  /** Start when the user logs in (Windows and Linux). */
  startWithWindows: boolean;
  /** Download and install updates by itself. Off: only tell the user. */
  autoUpdate: boolean;
  /** Players seen in the last live match, used for "that's me" linking. */
  lastMatchPlayers?: LocalPlayer[];
  /** The player last seen controlling the game on this PC. */
  lastLocalPlayer?: LocalPlayer;
  /** App version that last opened this file (used for the "updated" message). */
  lastRunVersion?: string;
}

export interface AppData {
  version: number;
  seasons: Season[];
  sections: Section[];
  activities: Activity[];
  accounts: Account[];
  matches: MatchRecord[];
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
  /** The player controlling the game on this PC (the camera target), when known. */
  localPlayer?: { name: string; primaryId?: string; teamNum: number };
}

export type LiveStatus =
  | { state: 'disabled' }
  | { state: 'waiting'; detail?: string }
  | { state: 'connected'; inMatch: boolean; playlistId?: number; player?: LocalPlayer };

export interface StatsApiSetupResult {
  ok: boolean;
  path?: string;
  message: string;
  needsRestart?: boolean;
}

export type UpdateStatus =
  | { state: 'unsupported'; reason: string }
  | { state: 'idle'; lastCheck?: string }
  | { state: 'checking' }
  | { state: 'none'; lastCheck: string }
  | { state: 'available'; version: string; notes?: string }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'downloaded'; version: string; notes?: string }
  | { state: 'installing'; version: string }
  | { state: 'error'; message: string };
