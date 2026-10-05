// Copies the in-app "what's new" list into releases.json so the v1 update card and v2 tour always match:  node tools/sync-notes.js
import { readFileSync, writeFileSync } from 'node:fs';
import { WHATS_NEW } from '../v2/js/whatsnew.js';
const f = new URL('../releases.json', import.meta.url); const j = JSON.parse(readFileSync(f, 'utf8'));
j.latest.notes = WHATS_NEW; writeFileSync(f, `${JSON.stringify(j, null, 2)}\n`); console.log(`notes: ${WHATS_NEW.length}`);
