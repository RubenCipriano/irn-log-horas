import { NextRequest, NextResponse } from "next/server";

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

    const token = request.headers.get("Authorization")?.replace("Bearer ", "");
    const url = request.headers.get("X-OpenProject-URL");

    if (!token || !url) {
      return NextResponse.json(
        { error: "Missing authentication" },
        { status: 401 }
      );
    }

    const baseUrl = url.replace(/\/$/, "");
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
    let entries: any[] = [];
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
            entries.push(...fbElements.filter((e: any) => e.spentOn === date));
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

    if (entries.length === 0) {
      return NextResponse.json({
        success: true,
        deleted: 0,
        total: 0,
        message: "No time entries found for this date",
      });
    }

    let deletedCount = 0;
    let permissionErrors = 0;
    const errors: string[] = [];

    // Delete each time entry
    for (const entry of entries) {
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
          const error = await deleteResponse.text();
          errors.push(`Entry ${entryId}: ${error}`);
        }
      } catch (err) {
        errors.push(
          `Entry deletion error: ${err instanceof Error ? err.message : "Unknown error"}`
        );
      }
    }

    return NextResponse.json({
      success: true,
      deleted: deletedCount,
      total: entries.length,
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
