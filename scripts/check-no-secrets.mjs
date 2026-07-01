import { execFileSync } from 'node:child_process';

const forbiddenTrackedFiles = new Set([
  '.env',
  '.env.local',
  '.env.production',
  '.env.prod',
  '.env.staging',
  '.dev.vars',
  '.dev.vars.production'
]);

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

const trackedFiles = git(['ls-files']);
const stagedFiles = git(['diff', '--cached', '--name-status'])
  .filter((line) => !line.startsWith('D'))
  .map((line) => line.split(/\s+/).at(-1));

const trackedSecrets = trackedFiles.filter((file) => forbiddenTrackedFiles.has(file));
const stagedSecrets = stagedFiles.filter((file) => forbiddenTrackedFiles.has(file));

if (trackedSecrets.length || stagedSecrets.length) {
  console.error('Secret environment files must not be committed.');
  for (const file of [...new Set([...trackedSecrets, ...stagedSecrets])]) {
    console.error(`- ${file}`);
  }
  console.error('Keep local values in ignored files and store production secrets in the hosting provider.');
  process.exit(1);
}

console.log('No tracked or staged secret environment files found.');
