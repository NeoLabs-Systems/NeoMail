'use strict';

const { convert: htmlToText } = require('html-to-text');

let openaiClient = null;

function getClient() {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return null;
    const OpenAI = require('openai');
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

function truncate(text, maxChars = 3000) {
  if (!text) return '';
  return text.length > maxChars ? text.slice(0, maxChars) + '...' : text;
}

function stripHtml(html) {
  if (!html) return '';
  try {
    return htmlToText(html, { wordwrap: false, selectors: [{ selector: 'img', format: 'skip' }] });
  } catch (_) {
    return html.replace(/<[^>]+>/g, ' ');
  }
}

async function labelEmail(subject, bodyHtml, bodyText) {
  const client = getClient();
  if (!client) return null;

  const body = truncate(bodyText || stripHtml(bodyHtml), 1500);
  try {
    const res = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Classify this email into exactly one category. Reply with ONLY the label, nothing else. Labels: Work, Personal, Finance, Newsletter, Travel, Spam, Other'
        },
        { role: 'user', content: `Subject: ${subject}\n\n${body}` }
      ],
      max_completion_tokens: 10
    });
    return res.choices[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.error('[AI] labelEmail error:', err.message);
    return null;
  }
}

async function summarizeEmail(subject, bodyHtml, bodyText) {
  const client = getClient();
  if (!client) return null;

  const body = truncate(bodyText || stripHtml(bodyHtml), 2500);
  try {
    const res = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Summarize this email in 1–2 plain English sentences. Be direct and informative. No fluff.'
        },
        { role: 'user', content: `Subject: ${subject}\n\n${body}` }
      ],
      max_completion_tokens: 100
    });
    return res.choices[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.error('[AI] summarizeEmail error:', err.message);
    return null;
  }
}

async function composeEmail(instruction, originalEmail, cursorRules) {
  const client = getClient();
  if (!client) return null;

  const systemPrompt = [
    'You are an expert email assistant. Write clear, professional, and concise emails.',
    cursorRules ? `\n\nUser writing rules:\n${cursorRules}` : ''
  ].join('');

  const userContent = originalEmail
    ? `Instructions: ${instruction}\n\nOriginal email to reply to:\n${truncate(originalEmail, 2000)}`
    : `Instructions: ${instruction}`;

  try {
    const res = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ],
      max_completion_tokens: 600
    });
    return res.choices[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.error('[AI] composeEmail error:', err.message);
    return null;
  }
}

async function applyCursorRules(rules, emailMeta) {
  const client = getClient();
  if (!client || !rules?.length) return {};

  const rulesText = rules.map(r => `- ${r.title}: ${r.rule_text}`).join('\n');
  const emailInfo = `Subject: ${emailMeta.subject}\nFrom: ${emailMeta.from_email}\nPreview: ${truncate(emailMeta.body_text, 500)}`;

  try {
    const res = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You apply inbox rules to emails. Given these user rules:\n${rulesText}\n\nFor the email, respond with a JSON object with these optional fields: { "label": string, "priority": "high"|"medium"|"low", "archive": boolean, "awaiting_reply": boolean, "note": string }. Only include fields that match a rule.`
        },
        { role: 'user', content: emailInfo }
      ],
      max_completion_tokens: 150,
      response_format: { type: 'json_object' }
    });
    const text = res.choices[0]?.message?.content || '{}';
    return JSON.parse(text);
  } catch (err) {
    console.error('[AI] applyCursorRules error:', err.message);
    return {};
  }
}

async function shouldNotify(subject, bodyText) {
  const client = getClient();
  if (!client) return true;
  const body = truncate(bodyText || '', 600);
  try {
    const res = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Decide if this email warrants a desktop notification. Reply ONLY with YES or NO. Newsletters, marketing, automated alerts, social notifications, and spam = NO. Personal messages, direct work communication, replies, order confirmations = YES.'
        },
        { role: 'user', content: `Subject: ${subject || '(no subject)'}\n\n${body}` }
      ],
      max_completion_tokens: 3
    });
    return (res.choices[0]?.message?.content || '').trim().toUpperCase() !== 'NO';
  } catch (_) {
    return true;
  }
}

async function analyzeEmail(subject, bodyHtml, bodyText) {
  const client = getClient();
  if (!client) return { label: null, notify: true, awaiting_reply: false };

  const body = truncate(bodyText || stripHtml(bodyHtml), 1500);
  try {
    const res = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Analyze this email. Respond with a JSON object: { "label": one of [Work, Personal, Finance, Newsletter, Travel, Spam, Other], "notify": true if it deserves a desktop notification (personal message, direct work email, reply, order confirmation) false for newsletters/marketing/automated/spam, "awaiting_reply": true if the sender clearly expects or needs a reply from the recipient false if it is informational automated or no response needed }.'
        },
        { role: 'user', content: `Subject: ${subject || '(no subject)'}\n\n${body}` }
      ],
      max_completion_tokens: 50,
      response_format: { type: 'json_object' }
    });
    const parsed = JSON.parse(res.choices[0]?.message?.content || '{}');
    return {
      label: parsed.label || null,
      notify: parsed.notify !== false,
      awaiting_reply: !!parsed.awaiting_reply,
    };
  } catch (_) {
    return { label: null, notify: true, awaiting_reply: false };
  }
}

async function smartReplies(subject, bodyHtml, bodyText) {
  const client = getClient();
  if (!client) return [];
  const body = truncate(bodyText || stripHtml(bodyHtml), 1500);
  try {
    const res = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Generate exactly 3 short natural email reply suggestions. Return JSON: { "replies": ["...", "...", "..."] }. Each reply max 12 words. Vary tone: one affirming, one questioning, one offering next step.'
        },
        { role: 'user', content: `Subject: ${subject}\n\n${body}` }
      ],
      max_completion_tokens: 150,
      response_format: { type: 'json_object' }
    });
    const parsed = JSON.parse(res.choices[0]?.message?.content || '{}');
    const arr = Array.isArray(parsed.replies) ? parsed.replies : Object.values(parsed).find(Array.isArray) || [];
    return arr.slice(0, 3).filter(s => typeof s === 'string' && s.trim());
  } catch (err) {
    console.error('[AI] smartReplies error:', err.message);
    return [];
  }
}

async function summarizeAttachment(filename, emailSubject, emailBodyText) {
  const client = getClient();
  if (!client) return null;
  const context = truncate(emailBodyText || '', 800);
  try {
    const res = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Based on the email context and attachment filename, write a single sentence describing what this attachment likely contains. Be specific.'
        },
        { role: 'user', content: `Email subject: ${emailSubject}\nAttachment filename: ${filename}\nEmail body snippet: ${context}` }
      ],
      max_completion_tokens: 80
    });
    return res.choices[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.error('[AI] summarizeAttachment error:', err.message);
    return null;
  }
}

async function chatWithContext(userMessage, history, contextBlock, meta) {
  const client = getClient();
  if (!client) throw new Error('OpenAI API key not configured');

  const systemPrompt = [
    'You are NeoMail AI, an intelligent email assistant.',
    'You help users find information, summarise threads, and answer questions about their emails.',
    `Today is ${meta.today}.`,
    `The user has ${meta.totalEmails} emails indexed across their accounts.`,
    contextBlock
      ? `The following emails matched the user\'s query (most relevant first):\n\n${contextBlock}`
      : 'No emails matched the search for this query — answer based on conversation context or say so honestly.',
    '',
    'Only reference information from the provided emails. Be concise. Never invent email content.',
  ].join('\n');

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-16),
    { role: 'user', content: userMessage },
  ];

  const resp = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    messages,
    max_tokens: 1024,
    temperature: 0.3,
  });

  return resp.choices[0]?.message?.content || '';
}

module.exports = {
  labelEmail,
  summarizeEmail,
  composeEmail,
  applyCursorRules,
  shouldNotify,
  analyzeEmail,
  chatWithContext,
  smartReplies,
  summarizeAttachment,
  stripHtml,
  isAvailable: () => !!process.env.OPENAI_API_KEY
};
