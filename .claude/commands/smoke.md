---
name: smoke
description: Run the end-to-end smoke scenarios from the active plan. For plan 016, drives the 17-step verification (see plan 016 "End-to-end verification" section). Optional arg:&nbsp; /smoke 12&nbsp; runs just step 12.
---

# /smoke — end-to-end smoke runner

## What it does

Executes the smoke-test scenarios that prove a feature works end-to-end (against the live stack, not unit-mocked).

## Steps

1. Identify the active plan: default to `plans/016-*.md` since that's the current overhaul. If multiple plans are active, ask.
2. Read the plan's "End-to-end verification" or "Verification" section.
3. If the user passed a step number (e.g. `12`), run only that step. Otherwise prompt for which steps to run — full 17-step takes 15-30 minutes.
4. For each selected step:
   - Set up the precondition (create the org, client, connection, etc.)
   - Drive the action (curl, browser, docker exec)
   - Verify the postcondition (DB row, API response, UI state)
5. Report PASS / FAIL per step with the actual observed output.

## Stack prep

Before running any step, confirm:
- Docker stack up: `docker ps` shows `timeflow-backend`, `timeflow-postgres`, `timeflow-redis`, `timeflow-frontend` all healthy
- Migrations current: `docker exec timeflow-backend dotnet ef database update --no-build` (or rely on the boot-time auto-migrate)
- A test user account exists with owner role on a test org (or create one)

## Reporting

```
## Smoke results

| Step | Status | Notes |
|------|--------|-------|
| 1    | PASS   | Created Accenture org id=...
| 12   | FAIL   | Expected effective role tech_lead at leaf, got developer.
```

End with the failing step's evidence (DB query result, API response, log excerpt) and the suggested specialist to debug it.
