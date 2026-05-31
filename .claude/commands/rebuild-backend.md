---
name: rebuild-backend
description: Rebuild + restart the backend Docker container to pick up local changes. Quick smoke (health check) after restart.
---

# /rebuild-backend — rebuild + restart the backend

## What it does

Picks up local code changes by rebuilding the `timeflow-backend` Docker image and restarting only that service. Postgres + Redis stay running.

## Steps

1. Confirm the user has saved their changes (they don't need to commit; the Dockerfile COPY copies the working tree).
2. Build + restart:
   ```powershell
   docker compose -f backend/docker-compose.yml up -d --build backend
   ```
3. Wait for healthy status (max ~30s):
   ```powershell
   docker ps --filter name=timeflow-backend --format "{{.Status}}"
   ```
4. Smoke the health endpoint:
   ```powershell
   curl -s http://localhost:5001/api/health
   ```
   Should return `200` with a JSON body like `{"status":"ok"}`.
5. If the container is unhealthy, tail logs:
   ```powershell
   docker logs --tail 50 timeflow-backend
   ```
   Surface any startup error (most common: DB migration failure on `db:migrate`, env var validation refusal).

## Hard rules

- Don't rebuild Postgres or Redis unless the user explicitly asks. Their data lives in named volumes; rebuilds usually preserve, but a misconfigured rebuild loses worklogs.
- Don't run `docker compose down` to "fix" a startup error. Down + up doesn't fix code; it just hides the log. Read the log instead.

## Reporting

End with: `Backend rebuilt + healthy` or `Backend rebuild failed — <reason>`. On failure, paste the relevant log lines and suggest the next step.
