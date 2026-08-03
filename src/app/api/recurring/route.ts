import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  addRecurring,
  convertToEur,
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
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  return NextResponse.json({ items: await listRecurring(user.id) });
}

/** Validates a payload for both create and update. */
async function parseBody(body: Record<string, unknown>) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 100) return { error: "Name must be 1-100 characters" };

  const amount = parseFloat(String(body.amount));
  if (!isFinite(amount) || amount <= 0 || amount > 1e9) {
    return { error: "Amount must be a positive number up to 1 billion" };
  }

  const currency = typeof body.currency === "string" ? body.currency : "EUR";
  if (!CURRENCIES.find((c) => c.code === currency)) return { error: "Invalid currency" };

  const period = String(body.period ?? "monthly");
  if (!PERIODS.includes(period as (typeof PERIODS)[number])) return { error: "Invalid period" };

  const chargeDay = Math.min(31, Math.max(1, parseInt(String(body.chargeDay ?? 1), 10) || 1));

  const chargeMonth =
    body.chargeMonth == null
      ? null
      : Math.min(12, Math.max(1, parseInt(String(body.chargeMonth), 10) || 1));

  const category = CATEGORIES.find((c) => c.id === body.category) ? String(body.category) : "other";

  const startedAt = body.startedAt ? new Date(String(body.startedAt)).getTime() : Date.now();
  if (!isFinite(startedAt)) return { error: "Invalid start date" };

  const endedAt = body.endedAt ? new Date(String(body.endedAt)).getTime() : null;
  if (endedAt !== null && (!isFinite(endedAt) || endedAt < startedAt)) {
    return { error: "The end date cannot be before the start date" };
  }

  // Converted once and stored, so a total does not move every time rates refresh.
  let amountBase = amount;
  if (currency !== "EUR") {
    try {
      ({ amountEur: amountBase } = await convertToEur(amount, currency));
    } catch {
      return { error: `No exchange rate available for ${currency}` };
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
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = await parseBody(body);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const created = await addRecurring(user.id, parsed.value);
  if (!created) return NextResponse.json({ error: "Could not save it" }, { status: 500 });
  return NextResponse.json(created);
}

export async function PATCH(request: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const parsed = await parseBody(body);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  // The user id in the WHERE clause is what stops anyone editing someone else's row.
  const updated = await updateRecurring(user.id, id, parsed.value);
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  let id = "";
  try {
    ({ id } = await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const removed = await deleteRecurring(user.id, id);
  if (!removed) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
