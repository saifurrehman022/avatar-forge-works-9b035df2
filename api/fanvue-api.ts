const FANVUE_API_BASE = "https://api.fanvue.com";

const BLOCKED_HEADERS = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-vercel-id",
  "x-vercel-deployment-url",
  "x-real-ip",
]);

export default async function handler(req: any, res: any) {
  const rawPath = req.query?.path;
  const path =
    typeof rawPath === "string"
      ? rawPath
      : Array.isArray(rawPath)
      ? rawPath[0]
      : null;

  if (!path || !path.startsWith("/")) {
    return res.status(400).json({ error: "Invalid path" });
  }

  const targetUrl = `${FANVUE_API_BASE}${path}`;

  const headers: Record<string, string> = {};

  for (const [k, v] of Object.entries(req.headers || {})) {
    if (BLOCKED_HEADERS.has(k.toLowerCase())) continue;

    // IMPORTANT: do not forward browser multipart boundary manually
    if (k.toLowerCase() === "content-type" && String(v).includes("multipart/form-data")) {
      continue;
    }

    headers[k] = Array.isArray(v) ? v.join(", ") : String(v);
  }

  try {
    let body: any = undefined;

    // IMPORTANT FIX
    // Preserve FormData exactly as-is
    if (req.method !== "GET" && req.method !== "HEAD") {
      body = req.body;
    }

    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      body,
    });

    const text = await upstream.text();

    res.status(upstream.status);

    for (const [k, v] of upstream.headers.entries()) {
      if (!BLOCKED_HEADERS.has(k.toLowerCase())) {
        try {
          res.setHeader(k, v);
        } catch {}
      }
    }

    res.send(text);
  } catch (e: any) {
    res.status(500).json({
      error: e?.message || "Proxy failed",
    });
  }
}
