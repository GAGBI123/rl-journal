// Generates a demo journal (for screenshots / manual testing). Usage:
//   npx esbuild scripts/seed.ts --bundle --platform=node --outfile=.tmp/seed.cjs && node .tmp/seed.cjs <userDataDir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { addDays, todayISO } from '../src/renderer/lib/dates';
import { createDefaultData, createSeason, findOrCreateActivity, newEntry } from '../src/renderer/lib/journal';
import { applyLiveMatch } from '../src/renderer/lib/sync';

const out = process.argv[2];
if (!out) throw new Error('usage: seed <userDataDir>');

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];

const data = createDefaultData();
const today = todayISO();
const training = data.sections.find((s) => s.kind === 'training')!;
const aerial = findOrCreateActivity(data, training.id, 'Aerial training', 'time');
const recovery = findOrCreateActivity(data, training.id, 'Recovery pack', 'amount');

const old = createSeason(data, 20, addDays(today, -120), 90);
old.status = 'closed';
old.closedAt = new Date().toISOString();
const cur = createSeason(data, 21, addDays(today, -24), 90, 'Road to Champ');

for (const season of [old, cur]) {
  for (const day of season.days) {
    if (day.date > today) continue;
    if (rnd() < 0.18) continue; // rest day
    day.entries.push(newEntry({ activityId: 'act-freeplay', measure: 'time', minutes: Math.round(15 + rnd() * 60), unit: 'min' }));
    if (rnd() < 0.4) day.entries.push(newEntry({ activityId: aerial.id, measure: 'time', minutes: Math.round(10 + rnd() * 35), unit: 'min' }));
    if (rnd() < 0.2) day.entries.push(newEntry({ activityId: recovery.id, measure: 'amount', amount: Math.round(20 + rnd() * 40) }));
    for (const mode of ['act-1s', 'act-2s', 'act-3s', 'act-casual-2s']) {
      if (rnd() < 0.45) {
        const amount = Math.round(2 + rnd() * 9);
        const wins = Math.round(amount * (0.35 + rnd() * 0.3));
        day.entries.push(newEntry({ activityId: mode, measure: 'amount', amount, wins, losses: amount - wins }));
      }
    }
  }
}

data.accounts.push({
  id: 'demo-main',
  label: 'Main',
  platform: 'epic',
  inGameNames: ['DemoPlayer'],
  primaryIds: [],
  liveGame: true,
  color: '#3b82f6',
  createdAt: new Date().toISOString(),
});

for (let i = 0; i < 4; i++) {
  const myTeam = i % 2;
  applyLiveMatch(data, {
    guid: `demo-${i}`,
    endedAt: new Date(Date.now() - (4 - i) * 15 * 60000).toISOString(),
    playlistId: i === 3 ? 53 : pick([10, 11, 13, 3]),
    localPlayer: { name: 'DemoPlayer', primaryId: 'Epic|demo|0', teamNum: myTeam },
    leftEarly: false,
    overtime: i === 2,
    winnerTeamNum: i === 1 ? 1 - myTeam : myTeam,
    teams: [
      { teamNum: 0, score: 2 + i },
      { teamNum: 1, score: 1 + (i % 3) },
    ],
    players: [
      { name: 'DemoPlayer', primaryId: 'Epic|demo|0', teamNum: myTeam, score: 300 + i * 50, goals: 1 + (i % 2), assists: i % 3, saves: 2, shots: 3 + i, demos: i % 2 },
      { name: 'Opponent', primaryId: 'Steam|1|0', teamNum: 1 - myTeam, score: 250, goals: 1, assists: 0, saves: 1, shots: 2, demos: 0 },
    ],
  });
}
data.notifications.forEach((n, i) => (n.read = i > 1));

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'journal.json'), JSON.stringify(data));
console.log('seeded', join(out, 'journal.json'));
