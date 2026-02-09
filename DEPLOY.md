# Deploying the career page & Sound Arcade (arcade.devopschad.com)

## Git remote and push

The repo name comes from **this folder’s** `git remote -v` (e.g. `origin` → `https://github.com/tsmith4014/Professional-Portfolio`). If a push from Cursor/automation fails with “Authentication failed”, it’s because that environment doesn’t have your GitHub credentials (no token, no SSH agent). Push from your own terminal or IDE where you’re already logged in to GitHub; the repo URL is correct.

**Is this a git repo?** Yes. The GitHub page you see (e.g. `tsmith4014/Professional-Portfolio`) is the **remote** repo. Your local `career_webpage` folder is the **local** clone (its git root is this folder; the remote is Professional-Portfolio).

**Why does Actions show “0 workflow runs”?** That means **no runs have executed yet**, not that the workflow is missing. The workflow file lives in `.github/workflows/deploy.yml` — that path is correct. In the Actions tab, use the left sidebar: under “All workflows” you should see **CI/CD Pipeline** (the workflow). Click it to see the definition; “0 workflow runs” is the list of past runs. After you push to `main`, the first run will appear there.

### Push without triggering the workflow

The workflow runs **only when you push to the `main` branch**. To push your changes to GitHub **without** starting a deploy:

1. Create and push a different branch, e.g. `arcade` or `dev`:
   ```bash
   git checkout -b arcade
   git add .
   git commit -m "Arcade: Sound Arcade, Disco Room, deploy workflow updates"
   git push origin arcade
   ```
2. Your code is now on GitHub on the `arcade` branch; the CI/CD pipeline will **not** run.
3. When you’re ready to deploy, merge `arcade` into `main` (e.g. via a Pull Request or `git checkout main && git merge arcade && git push origin main`). That push to `main` will trigger the workflow.

---

## What gets built and pushed

- **Push to `main`** triggers GitHub Actions, which:
  1. Builds and pushes **`tsmith4014/career-page:latest`** (frontend: React SPA served by nginx).
  2. Builds and pushes **`tsmith4014/career-backend:latest`** (backend: FastAPI, Spotify OAuth, `/api/tracks`, etc.).

You do **not** need to manually build or push Docker images if the workflow runs on push to `main`. For a new tag (e.g. `v1.0.0`), you can add a tag step in the workflow or run locally:

```bash
docker build -t tsmith4014/career-page:latest .
docker push tsmith4014/career-page:latest
cd backend && docker build -t tsmith4014/career-backend:latest . && docker push tsmith4014/career-backend:latest
```

## Commits before deploy

Use clear commits so the repo and deployed version stay in sync:

- One logical change per commit (e.g. “Replace Capstone block with Sound Arcade on landing”, “Add production nginx /api proxy”).
- Push to `main` when you’re ready to deploy; the pipeline will build and push images and (if configured) deploy to Oracle.

## Production: arcade subdomain on Oracle (devopschad.com)

Assumptions: same Oracle Cloud instance, **arcade.devopschad.com** for the app.

### 1. DNS

- Add an **A** (or **CNAME**) record: **arcade.devopschad.com** → your Oracle instance’s public IP.

### 2. Reverse proxy (HTTPS) on the Oracle host

The app needs:

- **Frontend** (SPA) at `https://arcade.devopschad.com`
- **API** at `https://arcade.devopschad.com/api/...` (proxied to the backend container)

So you need a reverse proxy (nginx or Caddy) on the host that:

- Listens for **arcade.devopschad.com** (and handles TLS, e.g. Let’s Encrypt).
- Serves the SPA **or** proxies to the frontend container (port 8000).
- Proxies **/api** to the backend container (port 8001).

**Option A – Proxy to both containers**

- Host nginx/Caddy:
  - `https://arcade.devopschad.com/` → `http://127.0.0.1:8000/` (frontend container).
  - `https://arcade.devopschad.com/api` → `http://127.0.0.1:8001/api` (backend container).

Then run both containers on the host (see step 3). The **frontend** image’s nginx is already configured to proxy `/api` to `http://backend:8001` for when frontend and backend are on the same Docker network; in this setup the **host** proxy sends `/api` to 8001, so the frontend container can be built with or without the internal `/api` proxy (host proxy is enough).

**Option B – Single entry at 8000, frontend proxies /api**

- Expose only the **frontend** container (e.g. port 8000).
- Host proxy: `https://arcade.devopschad.com` → `http://127.0.0.1:8000`.
- Frontend container’s nginx proxies `/api` to the **backend** container (same Docker network, name `backend`). So you must run the backend container with `--name backend` and attach both to the same network (see below).

### 3. Run the two containers on Oracle

Create a network and run backend first, then frontend:

```bash
docker network create my_network 2>/dev/null || true

# Backend (FastAPI, port 8001) – needs env for Spotify and frontend origin
docker run -d \
  --name backend \
  --network my_network \
  -p 8001:8001 \
  -e SPOTIFY_CLIENT_ID="your_spotify_client_id" \
  -e SPOTIFY_CLIENT_SECRET="your_spotify_client_secret" \
  -e SPOTIFY_REDIRECT_URI="https://arcade.devopschad.com/api/spotify/callback" \
  -e FRONTEND_ORIGIN="https://arcade.devopschad.com" \
  tsmith4014/career-backend:latest

# Frontend (SPA + nginx, port 8000) – proxies /api to backend
docker run -d \
  --name frontend \
  --network my_network \
  -p 8000:8000 \
  tsmith4014/career-page:latest
```

If you use **host** reverse proxy (Option A), point it at `8000` (frontend) and `8001` (backend) as above. If you use **Option B**, you can bind only 8000 on the host and have nginx in the frontend container proxy `/api` to `http://backend:8001`.

### 4. Spotify Dashboard (required for “Sign in with Spotify”)

1. [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) → your app → **Settings** → **Redirect URIs**.
2. Add: **`https://arcade.devopschad.com/api/spotify/callback`** (HTTPS, exact URL).
3. Keep **`http://127.0.0.1:5173/api/spotify/callback`** if you still use local dev.

### 5. Environment summary (production)

| Variable | Value |
|----------|--------|
| `SPOTIFY_REDIRECT_URI` | `https://arcade.devopschad.com/api/spotify/callback` |
| `FRONTEND_ORIGIN` | `https://arcade.devopschad.com` |
| Spotify Dashboard Redirect URIs | Include the production URL above |

After DNS and TLS are set, open **https://arcade.devopschad.com**; the main page and Sound Arcade link should work, and “Sign in with Spotify” will use the correct callback.

## GitHub Actions secrets (for CI/CD)

You already have: `DOCKER_HUB_TOKEN`, `DOCKER_HUB_USERNAME`, `ORACLE_HOST`, `ORACLE_USERNAME`, `ORACLE_SSH_PRIVATE_KEY`.

**Secrets you still need to add** (for the deploy job to start the backend with Spotify):

| Secret | Where to get it |
|--------|------------------|
| `SPOTIFY_CLIENT_ID` | Spotify Developer Dashboard → your app → Client ID |
| `SPOTIFY_CLIENT_SECRET` | Spotify Developer Dashboard → your app → Settings → Client secret (click “Show”) |

Add them in the repo: **Settings → Secrets and variables → Actions → New repository secret**.

The workflow builds both **career-page** and **career-backend** images, pushes them to Docker Hub, then deploys to the Oracle instance: it starts the **backend** container (with Spotify and `FRONTEND_ORIGIN` / `SPOTIFY_REDIRECT_URI` for arcade.devopschad.com) and the **frontend** container on the same Docker network.

---

## Host nginx config (in the repo, applied by deploy)

The **host** reverse-proxy config for arcade.devopschad.com lives in the repo at **`nginx/host-arcade.devopschad.com.conf`**. The GitHub Actions deploy job copies it to the Oracle instance and installs it under `/etc/nginx/sites-available/`, so you don’t have to edit nginx on the host by hand. Each deploy overwrites the host config with the repo version. You still need to **install nginx and certbot once** on the instance and run **certbot once** to get the HTTPS certificate (see below). After that, pipeline deploys keep the nginx config in sync.

---

## On the Oracle instance: one-time nginx + Let’s Encrypt (HTTPS)

After the A record for **arcade.devopschad.com** points at your instance (e.g. via Cloudflare), do the following **once** on the instance (SSH in with `ORACLE_USERNAME`@`ORACLE_HOST`).

### 1. Install nginx and certbot

```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx
```

### 2. Get the certificate (HTTP first)

Certbot will need nginx to be serving something for `arcade.devopschad.com` so the HTTP-01 challenge works. Create a simple server block first:

```bash
sudo nano /etc/nginx/sites-available/arcade.devopschad.com
```

Paste (replace `YOUR_ORACLE_PUBLIC_IP` if you use IP in server_name, or leave as below if DNS already resolves):

```nginx
server {
    listen 80;
    server_name arcade.devopschad.com;
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    location /api {
        proxy_pass http://127.0.0.1:8001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable and reload:

```bash
sudo ln -sf /etc/nginx/sites-available/arcade.devopschad.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Ensure **ports 80 and 443** are open (Oracle Cloud security list / firewall).

### 3. Run certbot to get HTTPS

```bash
sudo certbot --nginx -d arcade.devopschad.com
```

Follow the prompts (email, agree to terms). Certbot will adjust the nginx config to listen on 443 and use the certificate. Reload nginx if it doesn’t do it automatically.

### 4. Optional: auto-renewal

Certbot installs a cron/systemd timer. Test renewal with:

```bash
sudo certbot renew --dry-run
```

### 5. Run the app (if not already deployed by GitHub Actions)

If you deploy manually or the first time before the workflow runs:

```bash
docker network create my_network 2>/dev/null || true
docker pull tsmith4014/career-backend:latest
docker pull tsmith4014/career-page:latest
# Then run backend and frontend as in “Run the two containers” above (or let the deploy job do it).
```

After this, **https://arcade.devopschad.com** should serve the app over HTTPS.
