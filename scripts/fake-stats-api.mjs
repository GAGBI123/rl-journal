// Fake Rocket League Stats API for testing auto game logging without the game.
// Usage: node scripts/fake-stats-api.mjs [port] [playerName] [playlistId]
import { WebSocketServer } from 'ws';

const port = Number(process.argv[2] ?? 49124);
const me = process.argv[3] ?? 'DemoPlayer';
const playlistId = Number(process.argv[4] ?? 11);
const guid = 'FAKE' + Date.now();
const wss = new WebSocketServer({ port, host: '127.0.0.1' });
console.log(`fake Stats API on ws://127.0.0.1:${port}`);

const players = (myGoals, oppGoals) => [
  { Name: me, PrimaryId: 'Epic|fake-me|0', Shortcut: 1, TeamNum: 0, Score: 120 * myGoals + 80, Goals: myGoals, Shots: myGoals + 2, Assists: 1, Saves: 3, Touches: 30, CarTouches: 2, Demos: 1 },
  { Name: 'Teammate', PrimaryId: 'Steam|222|0', Shortcut: 2, TeamNum: 0, Score: 200, Goals: 0, Shots: 1, Assists: 0, Saves: 1, Touches: 20, CarTouches: 1, Demos: 0 },
  { Name: 'Opp1', PrimaryId: 'Epic|333|0', Shortcut: 3, TeamNum: 1, Score: 150, Goals: oppGoals, Shots: 3, Assists: 0, Saves: 2, Touches: 25, CarTouches: 1, Demos: 0 },
];
const state = (my, opp, winner = '') => ({
  Event: 'UpdateState',
  Data: {
    MatchGuid: guid,
    Players: players(my, opp),
    Game: {
      Teams: [
        { Name: 'Blue', TeamNum: 0, Score: my, ColorPrimary: '0000FF', ColorSecondary: '0000AA' },
        { Name: 'Orange', TeamNum: 1, Score: opp, ColorPrimary: 'FF8800', ColorSecondary: 'AA5500' },
      ],
      PlaylistId: playlistId,
      TimeSeconds: 120,
      bOvertime: false,
      Ball: { Speed: 500, TeamNum: 0 },
      bReplay: false,
      bHasWinner: !!winner,
      Winner: winner,
      Arena: 'Stadium_P',
      bHasTarget: false,
    },
  },
});

wss.on('connection', (ws) => {
  console.log('app connected');
  const seq = [
    { Event: 'MatchCreated', Data: { MatchGuid: guid } },
    { Event: 'PlayerJoined', Data: { MatchGuid: guid, PlayerName: me, PrimaryId: 'Epic|fake-me|0' } },
    { Event: 'MatchInitialized', Data: { MatchGuid: guid } },
    { Event: 'CountdownBegin', Data: { MatchGuid: guid } },
    { Event: 'RoundStarted', Data: { MatchGuid: guid } },
    state(0, 0),
    { Event: 'GoalScored', Data: { MatchGuid: guid, GoalSpeed: 90, Scorer: { Name: me, Shortcut: 1, TeamNum: 0 } } },
    state(1, 0),
    state(2, 1),
    state(3, 1, 'Blue'),
    { Event: 'MatchEnded', Data: { MatchGuid: guid, WinnerTeamNum: 0 } },
    { Event: 'PodiumStart', Data: { MatchGuid: guid } },
    { Event: 'MatchDestroyed', Data: { MatchGuid: guid } },
  ];
  let i = 0;
  const t = setInterval(() => {
    if (i >= seq.length) {
      clearInterval(t);
      console.log('sequence sent');
      return;
    }
    ws.send(JSON.stringify(seq[i++]));
  }, 300);
});

setTimeout(() => process.exit(0), Number(process.env.FAKE_TTL ?? 60000));
