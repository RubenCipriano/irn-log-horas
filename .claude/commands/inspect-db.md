---
name: inspect-db
description: Run a SQL query against the timeflow Postgres container. Optional arg is the SQL itself; no arg drops into an interactive shell. Always read-only by default — INSERT/UPDATE/DELETE require explicit user confirmation.
---

# /inspect-db — query the local Postgres

## What it does

Runs a SQL statement against the `timeflow` database inside the `timeflow-postgres` container. Default usage is read-only diagnostics.

## Steps

1. Parse args:
   - If args contain SQL, use it.
   - If args are empty, ask the user what to query OR drop into an interactive psql:
     ```powershell
     docker exec -it timeflow-postgres psql -U timeflow -d timeflow
     ```
2. **Mutation check**. If the SQL starts with `INSERT` / `UPDATE` / `DELETE` / `DROP` / `TRUNCATE` / `ALTER` (case-insensitive, ignoring leading whitespace + comments):
   - Refuse to run silently.
   - Confirm with the user: "This statement modifies data. Run anyway? (y/N)"
   - Only run if the user says yes.
3. Execute:
   ```powershell
   docker exec timeflow-postgres psql -U timeflow -d timeflow -c "<SQL>"
   ```
4. Format the output:
   - Small result (<20 rows): paste verbatim
   - Large result: paste header + first 20 rows + row count
   - Wide result: drop columns the user almost certainly doesn't need (raw_json, large text blobs) and note the omission

## Useful queries (paste into the chat for the user)

```sql
-- recent sync jobs
SELECT id, status, error_code, error_message, started_at, finished_at FROM integration_sync_jobs ORDER BY created_at DESC LIMIT 10;

-- org membership count
SELECT o.name, COUNT(m.user_id) AS members FROM organisations o LEFT JOIN org_memberships m ON m.org_id = o.id GROUP BY o.id, o.name;

-- worklog total by user this month
SELECT u.email, SUM(w.hours) AS hours FROM worklogs w JOIN users u ON u.id = w.user_id WHERE w.work_date >= date_trunc('month', current_date) GROUP BY u.email ORDER BY hours DESC;

-- mirrored projects per connection
SELECT c.name AS conn, COUNT(*) AS mirrored FROM integration_connections c JOIN native_projects p ON p.connection_id = c.id GROUP BY c.name;
```

## Hard rules

- **Never mutate without confirmation**. The harness `dangerouslyDisableSandbox` exists — don't use it.
- **Never connect with raw `Host=localhost`** — go through `docker exec`, which routes via the internal network and doesn't require Postgres to be exposed on the host (it isn't, by default).
- **Don't paste credentials** if the user asks "show me the user row" — bcrypt hashes and TOTP secrets are sensitive even in local dev. Use `SELECT id, email, created_at FROM users` not `SELECT *`.

## Reporting

Paste the result. If a query took >2s, mention it — a slow inspector is a sign the prod query plan is off.
