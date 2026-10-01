# Validation record

Executed on **2026-10-01** in this project directory. No VPS Admin source repository, account or deployment environment was used.

## Passed

| Check | Actual result |
| --- | --- |
| `npm run build` | NestJS TypeScript build and Angular production build passed. Frontend initial bundle: 320.20 kB raw, approximately 84.96 kB transferred. |
| `npm run typecheck` | API typecheck and Angular development compilation passed. |
| `npm test` | 3 contract tests passed: permitted Compose keys, manifest/storage ownership and version pinning. |
| `npm audit` | 0 reported vulnerabilities, including development dependencies, after the pinned security updates. |
| `docker compose build` | Both production images built successfully using their committed Dockerfiles and lockfile. Runtime Sharp loading and migration tooling verified by integration tests. |
| Compose/manifest | Compose configuration parsed with representative runtime values; manifest checked against the supplied baseline/allowlist. No platform-specific validator was available. |
| Initial migrations | First run on two empty PostgreSQL databases applied the initial migration. Repeated runs applied 0 migrations. Another run with an existing album/photo preserved the data. |
| Health probes | Actual web, API and PostgreSQL probes ran inside their respective containers. API readiness also failed as expected when its mounted storage directory lost write access. |
| Uploads | Original bytes preserved; valid thumbnails generated with dimensions at most 480 × 480. Spoofed MIME, non-images, animated WebP/APNG, >10 MB, >40 MP and missing album uploads rejected. |
| Filesystem failures | Path traversal rejected. Read-only directory caused upload/delete errors while retaining the photo database record. Permission restoration recovered readiness. Invalid upload attempts left no extra original files. |
| Routing | Root installation and `/gallery/` installation passed, including deep links, assets, relative API/image URLs and both preserved and stripped proxy prefixes. |
| Persistence | Recreated web, API and PostgreSQL; album rows and exact original image bytes survived. |
| Backend recreation | Recreated only API; existing Nginx successfully resolved the replacement container. |
| Isolation | Two separate Compose project names isolated PostgreSQL data and actual upload mounts. Cross-installation photo IDs returned 404. |
| Resource limits | Applied 768 MiB RAM, 2 CPUs and 256 PIDs to running services. Three sequential 36 MP JPEG uploads and deletions passed; final API cgroup memory peak was **85.7 MiB**, with no OOM kill. This is a measured test workload, not a bound for every possible input. |
| Chromium E2E | **6/6 passed** across 1440 × 1100 desktop and 390 × 844 mobile viewports. Covered create/edit/delete, multiple uploads, >20 file rejection, invalid file selection, retry after simulated failure, cover replacement, viewer keyboard controls/focus return, dirty-form protection, network error recovery and root/prefix navigation. No uncaught browser errors in the CRUD flow. |
| Visual inspection | Desktop home and mobile edit screenshots inspected; no horizontal overflow in the tested album views. |

The local harness report is `.local/verification.json`. Browser screenshots are `.local/home-desktop.png`, `.local/home-mobile.png`, `.local/edit-desktop.png`, `.local/edit-mobile.png`, `.local/album-desktop.png` and `.local/album-mobile.png`. These local artifacts are ignored by Git and Docker.

## Handover boundary

- The running preview is local Docker. **No push or VPS deployment was performed.** Domain routing, HTTPS, the actual VPS Admin storage injector and its backup/restore interface must still be checked on the target platform.
- Local tests emulated the platform mount with separate test-only named volumes and explicitly verified numeric UID/GID write access. Production Compose does not declare a mount or volume at `/app/uploads`.
- There are no workers or scheduled commands to validate. No architecture change was required.
- `README.md` contains the deployment sequence, exact environment keys, mount permission requirements and the separate file/database backup procedure. An actual platform backup/restore was not performed.
