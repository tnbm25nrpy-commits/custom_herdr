// trust-dir.mjs <dir> - mark <dir> as trusted in ~/.claude.json so a new claude session there
// skips the "Do you trust this folder?" dialog. Used by herdr-worker.ps1 before starting a worker.
// Atomic write (temp + rename); no-op when already trusted.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = process.argv[2];
if (!dir) { console.error('usage: trust-dir.mjs <dir>'); process.exit(2); }
let key = path.resolve(dir).replace(/\\/g, '/');
key = key.charAt(0).toUpperCase() + key.slice(1);

const file = path.join(os.homedir(), '.claude.json');
const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
cfg.projects ??= {};
const p = (cfg.projects[key] ??= {});
if (p.hasTrustDialogAccepted === true) process.exit(0);
p.hasTrustDialogAccepted = true;
const tmp = `${file}.trust-${process.pid}.tmp`;
fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2));
fs.renameSync(tmp, file);
console.log(`trusted ${key}`);
