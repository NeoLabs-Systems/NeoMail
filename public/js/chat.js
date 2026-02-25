/* =====================================================
   MailNeo – AI Email Chat (RAG-powered)
   ===================================================== */
'use strict';

(function () {
  const HISTORY_MAX = 20; // max messages kept in memory per session

  let panelOpen = false;
  let history   = []; // { role: 'user'|'assistant', content: string }
  let pending   = false;

  /* ── DOM refs (lazy, resolved on first use) ──────── */
  function el(id) { return document.getElementById(id); }

  /* ── Toggle panel ──────────────────────────────── */
  function openChat() {
    panelOpen = true;
    el('chat-panel').classList.add('open');
    el('chat-backdrop').classList.add('open');
    el('chat-sidebar-btn').setAttribute('aria-expanded', 'true');
    el('chat-sidebar-btn').classList.add('active');
    el('chat-input').focus();
    if (!el('chat-messages').children.length) showWelcome();
  }

  function closeChat() {
    panelOpen = false;
    el('chat-panel').classList.remove('open');
    el('chat-backdrop').classList.remove('open');
    el('chat-sidebar-btn').setAttribute('aria-expanded', 'false');
    el('chat-sidebar-btn').classList.remove('active');
  }

  function toggleChat() { panelOpen ? closeChat() : openChat(); }

  /* ── Welcome message ────────────────────────────── */
  function showWelcome() {
    appendMessage('assistant',
      '👋 Hi! I\'m your MailNeo AI assistant. I can search through all your emails to answer questions, find information, summarise threads, or help you remember details.\n\nTry asking me something like:\n• *"Show me emails from Alice last month"*\n• *"What invoices did I receive this year?"*\n• *"Summarise the thread about the project deadline"*'
    );
  }

  /* ── Render a message bubble ─────────────────────── */
  function appendMessage(role, text, id) {
    const wrap = document.createElement('div');
    wrap.className = `chat-msg chat-msg-${role}`;
    if (id) wrap.id = id;

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    bubble.innerHTML = renderMarkdown(text);
    wrap.appendChild(bubble);

    const msgs = el('chat-messages');
    msgs.appendChild(wrap);
    msgs.scrollTop = msgs.scrollHeight;
    return wrap;
  }

  function setMessageContent(id, text) {
    const wrap = el(id);
    if (!wrap) return;
    wrap.querySelector('.chat-bubble').innerHTML = renderMarkdown(text);
    const msgs = el('chat-messages');
    msgs.scrollTop = msgs.scrollHeight;
  }

  /* ── Minimal markdown: bold, italic, code, bullets ── */
  function renderMarkdown(text) {
    return text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/^• (.+)$/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>')
      .replace(/\n/g, '<br>');
  }

  /* ── Send a message ─────────────────────────────── */
  async function sendMessage() {
    if (pending) return;
    const input = el('chat-input');
    const text = input.value.trim();
    if (!text) return;

    input.value = '';
    autoResize(input);
    appendMessage('user', text);
    history.push({ role: 'user', content: text });
    if (history.length > HISTORY_MAX) history = history.slice(-HISTORY_MAX);

    pending = true;
    el('chat-send').disabled = true;

    // Thinking indicator
    const thinkId = 'chat-thinking-' + Date.now();
    appendMessage('assistant', '…', thinkId);

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          message: text,
          history: history.slice(0, -1) // exclude the message we just added
        })
      });

      const data = await res.json();

      if (data.reply) {
        setMessageContent(thinkId, data.reply);
        history.push({ role: 'assistant', content: data.reply });
        if (history.length > HISTORY_MAX) history = history.slice(-HISTORY_MAX);
      } else {
        setMessageContent(thinkId, '⚠️ ' + (data.error || 'Something went wrong. Please try again.'));
      }
    } catch (err) {
      setMessageContent(thinkId, '⚠️ Network error. Please try again.');
    }

    pending = false;
    el('chat-send').disabled = false;
    input.focus();
  }

  /* ── Auto-resize textarea ───────────────────────── */
  function autoResize(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }

  /* ── Clear history ──────────────────────────────── */
  function clearHistory() {
    history = [];
    el('chat-messages').innerHTML = '';
    showWelcome();
  }

  /* ── Wire up events ─────────────────────────────── */
  document.addEventListener('DOMContentLoaded', () => {
    const fab   = el('chat-sidebar-btn');
    const send  = el('chat-send');
    const input = el('chat-input');
    const clear = el('chat-clear');
    const close = el('chat-close');
    const backdrop = el('chat-backdrop');

    fab?.addEventListener('click', toggleChat);
    send?.addEventListener('click', sendMessage);
    close?.addEventListener('click', closeChat);
    clear?.addEventListener('click', clearHistory);
    backdrop?.addEventListener('click', closeChat);

    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    input?.addEventListener('input', () => autoResize(input));

    // Escape closes panel
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && panelOpen) closeChat();
    });
  });

  window.MailNeoChat = { open: openChat, close: closeChat, toggle: toggleChat, clear: clearHistory };
})();
