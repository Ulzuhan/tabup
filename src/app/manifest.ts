import type { MetadataRoute } from "next";

/**
 * Web app manifest.
 *
 * `display: standalone` is the point of installing this: splitting a bill at a table
 * means opening the app repeatedly, and losing the browser chrome saves a tap and a
 * lot of visual noise each time.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TabUp — Shared Expense Tracker",
    short_name: "TabUp",
    description:
      "Track what everyone paid, in any currency, and see who owes whom. No account needed.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#141520",
    theme_color: "#141520",
    categories: ["finance", "travel", "utilities"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Android crops this one to whatever shape the launcher uses.
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
