'use strict';

const crypto = require('crypto');
const { db } = require('../db/database');

/**
 * Hashes a raw token value using SHA-256.
 * Only the hash is stored in the database — the raw token is never persisted.
 */
function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/**
 * Express middleware that validates MCP Bearer tokens.
 *
 * Attaches to req:
 *   req.mcpUserId   – integer user ID
 *   req.mcpScopes   – Set of granted scopes, e.g. Set{'email:read','email:write'}
 *   req.mcpTokenId  – token row ID (for last_used updates)
 *
 * Accepts an optional requiredScope string; if provided the middleware will
 * reject requests that lack that specific scope.
 */
function requireMcpAuth(requiredScope) {
  return (req, res, next) => {
    const authHeader = req.headers['authorization'] || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        jsonrpc: '2.0', id: null,
        error: { code: -32001, message: 'Missing Bearer token' },
      });
    }

    const raw = authHeader.slice(7).trim();
    if (!raw) {
      return res.status(401).json({
        jsonrpc: '2.0', id: null,
        error: { code: -32001, message: 'Empty token' },
      });
    }

    const hash = hashToken(raw);
    const now  = Math.floor(Date.now() / 1000);

    const row = db.prepare(
      `SELECT id, user_id, scopes, expires_at, revoked
       FROM mcp_tokens WHERE token_hash = ?`
    ).get(hash);

    if (!row) {
      return res.status(401).json({
        jsonrpc: '2.0', id: null,
        error: { code: -32001, message: 'Invalid token' },
      });
    }
    if (row.revoked) {
      return res.status(401).json({
        jsonrpc: '2.0', id: null,
        error: { code: -32001, message: 'Token has been revoked' },
      });
    }
    if (row.expires_at && row.expires_at < now) {
      return res.status(401).json({
        jsonrpc: '2.0', id: null,
        error: { code: -32001, message: 'Token has expired' },
      });
    }

    const scopes = new Set((row.scopes || '').split(' ').filter(Boolean));

    if (requiredScope && !scopes.has(requiredScope)) {
      return res.status(403).json({
        jsonrpc: '2.0', id: null,
        error: { code: -32003, message: `Insufficient scope – requires ${requiredScope}` },
      });
    }

    // Touch last_used (best-effort, non-blocking)
    try {
      db.prepare('UPDATE mcp_tokens SET last_used = ? WHERE id = ?').run(now, row.id);
    } catch (_) {}

    req.mcpUserId  = row.user_id;
    req.mcpScopes  = scopes;
    req.mcpTokenId = row.id;
    next();
  };
}

module.exports = { requireMcpAuth, hashToken };
