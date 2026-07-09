import { NextRequest, NextResponse } from "next/server";
import { listVoyages } from "@/db/queries/voyages";

export const dynamic = "force-dynamic";

/** Voyage list for the voyage-linking panel and external consumers. */
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  try {
    const rows = await listVoyages({
      shipId: p.get("shipId") ?? undefined,
      regionId: p.get("regionId") ?? undefined,
      from: p.get("from") ?? undefined,
      to: p.get("to") ?? undefined,
      duration: p.get("duration") ? Number(p.get("duration")) : undefined,
      status: p.get("status") ?? undefined,
      minOccupancy: p.get("minOccupancy") ? Number(p.get("minOccupancy")) : undefined,
      maxOccupancy: p.get("maxOccupancy") ? Number(p.get("maxOccupancy")) : undefined,
      noActivePromo: p.get("noActivePromo") === "true",
      q: p.get("q") ?? undefined,
      limit: p.get("limit") ? Math.min(2000, Number(p.get("limit"))) : 500,
    });
    return NextResponse.json(rows);
  } catch (err) {
    console.error("voyage list failed", err);
    return NextResponse.json({ error: "Failed to load voyages" }, { status: 500 });
  }
}
