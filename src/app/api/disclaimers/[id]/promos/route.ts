import { NextRequest, NextResponse } from "next/server";
import { getPromosUsingDisclaimer } from "@/db/queries/disclaimers";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const rows = await getPromosUsingDisclaimer(params.id);
    return NextResponse.json(rows);
  } catch (err) {
    console.error("disclaimer promos failed", err);
    return NextResponse.json({ error: "Failed to load promos" }, { status: 500 });
  }
}
