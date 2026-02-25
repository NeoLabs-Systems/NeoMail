# Configuration Reference

All configuration lives in the `.env` file in the project root.  
Run `npm run setup` to generate one automatically, or copy `.env.example`.

---

## Server

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | Port the server listens on |
| `NODE_ENV` | `development` | Set to `production` for a live server |

---

## Security

These are **required**. Generate them with `npm run setup`.

| Variable | Description |
|---|---|
| `ENCRYPTION_KEY` | 64-char hex key used to encrypt stored IMAP/SMTP passwords |
| `SESSION_SECRET` | 64-char hex key used to sign session cookies |

> **Never commit these to git.** `.env` is in `.gitignore` by default.

---

## Registration

| Variable | Default | Description |
|---|---|---|
| `ALLOW_REGISTRATION` | `true` | Set to `false` to lock signups. Existing users are unaffected. |

Use `false` once you've created your account on a private server.

---

## AI Features

| Variable | Default | Description |
|---|---|---|
| `OPENAI_API_KEY` | *(empty)* | Your OpenAI key. Leave blank to disable AI entirely. |
| `OPENAI_MODEL` | `gpt-4o-mini` | Override the model. Use `gpt-4o` for higher quality. |

**What the AI key unlocks:**

- 🤖 **Ask AI** — RAG-powered chat that searches your emails using FTS5 and answers questions
- 🏷️ **Auto-labelling** — emails are categorised on sync
- ✍️ **AI Compose** — generate draft emails from a short instruction
- 🔔 **Smart notifications** — only important emails trigger a push

**Cost:** The default `gpt-4o-mini` model is very cheap (~$0.001 per email interaction). For a typical inbox this runs well under $1/month.

---

## Full Example

```env
# ─── Server ───────────────────────────────────────────
PORT=3001
NODE_ENV=production

# ─── Security (REQUIRED) ──────────────────────────────
ENCRYPTION_KEY=your-64-char-hex-key-here
SESSION_SECRET=your-64-char-session-secret-here

# ─── Registration ─────────────────────────────────────
# Set to 'false' to prevent new users from signing up
ALLOW_REGISTRATION=true

# ─── OpenAI (Optional – enables AI features) ──────────
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini

# ─── Node Environment ─────────────────────────────────
NODE_ENV=development
```
