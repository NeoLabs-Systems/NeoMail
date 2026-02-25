'use strict';

/**
 * OAuth 2.0 Authorization Server  +  Personal Access Token (PAT) management
 *
 * Endpoints
 * ─────────
 *  GET  /.well-known/oauth-authorization-server  – RFC 8414 metadata
 *  POST /oauth/register                           – RFC 7591 dynamic client reg
 *  GET  /oauth/authorize                          – Authorization-code + PKCE
 *  POST /oauth/token                              – Token exchange
 *  POST /oauth/revoke                             – RFC 7009 revocation
 *
 *  PAT management (session-authenticated web UI):
 *  GET  /oauth/pats          – list caller's tokens
 *  POST /oauth/pats          – create new PAT
 *  DELETE /oauth/pats/:id    – revoke PAT
 */

const crypto  = require('crypto');
const express = require('express');
const { db }  = require('../db/database');
const { requireAuth }  = require('../middleware/auth');
const { hashToken }    = require('../middleware/mcpAuth');

const router = express.Router();

// ── helpers ──────────────────────────────────────────────────────────────────

const VALID_SCOPES    = new Set(['email:read', 'email:write']);
const TOKEN_TTL       = 365 * 24 * 60 * 60; // 1 year in seconds (PATs)
const AUTH_CODE_TTL   = 5 * 60;             // 5 minutes

function sanitizeScopes(raw) {
  return (raw || '')
    .split(/[\s,]+/)
    .filter(s => VALID_SCOPES.has(s))
    .join(' ') || 'email:read';
}

function generateSecureToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function generateClientId() {
  return 'mc_' + crypto.randomBytes(12).toString('hex');
}

function pkceS256(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function getBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host  = req.headers['x-forwarded-host']  || req.headers.host;
  return `${proto}://${host}`;
}

// ── RFC 8414 – Authorization Server Metadata ─────────────────────────────────

router.get('/.well-known/oauth-authorization-server', (req, res) => {
  const base = getBaseUrl(req);
  res.json({
    issuer:                                base,
    authorization_endpoint:                `${base}/oauth/authorize`,
    token_endpoint:                        `${base}/oauth/token`,
    revocation_endpoint:                   `${base}/oauth/revoke`,
    registration_endpoint:                 `${base}/oauth/register`,
    scopes_supported:                      [...VALID_SCOPES],
    response_types_supported:              ['code'],
    grant_types_supported:                 ['authorization_code'],
    code_challenge_methods_supported:      ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
  });
});

// MCP discovery alias
router.get('/.well-known/mcp', (req, res) => {
  const base = getBaseUrl(req);
  res.json({
    mcp_endpoint:           `${base}/mcp`,
    authorization_required: true,
    oauth_metadata:         `${base}/.well-known/oauth-authorization-server`,
  });
});

// ── RFC 7591 – Dynamic Client Registration ───────────────────────────────────

router.post('/oauth/register', express.json(), (req, res) => {
  const { client_name, redirect_uris } = req.body || {};

  if (!client_name || !Array.isArray(redirect_uris) || redirect_uris.length === 0) {
    return res.status(400).json({ error: 'invalid_client_metadata', error_description: 'client_name and redirect_uris are required' });
  }

  // Validate redirect_uris
  for (const uri of redirect_uris) {
    try {
      const u = new URL(uri);
      // Allow http://localhost for native apps
      if (u.protocol !== 'https:' && !(u.hostname === 'localhost' || u.hostname === '127.0.0.1')) {
        return res.status(400).json({ error: 'invalid_redirect_uri', error_description: `Non-HTTPS redirect URI not allowed: ${uri}` });
      }
    } catch (_) {
      return res.status(400).json({ error: 'invalid_redirect_uri', error_description: `Malformed redirect URI: ${uri}` });
    }
  }

  const clientId = generateClientId();

  db.prepare(
    `INSERT INTO oauth_clients (client_id, client_name, redirect_uris) VALUES (?, ?, ?)`
  ).run(clientId, String(client_name).slice(0, 100), JSON.stringify(redirect_uris));

  return res.status(201).json({
    client_id:                clientId,
    client_name,
    redirect_uris,
    token_endpoint_auth_method: 'none',
    grant_types:              ['authorization_code'],
    response_types:           ['code'],
    scope:                    [...VALID_SCOPES].join(' '),
  });
});

// ── Authorization Endpoint ───────────────────────────────────────────────────

router.get('/oauth/authorize', (req, res) => {
  const {
    client_id, redirect_uri, response_type = 'code',
    scope, state, code_challenge, code_challenge_method,
  } = req.query;

  // Must be logged-in to approve
  if (!req.session?.userId) {
    const returnTo = encodeURIComponent(req.originalUrl);
    return res.redirect(`/login?next=${returnTo}`);
  }

  // Validate params
  if (response_type !== 'code') {
    return res.status(400).send('unsupported_response_type');
  }
  if (!code_challenge || code_challenge_method !== 'S256') {
    return res.status(400).send('PKCE S256 required');
  }

  const client = db.prepare('SELECT * FROM oauth_clients WHERE client_id = ?').get(client_id);
  if (!client) return res.status(400).send('unknown_client');

  let allowedUris;
  try { allowedUris = JSON.parse(client.redirect_uris); } catch (_) { allowedUris = []; }
  if (!allowedUris.includes(redirect_uri)) {
    return res.status(400).send('redirect_uri_mismatch');
  }

  const sanitized = sanitizeScopes(scope);

  // Render consent page – pass params as query so the HTML page can POST back
  const params = new URLSearchParams({
    client_id,
    client_name:          client.client_name,
    redirect_uri,
    scope:                sanitized,
    state:                state || '',
    code_challenge,
    code_challenge_method,
  });
  res.redirect(`/mcp-authorize?${params.toString()}`);
});

// POST from consent page
router.post('/oauth/authorize', requireAuth, express.urlencoded({ extended: false }), (req, res) => {
  const {
    action,            // 'approve' | 'deny'
    client_id,
    redirect_uri,
    scope,
    state,
    code_challenge,
    code_challenge_method,
  } = req.body;

  // ── Validate EVERYTHING server-side before touching redirect_uri ──────────
  // This must happen before any redirect to prevent open-redirect attacks.
  const client = db.prepare('SELECT * FROM oauth_clients WHERE client_id = ?').get(client_id);
  if (!client) return res.status(400).send('unknown_client');

  let allowedUris;
  try { allowedUris = JSON.parse(client.redirect_uris); } catch (_) { allowedUris = []; }
  if (!allowedUris.includes(redirect_uri)) return res.status(400).send('redirect_uri_mismatch');

  let redirect;
  try { redirect = new URL(redirect_uri); } catch (_) { return res.status(400).send('invalid_redirect_uri'); }

  if (action !== 'approve') {
    redirect.searchParams.set('error', 'access_denied');
    if (state) redirect.searchParams.set('state', state);
    return res.redirect(redirect.toString());
  }

  if (!code_challenge || code_challenge_method !== 'S256') return res.status(400).send('invalid_pkce');

  const code      = generateSecureToken(24);
  const expiresAt = Math.floor(Date.now() / 1000) + AUTH_CODE_TTL;

  db.prepare(
    `INSERT INTO oauth_codes (code, client_id, user_id, redirect_uri, scopes, code_challenge, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(code, client_id, req.session.userId, redirect_uri, sanitizeScopes(scope), code_challenge, expiresAt);

  redirect.searchParams.set('code', code);
  if (state) redirect.searchParams.set('state', state);
  res.redirect(redirect.toString());
});

// ── Token Endpoint ───────────────────────────────────────────────────────────

router.post('/oauth/token', express.urlencoded({ extended: false }), express.json(), (req, res) => {
  const body = req.body || {};
  const { grant_type } = body;

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');

  if (grant_type !== 'authorization_code') {
    return res.status(400).json({ error: 'unsupported_grant_type' });
  }

  const { code, redirect_uri, client_id, code_verifier } = body;
  if (!code || !redirect_uri || !client_id || !code_verifier) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'Missing required parameters' });
  }

  const now    = Math.floor(Date.now() / 1000);
  const row    = db.prepare('SELECT * FROM oauth_codes WHERE code = ?').get(code);

  if (!row)           return res.status(400).json({ error: 'invalid_grant', error_description: 'Unknown or expired code' });
  if (row.used)       return res.status(400).json({ error: 'invalid_grant', error_description: 'Code already used' });
  if (row.expires_at < now) return res.status(400).json({ error: 'invalid_grant', error_description: 'Code expired' });
  if (row.client_id   !== client_id)   return res.status(400).json({ error: 'invalid_grant', error_description: 'client_id mismatch' });
  if (row.redirect_uri !== redirect_uri) return res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' });

  // PKCE verification
  const expected = pkceS256(code_verifier);
  if (expected !== row.code_challenge) {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verification failed' });
  }

  // Mark code as used (single-use)
  db.prepare('UPDATE oauth_codes SET used = 1 WHERE id = ?').run(row.id);

  // Issue access token
  const rawToken = generateSecureToken(40);
  const tokenHash = hashToken(rawToken);
  const expiresAt = now + TOKEN_TTL;

  // Get client name for token label
  const client = db.prepare('SELECT client_name FROM oauth_clients WHERE client_id = ?').get(client_id);

  db.prepare(
    `INSERT INTO mcp_tokens (user_id, token_hash, name, scopes, expires_at, client_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(row.user_id, tokenHash, `OAuth – ${client?.client_name || client_id}`, row.scopes, expiresAt, client_id);

  return res.json({
    access_token: rawToken,
    token_type:   'Bearer',
    expires_in:   TOKEN_TTL,
    scope:        row.scopes,
  });
});

// ── Revocation Endpoint (RFC 7009) ───────────────────────────────────────────

router.post('/oauth/revoke', express.urlencoded({ extended: false }), express.json(), (req, res) => {
  const { token } = req.body || {};
  if (token) {
    const hash = hashToken(token);
    db.prepare('UPDATE mcp_tokens SET revoked = 1 WHERE token_hash = ?').run(hash);
  }
  // RFC 7009 §2.2: always return 200
  res.status(200).send('');
});

// ── OAuth client access management (session-authenticated) ─────────────────────

/**
 * GET /oauth/clients  – list OAuth apps the current user has granted access to
 * Returns one row per distinct client with aggregated token info.
 */
router.get('/oauth/clients', requireAuth, (req, res) => {
  // Join mcp_tokens with oauth_clients to surface friendly metadata.
  // We return one row per client, with the most-recently-used token's info.
  const rows = db.prepare(
    `SELECT
       oc.client_id,
       oc.client_name,
       oc.redirect_uris,
       MAX(t.last_used)  AS last_used,
       MAX(t.created_at) AS authorized_at,
       GROUP_CONCAT(DISTINCT t.scopes) AS scopes_raw,
       SUM(CASE WHEN t.revoked = 0 THEN 1 ELSE 0 END) AS active_token_count
     FROM mcp_tokens t
     JOIN oauth_clients oc ON oc.client_id = t.client_id
     WHERE t.user_id = ? AND t.client_id IS NOT NULL
     GROUP BY oc.client_id
     ORDER BY authorized_at DESC`
  ).all(req.session.userId);

  // Deduplicate and flatten scopes
  const clients = rows.map(r => ({
    client_id:         r.client_id,
    client_name:       r.client_name,
    redirect_uris:     JSON.parse(r.redirect_uris || '[]'),
    last_used:         r.last_used,
    authorized_at:     r.authorized_at,
    scopes:            [...new Set((r.scopes_raw || '').split(',').flatMap(s => s.split(' ')).filter(Boolean))].join(' '),
    active_token_count: r.active_token_count,
  }));

  res.json(clients);
});

/**
 * DELETE /oauth/clients/:clientId/tokens  – revoke ALL tokens for this client for the current user
 */
router.delete('/oauth/clients/:clientId/tokens', requireAuth, (req, res) => {
  const { clientId } = req.params;
  db.prepare(
    'UPDATE mcp_tokens SET revoked = 1 WHERE user_id = ? AND client_id = ?'
  ).run(req.session.userId, clientId);
  res.json({ ok: true });
});

// ── PAT management (session-authenticated) ───────────────────────────────────

/**
 * GET /oauth/pats  – list caller's Personal Access Tokens
 */
router.get('/oauth/pats', requireAuth, (req, res) => {
  const rows = db.prepare(
    `SELECT id, name, scopes, client_id, last_used, expires_at, revoked, created_at
     FROM mcp_tokens WHERE user_id = ? ORDER BY created_at DESC`
  ).all(req.session.userId);
  res.json(rows);
});

/**
 * POST /oauth/pats  – create new PAT
 * Body: { name, scopes, expires_in_days? }
 */
router.post('/oauth/pats', requireAuth, express.json(), (req, res) => {
  const { name, scopes, expires_in_days } = req.body || {};

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ error: 'name is required' });
  }

  const sanitized = sanitizeScopes(scopes);
  const now        = Math.floor(Date.now() / 1000);
  let expiresAt    = null;

  if (expires_in_days) {
    const days = parseInt(expires_in_days, 10);
    if (!Number.isFinite(days) || days < 1 || days > 730) {
      return res.status(400).json({ error: 'expires_in_days must be 1–730' });
    }
    expiresAt = now + days * 86400;
  }

  const rawToken  = generateSecureToken(40);
  const tokenHash = hashToken(rawToken);

  const result = db.prepare(
    `INSERT INTO mcp_tokens (user_id, token_hash, name, scopes, expires_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(req.session.userId, tokenHash, name.trim().slice(0, 100), sanitized, expiresAt);

  // Return the raw token ONCE – it is never stored in plaintext
  res.status(201).json({
    id:         result.lastInsertRowid,
    name:       name.trim(),
    scopes:     sanitized,
    expires_at: expiresAt,
    token:      rawToken,   // shown only once!
  });
});

/**
 * DELETE /oauth/pats/:id  – revoke PAT (only owner can revoke)
 */
router.delete('/oauth/pats/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = db.prepare('SELECT user_id FROM mcp_tokens WHERE id = ?').get(id);

  if (!row) return res.status(404).json({ error: 'Token not found' });
  if (row.user_id !== req.session.userId) return res.status(403).json({ error: 'Forbidden' });

  db.prepare('UPDATE mcp_tokens SET revoked = 1 WHERE id = ?').run(id);
  res.json({ ok: true });
});

module.exports = router;
