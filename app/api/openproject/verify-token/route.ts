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

    // Fetch work packages (tasks) assigned to the user
    const workPackagesResponse = await fetch(
      `${baseUrl}/api/v3/work_packages?filters=[{"assignee":{"operator":"=","values":["${user.id}"]}}]&pageSize=1000`,
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
      date: wp.createdAt ? new Date(wp.createdAt) : null,
      url: wp._links?.self?.href,
      status: wp._links?.status?.title || "Unknown",
    })).filter((todo: any) => todo.date !== null);

    // Fetch time entries for the user
    const timeEntriesResponse = await fetch(
      `${baseUrl}/api/v3/time_entries?filters=[{"user":{"operator":"=","values":["${user.id}"]}}]&pageSize=1000`,
      { headers }
    );

    let timeEntries: { [key: string]: number } = {};
    if (timeEntriesResponse.ok) {
      const timeEntriesData = await timeEntriesResponse.json();
      const entries = timeEntriesData._embedded?.elements || [];
      
      entries.forEach((entry: any) => {
        // Parse ISO 8601 duration format (PT8H, PT30M, etc)
        const hours = entry.hours ? parseIsoDuration(entry.hours) : 0;
        
        if (hours > 0) {
          // Use spentOn property for the date
          const dateStr = entry.spentOn;
          if (dateStr) {
            const key = dateStr; // Format should already be YYYY-MM-DD
            timeEntries[key] = (timeEntries[key] || 0) + hours;
          }
        }
      });
    }

    const response = {
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
      todos,
      timeEntries,
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





