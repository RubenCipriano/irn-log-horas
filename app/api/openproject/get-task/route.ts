import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const taskId = request.nextUrl.searchParams.get("taskId");
  const authUrl = request.headers.get("X-OpenProject-URL");
  const authToken = request.headers.get("Authorization");

  console.log("[get-task] Request received:", { taskId, authUrl, hasToken: !!authToken });

  if (!taskId || !authUrl || !authToken) {
    return NextResponse.json(
      { error: "Missing required parameters" },
      { status: 400 }
    );
  }

  try {
    const url = `${authUrl.replace(/\/$/, "")}/api/v3/work_packages/${taskId}`;
    console.log("[get-task] Fetching from:", url);
    
    const response = await fetch(url, {
      headers: {
        "Authorization": authToken,
      },
    });

    const responseText = await response.text();
    console.log("[get-task] Response status:", response.status, "Body:", responseText.substring(0, 200));

    if (!response.ok) {
      return NextResponse.json(
        { error: `OpenProject API error: ${response.statusText}` },
        { status: response.status }
      );
    }

    const data = JSON.parse(responseText);
    
    return NextResponse.json({
      id: data.id,
      title: data.subject,
      status: data.status?.name,
    });
  } catch (error) {
    console.error("[get-task] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch task details" },
      { status: 500 }
    );
  }
}
