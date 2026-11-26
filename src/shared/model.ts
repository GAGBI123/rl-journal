// Core data model shared by the main and renderer processes.

export type Measure = 'time' | 'amount';
export type Platform = 'epic' | 'steam' | 'psn' | 'xbl' | 'switch' | 'other';

/** Current save-file schema. Older files are migrated in normalizeData(). */
export const DATA_VERSION = 3;

export interface Section {
  id: string;
  name: string;
  color: string;
  /** Built-in sections (Training, Games) can be renamed but not deleted. */
  builtIn?: boolean;
  /** Marks the section whose amount-entries count as "games" (enables wins). Sub-sections copy their top section's kind. */
  kind?: 'training' | 'games' | 'other';
  /** Set for a section inside another section (e.g. Freeplay inside Training). */
  parentId?: string;
  /** Position among its sibling sections. */
  order: number;
}

export interface Activity {
  id: string;
  sectionId: string;
  name: string;
  defaultMeasure: Measure;
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
  /** Count when measure === 'amount'. */
  amount?: number;
  /** Wins among the games of this entry whose result is known. */
  wins?: number;
  /** Losses among the games of this entry whose result is known. */
  losses?: number;
  /** Optional description of what was done (e.g. "aerials, flicks"). */
  note?: string;
  createdAt: string;
  /**
   * Set when (part of) the entry was added by the live game connection. Each account's games get
   * their own entry (accountId); `merged` = games from all accounts go into this one entry.
   */
  auto?: { source: 'game'; accountId?: string; merged?: boolean };
}

export interface Day {
  id: string;
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  entries: Entry[];
  note?: string;
  /** Hide this day's wins / losses on the day page (the user's choice, per day). */
  hideRecord?: boolean;
  /** Training routines started on this day (a copy of the routine, ticked off item by item). */
  routines?: DayRoutine[];
}

/**
 * How a routine item is measured: 'time' = a set number of minutes (countdown timer),
 * 'amount' = a count (e.g. 50 shots), 'stopwatch' = no set length, timed with a stopwatch.
 */
export type RoutineItemKind = 'time' | 'amount' | 'stopwatch';

/** One thing to do in a routine: an activity for a number of minutes, an amount, or a stopwatch. */
export interface RoutineItem {
  id: string;
  activityId: string;
  /** Missing in 1.4 saves (= 'time'). */
  kind?: RoutineItemKind;
  /** Planned minutes for 'time' items (0 for the other kinds). */
  minutes: number;
  /** Planned count for 'amount' items. */
  amount?: number;
  note?: string;
}

/** A saved training routine, e.g. "Warm-up": Freeplay 10 min, Aerials 15 min, … */
export interface Routine {
  id: string;
  name: string;
  items: RoutineItem[];
  createdAt: string;
}

export interface DayRoutineItem extends RoutineItem {
  done?: boolean;
  /** Minutes added to the day when it was completed (taken off again when it's unticked). */
  loggedMinutes?: number;
  /** Count added to the day when an 'amount' item was completed (taken off again when it's unticked). */
  loggedAmount?: number;
  /**
   * Only count what the routine logs for this item, not other work logged that day (set when the
   * user unticks an item that work logged outside the routine covered).
   */
  separate?: boolean;
}

/** A routine started on a day. Items are copied so later edits to the routine don't change past days. */
export interface DayRoutine {
  id: string;
  routineId?: string;
  name: string;
  items: DayRoutineItem[];
  startedAt: string;
  /** When an item's timer ends, start the next item's timer by itself. */
  autoNext?: boolean;
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
  /** Private / third-party matches count in your wins and losses (off: they're logged as games only). */
  privateInRecord: boolean;
  /** Games from different accounts get their own entry on a day (off: one entry per mode, like before 1.8). */
  splitAccounts: boolean;
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
  /** Check GitHub for new versions at all (off = only when the user clicks "Check for updates"). */
  updateChecks: boolean;
  /** Show the small timer overlay on top of Rocket League while a timer runs. */
  timerOverlay: boolean;
  overlayPosition: OverlayPosition;
  /** Global shortcut that pauses / resumes the timer, also while in game ('' = off). Electron accelerator. */
  timerHotkey: string;
  /** Global shortcut that stops the timer / stopwatch and logs the time so far ('' = off). */
  timerFinishHotkey: string;
  /** Play a short sound when a timer finishes. */
  timerSound: boolean;
  /** Day page: the tracked matches card is open (remembered when the user opens or closes it). */
  dayMatchesOpen: boolean;
  /** Day page: how the tracked matches are sorted. */
  dayMatchesSort: MatchSort;
  /**
   * Days end when the user presses "End day" (default), not at midnight: games keep going to the
   * current day, so a session past midnight counts for the day it started.
   */
  endDayManually: boolean;
  /** With endDayManually: the date of the day games are logged to (the current day). */
  openDay?: string;
  /** The date the user last ended with "End day" (it can be reopened while it's the day before the current one). */
  endedDay?: string;
  /** Players seen in the last live match, used for "that's me" linking. */
  lastMatchPlayers?: LocalPlayer[];
  /** The player last seen controlling the game on this PC. */
  lastLocalPlayer?: LocalPlayer;
  /** App version that last opened this file (used for the "updated" message). */
  lastRunVersion?: string;
  /** Rocket League season dates downloaded from the project's GitHub (newer than the ones built in). */
  rlSeasons?: RlSeasonInfo[];
  /** The app's look: 'aurora' (1.7, default) or 'classic' (the original look). */
  theme: ThemeId;
  /** The user's own colors on top of the look (CSS hex colors). */
  customColors?: CustomColors;
  /** How long times are shown: 'days' = 1d 4h 20m (default), 'hours' = 28h 20m (never in days). */
  timeFormat: TimeFormat;
  /** One-time settings changes already applied to this file (see normalizeData). */
  settingsRev?: number;
}

export type ThemeId = 'aurora' | 'classic';
export type TimeFormat = 'days' | 'hours';

/** Orders for the tracked matches on the day page (newest first within each group). */
export type MatchSort = 'recent' | 'oldest' | 'mode' | 'account' | 'result' | 'points';

/** Colors the user can change in Settings → Appearance. */
export type ColorKey = 'accent' | 'accent2' | 'background' | 'surface' | 'text' | 'win' | 'loss';
export type CustomColors = Partial<Record<ColorKey, string>>;

/** Start (and end, when known) of an official Rocket League competitive season. */
export interface RlSeasonInfo {
  number: number;
  start: string;
  end?: string;
}

export type OverlayPosition = 'top-left' | 'top-center' | 'top-right';

/** Settings the main process needs (sent whenever they change). */
export interface MainSettings {
  closeToTray: boolean;
  startWithWindows: boolean;
  autoUpdate: boolean;
  updateChecks: boolean;
  timerOverlay: boolean;
  overlayPosition: OverlayPosition;
  timerHotkey: string;
  timerFinishHotkey: string;
}

export interface AppData {
  version: number;
  seasons: Season[];
  sections: Section[];
  activities: Activity[];
  routines: Routine[];
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
  /**
   * The game never got going (e.g. cancelled because a player didn't join): no touches, goals or
   * clock time. Never logged.
   */
  notStarted?: boolean;
  /**
   * The player on this PC only watched this game (e.g. an Honor Duel between two others after a
   * match in the same lobby). Never logged.
   */
  spectated?: boolean;
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
