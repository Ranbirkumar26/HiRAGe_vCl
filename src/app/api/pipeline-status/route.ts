import { NextResponse, type NextRequest } from "next/server";

import { getSession } from "@/lib/auth/session";
import { latestPipelineJob } from "@/lib/queries";
import { createAdminClient } from "@/lib/supabase/admin";

/** Polled by the parse popup and the shortlist panel while a run is in flight. */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session || session.profile.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const jobId = request.nextUrl.searchParams.get("jobId");
  const kind = request.nextUrl.searchParams.get("kind");
  if (!jobId || (kind !== "parse" && kind !== "shortlist")) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const task = await latestPipelineJob(createAdminClient(), jobId, kind);
  if (!task) return NextResponse.json({ task: null });

  return NextResponse.json({
    task: {
      id: task.id,
      status: task.status,
      progressDone: task.progress_done,
      progressTotal: task.progress_total,
      message: task.message,
      error: task.error,
    },
  });
}
