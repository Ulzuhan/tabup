import { NextResponse } from "next/server";
import { fetchExchangeRates } from "@/lib/store";

export async function GET() {
  try {
    const rates = await fetchExchangeRates();
    if (!rates) {
      return NextResponse.json({ error: "Failed to fetch rates" }, { status: 503 });
    }
    return NextResponse.json({ base: "EUR", rates, timestamp: Date.now() });
  } catch (error) {
    console.error("Fetch rates error:", error);
    return NextResponse.json({ error: "Failed to fetch exchange rates" }, { status: 500 });
  }
}