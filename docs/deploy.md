# Deploying to the VPS

One-time setup. After this, every push to `main` that passes CI deploys itself.

The VPS layout, next to your other sites:

```
/root/sites/
├── caddy/                # shared Caddy: owns 80/443, proxies to containers on web-network
└── cp-trainer/
    ├── cp-trainer/           # this repo (DEPLOY_PATH)
    └── cp-trainer-content/   # the content repo; compose finds it as ../cp-trainer-content
```

Like your portfolio and matchup, cp-trainer runs only its app container (`cp-trainer`, port 3333) on the external `web-network`, and the shared Caddy proxies to it. This repo's own Caddy is only for local testing (`--profile local`) and never starts on the VPS.

The domain below is `cp.massi.com.ar`; use any subdomain you like, as long as `APP_URL` and the Caddy block match. `VPS_HOST` is the IP of the server.

## 1. DNS and the shared Caddy

Add an `A` record (and `AAAA` if the VPS has IPv6) for `cp.massi.com.ar` pointing at the VPS, like `matchup.massi.com.ar`. Skip this if you have a wildcard record.

Then add a site block to `~/sites/caddy/Caddyfile`:

```
cp.massi.com.ar {
	encode zstd gzip
	reverse_proxy cp-trainer:3333
}
```

Reload Caddy after step 3, once the `cp-trainer` container exists (before that, Caddy would answer 502 for this site; your other sites are unaffected either way):

```bash
docker exec caddy caddy reload --config /etc/caddy/Caddyfile
```

If the reload doesn't pick up the change, restart instead: `cd ~/sites/caddy && docker compose restart caddy`. Some editors save by replacing the file, and a container that mounts a single file keeps seeing the old one until it restarts.

## 2. Get both repos

As root. Both repos are public, so plain HTTPS clones work and no deploy keys are needed.

```bash
mkdir -p ~/sites/cp-trainer && cd ~/sites/cp-trainer
git clone https://github.com/massicomar/cp-trainer.git
git clone https://github.com/massicomar/cp-trainer-content.git
```

If a folder already exists from a `git init` + `git pull`, either delete it and clone, or fix it in place with `git checkout -B main origin/main`.

If you make a repo private later, `git pull` will need credentials: add a read-only deploy key under the repo's **Settings → Deploy keys** and switch the remote to SSH.

## 3. Configure and start

```bash
cd ~/sites/cp-trainer/cp-trainer
cp .env.docker.example .env.docker
# edit .env.docker:
#   APP_URL=https://cp.massi.com.ar
#   APP_KEY=<output of: openssl rand -base64 32>
docker compose up -d --build                    # app only; no --profile on the VPS
docker compose ps                               # wait for "healthy"
docker exec caddy caddy reload --config /etc/caddy/Caddyfile
curl -fsS https://cp.massi.com.ar/health        # {"status":"ok"}
```

The first request can take a few seconds while the shared Caddy gets the certificate. The image is built on the VPS; `npm ci` + the Vite build need roughly 1 GB of free RAM, which this box has.

## 4. GitHub Actions → VPS (app)

On your own machine, make a key pair just for Actions:

```bash
ssh-keygen -t ed25519 -N '' -C 'github-actions-deploy' -f cp-trainer-deploy
ssh-keyscan -t ed25519 VPS_HOST          # copy this line for DEPLOY_KNOWN_HOSTS
```

On the VPS, append the public key to `/root/.ssh/authorized_keys`, locked to the deploy script. The workflows log in as root, so this lock matters: with it, the key can run that one script and nothing else.

```
command="/root/sites/cp-trainer/cp-trainer/scripts/deploy.sh",restrict ssh-ed25519 AAAA… github-actions-deploy
```

In the app repo on GitHub, **Settings → Secrets and variables → Actions**:

| Name                 | Kind     | Value                                                           |
| -------------------- | -------- | --------------------------------------------------------------- |
| `DEPLOY_HOST`        | secret   | `VPS_HOST`                                                      |
| `DEPLOY_USER`        | secret   | `root`                                                          |
| `DEPLOY_SSH_KEY`     | secret   | contents of `cp-trainer-deploy` (the private key)               |
| `DEPLOY_KNOWN_HOSTS` | secret   | the `ssh-keyscan` line                                          |
| `DEPLOY_PATH`        | variable | `/root/sites/cp-trainer/cp-trainer`                             |
| `APP_URL`            | variable | `https://cp.massi.com.ar` (the workflow checks `/health` there) |

Then delete the local private key file. To test, run **Actions → Deploy → Run workflow**.

## 5. GitHub Actions → VPS (content)

Pushes to the content repo's `main` that pass validation run `scripts/sync-content.sh` on the VPS: `git pull` of `cp-trainer-content`, then `node ace content:sync` inside the running app. No rebuild, no restart.

Use a **second** key pair, so each key can only run its own script:

```bash
ssh-keygen -t ed25519 -N '' -C 'github-actions-content' -f cp-trainer-content-deploy
```

On the VPS, append to `/root/.ssh/authorized_keys`:

```
command="/root/sites/cp-trainer/cp-trainer/scripts/sync-content.sh",restrict ssh-ed25519 AAAA… github-actions-content
```

In the **content** repo on GitHub, add the secrets `DEPLOY_HOST`, `DEPLOY_USER` and `DEPLOY_KNOWN_HOSTS` with the same values as the app repo, and `DEPLOY_SSH_KEY` with the private key `cp-trainer-content-deploy`. Also add the variable `DEPLOY_PATH` with the same value as the app repo (the app checkout, where the script lives). Delete the local private key, then test with **Actions → Deploy content → Run workflow**.

If a sync fails validation, the workflow goes red and the database keeps the previous content. The same validation runs in the content repo's CI first, so this should only happen if the two drift apart.

## Day to day

```bash
cd ~/sites/cp-trainer/cp-trainer
docker compose ps
docker compose logs -f app
./scripts/deploy.sh                              # what the app workflow runs
./scripts/sync-content.sh                        # what the content workflow runs
docker compose exec app node ace content:sync    # re-sync without pulling
```

The container also syncs on every start. If that sync fails, the error is in `docker compose logs app` and the app starts anyway with the last good content.
