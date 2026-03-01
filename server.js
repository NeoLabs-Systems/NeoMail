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
const oauthRoutes = require('./routes/oauth');
const mcpRoutes   = require('./routes/mcp');

const { db } = require('./db/database');
const { startIdleWatcher, syncAccount, moveEmail, getSpecialFolders } = require('./services/imap');
const { sendEmail } = require('./services/smtp');
const { summarizeEmail, shouldNotify, analyzeEmail, isAvailable: aiIsAvailable } = require('./services/ai');
const backup = require('./services/backup');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    }
  },
  frameguard: { action: 'deny' },
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
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  if (req.session?.userId) return res.redirect('/app');
  res.redirect('/login');
});

app.get('/login', requireNoAuth, (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/register', requireNoAuth, (req, res) => {
  res.redirect('/login');
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: Math.floor(process.uptime()) });
});

app.get('/app', requireAuth, (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

app.use('/api/auth', authRoutes);
app.use('/api/emails', requireAuth, emailRoutes);
app.use('/api/accounts', requireAuth, accountRoutes);
app.use('/api/ai', requireAuth, aiRoutes);
app.use('/api/settings', requireAuth, settingsRoutes);

// ── MCP & OAuth routes ────────────────────────────────
// Well-known metadata (no auth required)
app.use('/', oauthRoutes);
// MCP server (Bearer token auth handled in the router)
app.use('/mcp', mcpRoutes);
// OAuth consent page (served as static file; needs session auth)
app.get('/mcp-authorize', requireAuth, (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'public', 'mcp-authorize.html'));
});

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

async function runAutoAI(account, cachedAnalysis = null) {
  if (!aiIsAvailable()) return;
  const userId = db.prepare('SELECT user_id FROM accounts WHERE id = ?').get(account.id)?.user_id;
  if (!userId) return;

  const settings = {};
  for (const row of db.prepare('SELECT key, value FROM app_settings WHERE user_id = ?').all(userId)) {
    try { settings[row.key] = JSON.parse(row.value); } catch (_) { settings[row.key] = row.value; }
  }

  const needsLabelOrAwaiting = settings.ai_auto_label || settings.ai_auto_awaiting;
  if (!needsLabelOrAwaiting && !settings.ai_auto_summarize) return;

  // Only pick emails that haven't been AI-processed yet
  const newEmails = db.prepare(
    'SELECT * FROM emails WHERE account_id = ? AND ai_label_done = 0 ORDER BY date DESC LIMIT 20'
  ).all(account.id);
  if (!newEmails.length) return;

  for (const email of newEmails) {
    try {
      if (needsLabelOrAwaiting) {
        const useCache = cachedAnalysis && cachedAnalysis.emailId === email.id;
        const { label, notify, awaiting_reply } = useCache
          ? cachedAnalysis.result
          : await analyzeEmail(email.subject, email.body_html, email.body_text);

        if (settings.ai_auto_label && label) {
          db.prepare('UPDATE emails SET ai_label = ?, ai_label_done = 1 WHERE id = ?').run(label, email.id);
        } else {
          db.prepare('UPDATE emails SET ai_label_done = 1 WHERE id = ?').run(email.id);
        }

        if (settings.ai_auto_awaiting) {
          db.prepare('UPDATE emails SET awaiting_reply = ? WHERE id = ?').run(awaiting_reply ? 1 : 0, email.id);
        }

        // Auto-archive emails the AI considers unimportant (notify === false)
        if (settings.ai_auto_archive_unimportant && !notify && !email.is_archived) {
          db.prepare('UPDATE emails SET is_archived = 1 WHERE id = ?').run(email.id);
          getSpecialFolders(account)
            .then(special => moveEmail(account, email.folder, email.uid, special.archive || 'Archive'))
            .catch(() => {});
        }
      }

      if (settings.ai_auto_summarize && (email.body_text || email.body_html)) {
        const summary = await summarizeEmail(email.subject, email.body_html, email.body_text);
        if (summary) db.prepare('UPDATE emails SET ai_summary = ? WHERE id = ?').run(summary, email.id);
      }

      await new Promise(r => setTimeout(r, 150));
    } catch (aiErr) {
      console.error('[AUTO-AI]', aiErr.message);
    }
  }
}

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
      let latestAnalysis = null;

      if (aiIsAvailable() && settings.notif_ai_filter && (settings.ai_auto_label || settings.ai_auto_awaiting) && latest) {
        latestAnalysis = await analyzeEmail(latest.subject, null, latest.body_text);
        if (!latestAnalysis.notify) skipNotif = true;
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

      const cached = (latestAnalysis && latest) ? { emailId: latest.id, result: latestAnalysis } : null;
      runAutoAI(acc, cached).catch(err => console.error('[AUTO-AI IDLE]', err.message));
    });
  }
  if (accounts.length > 0) {
    console.log(`[IDLE] Started watchers for ${accounts.length} account(s)`);
  }
}

app.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════╗`);
  console.log(`║  NeoMail is running                    ║`);
  console.log(`║  → http://localhost:${PORT}             ║`);
  console.log(`╚══════════════════════════════════════╝\n`);

  if (!process.env.ENCRYPTION_KEY) {
    console.warn('⚠  ENCRYPTION_KEY not set. Run: node scripts/setup.js\n');
  }

  startAllIdleWatchers();

  // Initial backup on launch, then every 6 hours
  if (backup.isEnabled()) {
    backup.runBackup().catch(err => console.error('[BACKUP]', err.message));
    setInterval(() => backup.runBackup().catch(err => console.error('[BACKUP]', err.message)), 6 * 60 * 60 * 1000);
  }

  setInterval(async () => {
    const accounts = db.prepare('SELECT * FROM accounts').all();
    for (const account of accounts) {
      try { await syncAccount(account); } catch (err) {
        console.error(`[PERIODIC SYNC] Account ${account.id}:`, err.message);
      }
      runAutoAI(account).catch(err => console.error(`[AUTO-AI SYNC] Account ${account.id}:`, err.message));
    }
    db.prepare('DELETE FROM notifications WHERE seen = 1 AND created_at < ?')
      .run(Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60);

    db.prepare('DELETE FROM oauth_codes WHERE used = 1 OR expires_at < ?')
      .run(Math.floor(Date.now() / 1000));

    db.prepare('UPDATE emails SET snoozed_until = NULL WHERE snoozed_until IS NOT NULL AND snoozed_until <= ?')
      .run(Math.floor(Date.now() / 1000));

    const dueMails = db.prepare('SELECT * FROM scheduled_emails WHERE send_at <= ?')
      .all(Math.floor(Date.now() / 1000));
    for (const mail of dueMails) {
      try {
        const account = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(mail.account_id, mail.user_id);
        if (account) {
          await sendEmail(account, {
            to: mail.to_addr,
            cc: mail.cc_addr || undefined,
            bcc: mail.bcc_addr || undefined,
            subject: mail.subject,
            text: mail.body_text,
            html: mail.body_html,
            inReplyTo: mail.in_reply_to || undefined,
          });
          console.log(`[SCHEDULED] Sent email ${mail.id} to ${mail.to_addr}`);
        }
      } catch (err) {
        console.error(`[SCHEDULED SEND] email ${mail.id}:`, err.message);
      }
      db.prepare('DELETE FROM scheduled_emails WHERE id = ?').run(mail.id);
    }
  }, 5 * 60 * 1000);
});

module.exports = app;
