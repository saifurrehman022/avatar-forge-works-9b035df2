export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const raw = req.query?.url;
  const url =
    typeof raw === "string"
      ? raw
      : Array.isArray(raw)
      ? raw[0]
      : null;

  if (!url) {
    return res.status(400).json({
      error: "Missing ?url= query parameter",
    });
  }

  // Allow only trusted media/CDN domains
  const allowed = [
    "cloudfront.net",
    "supabase.co",
    "supabase.in",
    "fanvue.com",
  ];

  const isAllowed = allowed.some((d) => url.includes(d));

  if (!isAllowed) {
    return res.status(403).json({
      error: "Domain not allowed",
    });
  }

  try {
    const upstream = await fetch(url);

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: `Upstream fetch failed (${upstream.status}) for ${url}`,
      });
    }

    const contentType =
      upstream.headers.get("content-type") ??
      "application/octet-stream";

    const buf = Buffer.from(await upstream.arrayBuffer());

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=3600");

    return res.status(200).send(buf);
  } catch (e: any) {
    return res.status(500).json({
      error: e?.message ?? "Proxy fetch failed",
    });
  }
}
