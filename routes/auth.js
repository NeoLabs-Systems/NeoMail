'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const { db, insertDefaultLabels } = require('../db/database');

const router = express.Router();
const SALT_ROUNDS = 12;

const _attempts = new Map();
function checkRateLimit(ip, maxAttempts = 10, windowMs = 15 * 60 * 1000) {
  const now = Date.now();
  const rec = _attempts.get(ip) || { count: 0, resetAt: now + windowMs };
  if (now > rec.resetAt) { rec.count = 1; rec.resetAt = now + windowMs; }
  else rec.count += 1;
  _attempts.set(ip, rec);
  if (rec.count > maxAttempts) {
    const retryAfter = Math.ceil((rec.resetAt - now) / 1000);
    return { limited: true, retryAfter };
  }
  return { limited: false };
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _attempts) { if (now > v.resetAt) _attempts.delete(k); }
}, 30 * 60 * 1000).unref();

router.post('/register', async (req, res) => {
  if (process.env.ALLOW_REGISTRATION === 'false') {
    return res.status(403).json({ error: 'Registration is currently disabled.' });
  }
  const ip = req.ip || req.socket.remoteAddress;
  const rl = checkRateLimit(ip, 5, 60 * 60 * 1000);
  if (rl.limited) {
    res.set('Retry-After', String(rl.retryAfter));
    return res.status(429).json({ error: 'Too many registration attempts. Try again later.' });
  }
  const { username, email, password } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'All fields required' });
  }
  if (String(username).length > 50) return res.status(400).json({ error: 'Username too long (max 50)' });
  if (String(email).length > 254) return res.status(400).json({ error: 'Email too long (max 254)' });
  if (String(password).length > 1000) return res.status(400).json({ error: 'Password too long (max 1000)' });
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  try {
    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const result = db.prepare(
      `INSERT INTO users (username, email, password) VALUES (?, ?, ?)`
    ).run(username.trim(), email.trim().toLowerCase(), hash);

    insertDefaultLabels(result.lastInsertRowid);

    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: 'Session error' });
      req.session.userId = result.lastInsertRowid;
      req.session.username = username.trim();
      req.session.save((saveErr) => {
        if (saveErr) return res.status(500).json({ error: 'Session save error' });
        res.json({ ok: true, username: username.trim() });
      });
    });
  } catch (err) {
    if (err.message?.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Username or email already exists' });
    }
    console.error('[AUTH] register error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/login', async (req, res) => {
  const ip = req.ip || req.socket.remoteAddress;
  const rl = checkRateLimit(ip, 15, 15 * 60 * 1000);
  if (rl.limited) {
    res.set('Retry-After', String(rl.retryAfter));
    return res.status(429).json({ error: 'Too many login attempts. Try again later.' });
  }
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'All fields required' });
  }
  if (String(username).length > 254) return res.status(400).json({ error: 'Credentials too long' });
  if (String(password).length > 1000) return res.status(400).json({ error: 'Credentials too long' });
  try {
    const user = db.prepare(
      `SELECT * FROM users WHERE username = ? OR email = ?`
    ).get(username.trim(), username.trim().toLowerCase());

    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    // 2FA Check
    if (user.totp_enabled) {
      const totpToken = typeof req.body.totp === 'string' ? req.body.totp.replace(/\s+/g, '') : '';
      if (!totpToken) return res.status(403).json({ "2fa_required": true });

      const verified = speakeasy.totp.verify({
        secret: user.totp_secret,
        encoding: 'base32',
        token: totpToken,
        window: 1
      });

      if (!verified) return res.status(401).json({ error: 'Invalid 2FA code' });
    }

    db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(Math.floor(Date.now() / 1000), user.id);

    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: 'Session error' });
      req.session.userId = user.id;
      req.session.username = user.username;
      req.session.save((saveErr) => {
        if (saveErr) return res.status(500).json({ error: 'Session save error' });
        res.json({ ok: true, username: user.username });
      });
    });
  } catch (err) {
    console.error('[AUTH] login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('mailneo.sid');
    res.json({ ok: true });
  });
});

router.post('/change-password', async (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Unauthorized' });
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'Both fields required' });
  }
  if (String(new_password).length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
  if (String(new_password).length > 1000) return res.status(400).json({ error: 'New password too long' });
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
    const valid = await bcrypt.compare(current_password, user.password);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });
    const hash = await bcrypt.hash(new_password, SALT_ROUNDS);
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, req.session.userId);
    res.json({ ok: true });
  } catch (err) {
    console.error('[AUTH] change-password error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/me', (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Not logged in' });
  const user = db.prepare('SELECT id, username, email, created_at, totp_enabled FROM users WHERE id = ?').get(req.session.userId);
  res.json({
    ...user,
    totp_enabled: !!user.totp_enabled
  });
});

/* ── 2FA endpoints ───────────────────────────────────── */

router.get('/2fa/generate', async (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Unauthorized' });
  const user = db.prepare('SELECT email, totp_enabled FROM users WHERE id = ?').get(req.session.userId);
  if (user.totp_enabled) return res.status(400).json({ error: '2FA is already enabled' });

  const secret = speakeasy.generateSecret({
    name: `MailNeo (${user.email})`
  });

  db.prepare('UPDATE users SET totp_secret = ? WHERE id = ?').run(secret.base32, req.session.userId);

  try {
    const dataUrl = await qrcode.toDataURL(secret.otpauth_url);
    res.json({ secret: secret.base32, qrcode: dataUrl });
  } catch (err) {
    res.status(500).json({ error: 'Error generating QR code' });
  }
});

router.post('/2fa/verify', (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Unauthorized' });
  const token = typeof req.body.token === 'string' ? req.body.token.replace(/\s+/g, '') : '';
  if (!token) return res.status(400).json({ error: 'Token is required' });

  const user = db.prepare('SELECT totp_secret, totp_enabled FROM users WHERE id = ?').get(req.session.userId);
  if (user.totp_enabled) return res.status(400).json({ error: '2FA is already enabled' });
  if (!user.totp_secret) return res.status(400).json({ error: '2FA not generated yet' });

  const verified = speakeasy.totp.verify({
    secret: user.totp_secret,
    encoding: 'base32',
    token: token,
    window: 1
  });

  if (verified) {
    db.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(req.session.userId);
    res.json({ ok: true, message: '2FA enabled successfully' });
  } else {
    res.status(400).json({ error: 'Invalid token' });
  }
});

router.post('/2fa/disable', async (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Unauthorized' });
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const token = typeof req.body.token === 'string' ? req.body.token.replace(/\s+/g, '') : '';

  if (!password || !token) return res.status(400).json({ error: 'Password and token are required' });

  const user = db.prepare('SELECT password, totp_secret, totp_enabled FROM users WHERE id = ?').get(req.session.userId);
  if (!user.totp_enabled) return res.status(400).json({ error: '2FA is not enabled' });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: 'Invalid password' });

  const verified = speakeasy.totp.verify({
    secret: user.totp_secret,
    encoding: 'base32',
    token: token,
    window: 1
  });

  if (verified) {
    db.prepare('UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?').run(req.session.userId);
    res.json({ ok: true, message: '2FA disabled successfully' });
  } else {
    res.status(400).json({ error: 'Invalid token' });
  }
});

module.exports = router;
