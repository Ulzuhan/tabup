import type { Metadata } from "next";

/**
 * Never in a search index: An invitation token in the path is what grants access to a trip.
 * `robots.txt` disallows this prefix as well — two layers, because a crawler
 * that indexes one of these publishes something private.
 *
 * It lives in a layout because the page itself is a client component, and those
 * cannot export metadata.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function JoinLayout({ children }: { children: React.ReactNode }) {
  return children;
}
