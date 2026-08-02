import { NextRequest, NextResponse } from "next/server";
import { getTrip } from "@/lib/store";
import { CURRENCIES } from "@/lib/types";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!/^[0-9a-f]{8,32}$/.test(id)) {
    return NextResponse.json({ error: "Invalid trip ID format" }, { status: 400 });
  }
  const trip = await getTrip(id);
  if (!trip) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }

  // Generate CSV
  const sanitizeCsv = (val: string) => {
    const str = String(val);
    if (/^[=+\-@\t\r]/.test(str)) {
      return `'${str}`;
    }
    return str;
  };

  const currencySymbol = (code: string) => {
    const found = (CURRENCIES as readonly { code: string; symbol: string }[]).find((c) => c.code === code);
    return found?.symbol || code;
  };

  const memberName = (id: string) => trip.members.find((m) => m.id === id)?.name || id;

  const rows = [
    ["Date", "Description", "Category", "Amount", "Currency", "Amount (€)", "Paid By", "Split Among"].join(","),
    ...trip.expenses.map((e) =>
      [
        new Date(e.date).toISOString().split("T")[0],
        `"${sanitizeCsv(e.description)}"`,
        e.category,
        e.amount.toFixed(2),
        e.currency,
        e.amountEur.toFixed(2),
        `"${sanitizeCsv(memberName(e.paidBy))}"`,
        `"${e.splitAmong.map((id) => sanitizeCsv(memberName(id))).join(", ")}"`,
      ].join(",")
    ),
  ];

  const csv = rows.join("\n");
  const filename = `${trip.name.replace(/[^a-zA-Z0-9]/g, "_")}_expenses.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}