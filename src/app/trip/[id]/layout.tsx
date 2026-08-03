import type { Metadata } from "next";

/**
 * Page title and link preview for a trip.
 *
 * Always the bare app name, never the trip's. Every trip belongs to an account now, so
 * naming one here would leak it: this runs before any session check, and a link pasted
 * into a group chat gets fetched by whatever generates the preview.
 */
export const metadata: Metadata = { title: "TabUp" };

export default function TripLayout({ children }: { children: React.ReactNode }) {
  return children;
}
