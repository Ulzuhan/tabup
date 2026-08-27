import { NextRequest, NextResponse } from "next/server";
import { fail, type ErrorCode } from "@/lib/api-error";
import { jsonBody } from "@/lib/body";
import { getCurrentUser } from "@/lib/auth";
import type { RecurringInput } from "@/lib/store";
import {
  addRecurring,
  convertTo,
  deleteRecurring,
  listRecurring,
  updateRecurring,
} from "@/lib/store";
import { CATEGORIES, CURRENCIES } from "@/lib/types";
import { PERIODS } from "@/lib/recurring";

/**
 * Recurring expenses.
 *
 * Account-only, with no anonymous mode: these are one person's standing costs, they
 * have nobody to share with, and there is no link that could grant access to them.
 */
async function requireUser() {
  const user = await getCurrentUser();
  return user ?? null;
}

export async function GET() {
  const user = await requireUser();
  if (!user) return fail("signin_required", 401);

  return NextResponse.json({ items: await listRecurring(user.id) });
}

/**
 * Validates a payload for both create and update.
 *
 * The refusal is a code rather than a sentence, like every other route: the wording is
 * the client's business, since it is the one that knows what language somebody reads.
 */
async function parseBody(
  body: Record<string, unknown>
): Promise<{ error: ErrorCode; value?: undefined } | { error?: undefined; value: RecurringInput }> {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 100) return { error: "name_required" as const };

  const amount = parseFloat(String(body.amount));
  if (!isFinite(amount) || amount <= 0 || amount > 1e9) {
    return { error: "amount_range" as const };
  }

  const currency = typeof body.currency === "string" ? body.currency : "EUR";
  if (!CURRENCIES.find((c) => c.code === currency)) return { error: "invalid_currency" as const };

  const period = String(body.period ?? "monthly");
  if (!PERIODS.includes(period as (typeof PERIODS)[number])) return { error: "invalid_period" as const };

  const chargeDay = Math.min(31, Math.max(1, parseInt(String(body.chargeDay ?? 1), 10) || 1));

  const chargeMonth =
    body.chargeMonth == null
      ? null
      : Math.min(12, Math.max(1, parseInt(String(body.chargeMonth), 10) || 1));

  const category = CATEGORIES.find((c) => c.id === body.category) ? String(body.category) : "other";

  const startedAt = body.startedAt ? new Date(String(body.startedAt)).getTime() : Date.now();
  if (!isFinite(startedAt)) return { error: "invalid_date" as const };

  const endedAt = body.endedAt ? new Date(String(body.endedAt)).getTime() : null;
  if (endedAt !== null && (!isFinite(endedAt) || endedAt < startedAt)) {
    return { error: "invalid_date" as const };
  }

  // Converted once and stored, so a total does not move every time rates refresh.
  //
  // Euros are the declared base here, unlike a trip, which keeps its own currency: fixed
  // costs belong to one person rather than a group, and the monthly total is labelled in
  // euros on screen — so the unit stored and the unit shown agree.
  let amountBase = amount;
  if (currency !== "EUR") {
    try {
      ({ amount: amountBase } = await convertTo(amount, currency, "EUR"));
    } catch {
      return { error: "rate_unavailable" };
    }
  }

  return {
    value: {
      name,
      amount,
      currency,
      amountBase,
      period,
      chargeDay,
      chargeMonth,
      category,
      startedAt,
      endedAt,
      note:
        typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 300) : null,
    },
  };
}

export async function POST(request: NextRequest) {
  const user = await requireUser();
  if (!user) return fail("signin_required", 401);

  // `null` es JSON válido: pasaba el catch y reventaba al leer un campo.
  const body: Record<string, unknown> | null = await jsonBody(request);
  if (!body) return fail("bad_json", 400);

  const parsed = await parseBody(body);
  if (parsed.error) return fail(parsed.error, 400);

  const created = await addRecurring(user.id, parsed.value);
  if (!created) return fail("save_failed", 500);
  return NextResponse.json(created);
}

export async function PATCH(request: NextRequest) {
  const user = await requireUser();
  if (!user) return fail("signin_required", 401);

  // `null` es JSON válido: pasaba el catch y reventaba al leer un campo.
  const body: Record<string, unknown> | null = await jsonBody(request);
  if (!body) return fail("bad_json", 400);

  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return fail("missing_field", 400, { field: "id" });

  const parsed = await parseBody(body);
  if (parsed.error) return fail(parsed.error, 400);

  /**
   * Re-priced only when the money itself moved.
   *
   * `parseBody` converts unconditionally, so renaming a subscription used to re-value it
   * at today's rate — the same silent rewrite the trip expenses had, with no guard at
   * all. The stored figure is converted once, at the moment it is stated, and stays put
   * until somebody restates it.
   */
  const existing = (await listRecurring(user.id)).find((item) => item.id === id);
  const value =
    existing && existing.amount === parsed.value.amount && existing.currency === parsed.value.currency
      ? { ...parsed.value, amountBase: existing.amountBase }
      : parsed.value;

  // The user id in the WHERE clause is what stops anyone editing someone else's row.
  const updated = await updateRecurring(user.id, id, value);
  if (!updated) return fail("not_found", 404);
  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const user = await requireUser();
  if (!user) return fail("signin_required", 401);

  const cuerpo = await jsonBody(request);
  if (!cuerpo) return fail("bad_json", 400);
  const { id } = cuerpo;
  if (!id) return fail("missing_field", 400, { field: "id" });

  const removed = await deleteRecurring(user.id, id);
  if (!removed) return fail("not_found", 404);
  return NextResponse.json({ success: true });
}
