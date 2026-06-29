

import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const url = req.query.url as string;
  if (!url) return res.status(400).end("Missing url param");

  // Only allow known CDN domains
  const allowed = ["cloudfront.net", "supabase.co", "supabase.in"];
  const isAllowed = allowed.some(d => url.includes(d));
  if (!isAllowed) return res.status(403).end("Domain not allowed");

  const upstream = await fetch(url);
  if (!upstream.ok) return res.status(upstream.status).end("Upstream failed");

  const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
  const buffer = Buffer.from(await upstream.arrayBuffer());

  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "no-store");
  res.send(buffer);
}

