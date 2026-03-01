/* =====================================================
   NeoMail – Calendar Detection & ICS Export
   - Parses ICS attachments into a preview card
   - Detects date/time patterns in plain-text emails
   - Exports as .ics or opens Google Calendar
   ===================================================== */

'use strict';

/* ── ICS text parser ─────────────────────────────── */
function parseICS(text) {
  // Unfold RFC 5545 continuation lines, normalize line endings
  const lines = text
    .replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n');

  const event = {};
  let inEvent = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (line === 'BEGIN:VEVENT') { inEvent = true; continue; }
    if (line === 'END:VEVENT')   { inEvent = false; continue; }
    if (!inEvent) continue;

    const sep = line.indexOf(':');
    if (sep < 0) continue;

    const propFull = line.slice(0, sep);      // may include ;PARAM=VAL
    const val      = line.slice(sep + 1);
    const key      = propFull.split(';')[0].toUpperCase();

    switch (key) {
      case 'SUMMARY':     event.summary     = unescICS(val); break;
      case 'DTSTART':     event.dtstart     = parseICSDate(val, propFull); break;
      case 'DTEND':       event.dtend       = parseICSDate(val, propFull); break;
      case 'DURATION':    event.duration    = val; break;
      case 'LOCATION':    event.location    = unescICS(val); break;
      case 'DESCRIPTION': event.description = unescICS(val); break;
      case 'ORGANIZER': {
        const cn = propFull.match(/CN=([^;:]+)/i);
        event.organizer = cn ? cn[1] : val.replace(/^mailto:/i, '');
        break;
      }
      case 'URL':    event.url    = val; break;
      case 'UID':    event.uid    = val; break;
      case 'STATUS': event.status = val; break;
    }
  }
  return event.summary ? event : null;
}

function unescICS(s) {
  return s.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

function parseICSDate(val, prop) {
  const isAllDayProp = /VALUE=DATE(?!-TIME)/i.test(prop);
  const clean = val.replace(/Z$/, '');
  const allDay = isAllDayProp || /^\d{8}$/.test(clean);

  if (allDay) {
    const y = clean.slice(0,4), m = clean.slice(4,6), d = clean.slice(6,8);
    return { date: new Date(`${y}-${m}-${d}T00:00:00`), allDay: true };
  }
  if (clean.length >= 15) {
    const y  = clean.slice(0,4),  mo = clean.slice(4,6),  d  = clean.slice(6,8);
    const h  = clean.slice(9,11), mi = clean.slice(11,13), s  = clean.slice(13,15);
    const suffix = val.endsWith('Z') ? 'Z' : '';
    return { date: new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${suffix}`), allDay: false };
  }
  return { date: null, allDay: false };
}

/* ── Detect event signals in plain-text emails ───── */
const MONTH_MAP = {
  january:0, february:1, march:2, april:3, may:4, june:5,
  july:6, august:7, september:8, october:9, november:10, december:11
};

const DATE_PATTERNS = [
  // "March 5, 2026 at 2:00 PM" / "March 5, 2026 at 14:00"
  /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),?\s+(\d{4})\s+at\s+(\d{1,2}):(\d{2})\s*(am|pm)?/gi,
  // "5 March 2026 at 14:00"
  /\b(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})\s+at\s+(\d{1,2}):(\d{2})\s*(am|pm)?/gi,
  // "2026-03-05 14:00" or "2026-03-05T14:00"
  /\b(\d{4})[\/\-](\d{2})[\/\-](\d{2})[T\s](\d{2}):(\d{2})/g,
  // "Thu, 5 March 2026, 10:00 AM"
  /(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4}),?\s+(\d{1,2}):(\d{2})\s*(am|pm)?/gi,
];

function detectEventFromEmail(subject, bodyText) {
  const corpus = `${subject}\n${bodyText || ''}`;

  for (const pat of DATE_PATTERNS) {
    pat.lastIndex = 0;
    const m = pat.exec(corpus);
    if (!m) continue;

    let date = null;
    try { date = new Date(m[0].replace(/\s+at\s+/i, ' ')); } catch (_) {}
    // Fallback: manual parse for "Month D, YYYY at H:MM AM/PM"
    if (!date || isNaN(date)) {
      const lower = m[0].toLowerCase();
      for (const [name, idx] of Object.entries(MONTH_MAP)) {
        if (lower.includes(name)) {
          const nums = lower.match(/\d+/g);
          if (nums && nums.length >= 3) {
            const year = nums.find(n => n.length === 4);
            if (!year) continue;
            const day  = parseInt(nums[nums.length === 4 ? 1 : 0], 10);
            let   hour = parseInt(nums[nums.length - 2], 10);
            const min  = parseInt(nums[nums.length - 1], 10);
            if (lower.includes('pm') && hour < 12) hour += 12;
            if (lower.includes('am') && hour === 12) hour = 0;
            date = new Date(parseInt(year), idx, day, hour, min);
          }
          break;
        }
      }
    }

    if (date && !isNaN(date) && date.getFullYear() >= 2000) {
      // Look for an end time "to HH:MM" or "until HH:MM"
      const endMatch = corpus.slice(corpus.indexOf(m[0])).match(/\s+(?:to|until)\s+(\d{1,2}):(\d{2})\s*(am|pm)?/i);
      let dtend = null;
      if (endMatch) {
        let eh = parseInt(endMatch[1], 10);
        const em = parseInt(endMatch[2], 10);
        if (endMatch[3]?.toLowerCase() === 'pm' && eh < 12) eh += 12;
        if (endMatch[3]?.toLowerCase() === 'am' && eh === 12) eh = 0;
        dtend = { date: new Date(date.getFullYear(), date.getMonth(), date.getDate(), eh, em), allDay: false };
      }

      // Look for a location hint "at <venue>" / "Location: ..."
      const locMatch = corpus.match(/(?:location|venue|place|room|address)\s*[:–\-]\s*([^\n,\.]{5,80})/i)
                    || corpus.match(/\bat\s+([\w\s]{5,60}(?:hall|center|centre|building|office|hotel|street|rd|ave|blvd|plaza|room|conf))/i);
      const location = locMatch ? locMatch[1].trim() : null;

      return {
        summary: subject,
        dtstart: { date, allDay: false },
        dtend,
        location,
        _detected: true,
      };
    }
  }
  return null;
}

/* ── ICS generation ──────────────────────────────── */
function toICSDateTime(d, allDay) {
  const p = n => String(n).padStart(2, '0');
  const y = d.getFullYear(), mo = p(d.getMonth()+1), dd = p(d.getDate());
  if (allDay) return `${y}${mo}${dd}`;
  const h = p(d.getHours()), mi = p(d.getMinutes()), s = p(d.getSeconds());
  return `${y}${mo}${dd}T${h}${mi}${s}`;
}

function buildICS(event) {
  const esc  = s => (s||'').replace(/\\/g,'\\\\').replace(/,/g,'\\,').replace(/;/g,'\\;').replace(/\n/g,'\\n');
  const uid  = event.uid || `mailneo-${Date.now()}-${Math.random().toString(36).slice(2)}@mailneo`;
  const now  = toICSDateTime(new Date(), false);
  const start = event.dtstart?.date;
  const end   = event.dtend?.date;
  const allDay = event.dtstart?.allDay;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//NeoMail//NeoMail Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${now}Z`,
  ];

  if (start) {
    if (allDay) {
      lines.push(`DTSTART;VALUE=DATE:${toICSDateTime(start, true)}`);
      const endDt = end || (() => { const d=new Date(start); d.setDate(d.getDate()+1); return d; })();
      lines.push(`DTEND;VALUE=DATE:${toICSDateTime(endDt, true)}`);
    } else {
      lines.push(`DTSTART:${toICSDateTime(start, false)}`);
      const endDt = end || new Date(start.getTime() + 3_600_000);
      lines.push(`DTEND:${toICSDateTime(endDt, false)}`);
    }
  }

  if (event.summary)     lines.push(`SUMMARY:${esc(event.summary)}`);
  if (event.location)    lines.push(`LOCATION:${esc(event.location)}`);
  if (event.description) lines.push(`DESCRIPTION:${esc(event.description)}`);
  if (event.organizer)   lines.push(`ORGANIZER;CN="${esc(event.organizer)}":MAILTO:noreply@mailneo`);
  if (event.url)         lines.push(`URL:${event.url}`);

  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n');
}

function downloadICS(event) {
  const blob = new Blob([buildICS(event)], { type: 'text/calendar;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `${(event.summary || 'event').replace(/[^a-z0-9\-_ ]/gi, '').trim().replace(/\s+/g, '_').slice(0, 60) || 'event'}.ics`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/* ── Google Calendar deep-link ───────────────────── */
function openGoogleCalendar(event) {
  const start = event.dtstart?.date;
  if (!start) { downloadICS(event); return; }
  const end  = event.dtend?.date || new Date(start.getTime() + 3_600_000);
  const fmt  = d => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const url  = new URL('https://calendar.google.com/calendar/render');
  url.searchParams.set('action', 'TEMPLATE');
  url.searchParams.set('text', event.summary || '');
  url.searchParams.set('dates', `${fmt(start)}/${fmt(end)}`);
  if (event.location)    url.searchParams.set('location', event.location);
  if (event.description) url.searchParams.set('details', event.description.slice(0, 1500));
  window.open(url.toString(), '_blank', 'noopener,noreferrer');
}

/* ── Format date for display ─────────────────────── */
function fmtCalDate(dtObj) {
  if (!dtObj?.date || isNaN(dtObj.date)) return null;
  return dtObj.date.toLocaleString(undefined,
    dtObj.allDay
      ? { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }
      : { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }
  );
}

/* ── Render card into email view ─────────────────── */
function renderCalendarCard(event) {
  // Remove any previously rendered card
  document.querySelectorAll('.cal-card').forEach(c => c.remove());

  const esc  = window.escHtml || (s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'));
  const card = document.createElement('div');
  card.className = 'cal-card';

  const startStr = fmtCalDate(event.dtstart);
  const endStr   = event.dtend && !event.dtstart?.allDay ? fmtCalDate(event.dtend) : null;

  const badge = event._detected
    ? `<span class="cal-badge cal-badge-detected">✦ Detected</span>`
    : `<span class="cal-badge cal-badge-ics">ICS</span>`;

  card.innerHTML = `
    <div class="cal-card-header">
      <svg class="cal-card-cal-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
        <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
        <line x1="3" y1="10" x2="21" y2="10"/>
      </svg>
      <span class="cal-card-title">${esc(event.summary || 'Calendar Event')}</span>
      ${badge}
    </div>
    ${startStr ? `
    <div class="cal-card-row">
      <span class="cal-card-icon">🕐</span>
      <span>${startStr}${endStr ? `<span class="cal-end-sep"> → </span>${endStr}` : ''}</span>
    </div>` : ''}
    ${event.location ? `
    <div class="cal-card-row">
      <span class="cal-card-icon">📍</span>
      <span>${esc(event.location)}</span>
    </div>` : ''}
    ${event.organizer ? `
    <div class="cal-card-row">
      <span class="cal-card-icon">👤</span>
      <span>${esc(event.organizer)}</span>
    </div>` : ''}
    ${event.description ? `
    <div class="cal-card-desc">${esc(event.description.slice(0, 250))}${event.description.length > 250 ? '…' : ''}</div>
    ` : ''}
    <div class="cal-card-actions">
      <button class="cal-btn cal-btn-export" title="Download .ics file">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Export .ics
      </button>
      <button class="cal-btn cal-btn-google" title="Open in Google Calendar">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        Add to Calendar
      </button>
    </div>
  `;

  card.querySelector('.cal-btn-export').addEventListener('click', () => downloadICS(event));
  card.querySelector('.cal-btn-google').addEventListener('click', () => openGoogleCalendar(event));

  // Insert above the email body
  const bodyWrap = document.querySelector('.email-body-wrap');
  if (bodyWrap) bodyWrap.before(card);
}

/* ── Main entry point — called from openEmail() ──── */
async function detectAndShowCalendar(emailData) {
  // Clean up any previous card immediately
  document.querySelectorAll('.cal-card').forEach(c => c.remove());

  // 1. ICS attachment?
  const icsAtt = (emailData.attachments || []).find(a =>
    /text\/calendar|application\/ics|application\/x-vcalendar/i.test(a.content_type || '') ||
    /\.(ics|ical|vcs)$/i.test(a.filename || '')
  );

  if (icsAtt) {
    try {
      const resp = await fetch(`/api/emails/${emailData.id}/attachment/${icsAtt.id}`);
      if (resp.ok) {
        const text = await resp.text();
        const event = parseICS(text);
        if (event) { renderCalendarCard(event); return; }
      }
    } catch (_) {}
  }

  // 2. Detect date/time patterns in email text
  const detected = detectEventFromEmail(emailData.subject || '', emailData.body_text || '');
  if (detected) renderCalendarCard(detected);
}

window.detectAndShowCalendar = detectAndShowCalendar;
