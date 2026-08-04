import { NextRequest, NextResponse } from "next/server";
import { getTrip } from "@/lib/store";
import { calculateBalances, calculateSettlements, expenseShares } from "@/lib/balances";
import { authorizeTrip } from "@/lib/authorize";

/**
 * The whole trip as a spreadsheet.
 *
 * It used to export the expense list alone, which looks complete until you try to use
 * it: without each person's share, the payments already made, or the closing balances,
 * you cannot reconstruct who owes what — which is the only reason to export a trip in
 * the first place. Now it carries every section, with one column per person so the
 * split is readable across the row.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await authorizeTrip(id, "read");
  if (!auth.ok) return auth.response;

  const trip = await getTrip(id);
  if (!trip) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }

  /**
   * Spreadsheets treat a leading =, +, - or @ as a formula, so a description like
   * "=cmd" would execute on open. Prefixing with a quote makes it text.
   */
  const safe = (value: unknown) => {
    const str = String(value ?? "");
    const escaped = str.replace(/"/g, '""');
    return /^[=+\-@\t\r]/.test(str) ? `"'${escaped}"` : `"${escaped}"`;
  };

  const num = (n: number) => n.toFixed(2);
  const day = (ms: number) => new Date(ms).toISOString().split("T")[0];
  const memberName = (memberId: string) =>
    trip.members.find((m) => m.id === memberId)?.name || memberId;

  const balances = calculateBalances(trip);
  const settlements = calculateSettlements(trip);
  const total = trip.expenses.reduce((sum, e) => sum + e.amountBase, 0);

  const lines: string[] = [];
  const section = (title: string) => {
    if (lines.length) lines.push("");
    lines.push(safe(title));
  };

  // ── Summary ────────────────────────────────────────────────────────
  section("Trip");
  lines.push([safe("Name"), safe(trip.name)].join(","));
  lines.push([safe("Currency"), safe(trip.currency)].join(","));
  lines.push([safe("Total"), num(total)].join(","));
  if (trip.budget != null) {
    lines.push([safe("Budget"), num(trip.budget)].join(","));
    lines.push([safe("Remaining"), num(trip.budget - total)].join(","));
  }
  lines.push([safe("People"), trip.members.length].join(","));
  lines.push([safe("Expenses"), trip.expenses.length].join(","));

  // ── Expenses, one column per person ────────────────────────────────
  section("Expenses");
  lines.push(
    [
      safe("Date"),
      safe("Description"),
      safe("Category"),
      safe("Amount"),
      safe("Currency"),
      safe(`Amount (${trip.currency})`),
      safe("Paid by"),
      safe("Note"),
      ...trip.members.map((m) => safe(m.name)),
    ].join(",")
  );

  for (const expense of [...trip.expenses].sort((a, b) => a.date - b.date)) {
    const shares = expenseShares(expense);
    lines.push(
      [
        safe(day(expense.date)),
        safe(expense.description),
        safe(expense.category),
        num(expense.amount),
        safe(expense.currency),
        num(expense.amountBase),
        safe(memberName(expense.paidBy)),
        safe(expense.note ?? ""),
        // Blank rather than 0.00 for someone left out of the split: an empty cell reads
        // as "not involved", a zero reads as "involved and owes nothing".
        ...trip.members.map((m) => (shares[m.id] ? num(shares[m.id]) : "")),
      ].join(",")
    );
  }

  // ── Payments ───────────────────────────────────────────────────────
  if (trip.payments.length > 0) {
    section("Payments");
    lines.push([safe("Date"), safe("From"), safe("To"), safe("Amount"), safe("Note")].join(","));
    for (const payment of [...trip.payments].sort((a, b) => a.date - b.date)) {
      lines.push(
        [
          safe(day(payment.date)),
          safe(memberName(payment.from)),
          safe(memberName(payment.to)),
          num(payment.amount),
          safe(payment.note ?? ""),
        ].join(",")
      );
    }
  }

  // ── Closing position ───────────────────────────────────────────────
  section("Balances");
  lines.push([safe("Person"), safe("Paid"), safe("Owes"), safe("Balance")].join(","));
  for (const balance of balances) {
    lines.push(
      [
        safe(memberName(balance.memberId)),
        num(balance.totalPaid),
        num(balance.totalShare),
        num(balance.balance),
      ].join(",")
    );
  }

  if (settlements.length > 0) {
    section("Who pays whom");
    lines.push([safe("From"), safe("To"), safe("Amount")].join(","));
    for (const s of settlements) {
      lines.push(
        [safe(memberName(s.from)), safe(memberName(s.to)), num(s.amount)].join(",")
      );
    }
  }

  const filename = `${trip.name.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "") || "trip"}.csv`;

  // The BOM is what makes Excel open a UTF-8 CSV without mangling accents, and this app
  // is full of names like "Begoña".
  return new NextResponse("﻿" + lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
