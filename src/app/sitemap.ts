import type { MetadataRoute } from "next";

/**
 * Se evalúa en cada petición, y no es opcional: estas rutas son Route Handlers
 * que Next cachea en la construcción por defecto, y la construcción ocurre en
 * CI, donde el origen público NO existe — el sitemap salía vacío y a robots le
 * faltaba su línea Sitemap. Medido antes de publicar nada.
 */
export const dynamic = "force-dynamic";

/**
 * Only the front page and the sign-in entry point: everything else belongs to
 * an account or carries a token. Without TABUP_PUBLIC_HOST there is no absolute
 * origin to write, so it comes back empty rather than wrong.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const host = process.env.TABUP_PUBLIC_HOST?.trim();
  if (!host) return [];
  return [{ url: `https://${host}/`, changeFrequency: "monthly", priority: 1 }];
}
