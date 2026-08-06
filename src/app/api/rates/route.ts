import { NextResponse } from "next/server";
import { fetchExchangeRates } from "@/lib/store";
import { logError } from "@/lib/errors";

export async function GET() {
  try {
    const table = await fetchExchangeRates();
    if (!table) {
      return NextResponse.json({ error: "Failed to fetch rates" }, { status: 503 });
    }
    // `fetchedAt` and `exact` rather than a bare timestamp: a caller needs to be able to
    // tell a table that was just fetched from one that has been sitting on disk since
    // the last time this machine could reach the outside world.
    return NextResponse.json({
      base: "EUR",
      rates: table.rates,
      fetchedAt: table.fetchedAt,
      exact: table.exact,
    });
  } catch (error) {
    logError("GET /api/rates", error);
    return NextResponse.json({ error: "Failed to fetch exchange rates" }, { status: 500 });
  }
}