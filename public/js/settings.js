/* =====================================================
   MailNeo – Settings Modal
   ===================================================== */

const PRESETS = {
  gmail:   { imap_host: 'imap.gmail.com',       imap_port: 993, imap_secure: true,  smtp_host: 'smtp.gmail.com',       smtp_port: 587, smtp_secure: false },
  outlook: { imap_host: 'outlook.office365.com', imap_port: 993, imap_secure: true,  smtp_host: 'smtp.office365.com',   smtp_port: 587, smtp_secure: false },
  yahoo:   { imap_host: 'imap.mail.yahoo.com',  imap_port: 993, imap_secure: true,  smtp_host: 'smtp.mail.yahoo.com',  smtp_port: 587, smtp_secure: false },
  icloud:  { imap_host: 'imap.mail.me.com',     imap_port: 993, imap_secure: true,  smtp_host: 'smtp.mail.me.com',     smtp_port: 587, smtp_secure: false },
};

/* ──── Settings Modal ─────────────────────────────── */
function openSettings(tab = 'accounts') {
  document.getElementById('settings-overlay').style.display = 'flex';
  activateSettingsTab(tab);
}

function closeSettings() {
  document.getElementById('settings-overlay').style.display = 'none';
}

document.getElementById('settings-close').addEventListener('click', closeSettings);
document.getElementById('settings-overlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('settings-overlay')) closeSettings();
});

document.querySelectorAll('.stab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.stab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    activateSettingsTab(tab.dataset.stab);
  });
});

async function activateSettingsTab(tab) {
  document.querySelectorAll('.stab').forEach(t => t.classList.toggle('active', t.dataset.stab === tab));
  const content = document.getElementById('settings-content');
  content.innerHTML = '<div style="color:var(--text-3);font-size:13px">Loading…</div>';

  switch (tab) {
    case 'accounts':      await renderAccountsPanel(content); break;
    case 'labels':        await renderLabelsPanel(content); break;
    case 'cursor-rules':  await renderCursorRulesPanel(content); break;
    case 'ai-config':     await renderAIConfigPanel(content); break;
    case 'general':       await renderGeneralPanel(content); break;
    case 'notifications': await renderNotificationsPanel(content); break;
    case 'security':      await renderSecurityPanel(content); break;
  }
}

/* ──── Accounts Panel ────────────────────────────── */
async function renderAccountsPanel(el) {
  const accounts = await window.api('/api/accounts');
  el.innerHTML = `
    <div class="settings-panel">
      <h3>Email Accounts</h3>
      <p class="helper">Connect your IMAP/SMTP email accounts. Use app passwords for Gmail/Outlook.</p>
      <div id="accounts-list"></div>
      <button class="btn-small primary" id="btn-add-acc-settings" style="margin-top:8px">+ Add Account</button>
    </div>
  `;

  const list = el.querySelector('#accounts-list');
  for (const acc of (accounts || [])) {
    const card = document.createElement('div');
    card.className = 'account-card';
    card.innerHTML = `
      <div class="label-dot" style="background:${window.getLabelColor ? '#6366f1' : '#6366f1'}"></div>
      <div class="account-card-info">
        <div class="account-card-name">${window.escHtml(acc.label || acc.email)}</div>
        <div class="account-card-email">${window.escHtml(acc.email)} · Last sync: ${acc.last_synced ? window.formatDate(acc.last_synced) : 'never'}</div>
      </div>
      <div class="account-card-actions">
        <button class="btn-small" data-edit="${acc.id}">Edit</button>
        <button class="btn-small" data-sync="${acc.id}">Sync</button>
        <button class="btn-small danger" data-del="${acc.id}">Delete</button>
      </div>
    `;
    list.appendChild(card);
  }

  // Events
  el.querySelector('#btn-add-acc-settings').addEventListener('click', () => {
    closeSettings();
    window.openAccountModal();
  });
  list.addEventListener('click', async (e) => {
    const editId = e.target.dataset.edit;
    const delId = e.target.dataset.del;
    const syncId = e.target.dataset.sync;

    if (editId) {
      const acc = accounts.find(a => String(a.id) === editId);
      closeSettings();
      window.openAccountModal(acc);
    }
    if (delId) {
      if (!confirm('Delete this account and all its emails?')) return;
      await window.api(`/api/accounts/${delId}`, { method: 'DELETE' });
      window.toast('Account deleted', 'success');
      window.loadAccounts();
      activateSettingsTab('accounts');
    }
    if (syncId) {
      window.toast('Syncing…');
      const res = await window.api(`/api/accounts/${syncId}/sync`, { method: 'POST' });
      if (res?.ok) { window.toast(`Synced! ${res.newEmails} new`, 'success'); window.loadEmails(); }
      else window.toast(res?.error || 'Sync failed', 'error');
    }
  });
}

/* ──── Labels Panel ──────────────────────────────── */
async function renderLabelsPanel(el) {
  const labels = await window.api('/api/settings/labels');
  el.innerHTML = `
    <div class="settings-panel">
      <h3>Labels</h3>
      <p class="helper">Organize emails with color labels. AI can auto-assign these to emails.</p>
      <div id="labels-list"></div>
      <div class="add-form" id="label-add-form" style="margin-top:12px">
        <div class="add-form-row">
          <input type="text" id="new-label-name" placeholder="Label name">
          <input type="color" id="new-label-color" value="#6366f1" class="color-swatch" style="width:40px;padding:2px;border-radius:6px;background:var(--surface);border:1px solid var(--border);cursor:pointer">
          <button class="btn-small primary" id="btn-add-label">Add</button>
        </div>
      </div>
    </div>
  `;

  const list = el.querySelector('#labels-list');
  for (const label of (labels || [])) {
    const card = document.createElement('div');
    card.className = 'label-card';
    card.innerHTML = `
      <div class="label-dot" style="background:${label.color}"></div>
      <span class="label-card-name">${window.escHtml(label.name)}</span>
      ${label.is_system ? '<span style="font-size:10px;color:var(--text-3)">system</span>' : ''}
      <div class="label-card-actions">
        ${!label.is_system ? `<button class="btn-small danger" data-del="${label.id}">Delete</button>` : ''}
      </div>
    `;
    list.appendChild(card);
  }

  list.addEventListener('click', async (e) => {
    const delId = e.target.dataset.del;
    if (delId) {
      await window.api(`/api/settings/labels/${delId}`, { method: 'DELETE' });
      window.toast('Label deleted');
      window.loadLabels();
      activateSettingsTab('labels');
    }
  });

  el.querySelector('#btn-add-label').addEventListener('click', async () => {
    const name = el.querySelector('#new-label-name').value.trim();
    const color = el.querySelector('#new-label-color').value;
    if (!name) return;
    const res = await window.api('/api/settings/labels', { method: 'POST', body: { name, color } });
    if (res?.ok) {
      window.toast('Label added', 'success');
      window.loadLabels();
      activateSettingsTab('labels');
    } else {
      window.toast(res?.error || 'Failed', 'error');
    }
  });
}

/* ──── Cursor Rules Panel ────────────────────────── */
async function renderCursorRulesPanel(el) {
  const rules = await window.api('/api/ai/cursor-rules');
  el.innerHTML = `
    <div class="settings-panel">
      <h3>✦ Cursor Rules</h3>
      <p class="helper">Write plain English rules that tell your AI how to handle your inbox. Examples:<br>
      <em>"Mark anything from my boss as high priority"</em><br>
      <em>"Auto-archive newsletters after labeling"</em><br>
      <em>"Track emails where I said I'd respond"</em></p>
      <div id="rules-list"></div>
      <div class="add-form" style="margin-top:12px">
        <input type="text" id="rule-title" placeholder="Rule name (e.g. Boss Priority)">
        <textarea id="rule-text" placeholder="Describe the rule in plain English…"></textarea>
        <div class="add-form-row">
          <button class="btn-small primary" id="btn-add-rule">Add Rule</button>
        </div>
      </div>
    </div>
  `;

  const list = el.querySelector('#rules-list');
  for (const rule of (rules || [])) {
    const card = document.createElement('div');
    card.className = 'cursor-rule-card';
    card.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <div class="cursor-rule-title" style="flex:1">${window.escHtml(rule.title)}</div>
        <label class="toggle" title="${rule.is_active ? 'Active' : 'Inactive'}">
          <input type="checkbox" data-toggle="${rule.id}" ${rule.is_active ? 'checked' : ''}>
          <span class="toggle-track"></span>
        </label>
      </div>
      <div class="cursor-rule-text">${window.escHtml(rule.rule_text)}</div>
      <div class="cursor-rule-actions">
        <button class="btn-small danger" data-del="${rule.id}">Delete</button>
      </div>
    `;
    list.appendChild(card);
  }

  list.addEventListener('change', async (e) => {
    if (e.target.dataset.toggle) {
      await window.api(`/api/ai/cursor-rules/${e.target.dataset.toggle}`, {
        method: 'PUT',
        body: { is_active: e.target.checked ? 1 : 0 }
      });
    }
  });
  list.addEventListener('click', async (e) => {
    const delId = e.target.dataset.del;
    if (delId) {
      await window.api(`/api/ai/cursor-rules/${delId}`, { method: 'DELETE' });
      window.toast('Rule deleted');
      activateSettingsTab('cursor-rules');
    }
  });

  el.querySelector('#btn-add-rule').addEventListener('click', async () => {
    const title = el.querySelector('#rule-title').value.trim();
    const text = el.querySelector('#rule-text').value.trim();
    if (!title || !text) { window.toast('Title and rule text required', 'error'); return; }
    const res = await window.api('/api/ai/cursor-rules', { method: 'POST', body: { title, rule_text: text } });
    if (res?.ok) {
      window.toast('Rule added ✓', 'success');
      activateSettingsTab('cursor-rules');
    } else {
      window.toast(res?.error || 'Failed', 'error');
    }
  });
}

/* ──── AI Config Panel ───────────────────────────── */
async function renderAIConfigPanel(el) {
  const [status, settings] = await Promise.all([
    window.api('/api/ai/status'),
    window.api('/api/settings')
  ]);

  el.innerHTML = `
    <div class="settings-panel">
      <h3>AI Configuration</h3>
      <div class="ai-status-badge ${status?.available ? 'available' : 'unavailable'}">
        <span class="ai-status-dot"></span>
        ${status?.available ? 'AI Available (OpenAI connected)' : 'AI Unavailable (no API key)'}
      </div>
      <p class="helper">
        MailNeo uses OpenAI.<br><br>
        To enable AI features, set <code style="background:var(--surface2);padding:1px 5px;border-radius:4px;font-size:11px">OPENAI_API_KEY</code> in your <code style="background:var(--surface2);padding:1px 5px;border-radius:4px;font-size:11px">.env</code> file and restart the server.
      </p>

      <h3 style="margin-top:20px">Automation</h3>
      <p class="helper">These run automatically on the server when new mail arrives via IDLE push. Requires AI to be available.</p>

      <div style="display:flex;flex-direction:column;gap:14px">
        <div style="display:flex;align-items:flex-start;gap:12px">
          <label class="toggle" style="flex-shrink:0;margin-top:2px">
            <input type="checkbox" id="ai-auto-label" ${settings?.ai_auto_label ? 'checked' : ''}>
            <span class="toggle-track"></span>
          </label>
          <div>
            <div style="font-size:13.5px;font-weight:600">Auto-label on receive</div>
            <div style="font-size:12px;color:var(--text-3);margin-top:2px">Automatically classify each new email (Work, Personal, Newsletter, etc.)</div>
          </div>
        </div>

        <div style="display:flex;align-items:flex-start;gap:12px">
          <label class="toggle" style="flex-shrink:0;margin-top:2px">
            <input type="checkbox" id="ai-auto-summarize" ${settings?.ai_auto_summarize ? 'checked' : ''}>
            <span class="toggle-track"></span>
          </label>
          <div>
            <div style="font-size:13.5px;font-weight:600">Auto-summarize on receive</div>
            <div style="font-size:12px;color:var(--text-3);margin-top:2px">Generate a 1–2 sentence summary for each new email</div>
          </div>
        </div>
      </div>

      <button class="btn-small primary" id="btn-save-ai" style="margin-top:20px">Save Automation Settings</button>

      <h3 style="margin-top:24px">Available AI Features</h3>
      <div style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:16px;font-size:12.5px;color:var(--text-2);line-height:1.7">
        • <strong>AI Label</strong> – Auto-classify emails (Work / Personal / Finance / Newsletter etc.)<br>
        • <strong>AI Summary</strong> – 1–2 sentence email synopsis<br>
        • <strong>AI Compose</strong> – Draft emails from plain English instructions<br>
        • <strong>Mass AI Labeling</strong> – Label dozens of emails at once<br>
        • <strong>Cursor Rules</strong> – Plain English inbox automation rules<br>
        • <strong>Auto-label</strong> – Label new mail the moment it arrives<br>
        • <strong>Auto-summarize</strong> – Summarize new mail the moment it arrives
      </div>
    </div>
  `;

  el.querySelector('#btn-save-ai').addEventListener('click', async () => {
    const body = {
      ai_auto_label:     el.querySelector('#ai-auto-label').checked,
      ai_auto_summarize: el.querySelector('#ai-auto-summarize').checked,
    };
    const res = await window.api('/api/settings', { method: 'PUT', body });
    if (res?.ok) window.toast('AI settings saved ✓', 'success');
  });
}

/* ──── General Panel ─────────────────────────────── */
async function renderGeneralPanel(el) {
  const settings = await window.api('/api/settings');
  const pp       = settings?.per_page || 50;
  const syncInt  = settings?.sync_interval || 3;
  const accent   = settings?.accent_color || '';

  const ACCENTS = [
    { label: 'Indigo',  val: '#6366f1' },
    { label: 'Violet',  val: '#8b5cf6' },
    { label: 'Sky',     val: '#0ea5e9' },
    { label: 'Emerald', val: '#10b981' },
    { label: 'Rose',    val: '#f43f5e' },
  ];
  const accentSwatches = ACCENTS.map(a => `
    <button type="button" class="accent-swatch" data-color="${a.val}" title="${a.label}"
      style="background:${a.val};width:28px;height:28px;border-radius:50%;border:3px solid ${accent===a.val?'#fff':'transparent'};cursor:pointer;flex-shrink:0;transition:border-color .15s">
    </button>`).join('');

  const SIG_COLORS = [
    { l: 'Grey',       v: '#888888' },
    { l: 'Light grey', v: '#aaaaaa' },
    { l: 'Blue',       v: '#6366f1' },
    { l: 'Muted blue', v: '#94a3b8' },
    { l: 'Green',      v: '#10b981' },
  ];
  const sigColor = settings?.sig_color || '#888888';
  const sigColorSwatches = SIG_COLORS.map(c => `
    <button type="button" class="sig-swatch" data-color="${c.v}" title="${c.l}"
      style="background:${c.v};width:22px;height:22px;border-radius:50%;border:3px solid ${sigColor===c.v?'#fff':'transparent'};cursor:pointer;flex-shrink:0;transition:border-color .15s">
    </button>`).join('');

  const selStyle = (name, val) => `style="width:auto;padding:7px 11px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:inherit;font-size:13px;outline:none"`;

  el.innerHTML = `
    <div class="settings-panel">
      <h3>General</h3>

      <div class="form2-group">
        <label>Emails per page</label>
        <select id="s-per-page" ${selStyle()}>
          <option value="25" ${pp===25?'selected':''}>25</option>
          <option value="50" ${pp===50||!settings?.per_page?'selected':''}>50</option>
          <option value="100" ${pp===100?'selected':''}>100</option>
          <option value="200" ${pp===200?'selected':''}>200</option>
        </select>
      </div>

      <div class="form2-group" style="margin-top:12px">
        <label>Auto-sync interval</label>
        <select id="s-sync-interval" ${selStyle()}>
          <option value="1"  ${syncInt===1?'selected':''}>Every 1 minute</option>
          <option value="3"  ${syncInt===3||!settings?.sync_interval?'selected':''}>Every 3 minutes</option>
          <option value="5"  ${syncInt===5?'selected':''}>Every 5 minutes</option>
          <option value="10" ${syncInt===10?'selected':''}>Every 10 minutes</option>
          <option value="15" ${syncInt===15?'selected':''}>Every 15 minutes</option>
        </select>
      </div>

      <div class="form2-check" style="margin-top:16px">
        <label><input type="checkbox" id="s-mark-on-open" ${settings?.mark_read_on_open!==false?'checked':''}> Mark emails as read when opening</label>
      </div>
      <div class="form2-check" style="margin-top:8px">
        <label><input type="checkbox" id="s-show-preview" ${settings?.show_preview!==false?'checked':''}> Show preview text in email list</label>
      </div>
      <div class="form2-check" style="margin-top:8px">
        <label><input type="checkbox" id="s-compact-mode" ${settings?.compact_mode?'checked':''}> Compact email list (reduced row height)</label>
      </div>

      <div class="form2-group" style="margin-top:20px">
        <label>Accent colour</label>
        <div style="display:flex;gap:10px;align-items:center;margin-top:8px" id="accent-swatches">
          ${accentSwatches}
        </div>
      </div>

      <h3 style="margin-top:28px">Signature</h3>

      <div class="form2-group">
        <label>Signature text</label>
        <textarea id="s-signature" rows="4"
          style="width:100%;padding:10px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:inherit;font-size:13px;resize:vertical;box-sizing:border-box;margin-top:6px"
          placeholder="Your name&#10;your@email.com">${window.escHtml(settings?.signature||'')}</textarea>
        <div style="font-size:11.5px;color:var(--text-3);margin-top:4px">Appended to new emails and replies. Toggle per-draft with the Sig button in compose.</div>
      </div>

      <div class="form2-group" style="margin-top:12px">
        <label>Style</label>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">
          <select id="s-sig-style" ${selStyle()}>
            <option value="normal" ${settings?.sig_style!=='italic'?'selected':''}>Normal</option>
            <option value="italic" ${settings?.sig_style==='italic'?'selected':''}>Italic</option>
          </select>
          <select id="s-sig-size" ${selStyle()}>
            <option value="small"  ${settings?.sig_size==='small'?'selected':''}>Small</option>
            <option value="normal" ${!settings?.sig_size||settings?.sig_size==='normal'?'selected':''}>Normal</option>
            <option value="large"  ${settings?.sig_size==='large'?'selected':''}>Large</option>
          </select>
          <select id="s-sig-sep" ${selStyle()}>
            <option value="dashes" ${!settings?.sig_separator||settings?.sig_separator==='dashes'?'selected':''}>-- separator</option>
            <option value="hr"     ${settings?.sig_separator==='hr'?'selected':''}>Line separator</option>
            <option value="none"   ${settings?.sig_separator==='none'?'selected':''}>No separator</option>
          </select>
        </div>
      </div>

      <div class="form2-group" style="margin-top:10px">
        <label>Signature colour</label>
        <div style="display:flex;gap:8px;align-items:center;margin-top:8px" id="sig-color-swatches">
          ${sigColorSwatches}
        </div>
      </div>

      <div id="sig-preview" style="margin-top:10px;padding:12px 14px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;font-size:13px;color:var(--text-2)"></div>

      <button class="btn-small primary" id="btn-save-general" style="margin-top:20px">Save Settings</button>
    </div>
  `;

  // Accent swatch interaction
  let selectedAccent = accent;
  el.querySelector('#accent-swatches').addEventListener('click', (e) => {
    const btn = e.target.closest('.accent-swatch');
    if (!btn) return;
    selectedAccent = btn.dataset.color;
    el.querySelectorAll('.accent-swatch').forEach(s => {
      s.style.borderColor = s.dataset.color === selectedAccent ? '#fff' : 'transparent';
    });
    document.documentElement.style.setProperty('--accent', selectedAccent);
  });

  // Sig colour swatch interaction
  let selectedSigColor = sigColor;
  el.querySelector('#sig-color-swatches').addEventListener('click', (e) => {
    const btn = e.target.closest('.sig-swatch');
    if (!btn) return;
    selectedSigColor = btn.dataset.color;
    el.querySelectorAll('.sig-swatch').forEach(s => {
      s.style.borderColor = s.dataset.color === selectedSigColor ? '#fff' : 'transparent';
    });
    updateSigPreview();
  });

  function updateSigPreview() {
    const text = el.querySelector('#s-signature').value.trim();
    if (!text) { el.querySelector('#sig-preview').style.display = 'none'; return; }
    el.querySelector('#sig-preview').style.display = '';
    const italic = el.querySelector('#s-sig-style').value === 'italic' ? 'font-style:italic;' : '';
    const sizes = { small: '11px', large: '15px' };
    const size = sizes[el.querySelector('#s-sig-size').value] || '13px';
    const color = selectedSigColor;
    const sep = el.querySelector('#s-sig-sep').value;
    const safe = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
    let sepHtml = sep === 'hr'
      ? '<hr style="border:none;border-top:1px solid #d0d0da;margin:6px 0">'
      : sep !== 'none' ? '<span style="color:#bbb">-- </span><br>' : '';
    el.querySelector('#sig-preview').innerHTML =
      `<div style="${italic}font-size:${size};color:${color};white-space:pre-wrap">${sepHtml}${safe}</div>`;
  }

  ['#s-signature','#s-sig-style','#s-sig-size','#s-sig-sep'].forEach(id => {
    el.querySelector(id).addEventListener('input', updateSigPreview);
    el.querySelector(id).addEventListener('change', updateSigPreview);
  });
  updateSigPreview();

  el.querySelector('#btn-save-general').addEventListener('click', async () => {
    const compactMode = el.querySelector('#s-compact-mode').checked;
    const body = {
      mark_read_on_open: el.querySelector('#s-mark-on-open').checked,
      show_preview:      el.querySelector('#s-show-preview').checked,
      per_page:          Number(el.querySelector('#s-per-page').value),
      sync_interval:     Number(el.querySelector('#s-sync-interval').value),
      compact_mode:      compactMode,
      signature:         el.querySelector('#s-signature').value.trim(),
      sig_style:         el.querySelector('#s-sig-style').value,
      sig_size:          el.querySelector('#s-sig-size').value,
      sig_separator:     el.querySelector('#s-sig-sep').value,
      sig_color:         selectedSigColor,
      ...(selectedAccent && { accent_color: selectedAccent }),
    };
    const res = await window.api('/api/settings', { method: 'PUT', body });
    if (res?.ok) {
      document.body.classList.toggle('compact', compactMode);
      if (window.State) Object.assign(window.State.settings, body);
      window.toast('Settings saved ✓', 'success');
    }
  });
}

/* ──── Notifications Panel ───────────────────────── */
async function renderNotificationsPanel(el) {
  const perm = ('Notification' in window) ? Notification.permission : 'unsupported';
  const permLabel = { granted: 'Granted ✓', denied: 'Blocked ✗', default: 'Not yet asked', unsupported: 'Not supported' };
  const permColor = { granted: 'var(--green)', denied: 'var(--red)', default: 'var(--amber)', unsupported: 'var(--text-3)' };

  const settings = await window.api('/api/settings');
  const aiOk = window.State?.aiAvailable;

  el.innerHTML = `
    <div class="settings-panel">
      <h3>Notifications</h3>

      <div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:16px 18px;margin-bottom:16px">
        <div style="font-size:13px;color:var(--text-2);margin-bottom:6px">Browser notification permission</div>
        <div style="font-size:15px;font-weight:600;color:${permColor[perm]}">${permLabel[perm]}</div>
        ${perm==='default' ? `<button class="btn-small primary" id="btn-grant-notif" style="margin-top:12px">Grant permission</button>` : ''}
        ${perm==='denied' ? `<div style="font-size:12px;color:var(--text-3);margin-top:8px">Notifications are blocked. Open your browser site settings to re-enable them.</div>` : ''}
        ${perm==='granted' ? `<div style="font-size:12.5px;color:var(--text-2);margin-top:8px">Desktop notifications are active for new emails.</div>` : ''}
      </div>

      <h3 style="margin-top:4px">Notification Filtering</h3>

      <div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:16px 18px;margin-bottom:16px">
        <div style="display:flex;align-items:flex-start;gap:12px">
          <label class="toggle" style="flex-shrink:0;margin-top:2px">
            <input type="checkbox" id="notif-ai-filter" ${settings?.notif_ai_filter?'checked':''}
              ${!aiOk?'disabled':''}>
            <span class="toggle-track"></span>
          </label>
          <div>
            <div style="font-size:13.5px;font-weight:600">AI importance filter</div>
            <div style="font-size:12px;color:var(--text-3);margin-top:3px;line-height:1.6">
              Use AI to decide if a notification is worth showing. Newsletters, marketing, automated alerts, and spam are silently skipped. Only messages likely to need your attention trigger a notification.
            </div>
            ${!aiOk ? `<div style="font-size:11.5px;color:var(--amber);margin-top:6px">⚠ Requires OpenAI API key to be configured</div>` : ''}
          </div>
        </div>

        <button class="btn-small primary" id="btn-save-notif" style="margin-top:16px">Save</button>
      </div>

      <div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:16px 18px">
        <div style="font-size:13.5px;font-weight:600;margin-bottom:8px">How notifications work</div>
        <ul style="font-size:12.5px;color:var(--text-2);line-height:1.8;margin:0;padding-left:18px">
          <li>New mail is detected via IMAP IDLE (real-time) or the auto-sync interval</li>
          <li>Notifications show the sender and subject line</li>
          <li>Service Worker handles notifications even if the tab is in the background</li>
          <li>AI filter (above) runs on the server before the notification is sent</li>
        </ul>
      </div>
    </div>
  `;

  const grantBtn = el.querySelector('#btn-grant-notif');
  if (grantBtn) {
    grantBtn.addEventListener('click', async () => {
      const result = await Notification.requestPermission();
      grantBtn.textContent = result === 'granted' ? 'Granted ✓' : 'Denied ✗';
      grantBtn.disabled = true;
      await renderNotificationsPanel(el);
    });
  }

  el.querySelector('#btn-save-notif').addEventListener('click', async () => {
    const body = { notif_ai_filter: el.querySelector('#notif-ai-filter').checked };
    const res = await window.api('/api/settings', { method: 'PUT', body });
    if (res?.ok) {
      if (window.State) Object.assign(window.State.settings, body);
      window.toast('Notification settings saved ✓', 'success');
    }
  });
}

/* ──── Account Modal ─────────────────────────────── */
function openAccountModal(account = null) {
  const modal = document.getElementById('account-modal-overlay');
  const form = document.getElementById('account-form');
  const title = document.getElementById('account-modal-title');
  const alert = document.getElementById('account-form-alert');

  title.textContent = account ? 'Edit Account' : 'Add Email Account';
  alert.style.display = 'none';

  if (account) {
    document.getElementById('account-id-field').value = account.id;
    document.getElementById('acc-label').value = account.label || '';
    document.getElementById('acc-email').value = account.email;
    document.getElementById('acc-password').value = '';
    document.getElementById('acc-imap-host').value = account.imap_host;
    document.getElementById('acc-imap-port').value = account.imap_port;
    document.getElementById('acc-imap-secure').checked = account.imap_secure === 1;
    document.getElementById('acc-smtp-host').value = account.smtp_host;
    document.getElementById('acc-smtp-port').value = account.smtp_port;
    document.getElementById('acc-smtp-secure').checked = account.smtp_secure === 1;
    document.getElementById('acc-default').checked = account.is_default === 1;
  } else {
    form.reset();
    document.getElementById('acc-imap-port').value = 993;
    document.getElementById('acc-smtp-port').value = 587;
    document.getElementById('acc-imap-secure').checked = true;
  }

  modal.style.display = 'flex';
}

document.getElementById('account-modal-close').addEventListener('click', closeAccountModal);
document.getElementById('account-modal-overlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('account-modal-overlay')) closeAccountModal();
});

function closeAccountModal() {
  document.getElementById('account-modal-overlay').style.display = 'none';
}

// Presets
document.querySelectorAll('.preset-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const p = PRESETS[btn.dataset.preset];
    if (!p) return;
    document.getElementById('acc-imap-host').value = p.imap_host;
    document.getElementById('acc-imap-port').value = p.imap_port;
    document.getElementById('acc-imap-secure').checked = p.imap_secure;
    document.getElementById('acc-smtp-host').value = p.smtp_host;
    document.getElementById('acc-smtp-port').value = p.smtp_port;
    document.getElementById('acc-smtp-secure').checked = p.smtp_secure;
  });
});

// Verify SMTP
document.getElementById('btn-verify-account').addEventListener('click', async () => {
  const id = document.getElementById('account-id-field').value;
  if (!id) { showFormAlert('Save account first to verify', 'error'); return; }
  const btn = document.getElementById('btn-verify-account');
  btn.textContent = 'Verifying…';
  const res = await window.api(`/api/accounts/${id}/verify`, { method: 'POST' });
  btn.textContent = 'Verify SMTP';
  if (res?.ok) showFormAlert('SMTP connection verified ✓', 'success');
  else showFormAlert(res?.error || 'Verification failed', 'error');
});

// Submit account form
document.getElementById('account-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('account-id-field').value;
  const body = {
    label: document.getElementById('acc-label').value,
    email: document.getElementById('acc-email').value,
    password: document.getElementById('acc-password').value || undefined,
    imap_host: document.getElementById('acc-imap-host').value,
    imap_port: Number(document.getElementById('acc-imap-port').value),
    imap_secure: document.getElementById('acc-imap-secure').checked,
    smtp_host: document.getElementById('acc-smtp-host').value,
    smtp_port: Number(document.getElementById('acc-smtp-port').value),
    smtp_secure: document.getElementById('acc-smtp-secure').checked,
    is_default: document.getElementById('acc-default').checked,
  };

  const method = id ? 'PUT' : 'POST';
  const path = id ? `/api/accounts/${id}` : '/api/accounts';
  const res = await window.api(path, { method, body });

  if (res?.ok || res?.account) {
    window.toast(`Account ${id ? 'updated' : 'added'} ✓`, 'success');
    closeAccountModal();
    await window.loadAccounts();
    if (!id) {
      window.toast('Initial sync started…');
      window.loadEmails();
    }
  } else {
    showFormAlert(res?.error || 'Failed to save account', 'error');
  }
});

function showFormAlert(msg, type) {
  const el = document.getElementById('account-form-alert');
  el.textContent = msg;
  el.className = `form-alert ${type}`;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 5000);
}

async function renderSecurityPanel(el) {
  el.innerHTML = `
    <div class="settings-panel">
      <h3>Security</h3>
      <p class="helper">Change the password you use to log in to MailNeo.</p>
      <div id="pw-alert" class="form-alert" style="display:none"></div>
      <form id="change-pw-form" autocomplete="off" style="max-width:340px">
        <div class="form2-group">
          <label>Current Password</label>
          <input id="pw-current" type="password" placeholder="Current password" autocomplete="current-password" required>
        </div>
        <div class="form2-group">
          <label>New Password</label>
          <input id="pw-new" type="password" placeholder="New password (min 8 chars)" autocomplete="new-password" minlength="8" required>
        </div>
        <div class="form2-group">
          <label>Confirm New Password</label>
          <input id="pw-confirm" type="password" placeholder="Confirm new password" autocomplete="new-password" minlength="8" required>
        </div>
        <button type="submit" class="btn-small primary" style="margin-top:4px">Update Password</button>
      </form>
    </div>
  `;

  el.querySelector('#change-pw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const alert = document.getElementById('pw-alert');
    const current  = document.getElementById('pw-current').value;
    const newPw    = document.getElementById('pw-new').value;
    const confirm  = document.getElementById('pw-confirm').value;

    if (newPw !== confirm) {
      alert.textContent = 'New passwords do not match.';
      alert.className = 'form-alert error';
      alert.style.display = 'block';
      return;
    }

    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Updating…';

    const res = await window.api('/api/auth/change-password', {
      method: 'POST',
      body: { current_password: current, new_password: newPw }
    });

    btn.disabled = false;
    btn.textContent = 'Update Password';

    if (res?.ok) {
      alert.textContent = 'Password updated successfully.';
      alert.className = 'form-alert success';
      alert.style.display = 'block';
      e.target.reset();
    } else {
      alert.textContent = res?.error || 'Failed to update password.';
      alert.className = 'form-alert error';
      alert.style.display = 'block';
    }
  });
}

window.openSettings = openSettings;
window.openAccountModal = openAccountModal;
