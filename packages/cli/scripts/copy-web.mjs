// Copy the built web UI into dist/web so the published package can serve it.
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const from = path.join(here, '../../web/dist');
const to = path.join(here, '../dist/web');
if (!fs.existsSync(path.join(from, 'index.html'))) {
  console.warn('Web UI is not built yet (packages/web/dist). Build it before packaging the CLI.');
  process.exit(0);
}
fs.rmSync(to, { recursive: true, force: true });
fs.cpSync(from, to, { recursive: true });
fs.chmodSync(path.join(here, '../dist/cli.js'), 0o755);
