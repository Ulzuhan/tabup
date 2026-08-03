import { monthlyEquivalent, nextCharge, upcoming, chargedInMonth, activeAt } from "../src/lib/recurring.ts";

let pass = 0, fail = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${ok ? "✓" : "✗"} ${name}${ok ? "" : `  esperado ${JSON.stringify(expected)}, salió ${JSON.stringify(actual)}`}`);
  if (ok) pass++; else fail++;
};
const d = (s) => new Date(s + "T12:00:00").getTime();
const day = (ms) => new Date(ms).toISOString().slice(0, 10);

const base = { id: "1", name: "x", amount: 10, currency: "EUR", category: "other", chargeDay: 1, startedAt: d("2024-01-01") };

console.log("Equivalente mensual");
check("mensual 12,99", monthlyEquivalent({ amountBase: 12.99, period: "monthly" }), 12.99);
check("anual 380 -> /12", Math.round(monthlyEquivalent({ amountBase: 380, period: "yearly" }) * 100) / 100, 31.67);
check("trimestral 60 -> /3", monthlyEquivalent({ amountBase: 60, period: "quarterly" }), 20);
// 52 semanas, no 4 al mes
check("semanal 10 -> 43,33", Math.round(monthlyEquivalent({ amountBase: 10, period: "weekly" }) * 100) / 100, 43.33);

console.log("\nDía de cobro en meses cortos");
const day31 = { ...base, amountBase: 10, period: "monthly", chargeDay: 31 };
check("31 en enero", day(nextCharge(day31, d("2026-01-05"))), "2026-01-31");
// Sin ajustar, new Date(2026,1,31) se iría al 3 de marzo
check("31 en febrero -> 28", day(nextCharge(day31, d("2026-02-05"))), "2026-02-28");
check("31 en abril -> 30", day(nextCharge(day31, d("2026-04-05"))), "2026-04-30");

console.log("\nAnual");
const yearly = { ...base, amountBase: 380, period: "yearly", chargeDay: 15, chargeMonth: 3, startedAt: d("2023-03-15") };
check("próximo cobro tras marzo", day(nextCharge(yearly, d("2026-05-01"))), "2027-03-15");
check("antes de marzo, este año", day(nextCharge(yearly, d("2026-01-10"))), "2026-03-15");

console.log("\nTrimestral desde febrero");
const q = { ...base, amountBase: 60, period: "quarterly", chargeDay: 10, startedAt: d("2026-02-10") };
check("siguiente tras febrero", day(nextCharge(q, d("2026-03-01"))), "2026-05-10");
check("siguiente tras mayo", day(nextCharge(q, d("2026-06-01"))), "2026-08-10");

console.log("\nCancelados");
const cancelled = { ...base, amountBase: 9.99, period: "monthly", endedAt: d("2026-07-01") };
check("activo antes de cancelar", activeAt(cancelled, d("2026-06-01")), true);
check("inactivo después", activeAt(cancelled, d("2026-08-01")), false);
check("sin próximo cobro", nextCharge(cancelled, d("2026-08-01")), null);

console.log("\nCoste real de un mes");
const items = [
  { ...base, id: "n", name: "Netflix", amountBase: 12.99, period: "monthly", chargeDay: 5 },
  { ...base, id: "s", name: "Seguro", amountBase: 380, period: "yearly", chargeDay: 15, chargeMonth: 3, startedAt: d("2023-03-15") },
];
check("marzo lleva el seguro", Math.round(chargedInMonth(items, 2026, 2) * 100) / 100, 392.99);
check("abril solo Netflix", Math.round(chargedInMonth(items, 2026, 3) * 100) / 100, 12.99);

console.log("\nPróximos 30 días");
const weekly = { ...base, amountBase: 5, period: "weekly", startedAt: d("2026-08-01") };
const list = upcoming([weekly], 30, d("2026-08-01"));
check("semanal aparece 5 veces en 30 días", list.length, 5);

console.log(`\n${pass} pasan, ${fail} fallan`);
process.exit(fail ? 1 : 0);
