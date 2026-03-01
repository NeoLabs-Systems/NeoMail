'use strict';

const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const { db } = require('../db/database');
const { decrypt } = require('./crypto');

const idleClients = new Map();
const specialFolderCache = new Map();

async function getSpecialFolders(account) {
  const cached = specialFolderCache.get(account.id);
  if (cached) return cached;
  const client = buildClient(account);
  await client.connect();
  let result;
  try {
    const folders = await client.list();
    result = { inbox: 'INBOX', sent: null, drafts: null, trash: null, spam: null, archive: null };
    for (const f of folders) {
      const su = (f.specialUse || '').toLowerCase();
      if (su === '\\sent')    result.sent    = f.path;
      if (su === '\\drafts')  result.drafts  = f.path;
      if (su === '\\trash' || su === '\\deleted') result.trash = f.path;
      if (su === '\\junk'  || su === '\\spam')    result.spam  = f.path;
      if (su === '\\archive'|| su === '\\all')    result.archive = f.path;
    }
    // Name-based fallbacks
    const find = (re) => folders.find(f => re.test(f.name))?.path;
    if (!result.sent)    result.sent    = find(/sent/i)    || 'Sent';
    if (!result.drafts)  result.drafts  = find(/draft/i)   || 'Drafts';
    if (!result.trash)   result.trash   = find(/trash|deleted/i) || 'Trash';
    if (!result.spam)    result.spam    = find(/spam|junk/i)     || 'Spam';
    if (!result.archive) result.archive = find(/archive|all mail/i) || 'Archive';
  } finally {
    await client.logout();
  }
  specialFolderCache.set(account.id, result);
  setTimeout(() => specialFolderCache.delete(account.id), 60 * 60 * 1000);
  return result;
}

function buildClient(account) {
  const password = decrypt(account.encrypted_pass);
  return new ImapFlow({
    host: account.imap_host,
    port: account.imap_port,
    secure: account.imap_secure === 1,
    auth: { user: account.email, pass: password },
    logger: false,
    tls: { rejectUnauthorized: true }
  });
}

async function listFolders(account) {
  const client = buildClient(account);
  await client.connect();
  try {
    const folders = await client.list();
    return folders.map(f => ({
      path: f.path,
      name: f.name,
      flags: [...(f.flags || [])],
      specialUse: f.specialUse || null
    }));
  } finally {
    await client.logout();
  }
}

async function syncFolder(account, folder = 'INBOX') {
  const client = buildClient(account);
  await client.connect();
  let newCount = 0;

  try {
    const lock = await client.getMailboxLock(folder);
    try {
      const total = client.mailbox.exists;
      if (total === 0) return 0;

      const maxUidRow = db.prepare(
        'SELECT MAX(uid) as maxUid FROM emails WHERE account_id = ? AND folder = ? AND uid IS NOT NULL'
      ).get(account.id, folder);
      const isFirstSync = !maxUidRow?.maxUid;
      const range = isFirstSync ? '1:*' : `${maxUidRow.maxUid + 1}:*`;
      const fetchByUid = !isFirstSync;

      console.log(`[IMAP] account_id=${account.id} / ${folder}: total=${total}, maxUid=${maxUidRow?.maxUid ?? 'none'}, range=${range}`);

      const msgs = await client.fetch(range, {
        uid: true,
        flags: true,
        envelope: true,
        bodyStructure: true,
        source: true
      }, { uid: fetchByUid });

      const saveEmail = db.prepare(`
        INSERT OR IGNORE INTO emails
          (account_id, message_id, uid, folder, subject, from_name, from_email,
           to_addresses, cc_addresses, date, body_text, body_html, raw_headers,
           is_read, unsubscribe_url)
        VALUES
          (@account_id, @message_id, @uid, @folder, @subject, @from_name, @from_email,
           @to_addresses, @cc_addresses, @date, @body_text, @body_html, @raw_headers,
           @is_read, @unsubscribe_url)
      `);

      for await (const msg of msgs) {
        try {
          const parsed = await simpleParser(msg.source);
          const messageId = parsed.messageId || `${account.id}-${msg.uid}-${Date.now()}`;
          const fromAddr = parsed.from?.value?.[0] || {};
          const toList = (parsed.to?.value || []).map(a => a.address).filter(Boolean).join(', ');
          const ccList = (parsed.cc?.value || []).map(a => a.address).filter(Boolean).join(', ');

          // Extract List-Unsubscribe header
          let unsubUrl = null;
          const unsubHeader = parsed.headers?.get('list-unsubscribe');
          if (unsubHeader) {
            const httpMatch = unsubHeader.match(/https?:\/\/[^\s>]+/);
            if (httpMatch) unsubUrl = httpMatch[0];
          }

          const isRead = msg.flags?.has('\\Seen') ? 1 : 0;

          const result = saveEmail.run({
            account_id: account.id,
            message_id: messageId,
            uid: msg.uid,
            folder,
            subject: parsed.subject || '(no subject)',
            from_name: fromAddr.name || null,
            from_email: fromAddr.address || 'unknown',
            to_addresses: toList || null,
            cc_addresses: ccList || null,
            date: parsed.date ? Math.floor(parsed.date.getTime() / 1000) : null,
            body_text: parsed.text || null,
            body_html: parsed.html || null,
            raw_headers: JSON.stringify(Object.fromEntries(parsed.headers || new Map())),
            is_read: isRead,
            unsubscribe_url: unsubUrl
          });

          if (result.changes > 0) {
            newCount++;
            if (parsed.attachments?.length) {
              const saveAtt = db.prepare(`
                INSERT INTO email_attachments (email_id, filename, content_type, size, data)
                VALUES (?, ?, ?, ?, ?)
              `);
              for (const att of parsed.attachments) {
                saveAtt.run(result.lastInsertRowid, att.filename, att.contentType, att.size, att.content);
              }
            }
          } else {
            // Sync flag changes from other clients (read, starred, trashed)
            db.prepare(`
              UPDATE emails SET
                is_read    = ?,
                is_starred = ?,
                is_trash   = CASE WHEN ? = 1 THEN 1 ELSE is_trash END
              WHERE account_id = ? AND message_id = ?
            `).run(
              isRead,
              msg.flags?.has('\\Flagged') ? 1 : 0,
              msg.flags?.has('\\Deleted') ? 1 : 0,
              account.id, messageId
            );
          }
        } catch (msgErr) {
          console.error(`[IMAP] Error parsing message uid=${msg.uid}:`, msgErr.message);
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
    db.prepare('UPDATE accounts SET last_synced = ? WHERE id = ?').run(Math.floor(Date.now() / 1000), account.id);
  }

  return newCount;
}

async function syncAccount(account) {
  let special;
  try { special = await getSpecialFolders(account); } catch (_) {
    special = { inbox: 'INBOX', sent: 'Sent', drafts: 'Drafts', trash: 'Trash', spam: 'Spam', archive: 'Archive' };
  }
  const foldersToSync = ['INBOX', ...new Set(
    [special.sent, special.drafts, special.trash, special.spam, special.archive].filter(Boolean)
  )];
  let total = 0;
  for (const folder of foldersToSync) {
    try {
      const n = await syncFolder(account, folder);
      total += n;
    } catch (_) { /* folder may not exist on this server */ }
  }
  return total;
}

async function setReadFlag(account, folder, uid, isRead) {
  const client = buildClient(account);
  await client.connect();
  try {
    const lock = await client.getMailboxLock(folder);
    try {
      if (isRead) {
        await client.messageFlagsAdd({ uid }, ['\\Seen'], { uid: true });
      } else {
        await client.messageFlagsRemove({ uid }, ['\\Seen'], { uid: true });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

async function moveEmail(account, folder, uid, targetFolder) {
  const client = buildClient(account);
  await client.connect();
  try {
    const lock = await client.getMailboxLock(folder);
    try {
      await client.messageMove({ uid }, targetFolder, { uid: true });
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

async function deleteEmail(account, folder, uid) {
  const client = buildClient(account);
  await client.connect();
  try {
    const lock = await client.getMailboxLock(folder);
    try {
      await client.messageFlagsAdd({ uid }, ['\\Deleted'], { uid: true });
      // Use expunge() inside the lock — mailboxClose() would close the mailbox
      // before lock.release() runs, causing an error on the stale lock.
      await client.expunge();
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

async function startIdleWatcher(account, onNewMail) {
  if (idleClients.has(account.id)) return;

  const client = buildClient(account);
  idleClients.set(account.id, client);

  client.on('error', (err) => {
    console.error(`[IDLE] Account ${account.id} error:`, err.message);
    idleClients.delete(account.id);
    setTimeout(() => startIdleWatcher(account, onNewMail), 30000);
  });

  async function runIdle() {
    try {
      await client.connect();
      client.on('exists', async (data) => {
        console.log(`[IDLE] New mail on account ${account.id}, folder ${data.path}`);

        try { await syncFolder(account, data.path || 'INBOX'); } catch (_) {}
        onNewMail(account, data);
      });

      const lock = await client.getMailboxLock('INBOX');
      try {
        await client.idle();
      } finally {
        lock.release();
      }
    } catch (err) {
      console.error(`[IDLE] Failed for account ${account.id}:`, err.message);
      idleClients.delete(account.id);
      setTimeout(() => startIdleWatcher(account, onNewMail), 60000);
    }
  }

  runIdle().catch(console.error);
}

function stopIdleWatcher(accountId) {
  const client = idleClients.get(accountId);
  if (client) {
    client.logout().catch(() => {});
    idleClients.delete(accountId);
  }
}

module.exports = {
  listFolders,
  getSpecialFolders,
  syncFolder,
  syncAccount,
  setReadFlag,
  moveEmail,
  deleteEmail,
  startIdleWatcher,
  stopIdleWatcher
};
