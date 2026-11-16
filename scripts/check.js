import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, 'src');
const files = readdirSync(src).filter((f) => f.endsWith('.js')).sort();

let failed = false;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', join(src, file)], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    failed = true;
    process.stderr.write(`node --check failed for src/${file}\n`);
    process.stderr.write(result.stderr || result.stdout || '');
  }
}

if (failed) {
  process.exit(1);
}
console.log(`Checked ${files.length} source files with node --check`);
