import { NextRequest, NextResponse } from "next/server";
import { fetchRecentActivity, fetchCurrentUser } from "@/lib/gitlab/client";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { config, since, until, testOnly } = body;

    if (!config?.baseUrl || !config?.accessToken) {
      return NextResponse.json({ error: "Missing GitLab configuration" }, { status: 400 });
    }

    if (testOnly) {
      const user = await fetchCurrentUser(config);
      return NextResponse.json({ ok: true, user });
    }

    const sinceDate = since ? new Date(since) : new Date(Date.now() - 30 * 86400_000);
    const untilDate = until ? new Date(until) : undefined;
    const activities = await fetchRecentActivity(config, sinceDate, untilDate);
    return NextResponse.json({ activities });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to call GitLab";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
