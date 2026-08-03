import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { listRecurring } from "@/lib/store";
import { monthlyEquivalent, nextCharge, yearlyEquivalent } from "@/lib/recurring";

/**
 * Recurring expenses as a spreadsheet.
 *
 * Carries both the charged amount and its monthly equivalent, because those answer
 * different questions: what leaves the account on a given day, and what the thing
 * really costs to keep. A yearly premium of 380 is 31,67 a month, and a list that only
 * showed one of the two would be misleading either way.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const items = await listRecurring(user.id);

  const safe = (value: unknown) => {
    const str = String(value ?? "");
    const escaped = str.replace(/"/g, '""');
    return /^[=+\-@\t\r]/.test(str) ? `"'${escaped}"` : `"${escaped}"`;
  };
  const num = (n: number) => n.toFixed(2);
  const day = (ms: number | null | undefined) =>
    ms == null ? "" : new Date(ms).toISOString().split("T")[0];

  const active = items.filter((i) => i.endedAt == null);
  const monthly = active.reduce((sum, i) => sum + monthlyEquivalent(i), 0);

  const lines = [
    [safe("Name"), safe("Amount"), safe("Currency"), safe("Period"), safe("Per month (EUR)"),
     safe("Per year (EUR)"), safe("Category"), safe("Started"), safe("Ended"), safe("Next charge"),
     safe("Note")].join(","),
    ...items.map((i) =>
      [
        safe(i.name),
        num(i.amount),
        safe(i.currency),
        safe(i.period),
        num(monthlyEquivalent(i)),
        num(yearlyEquivalent(i)),
        safe(i.category),
        safe(day(i.startedAt)),
        safe(day(i.endedAt)),
        safe(day(nextCharge(i))),
        safe(i.note ?? ""),
      ].join(",")
    ),
    "",
    [safe("Active"), active.length].join(","),
    [safe("Total per month"), num(monthly)].join(","),
    [safe("Total per year"), num(monthly * 12)].join(","),
  ];

  // BOM so Excel opens UTF-8 without mangling accents.
  return new NextResponse("﻿" + lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="recurring.csv"',
    },
  });
}
