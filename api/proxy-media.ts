// /api/proxy-media.ts
//
// MUST also live at <repo root>/api/proxy-media.ts (same rules as
// fanvue-token.ts — committed, pushed, root-level /api folder).
//
// Your schedule.tsx already calls this as a CORS fallback inside
// fetchMediaBlob() when a direct browser fetch() to the media URL fails
// (this is common for CloudFront URLs that don't send
// Access-Control-Allow-Origin). This route just downloads the file
// server-side (no CORS rules apply server-to-server) and streams it back.

export default async function handler(req: any, res: any) {
  const raw = req.query?.url;
  const url = typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : null;

  if (!url) {
    res.status(400).json({ error: "Missing ?url= query parameter" });
    return;
  }

  try {
    const upstream = await fetch(url);
    if (!upstream.ok) {
      res.status(upstream.status).json({ error: `Upstream fetch failed (${upstream.status}) for ${url}` });
      return;
    }
    const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.status(200).send(buf);
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "Proxy fetch failed" });
  }
}
