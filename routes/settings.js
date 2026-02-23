'use strict';

const express = require('express');
const { db } = require('../db/database');

const router = express.Router();

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM app_settings WHERE user_id = ?').all(req.session.userId);
  const settings = {};
  for (const row of rows) {
    try { settings[row.key] = JSON.parse(row.value); } catch (_) { settings[row.key] = row.value; }
  }
  res.json(settings);
});

const ALLOWED_SETTINGS = new Set([
  'mark_read_on_open', 'show_preview', 'per_page', 'sync_interval',
  'compact_mode', 'accent_color',
  'signature', 'sig_style', 'sig_size', 'sig_color', 'sig_separator',
  'ai_auto_label', 'ai_auto_summarize',
  'notif_ai_filter',
]);

router.put('/', (req, res) => {
  const entries = Object.entries(req.body).filter(([k]) => ALLOWED_SETTINGS.has(k));
  if (!entries.length) return res.json({ ok: true });
  const cappedEntries = entries.map(([k, v]) => {
    if (typeof v === 'string') {
      const max = k === 'signature' ? 10000 : 500;
      return [k, v.slice(0, max)];
    }
    return [k, v];
  });
  const upsert = db.prepare('INSERT OR REPLACE INTO app_settings (user_id, key, value) VALUES (?, ?, ?)');
  const tx = db.transaction((rows) => {
    for (const [key, value] of rows) {
      upsert.run(req.session.userId, key, JSON.stringify(value));
    }
  });
  tx(cappedEntries);
  res.json({ ok: true });
});


router.get('/labels', (req, res) => {
  const labels = db.prepare('SELECT * FROM labels WHERE user_id = ? ORDER BY name').all(req.session.userId);
  res.json(labels);
});

router.post('/labels', (req, res) => {
  const { name, color } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const safeName = String(name).trim().slice(0, 100);
  const safeColor = color ? String(color).slice(0, 20) : '#6366f1';
  try {
    const result = db.prepare('INSERT INTO labels (user_id, name, color) VALUES (?, ?, ?)').run(req.session.userId, safeName, safeColor);
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (_) {
    res.status(409).json({ error: 'Label already exists' });
  }
});

router.put('/labels/:id', (req, res) => {
  const label = db.prepare('SELECT * FROM labels WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
  if (!label) return res.status(404).json({ error: 'Not found' });
  const { name, color } = req.body;
  const safeName = name ? String(name).trim().slice(0, 100) : label.name;
  const safeColor = color ? String(color).slice(0, 20) : label.color;
  db.prepare('UPDATE labels SET name = ?, color = ? WHERE id = ?').run(safeName, safeColor, label.id);
  res.json({ ok: true });
});

router.delete('/labels/:id', (req, res) => {
  db.prepare('DELETE FROM labels WHERE id = ? AND user_id = ? AND is_system = 0').run(req.params.id, req.session.userId);
  res.json({ ok: true });
});

router.post('/labels/:labelId/assign/:emailId', (req, res) => {
  const label = db.prepare('SELECT * FROM labels WHERE id = ? AND user_id = ?').get(req.params.labelId, req.session.userId);
  if (!label) return res.status(404).json({ error: 'Label not found' });
  // Verify the email belongs to this user before assigning
  const email = db.prepare(
    'SELECT e.id FROM emails e JOIN accounts a ON a.id = e.account_id WHERE e.id = ? AND a.user_id = ?'
  ).get(req.params.emailId, req.session.userId);
  if (!email) return res.status(404).json({ error: 'Email not found' });
  db.prepare('INSERT OR IGNORE INTO email_labels (email_id, label_id) VALUES (?, ?)').run(email.id, label.id);
  res.json({ ok: true });
});

router.delete('/labels/:labelId/assign/:emailId', (req, res) => {
  // Both label and email must belong to this user
  const label = db.prepare('SELECT * FROM labels WHERE id = ? AND user_id = ?').get(req.params.labelId, req.session.userId);
  if (!label) return res.status(404).json({ error: 'Label not found' });
  const email = db.prepare(
    'SELECT e.id FROM emails e JOIN accounts a ON a.id = e.account_id WHERE e.id = ? AND a.user_id = ?'
  ).get(req.params.emailId, req.session.userId);
  if (!email) return res.status(404).json({ error: 'Email not found' });
  db.prepare('DELETE FROM email_labels WHERE email_id = ? AND label_id = ?').run(email.id, label.id);
  res.json({ ok: true });
});

module.exports = router;
