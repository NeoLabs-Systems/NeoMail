/* =====================================================
   NeoMail – Main App JS
   Handles email list, view, navigation, bulk actions
   ===================================================== */

/* ── Constants ─────────────────────────────────────── */
// Cache the skeleton markup before the first render overwrites the list
const LOADING_HTML = (() => {
  const el = document.getElementById('list-loading');
  return el ? el.outerHTML : '<div class="loading-state"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>';
})();

// Seed the email iframe with a blank page so the browser never loads about:blank
document.getElementById('email-iframe').srcdoc = '<!DOCTYPE html><html><body></body></html>';

/* ── State ─────────────────────────────────────────── */
const State = {
  currentFolder: 'INBOX',
  currentEmailId: null,
  selectedIds: new Set(),
  emails: [],
  accounts: [],
  labels: [],
  offset: 0,
  hasMore: false,
  searchTimeout: null,
  searchQuery: '',
  user: null,
  aiAvailable: false,
  threadMode: false,
  settings: { per_page: 50, show_preview: true, mark_read_on_open: true, compact_mode: false },
};

/* ── Utils ─────────────────────────────────────────── */
function toast(msg, type = '', duration = 3500) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast${type ? ' ' + type : ''}`;
  t.style.display = 'block';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.display = 'none'; }, duration);
}

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const isYear = d.getFullYear() === now.getFullYear();
  if (isToday) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (isYear) return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return d.toLocaleDateString([], { year: '2-digit', month: 'short', day: 'numeric' });
}

function getInitials(name, email) {
  if (name) return name.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();
  return (email || '?')[0].toUpperCase();
}

function getAvatarColor(str) {
  const colors = ['#6366f1', '#8b5cf6', '#06b6d4', '#22c55e', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6'];
  let h = 0;
  for (const c of (str || '')) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff;
  return colors[Math.abs(h) % colors.length];
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) { window.location.href = '/login'; return null; }
  return res.json();
}

/* ── Init ──────────────────────────────────────────── */
async function init() {
  // Register service worker (push notifications only)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => { });
  }

  // Request notification permission immediately
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }

  const [user, aiStatus, userSettings] = await Promise.all([
    api('/api/auth/me'),
    api('/api/ai/status'),
    api('/api/settings')
  ]);
  State.user = user;
  State.aiAvailable = aiStatus?.available || false;
  if (userSettings) Object.assign(State.settings, userSettings);

  // Apply compact mode if saved
  if (State.settings.compact_mode) document.body.classList.add('compact');
  // Apply saved accent colour
  if (State.settings.accent_color) {
    document.documentElement.style.setProperty('--accent', State.settings.accent_color);
  }

  await Promise.all([
    loadAccounts(),
    loadLabels(),
  ]);

  await loadEmails();
  updateStats();
  setupSSE();

  // Auto-fetch every N minutes (default 3)
  const syncMinutes = Math.max(1, State.settings.sync_interval || 3);
  setInterval(() => {
    loadEmails();
    updateStats();
  }, syncMinutes * 60 * 1000);

  // Mobile sidebar hamburger
  const hamburger = document.getElementById('btn-hamburger');
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  function openSidebar() { sidebar.classList.add('mobile-open'); backdrop.classList.add('visible'); }
  function closeSidebar() { sidebar.classList.remove('mobile-open'); backdrop.classList.remove('visible'); }
  if (hamburger) hamburger.addEventListener('click', openSidebar);
  if (backdrop) backdrop.addEventListener('click', closeSidebar);
  // Close sidebar when a nav item is tapped
  document.getElementById('sidebar-nav').addEventListener('click', closeSidebar);
  document.getElementById('labels-nav').addEventListener('click', closeSidebar);
  document.getElementById('accounts-nav').addEventListener('click', closeSidebar);

  // PWA shortcut: ?action=compose
  if (new URLSearchParams(location.search).get('action') === 'compose') {
    setTimeout(() => openCompose(), 800);
  }

  // Show AI buttons only if AI is available
  if (!State.aiAvailable) {
    document.querySelectorAll('.ai-btn, .ai-icon').forEach(el => {
      el.style.opacity = '.4';
      el.title += ' (configure OpenAI key in Settings → AI Config)';
    });
  }
}

/* ── Accounts ──────────────────────────────────────── */
async function loadAccounts() {
  const data = await api('/api/accounts');
  State.accounts = data || [];
  renderAccountsNav();
  populateComposeFrom();
}

function renderAccountsNav() {
  const nav = document.getElementById('accounts-nav');
  nav.innerHTML = '<div class="nav-section-title">Accounts</div>';
  for (const acc of State.accounts) {
    const el = document.createElement('div');
    el.className = 'nav-item';
    el.style.cursor = 'pointer';
    el.innerHTML = `
      <div class="label-dot" style="background:${getAvatarColor(acc.email)}"></div>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${acc.label || acc.email}</span>
      <button onclick="syncAccount(${acc.id})" title="Sync" style="background:none;border:none;color:var(--text-3);cursor:pointer;padding:2px;font-size:11px">↻</button>
    `;
    el.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      loadEmailsForAccount(acc.id);
    });
    nav.appendChild(el);
  }
}

async function syncAccount(accountId) {
  toast('Syncing…');
  const res = await api(`/api/accounts/${accountId}/sync`, { method: 'POST' });
  if (res?.ok) {
    toast(`Synced! ${res.newEmails} new email(s)`, 'success');
    loadEmails();
    updateStats();
  } else {
    toast(res?.error || 'Sync failed', 'error');
  }
}

window.syncAccount = syncAccount;

/* ── Labels ───────────────────────────────────────── */
async function loadLabels() {
  const data = await api('/api/settings/labels');
  State.labels = data || [];
  renderLabelsNav();
}

function renderLabelsNav() {
  const nav = document.getElementById('labels-nav');
  nav.innerHTML = '<div class="nav-section-title">Labels</div>';
  for (const label of State.labels) {
    const el = document.createElement('a');
    el.className = 'nav-item';
    el.dataset.label = label.name;
    el.innerHTML = `
      <div class="label-dot" style="background:${label.color}"></div>
      ${label.name}
    `;
    el.addEventListener('click', () => {
      setActiveNav(el);
      State.currentFolder = 'label:' + label.name;
      document.getElementById('folder-title').textContent = label.name;
      clearSelection();
      closeEmail();
      loadEmails({ label: label.name });
    });
    nav.appendChild(el);
  }
}

/* ── Email Loading ────────────────────────────────── */
async function loadEmails(extraParams = {}, reset = true) {
  if (reset) { State.offset = 0; State.emails = []; }

  const el = document.getElementById('email-list');

  // If we're in a label view and no explicit label was passed, derive it from State
  if (State.currentFolder.startsWith('label:') && !extraParams.label) {
    extraParams = { ...extraParams, label: State.currentFolder.replace('label:', '') };
  }

  const folder = State.currentFolder.startsWith('label:')
    ? 'all'
    : State.currentFolder;

  if (reset) {
    el.innerHTML = LOADING_HTML;
  }

  const perPage = State.settings.per_page || 50;

  const searchParsed = State.searchQuery ? parseSearchQuery(State.searchQuery) : {};

  const params = new URLSearchParams({
    folder: extraParams.folder || folder,
    limit: perPage,
    offset: State.offset,
    ...searchParsed,
    ...extraParams
  });

  if (extraParams.label) {
    params.set('folder', 'all');
    params.set('label', extraParams.label);
  }

  // Scheduled emails come from a separate endpoint
  let emails = [], totalData = null;
  if (folder === 'scheduled') {
    const rows = await api('/api/emails/scheduled');
    // Normalize scheduled rows into a display-friendly shape
    emails = (Array.isArray(rows) ? rows : []).map(s => ({
      id: `sched-${s.id}`,
      subject: s.subject || '(no subject)',
      from_name: 'You (scheduled)',
      from_email: '',
      to_addresses: s.to_addr,
      date: s.send_at,
      is_read: 1,
      _sched: s
    }));
    totalData = { emails, unreadCounts: {} };
  } else {
    const data2 = await api(`/api/emails?${params}`);
    if (!data2) return;
    emails = data2.emails || [];
    totalData = data2;
  }
  const data = totalData;
  if (!data) return;

  if (reset) State.emails = emails;
  else State.emails.push(...emails);

  State.hasMore = emails.length === perPage;
  renderEmailList(reset);
  updateUnreadBadges(data.unreadCounts || {});

  document.getElementById('load-more').style.display = State.hasMore ? 'block' : 'none';
  document.getElementById('folder-count').textContent = emails.length > 0 ? `${emails.length}${State.hasMore ? '+' : ''} messages` : '';
}

function clearSelection() {
  State.selectedIds.clear();
  const ca = document.getElementById('check-all');
  if (ca) ca.checked = false;
  updateBulkBar();
}

function closeEmail() {
  State.currentEmailId = null;
  const _view = document.getElementById('email-view');
  _view._email = null;  // clear stale data so snooze btn can't act on closed email
  document.getElementById('view-empty').style.display = 'flex';
  _view.style.display = 'none';
  document.getElementById('view-pane').classList.remove('mobile-show');
  document.querySelectorAll('.email-row.active').forEach(r => r.classList.remove('active'));
}

function loadEmailsForAccount(accountId) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  State.currentFolder = 'INBOX';
  document.getElementById('folder-title').textContent = 'Inbox';
  clearSelection();
  closeEmail();
  loadEmails({ folder: 'INBOX', account_id: accountId });
}

function renderEmailList(reset = true) {
  const el = document.getElementById('email-list');
  if (reset) el.innerHTML = '';

  if (State.emails.length === 0 && reset) {
    el.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text-3);font-size:14px">No emails here</div>`;
    return;
  }

  if (State.threadMode) {
    const visible = reset ? State.emails : State.emails.slice(-50);
    renderThreadedList(el, visible);
    return;
  }

  for (const email of (reset ? State.emails : State.emails.slice(-50))) {
    el.appendChild(buildEmailRow(email));
  }
}

function renderThreadedList(el, emails) {
  const threads = new Map();
  for (const email of emails) {
    const key = getThreadKey(email.subject);
    if (!threads.has(key)) threads.set(key, []);
    threads.get(key).push(email);
  }
  for (const [key, msgs] of threads) {
    el.appendChild(buildThreadRow(key, msgs));
  }
}

function buildThreadRow(key, msgs) {
  const latest = msgs[0];
  const row = buildEmailRow(latest);
  row.classList.add('thread-head');
  row.dataset.threadKey = key;

  if (msgs.length > 1) {
    const dateEl = row.querySelector('.row-date');
    if (dateEl) {
      const badge = document.createElement('span');
      badge.className = 'thread-count-badge';
      badge.textContent = msgs.length;
      dateEl.before(badge);
    }
    const senders = [...new Set(msgs.map(e => e.from_name?.split(' ')[0] || e.from_email.split('@')[0]))].slice(0, 3);
    const fromEl = row.querySelector('.row-from');
    if (fromEl) fromEl.textContent = senders.join(', ');

    row.addEventListener('click', (e) => {
      if (e.target.closest('.row-check')) return;
      e.stopImmediatePropagation();
      const next = row.nextElementSibling;
      if (next?.classList.contains('thread-expansion')) {
        next.remove();
      } else {
        const exp = document.createElement('div');
        exp.className = 'thread-expansion';
        for (const msg of msgs) {
          const r = buildEmailRow(msg);
          exp.appendChild(r);
        }
        row.after(exp);
      }
    }, true);
  }
  return row;
}

/* ── OTP / 2FA code extractor ───────────────────── */
function extractOtpCode(email) {
  const text = [(email.subject || ''), (email.body_text || '')].join(' ');
  const patterns = [
    // Explicit keyword + 4-8 digit code
    /(?:code|otp|pin|passcode|token|verification|confirm(?:ation)?|one[-\s]time|security)[^a-z0-9]{0,20}([0-9]{4,8})\b/i,
    // "123 456" or "123-456" spaced/dashed 6-digit
    /\b([0-9]{3}[\s\-][0-9]{3})\b/,
    // Bare 6-digit block (most common OTP length)
    /\b([0-9]{6})\b/,
    // Bare 8-digit
    /\b([0-9]{8})\b/,
    // Bare 4-digit
    /\b([0-9]{4})\b/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1].replace(/[\s\-]/g, '');
  }
  return null;
}

function buildEmailRow(email) {
  const row = document.createElement('div');
  row.className = `email-row${email.is_read ? '' : ' unread'}${State.selectedIds.has(email.id) ? ' selected' : ''}`;
  row.dataset.id = email.id;

  const avatarBg = getAvatarColor(email.from_email);
  const initials = getInitials(email.from_name, email.from_email);
  const fromDisplay = email.from_name || email.from_email;
  const otpCode = extractOtpCode(email);

  let badgesHtml = '';
  if (email.is_starred) badgesHtml += `<span class="row-star">★</span>`;
  if (email.awaiting_reply) badgesHtml += `<span class="row-await row-label" style="background: #06b6d415; color: var(--cyan)">⏱ Awaiting</span>`;
  if (email.ai_label) badgesHtml += `<span class="row-label" style="background: ${getLabelColor(email.ai_label)}20; color: ${getLabelColor(email.ai_label)}">${email.ai_label}</span>`;

  row.innerHTML = `
    <div class="row-check">
      <label>
        <input type="checkbox" data-id="${email.id}" ${State.selectedIds.has(email.id) ? 'checked' : ''}>
        <span class="custom-check"></span>
      </label>
    </div>
    <div class="row-avatar" style="background: ${avatarBg}30; color: ${avatarBg}">${initials}</div>
    <div class="row-body">
      <div class="row-top">
        <span class="row-from">${escHtml(fromDisplay)}</span>
        <span class="row-date">${formatDate(email.date)}</span>
      </div>
      <div class="row-subject">${escHtml(email.subject || '(no subject)')}</div>
      ${State.settings.show_preview !== false && email.body_text ? `<div class="row-preview">${escHtml((email.body_text || '').replace(/\s+/g, ' ').trim().slice(0, 120))}</div>` : ''}
      ${badgesHtml ? `<div class="row-badges">${badgesHtml}</div>` : ''}
    </div>
    ${otpCode ? `<button class="otp-copy-btn" data-code="${escHtml(otpCode)}" title="Copy code &amp; archive">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      <span>${escHtml(otpCode)}</span>
    </button>` : ''}
    ${email._sched
      ? `<button class="cancel-sched-btn" data-sched-id="${email._sched.id}" title="Cancel scheduled send" style="color:var(--red,#ef4444);background:none;border:1px solid var(--border);border-radius:7px;padding:4px 10px;font-size:12px;cursor:pointer;font-weight:500">✕ Cancel</button>`
      : `<button class="row-sum-btn" data-id="${email.id}" title="Quick summary">✦ Summary</button>`
    }
  `;

  // OTP copy button
  const otpBtn = row.querySelector('.otp-copy-btn');
  if (otpBtn) {
    otpBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const code = otpBtn.dataset.code;
      try { await navigator.clipboard.writeText(code); } catch (_) {
        // Fallback for older browsers
        const ta = document.createElement('textarea');
        ta.value = code; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); document.body.removeChild(ta);
      }
      toast(`✓ Copied ${code}`, 'success');
      // Archive and remove from list
      await api(`/api/emails/${email.id}`, { method: 'PATCH', body: { is_archived: 1 } });
      State.emails = State.emails.filter(e => e.id !== email.id);
      row.style.transition = 'opacity .25s, transform .25s';
      row.style.opacity = '0';
      row.style.transform = 'translateX(12px)';
      setTimeout(() => row.remove(), 260);
      updateStats();
    });
  }

  // Cancel scheduled send button
  const cancelSchedBtn = row.querySelector('.cancel-sched-btn');
  if (cancelSchedBtn) {
    cancelSchedBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Cancel this scheduled email?')) return;
      const res = await api(`/api/emails/scheduled/${cancelSchedBtn.dataset.schedId}`, { method: 'DELETE' });
      if (res?.ok !== false) {
        State.emails = State.emails.filter(em => em.id !== email.id);
        row.style.transition = 'opacity .2s';
        row.style.opacity = '0';
        setTimeout(() => row.remove(), 200);
        toast('Scheduled send cancelled', 'success');
      } else {
        toast('Failed to cancel', 'error');
      }
    });
  }

  // One-click inline summary button
  const sumBtn = row.querySelector('.row-sum-btn');
  if (sumBtn) {
    sumBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      // Toggle existing summary
      const existing = row.nextElementSibling;
      if (existing?.classList.contains('row-summary-inline')) { existing.remove(); return; }
      sumBtn.textContent = '…';
      sumBtn.disabled = true;
      const res = await api(`/api/ai/summarize/${email.id}`, { method: 'POST' });
      sumBtn.textContent = '✦ Summary';
      sumBtn.disabled = false;
      if (!res?.summary) { toast('Could not summarize', 'error'); return; }
      const box = document.createElement('div');
      box.className = 'row-summary-inline';
      box.textContent = res.summary;
      row.after(box);
    });
  }

  // Checkbox
  const cb = row.querySelector('input[type=checkbox]');
  cb.addEventListener('change', (e) => {
    e.stopPropagation();
    if (cb.checked) State.selectedIds.add(email.id);
    else State.selectedIds.delete(email.id);
    row.classList.toggle('selected', cb.checked);
    updateBulkBar();
  });

  row.addEventListener('click', (e) => {
    if (e.target.closest('.row-check') || e.target.closest('.otp-copy-btn') || e.target.closest('.cancel-sched-btn')) return;
    if (email._sched) return; // scheduled rows have their own cancel button, not a full view
    openEmail(email);
  });

  // Swipe-to-archive (left) / swipe-to-trash (right) on touch devices
  addSwipeGesture(row, email);

  return row;
}

function addSwipeGesture(row, email) {
  let sx = 0, sy = 0;
  row.addEventListener('touchstart', (e) => {
    sx = e.touches[0].clientX; sy = e.touches[0].clientY;
  }, { passive: true });
  row.addEventListener('touchmove', (e) => {
    const dx = e.touches[0].clientX - sx, dy = e.touches[0].clientY - sy;
    if (Math.abs(dy) > Math.abs(dx) + 10) return;
    const c = Math.max(-90, Math.min(90, dx));
    row.style.cssText += `;transform:translateX(${c}px);transition:none`;
    row.style.background = dx < -30 ? 'var(--accent-glow)' : dx > 30 ? '#ef444418' : '';
  }, { passive: true });
  row.addEventListener('touchend', async (e) => {
    const dx = e.changedTouches[0].clientX - sx;
    row.style.transform = ''; row.style.transition = ''; row.style.background = '';
    if (dx < -70) {
      await api(`/api/emails/${email.id}`, { method: 'PATCH', body: { is_archived: 1 } });
      row.style.animation = 'slideOutLeft .25s forwards';
      setTimeout(() => { row.remove(); State.emails = State.emails.filter(e => e.id !== email.id); }, 260);
      toast('Archived', 'success'); updateStats();
    } else if (dx > 70) {
      await api(`/api/emails/${email.id}`, { method: 'PATCH', body: { is_trash: 1 } });
      row.style.animation = 'slideOutRight .25s forwards';
      setTimeout(() => { row.remove(); State.emails = State.emails.filter(e => e.id !== email.id); }, 260);
      toast('Trashed'); updateStats();
    }
  });
}

function getLabelColor(labelName) {
  if (!labelName) return '#6366f1';
  const label = State.labels.find(l => l.name.toLowerCase() === labelName.toLowerCase());
  return label?.color || '#6366f1';
}

function escHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* Parse search operators: from: subject: has:attachment after: before: */
function parseSearchQuery(raw) {
  const params = {};
  let remaining = String(raw || '');
  const ops = [
    { re: /from:(\S+)/i, key: 'from' },
    { re: /subject:([^\s]+)/i, key: 'subject' },
    { re: /has:attachment/i, key: 'has_attachment', val: '1' },
    { re: /after:(\d{4}-\d{2}-\d{2})/i, key: 'after' },
    { re: /before:(\d{4}-\d{2}-\d{2})/i, key: 'before' },
  ];
  for (const op of ops) {
    const m = remaining.match(op.re);
    if (m) {
      params[op.key] = op.val !== undefined ? op.val : m[1];
      remaining = remaining.replace(m[0], '').replace(/\s+/g, ' ').trim();
    }
  }
  if (remaining) params.search = remaining;
  return params;
}

/* Thread helpers */
function getThreadKey(subject) {
  return (subject || '').toLowerCase()
    .replace(/^((re|fwd?|aw|von|tr|sv|回复|转发)(\[\d+\])?\s*:\s*)*/gi, '')
    .replace(/\s+/g, ' ').trim();
}

/* ── Email View ──────────────────────────────────── */
async function openEmail(email) {
  State.currentEmailId = email.id;

  // Highlight in list
  document.querySelectorAll('.email-row').forEach(r => r.classList.remove('active'));
  const row = document.querySelector(`.email-row[data-id="${email.id}"]`);
  if (row) {
    row.classList.add('active');
    row.classList.remove('unread');
    row.style.removeProperty('--before-bg');
  }

  // Show view pane
  document.getElementById('view-empty').style.display = 'none';
  const view = document.getElementById('email-view');
  view.style.display = 'flex';
  view.style.flexDirection = 'column';
  view.style.height = '100%';
  // Sentinel: ensures snooze btn uses correct id + non-snoozed state during async load
  view._email = { id: email.id, snoozed_until: null };

  // Fetch full email
  const data = await api(`/api/emails/${email.id}`);
  if (!data) return;

  // Populate header
  document.getElementById('view-subject').textContent = data.subject || '(no subject)';
  const fromDisplay = data.from_name || data.from_email;
  document.getElementById('view-avatar').textContent = getInitials(data.from_name, data.from_email);
  document.getElementById('view-avatar').style.background =
    `linear-gradient(135deg, ${getAvatarColor(data.from_email)}, ${getAvatarColor(data.from_email + '1')})`;
  document.getElementById('view-from-name').textContent = fromDisplay;
  document.getElementById('view-from-email').textContent = data.from_email ? `<${data.from_email}>` : '';
  document.getElementById('view-date').textContent = data.date
    ? new Date(data.date * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '';

  // Expandable header details
  document.getElementById('edr-from').textContent =
    data.from_name ? `${data.from_name} <${data.from_email}>` : (data.from_email || '');
  document.getElementById('edr-to').textContent = data.to_addresses || '—';
  const ccRow = document.getElementById('edr-cc-row');
  if (data.cc_addresses) {
    document.getElementById('edr-cc').textContent = data.cc_addresses;
    ccRow.style.display = '';
  } else {
    ccRow.style.display = 'none';
  }
  document.getElementById('edr-account').textContent =
    data.account_label ? `${data.account_label} <${data.account_email}>` : (data.account_email || '');
  document.getElementById('edr-date-full').textContent = data.date
    ? new Date(data.date * 1000).toLocaleString(undefined, { weekday: 'short', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' })
    : '';

  // Reset collapsed state on each email open
  const detailsPanel = document.getElementById('view-header-details');
  const chevron = document.getElementById('view-details-chevron');
  detailsPanel.classList.remove('open');
  chevron.classList.remove('open');
  const toggleBtn = document.getElementById('view-from-email-btn');
  // Remove old listener by cloning
  const freshBtn = toggleBtn.cloneNode(true);
  toggleBtn.parentNode.replaceChild(freshBtn, toggleBtn);
  document.getElementById('view-from-email-btn').addEventListener('click', () => {
    const p = document.getElementById('view-header-details');
    const c = document.getElementById('view-details-chevron');
    p.classList.toggle('open');
    c.classList.toggle('open');
  });

  // Tags
  const tagRow = document.getElementById('view-tags');
  tagRow.innerHTML = '';
  if (data.ai_label) {
    const tag = document.createElement('span');
    tag.className = 'tag ai';
    tag.style.background = getLabelColor(data.ai_label) + '20';
    tag.style.color = getLabelColor(data.ai_label);
    tag.style.borderColor = getLabelColor(data.ai_label) + '40';
    tag.textContent = data.ai_label;
    tagRow.appendChild(tag);
  }
  if (data.awaiting_reply) {
    const tag = document.createElement('span');
    tag.className = 'tag await';
    tag.textContent = '⏱ Awaiting Reply';
    tagRow.appendChild(tag);
  }
  for (const label of (data.labels || [])) {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.style.background = label.color + '20';
    tag.style.color = label.color;
    tag.style.borderColor = label.color + '40';
    tag.textContent = label.name;
    tagRow.appendChild(tag);
  }

  // AI summary (if exists)
  const summaryBox = document.getElementById('ai-summary-box');
  if (data.ai_summary) {
    document.getElementById('ai-summary-text').textContent = data.ai_summary;
    summaryBox.style.display = 'block';
  } else {
    summaryBox.style.display = 'none';
  }

  // Body: render in iframe sandbox
  const iframe = document.getElementById('email-iframe');
  // Strip scripts, on-* attrs and external tracking pixels that trigger console noise
  let rawHtml = data.body_html || '';
  if (rawHtml) {
    rawHtml = rawHtml
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<script\b[^>]*\/>/gi, '')
      .replace(/\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi, '')
      // Strip presentational HTML attributes that cause ugly borders/spacing in layout tables
      .replace(/<(table|td|th|tr)\b([^>]*?)(\s+border\s*=\s*["']?\d+["']?)/gi, '<$1$2')
      .replace(/<(table)\b([^>]*?)(\s+cellpadding\s*=\s*["']?\d+["']?)/gi, '<$1$2')
      .replace(/<(table)\b([^>]*?)(\s+cellspacing\s*=\s*["']?\d+["']?)/gi, '<$1$2');
  }
  const bodyHtml = rawHtml || `<pre style="font-family:inherit;white-space:pre-wrap;padding:20px">${(data.body_text || '').replace(/</g, '&lt;')}</pre>`;
  const iframeDoc = `<!DOCTYPE html><html><head>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      *, *::before, *::after { box-sizing: border-box; }
      body {
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
        font-size: 14.5px;
        line-height: 1.7;
        padding: 28px 32px 36px;
        margin: 0;
        color: #1c1c28;
        background: #ffffff;
        -webkit-font-smoothing: antialiased;
      }
      img { max-width: 100%; height: auto; border-radius: 6px; }
      a { color: #6366f1; text-decoration: underline; text-underline-offset: 2px; }
      a:hover { color: #8b5cf6; }
      pre, code { font-family: 'Menlo', 'Consolas', monospace; font-size: 13px; }
      pre { white-space: pre-wrap; background: #f4f4f8; padding: 14px 16px; border-radius: 8px; border-left: 3px solid #6366f1; }
      blockquote { margin: 0 0 1em; padding-left: 16px; border-left: 3px solid #e2e2ea; color: #6b6b80; }
      table { border-collapse: collapse; max-width: 100%; font-size: 13.5px; }
      td, th { padding: 0; vertical-align: top; border: none; }
      th { font-weight: 600; }
      hr { border: none; border-top: 1px solid #e5e5ea; margin: 1.5em 0; }
      p { margin: 0 0 1em; }
      h1,h2,h3 { font-weight: 700; line-height: 1.3; margin: 0 0 .6em; color: #0f0f1a; }
    </style>
  </head><body>${bodyHtml}</body></html>`;
  iframe.srcdoc = iframeDoc;
  // Poll height for 4 s to catch late-loading images
  iframe.onload = () => {
    let prev = 0, ticks = 0;
    const t = setInterval(() => {
      try {
        const h = iframe.contentDocument?.documentElement?.scrollHeight
          || iframe.contentDocument?.body?.scrollHeight || 400;
        if (Math.abs(h - prev) > 4) { iframe.style.height = (h + 40) + 'px'; prev = h; }
      } catch (_) { }
      if (++ticks > 20) clearInterval(t);
    }, 200);

    // Intercept external link clicks – show confirm dialog instead of navigating
    try {
      iframe.contentDocument.addEventListener('click', (e) => {
        const a = e.target.closest('a[href]');
        if (!a) return;
        const href = a.getAttribute('href');
        if (!href) return;
        let external = false;
        try {
          const u = new URL(href);
          external = u.protocol === 'http:' || u.protocol === 'https:';
        } catch (_) { }
        if (!external) return;
        e.preventDefault();
        showLinkConfirm(href);
      });
    } catch (_) { }
  };

  // Attachments — click opens preview for images/PDFs, downloads the rest
  const attRow = document.getElementById('attachments-row');
  const attList = document.getElementById('attachments-list');
  if (data.attachments?.length) {
    attList.innerHTML = data.attachments.map(att => `
      <div class="attach-chip" style="cursor:pointer;position:relative"
           data-att-id="${att.id}" data-email-id="${data.id}"
           data-filename="${escHtml(att.filename)}" data-ct="${escHtml(att.content_type || '')}">
        📎 <span>${escHtml(att.filename)}</span>
        <span class="attach-size">${att.size ? (att.size / 1024).toFixed(0) + ' KB' : ''}</span>
        <button class="attach-sum-btn" title="Summarize with AI" data-att-id="${att.id}" data-email-id="${data.id}">✦</button>
      </div>
    `).join('');
    attList.addEventListener('click', (e) => {
      const sumB = e.target.closest('.attach-sum-btn');
      if (sumB) {
        e.stopPropagation();
        summarizeAttachment(sumB.dataset.emailId, sumB.dataset.attId, sumB);
        return;
      }
      const chip = e.target.closest('.attach-chip');
      if (!chip) return;
      window.openPreview?.(chip.dataset.emailId, chip.dataset.attId, chip.dataset.filename, chip.dataset.ct);
    });
    attRow.style.display = 'block';
  } else {
    attRow.style.display = 'none';
  }

  // Update action button states
  document.getElementById('btn-view-star').classList.toggle('active', data.is_starred === 1);
  document.getElementById('btn-view-await').classList.toggle('active', data.awaiting_reply === 1);
  document.getElementById('btn-view-archive').title = data.is_archived ? 'Unarchive' : 'Archive';
  document.getElementById('btn-view-archive').classList.toggle('active', data.is_archived === 1);

  // Snooze button: toggle to "Unsnooze" when the email is currently snoozed
  const snoozeBtn = document.getElementById('btn-view-snooze');
  const isSnoozed = data.snoozed_until && data.snoozed_until > Math.floor(Date.now() / 1000);
  snoozeBtn.title = isSnoozed ? 'Unsnooze' : 'Snooze';
  snoozeBtn.classList.toggle('active', !!isSnoozed);

  // Unsubscribe button visibility
  const unsubBtn = document.getElementById('btn-view-unsub');
  unsubBtn.style.display = data.unsubscribe_url ? 'inline-flex' : 'none';

  // Smart replies – reset each open
  const smartRow = document.getElementById('smart-replies-row');
  const smartChips = document.getElementById('smart-replies-chips');
  const smartTrigger = document.getElementById('btn-smart-replies');
  smartChips.innerHTML = '';
  smartTrigger.disabled = false;
  smartTrigger.textContent = '';
  smartTrigger.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg> Suggest replies\u2026`;
  smartRow.style.display = 'flex';

  // Store current email data for actions
  view._email = data;

  // Calendar detection (ICS attachments + date/time patterns)
  window.detectAndShowCalendar?.(data);

  // Mobile: show view pane
  document.getElementById('view-pane').classList.add('mobile-show');
}

/* ── View Actions ────────────────────────────────── */
document.getElementById('btn-back').addEventListener('click', () => {
  closeEmail();
});

document.getElementById('btn-view-reply').addEventListener('click', () => {
  const email = document.getElementById('email-view')._email;
  if (!email) return;
  openCompose({
    to: email.from_email,
    subject: email.subject?.startsWith('Re:') ? email.subject : `Re: ${email.subject}`,
    inReplyTo: email.message_id,
    originalBody: `\n\n---\nOn ${new Date(email.date * 1000).toLocaleString()}, ${email.from_name || email.from_email} wrote:\n${(email.body_text || '').substring(0, 1000)}`,
    originalEmailId: email.id
  });
});

document.getElementById('btn-view-reply-all').addEventListener('click', () => {
  const email = document.getElementById('email-view')._email;
  if (!email) return;
  const myEmails = new Set(State.accounts.map(a => a.email.toLowerCase()));
  const allTo = [
    ...(email.to_addresses || '').split(','),
    ...(email.cc_addresses || '').split(','),
  ].map(s => s.trim()).filter(s => s && !myEmails.has(s.toLowerCase()));
  const cc = [...new Set(allTo)].join(', ');
  openCompose({
    to: email.from_email,
    cc,
    subject: email.subject?.startsWith('Re:') ? email.subject : `Re: ${email.subject}`,
    inReplyTo: email.message_id,
    originalBody: `\n\n---\nOn ${new Date(email.date * 1000).toLocaleString()}, ${email.from_name || email.from_email} wrote:\n${(email.body_text || '').substring(0, 1000)}`,
    originalEmailId: email.id
  });
});

document.getElementById('btn-view-forward').addEventListener('click', () => {
  const email = document.getElementById('email-view')._email;
  if (!email) return;
  openCompose({
    subject: email.subject?.startsWith('Fwd:') ? email.subject : `Fwd: ${email.subject}`,
    originalBody: `\n\n---\n---------- Forwarded message ----------\nFrom: ${email.from_email}\nSubject: ${email.subject}\n\n${email.body_text || ''}`
  });
});

document.getElementById('btn-view-star').addEventListener('click', async () => {
  const emailView = document.getElementById('email-view');
  const email = emailView._email;
  if (!email) return;
  const newVal = email.is_starred ? 0 : 1;
  await api(`/api/emails/${email.id}`, { method: 'PATCH', body: { is_starred: newVal } });
  email.is_starred = newVal;
  document.getElementById('btn-view-star').classList.toggle('active', newVal === 1);
  toast(newVal ? 'Starred ★' : 'Unstarred', 'success');
  refreshEmailRow(email.id, { is_starred: newVal });
  updateStats();
});

document.getElementById('btn-view-archive').addEventListener('click', async () => {
  const email = document.getElementById('email-view')._email;
  if (!email) return;
  const nowArchived = email.is_archived ? 0 : 1;
  await api(`/api/emails/${email.id}`, { method: 'PATCH', body: { is_archived: nowArchived } });
  email.is_archived = nowArchived;
  document.getElementById('btn-view-archive').title = nowArchived ? 'Unarchive' : 'Archive';
  document.getElementById('btn-view-archive').classList.toggle('active', nowArchived === 1);
  if (nowArchived === 1) {
    toast('Archived', 'success');
    if (State.currentFolder !== 'archive') { removeEmailFromList(email.id); showNextEmail(); }
  } else {
    toast('Moved back to inbox', 'success');
    closeEmail();
    await loadEmails();
  }
  updateStats();
});

document.getElementById('btn-view-trash').addEventListener('click', async () => {
  const email = document.getElementById('email-view')._email;
  if (!email) return;
  await api(`/api/emails/${email.id}`, { method: 'PATCH', body: { is_trash: 1 } });
  toast('Moved to trash');
  removeEmailFromList(email.id);
  showNextEmail();
  updateStats();
});

document.getElementById('btn-view-spam').addEventListener('click', async () => {
  const email = document.getElementById('email-view')._email;
  if (!email) return;
  if (!confirm('Mark as spam and move to Spam folder?')) return;
  const res = await api(`/api/emails/${email.id}/spam`, { method: 'POST' });
  if (res?.ok) {
    toast('Marked as spam', 'success');
    removeEmailFromList(email.id);
    showNextEmail();
    updateStats();
  } else {
    toast(res?.error || 'Failed', 'error');
  }
});

/* Move-to-folder picker */
(function () {
  const picker = document.getElementById('folder-picker');
  const pickerList = document.getElementById('folder-picker-list');
  const searchInput = document.getElementById('folder-picker-search');
  let allFolders = [];

  document.getElementById('btn-view-move').addEventListener('click', async (e) => {
    e.stopPropagation();
    if (picker.classList.contains('open')) { picker.classList.remove('open'); return; }
    const email = document.getElementById('email-view')._email;
    if (!email) return;
    pickerList.innerHTML = '<div style="padding:8px 12px;font-size:12px;color:var(--text-3)">Loading…</div>';
    picker.classList.add('open');
    searchInput.value = '';
    searchInput.focus();
    // Fetch folders for the account
    const data = await api(`/api/accounts/${email.account_id}/folders`).catch(() => null);
    allFolders = Array.isArray(data) ? data.map(f => f.path || f.name) : [];
    renderFolderList(allFolders);
  });

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.toLowerCase();
    renderFolderList(q ? allFolders.filter(f => f.toLowerCase().includes(q)) : allFolders);
  });

  function renderFolderList(folders) {
    if (!folders.length) { pickerList.innerHTML = '<div style="padding:8px 12px;font-size:12px;color:var(--text-3)">No folders</div>'; return; }
    pickerList.innerHTML = folders.map(f => `<div class="folder-picker-item" data-folder="${escHtml(f)}">${escHtml(f)}</div>`).join('');
  }

  pickerList.addEventListener('click', async (e) => {
    const item = e.target.closest('.folder-picker-item');
    if (!item) return;
    picker.classList.remove('open');
    const email = document.getElementById('email-view')._email;
    if (!email) return;
    const folder = item.dataset.folder;
    const res = await api(`/api/emails/${email.id}/move`, { method: 'POST', body: { folder } });
    if (res?.ok) {
      toast(`Moved to ${folder}`, 'success');
      removeEmailFromList(email.id);
      showNextEmail();
    } else {
      toast(res?.error || 'Move failed', 'error');
    }
  });

  // Close picker when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.move-btn-wrap')) picker.classList.remove('open');
  });
})();

/* Thread toggle */
document.getElementById('btn-thread-toggle').addEventListener('click', () => {
  State.threadMode = !State.threadMode;
  const btn = document.getElementById('btn-thread-toggle');
  btn.classList.toggle('active', State.threadMode);
  btn.title = State.threadMode ? 'Switch to flat view' : 'Switch to thread view';
  renderEmailList();
});

document.getElementById('btn-view-await').addEventListener('click', async () => {
  const email = document.getElementById('email-view')._email;
  if (!email) return;
  const newVal = email.awaiting_reply ? 0 : 1;
  await api(`/api/emails/${email.id}`, { method: 'PATCH', body: { awaiting_reply: newVal } });
  email.awaiting_reply = newVal;
  document.getElementById('btn-view-await').classList.toggle('active', newVal === 1);
  toast(newVal ? '⏱ Tracking for reply' : 'Untracked', 'success');
  refreshEmailRow(email.id, { awaiting_reply: newVal });
  updateStats();
});

function removeEmailFromList(id) {
  State.emails = State.emails.filter(e => e.id !== id);
  const row = document.querySelector(`.email-row[data-id="${id}"]`);
  if (row) row.remove();
}

function refreshEmailRow(id, updates) {
  const idx = State.emails.findIndex(e => e.id === id);
  if (idx > -1) Object.assign(State.emails[idx], updates);
  const row = document.querySelector(`.email-row[data-id="${id}"]`);
  if (row) {
    const updated = State.emails[idx];
    const newRow = buildEmailRow(updated);
    row.replaceWith(newRow);
  }
}

function showNextEmail() {
  if (State.emails.length === 0) {
    closeEmail(); // removes mobile-show so mobile user returns to the list
    return;
  }
  const idx = State.emails.findIndex(e => e.id === State.currentEmailId);
  const next = State.emails[idx + 1] || State.emails[idx - 1] || State.emails[0];
  if (next) openEmail(next);
}

/* ── Navigation ──────────────────────────────────── */
function setActiveNav(el) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  el.classList.add('active');
}

document.getElementById('sidebar-nav').addEventListener('click', async (e) => {
  const item = e.target.closest('[data-folder]');
  if (!item) return;
  setActiveNav(item);
  const folder = item.dataset.folder;
  State.currentFolder = folder;
  State.searchQuery = '';
  document.getElementById('search-input').value = '';
  clearSelection();
  closeEmail();

  const folderNames = {
    INBOX: 'Inbox', starred: 'Starred', awaiting: 'Awaiting Reply',
    sent: 'Sent', archive: 'Archive', trash: 'Trash', all: 'All Mail',
    snoozed: 'Snoozed', scheduled: 'Scheduled'
  };
  document.getElementById('folder-title').textContent = folderNames[folder] || folder;
  await loadEmails();
});

/* ── Search ──────────────────────────────────────── */
document.getElementById('search-input').addEventListener('input', (e) => {
  clearTimeout(State.searchTimeout);
  State.searchQuery = e.target.value.trim();
  State.searchTimeout = setTimeout(() => loadEmails(), 350);
});

/* ── Check All ───────────────────────────────────── */
document.getElementById('check-all').addEventListener('change', (e) => {
  if (e.target.checked) {
    State.emails.forEach(em => State.selectedIds.add(em.id));
  } else {
    State.selectedIds.clear();
  }
  document.querySelectorAll('.email-row').forEach(row => {
    const id = Number(row.dataset.id);
    row.classList.toggle('selected', State.selectedIds.has(id));
    const cb = row.querySelector('input[type=checkbox]');
    if (cb) cb.checked = State.selectedIds.has(id);
  });
  updateBulkBar();
});

function updateBulkBar() {
  const bar = document.getElementById('bulk-actions');
  const count = document.getElementById('sel-count');
  const search = document.querySelector('.search-wrap');
  const sync = document.getElementById('btn-sync');
  const active = State.selectedIds.size > 0;
  bar.style.display = active ? 'flex' : 'none';
  count.style.display = active ? 'inline-flex' : 'none';
  count.textContent = `${State.selectedIds.size} selected`;
  if (search) search.style.display = active ? 'none' : '';
  if (sync) sync.style.display = active ? 'none' : '';
}

/* ── Bulk Actions ────────────────────────────────── */
document.querySelectorAll('[data-bulk]').forEach(btn => {
  btn.addEventListener('click', async () => {
    if (State.selectedIds.size === 0) return;
    const action = btn.dataset.bulk;
    const res = await api('/api/emails/bulk', {
      method: 'POST',
      body: { ids: [...State.selectedIds], action }
    });
    if (res?.ok) {
      toast(`Done (${res.affected} emails)`, 'success');
      // Update in-place for read/unread to avoid full reload flash
      if (action === 'read' || action === 'unread') {
        const isRead = action === 'read';
        res.ids?.forEach(id => {
          const em = State.emails.find(e => e.id === id);
          if (em) em.is_read = isRead;
          const row = document.querySelector(`.email-row[data-id="${id}"]`);
          if (row) row.classList.toggle('unread', !isRead);
        });
      }
      State.selectedIds.clear();
      document.getElementById('check-all').checked = false;
      updateBulkBar();
      // Full reload only for non-read actions (delete, archive, move)
      if (action !== 'read' && action !== 'unread') {
        await loadEmails();
      }
      await updateStats();
    }
  });
});

/* ── Sync All ────────────────────────────────────── */
document.getElementById('btn-sync').addEventListener('click', async () => {
  const btn = document.getElementById('btn-sync');
  btn.innerHTML = '<span class="spinner"></span>';
  btn.disabled = true;
  for (const acc of State.accounts) {
    await api(`/api/accounts/${acc.id}/sync`, { method: 'POST' });
  }
  await loadEmails();
  await updateStats();
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>`;
  btn.disabled = false;
  toast('Synced all accounts', 'success');
});

/* ── Load More ───────────────────────────────────── */
document.getElementById('load-more').addEventListener('click', () => {
  State.offset += 50;
  loadEmails({}, false);
});

/* ── Stats & Badges ─────────────────────────────── */
async function updateStats() {
  const stats = await api('/api/emails/stats/summary');
  if (!stats) return;
  setBadge('badge-starred', stats.starred);
  setBadge('badge-awaiting', stats.awaiting);
  document.title = stats.unread > 0 ? `(${stats.unread}) NeoMail` : 'NeoMail';
}

function setBadge(id, count) {
  const el = document.getElementById(id);
  if (!el) return;
  if (count > 0) { el.textContent = count > 99 ? '99+' : count; el.classList.add('show'); }
  else { el.classList.remove('show'); }
}

function updateUnreadBadges(counts) {
  if (!counts) return;
  const inbox = counts.find(c => c.folder === 'INBOX');
  setBadge('badge-inbox', inbox?.count || 0);
}

/* ── SSE (real-time) ─────────────────────────────── */
function showNativeNotification(title, body, tag) {
  if ('Notification' in window && Notification.permission === 'granted') {
    // Use SW notification so it works when page is in background
    if (navigator.serviceWorker?.controller) {
      navigator.serviceWorker.ready.then(reg => {
        reg.showNotification(title, {
          body,
          icon: '/icon.svg',
          badge: '/icon.svg',
          tag: tag || 'mailneo-mail',
          renotify: true,
          data: { url: '/app' }
        });
      }).catch(() => new Notification(title, { body, icon: '/icon.svg', tag }));
    } else {
      new Notification(title, { body, icon: '/icon.svg', tag });
    }
  }
}

function setupSSE() {
  const es = new EventSource('/api/events');
  es.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.type === 'new_mail') {
        loadEmails();
        updateStats();
        toast(`📬 ${data.count} new email(s)`, 'success');
        // Native notification
        const notifTitle = data.count === 1 && data.from
          ? `New mail from ${data.from}`
          : `${data.count} new email(s)`;
        const notifBody = data.subject || 'You have new mail in NeoMail';
        showNativeNotification(notifTitle, notifBody, 'mailneo-mail');
      }
    } catch (_) { }
  };
  es.onerror = () => { /* retry is automatic */ };
}

/* ── Buttons ─────────────────────────────────────── */
document.getElementById('btn-compose').addEventListener('click', () => openCompose());

document.getElementById('btn-logout').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login';
});

document.getElementById('btn-settings').addEventListener('click', () => {
  window.openSettings();
});

document.getElementById('btn-add-account').addEventListener('click', () => {
  window.openAccountModal();
});

/* ── Keyboard Shortcuts ──────────────────────────── */
document.addEventListener('keydown', async (e) => {
  // Ignore when typing in inputs/textareas/contenteditable
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
  if (e.target.isContentEditable) return;
  // Ignore modifier-key combos (Cmd+C, Ctrl+C, Alt+…, etc.)
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  // Ignore when modals are open
  if (document.getElementById('settings-overlay')?.style.display === 'flex') return;
  if (document.getElementById('compose-modal')?.style.display === 'flex') return;
  if (document.getElementById('account-modal-overlay')?.style.display === 'flex') return;

  switch (e.key) {
    case 'c':
      e.preventDefault();
      window.openCompose?.();
      break;
    case 'r':
      if (State.currentEmailId) {
        e.preventDefault();
        document.getElementById('btn-reply')?.click();
      }
      break;
    case 'e': {
      if (State.currentEmailId) {
        e.preventDefault();
        document.getElementById('btn-view-archive')?.click();
      }
      break;
    }
    case 's': {
      // Star / unstar current email
      if (State.currentEmailId) {
        e.preventDefault();
        document.getElementById('btn-star')?.click();
      }
      break;
    }
    case 'Escape':
      if (State.currentEmailId) { e.preventDefault(); closeEmail(); }
      break;
    case 'Delete':
    case 'Backspace': {
      // Delete selected emails or the currently open email
      const toDelete = State.selectedIds.size > 0
        ? [...State.selectedIds]
        : State.currentEmailId ? [State.currentEmailId] : null;
      if (!toDelete) break;
      e.preventDefault();
      const res = await api('/api/emails/bulk', {
        method: 'POST',
        body: { ids: toDelete, action: 'delete' }
      });
      if (res?.ok) {
        toast(`Deleted ${res.affected} email${res.affected !== 1 ? 's' : ''}`, 'success');
        State.selectedIds.clear();
        document.getElementById('check-all').checked = false;
        updateBulkBar();
        if (State.currentEmailId && toDelete.includes(State.currentEmailId)) closeEmail();
        await loadEmails();
        await updateStats();
      }
      break;
    }
    case '?': {
      e.preventDefault();
      toast('Shortcuts: [c] Compose · [r] Reply · [e] Archive · [s] Star · [Del] Delete · [Esc] Close', 'info', 5000);
      break;
    }
  }
});

/* ── Snooze ──────────────────────────────────────── */
(function () {
  const overlay = document.getElementById('snooze-overlay');
  const opts = document.getElementById('snooze-options');
  const customDt = document.getElementById('snooze-custom-dt');
  const btnCustom = document.getElementById('btn-snooze-custom');

  document.getElementById('btn-view-snooze').addEventListener('click', (e) => {
    e.stopPropagation();
    const email = document.getElementById('email-view')._email;
    if (!email) return;

    // If currently snoozed, unsnooze immediately instead of opening the picker
    if (email.snoozed_until && email.snoozed_until > Math.floor(Date.now() / 1000)) {
      doUnsnooze(email.id);
      return;
    }
    const now = Date.now();
    const presets = [
      { label: 'In 1 hour', ts: now + 3600_000 },
      { label: 'Later today', ts: setHours(now, 18) },
      { label: 'Tomorrow', ts: setHours(now + 86400_000, 9) },
      { label: 'This weekend', ts: nextWeekday(now, 6, 10) },
      { label: 'Next week', ts: nextWeekday(now, 1, 9) },
    ];
    opts.innerHTML = presets.map(p => `
      <div class="snooze-opt" data-ts="${Math.floor(p.ts / 1000)}">
        <span class="snooze-opt-label">${p.label}</span>
        <span class="snooze-opt-time">${new Date(p.ts).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
      </div>
    `).join('');
    // Set default custom value to tomorrow morning
    const tmr = new Date(now + 86400_000);
    tmr.setHours(9, 0, 0, 0);
    customDt.value = tmr.toISOString().slice(0, 16);
    overlay.style.display = 'flex';
    overlay._emailId = email.id;
  });

  opts.addEventListener('click', (e) => {
    const opt = e.target.closest('.snooze-opt');
    if (!opt) return;
    doSnooze(overlay._emailId, parseInt(opt.dataset.ts));
  });

  btnCustom.addEventListener('click', () => {
    const ts = Math.floor(new Date(customDt.value).getTime() / 1000);
    if (isNaN(ts) || ts <= 0) { toast('Invalid date', 'error'); return; }
    doSnooze(overlay._emailId, ts);
  });

  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.style.display = 'none'; });

  async function doSnooze(emailId, unixTs) {
    overlay.style.display = 'none';
    const res = await api(`/api/emails/${emailId}/snooze`, { method: 'PATCH', body: { until: unixTs } });
    if (res?.ok) {
      toast('Snoozed ✓', 'success');
      closeEmail();
      await loadEmails();
      updateStats();
    } else {
      toast('Snooze failed', 'error');
    }
  }

  async function doUnsnooze(emailId) {
    const res = await api(`/api/emails/${emailId}/unsnooze`, { method: 'POST' });
    if (res?.ok) {
      toast('Unsnoozed – back in inbox', 'success');
      closeEmail();
      await loadEmails();
      updateStats();
    } else {
      toast('Unsnooze failed', 'error');
    }
  }

  function setHours(base, h) {
    const d = new Date(base); d.setHours(h, 0, 0, 0); return d.getTime();
  }
  function nextWeekday(base, dow, h) {
    const d = new Date(base); d.setHours(h, 0, 0, 0);
    while (d.getDay() !== dow) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
})();

/* ── Unsubscribe ─────────────────────────────────── */
document.getElementById('btn-view-unsub').addEventListener('click', () => {
  const bar = document.getElementById('unsub-confirm-bar');
  bar.style.display = bar.style.display === 'none' ? 'flex' : 'none';
});
document.getElementById('btn-unsub-yes').addEventListener('click', async () => {
  const email = document.getElementById('email-view')._email;
  if (!email) return;
  document.getElementById('unsub-confirm-bar').style.display = 'none';
  const res = await api('/api/emails/unsubscribe', { method: 'POST', body: { ids: [email.id] } });
  if (res?.ok) {
    toast('Unsubscribed ✓', 'success');
    document.getElementById('btn-view-unsub').style.display = 'none';
  } else {
    toast(res?.error || 'Unsubscribe failed', 'error');
  }
});
document.getElementById('btn-unsub-no').addEventListener('click', () => {
  document.getElementById('unsub-confirm-bar').style.display = 'none';
});

/* ── Smart replies ───────────────────────────────── */
document.getElementById('btn-smart-replies').addEventListener('click', async () => {
  const email = document.getElementById('email-view')._email;
  if (!email) return;
  const btn = document.getElementById('btn-smart-replies');
  const chips = document.getElementById('smart-replies-chips');
  if (chips.children.length) { chips.innerHTML = ''; return; }
  btn.disabled = true;
  btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Loading…';
  const res = await api(`/api/ai/smart-replies/${email.id}`, { method: 'POST' });
  btn.disabled = false;
  btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg> Suggest replies…`;
  if (!res?.replies?.length) { toast('No suggestions available', 'error'); return; }
  chips.innerHTML = res.replies.map(r => `<button class="smart-reply-chip">${escHtml(r)}</button>`).join('');
  chips.querySelectorAll('.smart-reply-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      openCompose({
        to: email.from_email,
        subject: email.subject?.startsWith('Re:') ? email.subject : `Re: ${email.subject}`,
        inReplyTo: email.message_id,
        originalEmailId: email.id,
        prefillBody: chip.textContent
      });
    });
  });
});

/* ── Attachment summarizer ───────────────────────── */
async function summarizeAttachment(emailId, attId, btn) {
  const chip = btn.closest('.attach-chip');
  // Remove existing summary if present
  const existing = chip.nextElementSibling;
  if (existing?.classList.contains('attach-summary-box')) { existing.remove(); return; }
  btn.textContent = '…';
  btn.disabled = true;
  const res = await api(`/api/ai/summarize-attachment/${emailId}/${attId}`, { method: 'POST' });
  btn.textContent = '✦';
  btn.disabled = false;
  if (!res?.summary) { toast('Could not summarize attachment', 'error'); return; }
  const box = document.createElement('div');
  box.className = 'attach-summary-box';
  box.textContent = res.summary;
  chip.after(box);
}

/* ── External link confirm dialog ───────────────── */
function showLinkConfirm(url) {
  const overlay = document.getElementById('link-confirm-overlay');
  document.getElementById('link-confirm-url').textContent = url;
  overlay.style.display = 'flex';

  const open = document.getElementById('link-confirm-open');
  const cancel = document.getElementById('link-confirm-cancel');

  const close = () => { overlay.style.display = 'none'; };

  // Replace listeners each time to avoid stacking
  open.replaceWith(open.cloneNode(true));
  cancel.replaceWith(cancel.cloneNode(true));
  document.getElementById('link-confirm-open').addEventListener('click', () => {
    close();
    window.open(url, '_blank', 'noopener,noreferrer');
  });
  document.getElementById('link-confirm-cancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); }, { once: true });
}

/* ── Mobile Refresh Button ───────────────────────── */
document.getElementById('btn-mobile-refresh').addEventListener('click', async () => {
  const btn = document.getElementById('btn-mobile-refresh');
  btn.innerHTML = '<span class="spinner"></span>';
  btn.disabled = true;
  await loadEmails();
  await updateStats();
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>`;
  btn.disabled = false;
});

/* ── Pull-to-Refresh ─────────────────────────────── */
(function initPullToRefresh() {
  const list = document.getElementById('email-list');
  const indicator = document.getElementById('ptr-indicator');
  const THRESHOLD = 72;   // px to pull before triggering
  let startY = 0;
  let pulling = false;
  let triggered = false;

  list.addEventListener('touchstart', (e) => {
    if (list.scrollTop !== 0) return;
    startY = e.touches[0].clientY;
    pulling = true;
    triggered = false;
  }, { passive: true });

  list.addEventListener('touchmove', (e) => {
    if (!pulling) return;
    if (list.scrollTop !== 0) { pulling = false; return; }
    const dy = e.touches[0].clientY - startY;
    if (dy <= 0) return;
    // Show indicator
    indicator.classList.add('ptr-visible');
    // Rotate the arrow based on pull distance
    const progress = Math.min(dy / THRESHOLD, 1);
    const rotation = progress * 180;
    const svg = indicator.querySelector('.ptr-spinner');
    if (!indicator.classList.contains('ptr-refreshing')) {
      svg.style.transform = `rotate(${rotation}deg)`;
      svg.style.opacity = 0.4 + 0.6 * progress;
    }
    if (dy >= THRESHOLD && !triggered) {
      triggered = true;
    }
  }, { passive: true });

  list.addEventListener('touchend', async () => {
    if (!pulling) return;
    pulling = false;
    if (!triggered) {
      indicator.classList.remove('ptr-visible');
      return;
    }
    // Enter refreshing state
    indicator.classList.add('ptr-refreshing');
    const svg = indicator.querySelector('.ptr-spinner');
    svg.style.transform = '';
    svg.style.opacity = '';
    await loadEmails();
    await updateStats();
    indicator.classList.remove('ptr-refreshing');
    indicator.classList.remove('ptr-visible');
    triggered = false;
  });
})();

/* ── Expose globals for other scripts ────────────── */
window.State = State;
window.api = api;
window.toast = toast;
window.loadEmails = loadEmails;
window.loadAccounts = loadAccounts;
window.loadLabels = loadLabels;
window.formatDate = formatDate;
window.escHtml = escHtml;
window.getLabelColor = getLabelColor;
window.openEmail = openEmail;
window.closeEmail = closeEmail;
window.updateStats = updateStats;

/* ── Boot ────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', init);
