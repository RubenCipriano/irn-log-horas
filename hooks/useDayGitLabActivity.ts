"use client";

import { useCallback, useRef, useState } from "react";
import type { GitLabConfig, GitLabActivity } from "@/types";

// Lazily fetch a single day's GitLab activity (commits + MRs) via the existing
// /api/gitlab/activity proxy. Cached per dayKey for the session so reopening the
// same day doesn't refetch.
export function useDayGitLabActivity(config: GitLabConfig | null) {
  const cache = useRef<Map<string, GitLabActivity[]>>(new Map());
  const [activities, setActivities] = useState<GitLabActivity[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (dayKey: string) => {
    if (!config) {
      setError("GitLab nao configurado.");
      return;
    }
    const cached = cache.current.get(dayKey);
    if (cached) {
      setActivities(cached);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/gitlab/activity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config,
          since: new Date(dayKey + "T00:00:00").toISOString(),
          until: new Date(dayKey + "T23:59:59").toISOString(),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof data?.error === "string" ? data.error : "Falha a obter atividade GitLab.");
        setActivities([]);
        return;
      }
      const acts: GitLabActivity[] = Array.isArray(data.activities) ? data.activities : [];
      cache.current.set(dayKey, acts);
      setActivities(acts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro de rede.");
      setActivities([]);
    } finally {
      setLoading(false);
    }
  }, [config]);

  const clear = useCallback(() => {
    setActivities(null);
    setError(null);
  }, []);

  return { activities, loading, error, load, clear };
}
