# Trusty GPS — Production Deploy Checklist

> **Execute top-to-bottom on first deploy. For subsequent deploys, jump to step 4.**

---

## 1. Server Setup (once)

```bash
# On DigitalOcean droplet — confirm Docker + compose installed
docker --version
docker compose version

# Confirm UFW rules (only 22/80/443 open)
sudo ufw status
```

## 2. SSL Certificates (once per subdomain)

```bash
# Install certbot if not present
sudo apt install -y certbot

# Issue certs (stop nginx if running on 80)
sudo certbot certonly --standalone -d api.trustygps.app
sudo certbot certonly --standalone -d admin.trustygps.app

# Verify cert paths (used by nginx.conf)
ls /etc/letsencrypt/live/api.trustygps.app/
ls /etc/letsencrypt/live/admin.trustygps.app/
```

> **Cloudflare SSL**: Set SSL mode to **Full (Strict)** in Cloudflare dashboard.
> Origin cert from Let's Encrypt must be present on the droplet.

## 3. Environment File (once)

```bash
# On the server, in /opt/trusty-gps or wherever you deploy
cp .env.prod.example .env.prod
nano .env.prod
# Fill in: POSTGRES_PASSWORD, JWT_SECRET, DEFAULT_ADMIN_PASSWORD, ORS_API_KEY
```

> ⚠️ `.env.prod` must NOT be committed to git. Verify `.gitignore` includes `*.prod`.

## 4. Deploy

```bash
# Pull latest code
git pull origin main
git submodule update --init --recursive

# IMPORTANT: If first deploy without migration files, change backend command in
# docker-compose.prod.yml from:
#   npx prisma migrate deploy && node src/server.js
# to:
#   npx prisma db push && node src/server.js
# Then revert after first run.

# Build and start all services
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build

# Watch logs during startup
docker compose -f docker-compose.prod.yml logs -f
```

## 5. Smoke Tests — Run in order

### 5.1 Health
```bash
curl https://api.trustygps.app/health
# Expected: {"status":"ok","db":"ok","redis":"ok",...}
```

### 5.2 Login
```bash
curl -s -X POST https://api.trustygps.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"YOUR_ADMIN_PASSWORD"}' | jq .
# Expected: {"success":true,"token":"eyJ..."}
```
> Save the token as TOKEN for subsequent requests.

### 5.3 Enrollment + QR
```bash
curl -s -X POST https://api.trustygps.app/api/devices/enroll \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Device"}' | jq .
# Expected: {"enrollmentCode":"...","qrPayload":"..."}
```

### 5.4 Android — Activate via QR
1. Open Android app → scan QR
2. Device calls `POST /api/devices/activate` with the enrollment code
3. Expected response: `{"success":true,"deviceId":"...","token":"..."}`

### 5.5 Android — WebSocket
1. Android connects to `wss://api.trustygps.app/ws`
2. Check backend logs: `✅ Device <id> connected via WebSocket`
3. Dashboard shows device as **ONLINE**

### 5.6 Stream
1. In dashboard: assign a route to the device → click **Start Stream**
2. Verify: location marker moves on map
3. Verify: PONG responses in Android logs every 30s

### 5.7 Rate Limit
```bash
# Run 11 rapid login attempts — 11th must return 429
for i in {1..11}; do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST https://api.trustygps.app/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"username":"wrong","password":"wrong"}'
done
# Expected last line: 429
```

### 5.8 Server Restart Resilience
```bash
docker compose -f docker-compose.prod.yml restart backend
# Wait ~10s for healthcheck to pass
# Android should reconnect automatically
# Verify: no orphaned stream:* keys left (backend logs: "Cleaned N orphaned stream keys")
```

## 6. Verify Security (quick scan)

```bash
# Postgres NOT accessible from outside
nc -zv <droplet-ip> 5432  # Must FAIL (connection refused)

# Redis NOT accessible from outside  
nc -zv <droplet-ip> 6379  # Must FAIL (connection refused)

# Swagger NOT accessible in prod
curl -s https://api.trustygps.app/docs  # Must return 404 JSON, NOT Swagger HTML
curl -s https://api.trustygps.app/      # Must return JSON info, NOT Swagger HTML
```

## 7. Post-Deploy — Agenda para próxima semana

- [ ] `prisma migrate baseline` si se usó `db push` en primer deploy
- [ ] Renovación automática de certs (`certbot renew --dry-run`)
- [ ] Recovery de streams en restart (actualmente se limpian al boot)
- [ ] Agregar tests unitarios
- [ ] Paginación en `/api/devices` y `/api/routes`
