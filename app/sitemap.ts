import type { MetadataRoute } from "next";

import { UNIVERSE } from "@/lib/market/universe";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://meridian-terminal.vercel.app";

/**
 * Every instrument page is a real, indexable destination — someone searching
 * "RELIANCE NSE chart" should be able to land directly on it — so the whole
 * universe is enumerated rather than just the marketing routes.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: SITE, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${SITE}/dashboard`, lastModified: now, changeFrequency: "hourly", priority: 0.9 },
    { url: `${SITE}/markets`, lastModified: now, changeFrequency: "hourly", priority: 0.9 },
    { url: `${SITE}/screener`, lastModified: now, changeFrequency: "daily", priority: 0.8 },
    { url: `${SITE}/compare`, lastModified: now, changeFrequency: "daily", priority: 0.8 },
    { url: `${SITE}/watchlist`, lastModified: now, changeFrequency: "weekly", priority: 0.5 },
    { url: `${SITE}/portfolio`, lastModified: now, changeFrequency: "weekly", priority: 0.5 },
    { url: `${SITE}/alerts`, lastModified: now, changeFrequency: "weekly", priority: 0.5 },
    { url: `${SITE}/login`, lastModified: now, changeFrequency: "monthly", priority: 0.3 },
    { url: `${SITE}/signup`, lastModified: now, changeFrequency: "monthly", priority: 0.4 },
  ];

  const instruments: MetadataRoute.Sitemap = UNIVERSE.map((i) => ({
    url: `${SITE}/stock/${encodeURIComponent(i.slug)}`,
    lastModified: now,
    changeFrequency: "hourly" as const,
    priority: i.kind === "index" ? 0.8 : 0.6,
  }));

  return [...staticRoutes, ...instruments];
}
