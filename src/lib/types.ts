// Shared types for TabUp

export interface Trip {
  id: string;
  name: string;
  currency: string;
  /** Optional spending target; null/undefined means nobody set one. */
  budget?: number | null;
  createdAt: number;
  version?: number;
  members: Member[];
  expenses: Expense[];
  payments: Payment[]; // Settle-up payments
}

export interface Member {
  id: string;
  name: string;
  emoji: string;
  /**
   * The account this participant is, when there is one.
   *
   * A member without it is a free label: a column in the arithmetic for somebody who
   * has no account here and may never have one. Both kinds are legitimate — the point
   * of the app is splitting a bill at a table, and half the table will not register —
   * but only a linked member can be told apart from a name that merely looks the same,
   * which is what lets the app say "you owe 23" instead of "Andoni owes 23".
   */
  userId?: string | null;
  /** The account's own name, when linked. Shown next to a per-trip alias that differs. */
  accountName?: string;
  /**
   * The account's address. Only ever sent to the trip's owner, who typed it in order to
   * invite them; see `memberEmails`.
   */
  accountEmail?: string;
  /**
   * Whether the account behind this seat can still open the trip.
   *
   * Undefined for a free member, where the question does not arise. False means somebody
   * who was taken out: their column and every figure in it stay — being shown the door is
   * not a statement that their half of the taxi never happened — but the seat is still
   * theirs, so nobody else can claim it and inviting them again puts them back in it
   * rather than starting a second column beside the first.
   */
  inTrip?: boolean;
}

export interface Expense {
  id: string;
  description: string;
  amount: number;
  currency: string;
  amountBase: number;
  paidBy: string;
  splitAmong: string[];
  splitShares?: Record<string, number>; // optional: member id → share weight for unequal splits
  category: string;
  date: number;
  exchangeRate?: number;
  rateAvailable?: boolean; // false if no live/cached rate was found
  note?: string; // free text, for what the description has no room for
  receipt?: string; // filename of the attached receipt photo
  /**
   * Whether the reader may change this one.
   *
   * Attached per reader by the API rather than stored: everyone in a trip adds
   * expenses, each answers for the ones they added, and the owner can fix any of them.
   * Absent on an expense that has not been through the API — one still sitting in the
   * offline queue, for instance, which is by definition the reader's own.
   */
  mine?: boolean;
  /**
   * What the person who entered it is called in this trip, when that is not the payer.
   *
   * Shown because the rule about who may change it is otherwise invisible: somebody
   * looking at a line with no edit button is told neither whose it is nor who to ask.
   * Omitted when the payer entered it themselves, which is most of the time and would
   * otherwise repeat a name already on the row.
   */
  by?: string;
  /** How many comments it has, so the list can show it without loading them. */
  comments?: number;
}

export interface Payment {
  id: string;
  from: string; // member id who paid
  to: string; // member id who received
  amount: number; // in trip's default currency
  date: number;
  note?: string;
  /** Whether the reader may undo it; see `Expense.mine`. */
  mine?: boolean;
}

export interface Settlement {
  from: string;
  to: string;
  amount: number;
}

export interface Balance {
  memberId: string;
  totalPaid: number;
  totalShare: number;
  balance: number;
}

// Only currencies supported by the Frankfurter API (ECB rates)
export const CURRENCIES = [
  { code: "EUR", name: "Euro", symbol: "€" },
  { code: "USD", name: "US Dollar", symbol: "$" },
  { code: "GBP", name: "British Pound", symbol: "£" },
  { code: "JPY", name: "Japanese Yen", symbol: "¥" },
  { code: "CNY", name: "Chinese Yuan", symbol: "¥" },
  { code: "KRW", name: "South Korean Won", symbol: "₩" },
  { code: "MXN", name: "Mexican Peso", symbol: "$" },
  { code: "BRL", name: "Brazilian Real", symbol: "R$" },
  { code: "THB", name: "Thai Baht", symbol: "฿" },
  { code: "PHP", name: "Philippine Peso", symbol: "₱" },
  { code: "TRY", name: "Turkish Lira", symbol: "₺" },
  { code: "SEK", name: "Swedish Krona", symbol: "kr" },
  { code: "CHF", name: "Swiss Franc", symbol: "CHF" },
  { code: "CAD", name: "Canadian Dollar", symbol: "CA$" },
  { code: "AUD", name: "Australian Dollar", symbol: "A$" },
  { code: "NZD", name: "New Zealand Dollar", symbol: "NZ$" },
  { code: "SGD", name: "Singapore Dollar", symbol: "S$" },
  { code: "HKD", name: "Hong Kong Dollar", symbol: "HK$" },
  { code: "NOK", name: "Norwegian Krone", symbol: "kr" },
  { code: "DKK", name: "Danish Krone", symbol: "kr" },
  { code: "PLN", name: "Polish Zloty", symbol: "zł" },
  { code: "CZK", name: "Czech Koruna", symbol: "Kč" },
  { code: "HUF", name: "Hungarian Forint", symbol: "Ft" },
  { code: "ILS", name: "Israeli Shekel", symbol: "₪" },
  { code: "ISK", name: "Icelandic Krona", symbol: "kr" },
  { code: "INR", name: "Indian Rupee", symbol: "₹" },
  { code: "IDR", name: "Indonesian Rupiah", symbol: "Rp" },
  { code: "MYR", name: "Malaysian Ringgit", symbol: "RM" },
  { code: "RON", name: "Romanian Leu", symbol: "lei" },
  { code: "ZAR", name: "South African Rand", symbol: "R" },
] as const;

export const EMOJIS = ["😊", "😎", "🤠", "👻", "🦊", "🐱", "🐶", "🦄", "🐼", "🐨", "🐸", "🦋", "🌸", "⚡", "🔥", "💎", "🎮", "🎸", "🏖️", "✈️"] as const;

export const CATEGORIES = [
  { id: "food", name: "Food & Drinks", emoji: "🍕" },
  { id: "transport", name: "Transport", emoji: "🚗" },
  { id: "accommodation", name: "Accommodation", emoji: "🏨" },
  { id: "activity", name: "Activities", emoji: "🎯" },
  { id: "shopping", name: "Shopping", emoji: "🛍️" },
  { id: "health", name: "Health & Pharmacy", emoji: "💊" },
  { id: "other", name: "Other", emoji: "📦" },
] as const;