import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const taskId = request.nextUrl.searchParams.get("taskId");
  const authUrl = request.headers.get("X-OpenProject-URL");
  const authorization = request.headers.get("Authorization");

  if (!taskId || !authUrl || !authorization) {
    return NextResponse.json(
      { error: "Missing required parameters" },
      { status: 400 }
    );
  }

  try {
    const url = `${authUrl.replace(/\/$/, "")}/api/v3/work_packages/${taskId}`;

    const response = await fetch(url, {
      headers: {
        "Authorization": authorization,
      },
    });

    const responseText = await response.text();

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
      status: data._links?.status?.title || data.status?.name,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch task details" },
      { status: 500 }
    );
  }
}
