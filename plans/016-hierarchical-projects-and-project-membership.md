# 016 — Hierarchical Projects, Client-Bound Connections, Project-Level Membership

> PR plan derived from the design spec at `C:\Users\ruben\.claude\plans\d-projects-weddingcard-wedding-invitatio-ticklish-beaver.md`. The spec is the authority on WHAT to build (invariants I1–I10, gaps G1–G28); this file is the authority on HOW to ship it — sequenced, reviewable PRs with concrete file lists.
>
> Treat the spec as locked. If a question arises during implementation that the spec doesn't answer, escalate before improvising.

## Context

TimeFlow today carries three independent project-shaped concepts: `native_projects` (flat list, optionally client-tagged), `upstream_projects` (sync cache mirroring a tracker), and `squads` (flat team grouping). Membership is org-level only — there's no notion of a foreign consultant being granted access to one project tree without being made an org member, and no way to model how OpenProject actually structures work (a recursive project tree per customer).

This overhaul collapses all three concepts into one **hierarchical `projects` table** (1-N tree, unbounded depth). Each Integration Connection becomes 1:1 with a Client; the Client's project tree IS the upstream tracker's tree, materialised locally. Project-level membership is added (`project_members.role_on_project` + `denied` flag) with **nearest-ancestor-wins** resolution (I1/I2). Squads disappear, replaced by `projects` rows with `type='team'`.

The motivating use case is multi-company consulting: Accenture (Org) has Client IRN; IRN runs OpenProject (Connection); IRN has many root projects, each with subprojects, recursively. A consultant from Accenture gets added to N IRN projects without being granted blanket Accenture-org access.

## Decisions resolved

The spec left 11 questions open. Resolutions (mostly accepting the spec's recommendation; two overrides marked):

| # | Question | Decision |
|---|---|---|
| Q1 | Rename `native_projects` → `projects`, `native_tasks` → `tasks` | **Yes** |
| Q2 | Project type enum scope | **Full 7 values**: `program / project / subproject / team / module / service / epic` |
| Q3 | Synthetic client for un-linked connections | **Auto-synth** "Untitled client (from {connection.name})" + settings reminder |
| Q4 | Hard-delete behaviour | **LOCKED by I5** — soft-archive when worklogs exist |
| Q5 | Effective-member cache TTL | **5 minutes** |
| Q6 | Invalidation scope on member writes | **Subtree-only** via `org:{orgId}:project:{projectId}:descendants` |
| Q7 | Allow worklogs without a Task | **Override → require a Task** — Phase B must create synthetic "General" tasks for project-only worklogs |
| Q8 | Multi-currency | **LOCKED out by G27** — rate columns stay bare numerics; companion currency cols deferred |
| Q9 | Auto re-sync on connection re-point | **Yes** |
| Q10 | Cross-client transfer endpoint | **Defer** — manual migration script when first needed |
| Q11 | `project_rate_history` audit table | **Override → include now** — finance-grade audit from day one; parallel tables for `org_memberships` + `clients` rate changes |

## PR roadmap

| PR | Title | Phase | Migration? | Behaviour change? | Reviewers |
|---|---|---|---|---|---|
| 016.1 | Schema additions (non-breaking) | A | yes | no | data + backend |
| 016.2 | Backfill `upstream_*` → `projects` + `tasks` | B | yes | no | data |
| 016.3 | Backfill squads, project_members, client links + synthetic clients | B | yes | no | data |
| 016.4 | Synthetic "General" tasks for project-only worklogs | B | yes | no | data |
| 016.5 | Worklog FK rewrite (`upstream_task_id` → `task_id`) | B | yes | no | data |
| 016.6 | Connection ↔ Client 1:1 + re-point endpoint + sync re-anchor | C | yes (NOT NULL + UNIQUE) | yes (sync target changes) | backend |
| 016.7 | Project tree endpoints + cascade rules (I3/I5/I6/I7) | C | no | yes | backend |
| 016.8 | ProjectMember inheritance + effective role + consultant access | C | no | yes (G11) | backend + rbac |
| 016.9 | Rate cascade + invoice generation walk + `project_rate_history` writes | C | yes (history tables) | yes | backend + billing |
| 016.10 | Frontend tree views + AI prompt path-aware | C | no | yes (UX) | frontend |
| 016.11 | Phase D drops + table renames | D | yes (DROP + RENAME) | no (if 6–10 fully shipped) | data + backend |

Each PR depends on the previous one being merged AND deployed. Specifically:

- PRs 2–5 (Phase B) require PR 1's columns to exist.
- PRs 6–10 (Phase C) read from the new columns/tables populated in Phase B; if Phase B hasn't run, they break.
- PR 11 (Phase D) refuses to drop anything still referenced — gate on a pre-flight check that no Phase-C endpoint still reads the legacy tables.

---

## PR 016.1 — Schema additions (non-breaking)

### Scope

Add every new column and table the spec needs. Nothing reads them yet; everything keeps working through the legacy tables. This PR is purely additive — rollback is `drop table / drop column`.

### Files

**Schema:**
- [backend/TimeFlow.Data/TimeFlowDbContext.cs](backend/TimeFlow.Data/TimeFlowDbContext.cs) — add new column mappings, new entity types, new indexes
- `backend/TimeFlow.Data/Models/Project.cs` (rename later — for now add cols to `NativeProject.cs`)
- `backend/TimeFlow.Data/Models/Task.cs` (likewise on `NativeTask.cs`)
- `backend/TimeFlow.Data/Models/IntegrationConnection.cs` — add `ClientId` (nullable for now)
- `backend/TimeFlow.Data/Models/ProjectMember.cs` — add `RoleOnProject`, `Denied`
- `backend/TimeFlow.Data/Models/ProjectRateHistory.cs` (new)
- `backend/TimeFlow.Data/Models/MembershipRateHistory.cs` (new — org_memberships parallel)
- `backend/TimeFlow.Data/Models/ClientRateHistory.cs` (new — clients parallel)

**Migration:**
- `backend/TimeFlow.Data/Migrations/<timestamp>_AddHierarchicalProjects.cs`

### Columns added

`projects` (still named `native_projects` until PR 016.11):
- `parent_project_id uuid?` — self-FK, `ON DELETE CASCADE` (safety net only; endpoint refuses delete when subtree has worklogs per I5)
- `connection_id uuid?` — FK SET NULL
- `upstream_project_id varchar(120)?`
- `type varchar(40) NOT NULL DEFAULT 'project'`
- `upstream_raw_json text?`
- `last_synced_at timestamptz?`
- `upstream_updated_at timestamptz?`

`integration_connections`:
- `client_id uuid?` (nullable in this PR; tightened to NOT NULL + UNIQUE in PR 016.6)

`project_members`:
- `role_on_project varchar(40) NOT NULL DEFAULT 'developer'`
- `denied boolean NOT NULL DEFAULT false`

`tasks` (still named `native_tasks`):
- `connection_id uuid?` FK SET NULL
- `upstream_task_id varchar(120)?`
- `upstream_version_id varchar(120)?`
- `upstream_version_name varchar(200)?`
- `upstream_updated_at timestamptz?`
- `assignee_upstream_id varchar(120)?`
- `upstream_raw_json text?`

### Indexes added

- `(org_id, parent_project_id)` on projects
- partial `(org_id, client_id) WHERE parent_project_id IS NULL` on projects (root-of-client lookup)
- partial unique `(connection_id, upstream_project_id) WHERE connection_id IS NOT NULL` on projects
- partial unique `(connection_id, upstream_task_id) WHERE connection_id IS NOT NULL` on tasks

### Tables added

`project_rate_history` (per Q11):
- `id uuid PK`, `project_id uuid FK CASCADE`, `field varchar(40)` (`bill_rate`), `old_value numeric(10,2)?`, `new_value numeric(10,2)?`, `changed_by uuid? FK SET NULL`, `changed_at timestamptz NOT NULL`
- index `(project_id, changed_at DESC)`

`membership_rate_history` (per Q11, `cost_per_hour` on `org_memberships`):
- same shape, `org_membership_id` FK CASCADE

`client_rate_history` (per Q11, `default_bill_rate` on `clients`):
- same shape, `client_id` FK CASCADE

### Verification

- `dotnet ef migrations script <previous> <new>` produces only `CREATE TABLE` / `ALTER TABLE ADD COLUMN` / `CREATE INDEX` — no DROPs, no CHECK changes on existing constraints.
- Apply against a snapshot of the staging DB: schema diff is purely additive.
- Existing endpoints (worklog write, project list, invoice generate, calendar) return identical responses pre/post migration.
- Integration test: create a project_member with `role_on_project='manager'` + `denied=false` — row persists, no error.

### Out of scope

- Reading from any new column (Phase C).
- Renaming `native_*` (PR 016.11).
- Cycle prevention (PR 016.7 — the column exists but nothing PATCHes it yet).

---

## PR 016.2 — Backfill upstream_projects + upstream_tasks → projects + tasks

### Scope

Materialise the upstream mirror as real `projects` + `tasks` rows. Old upstream tables stay populated (sync still writes them) — these are shadow rows. Endpoints still read the old tables in this PR.

### Files

- `backend/TimeFlow.Data/Migrations/<ts>_BackfillUpstreamProjectsAndTasks.cs` — calls a one-shot backfill SQL block, idempotent (`INSERT … ON CONFLICT DO NOTHING`)
- `backend/TimeFlow.Data/Backfills/UpstreamMirrorBackfill.cs` (new helper, invoked from migration) — walks each connection's upstream tree depth-first

### Algorithm

For each `integration_connections.id`:
1. Build a map `upstreamId → newProjectId` (UUID generated for each upstream project).
2. Walk `upstream_projects` for this connection in topological order (parent before children, derived from upstream's own `parent` field in `raw_json`).
3. For each upstream project, INSERT into `projects`:
   - `id = generated UUID`
   - `org_id = conn.org_id`
   - `parent_project_id = map[upstream parent id]` (or NULL for roots)
   - `connection_id = conn.id`
   - `upstream_project_id = upstream.upstream_id`
   - `name = upstream.name`
   - `code = upstream.code`
   - `type = 'project'` (refined later for sub-projects via app logic — keep simple)
   - `upstream_raw_json = upstream.raw_json`
   - `last_synced_at = upstream.last_synced_at`
   - `upstream_updated_at = upstream.upstream_updated_at`
   - `client_id` — left NULL for now (set in PR 016.3 from `client_upstream_projects`)
4. For each `upstream_tasks` row for this connection, INSERT into `tasks` with `connection_id`, `upstream_task_id`, and `project_id = map[task.upstream_project_id]`.

### Verification

- Row counts: `SELECT COUNT(*) FROM upstream_projects` == `SELECT COUNT(*) FROM native_projects WHERE connection_id IS NOT NULL` (after backfill).
- Same for tasks.
- Sample one connection: walk its new `projects` tree and confirm depth + names match OpenProject's tree.
- Idempotency: re-run the migration in a test DB — zero new rows the second time.

### Out of scope

- Setting `client_id` on the new projects (PR 016.3).
- Wiring sync to write `projects` directly (PR 016.6).
- Dropping `upstream_projects` / `upstream_tasks` (PR 016.11).

---

## PR 016.3 — Backfill squads + project_members + client links + synthetic clients

### Scope

Move squads into `projects` rows (`type='team'`), move squad members into `project_members`, map `client_upstream_projects` onto the new `projects.client_id`, and synthesise a Client for every connection lacking one (per Q3).

### Files

- `backend/TimeFlow.Data/Migrations/<ts>_BackfillSquadsAndClientLinks.cs`
- `backend/TimeFlow.Data/Backfills/SquadToProjectBackfill.cs`
- `backend/TimeFlow.Data/Backfills/ClientLinkBackfill.cs`
- `backend/TimeFlow.Data/Backfills/SyntheticClientBackfill.cs`

### Squads → projects

For each `squads` row:
- INSERT `projects` row: `type='team'`, `name = squad.name`, `org_id = squad.org_id`, `parent_project_id = NULL`, `client_id = NULL`, `connection_id = NULL`
- Record the mapping `squadId → newProjectId`

For each `squad_members` row:
- INSERT `project_members`: `project_id = map[squad_id]`, `user_id`, `role_on_project = 'developer'` (or `'manager'` when `squad_members.user_id == squad.manager_id`), `denied = false`

### Client links

For each `client_upstream_projects` row:
- Find the new `projects` row by `(connection_id, upstream_project_id)`.
- If that project is a ROOT (`parent_project_id IS NULL`), set `client_id = link.client_id`.
- If it's a SUBPROJECT, walk up to the root and set the ROOT's `client_id`. Subproject's own `client_id` stays NULL.

For each `integration_connections`:
- `connection.client_id = most common client across this conn's links` (majority vote).
- If two distinct clients are equally common: flag in migration output for manual reconcile (rare).
- If zero links: synth a client (next step).

### Synthetic clients

For each `integration_connections` with zero `client_upstream_projects` rows:
- INSERT `clients` row: `org_id = conn.org_id`, `name = "Untitled client (from " + conn.name + ")"`, `default_bill_rate = NULL`, `created_by = conn.created_by`.
- Set `conn.client_id` to the new client id.
- Write an `audit_log` entry: `action = "client.synthesised_from_connection"`, `actor_id = NULL` (system), `target_id = conn.id`, `payload = { connection_id, client_id }`.
- Set a per-org notification: "N connections received synthetic clients during the hierarchical-projects migration — review at /settings/clients."

### Verification

- All `squads` rows have a corresponding `projects` row with `type='team'`. Counts match.
- All `squad_members` rows have a `project_members` row. Counts match.
- For every connection, `connection.client_id IS NOT NULL` after this PR (still nullable in schema; tightened in PR 016.6).
- Sum of `projects.client_id IS NOT NULL` (roots only) ≥ count of distinct `(connection_id, root_upstream_id)` from `client_upstream_projects` — every linked upstream root got its client set.

---

## PR 016.4 — Synthetic "General" tasks for project-only worklogs

### Scope

Per the Q7 override, every worklog must point at a Task. For each project that has at least one project-only worklog (`task_id IS NULL`), create a synthetic "General" task and re-point those worklogs.

### Files

- `backend/TimeFlow.Data/Migrations/<ts>_BackfillProjectOnlyWorklogTasks.cs`
- `backend/TimeFlow.Data/Backfills/GeneralTaskBackfill.cs`

### Algorithm

```sql
-- For each project with project-only worklogs:
WITH targets AS (
  SELECT DISTINCT project_id FROM worklogs WHERE task_id IS NULL AND project_id IS NOT NULL
)
INSERT INTO native_tasks (id, org_id, project_id, title, status, ...)
SELECT gen_random_uuid(), p.org_id, t.project_id, 'General', 'open', ...
FROM targets t JOIN native_projects p ON p.id = t.project_id
RETURNING id, project_id;

-- Then re-point worklogs:
UPDATE worklogs w
SET task_id = gt.id
FROM general_tasks gt
WHERE w.task_id IS NULL AND w.project_id = gt.project_id;
```

### Verification

- `SELECT COUNT(*) FROM worklogs WHERE task_id IS NULL` returns 0 after migration.
- Sum of hours per project unchanged pre/post migration (no worklog data was touched, only the task pointer).
- The synthetic tasks have `title = 'General'` and a recognisable status — flag them in the UI so users can rename if they want.

### Out of scope

- Enforcing `worklogs.task_id NOT NULL` at the schema level — done in PR 016.11 (after we're confident no new project-only worklogs leak in via the now-blocked write path; PR 016.7 closes that path).

---

## PR 016.5 — Worklog FK rewrite (`upstream_task_id` → `task_id`)

### Scope

For each worklog with `upstream_task_id` set, point its `task_id` at the new `tasks` row and set `project_id` to that task's project.

### Files

- `backend/TimeFlow.Data/Migrations/<ts>_BackfillWorklogTaskFK.cs`

### Algorithm

```sql
UPDATE worklogs w
SET task_id = t.id,
    project_id = COALESCE(w.project_id, t.project_id)
FROM native_tasks t
WHERE t.connection_id = w.connection_id
  AND t.upstream_task_id = w.upstream_task_id
  AND w.upstream_task_id IS NOT NULL
  AND w.task_id IS NULL;
```

### Verification

- After migration: zero worklogs have `upstream_task_id IS NOT NULL AND task_id IS NULL`.
- Invoice generation for a known billed month produces the same totals pre/post migration. (Run the invoice generator in dry-run mode on a snapshot, compare to the live invoice numbers.) This is the load-bearing check — a divergence here means the FK rewrite shifted a billable hour.
- Worklogs with `invoice_line_id IS NOT NULL` are NOT touched (their rate is frozen on the line per I4 — re-pointing the task can't change billed amounts, but the safety check confirms we're not accidentally modifying historical billing).

---

## PR 016.6 — Connection ↔ Client 1:1 + re-point endpoint + sync re-anchor

### Scope

Enforce the 1:1 constraint between connections and clients (I8). Add the re-point endpoint with auto re-sync (Q9). Stop reading `client_upstream_projects` — connection.client_id is now the source of truth. The sync job writes `projects` rows directly (mirroring upstream tree) instead of `upstream_projects`.

This is the first PR with a real behavioural change. Deploy carefully.

### Files

**Schema:**
- `backend/TimeFlow.Data/Migrations/<ts>_EnforceConnectionClientNotNullUnique.cs` — `ALTER COLUMN client_id SET NOT NULL`, `CREATE UNIQUE INDEX`

**Backend:**
- [backend/TimeFlow.Api/Endpoints/IntegrationConnectionEndpoints.cs](backend/TimeFlow.Api/Endpoints/IntegrationConnectionEndpoints.cs) — extend create/update to require + validate `clientId`; add `PATCH /api/orgs/{orgId}/integrations/{connId}/client` for re-point
- [backend/TimeFlow.Api/Services/WorklogSyncJob.cs](backend/TimeFlow.Api/Services/WorklogSyncJob.cs) — already cached existing tasks per connection (from this session's fix). Extend to ALSO write rows into `projects` directly, anchored on `connection.client_id`. **Note:** keep writing `upstream_projects` + `upstream_tasks` for one more PR cycle so we can roll back; remove in PR 016.11.
- New: `backend/TimeFlow.Api/Services/ConnectionRepointService.cs` — atomically re-points conn.client_id, moves all subtree roots' `client_id`, enqueues a sync job.

**Frontend:**
- [frontend/src/components/SettingsIntegrationsView.tsx](frontend/src/components/SettingsIntegrationsView.tsx) — add "Change client" action; on success, kick off a sync.

### Endpoint contract

`PATCH /api/orgs/{orgId}/integrations/{connId}/client`
- Body: `{ clientId: string }`
- Auth: `requireOrgRole(orgId, "owner")` (cross-client move is a sensitive operation)
- Validation: new client must exist in the same org, must have no existing connection (1:1)
- Effect (single DB transaction):
  1. `UPDATE integration_connections SET client_id = newClientId WHERE id = connId`
  2. `UPDATE projects SET client_id = newClientId WHERE connection_id = connId AND parent_project_id IS NULL`
  3. Enqueue a sync job for the connection (per Q9)
  4. Audit: `connection.client_repointed` with `old_client_id`, `new_client_id`

### Verification

- Existing connections survive the NOT NULL migration (PR 016.3 set client_id on all of them).
- Re-pointing a connection to a new client moves all root projects' `client_id` and triggers a sync. Within ~30s, the sync completes successfully and the projects tree is unchanged (re-pointing isn't a tree-shape change, just an ownership change).
- Re-pointing to a client that already has a connection: 409 `code: "client_has_connection"`.
- Re-pointing to a client in a different org: 404 (orgs are siloed).
- `client_upstream_projects` is no longer read by any endpoint (grep confirms). The table still exists; dropped in PR 016.11.

### Risks

- A bug in `ConnectionRepointService` could leave `conn.client_id` and `projects.client_id` out of sync. The transaction guards this; add a sanity check on connection load (warn if root project's client_id != connection's client_id) as a tripwire during the rollout window.
- The sync job extension to write `projects` rows must be idempotent with the backfill from PR 016.2 — use the same `(connection_id, upstream_project_id) ON CONFLICT` upsert.

---

## PR 016.7 — Project tree endpoints + cascade rules (I3/I5/I6/I7)

### Scope

Expose the tree to the API. Enforce cycle prevention (I7), cross-client guard (I6), soft-archive on delete with worklogs (I5), and the bill_rate cascade reads (I3). No `EffectiveProjectRole` yet — that's PR 016.8.

### Files

**Backend:**
- [backend/TimeFlow.Api/Endpoints/NativeProjectEndpoints.cs](backend/TimeFlow.Api/Endpoints/NativeProjectEndpoints.cs) — rewrite GET to return tree (`{id, name, type, children: [...]}`)
- `backend/TimeFlow.Api/Endpoints/NativeProjectEndpoints.cs` — extend POST to accept `parentProjectId`; PATCH to allow re-parenting with I6/I7 guards; DELETE with I5 soft-archive logic
- `backend/TimeFlow.Api/Services/ProjectTreeService.cs` (new) — recursive CTE helpers: `GetDescendantIds(projectId)`, `GetAncestorIds(projectId)`, `ResolveRootClientId(projectId)`, `IsAncestorOf(candidate, target)`
- `backend/TimeFlow.Api/Services/BillRateResolver.cs` (new) — implements I3: ancestor walk, nearest non-null wins, fall back to `client.default_bill_rate`
- [backend/TimeFlow.Api/Endpoints/InvoiceEndpoints.cs](backend/TimeFlow.Api/Endpoints/InvoiceEndpoints.cs) — generation walks the subtree per G7 (CTE), uses `BillRateResolver` for un-frozen worklogs
- [backend/TimeFlow.Api/Endpoints/MemberEndpoints.cs](backend/TimeFlow.Api/Endpoints/MemberEndpoints.cs) — HoursSummary uses the new cost cascade (G3)

### Endpoint contracts

`POST /api/orgs/{orgId}/projects`
- Body: `{ name, type, parentProjectId?, clientId? (only when parentProjectId == null), code?, billRate?, costPerHour? }`
- Validation: `clientId` required iff `parentProjectId == null`; `clientId` rejected when `parentProjectId != null` (subprojects inherit, per the invariant)
- Auth: `requireOrgRole(orgId, "manager")`

`PATCH /api/orgs/{orgId}/projects/{id}`
- Body: any subset of `{ name, type, parentProjectId, code, billRate, costPerHour, archived }`
- Cycle prevention (I7): if `parentProjectId` is set, run a recursive CTE: refuse 409 `code: "would_create_cycle"` if the candidate parent is currently a descendant of this project
- Cross-client guard (I6): if `parentProjectId` change crosses to a different root client AND any worklog in the subtree is billed (`invoice_line_id IS NOT NULL`) or billable (`is_billable = true`), refuse 409 `code: "would_change_client"`
- Audit: `project.updated` with old/new values; bill_rate / cost_per_hour changes ALSO write to `project_rate_history` (PR 016.9 wires the table, this PR can emit zero rows if billing isn't wired yet — sequence: 016.9 lands the writer)

`DELETE /api/orgs/{orgId}/projects/{id}`
- If ANY worklog in the subtree exists: 409 `code: "has_worklogs"`, body includes the count
- Else: hard delete (CASCADE handles children)
- Soft-archive verb: `PATCH /projects/{id} { archived: true }` — same auth, no worklog check

### Verification

- Create root project under a client → succeeds, `client_id` set.
- Create subproject under a root → succeeds, `client_id` rejected with 400 if provided.
- Re-parent project P to its own descendant → 409 `would_create_cycle`.
- Re-parent project P (with billable worklogs) to a parent under a different client → 409 `would_change_client`.
- Delete project with worklogs → 409. Archive then delete → succeeds (archive doesn't unblock delete; reassign worklogs does).
- Generate an invoice spanning a 3-level tree: hours from leaf + mid + root all roll up to the client's invoice (G7).
- Resolve bill_rate for a worklog where leaf has NULL, mid has 100, root has 50 → resolves to 100 (I3 nearest non-null).

---

## PR 016.8 — ProjectMember inheritance + effective role + consultant access

### Scope

Implement nearest-ancestor-wins membership (I1/I2), extend org membership check to allow project-only access (G11/consultant pattern), add the last-manager guard (I9), and wire the cache (Q5/Q6).

### Files

**Backend:**
- `backend/TimeFlow.Auth/EffectiveProjectRole.cs` (new) — `Resolve(userId, projectId)` walks ancestors per I1/I2; returns `Role?` (null when no row found on the path)
- [backend/TimeFlow.Auth/IOrgMembershipReader.cs](backend/TimeFlow.Auth/IOrgMembershipReader.cs) — extend `GetRoleAsync(userId, orgId)` to ALSO check `project_members` membership and return a synthetic `project_only` role when the user is in at least one project of the org
- [backend/TimeFlow.Api/Endpoints/ProjectMemberEndpoints.cs](backend/TimeFlow.Api/Endpoints/ProjectMemberEndpoints.cs) — PATCH/POST/DELETE write project_members rows; enforce last-manager guard (I9); invalidate cache per Q6
- [backend/TimeFlow.Cache/CacheTags.cs](backend/TimeFlow.Cache/CacheTags.cs) — add `project_user_roles(orgId, userId)` tag (5 min TTL per Q5) and the descendant-invalidation tag `org_project_descendants(orgId, projectId)`
- `backend/TimeFlow.Api/Services/ProjectMemberCacheInvalidator.cs` (new) — on a project_members mutation at project P: invalidate `project_user_roles` for the affected user, AND descendant tags for P and every ancestor of P

**Where to call `EffectiveProjectRole`:**
- Worklog read endpoints — gate by `WorklogsReadOrg OR own OR EffectiveProjectRole(worklog.project) >= tech_lead`
- Worklog write endpoints — gate by `WorklogsWriteOwn AND EffectiveProjectRole(worklog.project) != null`
- `/api/orgs/{orgId}/projects` (list) — return only projects where caller has effective membership OR has org-level read

### Last-manager guard (I9)

A `denied=true` flip OR a DELETE on a `project_members` row is refused (409 `last_manager`) when:
- Target row has `role_on_project = 'manager'` AND
- After the write, the EFFECTIVE manager set at this project (computed by walking from the project's root downward, applying I1 nearest-ancestor-wins per (user, project)) has zero entries for the modified project.

Performance approximation per G24: only re-check the modified project AND its immediate children (deep descendants inherit at the modified level — if it still has a manager, they do too).

### Verification

- A consultant in Org B who is a project_member of an Org-A project can GET `/api/orgs/{A}/projects` → succeeds with the projects they're in (G11).
- Same consultant calling `/api/orgs/{A}/clients` → 403 (project access doesn't grant client-list access).
- I1/I2 — user has `developer` at root, `denied` at mid, `tech_lead` at leaf → effective role at leaf is `tech_lead`; effective role at mid is "no access"; at a sibling-of-leaf under mid: "no access".
- I9 — try to deny the only manager of a project → 409 `last_manager`. Add a second manager first → both succeed.
- Cache: mutating project_members at P → cache for P, P's ancestors, AND every descendant is dropped. Unrelated projects' caches stay warm.

---

## PR 016.9 — Rate cascade + invoice generation + rate history writes

### Scope

Wire the rate cascade (I3 for bill_rate, G3 for cost_per_hour) into all read paths. Wire `project_rate_history` / `membership_rate_history` / `client_rate_history` writes into the rate-changing endpoints. Tighten invoice generation per I4 (snapshot rate at generation time onto the InvoiceLine).

### Files

- `backend/TimeFlow.Api/Services/CostPerHourResolver.cs` (new — mirror of `BillRateResolver` from PR 016.7)
- [backend/TimeFlow.Api/Endpoints/MemberEndpoints.cs](backend/TimeFlow.Api/Endpoints/MemberEndpoints.cs) — HoursSummary switches to `CostPerHourResolver` for live (un-invoiced) rates; invoiced lines read from the snapshot
- [backend/TimeFlow.Api/Endpoints/InvoiceEndpoints.cs](backend/TimeFlow.Api/Endpoints/InvoiceEndpoints.cs) — generation calls `BillRateResolver` per worklog, freezes the result on `invoice_lines.bill_rate` (I4)
- [backend/TimeFlow.Api/Endpoints/NativeProjectEndpoints.cs](backend/TimeFlow.Api/Endpoints/NativeProjectEndpoints.cs) — PATCH writes `project_rate_history` on `bill_rate` change
- [backend/TimeFlow.Api/Endpoints/MemberEndpoints.cs](backend/TimeFlow.Api/Endpoints/MemberEndpoints.cs) — PATCH writes `membership_rate_history` on `cost_per_hour` change
- [backend/TimeFlow.Api/Endpoints/ClientEndpoints.cs](backend/TimeFlow.Api/Endpoints/ClientEndpoints.cs) — PATCH writes `client_rate_history` on `default_bill_rate` change

### Invoice generation algorithm (revised)

For a target client C and date range:
```
WITH RECURSIVE descendants AS (
  SELECT id FROM projects WHERE client_id = $clientId AND parent_project_id IS NULL
  UNION ALL
  SELECT p.id FROM projects p JOIN descendants d ON p.parent_project_id = d.id
)
SELECT w.* FROM worklogs w
WHERE w.project_id IN (SELECT id FROM descendants)
  AND w.work_date BETWEEN $from AND $to
  AND w.is_billable = true
  AND w.invoice_line_id IS NULL;
```

For each worklog yielded:
- Resolve `bill_rate` via ancestor walk from the worklog's project (PR 016.7's `BillRateResolver`).
- INSERT into `invoice_lines` with the snapshot.
- SET `worklog.invoice_line_id`.

Single transaction. Audit log entry: `invoice.generated` with `worklog_ids[]`, `total_amount`, `rate_snapshot`.

### Verification

- Generate an invoice → InvoiceLine rows carry the resolved `bill_rate`. Change a project's `bill_rate` AFTER generation → old invoice unchanged; future worklogs on the same project resolve to the new rate (I4).
- Void an invoice → worklogs' `invoice_line_id` cleared, rate-resolution reverts to live. Re-generate → new InvoiceLine with the CURRENT rate.
- Every `bill_rate` PATCH writes one row to `project_rate_history` with old/new values + `changed_by`.
- `HoursSummary` for a manager spanning a tree returns costs using the cascade (G3).

---

## PR 016.10 — Frontend tree views + AI prompt path-aware

### Scope

Update every SPA view that lists projects to render the tree. Update the AI distribute prompt to include the project path so the LLM can disambiguate.

### Files

- [frontend/src/components/ProjectsView.tsx](frontend/src/components/ProjectsView.tsx) — tree with collapse/expand, type-icon, archived-toggle
- [frontend/src/components/ClientDetailView.tsx](frontend/src/components/ClientDetailView.tsx) — root-projects-of-client list + "+ new project" button; upstream-link manager removed
- [frontend/src/components/TasksView.tsx](frontend/src/components/TasksView.tsx) — subtree filter
- [frontend/src/components/Calendar/TaskModal.tsx](frontend/src/components/Calendar/TaskModal.tsx) — project picker traverses tree, shows effective-membership projects only
- [frontend/src/components/CommandPalette/index.tsx](frontend/src/components/CommandPalette/index.tsx) — pre-filter task list to the user's effective projects
- [frontend/src/lib/ai/distribute.ts](frontend/src/lib/ai/distribute.ts) — feed task list with `projectPath` (e.g. `"IRN / Backend / API v2"`) per G15
- [frontend/src/lib/ai/prompt.ts](frontend/src/lib/ai/prompt.ts) — system prompt mentions the path field
- [frontend/src/components/ProjectMembershipPanel.tsx](frontend/src/components/ProjectMembershipPanel.tsx) (new) — list direct + inherited members on a project; UI warning when adding a deny that will be overridden by a deeper grant (per G16)

### Verification

- Open `/projects` → tree renders with collapse/expand. Archived projects hidden by default; toggle reveals them.
- Calendar day-form picker → consultant sees only projects they're effectively a member of.
- AI distribute → request body includes `tasks[i].projectPath`; LLM responses reference correct project given two tasks with similar titles in different subtrees.
- Project membership panel → adding a `denied` row when a descendant has an explicit grant warns the user (per G16).

---

## PR 016.11 — Phase D drops + table renames

### Scope

Drop the now-unreachable legacy tables, drop `worklogs.upstream_task_id`, enforce `worklogs.task_id NOT NULL`, rename `native_projects` → `projects` + `native_tasks` → `tasks` (per Q1).

This PR is gated on a pre-flight: grep the codebase confirms zero references to the dropped tables/columns. Refuses to merge if any survive.

### Files

**Schema:**
- `backend/TimeFlow.Data/Migrations/<ts>_DropLegacyTablesAndRename.cs`
  - DROP TABLE `client_upstream_projects`, `squads`, `squad_members`, `upstream_projects`, `upstream_tasks`
  - ALTER TABLE `worklogs` DROP COLUMN `upstream_task_id`
  - ALTER TABLE `worklogs` ALTER COLUMN `task_id` SET NOT NULL
  - ALTER TABLE `native_projects` RENAME TO `projects`
  - ALTER TABLE `native_tasks` RENAME TO `tasks`
  - Rename associated indexes / constraints / FKs to match new names

**Code:**
- Rename `NativeProject` → `Project`, `NativeTask` → `Task` across the C# codebase (refactor: ~80 files)
- Rename `native_projects` references in any raw SQL or migrations docs
- Drop `Squad`, `SquadMember`, `UpstreamProject`, `UpstreamTask`, `ClientUpstreamProject` model classes
- Drop endpoints: `SquadEndpoints.cs`, any `/api/orgs/{id}/client-upstream-links` routes
- Drop frontend components that referenced the legacy concepts (any remaining squad UI, upstream-link manager UI)

### Pre-flight gate

Add a CI check `grep -r "upstream_projects\|upstream_tasks\|client_upstream_projects\|squads\|squad_members\|SquadMember\|UpstreamProject\|UpstreamTask\|ClientUpstreamProject" backend frontend` returns zero hits. The PR cannot merge if hits remain.

### Verification

- Migration applies cleanly. Existing data is intact (everything was already mirrored in PR 016.2–016.5).
- `dotnet test` passes — model renames propagate.
- Frontend builds — no dead imports.
- All endpoints return identical responses as the day before PR 016.11 (no behaviour change in this PR).

### Risks

- Renames are intrusive — review carefully for stale string references in raw SQL, dashboard queries, or comments that grep doesn't catch.
- Rolling back this PR requires restoring the legacy tables from a backup. Coordinate with the on-call DBA before deploy.

---

## End-to-end verification (after all PRs land)

The spec's smoke test (steps 1–17) becomes the acceptance bar. Map each step to the PR that introduces it:

| Spec smoke step | Introduces it |
|---|---|
| 1–3 (org + client + connection w/ client_id) | 016.6 |
| 4 (sync creates tree) | 016.6 |
| 5 (add consultant as project_member) | 016.8 |
| 6 (consultant queries org-projects → succeeds) | 016.8 |
| 7 (consultant logs hours → accepted) | 016.8 + 016.7 |
| 8 (denied subproject hidden) | 016.8 |
| 9 (invoice rolls up subtree) | 016.7 + 016.9 |
| 10 (cycle 409) | 016.7 |
| 11 (squad → project type=team migrated) | 016.3 |
| 12 (I1/I2 deny-and-regrant) | 016.8 |
| 13 (I3 bill_rate cascade) | 016.7 + 016.9 |
| 14 (I4 rate snapshot at invoice time) | 016.9 |
| 15 (I5 soft-delete fallback) | 016.7 |
| 16 (I6 cross-client re-parent rejected) | 016.7 |
| 17 (I9 last-manager guard) | 016.8 |

Run all 17 against a staging environment after PR 016.10 merges (so the SPA can drive them); PR 016.11 should not change any of these behaviours.

## Risks & open follow-ups

- **Sync job behaviour during PR 016.6 deployment**: existing sync runs against the old `upstream_*` tables while the new code writes BOTH. After the rollout window, drop the dual-write in PR 016.11. If a sync runs mid-deploy, idempotency keeps it safe.
- **Backfill performance**: PRs 016.2–016.5 each run synchronously inside the EF migration. For a customer with >10k upstream tasks, this could exceed the 5-minute migration cap on the deploy hook. Mitigation: move backfills to async background jobs triggered by a no-op migration that schedules them, drain before declaring the rollout done. Decide before PR 016.2 lands.
- **Cross-tenancy in `project_members`**: the schema doesn't forbid adding a foreign-org user as a project_member of an Org-A project. That IS the consultant pattern. But it widens the data-access blast radius — confirm with the security/legal stakeholder before PR 016.8 ships.
- **Cycle prevention is app-level, not DB-level**: a direct SQL update bypasses the check. Acceptable for v1 (no SQL access in the product); revisit if we ever expose raw SQL.
- **`projects.code` uniqueness on subprojects is app-enforced** (I10): a race between two PATCHes setting the same code could slip through. Mitigation: wrap the check + write in a transaction with `SELECT … FOR UPDATE` on the root.
- **Multi-currency** (Q8/G27): every rate column in this design is bare. When multi-currency lands, expect a follow-up migration adding `currency` companions to: `clients.default_bill_rate`, `projects.bill_rate`, `project_members.cost_per_hour`, `org_memberships.cost_per_hour`, `invoice_lines.bill_rate`, and the three `*_rate_history` tables. The work is mostly mechanical but touches every billing endpoint.

## Out of scope for this plan

- The actual code changes (each PR will be planned in its own session against this roadmap).
- UI design for the tree view, project picker, membership panel.
- Performance benchmarks (target: 5-level trees comfortable; benchmark on first customer >10 levels).
- The eventual `POST /clients/{x}/transfer-projects-to/{y}` endpoint (Q10 deferred).
- Migration rollback runbook (DBA topic; produced separately).
