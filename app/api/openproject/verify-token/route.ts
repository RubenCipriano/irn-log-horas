import { NextRequest, NextResponse } from "next/server";

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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token, url } = body;

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
      { status: { operator: "o", values: [] } }, // "o" = open statuses only
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
      isClosed: false, // API already filters open only
    }));

    // Fetch activity history for each task in parallel to determine activeFrom/activeUntil
    const terminalStatuses = ["desenvolvido", "developed", "fechado", "closed", "rejected", "rejeitado"];
    const todosWithHistory = await Promise.all(todos.map(async (todo: any) => {
      try {
        const activitiesRes = await fetch(`${baseUrl}/api/v3/work_packages/${todo.id}/activities`, { headers });
        if (!activitiesRes.ok) return todo;

        const activitiesData = await activitiesRes.json();
        const elements = activitiesData._embedded?.elements || [];

        let activeFrom: string | null = null;
        let activeUntil: string | null = null;

        for (const entry of elements) {
          const entryDate = entry.createdAt?.split("T")[0];
          if (!entryDate) continue;

          const details = entry._embedded?.details || entry.details || [];
          for (const detail of details) {
            if (detail.property === "status" || detail.fieldName === "status" || detail._type === "StatusChangedActivity") {
              if (!activeFrom) activeFrom = entryDate;
              const newStatus = (detail._links?.newValue?.title || detail.newValue || "").toLowerCase();
              if (terminalStatuses.some(s => newStatus.includes(s))) {
                activeUntil = entryDate;
              } else {
                // If status changed back from terminal to active, clear activeUntil
                activeUntil = null;
              }
            }
          }
        }

        // Fallback: use createdAt if no status history found
        if (!activeFrom && todo.date) {
          activeFrom = typeof todo.date === "string" ? todo.date.split("T")[0] : null;
        }

        return { ...todo, activeFrom, activeUntil };
      } catch {
        return todo;
      }
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

        // Aggregate by day
        byDay[dateStr] = (byDay[dateStr] || 0) + hours;

        // Extract work package ID from href (e.g., "/api/v3/work_packages/4521")
        const wpHref = entry._links?.workPackage?.href || "";
        const wpId = wpHref.split("/").pop();
        if (!wpId) return;

        // Aggregate by task
        if (!byTask[wpId]) {
          byTask[wpId] = { totalHours: 0, entryCount: 0, lastUsed: dateStr };
        }
        byTask[wpId].totalHours += hours;
        byTask[wpId].entryCount += 1;
        if (dateStr > byTask[wpId].lastUsed) {
          byTask[wpId].lastUsed = dateStr;
        }

        // Aggregate by day+task
        if (!byDayTask[dateStr]) byDayTask[dateStr] = {};
        byDayTask[dateStr][wpId] = (byDayTask[dateStr][wpId] || 0) + hours;
      });
    }

    // Calculate avgHoursPerDay for each task
    const byTaskWithAvg: { [key: string]: { totalHours: number; entryCount: number; lastUsed: string; avgHoursPerDay: number } } = {};
    for (const [taskId, data] of Object.entries(byTask)) {
      // Count unique days this task was logged
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
      todos: todosWithHistory,
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





