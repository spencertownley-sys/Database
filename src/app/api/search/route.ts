import { NextRequest, NextResponse } from "next/server";
import { globalSearch } from "@/lib/search";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q") ?? "";
  try {
    const results = await globalSearch(q);
    return NextResponse.json(results);
  } catch (err) {
    console.error("search failed", err);
    return NextResponse.json(
      { promotions: [], voyages: [], ships: [], disclaimers: [] },
      { status: 500 }
    );
  }
}
