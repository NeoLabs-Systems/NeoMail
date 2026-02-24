'use strict';

const https = require('https');
const http = require('http');
const express = require('express');
const { db } = require('../db/database');
const { sendEmail } = require('../services/smtp');
const { setReadFlag, moveEmail, getSpecialFolders } = require('../services/imap');

function isValidUnsubscribeUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const h = u.hostname.toLowerCase();
    // Block IPv4 private/loopback
    if (['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(h)) return false;
    if (h.startsWith('10.')) return false;
    if (h.startsWith('192.168.')) return false;
    // RFC 1918: 172.16.0.0/12 (172.16.x.x – 172.31.x.x)
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
    // Link-local (169.254.x.x) – covers AWS/GCP/Azure instance metadata endpoint
    if (h.startsWith('169.254.')) return false;
    // Block IPv6 loopback, link-local, unique-local, and IPv4-mapped
    if (h === '[::1]') return false;
    if (h.startsWith('[fe80:') || h.startsWith('[fc') || h.startsWith('[fd')) return false;
    if (h.startsWith('[::ffff:')) return false;
    // Block bare IPv6 brackets wrapping private addresses
    if (h.startsWith('[') && (h.includes('127.') || h.includes('192.168') || h.includes('10.'))) return false;
    return true;
  } catch (_) {
    return false;
  }
}

const router = express.Router();

function getUserEmail(userId, emailId) {
  return db.prepare(`
    SELECT e.*, a.user_id, a.label as account_label, a.email as account_email
    FROM emails e
    JOIN accounts a ON a.id = e.account_id
    WHERE e.id = ? AND a.user_id = ?
  `).get(emailId, userId);
}

router.get('/', (req, res) => {
  const {
    folder = 'INBOX', account_id, is_read, is_starred, is_archived,
    is_trash, awaiting_reply, label, limit = 50, offset = 0,
    // structured search params (parsed by frontend from operator syntax)
    from, subject: subjectQ, has_attachment, after, before,
  } = req.query;

  let { search } = req.query;

  let sql = `
    SELECT e.id, e.account_id, e.message_id, e.uid, e.folder, e.subject,
           e.from_name, e.from_email, e.to_addresses, e.date, e.is_read,
           e.is_starred, e.is_archived, e.is_trash, e.is_sent, e.awaiting_reply,
           e.ai_label, e.ai_summary, e.unsubscribe_url,
           a.label as account_label, a.email as account_email
    FROM emails e
    JOIN accounts a ON a.id = e.account_id
    WHERE a.user_id = ?
  `;
  const params = [req.session.userId];

  if (account_id) { sql += ' AND e.account_id = ?'; params.push(account_id); }

  // Special views
  if (folder === 'awaiting') {
    sql += ' AND e.awaiting_reply = 1 AND e.is_trash = 0 AND e.is_archived = 0';
  } else if (folder === 'starred') {
    sql += ' AND e.is_starred = 1 AND e.is_trash = 0';
  } else if (folder === 'sent') {
    sql += ' AND e.is_sent = 1';
  } else if (folder === 'trash') {
    sql += ' AND e.is_trash = 1';
  } else if (folder === 'archive') {
    sql += ' AND e.is_archived = 1 AND e.is_trash = 0';
  } else if (folder === 'all') {
    sql += ' AND e.is_trash = 0';
  } else {
    sql += ' AND e.folder = ? AND e.is_archived = 0 AND e.is_trash = 0';
    params.push(folder);
  }

  if (is_read !== undefined) { sql += ' AND e.is_read = ?'; params.push(Number(is_read)); }
  if (is_starred !== undefined) { sql += ' AND e.is_starred = ?'; params.push(Number(is_starred)); }

  if (label) {
    sql += ` AND e.id IN (
      SELECT el.email_id FROM email_labels el
      JOIN labels l ON l.id = el.label_id
      WHERE l.name = ? AND l.user_id = ?
    )`;
    params.push(label, req.session.userId);
  }

  if (search) {    const q = `%${String(search).slice(0, 200)}%`;
    sql += ' AND (e.subject LIKE ? OR e.from_email LIKE ? OR e.from_name LIKE ? OR e.body_text LIKE ?)';
    params.push(q, q, q, q);
  }
  if (from)      { sql += ' AND e.from_email LIKE ?'; params.push(`%${String(from).slice(0,200)}%`); }
  if (subjectQ)  { sql += ' AND e.subject LIKE ?';    params.push(`%${String(subjectQ).slice(0,200)}%`); }
  if (has_attachment === '1') {
    sql += ' AND EXISTS (SELECT 1 FROM email_attachments ea WHERE ea.email_id = e.id)';
  }
  if (after)  { const ts = Math.floor(new Date(after).getTime()  / 1000); if (!isNaN(ts)) { sql += ' AND e.date >= ?'; params.push(ts); } }
  if (before) { const ts = Math.floor(new Date(before).getTime() / 1000); if (!isNaN(ts)) { sql += ' AND e.date <= ?'; params.push(ts); } }

  const safeLimit = Math.min(Number(limit) || 50, 500);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  sql += ' ORDER BY e.date DESC LIMIT ? OFFSET ?';
  params.push(safeLimit, safeOffset);

  const emails = db.prepare(sql).all(...params);

  const unreadCounts = db.prepare(`
    SELECT e.folder, COUNT(*) as count FROM emails e
    JOIN accounts a ON a.id = e.account_id
    WHERE a.user_id = ? AND e.is_read = 0 AND e.is_trash = 0 AND e.is_archived = 0
    GROUP BY e.folder
  `).all(req.session.userId);

  res.json({ emails, unreadCounts });
});

router.get('/contacts', (req, res) => {
  const q = `%${String(req.query.q || '').slice(0, 100)}%`;
  const rows = db.prepare(`
    SELECT DISTINCT e.from_email, e.from_name
    FROM emails e JOIN accounts a ON a.id = e.account_id
    WHERE a.user_id = ? AND e.is_sent = 0
      AND (e.from_email LIKE ? OR e.from_name LIKE ?)
    GROUP BY e.from_email
    ORDER BY MAX(e.date) DESC
    LIMIT 10
  `).all(req.session.userId, q, q);
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const email = getUserEmail(req.session.userId, req.params.id);
  if (!email) return res.status(404).json({ error: 'Not found' });

  if (!email.is_read) {
    db.prepare('UPDATE emails SET is_read = 1 WHERE id = ?').run(email.id);
    const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(email.account_id);
    if (account && email.uid) {
      setReadFlag(account, email.folder, email.uid, true).catch(console.error);
    }
  }

  const attachments = db.prepare(
    'SELECT id, filename, content_type, size FROM email_attachments WHERE email_id = ?'
  ).all(email.id);

  const labels = db.prepare(`
    SELECT l.id, l.name, l.color FROM labels l
    JOIN email_labels el ON el.label_id = l.id
    WHERE el.email_id = ?
  `).all(email.id);

  res.json({ ...email, attachments, labels });
});

router.patch('/:id', (req, res) => {
  const email = getUserEmail(req.session.userId, req.params.id);
  if (!email) return res.status(404).json({ error: 'Not found' });

  const allowed = ['is_read', 'is_starred', 'is_archived', 'is_trash', 'is_spam', 'awaiting_reply', 'ai_label', 'ai_summary'];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  if (updates.ai_label !== undefined)   updates.ai_label   = String(updates.ai_label).slice(0, 100);
  if (updates.ai_summary !== undefined) updates.ai_summary = String(updates.ai_summary).slice(0, 1000);

  if (Object.keys(updates).length === 0) return res.json({ ok: true });

  const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE emails SET ${setClauses} WHERE id = ?`).run(...Object.values(updates), email.id);

  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(email.account_id);
  if (account && email.uid) {
    if (updates.is_read !== undefined) {
      setReadFlag(account, email.folder, email.uid, updates.is_read === 1).catch(console.error);
    }
    if (updates.is_archived === 1) {
      moveEmail(account, email.folder, email.uid, 'Archive').catch(console.error);
    }
    if (updates.is_trash === 1) {
      moveEmail(account, email.folder, email.uid, 'Trash').catch(console.error);
    }
  }

  res.json({ ok: true });
});

router.post('/bulk', (req, res) => {
  const { ids, action } = req.body;
  if (!ids?.length || !action) return res.status(400).json({ error: 'ids and action required' });

  const allowed = ['archive', 'trash', 'read', 'unread', 'star', 'unstar', 'delete'];
  if (!allowed.includes(action)) return res.status(400).json({ error: 'Invalid action' });

  const validatedIds = ids.slice(0, 500).map(Number).filter(n => Number.isInteger(n) && n > 0);
  if (!validatedIds.length) return res.status(400).json({ error: 'No valid ids' });

  const placeholders = validatedIds.map(() => '?').join(',');
  const emails = db.prepare(`
    SELECT e.* FROM emails e JOIN accounts a ON a.id = e.account_id
    WHERE e.id IN (${placeholders}) AND a.user_id = ?
  `).all(...validatedIds, req.session.userId);

  if (emails.length === 0) return res.status(404).json({ error: 'No emails found' });

  const validIds = emails.map(e => e.id);
  const idPlaceholders = validIds.map(() => '?').join(',');

  const actionMap = {
    archive: `UPDATE emails SET is_archived = 1 WHERE id IN (${idPlaceholders})`,
    trash: `UPDATE emails SET is_trash = 1 WHERE id IN (${idPlaceholders})`,
    read: `UPDATE emails SET is_read = 1 WHERE id IN (${idPlaceholders})`,
    unread: `UPDATE emails SET is_read = 0 WHERE id IN (${idPlaceholders})`,
    star: `UPDATE emails SET is_starred = 1 WHERE id IN (${idPlaceholders})`,
    unstar: `UPDATE emails SET is_starred = 0 WHERE id IN (${idPlaceholders})`,
    delete: `DELETE FROM emails WHERE id IN (${idPlaceholders})`
  };

  db.prepare(actionMap[action]).run(...validIds);
  res.json({ ok: true, affected: validIds.length, ids: validIds });
});

router.post('/send', async (req, res) => {
  const { account_id, to, cc, bcc, subject, text, html, replyTo, inReplyTo, references, attachments } = req.body;
  if (!account_id || !to || !subject) {    return res.status(400).json({ error: 'account_id, to, subject required' });
  }
  if (String(subject).length > 1000 || String(to).length > 2000) {
    return res.status(400).json({ error: 'subject or to field too long' });
  }

  const account = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(account_id, req.session.userId);
  if (!account) return res.status(404).json({ error: 'Account not found' });

  // Strip any path/href from attachments – nodemailer would read local files or
  // fetch remote URLs if those properties are present, enabling LFI/SSRF.
  const safeAttachments = Array.isArray(attachments)
    ? attachments.map(({ filename, content, contentType, encoding }) => ({ filename, content, contentType, encoding }))
    : [];

  try {
    const info = await sendEmail(account, { to, cc, bcc, subject, text, html, replyTo, inReplyTo, references, attachments: safeAttachments });

    // Save sent email to DB
    db.prepare(`
      INSERT OR IGNORE INTO emails
        (account_id, message_id, folder, subject, from_email, from_name, to_addresses, date, body_text, body_html, is_read, is_sent)
      VALUES (?, ?, 'Sent', ?, ?, ?, ?, ?, ?, ?, 1, 1)
    `).run(
      account.id,
      info.messageId || `sent-${Date.now()}`,
      subject, account.email, account.label || account.email,
      to, Math.floor(Date.now() / 1000),
      text || '', html || null
    );

    res.json({ ok: true, messageId: info.messageId });
  } catch (err) {
    console.error('[SEND] error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/attachment/:attId', (req, res) => {
  const email = getUserEmail(req.session.userId, req.params.id);
  if (!email) return res.status(404).json({ error: 'Not found' });

  const att = db.prepare('SELECT * FROM email_attachments WHERE id = ? AND email_id = ?').get(req.params.attId, email.id);
  if (!att) return res.status(404).json({ error: 'Attachment not found' });

  const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024; // 50 MB
  if (att.size > MAX_ATTACHMENT_BYTES) {
    return res.status(413).json({ error: 'Attachment too large to serve' });
  }

  // Sanitize filename to prevent header injection (strip " and control chars)
  const safeFilename = (att.filename || 'attachment').replace(/["\r\n\x00-\x1f]/g, '_');
  // Only serve known-safe MIME types; fall back to octet-stream to avoid
  // the browser rendering HTML/SVG/script attachments.
  const SAFE_TYPES = new Set([
    'application/pdf', 'application/zip', 'application/gzip',
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'text/plain', 'text/csv',
    'application/json',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/msword', 'application/vnd.ms-excel',
  ]);
  const contentType = SAFE_TYPES.has(att.content_type) ? att.content_type : 'application/octet-stream';
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
  res.send(att.data);
});

router.post('/unsubscribe', async (req, res) => {
  const { ids } = req.body;
  if (!ids?.length) return res.status(400).json({ error: 'ids required' });

  const validatedIds = ids.slice(0, 500).map(Number).filter(n => Number.isInteger(n) && n > 0);
  if (!validatedIds.length) return res.status(400).json({ error: 'No valid ids' });

  const placeholders = validatedIds.map(() => '?').join(',');
  const emails = db.prepare(`
    SELECT e.* FROM emails e JOIN accounts a ON a.id = e.account_id
    WHERE e.id IN (${placeholders}) AND a.user_id = ? AND e.unsubscribe_url IS NOT NULL
  `).all(...validatedIds, req.session.userId);

  const results = [];
  for (const email of emails) {
    try {
      if (!isValidUnsubscribeUrl(email.unsubscribe_url)) throw new Error('Invalid URL');
      const client = email.unsubscribe_url.startsWith('https') ? https : http;
      await new Promise((resolve) => {
        const r = client.get(email.unsubscribe_url, { timeout: 5000 }, () => resolve());
        r.on('error', () => resolve());
        r.on('timeout', () => { r.destroy(); resolve(); });
      });
      db.prepare('UPDATE emails SET is_archived = 1 WHERE id = ?').run(email.id);
      results.push({ id: email.id, status: 'unsubscribed' });
    } catch (_) {
      results.push({ id: email.id, status: 'failed' });
    }
  }

  res.json({ ok: true, results });
});

router.post('/:id/move', async (req, res) => {
  const email = getUserEmail(req.session.userId, req.params.id);
  if (!email) return res.status(404).json({ error: 'Not found' });
  const folder = String(req.body.folder || '').trim().slice(0, 300);
  if (!folder) return res.status(400).json({ error: 'folder required' });
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(email.account_id);
  if (account && email.uid) {
    try { await moveEmail(account, email.folder, email.uid, folder); } catch (err) { console.error('[MOVE]', err.message); }
  }
  db.prepare('UPDATE emails SET folder = ?, is_archived = 0, is_trash = 0 WHERE id = ?').run(folder, email.id);
  res.json({ ok: true });
});

router.post('/:id/spam', async (req, res) => {
  const email = getUserEmail(req.session.userId, req.params.id);
  if (!email) return res.status(404).json({ error: 'Not found' });
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(email.account_id);
  let spamFolder = 'Spam';
  if (account) {
    try {
      const special = await getSpecialFolders(account);
      spamFolder = special.spam || 'Spam';
    } catch (_) {}
    if (email.uid) {
      try { await moveEmail(account, email.folder, email.uid, spamFolder); } catch (err) { console.error('[SPAM]', err.message); }
    }
  }
  db.prepare('UPDATE emails SET is_spam = 1, is_trash = 1 WHERE id = ?').run(email.id);
  res.json({ ok: true });
});

router.get('/stats/summary', (req, res) => {
  const userId = req.session.userId;
  const stats = {
    unread: db.prepare(`SELECT COUNT(*) as c FROM emails e JOIN accounts a ON a.id=e.account_id WHERE a.user_id=? AND e.is_read=0 AND e.is_trash=0 AND e.is_archived=0`).get(userId)?.c || 0,
    starred: db.prepare(`SELECT COUNT(*) as c FROM emails e JOIN accounts a ON a.id=e.account_id WHERE a.user_id=? AND e.is_starred=1 AND e.is_trash=0`).get(userId)?.c || 0,
    awaiting: db.prepare(`SELECT COUNT(*) as c FROM emails e JOIN accounts a ON a.id=e.account_id WHERE a.user_id=? AND e.awaiting_reply=1 AND e.is_trash=0`).get(userId)?.c || 0,
    total: db.prepare(`SELECT COUNT(*) as c FROM emails e JOIN accounts a ON a.id=e.account_id WHERE a.user_id=? AND e.is_trash=0`).get(userId)?.c || 0,
  };
  res.json(stats);
});

router.get('/notifications/pending', (req, res) => {
  const notifs = db.prepare(
    'SELECT * FROM notifications WHERE user_id = ? AND seen = 0 ORDER BY created_at DESC LIMIT 20'
  ).all(req.session.userId);
  if (notifs.length) {
    db.prepare('UPDATE notifications SET seen = 1 WHERE user_id = ? AND seen = 0').run(req.session.userId);
  }
  res.json(notifs);
});

module.exports = router;
