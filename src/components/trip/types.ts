import type { Member, Expense, Payment, TripKind } from "@/lib/types";

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
  kind: TripKind;
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
  /**
   * Owner or one of the people in it — there is no third thing.
   *
   * "viewer" and "editor" were a second answer to "who is in this trip", parallel to the
   * member list and disagreeing with it: an editor could run the trip and still appear
   * in nobody's balance. Now the two are one, and what anyone may do follows from it.
   */
  access: "member" | "owner";
  /** Which participant the reader is, when they have said. Null asks the question. */
  you: string | null;
  /** The reader's account. What the offline queue stamps its writes with. */
  youAccount: string | null;
  /** The participants still free to claim, offered only while `you` is null. */
  unclaimed: Member[];
}

/** An expense that is still sitting in the offline queue carries this. */
export type MaybePendingExpense = Expense | (Expense & { pending: true });

/** Looking a member up by id is what every section below does with the member list. */
export const memberLookup = (members: Member[]) => (id: string) =>
  members.find((m) => m.id === id);
