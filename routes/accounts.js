'use strict';

const express = require('express');
const { db } = require('../db/database');
const { encrypt, decrypt } = require('../services/crypto');
const { verifySmtp } = require('../services/smtp');
const { syncAccount, listFolders, startIdleWatcher, stopIdleWatcher } = require('../services/imap');

const router = express.Router();

function safeAccount(row) {
  if (!row) return null;
  const { encrypted_pass, ...rest } = row;
  return rest;
}

function makeNotifCallback(userId) {
  return async (acc) => {
    const latest = db.prepare(
      'SELECT subject, from_name, from_email FROM emails WHERE account_id = ? ORDER BY id DESC LIMIT 1'
    ).get(acc.id);
    db.prepare('INSERT INTO notifications (user_id, account_id, type, payload) VALUES (?, ?, ?, ?)')
      .run(userId, acc.id, 'new_mail', JSON.stringify({
        accountId:  acc.id,
        subject:    latest?.subject    || null,
        from_name:  latest?.from_name  || null,
        from_email: latest?.from_email || null,
      }));
  };
}

router.get('/', (req, res) => {
  const accounts = db.prepare('SELECT * FROM accounts WHERE user_id = ?').all(req.session.userId);
  res.json(accounts.map(safeAccount));
});

router.post('/', async (req, res) => {
  const { label, email, password, imap_host, imap_port, imap_secure, smtp_host, smtp_port, smtp_secure, is_default } = req.body;
  if (!email || !password || !imap_host || !smtp_host) {
    return res.status(400).json({ error: 'email, password, imap_host, smtp_host required' });
  }
  const safeImapPort = Number(imap_port) || 993;
  const safeSmtpPort = Number(smtp_port) || 587;
  if (safeImapPort < 1 || safeImapPort > 65535 || safeSmtpPort < 1 || safeSmtpPort > 65535) {
    return res.status(400).json({ error: 'Invalid port number' });
  }
  try {
    const encPass = encrypt(password);
    const result = db.prepare(`
      INSERT INTO accounts (user_id, label, email, imap_host, imap_port, imap_secure, smtp_host, smtp_port, smtp_secure, encrypted_pass, is_default)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.session.userId,
      label || email,
      email.trim().toLowerCase(),
      imap_host, safeImapPort, imap_secure ? 1 : 0,
      smtp_host, safeSmtpPort, smtp_secure ? 1 : 0,
      encPass,
      is_default ? 1 : 0
    );

    if (is_default) {
      db.prepare('UPDATE accounts SET is_default = 0 WHERE user_id = ? AND id != ?')
        .run(req.session.userId, result.lastInsertRowid);
    }

    const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(result.lastInsertRowid);

    syncAccount(account).catch(err => console.error('[SYNC] Initial sync error:', err.message));

    startIdleWatcher(account, makeNotifCallback(req.session.userId));

    res.json({ ok: true, account: safeAccount(account) });
  } catch (err) {
    console.error('[ACCOUNTS] add error:', err);
    if (err.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Account already exists' });
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', (req, res) => {
  const account = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
  if (!account) return res.status(404).json({ error: 'Not found' });

  const { label, email, password, imap_host, imap_port, imap_secure, smtp_host, smtp_port, smtp_secure, is_default } = req.body;
  const encPass = password ? encrypt(password) : account.encrypted_pass;

  const newImapPort = Number(imap_port) || account.imap_port;
  const newSmtpPort = Number(smtp_port) || account.smtp_port;
  if (newImapPort < 1 || newImapPort > 65535 || newSmtpPort < 1 || newSmtpPort > 65535) {
    return res.status(400).json({ error: 'Invalid port number' });
  }

  db.prepare(`
    UPDATE accounts SET
      label = ?, email = ?, imap_host = ?, imap_port = ?, imap_secure = ?,
      smtp_host = ?, smtp_port = ?, smtp_secure = ?, encrypted_pass = ?, is_default = ?
    WHERE id = ?
  `).run(
    label || account.label,
    email || account.email,
    imap_host || account.imap_host, newImapPort, imap_secure !== undefined ? (imap_secure ? 1 : 0) : account.imap_secure,
    smtp_host || account.smtp_host, newSmtpPort, smtp_secure !== undefined ? (smtp_secure ? 1 : 0) : account.smtp_secure,
    encPass,
    is_default ? 1 : account.is_default,
    account.id
  );

  if (is_default) {
    db.prepare('UPDATE accounts SET is_default = 0 WHERE user_id = ? AND id != ?').run(req.session.userId, account.id);
  }

  stopIdleWatcher(account.id);
  const updatedAccount = db.prepare('SELECT * FROM accounts WHERE id = ?').get(account.id);
  startIdleWatcher(updatedAccount, makeNotifCallback(req.session.userId));

  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const account = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
  if (!account) return res.status(404).json({ error: 'Not found' });
  stopIdleWatcher(account.id);
  db.prepare('DELETE FROM accounts WHERE id = ?').run(account.id);
  res.json({ ok: true });
});

router.post('/:id/sync', async (req, res) => {
  const account = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
  if (!account) return res.status(404).json({ error: 'Not found' });
  try {
    const count = await syncAccount(account);
    res.json({ ok: true, newEmails: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/verify', async (req, res) => {
  const account = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
  if (!account) return res.status(404).json({ error: 'Not found' });
  try {
    await verifySmtp(account);
    res.json({ ok: true, message: 'SMTP connection verified' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/:id/folders', async (req, res) => {
  const account = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
  if (!account) return res.status(404).json({ error: 'Not found' });
  try {
    const folders = await listFolders(account);
    res.json(folders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
