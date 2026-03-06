'use strict';

/**
 * MCP Server – Streamable HTTP transport (spec 2025-03-26)
 *
 * Single endpoint:  POST /mcp
 * Protocol:         JSON-RPC 2.0
 * Authentication:   Bearer token (see middleware/mcpAuth.js)
 *
 * Exposed tools (scope requirements noted):
 *   list_emails    [email:read]   – list/filter emails
 *   get_email      [email:read]   – full email content + headers
 *   search_emails  [email:read]   – full-text search
 *   list_accounts  [email:read]   – list connected email accounts
 *   send_email     [email:write]  – compose and send
 *   mark_email     [email:write]  – mark read / unread
 *   star_email     [email:write]  – star / unstar
 *   trash_email    [email:write]  – move to / restore from trash
 */

const express = require('express');
const { randomUUID } = require('crypto');
const { db }  = require('../db/database');
const { requireMcpAuth } = require('../middleware/mcpAuth');
const { sendEmail } = require('../services/smtp');

const router = express.Router();

// ── SSE Session State ─────────────────────────────────────────────────────────

// Map of sessionId -> { res, userId, scopes }
const activeSessions = new Map();

// ── Tool definitions (MCP schema) ─────────────────────────────────────────────

const TOOLS = [
  {
    name: 'list_emails',
    description: 'List emails from the mailbox. Supports filtering by folder, read status, starred, and pagination.',
    inputSchema: {
      type: 'object',
      properties: {
        folder:      { type: 'string', description: "Folder name (e.g. 'INBOX', 'sent', 'trash', 'archive', 'starred', 'all'). Default: INBOX" },
        account_id:  { type: 'number', description: 'Filter to a specific account ID' },
        is_read:     { type: 'boolean', description: 'Filter by read status' },
        is_starred:  { type: 'boolean', description: 'Filter by starred status' },
        limit:       { type: 'number', description: 'Max results (1–100, default 20)' },
        offset:      { type: 'number', description: 'Pagination offset (default 0)' },
      },
    },
  },
  {
    name: 'get_email',
    description: 'Get the full content of an email by its ID, including body and headers.',
    inputSchema: {
      type: 'object',
      required: ['email_id'],
      properties: {
        email_id: { type: 'number', description: 'The numeric email ID' },
      },
    },
  },
  {
    name: 'search_emails',
    description: 'Full-text search across subject, sender, and body.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query:      { type: 'string',  description: 'Search query string' },
        account_id: { type: 'number',  description: 'Restrict search to a specific account ID' },
        limit:      { type: 'number',  description: 'Max results (1–50, default 20)' },
      },
    },
  },
  {
    name: 'list_accounts',
    description: 'List connected email accounts (does NOT expose passwords or credentials).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'send_email',
    description: 'Compose and send a new email or reply.',
    inputSchema: {
      type: 'object',
      required: ['account_id', 'to', 'subject'],
      properties: {
        account_id:   { type: 'number',  description: 'Account ID to send from' },
        to:           { type: 'string',  description: 'Recipient address(es), comma-separated' },
        cc:           { type: 'string',  description: 'CC address(es)' },
        bcc:          { type: 'string',  description: 'BCC address(es)' },
        subject:      { type: 'string',  description: 'Email subject' },
        body_text:    { type: 'string',  description: 'Plain-text body' },
        body_html:    { type: 'string',  description: 'HTML body (optional, overrides body_text for HTML-capable clients)' },
        in_reply_to:  { type: 'string',  description: 'Message-ID of the email being replied to' },
      },
    },
  },
  {
    name: 'mark_email',
    description: 'Mark an email as read or unread.',
    inputSchema: {
      type: 'object',
      required: ['email_id', 'is_read'],
      properties: {
        email_id: { type: 'number',  description: 'The numeric email ID' },
        is_read:  { type: 'boolean', description: 'true to mark read, false to mark unread' },
      },
    },
  },
  {
    name: 'star_email',
    description: 'Star or unstar an email.',
    inputSchema: {
      type: 'object',
      required: ['email_id', 'starred'],
      properties: {
        email_id: { type: 'number',  description: 'The numeric email ID' },
        starred:  { type: 'boolean', description: 'true to star, false to unstar' },
      },
    },
  },
  {
    name: 'trash_email',
    description: 'Move an email to trash, or restore it.',
    inputSchema: {
      type: 'object',
      required: ['email_id'],
      properties: {
        email_id: { type: 'number',  description: 'The numeric email ID' },
        restore:  { type: 'boolean', description: 'true to restore from trash (default: false = move to trash)' },
      },
    },
  },
];

// ── JSON-RPC helpers ──────────────────────────────────────────────────────────

function ok(id, result)  { return { jsonrpc: '2.0', id, result }; }
function err(id, code, msg) { return { jsonrpc: '2.0', id, error: { code, message: msg } }; }

// ── Tool handlers ─────────────────────────────────────────────────────────────

function handleListEmails(userId, args) {
  const folder    = args.folder    || 'INBOX';
  const limit     = Math.min(Math.max(parseInt(args.limit  ?? 20, 10), 1), 100);
  const offset    = Math.max(parseInt(args.offset ?? 0, 10), 0);

  let sql = `
    SELECT e.id, e.account_id, e.folder, e.subject, e.from_name, e.from_email,
           e.to_addresses, e.date, e.is_read, e.is_starred, e.is_archived,
           e.is_trash, e.is_sent, e.awaiting_reply, e.ai_label, e.ai_summary,
           a.label AS account_label, a.email AS account_email
    FROM emails e
    JOIN accounts a ON a.id = e.account_id
    WHERE a.user_id = ?
  `;
  const params = [userId];

  if (args.account_id) { sql += ' AND e.account_id = ?'; params.push(args.account_id); }

  switch (folder) {
    case 'starred':  sql += ' AND e.is_starred = 1 AND e.is_trash = 0'; break;
    case 'sent':     sql += ' AND e.is_sent = 1'; break;
    case 'trash':    sql += ' AND e.is_trash = 1'; break;
    case 'archive':  sql += ' AND e.is_archived = 1 AND e.is_trash = 0'; break;
    case 'all':      sql += ' AND e.is_trash = 0'; break;
    default:
      sql += ' AND e.folder = ? AND e.is_archived = 0 AND e.is_trash = 0';
      params.push(folder);
  }

  if (typeof args.is_read    === 'boolean') { sql += ' AND e.is_read = ?';    params.push(args.is_read    ? 1 : 0); }
  if (typeof args.is_starred === 'boolean') { sql += ' AND e.is_starred = ?'; params.push(args.is_starred ? 1 : 0); }

  sql += ' ORDER BY e.date DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = db.prepare(sql).all(...params);
  return { emails: rows, count: rows.length, offset, limit };
}

function handleGetEmail(userId, args) {
  const emailId = parseInt(args.email_id, 10);
  if (!Number.isFinite(emailId)) throw { code: -32602, message: 'email_id must be a number' };

  const row = db.prepare(`
    SELECT e.id, e.account_id, e.message_id, e.folder, e.subject,
           e.from_name, e.from_email, e.to_addresses, e.cc_addresses,
           e.date, e.body_text, e.body_html, e.raw_headers,
           e.is_read, e.is_starred, e.is_archived, e.is_trash, e.is_sent,
           e.awaiting_reply, e.ai_label, e.ai_summary,
           a.label AS account_label, a.email AS account_email, a.user_id
    FROM emails e
    JOIN accounts a ON a.id = e.account_id
    WHERE e.id = ? AND a.user_id = ?
  `).get(emailId, userId);

  if (!row) throw { code: -32602, message: 'Email not found or access denied' };

  // Fetch attachments metadata (not blob data – prevents accidental leakage)
  const attachments = db.prepare(
    `SELECT id, filename, content_type, size FROM email_attachments WHERE email_id = ?`
  ).all(emailId);

  const { user_id: _uid, ...safe } = row; // strip internal user_id
  return { email: { ...safe, attachments } };
}

function handleSearchEmails(userId, args) {
  if (!args.query || typeof args.query !== 'string') {
    throw { code: -32602, message: 'query is required' };
  }
  const limit = Math.min(Math.max(parseInt(args.limit ?? 20, 10), 1), 50);
  const ftsQuery = args.query.replace(/[^a-zA-Z0-9\s\-_@.]/g, ' ').trim();
  if (!ftsQuery) throw { code: -32602, message: 'query contains no searchable terms' };

  let sql = `
    SELECT e.id, e.account_id, e.folder, e.subject, e.from_name, e.from_email,
           e.date, e.is_read, e.is_starred, e.ai_label, e.ai_summary,
           a.label AS account_label, a.email AS account_email
    FROM email_fts
    JOIN emails e  ON e.id  = email_fts.rowid
    JOIN accounts a ON a.id = e.account_id
    WHERE email_fts MATCH ? AND a.user_id = ?
  `;
  const params = [ftsQuery, userId];

  if (args.account_id) { sql += ' AND e.account_id = ?'; params.push(args.account_id); }
  sql += ' ORDER BY rank LIMIT ?';
  params.push(limit);

  const rows = db.prepare(sql).all(...params);
  return { emails: rows, count: rows.length };
}

function handleListAccounts(userId) {
  const rows = db.prepare(
    `SELECT id, label, email, imap_host, imap_port, smtp_host, smtp_port,
            is_default, last_synced, created_at
     FROM accounts WHERE user_id = ?`
  ).all(userId);
  return { accounts: rows };
}

async function handleSendEmail(userId, args) {
  const { account_id, to, subject, body_text, body_html, cc, bcc, in_reply_to } = args;

  if (!account_id || !to || !subject) {
    throw { code: -32602, message: 'account_id, to, and subject are required' };
  }

  const account = db.prepare(
    'SELECT * FROM accounts WHERE id = ? AND user_id = ?'
  ).get(parseInt(account_id, 10), userId);

  if (!account) throw { code: -32602, message: 'Account not found or access denied' };

  await sendEmail(account, {
    to, cc, bcc, subject,
    text: body_text,
    html: body_html,
    inReplyTo: in_reply_to,
  });

  return { ok: true, message: 'Email sent successfully' };
}

function handleMarkEmail(userId, args) {
  const emailId = parseInt(args.email_id, 10);
  if (!Number.isFinite(emailId)) throw { code: -32602, message: 'email_id must be a number' };

  const row = db.prepare(
    'SELECT e.id FROM emails e JOIN accounts a ON a.id = e.account_id WHERE e.id = ? AND a.user_id = ?'
  ).get(emailId, userId);
  if (!row) throw { code: -32602, message: 'Email not found or access denied' };

  db.prepare('UPDATE emails SET is_read = ? WHERE id = ?').run(args.is_read ? 1 : 0, emailId);
  return { ok: true, email_id: emailId, is_read: !!args.is_read };
}

function handleStarEmail(userId, args) {
  const emailId = parseInt(args.email_id, 10);
  if (!Number.isFinite(emailId)) throw { code: -32602, message: 'email_id must be a number' };

  const row = db.prepare(
    'SELECT e.id FROM emails e JOIN accounts a ON a.id = e.account_id WHERE e.id = ? AND a.user_id = ?'
  ).get(emailId, userId);
  if (!row) throw { code: -32602, message: 'Email not found or access denied' };

  db.prepare('UPDATE emails SET is_starred = ? WHERE id = ?').run(args.starred ? 1 : 0, emailId);
  return { ok: true, email_id: emailId, starred: !!args.starred };
}

function handleTrashEmail(userId, args) {
  const emailId = parseInt(args.email_id, 10);
  if (!Number.isFinite(emailId)) throw { code: -32602, message: 'email_id must be a number' };

  const row = db.prepare(
    'SELECT e.id FROM emails e JOIN accounts a ON a.id = e.account_id WHERE e.id = ? AND a.user_id = ?'
  ).get(emailId, userId);
  if (!row) throw { code: -32602, message: 'Email not found or access denied' };

  const restore = !!args.restore;
  db.prepare('UPDATE emails SET is_trash = ? WHERE id = ?').run(restore ? 0 : 1, emailId);
  return { ok: true, email_id: emailId, in_trash: !restore };
}

// ── MCP request dispatcher ────────────────────────────────────────────────────

// GET /sse – initiate SSE connection
router.get('/sse', requireMcpAuth(), (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-store');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sessionId = randomUUID();
  
  // Store session
  activeSessions.set(sessionId, {
    res,
    userId: req.mcpUserId,
    scopes: req.mcpScopes,
  });

  // Handle client disconnect
  req.on('close', () => {
    activeSessions.delete(sessionId);
  });

  // Send the initial endpoint event telling the client where to POST messages
  const messageEndpoint = `/mcp/message?sessionId=${encodeURIComponent(sessionId)}`;
  res.write(`event: endpoint\ndata: ${messageEndpoint}\n\n`);
});

// POST /message – handle incoming JSON-RPC messages from the client
router.post('/message', express.json({ limit: '4mb' }), async (req, res) => {
  const sessionId = req.query.sessionId;
  if (!sessionId) {
    return res.status(400).send('Missing sessionId');
  }

  const session = activeSessions.get(sessionId);
  if (!session) {
    return res.status(404).send('Session not found or expired');
  }

  // The client sends the token in the SSE request, but might not send it in the POST request.
  // We already tied this session to a userId and scopes.
  
  // Acknowledge receipt immediately (SSE transport requirement)
  res.status(202).end();

  const body = req.body;

  // Provide a mock req object to callTool/dispatch with the correct session rights
  const mockReq = { 
    mcpUserId: session.userId, 
    mcpScopes: session.scopes 
  };

  // Batch requests — cap at 20 to prevent DoS
  if (Array.isArray(body)) {
    if (body.length > 20) {
      const errRes = { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Batch size exceeds limit of 20' } };
      session.res.write(`event: message\ndata: ${JSON.stringify(errRes)}\n\n`);
      return;
    }
    const results = await Promise.all(body.map(msg => dispatch(mockReq, msg)));
    const validResults = results.filter(r => r !== null);
    if (validResults.length > 0) {
      session.res.write(`event: message\ndata: ${JSON.stringify(validResults)}\n\n`);
    }
    return;
  }

  const result = await dispatch(mockReq, body);
  if (result !== null) {
    session.res.write(`event: message\ndata: ${JSON.stringify(result)}\n\n`);
  }
});

// GET / – return capability info (useful for health probes)
router.get('/', (req, res) => {
  res.json({
    name:       'NeoMail MCP Server',
    version:    '1.0.0',
    transport:  'sse',
    auth:       'Bearer (OAuth 2.0)',
    tools:      TOOLS.map(t => ({ name: t.name, description: t.description })),
  });
});

async function dispatch(req, msg) {
  if (!msg || typeof msg !== 'object') {
    return err(null, -32700, 'Parse error');
  }

  const { jsonrpc, method, id, params = {} } = msg;
  if (jsonrpc !== '2.0') return err(id ?? null, -32600, 'Invalid Request');

  const isNotification = id === undefined;

  try {
    switch (method) {
      // ── MCP lifecycle ────────────────────────────────────────────
      case 'initialize':
        return ok(id, {
          protocolVersion: '2025-03-26',
          serverInfo:      { name: 'NeoMail', version: '1.0.0' },
          capabilities:    { tools: { listChanged: false } },
        });

      case 'notifications/initialized':
        return null; // notification, no response

      case 'ping':
        return ok(id, {});

      // ── Tools ─────────────────────────────────────────────────────
      case 'tools/list':
        return ok(id, { tools: TOOLS });

      case 'tools/call': {
        const { name, arguments: args = {} } = params;
        return await callTool(req, id, name, args);
      }

      // ── Unsupported but graceful ───────────────────────────────────
      case 'resources/list':
        return ok(id, { resources: [] });
      case 'prompts/list':
        return ok(id, { prompts: [] });

      default:
        if (isNotification) return null;
        return err(id, -32601, `Method not found: ${method}`);
    }
  } catch (e) {
    if (isNotification) return null;
    const code = typeof e.code === 'number' ? e.code : -32603;
    return err(id ?? null, code, e.message || 'Internal error');
  }
}

async function callTool(req, id, name, args) {
  const userId  = req.mcpUserId;
  const scopes  = req.mcpScopes;

  const readOk  = scopes.has('email:read');
  const writeOk = scopes.has('email:write');

  const readTools  = ['list_emails', 'get_email', 'search_emails', 'list_accounts'];
  const writeTools = ['send_email', 'mark_email', 'star_email', 'trash_email'];

  if (readTools.includes(name)  && !readOk)  return err(id, -32003, 'Token does not have email:read scope');
  if (writeTools.includes(name) && !writeOk) return err(id, -32003, 'Token does not have email:write scope');

  let result;
  switch (name) {
    case 'list_emails':    result = handleListEmails(userId, args);         break;
    case 'get_email':      result = handleGetEmail(userId, args);           break;
    case 'search_emails':  result = handleSearchEmails(userId, args);       break;
    case 'list_accounts':  result = handleListAccounts(userId);             break;
    case 'send_email':     result = await handleSendEmail(userId, args);    break;
    case 'mark_email':     result = handleMarkEmail(userId, args);          break;
    case 'star_email':     result = handleStarEmail(userId, args);          break;
    case 'trash_email':    result = handleTrashEmail(userId, args);         break;
    default:
      return err(id, -32602, `Unknown tool: ${name}`);
  }

  return ok(id, {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    isError: false,
  });
}

module.exports = router;
