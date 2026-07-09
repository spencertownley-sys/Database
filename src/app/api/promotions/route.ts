import { NextRequest, NextResponse } from "next/server";
import { listPromotions } from "@/db/queries/promotions";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  try {
    const rows = await listPromotions({
      status: p.get("status") ?? undefined,
      offerType: p.get("offerType") ?? undefined,
      ownerId: p.get("ownerId") ?? undefined,
      sellFrom: p.get("sellFrom") ?? undefined,
      sellTo: p.get("sellTo") ?? undefined,
      sailFrom: p.get("sailFrom") ?? undefined,
      sailTo: p.get("sailTo") ?? undefined,
      regionId: p.get("regionId") ?? undefined,
      shipId: p.get("shipId") ?? undefined,
      tag: p.get("tag") ?? undefined,
      q: p.get("q") ?? undefined,
      limit: p.get("limit") ? Math.min(2000, Number(p.get("limit"))) : undefined,
    });
    return NextResponse.json(rows);
  } catch (err) {
    console.error("promotions list failed", err);
    return NextResponse.json({ error: "Failed to load promotions" }, { status: 500 });
  }
}
