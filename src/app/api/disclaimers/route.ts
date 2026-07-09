import { NextRequest, NextResponse } from "next/server";
import { listDisclaimers } from "@/db/queries/disclaimers";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const rows = await listDisclaimers(
      request.nextUrl.searchParams.get("q") ?? undefined
    );
    return NextResponse.json(rows);
  } catch (err) {
    console.error("disclaimers list failed", err);
    return NextResponse.json({ error: "Failed to load disclaimers" }, { status: 500 });
  }
}
