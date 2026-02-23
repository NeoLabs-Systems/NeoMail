<div align="center">

```
███╗   ███╗ █████╗ ██╗██╗     ███╗   ██╗███████╗ ██████╗
████╗ ████║██╔══██╗██║██║     ████╗  ██║██╔════╝██╔═══██╗
██╔████╔██║███████║██║██║     ██╔██╗ ██║█████╗  ██║   ██║
██║╚██╔╝██║██╔══██║██║██║     ██║╚██╗██║██╔══╝  ██║   ██║
██║ ╚═╝ ██║██║  ██║██║███████╗██║ ╚████║███████╗╚██████╔╝
╚═╝     ╚═╝╚═╝  ╚═╝╚═╝╚══════╝╚═╝  ╚═══╝╚══════╝ ╚═════╝
```

**Your email. Your server. Your rules.**

A beautiful, self-hosted email client with AI superpowers — runs entirely on your own machine.

[![Node](https://img.shields.io/badge/Node.js-18+-5fa04e?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![SQLite](https://img.shields.io/badge/SQLite-WAL-003b57?style=flat-square&logo=sqlite&logoColor=white)](https://sqlite.org)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ed?style=flat-square&logo=docker&logoColor=white)](docs/docker.md)
[![License](https://img.shields.io/badge/License-MIT-a855f7?style=flat-square)](LICENSE)

</div>

---

## What is it?

MailNeo is a **self-hosted web email client** — like Gmail, but running on your own hardware. Connect any IMAP/SMTP account (Gmail, Outlook, iCloud, anything), and get a fast, private, AI-enhanced inbox.

No cloud. No tracking. No ads. Just your email.

---

## Features

| | |
|---|---|
| 📥 **Unified inbox** | Multiple accounts, one clean interface |
| 🤖 **AI assistant** | Chat with your emails — ask anything, the AI finds it |
| 🔍 **Full-text search** | FTS5-indexed, instant results with operators (`from:` `subject:` `after:`) |
| 🏷️ **Auto-labelling** | AI reads and categorises incoming mail automatically |
| 🧵 **Thread view** | Conversations grouped by subject |
| 📎 **File preview** | Images and PDFs open inline, no downloads |
| 🔔 **Smart notifications** | AI decides what's worth a push notification |
| ✍️ **AI compose** | Describe what you want to write, AI drafts it |
| 💬 **Reply-All, BCC, Drafts** | Full compose feature set with autosave |
| 📱 **PWA** | Install on iPhone/Android, works offline |
| 🐳 **Docker ready** | One command deploy |

---

## Quick Start

**Prerequisites:** Node.js 18+ (or Docker)

```bash
# 1. Clone and install
git clone https://github.com/you/mailneo && cd mailneo
npm install

# 2. Generate config (creates .env with secure random keys)
npm run setup

# 3. Start
npm start
```

Open **http://localhost:3001** → create an account → add your email.

> Using Docker instead? → [docs/docker.md](docs/docker.md)  
> Full setup guide → [docs/setup.md](docs/setup.md)

---

## AI Features

Add your OpenAI API key to `.env` to unlock:

- **Ask AI** in the sidebar — chat with a RAG-powered assistant that searches all your emails
- Automatic email labelling on sync
- AI-generated compose drafts
- Smart notification filtering
- Email summarisation

```env
OPENAI_API_KEY=sk-...
```

No key? Everything else still works perfectly.

---

## Screenshots

> *Dark mode — the only mode that matters.*

```
┌─────────────────────────────────────────────────┐
│  ✉ MailNeo        [search…]              [⚙]   │
├──────────┬──────────────────────┬────────────────┤
│ Inbox 3  │ Alice — Project upd… │ Hello team,    │
│ Starred  │ Bob   — Lunch Fri?   │ Here's the     │
│ Sent     │ Carol — RE: Invoice  │ latest update  │
│ All Mail │ Dave  — Welcome!     │ on the project │
├──────────│                      │                │
│ Ask AI   │                      │ [Reply] [⋯]   │
│ Settings │                      │                │
└──────────┴──────────────────────┴────────────────┘
```

---

<div align="center">

Made with ❤️ by [Neo](https://github.com/neooriginal)

</div>

