/* mcp-authorize.js – OAuth consent-page logic (loaded as external script for CSP compliance) */
(function () {
  'use strict';

  const p          = new URLSearchParams(location.search);
  const clientName = p.get('client_name') || p.get('client_id') || 'Unknown App';
  const scope      = p.get('scope') || 'email:read';
  const scopes     = scope.split(' ').filter(Boolean);

  document.getElementById('client-name').textContent = clientName;
  document.getElementById('f-client_id').value             = p.get('client_id') || '';
  document.getElementById('f-client_name').value           = clientName;
  document.getElementById('f-redirect_uri').value          = p.get('redirect_uri') || '';
  document.getElementById('f-scope').value                 = scope;
  document.getElementById('f-state').value                 = p.get('state') || '';
  document.getElementById('f-code_challenge').value        = p.get('code_challenge') || '';
  document.getElementById('f-code_challenge_method').value = p.get('code_challenge_method') || 'S256';

  // Render scope badges
  const badgeMap = {
    'email:read':  { cls: 'scope-read',  label: '📖 Read emails' },
    'email:write': { cls: 'scope-write', label: '✏️ Write / send emails' },
  };
  const scopeList = document.getElementById('scope-list');
  scopes.forEach(function (s) {
    var m = badgeMap[s];
    if (!m) return;
    var span = document.createElement('span');
    span.className = 'scope-badge ' + m.cls;
    span.textContent = m.label;
    scopeList.appendChild(span);
  });

  // Render permission detail rows
  var details = document.getElementById('perm-details');
  var permMap = {
    'email:read':  { ico: '📬', title: 'Read your emails',       desc: 'List, search and view emails, subjects, senders, and bodies.' },
    'email:write': { ico: '📤', title: 'Manage and send emails', desc: 'Mark emails as read/unread, star, trash, and send new emails.' },
  };
  scopes.forEach(function (s) {
    var m = permMap[s];
    if (!m) return;
    var row = document.createElement('div');
    row.className = 'perm-row';
    row.innerHTML = '<div class="perm-ico">' + m.ico + '</div><div class="perm-desc"><strong>' + m.title + '</strong><small>' + m.desc + '</small></div>';
    details.appendChild(row);
  });

  // Show write-access warning
  if (scopes.includes('email:write')) {
    document.getElementById('write-warning').style.display = '';
  }

  // Deny button — redirect back with error=access_denied
  // Wraps new URL() in try/catch to guard against a malformed redirect_uri in query params.
  window.deny = function () {
    var redirectUri = p.get('redirect_uri');
    var state       = p.get('state');
    if (redirectUri) {
      try {
        var u = new URL(redirectUri);
        u.searchParams.set('error', 'access_denied');
        if (state) u.searchParams.set('state', state);
        location.href = u.toString();
      } catch (_) {
        // Malformed redirect_uri — just go back
        history.back();
      }
    } else {
      history.back();
    }
  };
}());
