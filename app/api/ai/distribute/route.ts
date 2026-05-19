import { NextRequest, NextResponse } from "next/server";
import { distributeWork } from "@/lib/ai/distribute";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { description, dateRange, tasks, weights, schedule, providerConfig } = body;

    if (typeof description !== "string" || !description.trim()) {
      return NextResponse.json({ error: "Missing description" }, { status: 400 });
    }
    if (!dateRange?.from || !dateRange?.to) {
      return NextResponse.json({ error: "Missing dateRange" }, { status: 400 });
    }
    if (!Array.isArray(tasks)) {
      return NextResponse.json({ error: "Missing tasks" }, { status: 400 });
    }
    if (!providerConfig?.kind) {
      return NextResponse.json({ error: "Missing AI provider configuration" }, { status: 400 });
    }

    const result = await distributeWork({
      description,
      dateRange,
      tasks,
      weights: weights || {},
      schedule,
      providerConfig,
      gitlabActivity: body.gitlabActivity,
      meetings: body.meetings,
      signal: request.signal,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to call AI provider";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
