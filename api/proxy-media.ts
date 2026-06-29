/**
 * api/proxy-media.ts
 *
 * Download media from CloudFront / Supabase server-side (CORS bypass).
 * Usage: GET /api/proxy-media?url=<encoded-url>
 *
 * No body parsing needed — GET only.
 */

export const config = { api: { bodyParser: false } };

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
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  const raw = req.query?.url;
  const url = typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : null;
  if (!url) return res.status(400).json({ error: "Missing ?url= parameter" });

  let parsed: URL;
  try { parsed = new URL(url); } catch { return res.status(400).json({ error: "Invalid URL" }); }

  const isAllowed = ALLOWED_DOMAINS.some(d => parsed.hostname.endsWith(d));
  if (!isAllowed) return res.status(403).json({ error: `Domain not in allowlist: ${parsed.hostname}` });

  try {
    const upstream = await fetch(url);
    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: `Upstream fetch failed (${upstream.status}) for: ${url.slice(0, 100)}`,
      });
    }
    const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.setHeader("Content-Type",   contentType);
    res.setHeader("Content-Length", String(buffer.length));
    res.setHeader("Cache-Control",  "public, max-age=3600");
    res.status(200).send(buffer);
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "Proxy fetch failed" });
  }
}
