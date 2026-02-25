/* =====================================================
   MailNeo – AI Features Frontend
   ===================================================== */

/* ──── Header: AI Label (single email) ──────────────── */
document.getElementById('btn-view-label').addEventListener('click', async () => {
  const email = document.getElementById('email-view')._email;
  if (!email) return;

  if (!window.State.aiAvailable) {
    window.toast('AI not configured. Add OPENAI_API_KEY in Settings → AI Config', 'error');
    return;
  }

  const btn = document.getElementById('btn-view-label');
  btn.innerHTML = '<span class="spinner"></span>';
  btn.disabled = true;

  const res = await window.api(`/api/ai/label/${email.id}`, { method: 'POST' });

  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`;
  btn.disabled = false;

  if (res?.ok) {
    window.toast(`AI label: ${res.label || 'Done'} ✓`, 'success');
    email.ai_label = res.label;
    // Refresh tag row
    const tagRow = document.getElementById('view-tags');
    // Remove old AI tag
    tagRow.querySelectorAll('.tag.ai').forEach(t => t.remove());
    if (res.label) {
      const tag = document.createElement('span');
      tag.className = 'tag ai';
      const color = window.getLabelColor(res.label);
      tag.style.background = color + '20';
      tag.style.color = color;
      tag.style.borderColor = color + '40';
      tag.textContent = res.label;
      tagRow.prepend(tag);
    }
    // Refresh list row
    window.State.emails.forEach(e => { if (e.id === email.id) e.ai_label = res.label; });
    const row = document.querySelector(`.email-row[data-id="${email.id}"]`);
    if (row) {
      const updated = window.State.emails.find(e => e.id === email.id);
      if (updated) {
        // find & update ai_label badge in row
        const badgesDiv = row.querySelector('.row-badges');
        if (badgesDiv) row.querySelector('.row-badges')?.remove();
        if (res.label) {
          const bd = document.createElement('div');
          bd.className = 'row-badges';
          const sp = document.createElement('span');
          sp.className = 'row-label';
          sp.style.background = window.getLabelColor(res.label) + '20';
          sp.style.color = window.getLabelColor(res.label);
          sp.textContent = res.label;
          bd.appendChild(sp);
          row.querySelector('.row-body')?.appendChild(bd);
        }
      }
    }
  } else {
    window.toast(res?.error || 'AI labeling failed', 'error');
  }
});

/* ──── Header: AI Summarize ─────────────────────────── */
document.getElementById('btn-view-summarize').addEventListener('click', async () => {
  const email = document.getElementById('email-view')._email;
  if (!email) return;

  if (!window.State.aiAvailable) {
    window.toast('AI not configured. Add OPENAI_API_KEY in Settings → AI Config', 'error');
    return;
  }

  const btn = document.getElementById('btn-view-summarize');
  btn.innerHTML = '<span class="spinner"></span>';
  btn.disabled = true;

  const res = await window.api(`/api/ai/summarize/${email.id}`, { method: 'POST' });

  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>`;
  btn.disabled = false;

  if (res?.summary) {
    const box = document.getElementById('ai-summary-box');
    document.getElementById('ai-summary-text').textContent = res.summary;
    box.style.display = 'block';
    email.ai_summary = res.summary;
    window.toast('Summary ready ✓', 'success');
  } else {
    window.toast(res?.error || 'Failed to summarize', 'error');
  }
});

/* ──── Bulk AI Label ────────────────────────────────── */
document.getElementById('btn-bulk-label').addEventListener('click', async () => {
  if (window.State.selectedIds.size === 0) { window.toast('Select emails first'); return; }

  if (!window.State.aiAvailable) {
    window.toast('AI not configured. Add OPENAI_API_KEY in Settings → AI Config', 'error');
    return;
  }

  const ids = [...window.State.selectedIds];
  const res = await window.api('/api/ai/label-bulk', { method: 'POST', body: { ids } });

  if (res?.ok) {
    window.toast(`AI labeling ${res.queued} email(s) in background…`, 'success');
    // Poll for completion
    let attempts = 0;
    const poll = setInterval(async () => {
      attempts++;
      if (attempts > 30) { clearInterval(poll); return; }
      window.loadEmails();
    }, 3000);
    setTimeout(() => clearInterval(poll), 90000);
  } else {
    window.toast(res?.error || 'Failed', 'error');
  }
});

/* ──── Mass Unsubscribe ─────────────────────────────── */
document.getElementById('btn-bulk-unsubscribe').addEventListener('click', async () => {
  if (window.State.selectedIds.size === 0) { window.toast('Select emails first'); return; }

  const ids = [...window.State.selectedIds];
  if (!confirm(`Attempt to unsubscribe from ${ids.length} email list(s)? Emails will be archived.`)) return;

  window.toast(`Unsubscribing from ${ids.length} lists…`);
  const res = await window.api('/api/emails/unsubscribe', { method: 'POST', body: { ids } });

  if (res?.ok) {
    const succeeded = res.results.filter(r => r.status === 'unsubscribed').length;
    const failed = res.results.filter(r => r.status === 'failed').length;
    window.toast(`Unsubscribed: ${succeeded} ✓, Failed: ${failed}`, 'success');
    window.State.selectedIds.clear();
    window.loadEmails();
    window.updateStats();
  } else {
    window.toast('Unsubscribe request failed', 'error');
  }
});
