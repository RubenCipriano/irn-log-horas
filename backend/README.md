# TimeFlow — Backend (.NET 8)

ASP.NET Core minimal API. Runs on port `5001`. Handles every `/api/*` request the frontend makes — auth, RBAC, native PM, integration adapters, AI streaming, background jobs.

> **Migration status — Phase 1 / 11**: only `/api/health` is wired today. The other endpoints land progressively in Phases 3-11. See [../plans/](../plans/) for the active migration plan.

## Stack

| Concern | Tech |
|---|---|
| Runtime | .NET 8 LTS, ASP.NET Core minimal APIs, Kestrel |
| ORM | Entity Framework Core 8 + Npgsql |
| Auth | JWT (HS256) in HTTP-only cookie + Redis-backed revocation denylist |
| Background jobs | Hangfire (Postgres-backed) — dashboard at `/hangfire` (Owner-only) |
| Encryption | AES-256-GCM via `TimeFlow.Vault` (same key format as the legacy stack so existing rows decrypt) |

## Project layout

```
backend/
├── TimeFlow.Api/              # minimal API host (Program.cs + Endpoints/)
├── TimeFlow.Auth/             # JWT cookie handler + Redis denylist
├── TimeFlow.Data/             # EF Core DbContext + scaffolded models (Phase 3+)
├── TimeFlow.Domain/           # pure business logic (Phase 6)
├── TimeFlow.Cache/            # Redis cache-aside (Phase 4)
├── TimeFlow.Rbac/             # role x permission matrix (Phase 4)
├── TimeFlow.Vault/            # AES-256-GCM envelope encryption (Phase 4)
├── TimeFlow.Integrations/     # OpenProject/Jira/Linear/GitLab HTTP clients (Phase 7)
├── TimeFlow.Ai/               # multi-provider streaming (Phase 9)
├── TimeFlow.Billing/          # feature gates (Phase 4)
├── Dockerfile                 # multi-stage sdk-alpine → aspnet-alpine runtime
├── docker-compose.yml         # standalone: brings up backend + postgres + redis
├── .env.example               # → cp .env.example .env, fill in secrets
└── TimeFlow.sln
```

## Dev commands

```bash
# Build the whole solution
dotnet build

# Run the API host (requires DATABASE_URL, REDIS_URL, JWT_SECRET, VAULT_KEY
# in your environment)
dotnet run --project TimeFlow.Api

# Smoke test:
curl http://localhost:5001/api/health
# → {"ok":true,"timestamp":"...","version":"..."}
```

## Standalone via Docker

The backend ships with its own `docker-compose.yml` so it can run in isolation (postgres + redis + backend, nothing else):

```bash
cd backend
cp .env.example .env       # then fill in real values
docker compose up -d --build

curl http://localhost:5001/api/health
```

To run the full stack (backend + frontend + nginx proxy), use the root `docker-compose.yml` one directory up.

## Required env vars

| Key | Purpose |
|---|---|
| `POSTGRES_PASSWORD` | Postgres superuser password |
| `REDIS_PASSWORD` | Redis AUTH |
| `JWT_SECRET` | HS256 signing key. ≥ 32 bytes after base64-decode. `openssl rand -base64 32` |
| `VAULT_KEY` | AES-256-GCM master key. Preserve the legacy value so existing encrypted blobs decrypt. |

## EF Core scaffold from the live DB (Phase 3 prep)

Once Postgres has the full schema again (recreate via Phase 3's EF migrations OR import a `pg_dump` of the old data), scaffold the model classes:

```bash
# From a host with .NET SDK + dotnet-ef installed, with Postgres
# reachable on localhost:5432 (uncomment the ports block in
# docker-compose.yml first if you need to):
dotnet ef dbcontext scaffold \
    "Host=localhost;Port=5432;Database=timeflow;Username=timeflow;Password=$POSTGRES_PASSWORD" \
    Npgsql.EntityFrameworkCore.PostgreSQL \
    --project TimeFlow.Data \
    --output-dir Models \
    --context TimeFlowDbContext \
    --no-onconfiguring \
    --force
```

## License

See [LICENSE](LICENSE).
