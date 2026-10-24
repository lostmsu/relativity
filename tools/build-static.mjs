import { cpSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
mkdirSync(dist, { recursive: true });
for (const entry of ['index.html', 'css', 'js', 'objects']) {
  cpSync(resolve(root, entry), resolve(dist, entry), { recursive: true });
}
console.log('Static site prepared in dist/');
