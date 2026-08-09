import { NextResponse } from "next/server";
import { fail } from "@/lib/api-error";
import { getCurrentUser } from "@/lib/auth";
import { fetchExchangeRates } from "@/lib/store";
import { logError } from "@/lib/errors";

/**
 * The rate table.
 *
 * Behind a session, like everything else. Nothing in the app calls it — the conversion
 * happens on the server, where the money is written — so it is a window for looking at
 * what this instance believes today. That is not secret, but it is an endpoint that
 * reaches out to the internet on request, and an unauthenticated one of those is a thing
 * somebody else can make this machine do.
 */
export async function GET() {
  if (!(await getCurrentUser())) return fail("signin_required", 401);

  try {
    const table = await fetchExchangeRates();
    if (!table) {
      return fail("rate_unavailable", 503);
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
    return fail("rate_unavailable", 500);
  }
}