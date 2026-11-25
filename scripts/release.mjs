// Publishes the current version:
//   1. pushes the current commit and tags it vX.Y.Z (from package.json)
//   2. GitHub Actions builds Windows + Linux and publishes the release (.github/workflows/build.yml)
//   3. installed apps find the new release and update themselves
//
// Usage: bump "version" in package.json, commit, then `npm run release`.
// Optional: add release-notes/vX.Y.Z.md first; it becomes the top of the release text.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const tag = `v${pkg.version}`;
const { owner, repo } = pkg.build.publish[0];

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', stdio: opts.inherit ? 'inherit' : 'pipe' });
  if (r.status !== 0 && !opts.allowFail) {
    console.error(`\n✖ ${cmd} ${args.join(' ')}\n${r.stderr ?? ''}${r.stdout ?? ''}`);
    process.exit(1);
  }
  return (r.stdout ?? '').trim();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (run('git', ['status', '--porcelain'])) {
  console.error('✖ Commit your changes first (git status is not clean).');
  process.exit(1);
}
if (run('git', ['ls-remote', '--tags', 'origin', tag])) {
  console.error(`✖ ${tag} already exists on GitHub. Bump "version" in package.json first.`);
  process.exit(1);
}

run('git', ['push', 'origin', 'HEAD'], { inherit: true });
if (!run('git', ['tag', '--list', tag])) run('git', ['tag', '-a', tag, '-m', `RL Journal ${pkg.version}`]);
run('git', ['push', 'origin', tag], { inherit: true });
const commit = run('git', ['rev-list', '-n', '1', tag]);
console.log(`• Pushed ${tag} (${commit.slice(0, 7)}). Waiting for the build to start…`);

let runId = '';
for (let i = 0; i < 40 && !runId; i++) {
  const list = JSON.parse(run('gh', ['run', 'list', '--workflow', 'build.yml', '--limit', '20', '--json', 'databaseId,headSha,headBranch']));
  const hit = list.find((r) => r.headSha === commit && r.headBranch === tag);
  if (hit) runId = String(hit.databaseId);
  else await sleep(5000);
}
if (!runId) {
  console.error(`✖ No build started for ${tag}. Check https://github.com/${owner}/${repo}/actions`);
  process.exit(1);
}
console.log(`• Building Windows + Linux (about 10 minutes)…`);
run('gh', ['run', 'watch', runId, '--exit-status', '--interval', '20'], { inherit: true });
console.log(`\n✔ Published: https://github.com/${owner}/${repo}/releases/tag/${tag}`);
