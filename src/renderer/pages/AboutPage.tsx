import { useEffect, useState } from 'react';
import { Brain, Crown, ExternalLink, Gauge, Laugh, Lightbulb, Rocket, ShieldCheck, Sparkles, Target, Trophy, Users } from 'lucide-react';
import { useStore } from '../store';
import logo from '../../../build/icon.svg';

/** His in-game name, exactly as it is in game. */
const IGN = 'Ascènd.';
/** What his friends call him. */
const NICK = 'Ascend';

const FACTS = [
  { icon: Brain, label: 'Brain size', value: 'Galaxy', note: 'Scientists asked to study it. He was busy grinding ranked.' },
  { icon: Lightbulb, label: 'Ideas had', value: '1 app', note: 'One idea, and it turned into this whole thing. Peak efficiency.' },
  { icon: Gauge, label: 'Game sense', value: 'Precog', note: 'Rotates to where the ball is going before the ball knows.' },
  { icon: Laugh, label: 'Humor', value: 'Elite', note: 'Funnier than a whiffed open net. He has never whiffed one. Allegedly.' },
  { icon: Rocket, label: 'Aerial control', value: 'Silky', note: 'Ceiling shots so clean they get their own replay.' },
  { icon: Users, label: 'Teammate rating', value: '10/10', note: 'Says "What a save!" and actually means it.' },
];

const ACHIEVEMENTS = [
  { icon: Lightbulb, title: 'Visionary', desc: 'Came up with RL Journal. Yes, the app you are using right now.' },
  { icon: Brain, title: 'Big Brain Energy', desc: 'Thought about tracking training before tracking training was cool.' },
  { icon: Rocket, title: 'Supersonic Idea', desc: 'Went from "what if" to a real app faster than a boost pad respawns.' },
  { icon: Target, title: 'Calculated.', desc: 'Every idea he has. Every single one.' },
  { icon: Laugh, title: 'Certified Funny', desc: 'Keeps the lobby laughing between kickoffs, even after a 0–5.' },
  { icon: Crown, title: 'Main Character', desc: 'Has a whole About page written about him. Does yours?' },
];

export function AboutPage() {
  const appIcon = useStore((s) => s.appIcon);
  const [version, setVersion] = useState('');
  useEffect(() => {
    window.rlj.version().then(setVersion);
  }, []);

  return (
    <div className="page about-page">
      <div className="about-hero card">
        <img className="about-logo" src={appIcon ?? logo} alt="" draggable={false} />
        <div>
          <div className="about-kicker">About</div>
          <h1 className="about-title">RL Journal</h1>
          <div className="muted">
            Train · Play · Track{version ? <> · version {version}</> : null}
          </div>
        </div>
      </div>

      <div className="section-title">
        <h2>
          <Sparkles size={15} /> The mind behind the idea
        </h2>
      </div>
      <div className="about-legend card">
        <div className="legend-crown">
          <Crown size={26} />
        </div>
        <div className="legend-label">Original idea by</div>
        <div className="legend-name">{IGN}</div>
        <div className="legend-sub">Legend · Visionary · Certified good teammate</div>
        <div className="legend-text">
          <p>
            Every great app starts with one great idea. This one started with <b>{IGN}</b>
          </p>
          <p>
            {NICK} looked at a season of Rocket League (hours of freeplay, a mountain of ranked games, a few kickoffs we don't talk about) and asked the
            question nobody else was brave enough to ask: <i>what if we actually wrote it all down?</i>
          </p>
          <p>
            That was it. One sentence from {NICK}, and suddenly there were seasons, days, routines, statistics, charts, a timer that floats over the game
            and games that log themselves. Some people have ideas. {NICK} has <i>ideas</i>.
          </p>
          <p>
            So every time you log a session, finish a routine or watch your streak go up one more day, that's {NICK}'s idea working for you. You're
            welcome (from him).
          </p>
        </div>
      </div>

      <div className="section-title">
        <h2>
          <ShieldCheck size={15} /> Verified facts about {IGN}
        </h2>
      </div>
      <div className="fact-grid">
        {FACTS.map((f) => (
          <div className="fact-card card" key={f.label}>
            <div className="fact-icon">
              <f.icon size={18} />
            </div>
            <div className="fact-label">{f.label}</div>
            <div className="fact-value">{f.value}</div>
            <div className="fact-note">{f.note}</div>
          </div>
        ))}
      </div>

      <div className="section-title">
        <h2>
          <Trophy size={15} /> Achievements unlocked
        </h2>
        <span className="muted small">{ACHIEVEMENTS.length} / {ACHIEVEMENTS.length} · 100% complete, obviously</span>
      </div>
      <div className="achv-list card">
        {ACHIEVEMENTS.map((a) => (
          <div className="achv" key={a.title}>
            <div className="achv-icon">
              <a.icon size={18} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="achv-title">{a.title}</div>
              <div className="achv-desc">{a.desc}</div>
            </div>
            <span className="badge green">Unlocked</span>
          </div>
        ))}
      </div>

      <div className="about-quote card">
        <div className="q-mark">“</div>
        <div className="q-text">Calculated.</div>
        <div className="q-by">— {IGN}, probably, about this entire app</div>
      </div>

      <div className="about-thanks">
        Thanks, {NICK}. GG, close one. <span className="muted">(It wasn't close. You won.)</span>
      </div>

      <div className="section-title">
        <h2>The app</h2>
      </div>
      <div className="card about-app">
        <p>
          RL Journal keeps your Rocket League seasons, training and games in one place. Your journal stays on this computer: the app only talks to
          Rocket League's own Stats API on this PC and, if update checks are on, to GitHub for new versions.
        </p>
        <p className="muted small">
          Open source under the MIT license. Fonts: Inter and Outfit (SIL Open Font License). Not affiliated with Psyonix or Epic Games.
        </p>
        <button className="btn" onClick={() => window.rlj.openExternal('https://github.com/GAGBI123/rl-journal')}>
          <ExternalLink size={15} /> RL Journal on GitHub
        </button>
      </div>
    </div>
  );
}
