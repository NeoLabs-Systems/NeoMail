# Setup Guide

Everything you need to go from zero to a running MailNeo inbox.

---

## Requirements

| | Minimum |
|---|---|
| **Node.js** | 18 LTS or higher |
| **OS** | macOS, Linux, Windows (WSL recommended) |
| **RAM** | 256 MB |
| **Disk** | 500 MB (more for large mailboxes) |
| **Email** | Any IMAP/SMTP account |

---

## 1 · Install

```bash
git clone https://github.com/you/mailneo
cd mailneo
npm install
```

---

## 2 · Configure

Run the setup script — it generates a `.env` file with secure random keys automatically:

```bash
npm run setup
```

This creates `.env` with:
- A random 64-byte `ENCRYPTION_KEY` for password encryption
- A random 64-byte `SESSION_SECRET` for session signing
- Port set to `3001`

You can also copy `.env.example` manually and fill in the values.

---

## 3 · Start

```bash
# Production
npm start

# Development (auto-restarts on file changes)
npm run dev
```

Open **http://localhost:3001** in your browser.

---

## 4 · Create an Account

On first launch you'll see the login page. Click **Create Account** and register with a username, email address, and password.

> To disable new registrations after setup, set `ALLOW_REGISTRATION=false` in `.env`.

---

## 5 · Add an Email Account

Once logged in:

1. Click **+ Add Account** in the sidebar (bottom left)
2. Fill in your email address and password
3. Use the **Quick Setup** presets for Gmail / Outlook / Yahoo / iCloud
4. Click **Verify SMTP** to test the connection before saving

MailNeo will immediately start syncing your mailbox in the background.

---

## Account Setup by Provider

### Gmail

Gmail requires an **App Password** (not your normal password).

1. Go to [myaccount.google.com/security](https://myaccount.google.com/security)
2. Enable **2-Step Verification** if not already on
3. Search for **App Passwords** → Create one → name it "MailNeo"
4. Use that 16-character password in MailNeo

**Settings:**
```
IMAP host:  imap.gmail.com   port: 993  TLS: on
SMTP host:  smtp.gmail.com   port: 587  TLS: off (STARTTLS)
```

### Outlook / Hotmail / Live

1. Go to [account.microsoft.com/security](https://account.microsoft.com/security)
2. Under **Advanced security** → enable **Two-step verification**
3. Create an **App password** and use it in MailNeo

**Settings:**
```
IMAP host:  outlook.office365.com  port: 993  TLS: on
SMTP host:  smtp.office365.com     port: 587  TLS: off
```

### iCloud

1. Go to [appleid.apple.com](https://appleid.apple.com)
2. **Sign-In and Security** → **App-Specific Passwords** → Generate one

**Settings:**
```
IMAP host:  imap.mail.me.com   port: 993  TLS: on
SMTP host:  smtp.mail.me.com   port: 587  TLS: off
```

### Custom / Self-hosted

Use the manual form — fill in your IMAP/SMTP host, port, and credentials directly.

---

## AI Features (Optional)

Add your OpenAI API key to `.env`:

```env
OPENAI_API_KEY=sk-...
```

Restart the server. The **Ask AI** button in the sidebar will now be active.

See [configuration.md](configuration.md) for all available options.

---

## Updating

```bash
git pull
npm install   # in case dependencies changed
npm start
```

The database schema is updated automatically on startup via safe migrations.

---

## Running on a Server

To expose MailNeo publicly, put it behind a reverse proxy (nginx / Caddy) with HTTPS.

**Recommended Caddy config:**

```
mail.yourdomain.com {
    reverse_proxy localhost:3001
}
```

Caddy handles TLS automatically via Let's Encrypt.

> See [docker.md](docker.md) for a containerised production deployment.
