'use strict';

require('dotenv').config();

const express = require('express');
const path = require('path');
const helmet = require('helmet');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);

const { requireAuth, requireNoAuth } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const emailRoutes = require('./routes/emails');
const accountRoutes = require('./routes/accounts');
const aiRoutes = require('./routes/ai');
const settingsRoutes = require('./routes/settings');

const { db } = require('./db/database');
const { startIdleWatcher, syncAccount } = require('./services/imap');
const { labelEmail, summarizeEmail, shouldNotify, analyzeEmail, isAvailable: aiIsAvailable } = require('./services/ai');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],  // inline scripts for SPA
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'https:', 'http:'],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],
    }
  },
  crossOriginEmbedderPolicy: false
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

if (!process.env.SESSION_SECRET) {
  console.warn('[WARN] SESSION_SECRET not set – using insecure default. Run: node scripts/setup.js');
}

const sessionStore = new SQLiteStore({
  db: 'sessions.db',
  dir: path.join(__dirname, 'data'),
  table: 'sessions'
});

app.use(session({
  name: 'mailneo.sid',
  secret: process.env.SESSION_SECRET || 'insecure-default-please-change',
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  if (req.session?.userId) return res.redirect('/app');
  res.redirect('/login');
});

app.get('/login', requireNoAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/app', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

app.use('/api/auth', authRoutes);
app.use('/api/emails', requireAuth, emailRoutes);
app.use('/api/accounts', requireAuth, accountRoutes);
app.use('/api/ai', requireAuth, aiRoutes);
app.use('/api/settings', requireAuth, settingsRoutes);

// Server-Sent Events for real-time notifications
app.get('/api/events', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const userId = req.session.userId;
  let lastCheck = Date.now();

  const interval = setInterval(() => {
    const notifs = db.prepare(
      'SELECT n.payload FROM notifications n WHERE n.user_id = ? AND n.seen = 0 AND n.created_at > ?'
    ).all(userId, Math.floor(lastCheck / 1000));

    if (notifs.length > 0) {
        let firstPayload = {};
      try { firstPayload = JSON.parse(notifs[0].payload || '{}'); } catch (_) {}
      res.write(`data: ${JSON.stringify({
        type: 'new_mail',
        count: notifs.length,
        from: firstPayload.from_name || firstPayload.from_email || null,
        subject: firstPayload.subject || null
      })}\n\n`);
      db.prepare('UPDATE notifications SET seen = 1 WHERE user_id = ? AND seen = 0').run(userId);
    } else {
      res.write(': heartbeat\n\n');
    }
    lastCheck = Date.now();
  }, 8000);

  req.on('close', () => clearInterval(interval));
});

app.use((err, req, res, _next) => {
  console.error('[SERVER ERROR]', err);
  res.status(500).json({ error: 'Internal server error' });
});

function startAllIdleWatchers() {
  const accounts = db.prepare('SELECT * FROM accounts').all();
  for (const account of accounts) {
    startIdleWatcher(account, async (acc) => {
      const userId = db.prepare('SELECT user_id FROM accounts WHERE id = ?').get(acc.id)?.user_id;
      if (!userId) return;

      const latest = db.prepare(
        'SELECT id, subject, from_name, from_email, body_text FROM emails WHERE account_id = ? ORDER BY id DESC LIMIT 1'
      ).get(acc.id);

      const settings = {};
      for (const row of db.prepare('SELECT key, value FROM app_settings WHERE user_id = ?').all(userId)) {
        try { settings[row.key] = JSON.parse(row.value); } catch (_) { settings[row.key] = row.value; }
      }

      let skipNotif = false;
      let latestEmailLabel = null;

      if (aiIsAvailable() && settings.notif_ai_filter && settings.ai_auto_label && latest) {
        const { label, notify } = await analyzeEmail(latest.subject, null, latest.body_text);
        if (!notify) skipNotif = true;
        latestEmailLabel = label;
      } else if (settings.notif_ai_filter && aiIsAvailable()) {
        const important = await shouldNotify(latest?.subject, latest?.body_text);
        if (!important) skipNotif = true;
      }

      if (!skipNotif) {
        db.prepare('INSERT INTO notifications (user_id, account_id, type, payload) VALUES (?, ?, ?, ?)')
          .run(userId, acc.id, 'new_mail', JSON.stringify({
            accountId:  acc.id,
            subject:    latest?.subject    || null,
            from_name:  latest?.from_name  || null,
            from_email: latest?.from_email || null,
          }));
      }

      if (!aiIsAvailable()) return;
      if (settings.ai_auto_label || settings.ai_auto_summarize) {
        const newEmails = db.prepare(
          'SELECT * FROM emails WHERE account_id = ? AND ai_label IS NULL ORDER BY date DESC LIMIT 20'
        ).all(acc.id);

        for (const email of newEmails) {
          try {
            if (settings.ai_auto_label) {
                const label = (latestEmailLabel && email.id === latest?.id)
                ? latestEmailLabel
                : await labelEmail(email.subject, email.body_html, email.body_text);
              if (label) db.prepare('UPDATE emails SET ai_label = ? WHERE id = ?').run(label, email.id);
            }
            if (settings.ai_auto_summarize && (email.body_text || email.body_html)) {
              const summary = await summarizeEmail(email.subject, email.body_html, email.body_text);
              if (summary) db.prepare('UPDATE emails SET ai_summary = ? WHERE id = ?').run(summary, email.id);
            }
          } catch (aiErr) {
            console.error('[AUTO-AI]', aiErr.message);
          }
        }
      }
    });
  }
  if (accounts.length > 0) {
    console.log(`[IDLE] Started watchers for ${accounts.length} account(s)`);
  }
}

app.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════╗`);
  console.log(`║  MailNeo is running                   ║`);
  console.log(`║  → http://localhost:${PORT}             ║`);
  console.log(`╚══════════════════════════════════════╝\n`);

  if (!process.env.ENCRYPTION_KEY) {
    console.warn('⚠  ENCRYPTION_KEY not set. Run: node scripts/setup.js\n');
  }

  startAllIdleWatchers();

  setInterval(async () => {
    const accounts = db.prepare('SELECT * FROM accounts').all();
    for (const account of accounts) {
      try { await syncAccount(account); } catch (err) {
        console.error(`[PERIODIC SYNC] Account ${account.id}:`, err.message);
      }
    }
    // Prune seen notifications older than 7 days
    db.prepare('DELETE FROM notifications WHERE seen = 1 AND created_at < ?')
      .run(Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60);
  }, 5 * 60 * 1000);
});

module.exports = app;
