'use strict';

const fs   = require('fs');
const path = require('path');
const { db } = require('../db/database');

const KEEP_COUNT = 7;
const ROOT       = path.join(__dirname, '..'); // project root

function isEnabled() {
  return !!(process.env.BACKUP_PATH && process.env.BACKUP_PATH.trim());
}

function timestamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_` +
         `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

async function runBackup() {
  if (!isEnabled()) return;

  const backupRoot = path.resolve(process.env.BACKUP_PATH.trim());

  fs.mkdirSync(backupRoot, { recursive: true });

  const backupDir = path.join(backupRoot, `neomail_${timestamp()}`);
  fs.mkdirSync(backupDir, { recursive: true });

  const dbDest = path.join(backupDir, 'neomail.db');
  await db.backup(dbDest);

  const envSrc = path.join(ROOT, '.env');
  if (fs.existsSync(envSrc)) {
    fs.copyFileSync(envSrc, path.join(backupDir, '.env'));
    try { fs.chmodSync(path.join(backupDir, '.env'), 0o600); } catch (_) {}
  }

  console.log(`[BACKUP] Saved to ${backupDir}`);
  pruneOldBackups(backupRoot);
}

function pruneOldBackups(backupRoot) {
  try {
    const entries = fs.readdirSync(backupRoot)
      .filter(name => name.startsWith('neomail_'))
      .map(name => ({ name, mtime: fs.statSync(path.join(backupRoot, name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime); // newest first

    const toDelete = entries.slice(KEEP_COUNT);
    for (const entry of toDelete) {
      fs.rmSync(path.join(backupRoot, entry.name), { recursive: true, force: true });
      console.log(`[BACKUP] Pruned old backup: ${entry.name}`);
    }
  } catch (err) {
    console.error('[BACKUP] Prune error:', err.message);
  }
}

module.exports = { isEnabled, runBackup };
