
/**
 * api/proxy-media.ts
 *
 * Download media from CloudFront or Supabase storage server-side.
 * Browser fetch to CloudFront is often blocked by CORS.
 * This proxy runs on the Vercel edge where CORS doesn't apply.
 *
 * Usage: GET /api/proxy-media?url=<encoded-url>
 */

const ALLOWED_DOMAINS = [
  "cloudfront.net",
  "supabase.co",
  "supabase.in",
  "fanvue.com",
];

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  const raw = req.query?.url;
  const url = typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : null;

  if (!url) return res.status(400).json({ error: "Missing ?url= parameter" });

  const isAllowed = ALLOWED_DOMAINS.some(d => url.includes(d));
  if (!isAllowed) return res.status(403).json({ error: `Domain not allowed: ${new URL(url).hostname}` });

  try {
    const upstream = await fetch(url);
    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: `Upstream fetch failed (${upstream.status}) for URL: ${url.slice(0, 100)}`,
      });
    }

    const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
    const buffer = Buffer.from(await upstream.arrayBuffer());

    res.setHeader("Content-Type",  contentType);
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.status(200).send(buffer);

  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "Proxy fetch failed" });
  }
}

Writ
