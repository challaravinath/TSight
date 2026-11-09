// Write dist/THIRD-PARTY-NOTICES.txt with the licenses of the code and fonts that end up in the built UI.
// The UI ships inside the tsight package and inside every report file, so these notices have to go with it.
// If you add a dependency that gets bundled, add it here too.
import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const BUNDLED = [
  { name: 'react', why: 'the UI' },
  { name: 'react-dom', why: 'the UI' },
  { name: 'scheduler', why: 'used by react-dom' },
  { name: 'vite', why: 'the module preload helper Vite adds to the build' },
  { name: '@fontsource/inter', why: 'the Inter font, embedded in the CSS' },
  { name: '@fontsource/jetbrains-mono', why: 'the JetBrains Mono font, embedded in the CSS' },
];

function licenseText(dir) {
  const file = fs.readdirSync(dir).find((f) => /^licen[cs]e(\.md|\.txt)?$/i.test(f));
  if (!file) throw new Error(`No license file found in ${dir}`);
  let text = fs.readFileSync(path.join(dir, file), 'utf8');
  // Vite's license file also lists the dependencies Vite bundles into itself. None of those end up in our build.
  const cut = text.indexOf('# Licenses of bundled dependencies');
  if (cut !== -1) text = text.slice(0, cut);
  return text.trim();
}

const sections = BUNDLED.map(({ name, why }) => {
  const dir = path.dirname(require.resolve(`${name}/package.json`));
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  return `${name} ${pkg.version} (${pkg.license}), ${why}\n\n${licenseText(dir)}`;
});

const line = '-'.repeat(72);
const text =
  'The TSight web UI includes the following software. Their licenses are below.\n\n' +
  sections.map((s) => `${line}\n${s}\n`).join('\n');

const out = path.join(here, '../dist/THIRD-PARTY-NOTICES.txt');
fs.writeFileSync(out, text);
