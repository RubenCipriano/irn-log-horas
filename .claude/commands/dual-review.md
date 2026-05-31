---
name: dual-review
description: Run the three quality-gate reviewers in PARALLEL on the current diff — caching-reviewer, rbac-security-reviewer, code-reviewer. Add db-migration-reviewer if migrations were touched. Use before merging any backend PR.
---

# /dual-review — parallel reviewer sweep

## What it does

Dispatches the standard backend review gate in parallel (one message, multiple `Agent` tool calls). Returns one consolidated verdict.

## Steps

1. Confirm there's a diff to review:
   ```powershell
   git diff main...HEAD --stat
   ```
   If empty, ask the user what to review.
2. Detect what's in the diff:
   - Endpoints / services / cache touched → `caching-reviewer` + `rbac-security-reviewer` + `code-reviewer`
   - Migrations touched → ALSO `db-migration-reviewer`
   - Models touched (FKs, indexes) → ALSO `db-migration-reviewer`
3. **Dispatch all selected reviewers in parallel** via a single message with multiple `Agent` tool calls. Each reviewer is READ-ONLY so there's no contention.
4. Wait for all to return.
5. Merge the findings into one report, grouped by severity (BLOCKER → MAJOR → MINOR).

## Reporting

```
## Dual-review verdict: <PASS | BLOCK>

### Blockers (N)
[reviewer:category] file:line — Problem. Fix.
...

### Majors (N)
...

### Minors (N)
...

### Reviewers run
- caching-reviewer: PASS/BLOCK
- rbac-security-reviewer: PASS/BLOCK
- code-reviewer: PASS/BLOCK
- db-migration-reviewer (if applicable): PASS/BLOCK
```

Overall verdict is BLOCK if ANY reviewer blocks. Forward to the user with a "next action" pointing at the specialist who can fix the blockers (typically the agent who wrote the affected file).
