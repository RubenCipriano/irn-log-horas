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

    console.log("[clear-time-entries] Request to delete entries for date:", date);

    // Fetch all time entries for this user with pagination
    // Using filters in the correct OpenProject format
    const filters = encodeURIComponent(
      JSON.stringify([
        {
          spentOn: {
            operator: "=",
            values: [date],
          },
        },
      ])
    );

    const listUrl = `${baseUrl}/api/v3/time_entries?filters=${filters}&pageSize=100`;
    console.log("[clear-time-entries] Fetching from:", listUrl);

    let listResponse = await fetch(listUrl, { headers });
    let entries: any[] = [];

    if (!listResponse.ok) {
      const error = await listResponse.text();
      console.warn("[clear-time-entries] Filtered fetch failed, trying fallback:", error);
      
      // Fallback: fetch all entries and filter client-side
      const fallbackUrl = `${baseUrl}/api/v3/time_entries?pageSize=100`;
      console.log("[clear-time-entries] Trying fallback URL:", fallbackUrl);
      
      listResponse = await fetch(fallbackUrl, { headers });
      
      if (!listResponse.ok) {
        const fallbackError = await listResponse.text();
        console.error("[clear-time-entries] Fallback fetch also failed:", fallbackError);
        return NextResponse.json(
          { error: `Failed to fetch time entries: ${fallbackError}` },
          { status: listResponse.status }
        );
      }

      const listData = await listResponse.json();
      const allEntries = listData._embedded?.elements || [];
      
      // Filter entries for the specific date client-side
      entries = allEntries.filter((entry: any) => entry.spentOn === date);
      console.log(`[clear-time-entries] Filtered ${entries.length} entries for ${date} from ${allEntries.length} total`);
    } else {
      const listData = await listResponse.json();
      entries = listData._embedded?.elements || [];
      console.log(`[clear-time-entries] Found ${entries.length} entries for ${date} using filter`);
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
    const errors: string[] = [];

    // Delete each time entry
    for (const entry of entries) {
      try {
        const entryId = entry.id;
        console.log(`[clear-time-entries] Deleting entry ${entryId}`);

        const deleteResponse = await fetch(
          `${baseUrl}/api/v3/time_entries/${entryId}`,
          {
            method: "DELETE",
            headers,
          }
        );

        if (deleteResponse.ok || deleteResponse.status === 204) {
          deletedCount++;
          console.log(`[clear-time-entries] Successfully deleted entry ${entryId}`);
        } else {
          const error = await deleteResponse.text();
          errors.push(`Entry ${entryId}: ${error}`);
          console.error(`[clear-time-entries] Failed to delete entry ${entryId}:`, error);
        }
      } catch (err) {
        errors.push(
          `Entry deletion error: ${err instanceof Error ? err.message : "Unknown error"}`
        );
      }
    }

    console.log(`[clear-time-entries] Final result: deleted ${deletedCount}/${entries.length}`);

    return NextResponse.json({
      success: true,
      deleted: deletedCount,
      total: entries.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("[clear-time-entries] Error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to clear time entries",
      },
      { status: 500 }
    );
  }
}
