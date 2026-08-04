import type { Member, Expense, Payment } from "@/lib/types";

/**
 * The shape `GET /api/trips/[id]` returns.
 *
 * It lives here rather than in the page because the sections below all take pieces of
 * it, and a type defined in the page would have every one of them importing from a
 * route file.
 */
export interface EnrichedSettlement {
  from: string;
  to: string;
  amount: number;
  fromName: string;
  fromEmoji: string;
  toName: string;
  toEmoji: string;
}

export interface EnrichedBalance {
  memberId: string;
  totalPaid: number;
  totalShare: number;
  balance: number;
  name: string;
  emoji: string;
}

export interface TripData {
  id: string;
  name: string;
  currency: string;
  createdAt: number;
  version: number;
  budget?: number | null;
  members: Member[];
  expenses: Expense[];
  payments: Payment[];
  balances: EnrichedBalance[];
  settlements: EnrichedSettlement[];
  totalExpenses: number;
  access: "viewer" | "editor" | "owner";
  collaborators: { id: string; email: string; name: string; role: string }[];
}

/** An expense that is still sitting in the offline queue carries this. */
export type MaybePendingExpense = Expense | (Expense & { pending: true });

/** Looking a member up by id is what every section below does with the member list. */
export const memberLookup = (members: Member[]) => (id: string) =>
  members.find((m) => m.id === id);
