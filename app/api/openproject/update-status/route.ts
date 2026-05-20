import { NextRequest, NextResponse } from "next/server";
import { assertValidExternalUrl, InvalidExternalUrlError } from "@/lib/security/url-validation";
import { assertNumericId, InvalidIdError } from "@/lib/security/validate";
import { genericUpstreamError } from "@/lib/security/safe-error";

// PATCH a work package's status. Body: { taskId, statusId, lockVersion }.
// Headers: Authorization (Bearer <token>), X-OpenProject-URL.
//
// OpenProject requires:
//   - lockVersion (optimistic-locking) — 409 if stale
//   - _links.status.href on the body
//   - The current user must have the workflow transition allowed — 422 if not
export async function POST(request: NextRequest) {
  const authUrl = request.headers.get("X-OpenProject-URL");
  const authorization = request.headers.get("Authorization");

  if (!authUrl || !authorization) {
    return NextResponse.json({ error: "Missing auth headers" }, { status: 400 });
  }

  let body: { taskId?: string; statusId?: string; lockVersion?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { taskId, statusId, lockVersion } = body;
  if (!taskId || !statusId || typeof lockVersion !== "number") {
    return NextResponse.json(
      { error: "Missing taskId / statusId / lockVersion" },
      { status: 400 }
    );
  }

  let baseUrl: string;
  let safeTaskId: string;
  let safeStatusId: string;
  try {
    baseUrl = assertValidExternalUrl(authUrl);
    safeTaskId = assertNumericId(taskId, "taskId");
    safeStatusId = assertNumericId(statusId, "statusId");
  } catch (e) {
    if (e instanceof InvalidExternalUrlError || e instanceof InvalidIdError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }

  // The login route uses Basic auth via `apikey:<token>`. The Calendar's other
  // calls (add-time-entries / clear-time-entries) send "Bearer <token>" and
  // re-encode server-side. Match that convention here.
  const token = authorization.replace(/^Bearer\s+/i, "");
  const basicAuth = Buffer.from(`apikey:${token}`).toString("base64");

  const patchBody = {
    lockVersion,
    _links: {
      status: { href: `/api/v3/statuses/${safeStatusId}` },
    },
  };

  try {
    const response = await fetch(`${baseUrl}/api/v3/work_packages/${safeTaskId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(patchBody),
    });

    const responseText = await response.text();

    if (response.status === 409) {
      return NextResponse.json(
        { error: "conflict", message: "A tarefa foi alterada noutro local. Recarrega para sincronizar." },
        { status: 409 }
      );
    }
    if (response.status === 422) {
      // OpenProject returns a structured error; surface the message if available.
      let detail = "Esta transicao nao e permitida pelo workflow.";
      try {
        const parsed = JSON.parse(responseText);
        if (typeof parsed?.message === "string") detail = parsed.message;
      } catch { /* keep default */ }
      return NextResponse.json({ error: "workflow", message: detail }, { status: 422 });
    }
    if (!response.ok) {
      return NextResponse.json(
        { error: `openproject_${response.status}`, message: genericUpstreamError("OpenProject", response.status) },
        { status: response.status }
      );
    }

    const data = JSON.parse(responseText);
    const statusHref: string = data._links?.status?.href || "";
    const newStatusId = statusHref.split("/").pop() || safeStatusId;
    return NextResponse.json({
      id: data.id?.toString() || taskId,
      status: data._links?.status?.title || data.status?.name || "",
      statusId: newStatusId,
      lockVersion: typeof data.lockVersion === "number" ? data.lockVersion : lockVersion + 1,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "network", message: error instanceof Error ? error.message : "Failed to update status" },
      { status: 500 }
    );
  }
}
