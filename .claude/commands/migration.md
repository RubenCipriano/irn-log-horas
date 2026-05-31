---
name: migration
description: Scaffold a new EF Core migration matching the project's conventions. Hands off to migration-author. Usage:&nbsp; /migration AddProjectRoleColumns&nbsp; or describe the change in natural language.
---

# /migration — write an EF Core schema migration

## What it does

Generates a new EF Core migration in [backend/TimeFlow.Data/Migrations/](backend/TimeFlow.Data/Migrations/) plus the corresponding model + `DbContext` changes.

## Steps

1. Parse the args. If the user passed a `PascalCaseName`, use it. If they described the change in prose, derive a name (e.g. "add project role columns" → `AddProjectRoleColumns`).
2. Confirm the change is purely structural — adds/renames/drops of columns, tables, indexes, constraints. If the work involves **populating** the new shape from existing data, that's a backfill — redirect to `/backfill` instead.
3. **Invoke the `migration-author` agent** with the change description.
4. After the agent returns, run the `db-migration-reviewer` agent against the generated migration to catch safety issues before the user commits.

## Hard rules

- One migration per logical change. Don't bundle "add column X" and "add column Y on unrelated table" in one file — review + rollback gets harder.
- Migrations are not data backfills. If the column needs to be NOT NULL on existing rows, the migration adds it NULLABLE; a separate backfill PR populates it; a follow-up migration tightens to NOT NULL.

## Reporting

Forward the migration-author's summary (filename, Up/Down lines, build result) + the db-migration-reviewer's verdict. If the reviewer blocks, surface the findings and stop.
