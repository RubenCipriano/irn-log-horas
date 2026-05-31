---
name: verify-sync
description: Re-test the OpenProject (or other tracker) sync end-to-end. Triggers a sync, tails the backend container logs, reports success/failure with the actual exception trace on failure.
---

# /verify-sync — end-to-end sync smoke

## What it does

Drives the WorklogSyncJob path against a live integration connection. Confirms credentials → project listing → task pagination → optional worklog import all work without falling into the generic error catch-all.

## Steps

1. Confirm the backend container is running:
   ```powershell
   docker ps --filter name=timeflow-backend --format "{{.Names}} {{.Status}}"
   ```
   If not, bring it up via `/rebuild-backend` first.
2. Ask the user for the connection id to sync. (Or list connections: `docker exec timeflow-postgres psql -U timeflow -d timeflow -c "SELECT id, provider, name FROM integration_connections;"`)
3. Trigger the sync via the SPA OR via curl:
   ```powershell
   # Replace <connId> and <session-cookie>
   curl -X POST "http://localhost:5001/api/orgs/<orgId>/integrations/<connId>/sync" `
        -H "Cookie: tf_session=<cookie>" -i
   ```
4. Tail backend logs (run in background):
   ```powershell
   docker logs -f timeflow-backend
   ```
   Or check after the fact:
   ```powershell
   docker logs --since 5m timeflow-backend 2>&1 | Select-String -Pattern "WorklogSyncJob|exception|error" -Context 0,30
   ```
5. Poll the job status:
   ```powershell
   docker exec timeflow-postgres psql -U timeflow -d timeflow -c "SELECT status, error_code, error_message, started_at, finished_at, progress_done, progress_total FROM integration_sync_jobs WHERE connection_id = '<connId>' ORDER BY created_at DESC LIMIT 3;"
   ```
6. Report:
   - **Success**: counts (`projectsSynced`, `tasksUpserted`, duration)
   - **Failure**: the actual exception type + message + stack trace from logs. NOT the generic "Unexpected sync error — check server logs" — surface the underlying cause.

## Hard rules

- Don't paper over a generic error. The job's `errorMessage` column is the redacted user-facing string; the real exception is in `ILogger.LogError(ex, ...)` output → `docker logs`. Fish it out.
- If the trace points at a code line in [WorklogSyncJob.cs](backend/TimeFlow.Api/Services/WorklogSyncJob.cs) or [OpenProjectAdapter.cs](backend/TimeFlow.Integrations/Adapters/OpenProjectAdapter.cs), hand off to `integrations-specialist` for the fix.

## Reporting

End with: PASS or FAIL, the exception summary (if FAIL), and the suggested next agent (typically integrations-specialist on FAIL).
