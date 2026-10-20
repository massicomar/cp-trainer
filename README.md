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

Sessions only use `ready` problems. While the bank is still all drafts, set `CONTENT_INCLUDE_DRAFTS=true` in `.env` to play them anyway (drafts show a "Draft" badge, and "No summary written yet" until someone writes one).

### Where things are

| Path                                   | What                                                                               |
| -------------------------------------- | ---------------------------------------------------------------------------------- |
| `app/services/session_selection.ts`    | subjects + tiers → matching problems, counts                                       |
| `app/services/lesson_planner.ts`       | picks a lesson's problems (round-robin, unseen first, pairs, distractor cap)       |
| `app/services/question_builder.ts`     | which layers a problem asks, and each layer's options                              |
| `app/services/answer_grader.ts`        | option → correct / overkill / wrong                                                |
| `app/services/lesson_flow.ts`          | the lesson state machine: answer, give up, skip, continue, summary                 |
| `app/middleware/player_middleware.ts`  | anonymous player from the signed `pid` cookie                                      |
| `resources/views/partials/play.edge`   | the lesson area that HTMX swaps after every action                                 |
| `app/services/problem_draft.ts`        | `/contribute`: form → problem file, with CI's checks                               |
| `app/services/content_rules.ts`        | URL allowlist + leak lint, copied from the content repo's validator (keep in sync) |
| `resources/lang/{en,es}/messages.json` | every UI string; problem content stays English                                     |

The UI is translated (English / Spanish, header switch or browser language) and has a System / Light / Dark theme switch. Both are cookies, not player data.

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
