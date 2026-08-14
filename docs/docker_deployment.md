# Docker Deployment

Forecast Magic is packaged as one self-contained HTTP application container. It stores configuration and Fund Allocation state in SQLite at `/data/app.db`. It does not require Postgres, NGINX, Certbot, or any other container to run.

Two supported deployment patterns are provided:

1. Standalone local HTTP on `http://localhost:3000`.
2. A dedicated Docker server where Forecast Magic joins an existing shared NGINX network and NGINX owns HTTPS.

## Prepare The Environment

Clone the repository and create the local environment file:

```bash
git clone https://github.com/pvols79/cashflow-app-api-v2.git
cd cashflow-app-api-v2
cp .env.example .env
```

Generate independent secrets:

```bash
openssl rand -hex 32
openssl rand -hex 32
```

Put the first value in `SESSION_SECRET` and the second in `REPORTING_API_TOKEN`. Set a strong `ADMIN_PASSWORD`. `LUNCH_MONEY_API_KEY` may remain blank and be entered through the Admin UI after startup.

Never commit `.env`. It is excluded by `.gitignore` and from the Docker build context.

## Standalone Local Install

The default `docker-compose.yml` builds the image, creates a persistent named volume, and publishes the application only on the local machine:

```bash
docker compose config
docker compose up --build -d
docker compose ps
```

Open:

```text
http://localhost:3000
```

Confirm the health endpoint:

```bash
curl http://localhost:3000/api/health
```

To use another host port, set `FORECAST_MAGIC_PORT` in `.env`. To intentionally expose the direct HTTP port to a trusted LAN, set:

```text
FORECAST_MAGIC_BIND_ADDRESS=0.0.0.0
```

Loopback is the safer default. A host port without an explicit host address is otherwise published on all interfaces by Docker.

## Shared NGINX Docker Server

The example at `deploy/docker-compose.shared-nginx.yml` is intended for a server that already has a reverse proxy. It differs from the standalone file in one important way: Forecast Magic joins an externally managed Docker network and does not publish port 3000 on the host.

### 1. Identify The Proxy Network

List the Docker networks and find the one used by NGINX:

```bash
docker network ls
```

Set its exact name in `.env`:

```text
PROXY_NETWORK=your-existing-proxy-network
```

Both the NGINX container and Forecast Magic must be attached to this network. Docker service discovery then lets NGINX reach the app by the stable hostname `forecast-magic`, without relying on a container IP address.

If a shared network does not already exist, create it once:

```bash
docker network create proxy
```

### 2. Validate And Start Forecast Magic

From the repository root:

```bash
docker compose --env-file .env -f deploy/docker-compose.shared-nginx.yml config
docker compose --env-file .env -f deploy/docker-compose.shared-nginx.yml up --build -d
docker compose --env-file .env -f deploy/docker-compose.shared-nginx.yml ps
```

The service has `expose: 3000` for container-to-container documentation, but no `ports` entry. NGINX is the only intended entry point.

If Forecast Magic is being copied directly into an existing shared Compose file instead, copy the `forecast-magic` service, named volume, and external network declarations from the example. Adjust the build context to the repository's location on that server.

### 3. Verify Internal Connectivity

From the NGINX container, request:

```text
http://forecast-magic:3000/api/health
```

The exact command depends on which HTTP client exists in that image. For example:

```bash
docker exec your-nginx-container wget -qO- http://forecast-magic:3000/api/health
```

The expected response is:

```json
{"status":"ok"}
```

## NGINX Configuration

Examples are supplied in `deploy/nginx`:

- `forecast-magic-http.conf.example` bootstraps HTTP and the ACME challenge.
- `forecast-magic-https.conf.example` redirects normal HTTP traffic to HTTPS and proxies HTTPS to Forecast Magic.

Replace every `forecast-magic.example.com` with the real hostname. The important proxy settings are:

```nginx
proxy_pass http://forecast-magic:3000;
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
```

Forecast Magic trusts one reverse-proxy hop. `X-Forwarded-Proto` allows its signed Admin session cookie to be marked secure when the browser uses HTTPS.

Test the NGINX configuration before reloading it:

```bash
docker exec your-nginx-container nginx -t
docker exec your-nginx-container nginx -s reload
```

## Let's Encrypt Certificates

TLS is an NGINX infrastructure concern, so Forecast Magic does not bundle Certbot. Use the Certbot service and certificate volumes already maintained by the server.

### HTTP-01 With Webroot

Use this path when all of the following are true:

- The hostname is in public DNS and resolves to this server.
- Inbound TCP port 80 reaches NGINX.
- NGINX and Certbot share the same ACME webroot, shown as `/var/www/certbot` in the examples.
- NGINX can read the same `/etc/letsencrypt` certificate storage that Certbot writes.

Install the HTTP bootstrap configuration first. Then run the equivalent of this command through the existing Certbot service:

```bash
docker compose run --rm certbot certonly --webroot \
  --webroot-path /var/www/certbot \
  --email you@example.com \
  --agree-tos \
  -d forecast-magic.example.com
```

After the certificate exists, install the HTTPS example, test NGINX, and reload it. The certificate paths in the example are:

```text
/etc/letsencrypt/live/forecast-magic.example.com/fullchain.pem
/etc/letsencrypt/live/forecast-magic.example.com/privkey.pem
```

Test renewal before relying on it:

```bash
docker compose run --rm certbot renew --dry-run
```

Use the renewal scheduler already associated with the shared Certbot service. Reload NGINX after successful renewal so it begins serving the renewed certificate.

### DNS-01 For Private Servers

Use DNS-01 when port 80 cannot be reached from the public Internet, when the service is available only over VPN, or when a wildcard certificate is required. The hostname still needs to belong to a real domain you control, but the Docker server itself does not need to be publicly reachable.

Prefer a Certbot DNS plugin for the DNS provider so renewal can be automated. A manual DNS challenge without authentication hooks requires manual renewal and is not a good unattended server setup.

## n8n Access

n8n can call the HTTPS endpoint through NGINX:

```text
GET https://forecast-magic.example.com/api/reporting/daily-highlight?accountKey=plaid:123
Authorization: Bearer <REPORTING_API_TOKEN>
```

Do not place the Lunch Money API key in n8n. The separate reporting token limits automation access to the read-only reporting contract.

## Updating

Back up the SQLite volume, pull the desired code revision, then rebuild only Forecast Magic:

```bash
git pull
docker compose --env-file .env -f deploy/docker-compose.shared-nginx.yml up --build -d
```

Startup runs pending database migrations automatically. It does not require changes to the shared NGINX, Certbot, or Postgres services unless the proxy configuration itself changed.

## Backup And Restore

The only application data that must be preserved is the Docker volume mounted at `/data`. Stop Forecast Magic before taking a raw filesystem copy so the SQLite database and its write-ahead log are consistent.

Find the exact volume name with:

```bash
docker volume ls
```

Back up and restore that volume using the server's established Docker-volume backup process. Keep `.env` in the server's encrypted configuration backup as well; changing `SESSION_SECRET` signs Admin users out, while losing the SQLite volume loses server-stored settings and Fund Allocations.

## Deployment Boundary

Forecast Magic owns:

- The application image
- Its Node HTTP server
- SQLite in `/data`
- Database migrations
- The `/api/health` endpoint

The hosting environment optionally owns:

- Public DNS
- NGINX
- Ports 80 and 443
- Let's Encrypt and renewal scheduling
- VPN or LAN access policy
- Volume and `.env` backups

This boundary keeps the same application package usable on a laptop, a simple Docker host, or an established reverse-proxy server.

## Reference Documentation

- [Docker Compose networking and external networks](https://docs.docker.com/compose/how-tos/networking/)
- [Docker Compose network reference](https://docs.docker.com/reference/compose-file/networks/)
- [NGINX proxy module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)
- [Certbot webroot and renewal documentation](https://eff-certbot.readthedocs.io/en/stable/using.html)
- [Let's Encrypt challenge types](https://letsencrypt.org/docs/challenge-types/)
