# Deploying to the VPS

One-time setup. After this, every push to `main` that passes CI deploys itself.

Placeholders: `cp.yourdomain.com` (your domain), `YOU` (your GitHub user), `VPS_IP`.

## 1. DNS and firewall

- Add an `A` record (and `AAAA` if the VPS has IPv6) for `cp.yourdomain.com` pointing at the VPS.
- Allow inbound TCP 22, 80, 443 and UDP 443. Caddy needs 80 for the Let's Encrypt challenge.

## 2. Docker and a deploy user

Install Docker Engine with the compose plugin: <https://docs.docker.com/engine/install/>. Then:

```bash
sudo adduser --disabled-password --gecos '' deploy
sudo usermod -aG docker deploy
sudo install -d -o deploy -g deploy /srv/cp-trainer /srv/cp-trainer-content
```

Membership in the `docker` group is effectively root on that machine, so keep this user's SSH keys restricted (step 5).

## 3. Let the VPS pull from GitHub

Skip this step if both repos are public (clone over HTTPS instead).

GitHub only lets a deploy key belong to one repo, so make one per repo, as `deploy`:

```bash
sudo -iu deploy
ssh-keygen -t ed25519 -N '' -f ~/.ssh/github_app
ssh-keygen -t ed25519 -N '' -f ~/.ssh/github_content
cat >> ~/.ssh/config <<'EOF'
Host github-app
  HostName github.com
  IdentityFile ~/.ssh/github_app
Host github-content
  HostName github.com
  IdentityFile ~/.ssh/github_content
EOF
cat ~/.ssh/github_app.pub ~/.ssh/github_content.pub
```

Add each public key to its repo under **Settings → Deploy keys** (read-only).

## 4. Clone, configure, start

Still as `deploy`:

```bash
git clone git@github-app:YOU/cp-trainer.git /srv/cp-trainer
git clone git@github-content:YOU/cp-trainer-content.git /srv/cp-trainer-content

cd /srv/cp-trainer
cp .env.docker.example .env.docker
# edit .env.docker:
#   APP_URL=https://cp.yourdomain.com
#   APP_KEY=<output of: openssl rand -base64 32>
docker compose up -d --build
curl -fsS https://cp.yourdomain.com/health      # {"status":"ok"}
```

The first start can take a minute while Caddy gets the certificate. The image is built on the VPS, so `npm ci` + the Vite build need roughly 1 GB of free RAM; on a smaller box, add swap.

## 5. GitHub Actions → VPS

On your own machine, make a key pair just for Actions:

```bash
ssh-keygen -t ed25519 -N '' -C 'github-actions-deploy' -f cp-trainer-deploy
ssh-keyscan -t ed25519 VPS_IP          # copy this line for DEPLOY_KNOWN_HOSTS
```

On the VPS, append the public key to `/home/deploy/.ssh/authorized_keys`, locked to the deploy script:

```
command="/srv/cp-trainer/scripts/deploy.sh",restrict ssh-ed25519 AAAA… github-actions-deploy
```

In the app repo on GitHub, **Settings → Secrets and variables → Actions**:

| Name                 | Kind     | Value                                                             |
| -------------------- | -------- | ----------------------------------------------------------------- |
| `DEPLOY_HOST`        | secret   | `VPS_IP` or hostname                                              |
| `DEPLOY_USER`        | secret   | `deploy`                                                          |
| `DEPLOY_SSH_KEY`     | secret   | contents of `cp-trainer-deploy` (the private key)                 |
| `DEPLOY_KNOWN_HOSTS` | secret   | the `ssh-keyscan` line                                            |
| `APP_URL`            | variable | `https://cp.yourdomain.com` (the workflow checks `/health` there) |

Then delete the local private key file. To test, run **Actions → Deploy → Run workflow**.

## Day to day

```bash
cd /srv/cp-trainer
docker compose ps
docker compose logs -f app
./scripts/deploy.sh          # same as what the workflow runs
```

Content deploys (pull the content repo + `content:sync`) are added in M1.
