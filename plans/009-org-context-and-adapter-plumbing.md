# Plan 009 — Phase 3 slice 2 (part A): Org context fix + adapter plumbing + connect modal + /projects

**Created**: 2026-05-25 (immediately after plan 008 validation)
**Depends on**: Plan 008 (especially §3.2, §4.0, §4.1, §4.2) — read 008 first
**Status**: Ready to execute. This is the first of two plans that together implement plan 008 §4.
**Out of scope**: The calendar view (§4.5) — that's plan 010. Sync layer for AI (§4.4) — deferred until Inngest. Log-hours through adapter (§4.3) — plan 010.

> This plan is the **executable** version of plan 008 §3.2 + §4.0 + §4.1 + §4.2 + the org-delete hardening from plan 008 §2.1. Plan 008 is the strategic doc; this is the day-by-day implementation. Read it linearly.

---

## 1. Why this slice exists

Plan 008 identifies two blockers between "TimeFlow as it is" and "TimeFlow as advertised":

1. **Auth context flaw** (`getCurrentMembership` returns oldest org) — a user who is Owner in Org A and Developer in Org B always appears as Owner. Plan 008 §3.2 elevates this from UX to security. Must fix before adding more authorisation surface area.
2. **Cloud doesn't actually use the OpenProject adapter** — the entire moat ("same product as web, multi-tenant") is unrealised because no UI calls the adapter. Plan 008 §4 lays out 5 sub-slices; this plan implements the first two foundations.

Once this slice lands, a Manager in Org A can connect OpenProject, browse projects from the cloud, and the role check on every request resolves against the org in the URL — not the oldest session membership.

---

## 2. Scope

### In scope

- Per-request org resolution (replace `getCurrentMembership` use in API routes with `requireOrgRole(req, orgId, role)`)
- URL-scoped routes for the new surfaces (`/[orgSlug]/projects`, `/[orgSlug]/projects/[source]/[id]`) — interim until the broader `/[orgSlug]/*` migration in Phase 4
- Org-delete hardening per plan 008 §2.1 (password challenge + type-org-name)
- Adapter context plumbing (`apps/cloud/lib/adapter-ctx.ts`, `apps/cloud/lib/adapter.ts`)
- Per-`(org, integrationId)` rate limiter wired in the adapter context
- Typed config shapes per adapter (`OpenProjectConfig`, `JiraConfig`, `LinearConfig`) added to `packages/integrations/types.ts`
- New required field on `IProjectIntegration`: `configSchema`
- Generic `<ConnectIntegrationModal>` component
- `/[orgSlug]/projects` page (server-rendered, unified list of Native PM + connected integrations)
- `/[orgSlug]/projects/[source]/[id]` page (project detail with task list)
- Four documented error states per plan 008 §4.2

### Explicitly out of scope (defer to plan 010)

- Log-hours flow through adapter
- Calendar view
- AI sync layer
- GitLab overlay
- Apps/web localStorage migration prompt
- Org-ownership transfer flow (separate plan; see §10 below)

### What success looks like

- A Manager who is also a Developer elsewhere gets the correct role for every request based on the URL, not their oldest membership
- An Owner can delete their org after password re-auth + typing the org name
- An Admin in the marketplace clicks "Connect" on Jira → modal opens → enters credentials → row is saved
- A Developer navigates to `/[orgSlug]/projects` and sees a unified card grid of Native PM projects + their connected OpenProject projects (real data, real API call, cached for 5 min)
- A token-expired OpenProject connection renders the documented error state, not a blank page

---

## 3. Prerequisites (must resolve before §5)

### 3.1 Upstash Redis (blocking for §5.5)

Provision an Upstash Redis instance (free tier sufficient for dev / small orgs):

1. Create account at upstash.com → New Database → name `timeflow-dev`, region close to deploy
2. Copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
3. Add to `.env` (root + apps/cloud) + `.env.example`
4. Verify by hitting `https://<url>/ping` from a curl with Bearer token

If Redis isn't provisioned, the cache layer in §5.5 falls back to a no-op cache (helpers exist in `@timeflow/cache`). The slice still ships; reads just hit upstream every time.

### 3.2 Decision: SWR vs react-query

Plan 008 §4.5 mentions both. **Decision for slice 2**: use **`@tanstack/react-query`**. Reasons: larger 2026 ecosystem, better devtools, integrates with Next 16 server actions better, and we'll need its `useMutation` for log-hours later. Add to `apps/cloud/package.json` once §5.5 starts using it.

### 3.3 Decision: handle the ownership-transfer gap

Plan 008 §2 #5 error tells users to "promote another member to Owner first," but that flow doesn't exist. **Decision**: drop that wording. The error becomes *"Delete the organisation first, or have another Owner remove you."* Ownership transfer is its own plan (§10).

---

## 4. Security fixes that block everything else

Apply before any new endpoints land. Both are direct from plan 008 §3.2.

### 4.1 Org-context resolution (`getCurrentMembership` → `requireOrgRole`)

**Pattern to enforce on every API route:**

```typescript
// apps/cloud/lib/org-context.ts (new file)
export async function requireOrgRole(
  request: Request,
  orgId: string,
  minRole: OrgRole,
): Promise<{ userId: string; role: OrgRole }> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new UnauthorizedError();

  const membership = await db.query.org_memberships.findFirst({
    where: and(
      eq(org_memberships.userId, session.user.id),
      eq(org_memberships.orgId, orgId), // <-- resolved from REQUEST, not session
    ),
  });
  if (!membership) throw new ForbiddenError("Not a member of this org");
  if (roleRank(membership.role) < roleRank(minRole)) {
    throw new ForbiddenError(`Requires ${minRole} or above`);
  }

  return { userId: session.user.id, role: membership.role };
}
```

**Where orgId comes from** (in priority order):
1. URL path parameter (`/[orgSlug]/...` → resolve slug → orgId)
2. Request body (for endpoints that don't have slug in path yet)
3. Query string (last resort)

**Migration of existing endpoints:** every route currently using `getCurrentMembership(session.user.id)` must be rewritten to use `requireOrgRole(request, orgId, minRole)`. Audit checklist:

| Route | Current | Must change to |
|---|---|---|
| `POST /api/orgs/[id]/delete` | session-based | `requireOrgRole(request, params.id, "owner")` |
| `PATCH /api/preferences/approval-mode` | session-based + orgId in body | `requireOrgRole(request, body.orgId, "developer")` |
| `POST /api/integrations/openproject` | session-based | `requireOrgRole(request, body.orgId, "admin")` |
| All `/api/orgs/[id]/...` endpoints | mixed | uniformly `requireOrgRole(request, params.id, X)` |

**`getCurrentMembership` is NOT deleted** — it still has a legitimate use for "the home page where the user lands picks an org". Rename to `pickLandingOrg(userId)` and add a JSDoc warning that it must NEVER be used for authorisation decisions.

### 4.2 Org-delete hardening (plan 008 §2.1)

Tonight's `/api/orgs/[id]/delete` route is missing:
- Password re-auth challenge
- Type-org-name confirmation in the UI
- Cascade order is incomplete (relied on FK CASCADE, but plan 008 §2.1 specifies an explicit order with audit step inserted)

Apply this fix as part of §5.2 below.

---

## 5. Implementation phases

### 5.1 Org-context helper *(half day)*

**Files:**
- `apps/cloud/lib/org-context.ts` — new file with `requireOrgRole`, `pickLandingOrg`, `roleRank`, `slugToOrgId`
- `apps/cloud/lib/errors.ts` — new file with typed `UnauthorizedError`, `ForbiddenError`, `NotFoundError` + a `toResponse(err)` helper that maps to NextResponse
- `apps/cloud/lib/session.ts` — deprecate `getCurrentMembership` (keep export, add `@deprecated` JSDoc); add `pickLandingOrg(userId)` as the legitimate use

**Tests** (write `apps/cloud/__tests__/org-context.test.ts` — first test file in cloud, blesses the pattern):
- User who's Owner in A and Developer in B: `requireOrgRole(req for A, "owner")` passes; `requireOrgRole(req for B, "owner")` returns 403
- Non-member: 403 with "Not a member of this org" (no info leak about whether the org exists)
- Missing session: 401
- Role hierarchy: Manager can use `requireOrgRole(req, "developer")` (Manager > Developer)

### 5.2 Migrate every existing API route to `requireOrgRole` *(half day)*

Grep for `getCurrentMembership` in `apps/cloud/app/api/`:

```
grep -rn "getCurrentMembership" apps/cloud/app/api/
```

For each match:
1. Determine the orgId source (path param > body > query)
2. Replace with `await requireOrgRole(request, orgId, MIN_ROLE)`
3. Use the returned `{ userId, role }` for the rest of the handler
4. Verify the test for that endpoint still passes (or add one)

**Org-delete (`/api/orgs/[id]/delete`) gets the additional hardening:**

```typescript
const { userId } = await requireOrgRole(request, orgId, "owner");

// Password re-auth challenge
const body = await request.json();
if (!body.password) throw new UnauthorizedError("Password required");
const passwordOk = await auth.api.verifyPassword({ userId, password: body.password });
if (!passwordOk) throw new UnauthorizedError("Password incorrect");

// Confirm by org name
const org = await db.query.organisations.findFirst({ where: eq(organisations.id, orgId) });
if (body.confirmName !== org.name) throw new BadRequestError("Org name doesn't match");

// Audit BEFORE delete
await db.insert(auditLog).values({ /* org.deleted, before cascade */ });

// Cascade — relies on FK ON DELETE CASCADE where defined; explicit DELETE for
// tables where FK is SET NULL (audit_log) or where order matters.
await db.transaction(async (tx) => {
  await tx.delete(organisations).where(eq(organisations.id, orgId));
  // FK cascades handle the rest. The actual cascade order from plan 008 §2.1 should
  // be VERIFIED against the schema's FK definitions — if any expected cascade is
  // missing (e.g. a new table added without `onDelete: "cascade"`), add explicit
  // tx.delete() calls in the correct order.
});
```

### 5.3 URL-scoped routes for the new surfaces *(half day)*

Create the `app/[orgSlug]/` route group. Initial pages: `projects/`, `projects/[source]/[id]/`.

**Slug resolution at layout level** (`apps/cloud/app/[orgSlug]/layout.tsx`):

```typescript
export default async function OrgLayout({
  params,
  children,
}: {
  params: Promise<{ orgSlug: string }>;
  children: React.ReactNode;
}) {
  const { orgSlug } = await params;
  const session = await requireSession();
  const org = await db.query.organisations.findFirst({
    where: eq(organisations.slug, orgSlug),
  });
  if (!org) notFound();
  const membership = await db.query.org_memberships.findFirst({
    where: and(
      eq(org_memberships.userId, session.user.id),
      eq(org_memberships.orgId, org.id),
    ),
  });
  if (!membership) notFound(); // No info leak: looks identical to "org doesn't exist"

  // Provide org context to children via React context (server component compatible)
  return <OrgContextProvider org={org} role={membership.role}>{children}</OrgContextProvider>;
}
```

**Why URL-scoped now, not Phase 4**: because the security fix in §4.1 demands the orgId come from the request, and URL is the cleanest source. We don't have to migrate every other route today — just enforce the pattern for new ones in this slice.

### 5.4 Adapter type extensions + generic connect modal *(half day)*

**Files:**
- `packages/integrations/types.ts` — add `configSchema` field to `IProjectIntegration`. Schema describes the connect form's required fields per adapter.

```typescript
type ConfigFieldSchema = {
  field: string;
  label: string;
  type: "text" | "url" | "password" | "select";
  required: boolean;
  helpText?: string;
  options?: { value: string; label: string }[]; // for "select"
};

interface IProjectIntegration {
  // ...existing fields
  configSchema: ConfigFieldSchema[];
  validateCredentials(config: Record<string, string>): Promise<{ ok: true } | { ok: false; reason: string }>;
}
```

- `packages/integrations/openproject.ts` — add `configSchema: [{ field: "baseUrl", ... }, { field: "token", type: "password", ... }]`
- `packages/integrations/jira.ts` — Jira's `configSchema` for OAuth client ID/secret + cloudId
- `packages/integrations/linear.ts` — Linear's API key + optional team filter

- `apps/cloud/components/ConnectIntegrationModal.tsx` — new generic client component. Reads `configSchema`, renders fields, calls `validateCredentials`, posts to `POST /api/orgs/[id]/integrations`

- `apps/cloud/app/api/orgs/[id]/integrations/route.ts` — new endpoint. Replaces the existing `/api/integrations/openproject` route (the old route stays for one release as a redirect for any external tooling). Handles all integrations via `integrationId` in body.

**Acceptance criteria:**
- [ ] Clicking "Connect" on any of OpenProject / Jira / Linear in the marketplace opens the same modal with adapter-specific fields
- [ ] Invalid credentials surface the adapter's `reason` message (already bucketed for safety)
- [ ] On success, the marketplace row updates to "Connected" without a full page reload

### 5.5 Adapter context plumbing *(half day)*

**Files:**
- `apps/cloud/lib/adapter-ctx.ts` — `buildAdapterCtx(orgId, integrationId): AdapterCtx`. Decrypts credentials from vault, attaches Redis cache client (or no-op fallback), attaches rate limiter scoped to `(orgId, integrationId)`.
- `apps/cloud/lib/adapter.ts` — `getOrgAdapter(orgId, integrationId): { adapter, ctx } | null`. Returns null if no integration is connected (caller renders empty state).

**Rate limiter wiring**: `@timeflow/cache` already has `RateLimiter` from prior work. Wire it here, not in each route:

```typescript
const RATE_LIMITS: Record<string, { perMinute: number }> = {
  openproject: { perMinute: 60 },
  jira: { perMinute: 30 },
  linear: { perMinute: 60 },
};

export async function buildAdapterCtx(orgId, integrationId) {
  const limiter = rateLimiter({
    key: `org:${orgId}:int:${integrationId}`,
    limit: RATE_LIMITS[integrationId]?.perMinute ?? 30,
    window: 60,
  });
  // ...
}
```

When the limit is hit, throw a typed `RateLimitError` — the page component catches and renders the "throttled" error state (plan 008 §4.2 error table).

### 5.6 `/[orgSlug]/projects` and `/[orgSlug]/projects/[source]/[id]` *(half to one day)*

**`/[orgSlug]/projects`** — server component, ISR with 5min revalidation:

```typescript
export const revalidate = 300; // 5 min

export default async function ProjectsPage({ params }) {
  const { orgSlug } = await params;
  const orgId = await slugToOrgId(orgSlug);
  // Layout already verified membership, but we re-fetch org for displayed data

  // Native PM projects — always present
  const nativeProjects = await db.query.native_projects.findMany({
    where: eq(native_projects.orgId, orgId),
  });

  // Integration projects — only if connected
  const integrations = await db.query.org_integrations.findMany({
    where: eq(org_integrations.orgId, orgId),
  });

  const integrationProjects = await Promise.all(
    integrations.map(async (int) => {
      const { adapter, ctx } = await getOrgAdapter(orgId, int.integrationId);
      try {
        const projects = await adapter.listProjects(ctx);
        return { source: int.integrationId, projects };
      } catch (err) {
        return { source: int.integrationId, error: mapAdapterError(err) };
      }
    })
  );

  return <ProjectsGrid native={nativeProjects} integrations={integrationProjects} />;
}
```

**`/[orgSlug]/projects/[source]/[id]`** — same pattern, calls `adapter.listAssignedTasks` if source is an integration.

**Error states** (per plan 008 §4.2): a `<IntegrationErrorState>` component takes a typed error and renders the correct user message + CTA. No blank pages.

### 5.7 Marketplace updates *(quick)*

Existing `/settings/integrations` page already lists adapters. Two changes:

1. The "Connect" button on Jira/Linear (currently disabled or broken) opens the new `<ConnectIntegrationModal>`
2. After connecting, the row updates to "Connected" + shows last-used timestamp

---

## 6. Security checks for this slice

Apply during implementation, not as a separate audit:

| Check | Where |
|---|---|
| Every new API route uses `requireOrgRole`, not `getCurrentMembership` | grep for `getCurrentMembership` in changed files; should only appear in `pickLandingOrg` |
| `requireOrgRole` rejects with 403 (not 404) when user is not a member — but 404 when org doesn't exist? **Decision**: return 404 for both. Don't leak existence of orgs the user isn't in. | `apps/cloud/lib/org-context.ts` |
| Org-delete: password verified server-side via Better Auth, not just checked in UI | `apps/cloud/app/api/orgs/[id]/delete/route.ts` |
| Adapter ctx never logs decrypted credentials | `apps/cloud/lib/adapter-ctx.ts` — explicit comment, no `console.log` of `ctx.credentials` |
| Rate limiter scoped per `(orgId, integrationId)` — never a global key | `apps/cloud/lib/adapter-ctx.ts` |
| Cache keys scoped per `(orgId, integrationId)` — never `org:projects` (cross-org poisoning) | `apps/cloud/app/[orgSlug]/projects/page.tsx` |
| Adapter `validateCredentials` errors bucketed — never raw upstream body | `packages/integrations/*` — existing pattern, verify new adapter additions follow it |

---

## 7. Verification

After implementation, walk through:

1. **Multi-org auth context**: create a user who's Owner in Org A and Developer in Org B. Try to call `DELETE /api/orgs/<B>/delete` (with B's orgId in URL). Should return 403 — "Requires owner or above". Same call against Org A succeeds (with password challenge).

2. **Org delete flow**:
   - Owner in Org X visits `/settings/danger`
   - Clicks Delete Organisation
   - Modal asks for password + types "X" to confirm
   - Submits — cascade runs, redirected to org-selection page
   - Org X no longer appears in their org list

3. **Connect Jira**:
   - Admin in any org visits `/settings/integrations`
   - Clicks Connect on Jira
   - Modal opens with cloudId + client ID + client secret fields
   - Enters bad credentials → "Token rejected by Jira" message (bucketed)
   - Enters real credentials → row updates to "Connected"

4. **`/[orgSlug]/projects` with real data**:
   - User with OpenProject connected visits `/[orgSlug]/projects`
   - Page renders: 1 card per Native PM project + 1 card per real OpenProject project
   - Click an OpenProject project → detail page shows actual tasks assigned to the user
   - Disconnect OpenProject in another tab → refresh → integration projects section shows empty-state CTA, Native PM section unaffected

5. **Error states**:
   - Token-expired: edit `org_integrations.credentials` to invalid ciphertext → page renders "Connection needs re-auth" with link to settings
   - Rate limit: spam refresh 100 times → after limit, "throttled" message with retry button
   - Network: stop OpenProject test instance → "Can't reach OpenProject" with link to settings

---

## 8. Acceptance criteria (the "done" checklist for slice 2 part A)

- [ ] `requireOrgRole` helper exists and is unit-tested
- [ ] Every existing API route in `apps/cloud/app/api/` has been migrated off `getCurrentMembership` (verified by grep returning zero results except in `pickLandingOrg`)
- [ ] Org-delete requires password + type-org-name confirmation
- [ ] `<ConnectIntegrationModal>` works for OpenProject, Jira, and Linear with the same component
- [ ] `getOrgAdapter` returns a working adapter with decrypted credentials + Redis cache + per-`(org, integration)` rate limiter
- [ ] `/[orgSlug]/projects` shows real OpenProject data for a connected org
- [ ] `/[orgSlug]/projects/[source]/[id]` shows real tasks for a project
- [ ] All four error states render with appropriate messages (verified manually per §7)
- [ ] No cross-org cache poisoning (cache keys verified to include `orgId`)
- [ ] CLAUDE.md updated: documents `requireOrgRole` as the new authorisation primitive; documents `pickLandingOrg` as the only legitimate use of session-based org resolution
- [ ] README changelog entry written

---

## 9. Estimated effort

- §5.1 (helper): 4h
- §5.2 (migrate routes): 4h — depends on number of routes; current count is ~12
- §5.3 (URL routing): 4h
- §5.4 (adapter types + connect modal): 4h
- §5.5 (adapter ctx): 4h
- §5.6 (projects pages): 6–8h
- §5.7 (marketplace polish): 1h

**Total: 2.5–3 working days.** Plan 008 §4.6 estimated this as Day 2 + half of Day 3, which is consistent.

---

## 10. Follow-up plans

- **Plan 010** — Slice 2 part B: log-hours through adapter (§4.3) + calendar MVP (§4.5). Depends on this plan landing.
- **Plan 011** — Ownership transfer flow (separate from this slice because it touches role escalation which deserves its own security review). Short plan; ~1 day of work.
- **Plan 012** — Apps/web → cloud migration prompt + localStorage import flow. UX-heavy, deserves its own design pass.

---

## 11. Reading order for tomorrow

1. Read plan 008 in full
2. Read this plan (009) in full
3. Skim §4 (security fixes) of THIS doc again — that's the gate to everything else
4. Provision Upstash (§3.1) before starting §5.5
5. Execute §5.1 → §5.7 in order
6. Verify per §7
7. Mark §8 checklist as you go
8. Write the changelog when done
9. Open plan 010 to continue

**If something blocks you for more than 30min, stop and note it as a gap in §10.** Don't sink hours into rabbit holes — the plan should be revised, not the implementation forced.
