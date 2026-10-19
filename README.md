# cp-trainer (app)

AdonisJS 7 app for CP Trainer: Edge views + HTMX, SQLite through Lucid. The problem bank lives in the sibling repo `cp-trainer-content`. The plan is `../cp-trainer-plan.md`; decisions made along the way are in `../DECISIONS.md`.

## Run it locally

Needs Node 24 or newer.

```bash
npm install
cp .env.example .env && node ace generate:key   # first time only
npm run dev                                      # http://localhost:3333
```

The dev database is `tmp/db.sqlite3`. Delete it to start over.

| Command                                                       | What it does                         |
| ------------------------------------------------------------- | ------------------------------------ |
| `npm run dev`                                                 | dev server with hot reload           |
| `npm test`                                                    | Japa tests (uses `tmp/test.sqlite3`) |
| `npm run typecheck` / `npm run lint` / `npm run format:check` | what CI runs                         |
| `npm run build`                                               | production build into `build/`       |

## Run the production stack locally (Docker)

The same `docker-compose.yml` that runs on the VPS (Caddy + app, SQLite on a volume), so you can test the real thing before deploying. Needs Docker Desktop running and ports 80/443 free.

```bash
cp .env.docker.example .env.docker
node ace generate:key --show          # paste the key into APP_KEY in .env.docker
docker compose up -d --build
```

Open <https://localhost>. Caddy signs the certificate with its own local CA, so the browser warns once; accept it. `curl -k https://localhost/health` should return `{"status":"ok"}`.

```bash
docker compose logs -f app            # app logs (JSON)
docker compose down                   # stop; data stays in the app_data volume
docker compose down -v                # stop and delete the database too
```

Compose mounts `../cp-trainer-content` read-only at `/content`. Set `CONTENT_PATH` if your checkout lives elsewhere.

## Deploying

Push to `main` → CI passes → the Deploy workflow SSHes into the VPS and runs `scripts/deploy.sh`. One-time VPS and GitHub setup: [docs/deploy.md](docs/deploy.md).
