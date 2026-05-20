import { NextRequest, NextResponse } from "next/server";
import { assertValidExternalUrl, InvalidExternalUrlError } from "@/lib/security/url-validation";
import { assertNumericId, InvalidIdError } from "@/lib/security/validate";
import { genericUpstreamError } from "@/lib/security/safe-error";
import type { OpTimeEntry } from "@/lib/openproject/api-types";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { date } = body;

    if (!date) {
      return NextResponse.json(
        { error: "Missing date parameter" },
        { status: 400 }
      );
    }

    // Optional: scope deletion to a single work package on that day.
    let scopeTaskId: string | undefined;
    if (body.taskId !== undefined && body.taskId !== null && body.taskId !== "") {
      try {
        scopeTaskId = assertNumericId(body.taskId, "taskId");
      } catch (e) {
        if (e instanceof InvalidIdError) {
          return NextResponse.json({ error: e.message }, { status: 400 });
        }
        throw e;
      }
    }

    const token = request.headers.get("Authorization")?.replace("Bearer ", "");
    const url = request.headers.get("X-OpenProject-URL");

    if (!token || !url) {
      return NextResponse.json(
        { error: "Missing authentication" },
        { status: 401 }
      );
    }

    let baseUrl: string;
    try {
      baseUrl = assertValidExternalUrl(url);
    } catch (e) {
      if (e instanceof InvalidExternalUrlError) {
        return NextResponse.json({ error: e.message }, { status: 400 });
      }
      throw e;
    }
    const basicAuth = Buffer.from(`apikey:${token}`).toString("base64");
    const headers = {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/json",
    };

    // Fetch current user ID to scope deletion to own entries only
    const meResponse = await fetch(`${baseUrl}/api/v3/users/me`, { headers });
    if (!meResponse.ok) {
      return NextResponse.json(
        { error: "Failed to fetch current user" },
        { status: meResponse.status }
      );
    }
    const me = await meResponse.json();
    const userId = me.id.toString();

    // Fetch ALL time entries for this user+date with pagination
    const filters = encodeURIComponent(
      JSON.stringify([
        { spentOn: { operator: "=", values: [date] } },
        { user: { operator: "=", values: [userId] } },
      ])
    );

    // Paginate through ALL time entries for this user+date
    const entries: OpTimeEntry[] = [];
    const pageSize = 200;
    let page = 1;

    while (true) {
      const listUrl = `${baseUrl}/api/v3/time_entries?filters=${filters}&pageSize=${pageSize}&offset=${page}`;
      const listResponse = await fetch(listUrl, { headers });

      if (!listResponse.ok) {
        // First page failed — try fallback without date filter
        if (page === 1) {
          const fallbackFilters = encodeURIComponent(
            JSON.stringify([{ user: { operator: "=", values: [userId] } }])
          );
          let fbPage = 1;
          while (true) {
            const fbUrl = `${baseUrl}/api/v3/time_entries?filters=${fallbackFilters}&pageSize=${pageSize}&offset=${fbPage}`;
            const fbResponse = await fetch(fbUrl, { headers });
            if (!fbResponse.ok) break;
            const fbData = await fbResponse.json();
            const fbElements = fbData._embedded?.elements || [];
            entries.push(...fbElements.filter((e: OpTimeEntry) => e.spentOn === date));
            if (fbElements.length < pageSize) break;
            fbPage++;
          }
        }
        break;
      }

      const listData = await listResponse.json();
      const pageEntries = listData._embedded?.elements || [];
      entries.push(...pageEntries);

      const total = listData.total || listData.count || 0;
      if (entries.length >= total || pageEntries.length < pageSize) break;
      page++;
    }

    // When scoped to a task, keep only that work package's entries.
    const targetEntries = scopeTaskId
      ? entries.filter(e => (e._links?.workPackage?.href || "").split("/").pop() === scopeTaskId)
      : entries;

    if (targetEntries.length === 0) {
      return NextResponse.json({
        success: true,
        deleted: 0,
        total: 0,
        message: "No time entries found",
      });
    }

    let deletedCount = 0;
    let permissionErrors = 0;
    const errors: string[] = [];

    // Delete each time entry
    for (const entry of targetEntries) {
      try {
        const entryId = entry.id;

        const deleteResponse = await fetch(
          `${baseUrl}/api/v3/time_entries/${entryId}`,
          {
            method: "DELETE",
            headers,
          }
        );

        if (deleteResponse.ok || deleteResponse.status === 204) {
          deletedCount++;
        } else if (deleteResponse.status === 403) {
          permissionErrors++;
        } else {
          // Never echo the raw upstream body.
          errors.push(`Entry ${entryId}: ${genericUpstreamError("OpenProject", deleteResponse.status)}`);
        }
      } catch {
        errors.push("Entry deletion error: erro de rede.");
      }
    }

    return NextResponse.json({
      success: true,
      deleted: deletedCount,
      total: targetEntries.length,
      permissionErrors,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to clear time entries",
      },
      { status: 500 }
    );
  }
}
