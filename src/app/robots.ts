import type { MetadataRoute } from "next";

/**
 * Se evalúa en cada petición, y no es opcional: estas rutas son Route Handlers
 * que Next cachea en la construcción por defecto, y la construcción ocurre en
 * CI, donde el origen público NO existe — el sitemap salía vacío y a robots le
 * faltaba su línea Sitemap. Medido antes de publicar nada.
 */
export const dynamic = "force-dynamic";

/**
 * The disallowed list is the list of URLs that carry a credential or somebody's
 * data: an invitation token, a password-reset token, a trip only its members may
 * see, the admin queue. The front page explains the product and is the only
 * thing here meant for a search engine.
 */
export default function robots(): MetadataRoute.Robots {
  const host = process.env.TABUP_PUBLIC_HOST?.trim();
  const base = host ? `https://${host}` : undefined;
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/join/", "/reset/", "/trip/", "/admin", "/api/", "/recurring"],
    },
    ...(base ? { sitemap: `${base}/sitemap.xml`, host: base } : {}),
  };
}
