const FANVUE_API_BASE = "https://api.fanvue.com";

const HOP_BY_HOP = new Set([
  "host", "connection", "keep-alive", "transfer-encoding",
  "te", "trailer", "upgrade", "proxy-authorization",
  "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto",
  "x-vercel-id", "x-vercel-deployment-url", "x-real-ip",
]);

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const rawPath = req.query?.path;
  const path =
    typeof rawPath === "string"
      ? rawPath
      : Array.isArray(rawPath)
      ? rawPath[0]
      : null;

  if (!path) {
    return res.status(400).json({ error: "Missing ?path=" });
  }

  if (!path.startsWith("/")) {
    return res.status(400).json({ error: "path must start with /" });
  }

  const qs = new URLSearchParams(req.query);
  qs.delete("path");

  const targetUrl =
    `${FANVUE_API_BASE}${path}` +
    (qs.toString() ? `?${qs.toString()}` : "");

  const forwardHeaders: Record<string, string> = {};

  for (const [k, v] of Object.entries(req.headers as Record<string, string | string[]>)) {
    if (HOP_BY_HOP.has(k.toLowerCase())) continue;
    forwardHeaders[k] = Array.isArray(v) ? v.join(", ") : v;
  }

  try {
    let body: BodyInit | undefined;

    if (req.method !== "GET" && req.method !== "HEAD") {
      if (typeof req.body === "object" && req.body !== null) {
        body = JSON.stringify(req.body);
        forwardHeaders["content-type"] = "application/json";
      } else if (typeof req.body === "string" && req.body.length > 0) {
        body = req.body;
      }
    }

    const upstream = await fetch(targetUrl, {
      method: req.method ?? "GET",
      headers: forwardHeaders,
      body,
    });

    for (const [k, v] of upstream.headers.entries()) {
      if (HOP_BY_HOP.has(k.toLowerCase())) continue;
      try {
        res.setHeader(k, v);
      } catch {}
    }

    const ct = upstream.headers.get("content-type") ?? "";

    if (ct.includes("text/plain") || ct === "") {
      const text = await upstream.text();
      return res.status(upstream.status).send(text);
    }

    const buf = Buffer.from(await upstream.arrayBuffer());
    return res.status(upstream.status).send(buf);
  } catch (e: any) {
    console.error("[fanvue-api proxy] error:", e?.message);

    return res.status(502).json({
      error: `Proxy fetch to Fanvue failed: ${e?.message ?? "Unknown error"}`,
      target: targetUrl,
    });
  }
}
