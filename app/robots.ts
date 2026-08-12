import type { MetadataRoute } from "next";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://meridian-terminal.vercel.app";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Nothing under /api is a page, and the session endpoint should never
        // be fetched by a crawler.
        disallow: ["/api/"],
      },
    ],
    sitemap: `${SITE}/sitemap.xml`,
  };
}
