---
name: backfill
description: Scaffold an idempotent Phase-B style data backfill. Hands off to backfill-author. Use after a schema migration has added a column/table that needs to be populated from existing data.
---

# /backfill — write a data backfill migration

## What it does

Generates an idempotent EF Core migration whose `Up` calls `migrationBuilder.Sql("...")` with the data-transformation SQL. Lives in [backend/TimeFlow.Data/Migrations/](backend/TimeFlow.Data/Migrations/) alongside schema migrations.

## Steps

1. Parse the args: source table → target column/table, or a prose description of the transformation.
2. Confirm the target shape exists. Grep [backend/TimeFlow.Data/Models/](backend/TimeFlow.Data/Models/) for the target column. If it doesn't exist yet, stop — the user needs to run `/migration` first.
3. **Invoke the `backfill-author` agent** with the source → target mapping.
4. After the agent returns, run the `db-migration-reviewer` against the generated migration. Backfills have their own safety checks — idempotency, tenancy, lock-time risk on large tables.

## Hard rules

- Idempotency is non-negotiable. Re-running the backfill against already-populated data must be a no-op.
- No destructive operations. `DELETE` requires user approval. `TRUNCATE` is never appropriate.
- No dropping the source column in the same migration. That's a follow-up Phase D migration after the code switch has shipped.
- Tenancy: every join includes `org_id` on both sides. Cross-org writes are a data-leak bug.

## Reporting

Forward the backfill-author's summary (filename, source → target, expected row count, idempotency test) + the reviewer's verdict.
