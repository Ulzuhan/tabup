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
}

export interface Payment {
  id: string;
  from: string; // member id who paid
  to: string; // member id who received
  amount: number; // in trip's default currency
  date: number;
  note?: string;
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