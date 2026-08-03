import type { Metadata } from "next";
import { getTrip, isAnonymousTrip } from "@/lib/store";

/**
 * Page title and link preview for a trip.
 *
 * This used to read the old per-trip JSON file directly, which stopped existing when
 * storage moved to SQLite — every shared link had been falling back to the bare app
 * name since then.
 *
 * Only anonymous trips get a real title. An owned trip is private, and this runs
 * before any session check, so naming it here would leak it to anyone who pasted the
 * link into a chat that fetches previews.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;

  try {
    if (!isAnonymousTrip(id)) return { title: "TabUp" };

    const trip = await getTrip(id);
    if (!trip) return { title: "TabUp" };

    const title = `${trip.name} — TabUp`;
    return {
      title,
      openGraph: {
        title,
        description: `${trip.members.length} members · ${trip.expenses.length} expenses · ${trip.currency}`,
      },
    };
  } catch {
    return { title: "TabUp" };
  }
}

export default function TripLayout({ children }: { children: React.ReactNode }) {
  return children;
}
