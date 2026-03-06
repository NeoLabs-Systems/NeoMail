/* =====================================================
   NeoMail – Compose
   ===================================================== */

let composeData = {};
let sigEnabled = true;
let draftTimer = null;
let composeDirty = false;
let composeAttachments = [];

/* ── Draft helpers ────────────────────────────────── */
const DRAFT_KEY = 'mailneo_draft';

function saveDraft() {
  if (!composeDirty) return; // don't overwrite a saved draft before the user has typed anything
  try {
    const draft = {
      to: document.getElementById('compose-to').value,
      cc: document.getElementById('compose-cc').value,
      bcc: document.getElementById('compose-bcc').value,
      subject: document.getElementById('compose-subject').value,
      bodyHtml: document.getElementById('compose-body').innerHTML,
      originalBody: composeData.originalBody || null,
      savedAt: Date.now(),
    };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch (_) { }
}

function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch (_) { }
}

function startDraftTimer() {
  clearInterval(draftTimer);
  draftTimer = setInterval(saveDraft, 5000);
}

function stopDraftTimer() {
  clearInterval(draftTimer);
  draftTimer = null;
}

/* ── Contact autocomplete ─────────────────────────── */
function setupAutocomplete(inputEl) {
  let dropdown = null;
  let abortCtrl = null;

  function removeDropdown() {
    dropdown?.remove();
    dropdown = null;
  }

  inputEl.addEventListener('input', async () => {
    const q = inputEl.value.split(',').pop().trim();
    if (q.length < 2) { removeDropdown(); return; }
    if (abortCtrl) abortCtrl.abort();
    abortCtrl = new AbortController();
    try {
      const res = await fetch(`/api/emails/contacts?q=${encodeURIComponent(q)}`, {
        credentials: 'include', signal: abortCtrl.signal
      });
      const contacts = await res.json();
      removeDropdown();
      if (!contacts.length) return;
      dropdown = document.createElement('div');
      dropdown.className = 'contact-dropdown';
      for (const c of contacts) {
        const item = document.createElement('div');
        item.className = 'contact-item';
        item.innerHTML = `<strong>${c.from_name || ''}</strong> <span>${c.from_email}</span>`;
        item.addEventListener('mousedown', (e) => {
          e.preventDefault();
          const parts = inputEl.value.split(',');
          parts.pop();
          parts.push(`${c.from_name ? c.from_name + ' ' : ''}<${c.from_email}>`);
          inputEl.value = parts.join(', ') + ', ';
          removeDropdown();
        });
        dropdown.appendChild(item);
      }
      inputEl.parentNode.style.position = 'relative';
      inputEl.after(dropdown);
    } catch (_) { }
  });

  inputEl.addEventListener('blur', () => setTimeout(removeDropdown, 200));
  inputEl.addEventListener('keydown', (e) => {
    if (!dropdown) return;
    if (e.key === 'Escape') removeDropdown();
    if (e.key === 'ArrowDown') {
      const first = dropdown.querySelector('.contact-item');
      first?.focus();
      e.preventDefault();
    }
  });
}

function getSigHtml() {
  const s = window.State?.settings;
  const text = s?.signature || '';
  if (!text || !sigEnabled) return '';

  const italic = s?.sig_style === 'italic' ? 'font-style:italic;' : '';
  const sizes = { small: '11px', large: '15px' };
  const size = sizes[s?.sig_size] || '13px';
  const color = s?.sig_color || '#888888';
  const sep = s?.sig_separator || 'dashes';

  const safeText = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
  let sepHtml = '';
  if (sep === 'hr') {
    sepHtml = '<hr style="border:none;border-top:1px solid #d0d0da;margin:10px 0">';
  } else if (sep !== 'none') {
    sepHtml = '<span style="color:#bbb">-- </span><br>';
  }

  return `<br><br><div class="compose-sig" style="${italic}font-size:${size};color:${color};white-space:pre-wrap">${sepHtml}${safeText}</div>`;
}

function rebuildBody() {
  const body = document.getElementById('compose-body');
  const sigHtml = getSigHtml();
  if (composeData.originalBody) {
    body.innerHTML = `${sigHtml}<br><br><hr style="border-color:#ffffff10;margin:12px 0"><div style="color:#888">${composeData.originalBody.replace(/\n/g, '<br>')}</div>`;
  } else {
    body.innerHTML = sigHtml;
  }
  // Place cursor at top
  body.focus();
  try {
    const range = document.createRange();
    range.setStart(body, 0);
    range.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  } catch (_) { }
}

function updateSigBtn() {
  const btn = document.getElementById('btn-toggle-sig');
  const hasSig = !!(window.State?.settings?.signature);
  if (!hasSig) { btn.style.display = 'none'; return; }
  btn.style.display = '';
  btn.style.opacity = sigEnabled ? '1' : '0.45';
  btn.textContent = sigEnabled ? 'Sig ✓' : 'Sig ✗';
  btn.title = sigEnabled ? 'Click to disable signature' : 'Click to enable signature';
}

function openCompose(opts = {}) {
  const modal = document.getElementById('compose-modal');
  // If compose is already open and this is a new message (no reply opts), don't clobber what the user is typing
  if (modal.style.display === 'flex' && !opts.to && !opts.subject && !opts.originalBody) {
    modal.focus?.();
    return;
  }
  composeData = opts;
  sigEnabled = true;
  composeAttachments = [];
  renderAttachmentChips();
  modal.style.display = 'flex';
  modal.style.flexDirection = 'column';

  document.getElementById('compose-to').value = opts.to || '';
  document.getElementById('compose-cc').value = opts.cc || '';
  document.getElementById('compose-bcc').value = opts.bcc || '';
  // Hide BCC row unless pre-populated
  const bccRow = document.getElementById('compose-bcc-row');
  if (bccRow) bccRow.style.display = opts.bcc ? '' : 'none';

  document.getElementById('compose-subject').value = opts.subject || '';
  document.getElementById('compose-title').textContent = opts.to ? 'Reply' : 'New Message';

  composeDirty = false;
  rebuildBody();
  // Pre-fill reply body text if provided (smart replies)
  if (opts.prefillBody) {
    const bodyEl = document.getElementById('compose-body');
    bodyEl.focus();
    try {
      const sel = window.getSelection();
      sel.selectAllChildren(bodyEl);
      sel.collapseToStart();
    } catch (_) { }
    document.execCommand('insertText', false, opts.prefillBody);
  }
  updateSigBtn();

  document.getElementById('ai-compose-panel').style.display = 'none';
  document.getElementById('send-status').textContent = '';

  // Draft restore — only for new (non-reply) composes
  if (!opts.to) {
    try {
      const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
      if (saved && Date.now() - saved.savedAt < 24 * 60 * 60e3) {
        const banner = document.getElementById('draft-restore-banner');
        if (banner) {
          banner.style.display = 'flex';
          document.getElementById('btn-restore-draft').onclick = () => {
            document.getElementById('compose-to').value = saved.to || '';
            document.getElementById('compose-cc').value = saved.cc || '';
            document.getElementById('compose-bcc').value = saved.bcc || '';
            if (saved.bcc && bccRow) bccRow.style.display = '';
            document.getElementById('compose-subject').value = saved.subject || '';
            document.getElementById('compose-body').innerHTML = saved.bodyHtml || '';
            banner.style.display = 'none';
            composeDirty = true; // user has content now — safe to auto-save over it
            clearDraft();
          };
          document.getElementById('btn-discard-draft').onclick = () => {
            banner.style.display = 'none';
            clearDraft();
          };
        }
      }
    } catch (_) { }
  }

  // Mark dirty on any user interaction with compose fields
  const markDirty = () => { composeDirty = true; };
  ['compose-to', 'compose-cc', 'compose-bcc', 'compose-subject'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', markDirty, { once: true });
  });
  document.getElementById('compose-body')?.addEventListener('input', markDirty, { once: true });

  startDraftTimer();
}

function populateComposeFrom() {
  const sel = document.getElementById('compose-from');
  sel.innerHTML = '';
  for (const acc of window.State.accounts) {
    const opt = document.createElement('option');
    opt.value = acc.id;
    opt.textContent = `${acc.label || acc.email} <${acc.email}>`;
    if (acc.is_default) opt.selected = true;
    sel.appendChild(opt);
  }
}

document.getElementById('compose-close').addEventListener('click', () => {
  stopDraftTimer();
  saveDraft();
  const modal = document.getElementById('compose-modal');
  modal.style.display = 'none';
  modal.style.removeProperty('height');
  modal.style.removeProperty('overflow');
});

// BCC toggle
document.getElementById('btn-toggle-bcc')?.addEventListener('click', () => {
  const row = document.getElementById('compose-bcc-row');
  if (!row) return;
  const hidden = row.style.display === 'none' || row.style.display === '';
  row.style.display = hidden ? 'flex' : 'none';
  if (hidden) document.getElementById('compose-bcc')?.focus();
});

// Minimize
document.getElementById('compose-minimize').addEventListener('click', () => {
  const modal = document.getElementById('compose-modal');
  if (modal.style.height === '44px') {
    modal.style.removeProperty('height');
    modal.style.removeProperty('overflow');
  } else {
    modal.style.height = '44px';
    modal.style.overflow = 'hidden';
  }
});

// Signature toggle
document.getElementById('btn-toggle-sig').addEventListener('click', () => {
  sigEnabled = !sigEnabled;
  updateSigBtn();
  const body = document.getElementById('compose-body');
  // Surgically remove/add the signature without touching anything the user typed
  body.querySelectorAll('.compose-sig').forEach(el => el.remove());
  if (sigEnabled) {
    const sigHtml = getSigHtml();
    if (sigHtml) body.insertAdjacentHTML('beforeend', sigHtml);
  }
});

// Formatting toolbar
document.querySelectorAll('.compose-tb-btn[data-cmd]').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    const cmd = btn.dataset.cmd;
    if (cmd === 'createLink') {
      const url = prompt('Enter URL:');
      if (url) document.execCommand('createLink', false, url);
    } else {
      document.execCommand(cmd, false, null);
    }
    document.getElementById('compose-body').focus();
  });
});

// AI Compose toggle
document.getElementById('compose-ai-btn').addEventListener('click', () => {
  const panel = document.getElementById('ai-compose-panel');
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
});

// AI Generate
document.getElementById('btn-ai-generate').addEventListener('click', async () => {
  const instruction = document.getElementById('ai-instruction').value.trim();
  if (!instruction) { window.toast('Describe what to write first'); return; }

  const btn = document.getElementById('btn-ai-generate');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Generating…';

  const res = await window.api('/api/ai/compose', {
    method: 'POST',
    body: {
      instruction,
      originalEmailId: composeData.originalEmailId || null
    }
  });

  btn.disabled = false;
  btn.innerHTML = '✦ Generate Draft';

  if (res?.draft) {
    document.getElementById('compose-body').innerHTML = res.draft.replace(/\n/g, '<br>');
    document.getElementById('ai-compose-panel').style.display = 'none';
    window.toast('AI draft ready ✓', 'success');
  } else {
    window.toast(res?.error || 'AI generation failed', 'error');
  }
});

// Undo send state
let undoTimer = null;
let undoCancelled = false;

function collectSendPayload() {
  const accountId = document.getElementById('compose-from').value;
  const to = document.getElementById('compose-to').value.trim();
  const cc = document.getElementById('compose-cc').value.trim();
  const bcc = document.getElementById('compose-bcc').value.trim();
  const subject = document.getElementById('compose-subject').value.trim();
  const body = document.getElementById('compose-body');
  return { accountId, to, cc, bcc, subject, html: body.innerHTML, text: body.innerText, attachments: composeAttachments.slice() };
}

async function actualSend(payload) {
  const res = await window.api('/api/emails/send', {
    method: 'POST',
    body: {
      account_id: Number(payload.accountId),
      to: payload.to, cc: payload.cc || undefined, bcc: payload.bcc || undefined,
      subject: payload.subject, text: payload.text, html: payload.html,
      inReplyTo: composeData.inReplyTo || undefined,
      references: composeData.inReplyTo || undefined,
      attachments: payload.attachments?.length ? payload.attachments : undefined,
    }
  });
  return res;
}

function showUndoBar(payload, onExpire) {
  const bar = document.getElementById('undo-send-bar');
  let secs = 5;
  undoCancelled = false;
  bar.style.display = 'flex';
  bar.innerHTML = `
    <span class="undo-msg">Message queued…</span>
    <span class="undo-countdown" id="undo-cd">${secs}s</span>
    <button class="btn-undo" id="btn-undo">Undo</button>
  `;
  document.getElementById('btn-undo').addEventListener('click', () => {
    undoCancelled = true;
    clearInterval(undoTimer);
    bar.style.display = 'none';
    window.toast('Send cancelled', 'info');
  });
  undoTimer = setInterval(() => {
    secs--;
    const cd = document.getElementById('undo-cd');
    if (cd) cd.textContent = secs + 's';
    if (secs <= 0) {
      clearInterval(undoTimer);
      bar.style.display = 'none';
      if (!undoCancelled) onExpire();
    }
  }, 1000);
}

// Send
document.getElementById('btn-send').addEventListener('click', async () => {
  const payload = collectSendPayload();
  if (!payload.to) { window.toast('Recipient required', 'error'); return; }
  if (!payload.subject) { window.toast('Subject required', 'error'); return; }
  if (!payload.accountId) { window.toast('No account configured', 'error'); return; }

  // Close compose immediately for snappy UX
  clearDraft();
  stopDraftTimer();
  document.getElementById('compose-modal').style.display = 'none';

  showUndoBar(payload, async () => {
    const res = await actualSend(payload);
    if (res?.ok) {
      window.toast('Message sent ✓', 'success');
    } else {
      window.toast(res?.error || 'Send failed', 'error');
    }
  });
});

// Send Later
document.getElementById('btn-send-later')?.addEventListener('click', () => {
  const to = document.getElementById('compose-to').value.trim();
  const subject = document.getElementById('compose-subject').value.trim();
  if (!to) { window.toast('Recipient required', 'error'); return; }
  if (!subject) { window.toast('Subject required', 'error'); return; }

  const overlay = document.getElementById('schedule-overlay');
  // Default to tomorrow 9am
  const tmr = new Date(Date.now() + 86400_000);
  tmr.setHours(9, 0, 0, 0);
  document.getElementById('schedule-dt').value = tmr.toISOString().slice(0, 16);
  overlay.style.display = 'flex';
});

document.getElementById('btn-schedule-cancel')?.addEventListener('click', () => {
  document.getElementById('schedule-overlay').style.display = 'none';
});

document.getElementById('btn-schedule-confirm')?.addEventListener('click', async () => {
  const dtVal = document.getElementById('schedule-dt').value;
  const sendAt = Math.floor(new Date(dtVal).getTime() / 1000);
  if (isNaN(sendAt) || sendAt <= Math.floor(Date.now() / 1000)) {
    window.toast('Pick a future date/time', 'error'); return;
  }
  const accountId = document.getElementById('compose-from').value;
  if (!accountId) { window.toast('No account configured', 'error'); return; }
  const payload = collectSendPayload();
  document.getElementById('schedule-overlay').style.display = 'none';

  const res = await window.api('/api/emails/schedule', {
    method: 'POST',
    body: {
      account_id: Number(accountId),
      to: payload.to, cc: payload.cc || undefined, bcc: payload.bcc || undefined,
      subject: payload.subject, text: payload.text, html: payload.html,
      in_reply_to: composeData.inReplyTo || undefined,
      send_at: sendAt
    }
  });

  if (res?.ok) {
    clearDraft();
    stopDraftTimer();
    document.getElementById('compose-modal').style.display = 'none';
    window.toast(`Scheduled for ${new Date(sendAt * 1000).toLocaleString()} ✓`, 'success');
  } else {
    window.toast(res?.error || 'Schedule failed', 'error');
  }
});

// Set up autocomplete on To / CC / BCC after DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const toEl = document.getElementById('compose-to');
  const ccEl = document.getElementById('compose-cc');
  const bccEl = document.getElementById('compose-bcc');
  if (toEl) setupAutocomplete(toEl);
  if (ccEl) setupAutocomplete(ccEl);
  if (bccEl) setupAutocomplete(bccEl);

  // File attachment button
  const attachBtn = document.getElementById('btn-attach');
  const fileInput = document.getElementById('compose-file-input');
  if (attachBtn && fileInput) {
    attachBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const files = Array.from(fileInput.files || []);
      fileInput.value = '';
      files.forEach(file => {
        const reader = new FileReader();
        reader.onload = (ev) => {
          const dataUrl = ev.target.result;
          const base64 = dataUrl.split(',')[1];
          composeAttachments.push({
            filename: file.name,
            content: base64,
            contentType: file.type || 'application/octet-stream',
            encoding: 'base64',
          });
          renderAttachmentChips();
        };
        reader.readAsDataURL(file);
      });
    });
  }

  // Draft restore banner (inject if not in HTML)
  const modal = document.getElementById('compose-modal');
  if (modal && !document.getElementById('draft-restore-banner')) {
    const banner = document.createElement('div');
    banner.id = 'draft-restore-banner';
    banner.className = 'draft-banner';
    banner.style.display = 'none';
    banner.innerHTML = `
      <span>📝 Unsaved draft found.</span>
      <button id="btn-restore-draft" class="btn-sm">Restore</button>
      <button id="btn-discard-draft" class="btn-sm">Discard</button>
    `;
    const fields = modal.querySelector('.compose-fields');
    if (fields) fields.before(banner);
    else modal.prepend(banner);
  }
});

function renderAttachmentChips() {
  const container = document.getElementById('compose-attachments');
  if (!container) return;
  container.style.display = composeAttachments.length ? 'flex' : 'none';
  container.innerHTML = '';
  composeAttachments.forEach((att, idx) => {
    const chip = document.createElement('div');
    chip.className = 'compose-att-chip';
    chip.innerHTML = `📎 <span title="${att.filename}">${att.filename}</span><button class="att-remove" data-idx="${idx}" title="Remove">✕</button>`;
    chip.querySelector('.att-remove').addEventListener('click', () => {
      composeAttachments.splice(idx, 1);
      renderAttachmentChips();
    });
    container.appendChild(chip);
  });
}

window.openCompose = openCompose;
window.populateComposeFrom = populateComposeFrom;
