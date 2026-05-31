---
name: check-authz
description: Scan the current diff for authz/security gaps — endpoints missing RequireOrgPermission, session-derived orgIds, secrets in logs, FK cascade direction. Hands off to rbac-security-reviewer.
---

# /check-authz — verify auth + security invariants

## What it does

Runs the `rbac-security-reviewer` agent against the current diff. Catches the load-bearing authz contract violations BEFORE they ship.

## Steps

1. Identify the diff scope: `git diff main...HEAD` + any uncommitted work in:
   ```
   backend/TimeFlow.Api/Endpoints/
   backend/TimeFlow.Auth/
   backend/TimeFlow.Rbac/
   backend/TimeFlow.Vault/
   backend/TimeFlow.Data/Models/   # FK changes
   ```
2. **Invoke `rbac-security-reviewer`** with the diff scope.
3. Forward the verdict to the user.

## Reporting

Reviewer returns a finding list with verdict PASS or BLOCK. Forward verbatim. BLOCKER findings (missing auth gate, session-derived orgId, secrets in logs) must be fixed before merge.
