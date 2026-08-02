import { NextRequest, NextResponse } from "next/server";
import { getTrip, updateTrip, generateId, convertToEur } from "@/lib/store";
import type { Expense } from "@/lib/types";
import { CATEGORIES } from "@/lib/types";

// POST — Add new expense
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!/^[0-9a-f]{8,32}$/.test(id)) {
    return NextResponse.json({ error: "Invalid trip ID format" }, { status: 400 });
  }
  let trip;
  try {
    trip = await getTrip(id);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Invalid trip ID format") || msg.includes("Path traversal")) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to load trip" }, { status: 500 });
  }
  if (!trip) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }

  try {
    const body = await request.json();
    const { description, amount, currency, paidBy, splitAmong, category } = body;

    if (!description || !amount || !paidBy) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || !isFinite(parsedAmount) || parsedAmount <= 0 || parsedAmount > 1e9) {
      return NextResponse.json({ error: "Amount must be a positive finite number up to 1 billion" }, { status: 400 });
    }

    if (!trip.members.find((m) => m.id === paidBy)) {
      return NextResponse.json({ error: "Invalid paidBy member" }, { status: 400 });
    }

    const splitIds = splitAmong || trip.members.map((m) => m.id);
    for (const sid of splitIds) {
      if (!trip.members.find((m) => m.id === sid)) {
        return NextResponse.json({ error: `Invalid split member: ${sid}` }, { status: 400 });
      }
    }

    // Validate splitShares if provided
    if (body.splitShares && typeof body.splitShares === "object") {
      for (const [key, val] of Object.entries(body.splitShares)) {
        if (!splitIds.includes(key)) {
          return NextResponse.json({ error: `splitShares key "${key}" not in splitAmong` }, { status: 400 });
        }
        if (typeof val !== "number" || val <= 0 || !isFinite(val)) {
          return NextResponse.json({ error: `splitShares["${key}"] must be a positive finite number` }, { status: 400 });
        }
      }
    }

    const expCurrency = currency || trip.currency;
    let amountEur: number;
    let rateUsed: boolean;
    try {
      const result = await convertToEur(parsedAmount, expCurrency);
      amountEur = result.amountEur;
      rateUsed = result.rateUsed;
    } catch (err) {
      return NextResponse.json({ error: `Cannot convert ${expCurrency} to EUR: ${err instanceof Error ? err.message : 'Rate unavailable'}` }, { status: 502 });
    }

    const expense: Expense = {
      id: generateId(),
      description: description.trim(),
      amount: parsedAmount,
      currency: expCurrency,
      amountEur,
      paidBy,
      splitAmong: splitIds,
      splitShares: body.splitShares && Object.keys(body.splitShares).length > 0 ? body.splitShares : undefined,
      category: CATEGORIES.find((c) => c.id === category) ? category : "other",
      date: body.date ? new Date(body.date).getTime() : Date.now(),
      exchangeRate: (expCurrency !== "EUR" && amountEur > 0) ? parsedAmount / amountEur : undefined,
      rateAvailable: rateUsed,
    };

    trip.expenses.push(expense);
    trip.version = (trip.version || 0) + 1;
    await updateTrip(trip);

    return NextResponse.json(expense);
  } catch (error) {
    console.error("Add expense error:", error);
    return NextResponse.json({ error: "Failed to add expense" }, { status: 500 });
  }
}

// PATCH — Edit existing expense
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!/^[0-9a-f]{8,32}$/.test(id)) {
    return NextResponse.json({ error: "Invalid trip ID format" }, { status: 400 });
  }
  let trip;
  try {
    trip = await getTrip(id);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Invalid trip ID format") || msg.includes("Path traversal")) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to load trip" }, { status: 500 });
  }
  if (!trip) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }

  try {
    const body = await request.json();
    const { expenseId, description, amount, currency, paidBy, splitAmong, category } = body;

    if (!expenseId) {
      return NextResponse.json({ error: "expenseId required" }, { status: 400 });
    }

    const idx = trip.expenses.findIndex((e) => e.id === expenseId);
    if (idx === -1) {
      return NextResponse.json({ error: "Expense not found" }, { status: 404 });
    }

    const existing = trip.expenses[idx];

    // Validate paidBy if provided
    const newPaidBy = paidBy || existing.paidBy;
    if (!trip.members.find((m) => m.id === newPaidBy)) {
      return NextResponse.json({ error: "Invalid paidBy member" }, { status: 400 });
    }

    // Validate splitAmong if provided
    const newSplitAmong = splitAmong || existing.splitAmong;
    for (const sid of newSplitAmong) {
      if (!trip.members.find((m) => m.id === sid)) {
        return NextResponse.json({ error: `Invalid split member: ${sid}` }, { status: 400 });
      }
    }

    const newCurrency = currency || existing.currency;
    const newAmount = amount !== undefined ? parseFloat(amount) : existing.amount;
    if (amount !== undefined && (isNaN(newAmount) || !isFinite(newAmount) || newAmount <= 0 || newAmount > 1e9)) {
      return NextResponse.json({ error: "Amount must be a positive finite number up to 1 billion" }, { status: 400 });
    }
    let newAmountEur: number;
    let rateUsed: boolean;
    if (newCurrency === "EUR" && newAmount === existing.amount && currency === undefined) {
      newAmountEur = existing.amountEur;
      rateUsed = true;
    } else {
      try {
        const result = await convertToEur(newAmount, newCurrency);
        newAmountEur = result.amountEur;
        rateUsed = result.rateUsed;
      } catch (err) {
        return NextResponse.json({ error: `Cannot convert ${newCurrency} to EUR: ${err instanceof Error ? err.message : 'Rate unavailable'}` }, { status: 502 });
      }
    }

    // Merge updates
    trip.expenses[idx] = {
      ...existing,
      description: description?.trim() || existing.description,
      amount: newAmount,
      currency: newCurrency,
      amountEur: newAmountEur,
      paidBy: newPaidBy,
      splitAmong: newSplitAmong,
      splitShares: body.splitShares !== undefined ? (Object.keys(body.splitShares).length > 0 ? body.splitShares : undefined) : existing.splitShares,
      category: category && CATEGORIES.find((c) => c.id === category) ? category : existing.category,
      date: body.date ? new Date(body.date).getTime() : existing.date,
      exchangeRate: (newCurrency !== "EUR" && newAmountEur > 0) ? newAmount / newAmountEur : undefined,
      rateAvailable: rateUsed,
    };

    trip.version = (trip.version || 0) + 1;
    await updateTrip(trip);

    return NextResponse.json(trip.expenses[idx]);
  } catch (error) {
    console.error("Edit expense error:", error);
    return NextResponse.json({ error: "Failed to edit expense" }, { status: 500 });
  }
}

// DELETE — Remove expense
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!/^[0-9a-f]{8,32}$/.test(id)) {
    return NextResponse.json({ error: "Invalid trip ID format" }, { status: 400 });
  }
  let trip;
  try {
    trip = await getTrip(id);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Invalid trip ID format") || msg.includes("Path traversal")) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to load trip" }, { status: 500 });
  }
  if (!trip) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }

  let expenseId: string;
  try {
    ({ expenseId } = await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!expenseId) {
    return NextResponse.json({ error: "expenseId required" }, { status: 400 });
  }

  const idx = trip.expenses.findIndex((e) => e.id === expenseId);
  if (idx === -1) {
    return NextResponse.json({ error: "Expense not found" }, { status: 404 });
  }

  trip.expenses.splice(idx, 1);
  trip.version = (trip.version || 0) + 1;
  await updateTrip(trip);

  return NextResponse.json({ success: true });
}