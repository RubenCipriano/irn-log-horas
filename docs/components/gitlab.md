# GitLab Integration

Pulls the user's recent commits/MRs to use as evidence in AI plans.

## Key files

- `lib/gitlab/client.ts` — `fetchActivity({ baseUrl, token, since, before })`.
  Hits `/events?action=pushed` (commits) and `/merge_requests?scope=created_by_me`.
  Extracts `refIds` via `extractTaskIds(text)` (matches `#32195`, `wp-32195`,
  bare 4-6 digit numbers).
- `app/api/gitlab/activity/route.ts` — proxy. Token in request body
  per-call, never persisted server-side.
- `hooks/useGitLabConfig.ts` — localStorage `gitlab_config_v1`.
- `hooks/useGitLabActivityCheck.ts` — fires on app mount to count today's
  activity for the proactive banner.
- `components/Layout/GitLabBanner.tsx` — dismissible chip rendered in
  TopBar when activity > 0.

## Banner UX

When `gitlabConfig` exists and today's activity > 0, the TopBar renders:

```
[● 5 commits hoje · revisar com IA]
```

Click → opens the palette pre-filled with "Revisa a minha atividade GitLab
de hoje e propoe alteracoes (estado + horas)." and range = `day`. The
banner is dismissable (persisted to `gitlab_banner_dismissed_at_v1`); it
reappears the next day.

## How the AI uses the activity

`lib/ai/orchestrator.ts` does three things:

1. **Baseline** — exact ID match (`#X` in commit/MR title → task `X`) and
   fuzzy fallback if no `#X` is present. Each match becomes a
   `log_hours` baseline item the LLM can override or augment.
2. **Context** — the deduped activity list is sent to the LLM in the
   `atividade_gitlab` field. The model uses it as evidence, not as
   instruction. The charter's "REGRA CRITICA para refIds" prevents the
   model from substituting unmatched refIds with random keyword matches.
3. **Summary form** — when > 30 unique activities, the list is collapsed
   to a per-day summary (`{d, c, m, r, t}` per day) to save tokens.
