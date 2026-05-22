import type { GitLabConfig, GitLabActivity } from "@/types";
import { assertValidExternalUrl } from "@/lib/security/url-validation";
import { genericUpstreamError } from "@/lib/security/safe-error";

// Extract OpenProject task IDs from free text. Matches "#32227", "wp-32227", or bare
// 4-6 digit numbers in commit titles / branch names.
export function extractTaskIds(text: string): string[] {
  if (!text) return [];
  const ids = new Set<string>();
  const re = /(?:^|[\s#!\/_\-])(?:wp[-_]?|#)?(\d{4,6})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    ids.add(m[1]);
  }
  return Array.from(ids);
}

// Condense an MR description into a short, single-line excerpt for the AI
// prompt. Strips markdown noise (headings, list/quote markers, emphasis) and
// collapses whitespace so the model gets readable context at a bounded token
// cost. Returns undefined for empty/blank input.
function snippetOf(text: string | undefined, max = 240): string | undefined {
  if (!text) return undefined;
  const cleaned = text
    .replace(/```[\s\S]*?```/g, " ")   // drop fenced code blocks
    .replace(/[#>*_`~|-]+/g, " ")       // markdown markers
    .replace(/\s+/g, " ")               // collapse whitespace/newlines
    .trim();
  if (!cleaned) return undefined;
  return cleaned.length > max ? cleaned.slice(0, max).trimEnd() + "…" : cleaned;
}

async function gitlabFetch(config: GitLabConfig, path: string): Promise<unknown> {
  // Validate the user-supplied base URL before building an outbound request.
  const base = assertValidExternalUrl(config.baseUrl);
  const url = `${base}/api/v4${path.startsWith("/") ? "" : "/"}${path}`;
  const response = await fetch(url, {
    headers: {
      "PRIVATE-TOKEN": config.accessToken,
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    // Never include the raw upstream body — a GitLab error can echo the token.
    throw new Error(genericUpstreamError("GitLab", response.status));
  }
  return response.json();
}

export async function fetchCurrentUser(config: GitLabConfig): Promise<{ id: number; username: string; name: string }> {
  const data = await gitlabFetch(config, "/user") as { id: number; username: string; name: string };
  return data;
}

function shiftDayKey(dayKey: string, deltaDays: number): string {
  const d = new Date(dayKey + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

export async function fetchRecentActivity(config: GitLabConfig, since: Date, until?: Date): Promise<GitLabActivity[]> {
  const isoSince = since.toISOString().split("T")[0];

  // GitLab events: `before` is EXCLUSIVE (events created before that day).
  // To get an INCLUSIVE upper bound on `until`, pass `until + 1 day`.
  let eventsPath = `/events?action=pushed&after=${encodeURIComponent(isoSince)}&per_page=100`;
  if (until) {
    const beforeKey = shiftDayKey(until.toISOString().slice(0, 10), 1);
    eventsPath += `&before=${encodeURIComponent(beforeKey)}`;
  }

  // Fetch the user's commit pushes
  const events = await gitlabFetch(
    config,
    eventsPath,
  ) as Array<{
    id: number;
    created_at: string;
    project_id: number;
    push_data?: {
      commit_title?: string;
      commit_count?: number;
      ref?: string;
    };
  }>;

  const projectsCache = new Map<number, string>();
  async function projectName(projectId: number): Promise<string> {
    if (projectsCache.has(projectId)) return projectsCache.get(projectId)!;
    try {
      const p = await gitlabFetch(config, `/projects/${projectId}`) as { path_with_namespace?: string; name?: string };
      const name = p.path_with_namespace || p.name || `Project ${projectId}`;
      projectsCache.set(projectId, name);
      return name;
    } catch {
      return `Project ${projectId}`;
    }
  }

  const commitActivities: GitLabActivity[] = await Promise.all(
    events
      .filter(e => e.push_data?.commit_title)
      .map(async (e) => {
        const title = e.push_data!.commit_title || "";
        const ref = e.push_data!.ref || "";
        const project = await projectName(e.project_id);
        const refIds = Array.from(new Set([...extractTaskIds(title), ...extractTaskIds(ref)]));
        return {
          type: "commit" as const,
          title,
          project,
          createdAt: e.created_at,
          refIds,
          url: `${config.baseUrl.replace(/\/$/, "")}/${project}/-/commits/${ref.replace(/^refs\/heads\//, "")}`,
        };
      })
  );

  // Fetch the user's MRs — GitLab `updated_before` is INCLUSIVE on the timestamp.
  // Set it to end-of-day on `until` so we capture all MRs touched that day.
  let mrPath = `/merge_requests?scope=created_by_me&state=all&updated_after=${encodeURIComponent(since.toISOString())}&per_page=50`;
  if (until) {
    const eod = new Date(until);
    eod.setUTCHours(23, 59, 59, 999);
    mrPath += `&updated_before=${encodeURIComponent(eod.toISOString())}`;
  }

  const mrs = await gitlabFetch(
    config,
    mrPath,
  ) as Array<{
    title: string;
    description?: string;
    updated_at: string;
    created_at: string;
    web_url: string;
    references?: { full?: string };
    project_id: number;
    source_branch?: string;
  }>;

  const mrActivities: GitLabActivity[] = await Promise.all(
    mrs.map(async (mr) => {
      // The MR description often carries the OpenProject id (e.g. "Refs: #32195")
      // even when the title doesn't — parse it for a deterministic match.
      const refIds = Array.from(new Set([
        ...extractTaskIds(mr.title),
        ...extractTaskIds(mr.source_branch || ""),
        ...extractTaskIds(mr.description || ""),
      ]));
      const project = await projectName(mr.project_id);
      return {
        type: "merge_request" as const,
        title: mr.title,
        project,
        createdAt: mr.updated_at || mr.created_at,
        refIds,
        url: mr.web_url,
        descriptionSnippet: snippetOf(mr.description),
      };
    })
  );

  return [...commitActivities, ...mrActivities].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
