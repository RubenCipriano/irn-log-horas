import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_STATUS_WEIGHTS, deriveActiveBounds, inferGaps } from "@/lib/status-timeline";
import type { StatusSegment, TaskStatusTimeline } from "@/types";
import { DEFAULT_TIMELINE_INFERENCE } from "@/types";

// Function to parse ISO 8601 duration format (e.g., PT8H, PT30M, PT1H30M)
function parseIsoDuration(duration: string): number {
  if (!duration) return 0;

  const regex = /PT(?:(\d+)H)?(?:(\d+)M)?/;
  const match = duration.match(regex);

  if (!match) return 0;

  const hours = match[1] ? parseInt(match[1], 10) : 0;
  const minutes = match[2] ? parseInt(match[2], 10) : 0;

  return hours + minutes / 60;
}

function shiftDay(dayKey: string, deltaDays: number): string {
  const d = new Date(dayKey + "T00:00:00");
  d.setDate(d.getDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

// Strip basic markdown emphasis markers and unescape so PT/EN regex can match.
function stripMarkdown(raw: string): string {
  return raw.replace(/[*_`]+/g, "").replace(/\s+/g, " ").trim();
}

// Strip HTML tags for parsing detail.html bodies.
function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

// Try to extract the "new status" from a detail object using all known shapes.
// Returns null if this detail isn't a status change at all.
function extractStatusFromDetail(detail: Record<string, unknown>): string | null {
  // 1. Structured property field
  const property = (detail.property as string | undefined) || (detail.fieldName as string | undefined);
  const dtype = detail._type as string | undefined;
  if (property === "status" || dtype === "StatusChangedActivity") {
    const links = detail._links as { newValue?: { title?: string } } | undefined;
    const newValue = links?.newValue?.title || (detail.newValue as string | undefined) || "";
    const trimmed = newValue.toString().trim();
    if (trimmed) return trimmed;
  }

  // 2. Parse markdown-formatted detail.raw (PT and EN)
  const rawSrc = (detail.raw as string | undefined) || "";
  if (rawSrc) {
    const text = stripMarkdown(rawSrc);
    const pt = text.match(/situa[çc][aã]o\s+alterad[oa]?\s+de\s+.+?\s+para\s+(.+?)(?:\s*$|\.|\n|<)/i);
    if (pt) return pt[1].trim();
    const en = text.match(/status\s+changed?\s+from\s+.+?\s+to\s+(.+?)(?:\s*$|\.|\n|<)/i);
    if (en) return en[1].trim();
  }

  // 3. Fallback: parse detail.html with tags stripped
  const htmlSrc = (detail.html as string | undefined) || "";
  if (htmlSrc) {
    const text = stripHtml(htmlSrc);
    const pt = text.match(/situa[çc][aã]o\s+alterad[oa]?\s+de\s+.+?\s+para\s+(.+?)(?:\s*$|\.|\n)/i);
    if (pt) return pt[1].trim();
    const en = text.match(/status\s+changed?\s+from\s+.+?\s+to\s+(.+?)(?:\s*$|\.|\n)/i);
    if (en) return en[1].trim();
  }

  return null;
}

// Build a TaskStatusTimeline from a flat ordered list of transitions.
// Each transition is the date a NEW status became active.
function buildTimeline(
  taskId: string,
  createdAt: string,
  currentStatus: string,
  updatedAt: string | undefined,
  transitions: { date: string; newStatus: string }[],
): TaskStatusTimeline {
  // Drop transitions dated before createdAt (OpenProject sometimes reports out-of-range timestamps).
  const filtered = transitions.filter(t => t.date && t.newStatus && t.date >= createdAt);

  // De-duplicate by date: if multiple transitions land on the same day, keep the LAST one.
  const byDate = new Map<string, string>();
  for (const t of filtered) byDate.set(t.date, t.newStatus);

  const sorted = Array.from(byDate.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, newStatus]) => ({ date, newStatus }));

  // Always start at createdAt. Prepend "novo" if the first transition is later.
  if (sorted.length === 0 || sorted[0].date > createdAt) {
    sorted.unshift({ date: createdAt, newStatus: "novo" });
  } else if (sorted[0].date === createdAt && sorted[0].newStatus.toLowerCase().includes("novo") === false) {
    // First real transition coincides with createdAt and isn't "novo" — that's fine, no synthetic prepend.
  }

  // If the last recorded transition doesn't match currentStatus, append a synthetic one
  // dated at updatedAt (when OpenProject last touched the work package), strictly after
  // the previous transition. Falls back to "tomorrow" of the last transition if updatedAt
  // is before/equal to it.
  const lastNew = sorted[sorted.length - 1].newStatus.toLowerCase();
  if (lastNew !== currentStatus.toLowerCase()) {
    const lastDate = sorted[sorted.length - 1].date;
    let appendDate = updatedAt && updatedAt > lastDate ? updatedAt : shiftDay(lastDate, 1);
    if (appendDate < createdAt) appendDate = createdAt;
    sorted.push({ date: appendDate, newStatus: currentStatus });
  }

  const segments: StatusSegment[] = sorted.map((t, i) => {
    const next = sorted[i + 1];
    let toDate: string | null = next ? shiftDay(next.date, -1) : null;
    // Clamp end-before-start (1-day segment when next.date <= t.date).
    if (toDate !== null && toDate < t.date) toDate = t.date;
    return {
      status: t.newStatus,
      statusLower: t.newStatus.toLowerCase(),
      fromDate: t.date,
      toDate,
    };
  });

  // Collapse consecutive segments with the same status.
  const collapsed: StatusSegment[] = [];
  for (const seg of segments) {
    const prev = collapsed[collapsed.length - 1];
    if (prev && prev.statusLower === seg.statusLower) {
      prev.toDate = seg.toDate;
    } else {
      collapsed.push(seg);
    }
  }

  return { taskId, segments: collapsed };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token, url } = body;
    const inferenceConfig = body.inferenceConfig || DEFAULT_TIMELINE_INFERENCE;

    if (!token || !url) {
      return NextResponse.json(
        { error: "Missing token or url" },
        { status: 400 }
      );
    }

    const baseUrl = url.replace(/\/$/, "");
    const basicAuth = Buffer.from(`apikey:${token}`).toString("base64");
    const headers = {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/json",
    };

    // Fetch user info
    const userResponse = await fetch(`${baseUrl}/api/v3/users/me`, {
      headers,
    });

    if (!userResponse.ok) {
      return NextResponse.json(
        {
          error: "Invalid token or unable to connect to OpenProject",
        },
        { status: userResponse.status }
      );
    }

    const user = await userResponse.json();

    // Fetch work packages (tasks) assigned to the user — only open status
    const wpFilters = encodeURIComponent(JSON.stringify([
      { assignee: { operator: "=", values: [user.id.toString()] } },
      { status: { operator: "o", values: [] } },
    ]));
    const workPackagesResponse = await fetch(
      `${baseUrl}/api/v3/work_packages?filters=${wpFilters}&pageSize=1000`,
      { headers }
    );

    let workPackages = [];
    if (workPackagesResponse.ok) {
      const workPackagesData = await workPackagesResponse.json();
      workPackages = workPackagesData._embedded?.elements || [];
    }

    // Transform work packages into todos
    const todos = workPackages.map((wp: any) => ({
      id: wp.id.toString(),
      title: wp.subject,
      date: wp.startDate || wp.dueDate || wp.createdAt || null,
      url: wp._links?.self?.href,
      status: wp._links?.status?.title || wp._embedded?.status?.name || "Unknown",
      sprint: wp._links?.version?.title || undefined,
      updatedAt: wp.updatedAt ? wp.updatedAt.split("T")[0] : undefined,
      isClosed: false,
      createdAt: wp.createdAt ? wp.createdAt.split("T")[0] : null,
    }));

    // Fetch activity history for each task and build a full status timeline.
    const todosWithTimeline = await Promise.all(todos.map(async (todo: any) => {
      const createdAt = todo.createdAt || todo.updatedAt || new Date().toISOString().slice(0, 10);
      const transitions: { date: string; newStatus: string }[] = [];

      try {
        const activitiesRes = await fetch(`${baseUrl}/api/v3/work_packages/${todo.id}/activities`, { headers });
        if (activitiesRes.ok) {
          const activitiesData = await activitiesRes.json();
          const elements = activitiesData._embedded?.elements || [];

          for (const entry of elements) {
            const entryDate = entry.createdAt?.split("T")[0];
            if (!entryDate) continue;

            const details = entry._embedded?.details || entry.details || [];
            let foundInDetails = false;
            for (const detail of details) {
              const newStatus = extractStatusFromDetail(detail);
              if (newStatus) {
                transitions.push({ date: entryDate, newStatus });
                foundInDetails = true;
              }
            }

            // Fall back to entry-level comment fields only if details yielded nothing.
            if (!foundInDetails) {
              const candidates = [
                entry.comment?.raw,
                entry.note,
                entry.comment?.html ? stripHtml(entry.comment.html) : "",
              ];
              for (const raw of candidates) {
                if (!raw) continue;
                const text = stripMarkdown(String(raw));
                const pt = text.match(/situa[çc][aã]o\s+alterad[oa]?\s+de\s+.+?\s+para\s+(.+?)(?:\s*$|\.|\n|<)/i);
                const en = text.match(/status\s+changed?\s+from\s+.+?\s+to\s+(.+?)(?:\s*$|\.|\n|<)/i);
                const m = pt || en;
                if (m) {
                  transitions.push({ date: entryDate, newStatus: m[1].trim() });
                  break;
                }
              }
            }
          }
        }
      } catch {
        // Network/parse failure — fall through with whatever transitions we have (possibly none)
      }

      const rawTimeline = buildTimeline(todo.id, createdAt, todo.status || "Novo", todo.updatedAt, transitions);
      const timeline: TaskStatusTimeline = {
        taskId: rawTimeline.taskId,
        segments: inferGaps(rawTimeline.segments, inferenceConfig),
      };
      const bounds = deriveActiveBounds(timeline, DEFAULT_STATUS_WEIGHTS);

      return {
        id: todo.id,
        title: todo.title,
        date: todo.date,
        url: todo.url,
        status: todo.status,
        sprint: todo.sprint,
        updatedAt: todo.updatedAt,
        isClosed: false,
        activeFrom: bounds.activeFrom,
        activeUntil: bounds.activeUntil,
        timeline,
      };
    }));

    // Fetch sprint/version details (dates) from unique version hrefs
    const versionHrefs = new Set<string>();
    workPackages.forEach((wp: any) => {
      const href = wp._links?.version?.href;
      if (href) versionHrefs.add(href);
    });

    const sprints: { id: string; name: string; startDate: string | null; endDate: string | null }[] = [];
    for (const href of versionHrefs) {
      try {
        const versionResponse = await fetch(`${baseUrl}${href}`, { headers });
        if (versionResponse.ok) {
          const version = await versionResponse.json();
          sprints.push({
            id: version.id?.toString() || href.split("/").pop() || "",
            name: version.name || version._links?.self?.title || "",
            startDate: version.startDate || null,
            endDate: version.endDate || null,
          });
        }
      } catch {
        // Skip versions that fail to fetch
      }
    }

    // Fetch time entries for the user
    const timeEntriesResponse = await fetch(
      `${baseUrl}/api/v3/time_entries?filters=[{"user":{"operator":"=","values":["${user.id}"]}}]&pageSize=1000`,
      { headers }
    );

    const byDay: { [key: string]: number } = {};
    const byTask: { [key: string]: { totalHours: number; entryCount: number; lastUsed: string } } = {};
    const byDayTask: { [key: string]: { [key: string]: number } } = {};

    if (timeEntriesResponse.ok) {
      const timeEntriesData = await timeEntriesResponse.json();
      const entries = timeEntriesData._embedded?.elements || [];

      entries.forEach((entry: any) => {
        const hours = entry.hours ? parseIsoDuration(entry.hours) : 0;
        if (hours <= 0) return;

        const dateStr = entry.spentOn;
        if (!dateStr) return;

        byDay[dateStr] = (byDay[dateStr] || 0) + hours;

        const wpHref = entry._links?.workPackage?.href || "";
        const wpId = wpHref.split("/").pop();
        if (!wpId) return;

        if (!byTask[wpId]) {
          byTask[wpId] = { totalHours: 0, entryCount: 0, lastUsed: dateStr };
        }
        byTask[wpId].totalHours += hours;
        byTask[wpId].entryCount += 1;
        if (dateStr > byTask[wpId].lastUsed) {
          byTask[wpId].lastUsed = dateStr;
        }

        if (!byDayTask[dateStr]) byDayTask[dateStr] = {};
        byDayTask[dateStr][wpId] = (byDayTask[dateStr][wpId] || 0) + hours;
      });
    }

    const byTaskWithAvg: { [key: string]: { totalHours: number; entryCount: number; lastUsed: string; avgHoursPerDay: number } } = {};
    for (const [taskId, data] of Object.entries(byTask)) {
      const uniqueDays = Object.keys(byDayTask).filter(day => byDayTask[day]?.[taskId]).length;
      byTaskWithAvg[taskId] = {
        ...data,
        avgHoursPerDay: uniqueDays > 0 ? Math.round((data.totalHours / uniqueDays) * 2) / 2 : 0,
      };
    }

    const response = {
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
      todos: todosWithTimeline,
      timeEntries: {
        byDay,
        byTask: byTaskWithAvg,
        byDayTask,
      },
      sprints,
    };

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to verify token",
      },
      { status: 500 }
    );
  }
}
