import { NextRequest, NextResponse } from "next/server";
import { assertValidExternalUrl, InvalidExternalUrlError } from "@/lib/security/url-validation";
import { assertNumericId, InvalidIdError } from "@/lib/security/validate";
import { genericUpstreamError } from "@/lib/security/safe-error";

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

  let baseUrl: string;
  let safeTaskId: string;
  try {
    baseUrl = assertValidExternalUrl(authUrl);
    safeTaskId = assertNumericId(taskId, "taskId");
  } catch (e) {
    if (e instanceof InvalidExternalUrlError || e instanceof InvalidIdError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }

  try {
    const url = `${baseUrl}/api/v3/work_packages/${safeTaskId}`;

    // Forward Authorization verbatim (do not re-encode) — required by the
    // OpenProject API and noted as a gotcha in CLAUDE.md.
    const response = await fetch(url, {
      headers: {
        "Authorization": authorization,
      },
    });

    const responseText = await response.text();

    if (!response.ok) {
      return NextResponse.json(
        { error: genericUpstreamError("OpenProject", response.status) },
        { status: response.status }
      );
    }

    const data = JSON.parse(responseText);

    // statusId from the status self-link (e.g. ".../api/v3/statuses/8" → "8").
    const statusHref: string | undefined = data._links?.status?.href;
    const statusId = statusHref ? statusHref.split("/").pop() : undefined;

    return NextResponse.json({
      id: String(data.id),
      title: data.subject,
      status: data._links?.status?.title || data.status?.name,
      statusId,
      lockVersion: typeof data.lockVersion === "number" ? data.lockVersion : undefined,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch task details" },
      { status: 500 }
    );
  }
}
