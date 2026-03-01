# Docker Deployment

The fastest way to run NeoMail in production.

---

## Quick Start

```bash
# 1. Copy and edit the environment file
cp .env.example .env
# Edit .env — set ENCRYPTION_KEY, SESSION_SECRET, and optionally OPENAI_API_KEY
# (or just: npm run setup)

# 2. Start
docker compose up -d
```

NeoMail is now running at **http://localhost:3001**.

---

## What's Included

The included `docker-compose.yml` gives you:

- NeoMail server on port `3001`
- Persistent data volume at `./data` (SQLite database + attachments)
- Automatic container restart on crash or reboot

---

## Configuration

Edit `.env` before starting. The container reads this file directly.

```env
PORT=3001
ENCRYPTION_KEY=...   # generate with: npm run setup
SESSION_SECRET=...
OPENAI_API_KEY=sk-... # optional
ALLOW_REGISTRATION=false
NODE_ENV=production
```

> See [configuration.md](configuration.md) for all options.

---

## Behind a Reverse Proxy (HTTPS)

### Caddy (recommended — auto TLS)

```
mail.yourdomain.com {
    reverse_proxy mailneo:3001
}
```

Add Caddy to the same Docker network as NeoMail in `docker-compose.yml`:

```yaml
networks:
  - proxy

# ...existing mailneo service...
networks:
  proxy:
    external: true
```

### nginx

```nginx
server {
    listen 443 ssl;
    server_name mail.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/mail.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mail.yourdomain.com/privkey.pem;

    location / {
        proxy_pass         http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## Useful Commands

```bash
# View logs
docker compose logs -f

# Stop
docker compose down

# Restart
docker compose restart

# Rebuild after a git pull
docker compose up -d --build

# Access the container shell
docker compose exec mailneo sh
```

---

## Data & Backups

All data lives in `./data/mailneo.db` (SQLite).

```bash
# Backup
cp data/mailneo.db data/mailneo.db.backup

# Restore
cp data/mailneo.db.backup data/mailneo.db
docker compose restart
```

For automated backups, add a cron job:

```cron
0 3 * * * cd /path/to/mailneo && cp data/mailneo.db backups/mailneo-$(date +\%F).db
```
