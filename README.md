# cp-trainer (app)

AdonisJS 7 app for CP Trainer: Edge views + HTMX, SQLite through Lucid. The problem bank lives in the sibling repo `cp-trainer-content`. The plan is `../cp-trainer-plan.md`; decisions made along the way are in `../DECISIONS.md`.

## Run it locally

Needs Node 24 or newer.

```bash
npm install
cp .env.example .env && node ace generate:key   # first time only
node ace migration:run
node ace content:sync                            # reads ../cp-trainer-content
npm run dev                                      # http://localhost:3333
```

The dev database is `tmp/db.sqlite3`. Delete it to start over.

| Command                                                       | What it does                                                       |
| ------------------------------------------------------------- | ------------------------------------------------------------------ |
| `npm run dev`                                                 | dev server with hot reload                                         |
| `node ace content:validate`                                   | check the content repo, no database writes (`--dir=…` for another) |
| `node ace content:sync`                                       | validate, then copy the content into SQLite (all or nothing)       |
| `npm test`                                                    | Japa tests (uses `tmp/test.sqlite3` and `tests/fixtures/content`)  |
| `npm run fixtures:schema`                                     | copy the content repo's JSON Schemas into the test fixtures        |
| `npm run typecheck` / `npm run lint` / `npm run format:check` | what CI runs                                                       |
| `npm run build`                                               | production build into `build/`                                     |

The content commands read `CONTENT_DIR`, which defaults to the sibling checkout `../cp-trainer-content`. When the content repo changes its schemas, run `npm run fixtures:schema`; a test fails until you do.

## Run the production stack locally (Docker)

The same `docker-compose.yml` that runs on the VPS, plus a Caddy of its own (the `local` profile) standing in for the shared one on the VPS. Needs Docker Desktop running and ports 80/443 free.

```bash
docker network create web-network     # once per machine; the VPS already has it
cp .env.docker.example .env.docker
node ace generate:key --show          # paste the key into APP_KEY in .env.docker
docker compose --profile local up -d --build
```

Open <https://localhost>. Caddy signs the certificate with its own local CA, so the browser warns once; accept it. `curl -k https://localhost/health` should return `{"status":"ok"}`.

```bash
docker compose logs -f app                 # app logs (JSON)
docker compose --profile local down        # stop; data stays in the app_data volume
docker compose --profile local down -v     # stop and delete the database too
```

Compose mounts `../cp-trainer-content` read-only at `/content`. Set `CONTENT_PATH` if your checkout lives elsewhere.

## Deploying

Push to `main` → CI passes → the Deploy workflow SSHes into the VPS and runs `scripts/deploy.sh`. One-time VPS and GitHub setup: [docs/deploy.md](docs/deploy.md).
