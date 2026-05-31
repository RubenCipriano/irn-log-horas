# Plan 011 — Ownership transfer flow

**Created**: 2026-05-25
**Depends on**: Plan 009 (`requireOrgRole`, typed errors, audit pipeline)
**Status**: Spec ready. Not started.

> Plan 009's account-delete refusal currently says *"Delete the organisation first, or have another Owner remove you."* That escape hatch only exists for orgs with another Owner — the sole-Owner case is a dead end without this flow. Plan 011 makes promotion + ownership handoff possible without involving support.

---

## 1. Why this slice exists

The hard refusal in [account/delete/route.ts](apps/cloud/app/api/account/delete/route.ts) blocks GDPR Art. 17 (right to erasure) for sole Owners. The current options are:
- Delete the org (and lose all the work)
- Beg support to escalate someone else

Neither is acceptable for a paying customer. The flow we want:
1. Owner promotes another member to Owner
2. Original Owner can now delete their account (the other Owner keeps the org running)
3. OR Owner explicitly transfers ownership (atomic: new Owner gains the role, old Owner drops back to Admin)

This is also the missing primitive for "I'm leaving the company; please hand off the org" — a real customer-success situation.

---

## 2. Scope

### In scope

- **Promote a member to Owner**: `PATCH /api/orgs/[id]/memberships/[userId]` with `{ role: "owner" }`. The org now has 2 Owners.
- **Demote an Owner to Admin** (only by another Owner): same endpoint with `{ role: "admin" }`. Refuses if it would leave the org without an Owner.
- **Explicit transfer (atomic)**: `POST /api/orgs/[id]/transfer` with `{ newOwnerUserId, password }`. In one transaction: new user → Owner, calling Owner → Admin. Auditable single action.
- **UI** in `/settings/members`: each row in the members table grows a role dropdown for Owners + Admins (RBAC-gated). The Owner row also exposes a "Transfer ownership" action.
- **Password challenge** on the transfer endpoint (parallels org-delete — irreversible role change deserves the same gate).
- **Audit**: `member.role_changed` (already in the enum) with diff `{ before, after }` for promotions/demotions; new action `org.ownership_transferred` for the atomic transfer.

### Explicitly out of scope (defer)

- Self-service "I want to leave this org" flow (separate UX — needs the leaving party to give up their seat without disturbing others)
- Time-bounded "scheduled handoff" (date-of-transfer in the future)
- Multi-step approval (e.g. board sign-off) — over-engineered for agency scale
- Notification to the org's other Admins (would need email infra — out of scope; surface in audit log)

### What success looks like

- A sole Owner can promote a Manager to Owner, then delete their own account
- A transfer creates a single audit row, not two — admins reconciling history see one event
- Demoting the last Owner is rejected with a clear 409
- The promotion / transfer flows surface in `/settings/members` only for users with the right role (Owners + Admins can promote-to-Admin; only Owners can promote-to-Owner or transfer)

---

## 3. Prerequisites

None new. RBAC matrix already has `members.assign_roles` (Owner + Admin). Plan 011 introduces a sub-rule: assigning the Owner role itself requires the actor to BE an Owner, not just Admin — encoded in the endpoint, not in the matrix (the matrix is a coarse gate; the fine rule lives at the route).

---

## 4. Security checks

| Check | Where |
|---|---|
| `requireOrgRole(orgId, "admin")` gates the membership PATCH; **additional check** that promoting TO `owner` requires the actor's role to be `owner` (not just admin) | `apps/cloud/app/api/orgs/[id]/memberships/[userId]/route.ts` |
| `requireOrgRole(orgId, "owner")` gates the explicit transfer endpoint | `apps/cloud/app/api/orgs/[id]/transfer/route.ts` |
| Transfer takes a password challenge via `auth.api.signInEmail` — same pattern as org-delete (plan 009 §5.2) | same |
| Demote-last-Owner refusal: count `(org, "owner")` rows BEFORE applying — if `count === 1` and the demote target is that lone Owner, return 409 | both endpoints, shared helper `lib/org-roles.ts` |
| Audit: `member.role_changed` for individual promotions/demotions; new `org.ownership_transferred` for atomic transfer (diff = `{ fromUserId, toUserId }`); failed password attempts on transfer are audited (parallels org-delete) | both endpoints |
| Target user must be a member of the org (tenant isolation) | shared helper |
| Self-edit refusal: an Owner can NOT demote themselves via PATCH alone — they must use the transfer flow (which atomically promotes someone else first) | membership PATCH endpoint |

---

## 5. Implementation phases

### 5.1 Shared helper *(0.5h)*

`apps/cloud/lib/org-roles.ts`:
- `countOwners(orgId): Promise<number>`
- `assertNotLastOwnerDemotion(orgId, targetUserId, newRole)` — throws `ConflictError` if the change would orphan
- `assertTargetIsOrgMember(orgId, targetUserId)` — throws `NotFoundError` if not a member

### 5.2 Membership PATCH endpoint *(1h)*

`apps/cloud/app/api/orgs/[id]/memberships/[userId]/route.ts`:
```typescript
export async function PATCH(req, { params: Promise<{ id, userId }> }) {
  const { id: orgId, userId: targetUserId } = await params;
  const { userId: actorId, role: actorRole } = await requireOrgRole(orgId, "admin");

  const body = await req.json();
  const newRole = body.role; // validate against ORG_ROLES

  // Sub-rule: only Owners can grant Owner.
  if (newRole === "owner" && actorRole !== "owner") {
    throw new ForbiddenError("Only Owners can promote to Owner");
  }
  // Self-demotion blocked here; the transfer endpoint handles it atomically.
  if (targetUserId === actorId && newRole !== actorRole) {
    throw new ConflictError("Use the transfer endpoint to change your own role");
  }
  await assertTargetIsOrgMember(orgId, targetUserId);
  await assertNotLastOwnerDemotion(orgId, targetUserId, newRole);

  await db.update(orgMemberships).set({ role: newRole }).where(...);
  await appendAudit({ action: "member.role_changed", diff: { ... } });
  return NextResponse.json({ ok: true });
}
```

### 5.3 Transfer endpoint *(1h)*

`apps/cloud/app/api/orgs/[id]/transfer/route.ts`:
```typescript
export async function POST(req, { params: Promise<{ id }> }) {
  const { id: orgId } = await params;
  const { userId: actorId } = await requireOrgRole(orgId, "owner");

  const body = await req.json();
  if (!body.newOwnerUserId || !body.password) throw new BadRequestError(...);
  if (body.newOwnerUserId === actorId) throw new ConflictError("Already the Owner");
  await assertTargetIsOrgMember(orgId, body.newOwnerUserId);

  // Password challenge — discard the transient session cookie.
  const session = await auth.api.getSession({ headers: await headers() });
  try {
    await auth.api.signInEmail({ body: { email: session.user.email, password: body.password } });
  } catch {
    await appendAudit({ action: "org.ownership_transferred", diff: { blocked: true, reason: "wrong_password" } });
    throw new ConflictError("Password verification failed");
  }

  // Atomic: new user gets owner, old owner drops to admin.
  await db.transaction(async (tx) => {
    await tx.update(orgMemberships)
      .set({ role: "owner" })
      .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, body.newOwnerUserId)));
    await tx.update(orgMemberships)
      .set({ role: "admin" })
      .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, actorId)));
  });

  await appendAudit({
    orgId, actorId,
    action: "org.ownership_transferred",
    resourceType: "organisation",
    resourceId: orgId,
    diff: { fromUserId: actorId, toUserId: body.newOwnerUserId },
  });
  return NextResponse.json({ ok: true });
}
```

New audit action `org.ownership_transferred` added to `auditActions` in [packages/db/src/schema/audit.ts](packages/db/src/schema/audit.ts).

### 5.4 Members UI *(1.5h)*

Update `apps/cloud/app/settings/members/admin.tsx`:
- Role dropdown per row — values filtered by RBAC rules (Owner row excluded for non-Owners; promote-to-Owner option excluded if actor isn't Owner)
- Owner-only "Transfer ownership" action opens a confirm modal: pick replacement Owner from a member list + password challenge
- Confirm modal reuses the password-input pattern from [delete-org-form.tsx](apps/cloud/app/settings/account/delete-org-form.tsx)

### 5.5 Account-delete copy update *(0.25h)*

Update [account/delete/route.ts](apps/cloud/app/api/account/delete/route.ts) hint text:
- Was: `"Promote another member to Owner first, or delete the org."`
- New: `"Promote another member to Owner first (Settings → Members), or delete the org."`

### 5.6 README + CLAUDE.md *(0.25h)*

- README changelog entry
- CLAUDE.md security-baseline section grows a row for ownership transfer

---

## 6. Verification

1. Org with one Owner + one Manager: Owner promotes Manager → both are Owners. Owner deletes account → succeeds (no sole-Owner orphan).
2. Org with one Owner: try to demote → 409 "would leave org without Owner".
3. Owner transfers to Manager with wrong password → 409, audit shows blocked attempt.
4. Owner transfers to Manager with correct password → single audit row `org.ownership_transferred`, both memberships updated atomically.
5. Admin tries to promote a Developer to Owner → 403 "Only Owners can promote to Owner".

---

## 7. Acceptance criteria

- [ ] `PATCH /api/orgs/[id]/memberships/[userId]` exists, gates on `requireOrgRole(orgId, "admin")` + sub-rule for Owner grants
- [ ] `POST /api/orgs/[id]/transfer` exists, gates on Owner + password challenge
- [ ] Demoting the last Owner returns 409
- [ ] Audit captures both promotions and atomic transfers
- [ ] `/settings/members` UI gates role dropdowns correctly
- [ ] Account-delete hint text updated
- [ ] README changelog entry written

---

## 8. Estimated effort

- §5.1 shared helper: 0.5h
- §5.2 membership PATCH: 1h
- §5.3 transfer endpoint: 1h
- §5.4 members UI: 1.5h
- §5.5/§5.6 polish/docs: 0.5h

**Total: ~4.5h / half day.**

---

## 9. Follow-up plans

- **Plan 012** — Apps/web → cloud localStorage migration prompt (still pending).
- **Plan 010-B** — Calendar MVP port (deferred from plan 010).
- Self-service "leave this org" flow (small, follow-up of this plan).
