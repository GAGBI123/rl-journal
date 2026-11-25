# RL Journal

A desktop journal for Rocket League (Windows and Linux). Track seasons, log what you do every day, see detailed statistics, and have your games logged automatically while you play.

## Features

- **Seasons.** Add a season with its number. It gets 90 days by default. Add more days, delete days (or delete the leftover days when you close a season early), and close a season to mark it completed on the home screen.
- **Daily log.** For each day, pick a **section** (Training, Games, or your own), then the **activity**, then **time** (minutes or hours) or **amount**, plus an optional **description** (e.g. "aerials, flicks"). Game entries can include wins.
- **One entry per activity per day.** Adding the same activity again adds to that day's total (minutes and hours are combined into minutes) instead of creating a second entry.
- **Game modes.** Games starts with Ranked 1s, 2s and 3s, Casual 1s, 2s and 3s, and Honor Duel. Anything you add goes last, and you can reorder everything in Settings (drag the handle or use the arrows).
- **Live comparison.** While adding an entry you see today's total, yesterday, your average per day you did it, the season average, and your best day. You also see when you set a new personal best.
- **Statistics.** About 50 built-in stats plus per-activity stats, for each season or all time. Includes training time, daily averages, games by mode, ranked vs casual, honor duels, win rates, streaks, records, weekday patterns and live match stats (goals, saves, shooting %). Charts show training time and games by mode, and a season comparison table lines seasons up side by side.
- **Key stats.** Star any stat to pin it to the top of Statistics and to the home screen, and reorder it there.
- **Automatic game logging (multiple accounts).** Uses Rocket League's official [Stats API](https://www.rocketleague.com/developer/stats-api), a local WebSocket the game opens on your PC.
  - Every online match you finish is logged to today's day in the active season: ranked or casual, the mode, win or loss, and your stats. Honor Duels are logged separately.
  - The account you play on is detected from the game itself (the player the camera follows), so no setup is needed. The top bar shows "Game connected · *account*".
  - Freeplay, training, workshop and offline games are never logged. Private matches are optional.
  - Win/loss tracking can be turned off separately for games and for honor duels.
  - The app can enable the Stats API in `TAStatsAPI.ini` / `DefaultStatsAPI.ini` for you. On Linux it finds Rocket League under Steam (Proton), Heroic, Lutris or Bottles.
- **Automatic updates.** New versions are downloaded and installed by themselves when you're not in a match or using the app. Or turn that off and install with one click. Your journal is never replaced by an update or by running the installer again.
- Runs in the tray so logging keeps working. Optional start at login. Local JSON storage with daily backups, plus export/import.

## Install

Download from the [releases page](https://github.com/GAGBI123/rl-journal-releases/releases/latest):

- **Windows:** `RL-Journal-Setup-<version>.exe`. Windows may warn that the app isn't signed: click **More info → Run anyway**.
- **Linux:** `RL-Journal-x86_64.AppImage`. Right-click → Properties → allow running as a program, then double-click. On first start it adds itself to your app menu.

## Development

Requires Node 22+.

```powershell
npm install
npm run dev        # Vite + Electron with hot reload
npm test           # unit tests (vitest)
npm run typecheck
npm run dist:win   # Windows installer in release/
npm run dist:linux # Linux AppImage in release/ (run on Linux)
```

Useful scripts:

- `node scripts/fake-stats-api.mjs 49124 <YourName> session` simulates freeplay, a Ranked 3s win and an Honor Duel. Use a playlist id instead of `session` for a single match (11 = Ranked 2s, 3 = Casual 3s, 53 = Honor Duel).
- `RLJ_USER_DATA=<folder>` runs the app with a separate data folder.
- `RLJ_UPDATE_URL=<url>` points the updater at a test server instead of GitHub.

Data lives in `%APPDATA%\RL Journal\journal.json` (Windows) or `~/.config/RL Journal/journal.json` (Linux). The app log is in `logs/main.log` next to it. Before an update changes the save format, the original file is kept in `backups/before-upgrade-*.json`.

## Releasing a new version

1. Bump `version` in `package.json` and commit.
2. Run `npm run release`. It tags the commit, waits for GitHub Actions to build the Windows installer and the Linux AppImage, and publishes them to the public [rl-journal-releases](https://github.com/GAGBI123/rl-journal-releases) repo. Installed apps pick the update up from there. The source code stays in this private repo.

## Project layout

- `src/main`: Electron main process (storage, Stats API client, ini setup, updater, Linux integration, tray, notifications).
- `src/preload`: the safe IPC bridge.
- `src/renderer`: React UI. `lib/` holds the pure logic (journal, migration, stats, comparison, sync).
- `src/shared`: data model and playlist mapping.
- `tests`: unit tests for the core logic.
- `.github/workflows/build.yml`: builds Windows and Linux on every version tag.

Not affiliated with Psyonix or Epic Games.
