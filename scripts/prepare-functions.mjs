import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(repository, 'functions/lib');
const clientSource = resolve(repository, 'src/client');
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
cpSync(resolve(repository, 'firebase-functions.mjs'), resolve(output, 'firebase-functions.mjs'));
cpSync(resolve(repository, 'src'), resolve(output, 'src'), {
  recursive: true,
  filter: source => !source.startsWith(clientSource)
});
console.info('Prepared Firebase Functions source in functions/lib.');
