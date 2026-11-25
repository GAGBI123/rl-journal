// Publishes the current version for everyone:
//   1. tags the commit (vX.Y.Z) and pushes it, which makes GitHub Actions build Windows + Linux
//   2. waits for that build, downloads the files
//   3. creates the release in the PUBLIC releases repo the app updates from
//
// Usage: npm run release            (bump "version" in package.json and commit first)
//        npm run release -- --notes "What changed"
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const version = pkg.version;
const tag = `v${version}`;
const pub = pkg.build.publish[0];
const releasesRepo = `${pub.owner}/${pub.repo}`;

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', stdio: opts.inherit ? 'inherit' : 'pipe', shell: false });
  if (r.status !== 0 && !opts.allowFail) {
    console.error(`\n✖ ${cmd} ${args.join(' ')}\n${r.stderr ?? ''}${r.stdout ?? ''}`);
    process.exit(1);
  }
  return (r.stdout ?? '').trim();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. Clean tree, pushed commit, tag.
if (run('git', ['status', '--porcelain'])) {
  console.error('✖ Commit your changes first (git status is not clean).');
  process.exit(1);
}
run('git', ['push', 'origin', 'HEAD'], { inherit: true });
const hasTag = run('git', ['tag', '--list', tag]);
if (!hasTag) run('git', ['tag', '-a', tag, '-m', `RL Journal ${version}`]);
run('git', ['push', 'origin', tag], { inherit: true, allowFail: true });
const commit = run('git', ['rev-list', '-n', '1', tag]);
console.log(`• ${tag} → ${commit.slice(0, 7)}`);

// 2. Wait for the build of that tag.
let runId = '';
for (let i = 0; i < 40 && !runId; i++) {
  const list = JSON.parse(
    run('gh', ['run', 'list', '--workflow', 'build.yml', '--limit', '20', '--json', 'databaseId,headSha,headBranch,event,status']),
  );
  const hit = list.find((r) => r.headSha === commit && (r.headBranch === tag || r.event === 'push'));
  if (hit) runId = String(hit.databaseId);
  else await sleep(5000);
}
if (!runId) {
  console.error('✖ No build started for this tag. Check the Actions tab of the source repo.');
  process.exit(1);
}
console.log(`• Waiting for build ${runId} (Windows + Linux, ~10 min)…`);
run('gh', ['run', 'watch', runId, '--exit-status', '--interval', '20'], { inherit: true });

// 3. Download the build output.
const out = path.join('release-dist', tag);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
run('gh', ['run', 'download', runId, '--dir', out], { inherit: true });
const files = [];
for (const dir of readdirSync(out)) {
  for (const f of readdirSync(path.join(out, dir))) files.push(path.join(out, dir, f));
}
const need = [/RL-Journal-Setup-.*\.exe$/, /latest\.yml$/, /\.AppImage$/, /latest-linux\.yml$/];
for (const re of need) {
  if (!files.some((f) => re.test(f))) {
    console.error(`✖ Build output is missing ${re}`);
    process.exit(1);
  }
}

// 4. Publish to the public releases repo (what the app checks for updates).
const notesArg = process.argv.indexOf('--notes');
const notesFile = path.join(out, 'NOTES.md');
const custom = notesArg > 0 ? process.argv[notesArg + 1] : existsSync(`release-notes/${tag}.md`) ? readFileSync(`release-notes/${tag}.md`, 'utf8') : '';
writeFileSync(
  notesFile,
  `${custom ? custom.trim() + '\n\n' : ''}## Download\n\n` +
    `- **Windows:** \`RL-Journal-Setup-${version}.exe\`, run it to install or update.\n` +
    `- **Linux:** \`RL-Journal-x86_64.AppImage\`, right-click → Properties → allow running as a program, then double-click.\n\n` +
    `Already installed? The app updates itself. Your journal is never replaced.\n`,
);
const exists = run('gh', ['release', 'view', tag, '--repo', releasesRepo, '--json', 'tagName'], { allowFail: true });
if (exists) {
  run('gh', ['release', 'upload', tag, ...files, '--repo', releasesRepo, '--clobber'], { inherit: true });
} else {
  run('gh', ['release', 'create', tag, ...files, '--repo', releasesRepo, '--title', `RL Journal ${version}`, '--notes-file', notesFile, '--latest'], {
    inherit: true,
  });
}
console.log(`\n✔ Published ${tag}: https://github.com/${releasesRepo}/releases/tag/${tag}`);
