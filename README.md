# RL Journal

A Windows desktop journal for Rocket League. Track seasons, log what you do every day, see detailed statistics, and have your games logged automatically while you play.

## Features

- **Seasons.** Add a season with its number. It gets 90 days by default. Add more days, delete days (or delete the leftover days when you close a season early), and close a season to mark it completed on the home screen.
- **Daily log.** For each day, pick a **section** (Training, Games, or your own), then the **activity** (Freeplay, 1s, 2s, 3s, or anything new you add), then **time** (minutes or hours) or **amount**. Game entries can include wins.
- **Live comparison.** While adding an entry you see today's total, yesterday, your average per day you did it, the season average, and your best day. You also see when you set a new personal best.
- **Statistics.** About 45 built-in stats plus per-activity and per-rank stats, for each season or all time. Includes training time, daily averages, games by mode, win rates, streaks, records, weekday patterns, live match stats (goals, saves, shooting %) and MMR. Charts show training time and games by mode, and a season comparison table lines seasons up side by side.
- **Key stats.** Star any stat to pin it to the top of Statistics and to the home screen, and reorder it there.
- **Automatic game logging (multiple accounts):**
  - **Live game connection (recommended).** Uses Rocket League's official [Stats API](https://www.rocketleague.com/developer/stats-api), a local WebSocket the game opens on your PC. Each finished match is logged to today's day in the active season with mode, win/loss, score and your stats. You also get a Windows notification. The app can enable the API in `TAStatsAPI.ini` / `DefaultStatsAPI.ini` for you.
  - **tracker.gg API.** Add a `TRN-Api-Key` per account. The app polls your profile, adds new games per playlist, and records MMR history. Note: tracker.gg doesn't currently offer Rocket League to public API keys, so this may return 401/403. When live game is on for an account, tracker.gg is used for rank only, so games aren't counted twice.
- Runs in the tray so sync keeps working. Optional start with Windows. Local JSON storage with daily backups, plus export/import.

## Development

Requires Node 22+.

```powershell
npm install
npm run dev        # Vite + Electron with hot reload
npm test           # unit tests (vitest)
npm run typecheck
npm run dist       # Windows installer + portable exe in release/
```

Useful scripts:

- `node scripts/fake-stats-api.mjs 49124 <YourName> 11` simulates a finished 2s match from the game.
- `RLJ_USER_DATA=<folder>` runs the app with a separate data folder.

Data lives in `%APPDATA%\RL Journal\journal.json`.

## Project layout

- `src/main`: Electron main process (storage, Stats API client, tracker.gg client, ini setup, tray, notifications).
- `src/preload`: the safe IPC bridge.
- `src/renderer`: React UI. `lib/` holds the pure logic (journal, stats, comparison, sync).
- `src/shared`: data model and playlist mapping.
- `tests`: unit tests for the core logic.

Not affiliated with Psyonix, Epic Games or Tracker Network.
