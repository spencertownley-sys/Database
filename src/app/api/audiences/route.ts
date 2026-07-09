import { NextResponse } from "next/server";
import { listAudienceSegments } from "@/db/queries/promotions";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = await listAudienceSegments();
    return NextResponse.json(rows);
  } catch (err) {
    console.error("audiences list failed", err);
    return NextResponse.json({ error: "Failed to load audiences" }, { status: 500 });
  }
}
