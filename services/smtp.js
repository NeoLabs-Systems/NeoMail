'use strict';

const nodemailer = require('nodemailer');
const { decrypt } = require('./crypto');

function createTransport(account) {
  const password = decrypt(account.encrypted_pass);
  // Port 465 = implicit SSL/TLS (secure: true)
  // Port 587/25 = STARTTLS (secure: false, requireTLS: true)
  const secure = account.smtp_port === 465;
  return nodemailer.createTransport({
    host: account.smtp_host,
    port: account.smtp_port,
    secure,
    requireTLS: !secure,
    auth: { user: account.email, pass: password },
    tls: { rejectUnauthorized: process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== 'false', minVersion: 'TLSv1.2' }
  });
}

async function sendEmail(account, options) {
  const transport = createTransport(account);
  const info = await transport.sendMail({
    from: `${account.label || account.email} <${account.email}>`,
    to: options.to,
    cc: options.cc || undefined,
    bcc: options.bcc || undefined,
    subject: options.subject || '(no subject)',
    text: options.text || '',
    html: options.html || undefined,
    replyTo: options.replyTo || undefined,
    inReplyTo: options.inReplyTo || undefined,
    references: options.references || undefined,
    attachments: options.attachments || []
  });
  return info;
}

async function verifySmtp(account) {
  const transport = createTransport(account);
  await transport.verify();
  return true;
}

module.exports = { sendEmail, verifySmtp };
