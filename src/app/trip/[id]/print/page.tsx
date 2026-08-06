import { notFound } from "next/navigation";
import { getTrip } from "@/lib/store";
import { calculateBalances, calculateSettlements, expenseShares } from "@/lib/balances";
import { authorizeTrip } from "@/lib/authorize";
import { CURRENCIES } from "@/lib/types";
import { PrintButton } from "./print-button";

export const metadata = { title: "TabUp" };

/**
 * The trip as a printable report.
 *
 * There is no PDF library here on purpose: every browser can already turn a page into
 * a PDF, on desktop and on a phone, and it does a better job of typography and page
 * breaks than hand-positioned text ever would. What this needs to be is a page whose
 * print layout is deliberate — which is what the styles below are for.
 *
 * Rendered on the server so it works with JavaScript disabled and is a real document
 * rather than a screenshot of an app.
 */
export default async function PrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorizeTrip(id, "read");
  if (!auth.ok) notFound();

  const trip = await getTrip(id);
  if (!trip) notFound();

  const balances = calculateBalances(trip);
  const settlements = calculateSettlements(trip);
  const total = trip.expenses.reduce((sum, e) => sum + e.amountBase, 0);
  const symbol = CURRENCIES.find((c) => c.code === trip.currency)?.symbol ?? trip.currency;

  const money = (n: number) =>
    `${symbol}${new Intl.NumberFormat("es-ES", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n)}`;
  const day = (ms: number) => new Date(ms).toLocaleDateString("es-ES");
  const name = (memberId: string) =>
    trip.members.find((m) => m.id === memberId)?.name ?? memberId;

  return (
    <>
      {/*
        Light on paper regardless of the app's dark theme: printing the dark UI wastes
        an enormous amount of ink and reads badly. `print-color-adjust` keeps the few
        deliberate fills from being dropped by the browser.
      */}
      <style>{`
        @media print {
          @page { margin: 16mm; }
          .no-print { display: none !important; }
          body { background: #fff !important; }
          .sheet { box-shadow: none !important; margin: 0 !important; padding: 0 !important; }
          table { break-inside: auto; }
          tr { break-inside: avoid; break-after: auto; }
          thead { display: table-header-group; }
          .print-exact { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
        }
        .sheet { color: #16171d; background: #fff; }
        .sheet h1 { font-size: 26px; font-weight: 650; letter-spacing: -0.02em; }
        .sheet h2 {
          font-size: 12px; font-weight: 600; text-transform: uppercase;
          letter-spacing: 0.08em; color: #6b6f80; margin: 28px 0 8px;
        }
        .sheet table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .sheet th {
          text-align: left; font-weight: 600; color: #6b6f80;
          border-bottom: 1px solid #d9dbe3; padding: 6px 8px;
        }
        .sheet td { padding: 6px 8px; border-bottom: 1px solid #eceef3; }
        .sheet .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
      `}</style>

      <div className="sheet mx-auto w-full max-w-3xl p-8">
        <div className="no-print mb-6 flex items-center justify-between">
          <a href={`/trip/${id}`} className="text-sm text-[#6b6f80] underline">
            ← {trip.name}
          </a>
          <PrintButton />
        </div>

        <header className="mb-6 flex items-baseline justify-between gap-4 border-b border-[#d9dbe3] pb-4">
          <div>
            <h1>{trip.name}</h1>
            <p className="mt-1 text-[13px] text-[#6b6f80]">
              {trip.members.map((m) => m.name).join(" · ")}
            </p>
          </div>
          <div className="text-right">
            <p className="num text-2xl font-semibold">{money(total)}</p>
            <p className="text-[12px] text-[#6b6f80]">
              {trip.expenses.length} · {trip.currency}
            </p>
          </div>
        </header>

        {trip.budget != null && (
          <p className="text-[13px] text-[#6b6f80]">
            Presupuesto {money(trip.budget)} · {total > trip.budget ? "excedido en" : "quedan"}{" "}
            {money(Math.abs(trip.budget - total))}
          </p>
        )}

        <h2>Gastos</h2>
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Concepto</th>
              <th>Pagó</th>
              <th className="num">Importe</th>
              {trip.members.map((m) => (
                <th key={m.id} className="num">
                  {m.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...trip.expenses]
              .sort((a, b) => a.date - b.date)
              .map((e) => {
                const shares = expenseShares(e);
                return (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap">{day(e.date)}</td>
                    <td>
                      {e.description}
                      {e.note && <span className="block text-[11px] text-[#6b6f80]">{e.note}</span>}
                    </td>
                    <td>{name(e.paidBy)}</td>
                    {/* Always the trip's currency, so the column adds up to the total
                        at the top and to the share columns beside it. What was actually
                        paid goes underneath when it was something else — the column used
                        to hold one or the other with only the code to tell them apart. */}
                    <td className="num">
                      {money(e.amountBase)}
                      {e.currency !== trip.currency && (
                        <span className="block text-[11px] text-[#6b6f80]">
                          {e.amount.toFixed(2)} {e.currency}
                        </span>
                      )}
                    </td>
                    {trip.members.map((m) => (
                      <td key={m.id} className="num">
                        {shares[m.id] ? money(shares[m.id]) : ""}
                      </td>
                    ))}
                  </tr>
                );
              })}
          </tbody>
        </table>

        {trip.payments.length > 0 && (
          <>
            <h2>Pagos</h2>
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>De</th>
                  <th>Para</th>
                  <th>Nota</th>
                  <th className="num">Importe</th>
                </tr>
              </thead>
              <tbody>
                {[...trip.payments]
                  .sort((a, b) => a.date - b.date)
                  .map((p) => (
                    <tr key={p.id}>
                      <td className="whitespace-nowrap">{day(p.date)}</td>
                      <td>{name(p.from)}</td>
                      <td>{name(p.to)}</td>
                      <td>{p.note ?? ""}</td>
                      <td className="num">{money(p.amount)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </>
        )}

        <h2>Balances</h2>
        <table>
          <thead>
            <tr>
              <th>Persona</th>
              <th className="num">Pagó</th>
              <th className="num">Le toca</th>
              <th className="num">Balance</th>
            </tr>
          </thead>
          <tbody>
            {balances.map((b) => (
              <tr key={b.memberId}>
                <td>{name(b.memberId)}</td>
                <td className="num">{money(b.totalPaid)}</td>
                <td className="num">{money(b.totalShare)}</td>
                <td className="num font-medium">
                  {b.balance > 0.01 ? "+" : b.balance < -0.01 ? "−" : ""}
                  {money(Math.abs(b.balance))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2>Quién paga a quién</h2>
        {settlements.length === 0 ? (
          <p className="text-[13px]">Todo saldado.</p>
        ) : (
          <table>
            <tbody>
              {settlements.map((s, i) => (
                <tr key={i}>
                  <td>
                    {name(s.from)} → {name(s.to)}
                  </td>
                  <td className="num font-medium">{money(s.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <p className="mt-8 text-[11px] text-[#9a9db0]">
          TabUp · {new Date().toLocaleDateString("es-ES")}
        </p>
      </div>
    </>
  );
}
