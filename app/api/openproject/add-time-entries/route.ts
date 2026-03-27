import { NextRequest, NextResponse } from "next/server";

// Convert decimal hours to ISO 8601 duration format
// Examples: 0.5 → "PT30M", 1 → "PT1H", 2.5 → "PT2H30M", 3 → "PT3H"
function hoursToISO8601Duration(hours: number): string {
  const wholeHours = Math.floor(hours);
  const minutes = Math.round((hours - wholeHours) * 60);
  
  let duration = "PT";
  if (wholeHours > 0) {
    duration += `${wholeHours}H`;
  }
  if (minutes > 0) {
    duration += `${minutes}M`;
  }
  
  // If 0 hours, return PT0M
  return duration === "PT" ? "PT0M" : duration;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { date, entries } = body;

    if (!date || !entries || !Array.isArray(entries)) {
      return NextResponse.json(
        { error: "Missing date or entries" },
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

    // console.log("[add-time-entries] Received:", { date, entriesCount: entries.length, entries });

    let savedCount = 0;
    const errors: string[] = [];

    // Save each time entry
    for (const entry of entries) {
      try {
        const isoDuration = hoursToISO8601Duration(entry.spentTime);
        // console.log(`[add-time-entries] Saving entry:`, entry, `→ ${isoDuration}`);
        
        const response = await fetch(`${baseUrl}/api/v3/time_entries`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            spentOn: date,
            hours: isoDuration,
            workPackage: {
              href: `/api/v3/work_packages/${entry.workPackageId}`,
            },
          }),
        });

        const responseText = await response.text();
        // console.log(`[add-time-entries] Response for ${entry.workPackageId}:`, response.status, responseText.substring(0, 150));

        if (response.ok) {
          savedCount++;
        } else {
          errors.push(`Task ${entry.workPackageId}: ${responseText}`);
        }
      } catch (err) {
        errors.push(`Task ${entry.workPackageId}: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
    }
    
    // console.log("[add-time-entries] Final result:", { savedCount, totalEntries: entries.length, errors });

    return NextResponse.json({
      success: true,
      saved: savedCount,
      total: entries.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to add time entries",
      },
      { status: 500 }
    );
  }
}
