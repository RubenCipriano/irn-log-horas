---
name: check-cache-contract
description: Scan the current diff (or staged changes) for cache-aside contract violations — reads without GetOrSetAsync, mutations without InvalidateTagsAsync, tag drift, TTL outliers. Hands off to caching-reviewer.
---

# /check-cache-contract — verify cache invariants

## What it does

Runs the `caching-reviewer` agent against the current diff. Catches the load-bearing cache-aside contract violations BEFORE they ship and cause stale reads.

## Steps

1. Identify the diff scope: prefer `git diff main...HEAD`. If the user has uncommitted work, also include `git diff HEAD`.
2. Bound the scan to the relevant paths:
   ```
   backend/TimeFlow.Api/Endpoints/
   backend/TimeFlow.Cache/
   backend/TimeFlow.Api/Services/   # mutations also live in services
   ```
3. **Invoke `caching-reviewer`** with the diff scope.
4. Forward the verdict to the user.

## Reporting

The caching-reviewer returns a finding list with verdict PASS or BLOCK. Forward verbatim. If BLOCK, the user must fix before merging.
