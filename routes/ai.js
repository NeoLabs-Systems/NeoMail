'use strict';

const express = require('express');
const { db } = require('../db/database');
const ai = require('../services/ai');

const router = express.Router();

/* Sanitise user input for FTS5 — wrap cleaned words in quotes */
function buildFtsQuery(text) {
  const words = (text || '').match(/[\w@.\-]{2,}/g) || [];
  if (!words.length) return null;
  return words.slice(0, 12).map(w => `"${w.replace(/"/g, '')}"`).join(' OR ');
}

router.post('/chat', async (req, res) => {
  if (!ai.isAvailable()) return res.status(503).json({ error: 'AI not configured. Add OPENAI_API_KEY to your environment.' });

  const { message, history } = req.body;
  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'message required' });
  if (message.length > 2000) return res.status(400).json({ error: 'message too long' });

  const safeHistory = Array.isArray(history)
    ? history
        .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .map(m => ({ role: m.role, content: m.content.slice(0, 2000) }))
        .slice(-16)
    : [];

  try {
    const ftsQuery = buildFtsQuery(message);
    let emails = [];
    if (ftsQuery) {      try {
        emails = db.prepare(`
          SELECT e.id, e.subject, e.from_name, e.from_email,
                 e.to_addresses, e.date, e.body_text
          FROM email_fts
          JOIN emails e   ON e.id = email_fts.rowid
          JOIN accounts a ON a.id = e.account_id
          WHERE email_fts MATCH ? AND a.user_id = ?
          ORDER BY rank
          LIMIT 8
        `).all(ftsQuery, req.session.userId);
      } catch (_) { /* FTS can throw on malformed query — ignore */ }
    }

    const contextBlock = emails.map((e, i) => {
      const date = e.date ? new Date(e.date * 1000).toLocaleString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      }) : 'unknown date';
      const from = e.from_name ? `${e.from_name} <${e.from_email}>` : e.from_email;
      const body = (e.body_text || '').replace(/\s+/g, ' ').trim().slice(0, 600);
      return [
        `[Email ${i + 1}]`,
        `Date: ${date}`,
        `From: ${from}`,
        `To: ${e.to_addresses || ''}`,
        `Subject: ${e.subject || '(no subject)'}`,
        `Body: ${body || '(no body)'}`,
      ].join('\n');
    }).join('\n\n---\n\n');

    const { total } = db.prepare(`
      SELECT COUNT(*) AS total FROM emails e
      JOIN accounts a ON a.id = e.account_id
      WHERE a.user_id = ?
    `).get(req.session.userId);

    const today = new Date().toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    const reply = await ai.chatWithContext(message, safeHistory, contextBlock, { totalEmails: total, today });
    res.json({ ok: true, reply, emailsFound: emails.length });
  } catch (err) {
    console.error('[/api/ai/chat]', err.message);
    res.status(500).json({ error: err.message || 'Chat failed' });
  }
});

router.get('/status', (req, res) => {
  res.json({ available: ai.isAvailable() });
});

router.post('/label/:emailId', async (req, res) => {
  const email = db.prepare(`
    SELECT e.* FROM emails e JOIN accounts a ON a.id = e.account_id
    WHERE e.id = ? AND a.user_id = ?
  `).get(req.params.emailId, req.session.userId);
  if (!email) return res.status(404).json({ error: 'Not found' });
  if (!ai.isAvailable()) return res.status(503).json({ error: 'AI not configured' });

  const label = await ai.labelEmail(email.subject, email.body_html, email.body_text);
  if (label) {
    db.prepare('UPDATE emails SET ai_label = ?, ai_label_done = 1 WHERE id = ?').run(label, email.id);
    const userLabel = db.prepare(`
      SELECT l.* FROM labels l WHERE l.user_id = ? AND LOWER(l.name) = LOWER(?)
    `).get(req.session.userId, label);
    if (userLabel) {
      db.prepare('INSERT OR IGNORE INTO email_labels (email_id, label_id) VALUES (?, ?)').run(email.id, userLabel.id);
    }
  }
  res.json({ ok: true, label });
});

router.post('/label-bulk', async (req, res) => {
  let { ids } = req.body;
  if (!ids?.length) return res.status(400).json({ error: 'ids required' });
  if (!ai.isAvailable()) return res.status(503).json({ error: 'AI not configured' });
  ids = ids.slice(0, 100).map(Number).filter(n => Number.isInteger(n) && n > 0);

  const placeholders = ids.map(() => '?').join(',');
  const emails = db.prepare(`
    SELECT e.* FROM emails e JOIN accounts a ON a.id = e.account_id
    WHERE e.id IN (${placeholders}) AND a.user_id = ? AND e.ai_label_done = 0
  `).all(...ids, req.session.userId);

  res.json({ ok: true, queued: emails.length });

  (async () => {
    for (const email of emails) {
      try {
        const label = await ai.labelEmail(email.subject, email.body_html, email.body_text);
        if (label) {
          db.prepare('UPDATE emails SET ai_label = ?, ai_label_done = 1 WHERE id = ?').run(label, email.id);
          const userLabel = db.prepare('SELECT * FROM labels WHERE user_id = ? AND LOWER(name) = LOWER(?)').get(req.session.userId, label);
          if (userLabel) {
            db.prepare('INSERT OR IGNORE INTO email_labels (email_id, label_id) VALUES (?, ?)').run(email.id, userLabel.id);
          }
        }
        await new Promise(r => setTimeout(r, 150));
      } catch (err) {
        console.error('[AI] bulk label error:', err.message);
      }
    }
  })();
});

router.post('/summarize/:emailId', async (req, res) => {
  const email = db.prepare(`
    SELECT e.* FROM emails e JOIN accounts a ON a.id = e.account_id
    WHERE e.id = ? AND a.user_id = ?
  `).get(req.params.emailId, req.session.userId);
  if (!email) return res.status(404).json({ error: 'Not found' });
  if (!ai.isAvailable()) return res.status(503).json({ error: 'AI not configured' });

  if (email.ai_summary) return res.json({ summary: email.ai_summary });

  const summary = await ai.summarizeEmail(email.subject, email.body_html, email.body_text);
  if (summary) {
    db.prepare('UPDATE emails SET ai_summary = ? WHERE id = ?').run(summary, email.id);
  }
  res.json({ summary });
});

router.post('/compose', async (req, res) => {
  let { instruction, originalEmailId } = req.body;
  if (!instruction) return res.status(400).json({ error: 'instruction required' });
  if (typeof instruction !== 'string') return res.status(400).json({ error: 'instruction must be a string' });
  instruction = instruction.trim().slice(0, 2000);
  if (!ai.isAvailable()) return res.status(503).json({ error: 'AI not configured' });

  let originalEmailText = null;
  if (originalEmailId) {
    const email = db.prepare(`
      SELECT e.* FROM emails e JOIN accounts a ON a.id = e.account_id
      WHERE e.id = ? AND a.user_id = ?
    `).get(originalEmailId, req.session.userId);
    if (email) {
      originalEmailText = `Subject: ${email.subject}\nFrom: ${email.from_email}\n\n${email.body_text || ai.stripHtml(email.body_html)}`;
    }
  }

  const rules = db.prepare('SELECT rule_text FROM cursor_rules WHERE user_id = ? AND is_active = 1 ORDER BY priority DESC').all(req.session.userId);
  const cursorRulesText = rules.map(r => r.rule_text).join('\n');

  const draft = await ai.composeEmail(instruction, originalEmailText, cursorRulesText || null);
  res.json({ draft });
});

router.post('/cursor-rules/apply/:emailId', async (req, res) => {
  const email = db.prepare(`
    SELECT e.* FROM emails e JOIN accounts a ON a.id = e.account_id
    WHERE e.id = ? AND a.user_id = ?
  `).get(req.params.emailId, req.session.userId);
  if (!email) return res.status(404).json({ error: 'Not found' });
  if (!ai.isAvailable()) return res.status(503).json({ error: 'AI not configured' });

  const rules = db.prepare('SELECT * FROM cursor_rules WHERE user_id = ? AND is_active = 1').all(req.session.userId);
  if (!rules.length) return res.json({ actions: {} });

  const actions = await ai.applyCursorRules(rules, email);

  if (actions.label) db.prepare('UPDATE emails SET ai_label = ? WHERE id = ?').run(actions.label, email.id);
  if (actions.archive) db.prepare('UPDATE emails SET is_archived = 1 WHERE id = ?').run(email.id);
  if (actions.awaiting_reply) db.prepare('UPDATE emails SET awaiting_reply = 1 WHERE id = ?').run(email.id);

  res.json({ ok: true, actions });
});


router.get('/cursor-rules', (req, res) => {
  const rules = db.prepare('SELECT * FROM cursor_rules WHERE user_id = ? ORDER BY priority DESC, created_at DESC').all(req.session.userId);
  res.json(rules);
});

router.post('/cursor-rules', (req, res) => {
  const { title, rule_text, priority } = req.body;
  if (!title || !rule_text) return res.status(400).json({ error: 'title and rule_text required' });
  const safeTitle = String(title).trim().slice(0, 200);
  const safeRuleText = String(rule_text).trim().slice(0, 2000);
  const result = db.prepare(
    'INSERT INTO cursor_rules (user_id, title, rule_text, priority) VALUES (?, ?, ?, ?)'
  ).run(req.session.userId, safeTitle, safeRuleText, priority || 0);
  res.json({ ok: true, id: result.lastInsertRowid });
});

router.put('/cursor-rules/:id', (req, res) => {
  const rule = db.prepare('SELECT * FROM cursor_rules WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
  if (!rule) return res.status(404).json({ error: 'Not found' });
  const { title, rule_text, is_active, priority } = req.body;
  const safeTitle = title ? String(title).trim().slice(0, 200) : rule.title;
  const safeRuleText = rule_text ? String(rule_text).trim().slice(0, 2000) : rule.rule_text;
  db.prepare('UPDATE cursor_rules SET title = ?, rule_text = ?, is_active = ?, priority = ? WHERE id = ?')
    .run(safeTitle, safeRuleText, is_active !== undefined ? Number(is_active) : rule.is_active, priority ?? rule.priority, rule.id);
  res.json({ ok: true });
});

router.delete('/cursor-rules/:id', (req, res) => {
  db.prepare('DELETE FROM cursor_rules WHERE id = ? AND user_id = ?').run(req.params.id, req.session.userId);
  res.json({ ok: true });
});

module.exports = router;
