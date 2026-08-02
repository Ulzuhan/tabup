import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  try {
    // Read trip data directly from file system (server component)
    const { readFile } = await import("fs/promises");
    const { join } = await import("path");
    const raw = await readFile(join(process.cwd(), `.splittrip-data/${id}.json`), "utf-8");
    const trip = JSON.parse(raw);
    return {
      title: `${trip.name} — SplitTrip`,
      openGraph: {
        title: `${trip.name} — SplitTrip`,
        description: `${trip.members.length} members · ${trip.expenses.length} expenses · ${trip.currency} total`,
      },
    };
  } catch {
    return { title: "SplitTrip" };
  }
}

export default function TripLayout({ children }: { children: React.ReactNode }) {
  return children;
}