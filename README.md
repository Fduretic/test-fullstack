# Fullstack with storage

A small photo album app: create albums, upload photos, browse a full-size viewer, and edit or delete your collections. English UI, responsive retro styling, no accounts or external services.

## Stack and layout

- `apps/web`: Angular **21.2.25 LTS**, served by **Nginx 1.28.3**.
- `apps/api`: NestJS **12.1.2**, Node **22.22.3**, TypeORM **0.3.31**, Sharp **0.35.5**.
- PostgreSQL **17.9** at `database:5432`; database/user are both `app`.
- npm workspaces with exact dependencies and `package-lock.json`. Angular's build tool uses a pinned Piscina **5.3.2** security override.

Angular support: [release schedule](https://angular.dev/reference/releases). NestJS requirements: [migration guide](https://docs.nestjs.com/migration-guide).

## Run the production images locally

Requires Node 22.22.3, npm 10.9.8 and Docker with Compose v2 or newer.

```sh
npm ci
npm run build
npm test
docker compose build
npm run test:deployment
```

The deployment test prints a working localhost URL (including `/gallery/`) and leaves two isolated preview installations running. Their URLs are also in `.local/runtime.json`. Open the `albumchecka.base` URL to use the app. Tests remove the albums they create.

The harness generates a local-only override, random test credentials, and separate upload mounts under two Compose project names. It grants the API's numeric user write access to those test mounts. All generated material is ignored under `.local/`. A plain `docker compose up` is **not** a local storage setup: production Compose intentionally delegates the upload mount to VPS Admin.

Run browser tests after the deployment test:

```sh
PLAYWRIGHT_BROWSERS_PATH=.local/browsers npx playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=.local/browsers npm run test:e2e
```

Stop the previews while preserving their data:

```sh
docker compose -p albumchecka -f compose.yaml -f .local/compose.test.yaml down
docker compose -p albumcheckb -f compose.yaml -f .local/compose.test.yaml down
```

Add `--volumes` only to intentionally delete those local test installations. Restart them with `npm run test:deployment`; it reuses their local credentials and checks existing migrations safely.

## VPS Admin deployment

Only `web:80` is public. Web proxies `/api` internally; the browser never needs an installation domain or an API hostname. Production Compose declares no published ports, networks, host mounts, container names or routing labels.

Configure these runtime keys in VPS Admin:

| Key | Value |
| --- | --- |
| `POSTGRES_PASSWORD` | **Required secret:** a unique database password per installation. Enter it literally; no URL encoding is needed because the API uses separate connection fields. |
| `APP_BASE_PATH` | `/` by default; use `/gallery/` for a deployment at that prefix. Must match platform routing. Nested segments are supported; use letters, numbers, `_` or `-`. |
| `POSTGRES_USER` | Leave unset or `app`; must match the manifest. |
| `POSTGRES_DB` | Leave unset or `app`; must match the manifest. |
| `STORAGE_PATH` | Leave unset or `/app/uploads`; must match the manifest mount. |

1. Import this repository with root `compose.yaml` and `vps-admin.yaml`. Build both application images.
2. Configure the keys above and domain/path routing in VPS Admin. HTTPS stays under platform control.
3. VPS Admin must inject its **private persistent storage mount** at `/app/uploads` into `api`. Ensure the mounted directory is writable by **UID/GID 10001:10001** (ownership or equivalent ACLs). Dockerfile ownership cannot fix a mount. The API creates `originals/` and `thumbnails/` and performs a real write/delete probe at startup and readiness checks. Do not make the directory world-writable.
4. Start PostgreSQL and run the manifest migration command before starting the API: `node apps/api/dist/migrate.js`, inside the `api` image. The command uses an advisory lock, runs committed migrations transactionally and exits noninteractively. Running it again applies only pending migrations. It neither resets the database nor synchronizes the schema.
5. Start `api`, then `web`. Verify the domain, health probes, upload, original image and thumbnail. Repeat migrations before the API starts on subsequent upgrades; add new timestamped migration files and register them in `database.ts` for later schema changes.

The runtime image includes the migration files/tools and each probe executable. API readiness is `/api/health` on port 3000 and checks the database schema plus storage writes. Web readiness is `/health` on port 80. PostgreSQL uses `pg_isready`. Nginx refreshes Docker DNS so recreating the API does not require recreating web.

For a prefixed install the web container accepts both `/gallery/api/...` and `/api/...`: VPS Admin may preserve or remove the prefix. Angular's runtime base href remains `/gallery/`. Assets, navigation, deep links and image URLs use that base. No public build variables or secrets are required.

## Files, limits and backups

JPEG, PNG and WebP only; non-animated, up to **10 MB** and **40 megapixels** per image. The UI accepts up to **20 files per selection** and submits one file per request. Uploads are validated using their decoded content and declared MIME. Sharp processes one image at a time and produces orientation-correct thumbnails up to 480 × 480 pixels. Concurrent upload requests receive a retryable 429. Original bytes are preserved, including embedded metadata. The first remaining image is the cover.

Every file operation uses `STORAGE_PATH`; database paths are relative and generated from UUIDs. Path traversal and symlink reads are rejected. Failed uploads attempt to remove partial files. Deletions remove files before database rows; if filesystem deletion fails, the row remains and the operation can be retried (missing files are accepted on retry). A process or machine crash can still leave orphan files or partially completed deletion; the database and filesystem are not one atomic transaction. There is no background cleanup service.

**VPS Admin owns the upload mount. It is not an application Compose named volume.** PostgreSQL's project-scoped `postgres_data` volume is separate. Platform database backups do **not** contain uploaded files.

Back up the two stores as a matched pair:

1. Put the installation in maintenance and stop `web`/`api` to prevent writes.
2. Take the platform PostgreSQL backup and a separate recursive, permission-preserving backup/snapshot of that installation's entire upload mount. Label both with the same timestamp/version and keep a protected off-host copy.
3. Resume the application after both backups finish.
4. For restore, stop writers again, restore the matching database and file backup, confirm UID/GID 10001 access, run pending migrations, start the services and verify originals/thumbnails. Regularly test this restore procedure on a separate installation.

All visitors can create, change and delete albums; this is the requested unauthenticated testing app. There are no workers, scheduled tasks, integrations, analytics or external fonts.

## API

All paths are below `/api`. Album writes accept `{ "name": "…", "description": "…" }`; name is required (1–120 trimmed characters), description optional (up to 2,000 characters). UUID v4 identifiers are used throughout.

| Method / path | Behavior |
| --- | --- |
| `GET /health` | Readiness (200 or 503). |
| `GET /albums` | Albums, photo counts and cover URLs, newest albums first. |
| `POST /albums` | Create an album (201). |
| `GET /albums/:id` | Album and photos in insertion order. |
| `PATCH /albums/:id` | Replace album details. |
| `DELETE /albums/:id` | Delete album and all its images (204). |
| `POST /albums/:id/photos` | Single multipart `file` upload (201). |
| `DELETE /photos/:id` | Remove a photo (204). |
| `GET /photos/:id/original` | Original image bytes. |
| `GET /photos/:id/thumbnail` | Generated WebP thumbnail. |

Returned image URLs are relative to the application base (`api/photos/...`); do not resolve them relative to the current Angular route. `assetUrl` in the frontend handles this.

See [VALIDATION.md](VALIDATION.md) for the checks actually performed and the remaining platform validation boundary.
