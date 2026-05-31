---
name: start-pr
description: Kick off a numbered PR from a plan file in plans/. Reads the named section, hands off to pr-orchestrator for sequencing + dispatch. Usage:&nbsp; /start-pr 016.3
---

# /start-pr — drive a plan section to a working PR

## What it does

You're being asked to start a specific PR from a plan file (e.g. plan 016 PR 016.3).

## Steps

1. Resolve the PR number from the args. If the user wrote just a section number like `016.3`, find the matching plan file in `plans/` (likely `plans/016-*.md`). If ambiguous, ask the user.
2. Read the matching `## PR <number>` section from that plan file. If the section isn't there, stop and tell the user.
3. **Invoke the `pr-orchestrator` agent** with the full section text as context. The orchestrator will:
   - Identify which specialists to run
   - Sequence the work (schema → backfill → endpoint → reviewer)
   - Dispatch in parallel where dependencies allow
   - Run the quality gates
4. Surface the orchestrator's status report back to the user.

## Hard rules

- Do NOT skip the orchestrator. The handoff lives there for a reason — it knows the agent roster and the dependency graph.
- Do NOT mutate the plan file. It's the spec, not a scratchpad.
- If the user wants to deviate from the plan ("skip the backfill, just write the endpoint"), confirm the deviation before proceeding. Plan sections are dependency-linked; dropping one can break later PRs.

## Reporting

Forward the orchestrator's summary verbatim, plus your own "next action" pointer (typically the next PR section to start, or a verification step the user should run locally).
