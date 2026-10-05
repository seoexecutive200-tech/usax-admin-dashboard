// Regenerates the precache list inside v2/service-worker.js from the files on disk:  node tools/gen-shell.js
import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(fileURLToPath(import.meta.url), '..', '..', 'v2');
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const files = walk(root).map((p) => relative(root, p)).filter((f) => !['service-worker.js'].includes(f) && !f.endsWith('.map')).sort();
const shell = ['./', ...files, '../assets/favicon.png', '../assets/logo.webp', '../assets/planet.webp', '../assets/icon-192.png', '../assets/icon-512.png', '../assets/icon-maskable-512.png', '../assets/apple-touch-icon.png'];
const sw = join(root, 'service-worker.js'); let s = readFileSync(sw, 'utf8');
s = s.replace(/\/\/ <shell>[\s\S]*?\/\/ <\/shell>/, `// <shell>\nconst SHELL = ${JSON.stringify(shell)};\n// </shell>`);
writeFileSync(sw, s); console.log(`precache: ${shell.length} files`);
