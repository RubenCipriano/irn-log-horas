"use client";

import { useCallback, useEffect, useState } from "react";
import type { GitLabConfig } from "@/types";

const DISMISS_KEY = "gitlab_banner_dismissed_at_v1";

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function readDismissed(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

type ActivityCounts = {
  commits: number;
  mrs: number;
  total: number;
};

// On app mount: if gitlabConfig is set, fetch today's activity via the proxy
// route and surface a count for the TopBar banner. Dismissals are per-day.
export function useGitLabActivityCheck(config: GitLabConfig | null) {
  const [counts, setCounts] = useState<ActivityCounts | null>(null);
  const [dismissedToday, setDismissedToday] = useState<boolean>(() => {
    return readDismissed() === todayKey();
  });

  useEffect(() => {
    if (!config) return; // counts stays null/stale; shouldShow gates on config too
    const controller = new AbortController();
    const since = todayKey() + "T00:00:00Z";
    const before = todayKey() + "T23:59:59Z";
    (async () => {
      try {
        const response = await fetch("/api/gitlab/activity", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...config, since, before }),
          signal: controller.signal,
        });
        if (!response.ok) return;
        const data = await response.json();
        const acts = Array.isArray(data?.activities) ? data.activities : [];
        const commits = acts.filter((a: { type?: string }) => a.type === "commit").length;
        const mrs = acts.filter((a: { type?: string }) => a.type === "merge_request").length;
        setCounts({ commits, mrs, total: acts.length });
      } catch {
        // ignore — banner just doesn't show
      }
    })();
    return () => controller.abort();
  }, [config]);

  const dismiss = useCallback(() => {
    setDismissedToday(true);
    try {
      localStorage.setItem(DISMISS_KEY, todayKey());
    } catch {
      // ignore
    }
  }, []);

  return {
    counts,
    dismissedToday,
    dismiss,
    // Gate on config too so a logout-then-relogin doesn't briefly leak the
    // previous user's banner counts.
    shouldShow: !!config && !!counts && counts.total > 0 && !dismissedToday,
  };
}
