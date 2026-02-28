/* =====================================================
   MailNeo – Settings Modal
   ===================================================== */

const PRESETS = {
  gmail: { imap_host: 'imap.gmail.com', imap_port: 993, imap_secure: true, smtp_host: 'smtp.gmail.com', smtp_port: 587, smtp_secure: false },
  outlook: { imap_host: 'outlook.office365.com', imap_port: 993, imap_secure: true, smtp_host: 'smtp.office365.com', smtp_port: 587, smtp_secure: false },
  yahoo: { imap_host: 'imap.mail.yahoo.com', imap_port: 993, imap_secure: true, smtp_host: 'smtp.mail.yahoo.com', smtp_port: 587, smtp_secure: false },
  icloud: { imap_host: 'imap.mail.me.com', imap_port: 993, imap_secure: true, smtp_host: 'smtp.mail.me.com', smtp_port: 587, smtp_secure: false },
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
    case 'accounts': await renderAccountsPanel(content); break;
    case 'labels': await renderLabelsPanel(content); break;
    case 'cursor-rules': await renderCursorRulesPanel(content); break;
    case 'ai-config': await renderAIConfigPanel(content); break;
    case 'general': await renderGeneralPanel(content); break;
    case 'notifications': await renderNotificationsPanel(content); break;
    case 'security': await renderSecurityPanel(content); break;
    case 'mcp': await renderMCPPanel(content); break;
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

        <div style="display:flex;align-items:flex-start;gap:12px">
          <label class="toggle" style="flex-shrink:0;margin-top:2px">
            <input type="checkbox" id="ai-auto-awaiting" ${settings?.ai_auto_awaiting ? 'checked' : ''}>
            <span class="toggle-track"></span>
          </label>
          <div>
            <div style="font-size:13.5px;font-weight:600">Auto-detect awaiting reply</div>
            <div style="font-size:12px;color:var(--text-3);margin-top:2px">Automatically flag emails where the sender expects a reply from you</div>
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
        • <strong>Auto-summarize</strong> – Summarize new mail the moment it arrives<br>
        • <strong>Auto-awaiting</strong> – Flag emails expecting a reply when they arrive
      </div>
    </div>
  `;

  el.querySelector('#btn-save-ai').addEventListener('click', async () => {
    const body = {
      ai_auto_label: el.querySelector('#ai-auto-label').checked,
      ai_auto_summarize: el.querySelector('#ai-auto-summarize').checked,
      ai_auto_awaiting: el.querySelector('#ai-auto-awaiting').checked,
    };
    const res = await window.api('/api/settings', { method: 'PUT', body });
    if (res?.ok) window.toast('AI settings saved ✓', 'success');
  });
}

/* ──── General Panel ─────────────────────────────── */
async function renderGeneralPanel(el) {
  const settings = await window.api('/api/settings');
  const pp = settings?.per_page || 50;
  const syncInt = settings?.sync_interval || 3;
  const accent = settings?.accent_color || '';

  const ACCENTS = [
    { label: 'Indigo', val: '#6366f1' },
    { label: 'Violet', val: '#8b5cf6' },
    { label: 'Sky', val: '#0ea5e9' },
    { label: 'Emerald', val: '#10b981' },
    { label: 'Rose', val: '#f43f5e' },
  ];
  const accentSwatches = ACCENTS.map(a => `
    <button type="button" class="accent-swatch" data-color="${a.val}" title="${a.label}"
      style="background:${a.val};width:28px;height:28px;border-radius:50%;border:3px solid ${accent === a.val ? '#fff' : 'transparent'};cursor:pointer;flex-shrink:0;transition:border-color .15s">
    </button>`).join('');

  const SIG_COLORS = [
    { l: 'Grey', v: '#888888' },
    { l: 'Light grey', v: '#aaaaaa' },
    { l: 'Blue', v: '#6366f1' },
    { l: 'Muted blue', v: '#94a3b8' },
    { l: 'Green', v: '#10b981' },
  ];
  const sigColor = settings?.sig_color || '#888888';
  const sigColorSwatches = SIG_COLORS.map(c => `
    <button type="button" class="sig-swatch" data-color="${c.v}" title="${c.l}"
      style="background:${c.v};width:22px;height:22px;border-radius:50%;border:3px solid ${sigColor === c.v ? '#fff' : 'transparent'};cursor:pointer;flex-shrink:0;transition:border-color .15s">
    </button>`).join('');

  const selStyle = (name, val) => `style="width:auto;padding:7px 11px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:inherit;font-size:13px;outline:none"`;

  el.innerHTML = `
    <div class="settings-panel">
      <h3>General</h3>

      <div class="form2-group">
        <label>Emails per page</label>
        <select id="s-per-page" ${selStyle()}>
          <option value="25" ${pp === 25 ? 'selected' : ''}>25</option>
          <option value="50" ${pp === 50 || !settings?.per_page ? 'selected' : ''}>50</option>
          <option value="100" ${pp === 100 ? 'selected' : ''}>100</option>
          <option value="200" ${pp === 200 ? 'selected' : ''}>200</option>
        </select>
      </div>

      <div class="form2-group" style="margin-top:12px">
        <label>Auto-sync interval</label>
        <select id="s-sync-interval" ${selStyle()}>
          <option value="1"  ${syncInt === 1 ? 'selected' : ''}>Every 1 minute</option>
          <option value="3"  ${syncInt === 3 || !settings?.sync_interval ? 'selected' : ''}>Every 3 minutes</option>
          <option value="5"  ${syncInt === 5 ? 'selected' : ''}>Every 5 minutes</option>
          <option value="10" ${syncInt === 10 ? 'selected' : ''}>Every 10 minutes</option>
          <option value="15" ${syncInt === 15 ? 'selected' : ''}>Every 15 minutes</option>
        </select>
      </div>

      <div class="form2-check" style="margin-top:16px">
        <label><input type="checkbox" id="s-mark-on-open" ${settings?.mark_read_on_open !== false ? 'checked' : ''}> Mark emails as read when opening</label>
      </div>
      <div class="form2-check" style="margin-top:8px">
        <label><input type="checkbox" id="s-show-preview" ${settings?.show_preview !== false ? 'checked' : ''}> Show preview text in email list</label>
      </div>
      <div class="form2-check" style="margin-top:8px">
        <label><input type="checkbox" id="s-compact-mode" ${settings?.compact_mode ? 'checked' : ''}> Compact email list (reduced row height)</label>
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
          placeholder="Your name&#10;your@email.com">${window.escHtml(settings?.signature || '')}</textarea>
        <div style="font-size:11.5px;color:var(--text-3);margin-top:4px">Appended to new emails and replies. Toggle per-draft with the Sig button in compose.</div>
      </div>

      <div class="form2-group" style="margin-top:12px">
        <label>Style</label>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">
          <select id="s-sig-style" ${selStyle()}>
            <option value="normal" ${settings?.sig_style !== 'italic' ? 'selected' : ''}>Normal</option>
            <option value="italic" ${settings?.sig_style === 'italic' ? 'selected' : ''}>Italic</option>
          </select>
          <select id="s-sig-size" ${selStyle()}>
            <option value="small"  ${settings?.sig_size === 'small' ? 'selected' : ''}>Small</option>
            <option value="normal" ${!settings?.sig_size || settings?.sig_size === 'normal' ? 'selected' : ''}>Normal</option>
            <option value="large"  ${settings?.sig_size === 'large' ? 'selected' : ''}>Large</option>
          </select>
          <select id="s-sig-sep" ${selStyle()}>
            <option value="dashes" ${!settings?.sig_separator || settings?.sig_separator === 'dashes' ? 'selected' : ''}>-- separator</option>
            <option value="hr"     ${settings?.sig_separator === 'hr' ? 'selected' : ''}>Line separator</option>
            <option value="none"   ${settings?.sig_separator === 'none' ? 'selected' : ''}>No separator</option>
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

      <h3 style="margin-top:32px">Bulk Actions</h3>
      <div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:16px 18px">
        <div style="font-size:13.5px;font-weight:600;margin-bottom:6px">Archive all emails</div>
        <div style="font-size:12px;color:var(--text-3);margin-bottom:14px;line-height:1.6">
          Move every non-archived, non-trash email to the Archive. This cannot be undone in bulk.
        </div>
        <button class="btn-small danger" id="btn-archive-all">Archive All Emails</button>
        <span id="archive-all-status" style="font-size:12px;color:var(--text-3);margin-left:12px;display:none"></span>
      </div>
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
    const safe = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
    let sepHtml = sep === 'hr'
      ? '<hr style="border:none;border-top:1px solid #d0d0da;margin:6px 0">'
      : sep !== 'none' ? '<span style="color:#bbb">-- </span><br>' : '';
    el.querySelector('#sig-preview').innerHTML =
      `<div style="${italic}font-size:${size};color:${color};white-space:pre-wrap">${sepHtml}${safe}</div>`;
  }

  ['#s-signature', '#s-sig-style', '#s-sig-size', '#s-sig-sep'].forEach(id => {
    el.querySelector(id).addEventListener('input', updateSigPreview);
    el.querySelector(id).addEventListener('change', updateSigPreview);
  });
  updateSigPreview();

  el.querySelector('#btn-save-general').addEventListener('click', async () => {
    const compactMode = el.querySelector('#s-compact-mode').checked;
    const body = {
      mark_read_on_open: el.querySelector('#s-mark-on-open').checked,
      show_preview: el.querySelector('#s-show-preview').checked,
      per_page: Number(el.querySelector('#s-per-page').value),
      sync_interval: Number(el.querySelector('#s-sync-interval').value),
      compact_mode: compactMode,
      signature: el.querySelector('#s-signature').value.trim(),
      sig_style: el.querySelector('#s-sig-style').value,
      sig_size: el.querySelector('#s-sig-size').value,
      sig_separator: el.querySelector('#s-sig-sep').value,
      sig_color: selectedSigColor,
      ...(selectedAccent && { accent_color: selectedAccent }),
    };
    const res = await window.api('/api/settings', { method: 'PUT', body });
    if (res?.ok) {
      document.body.classList.toggle('compact', compactMode);
      if (window.State) Object.assign(window.State.settings, body);
      window.toast('Settings saved ✓', 'success');
    }
  });

  el.querySelector('#btn-archive-all').addEventListener('click', async () => {
    const confirmed = window.confirm(
      'Archive ALL emails in your inbox?\n\nThis will mark every non-archived, non-trash email as archived. Are you sure?'
    );
    if (!confirmed) return;
    const btn = el.querySelector('#btn-archive-all');
    const status = el.querySelector('#archive-all-status');
    btn.disabled = true;
    btn.textContent = 'Archiving…';
    status.style.display = 'none';
    const res = await window.api('/api/emails/archive-all', { method: 'POST', body: {} });
    btn.disabled = false;
    btn.textContent = 'Archive All Emails';
    if (res?.ok) {
      status.textContent = `Done — ${res.affected} email${res.affected === 1 ? '' : 's'} archived.`;
      status.style.display = 'inline';
      window.toast(`Archived ${res.affected} email${res.affected === 1 ? '' : 's'} ✓`, 'success');
      if (window.loadEmails) window.loadEmails();
      if (window.updateStats) window.updateStats();
    } else {
      status.textContent = 'Failed to archive emails.';
      status.style.display = 'inline';
      window.toast('Archive all failed', 'error');
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
        ${perm === 'default' ? `<button class="btn-small primary" id="btn-grant-notif" style="margin-top:12px">Grant permission</button>` : ''}
        ${perm === 'denied' ? `<div style="font-size:12px;color:var(--text-3);margin-top:8px">Notifications are blocked. Open your browser site settings to re-enable them.</div>` : ''}
        ${perm === 'granted' ? `<div style="font-size:12.5px;color:var(--text-2);margin-top:8px">Desktop notifications are active for new emails.</div>` : ''}
      </div>

      <h3 style="margin-top:4px">Notification Filtering</h3>

      <div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:16px 18px;margin-bottom:16px">
        <div style="display:flex;align-items:flex-start;gap:12px">
          <label class="toggle" style="flex-shrink:0;margin-top:2px">
            <input type="checkbox" id="notif-ai-filter" ${settings?.notif_ai_filter ? 'checked' : ''}
              ${!aiOk ? 'disabled' : ''}>
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
  const user = await window.api('/api/auth/me');

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

      <h3 style="margin-top:32px">Two-Factor Authentication</h3>
      <p class="helper">Secure your account with an authenticator app.</p>
      <div id="2fa-alert" class="form-alert" style="display:none"></div>
      
      ${user?.totp_enabled
      ? `<div style="margin-bottom:1rem;color:#22c55e;font-weight:600;font-size:13px">✓ 2FA is currently enabled</div>
           <form id="disable-2fa-form" style="max-width:340px">
             <div class="form2-group"><label>Current Password</label><input type="password" id="disable-2fa-pass" required></div>
             <div class="form2-group"><label>2FA Code</label><input type="text" id="disable-2fa-code" required minlength="6" maxlength="6"></div>
             <button type="submit" class="btn-small danger" style="margin-top:4px">Disable 2FA</button>
           </form>`
      : `<button class="btn-small primary" id="btn-setup-2fa">Set Up 2FA</button>
           <div id="setup-2fa-container" style="display:none;margin-top:16px"></div>`
    }
    </div>
  `;

  el.querySelector('#change-pw-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const alert = document.getElementById('pw-alert');
    const current = document.getElementById('pw-current').value;
    const newPw = document.getElementById('pw-new').value;
    const confirm = document.getElementById('pw-confirm').value;

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

  el.querySelector('#btn-setup-2fa')?.addEventListener('click', async () => {
    const container = document.getElementById('setup-2fa-container');
    container.style.display = 'block';
    container.innerHTML = 'Loading...';

    const res = await window.api('/api/auth/2fa/generate');
    if (res?.qrcode) {
      container.innerHTML = `
        <div style="background:var(--surface2);padding:16px;border-radius:8px;border:1px solid var(--border)">
          <p style="font-size:13px;margin-bottom:12px">Scan the QR code with your authenticator app.</p>
          <img src="${res.qrcode}" alt="2FA QR Code" style="width:200px;height:200px;background:#fff;padding:8px;border-radius:4px">
          <p style="font-size:12px;color:var(--text-3);margin-top:12px">Or enter manually: <strong>${res.secret}</strong></p>
          <form id="verify-2fa-form" style="margin-top:16px;max-width:340px">
            <div class="form2-group">
              <label>Enter 6-digit Code</label>
              <input type="text" id="verify-2fa-code" required minlength="6" maxlength="6">
            </div>
            <button type="submit" class="btn-small primary" style="margin-top:4px">Verify and Enable</button>
          </form>
        </div>
      `;

      document.getElementById('verify-2fa-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const code = document.getElementById('verify-2fa-code').value;
        const alert = document.getElementById('2fa-alert');

        try {
          const vRes = await window.api('/api/auth/2fa/verify', { method: 'POST', body: { token: code } });
          if (vRes?.ok) {
            window.toast('2FA Enabled successfully', 'success');
            renderSecurityPanel(el);
          } else {
            alert.textContent = vRes?.error || 'Invalid 2FA code';
            alert.className = 'form-alert error';
            alert.style.display = 'block';
          }
        } catch (err) { }
      });
    }
  });

  el.querySelector('#disable-2fa-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const alert = document.getElementById('2fa-alert');
    const pass = document.getElementById('disable-2fa-pass').value;
    const code = document.getElementById('disable-2fa-code').value;

    const res = await window.api('/api/auth/2fa/disable', {
      method: 'POST', body: { password: pass, token: code }
    });

    if (res?.ok) {
      window.toast('2FA Disabled successfully', 'success');
      renderSecurityPanel(el);
    } else {
      alert.textContent = res?.error || 'Failed to disable 2FA';
      alert.className = 'form-alert error';
      alert.style.display = 'block';
    }
  });
}

/* ──── MCP / API Tokens Panel ────────────────────── */
async function renderMCPPanel(el) {
  const [tokens, oauthClients] = await Promise.all([
    window.api('/oauth/pats'),
    window.api('/oauth/clients'),
  ]);
  const base = location.origin;

  // PATs are tokens with no client_id (manually created)
  const pats = (tokens || []).filter(t => !t.client_id);
  const oauthTokens = (tokens || []).filter(t => t.client_id);

  el.innerHTML = `
        < div class="settings-panel" >
      <h3>MCP Server &amp; OAuth</h3>
      <p class="helper">
        The built-in MCP server lets AI assistants (Claude, Cursor, etc.) access your email
        over the <strong>Model Context Protocol</strong> using OAuth 2.0 or Personal Access Tokens.
      </p>

      <!--Endpoint info-- >
      <div style="background:rgba(99,102,241,.08);border:1px solid rgba(99,102,241,.25);border-radius:10px;padding:12px 14px;margin-bottom:22px;font-size:13px;line-height:1.9">
        <div><strong>MCP Endpoint:</strong>&nbsp;
          <code style="background:rgba(0,0,0,.25);padding:2px 7px;border-radius:5px;user-select:all">${window.escHtml(base + '/mcp')}</code>
        </div>
        <div><strong>OAuth Metadata:</strong>&nbsp;
          <code style="background:rgba(0,0,0,.25);padding:2px 7px;border-radius:5px;user-select:all">${window.escHtml(base + '/.well-known/oauth-authorization-server')}</code>
        </div>
        <div><strong>MCP Discovery:</strong>&nbsp;
          <code style="background:rgba(0,0,0,.25);padding:2px 7px;border-radius:5px;user-select:all">${window.escHtml(base + '/.well-known/mcp')}</code>
        </div>
      </div>

      <!--OAuth Applications-- >
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <h4 style="margin:0">OAuth Applications</h4>
        <span style="background:rgba(99,102,241,.18);color:#a5b4fc;border-radius:20px;padding:1px 9px;font-size:11px;font-weight:600">OAuth 2.0</span>
      </div>
      <p class="helper" style="margin-top:-4px;margin-bottom:12px">
        Apps that have been granted access via the OAuth authorization flow (e.g. Claude Desktop using <code>mcp-remote</code> with auto-auth).
        Revoking removes all tokens for that app.
      </p>
      <div id="mcp-oauth-app-list" style="margin-bottom:22px"></div>

      <!--Personal Access Tokens-- >
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <h4 style="margin:0">Personal Access Tokens</h4>
        <span style="background:rgba(34,197,94,.12);color:#22c55e;border-radius:20px;padding:1px 9px;font-size:11px;font-weight:600">PAT</span>
      </div>
      <p class="helper" style="margin-top:-4px;margin-bottom:12px">
        Manually created tokens. Use these for scripts, direct integrations, or tools that don't support OAuth.
      </p>
      <div id="mcp-token-list" style="margin-bottom:16px"></div>

      <!--Create new PAT-- >
      <div style="border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:14px;background:rgba(255,255,255,.02)">
        <div style="font-weight:600;margin-bottom:10px;font-size:14px">Create new token</div>
        <div class="form2-group">
          <label>Token name</label>
          <input type="text" id="mcp-tok-name" placeholder="e.g. My Script" maxlength="100">
        </div>
        <div class="form2-group">
          <label>Permissions</label>
          <select id="mcp-tok-scope">
            <option value="email:read">Read only  (list, search, view emails)</option>
            <option value="email:write">Write only  (send, star, trash, mark)</option>
            <option value="email:read email:write">Read + Write  (full access)</option>
          </select>
        </div>
        <div class="form2-group">
          <label>Expires</label>
          <select id="mcp-tok-expire">
            <option value="">Never</option>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="180">180 days</option>
            <option value="365">1 year</option>
          </select>
        </div>
        <button class="btn-small primary" id="mcp-create-btn" style="width:100%;padding:10px">Create Token</button>
      </div>

      <!--New token reveal box-- >
      <div id="mcp-new-token-box" style="display:none;margin-top:14px;background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.3);border-radius:10px;padding:14px">
        <div style="font-weight:600;margin-bottom:6px;color:#22c55e">✓ Token created – copy it now, it won't be shown again</div>
        <code id="mcp-new-token-value" style="display:block;background:rgba(0,0,0,.4);padding:10px 12px;border-radius:8px;word-break:break-all;font-size:13px;margin-bottom:8px;user-select:all"></code>
        <button class="btn-small" id="mcp-copy-btn">Copy to clipboard</button>
      </div>

      <!--Claude Desktop snippet-- >
      <h4 style="margin:20px 0 6px">Claude Desktop config snippet</h4>
      <p class="helper" style="margin-bottom:8px">
        For Claude Desktop, paste your token into the snippet below and add it to
        <code>~/.claude/claude_desktop_config.json</code>.
        Tools that support OAuth (e.g. <code>mcp-remote</code> ≥ 0.1) will authorise automatically — no token needed.
      </p>
      <pre id="mcp-claude-snippet" style="background:rgba(0,0,0,.3);border-radius:8px;padding:12px;font-size:12px;overflow-x:auto;white-space:pre-wrap;color:#a5b4fc">Create a token above to generate the config snippet.</pre>
    </div >
        `;

  renderOAuthAppList(oauthClients || []);
  renderTokenList(pats);
  updateSnippet(null);

  // ── Create PAT ────────────────────────────────────────────────────────────
  el.querySelector('#mcp-create-btn').addEventListener('click', async () => {
    const name = el.querySelector('#mcp-tok-name').value.trim();
    const scopes = el.querySelector('#mcp-tok-scope').value;
    const expireDays = el.querySelector('#mcp-tok-expire').value;
    if (!name) { window.showToast?.('Enter a token name', 'error'); return; }

    const btn = el.querySelector('#mcp-create-btn');
    btn.disabled = true; btn.textContent = 'Creating…';

    const payload = { name, scopes };
    if (expireDays) payload.expires_in_days = Number(expireDays);

    const res = await window.api('/oauth/pats', { method: 'POST', body: payload });
    btn.disabled = false; btn.textContent = 'Create Token';

    if (res?.token) {
      const box = el.querySelector('#mcp-new-token-box');
      const val = el.querySelector('#mcp-new-token-value');
      val.textContent = res.token;
      box.style.display = '';
      updateSnippet(res.token);

      el.querySelector('#mcp-copy-btn').onclick = () => {
        navigator.clipboard.writeText(res.token);
        el.querySelector('#mcp-copy-btn').textContent = 'Copied!';
        setTimeout(() => { el.querySelector('#mcp-copy-btn').textContent = 'Copy to clipboard'; }, 2000);
      };

      el.querySelector('#mcp-tok-name').value = '';

      // Refresh PAT list (all tokens, filter to PATs)
      const updated = await window.api('/oauth/pats');
      renderTokenList((updated || []).filter(t => !t.client_id));
    } else {
      window.showToast?.((res?.error || 'Failed to create token'), 'error');
    }
  });

  // ── OAuth Apps list ───────────────────────────────────────────────────────
  function renderOAuthAppList(list) {
    const container = el.querySelector('#mcp-oauth-app-list');
    if (!list.length) {
      container.innerHTML = `
        < div style = "color:var(--text-3);font-size:13px;padding:10px 0;display:flex;align-items:center;gap:8px" >
          <span style="font-size:18px">🔒</span>
          No OAuth apps have been granted access yet.AI tools that support OAuth 2.0
          will appear here after they authorise.
        </div > `;
      return;
    }
    container.innerHTML = '';
    for (const app of list) {
      const row = document.createElement('div');
      const scopePills = (app.scopes || '').split(' ').filter(Boolean).map(s => scopePill(s)).join('');
      const lastUsed = app.last_used ? `Last used ${window.formatDate(app.last_used)} ` : 'Never used';
      const authorizedAt = app.authorized_at ? `Authorized ${new Date(app.authorized_at * 1000).toLocaleDateString()} ` : '';
      const isFullyRevoked = (app.active_token_count || 0) === 0;

      row.style.cssText = 'display:flex;align-items:flex-start;gap:12px;padding:12px 0;border-bottom:1px solid rgba(255,255,255,.06)';
      row.innerHTML = `
        < div style = "width:36px;height:36px;border-radius:8px;background:rgba(99,102,241,.15);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:18px" >🤖</div >
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;font-size:14px${isFullyRevoked ? ';opacity:.45;text-decoration:line-through' : ''}">${window.escHtml(app.client_name)}</div>
            <div style="font-size:12px;color:var(--text-3);margin-top:3px">${scopePills}</div>
            <div style="font-size:11px;color:var(--text-3);margin-top:3px">${window.escHtml(authorizedAt + (authorizedAt ? ' · ' : '') + lastUsed)}</div>
          </div>
        ${isFullyRevoked
          ? '<span style="font-size:12px;color:#ef4444;font-weight:600;flex-shrink:0;padding-top:2px">Revoked</span>'
          : `<button class="btn-small danger mcp-revoke-app-btn" data-client="${window.escHtml(app.client_id)}" style="flex-shrink:0;margin-top:2px">Revoke Access</button>`
        }
      `;
      container.appendChild(row);
    }

    container.querySelectorAll('.mcp-revoke-app-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const appName = btn.closest('[style]').querySelector('[style*="font-weight:600"]')?.textContent || 'this app';
        if (!confirm(`Revoke all access for ${appName} ? The app will need to re - authorise.`)) return;
        btn.disabled = true; btn.textContent = 'Revoking…';
        await window.api(`/ oauth / clients / ${btn.dataset.client}/tokens`, { method: 'DELETE' });
        const updated = await window.api('/oauth/clients');
        renderOAuthAppList(updated || []);
      });
    });
  }

  // ── PAT list ──────────────────────────────────────────────────────────────
  function renderTokenList(list) {
    const container = el.querySelector('#mcp-token-list');
    if (!list.length) {
      container.innerHTML = '<div style="color:var(--text-3);font-size:13px;padding:8px 0">No personal access tokens yet.</div>';
      return;
    }
    container.innerHTML = '';
    for (const t of list) {
      const row = document.createElement('div');
      const pills = (t.scopes || '').split(' ').filter(Boolean).map(s => scopePill(s)).join('');
      const expiry = t.expires_at ? ` · Expires ${new Date(t.expires_at * 1000).toLocaleDateString()}` : ' · No expiry';
      const used = t.last_used ? ` · Last used ${window.formatDate(t.last_used)}` : ' · Never used';
      const revoked = t.revoked;
      row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.06)';
      row.innerHTML = `
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:14px${revoked ? ';text-decoration:line-through;opacity:.4' : ''}">${window.escHtml(t.name)}</div>
          <div style="font-size:12px;color:var(--text-3);margin-top:2px">${pills}${window.escHtml(expiry + used)}</div>
        </div>
        ${revoked
          ? '<span style="font-size:12px;color:#ef4444;font-weight:600">Revoked</span>'
          : `<button class="btn-small danger mcp-revoke-btn" data-id="${t.id}" style="flex-shrink:0">Revoke</button>`
        }
      `;
      container.appendChild(row);
    }

    container.querySelectorAll('.mcp-revoke-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Revoke this token? Any AI clients using it will lose access immediately.')) return;
        btn.disabled = true; btn.textContent = 'Revoking…';
        await window.api(`/oauth/pats/${btn.dataset.id}`, { method: 'DELETE' });
        const updated = await window.api('/oauth/pats');
        renderTokenList((updated || []).filter(t => !t.client_id));
      });
    });
  }

  // ── Shared helpers ────────────────────────────────────────────────────────
  function scopePill(s) {
    const isRead = s === 'email:read';
    const css = isRead
      ? 'color:#22c55e;background:rgba(34,197,94,.12)'
      : 'color:#f59e0b;background:rgba(245,158,11,.12)';
    return `<span style="display:inline-block;${css};border-radius:12px;padding:2px 8px;font-size:11px;margin-right:4px">${window.escHtml(s)}</span>`;
  }

  function updateSnippet(token) {
    const pre = el.querySelector('#mcp-claude-snippet');
    const mcpUrl = base + '/mcp';
    if (!token) {
      pre.textContent = JSON.stringify({
        mcpServers: {
          mailneo: {
            command: 'npx',
            args: ['-y', 'mcp-remote', mcpUrl],
            note: 'mcp-remote will trigger OAuth in your browser automatically'
          }
        }
      }, null, 2);
      return;
    }
    pre.textContent = JSON.stringify({
      mcpServers: {
        mailneo: {
          command: 'npx',
          args: ['-y', 'mcp-remote', mcpUrl, '--header', `Authorization: Bearer ${token}`]
        }
      }
    }, null, 2);
  }
}

window.openSettings = openSettings;
window.openAccountModal = openAccountModal;
