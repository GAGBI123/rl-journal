// Fake Rocket League Stats API for testing automatic game logging without the game.
// Usage: node scripts/fake-stats-api.mjs [port] [playerName] [playlistId | "session"]
//   playlistId  one won match in that playlist (11 = Ranked 2s, 3 = Casual 3s, 53 = Honor Duel …)
//   session     freeplay (must NOT be logged) → Ranked 3s win → Honor Duel loss in the same lobby
import { WebSocketServer } from 'ws';

const port = Number(process.argv[2] ?? 49124);
const me = process.argv[3] ?? 'DemoPlayer';
const mode = process.argv[4] ?? '11';
const myId = 'Epic|fake-me|0';
const wss = new WebSocketServer({ port, host: '127.0.0.1' });
console.log(`fake Stats API on ws://127.0.0.1:${port}`);

const players = (guid, myGoals, oppGoals, solo) =>
  [
    { Name: me, PrimaryId: myId, Shortcut: 1, TeamNum: 0, Score: 120 * myGoals + 80, Goals: myGoals, Shots: myGoals + 2, Assists: 1, Saves: 3, Touches: 30, CarTouches: 2, Demos: 1 },
    !solo && { Name: 'Teammate', PrimaryId: 'Steam|222|0', Shortcut: 2, TeamNum: 0, Score: 200, Goals: 0, Shots: 1, Assists: 0, Saves: 1, Touches: 20, CarTouches: 1, Demos: 0 },
    guid && { Name: 'Opp1', PrimaryId: 'Epic|333|0', Shortcut: 3, TeamNum: 1, Score: 150, Goals: oppGoals, Shots: 3, Assists: 0, Saves: 2, Touches: 25, CarTouches: 1, Demos: 0 },
  ].filter(Boolean);

const state = (guid, playlistId, my, opp, winner = '', replay = false) => ({
  Event: 'UpdateState',
  Data: {
    ...(guid ? { MatchGuid: guid } : {}),
    Players: players(guid, my, opp, playlistId === 53 || playlistId === 10 || playlistId === 9),
    Game: {
      Teams: [
        { Name: 'Blue', TeamNum: 0, Score: my, ColorPrimary: '0000FF', ColorSecondary: '0000AA' },
        { Name: 'Orange', TeamNum: 1, Score: opp, ColorPrimary: 'FF8800', ColorSecondary: 'AA5500' },
      ],
      PlaylistId: playlistId,
      TimeSeconds: 120,
      bOvertime: false,
      Ball: { Speed: 500, TeamNum: 0 },
      bReplay: replay,
      bHasWinner: !!winner,
      Winner: winner,
      Arena: 'Stadium_P',
      // The camera follows the player on this PC.
      bHasTarget: true,
      Target: replay ? { Name: 'Opp1', Shortcut: 3, TeamNum: 1 } : { Name: me, Shortcut: 1, TeamNum: 0 },
    },
  },
});
const ev = (Event, guid, extra = {}) => ({ Event, Data: { ...(guid ? { MatchGuid: guid } : {}), ...extra } });

function match(guid, playlistId, win) {
  return [
    ev('MatchCreated', guid),
    ev('PlayerJoined', guid, { PlayerName: me, PrimaryId: myId }),
    ev('MatchInitialized', guid),
    ev('CountdownBegin', guid),
    ev('RoundStarted', guid),
    state(guid, playlistId, 0, 0),
    ev('GoalScored', guid, { GoalSpeed: 90, Scorer: { Name: me, Shortcut: 1, TeamNum: 0 } }),
    state(guid, playlistId, 1, 0),
    state(guid, playlistId, 1, 0, '', true), // goal replay
    state(guid, playlistId, win ? 3 : 1, win ? 1 : 2),
    state(guid, playlistId, win ? 3 : 1, win ? 1 : 2, win ? 'Blue' : 'Orange'),
    ev('MatchEnded', guid, { WinnerTeamNum: win ? 0 : 1 }),
    ev('PodiumStart', guid),
  ];
}

function scenario() {
  const stamp = Date.now();
  if (mode !== 'session') {
    const guid = 'FAKE' + stamp;
    return [...match(guid, Number(mode), true), ev('MatchDestroyed', guid)];
  }
  const g = 'FAKE' + stamp;
  return [
    // Freeplay: no match id → never logged.
    ev('MatchCreated'),
    ev('RoundStarted'),
    state(undefined, 9, 0, 0),
    state(undefined, 9, 0, 0),
    ev('MatchDestroyed'),
    // Ranked 3s win, then an Honor Duel in the same lobby that is lost.
    ...match(g, 13, true),
    state(g, 13, 3, 1, 'Blue'),
    state(g, 53, 0, 0),
    ev('RoundStarted', g),
    state(g, 53, 0, 1),
    state(g, 53, 0, 1, 'Orange'),
    ev('MatchEnded', g, { WinnerTeamNum: 1 }),
    ev('MatchDestroyed', g),
  ];
}

wss.on('connection', (ws) => {
  console.log('app connected');
  const seq = scenario();
  let i = 0;
  const t = setInterval(() => {
    if (i >= seq.length) {
      clearInterval(t);
      console.log('sequence sent');
      return;
    }
    ws.send(JSON.stringify(seq[i++]));
  }, 250);
});

setTimeout(() => process.exit(0), Number(process.env.FAKE_TTL ?? 60000));
