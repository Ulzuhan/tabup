import { NextResponse } from "next/server";
import { fetchExchangeRates } from "@/lib/store";
import { logError } from "@/lib/errors";

export async function GET() {
  try {
    const rates = await fetchExchangeRates();
    if (!rates) {
      return NextResponse.json({ error: "Failed to fetch rates" }, { status: 503 });
    }
    return NextResponse.json({ base: "EUR", rates, timestamp: Date.now() });
  } catch (error) {
    logError("GET /api/rates", error);
    return NextResponse.json({ error: "Failed to fetch exchange rates" }, { status: 500 });
  }
}