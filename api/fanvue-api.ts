// /api/fanvue-api.ts
//
// PLACE AT: <repo root>/api/fanvue-api.ts
// (same level as package.json, alongside fanvue-token.ts and proxy-media.ts)
//
// WHY THIS EXISTS:
// Browsers block direct fetch() calls to api.fanvue.com because Fanvue does
// not send Access-Control-Allow-Origin headers on their API responses.
// Every call from schedule.tsx that hits api.fanvue.com directly will fail
// with "Failed to fetch" (a CORS error). This proxy runs server-side on
// Vercel where CORS rules don't apply, forwards the request to Fanvue, and
// streams the response back to the browser.
//
// USAGE from the browser:
//   fetch("/api/fanvue-api?path=/users/me", {
//     headers: { Authorization: "Bearer <token>", "X-Fanvue-API-Version": "..." }
//   })
//   fetch("/api/fanvue-api?path=/media/uploads", { method: "POST", body: ... })
//   fetch("/api/fanvue-api?path=/media/uploads/ID/parts/1/url")
//   fetch("/api/fanvue-api?path=/media/UUID")
//   fetch("/api/fanvue-api?path=/posts", { method: "POST", body: ... })

const FANVUE_API_BASE = "https://api.fanvue.com";

// Headers Vercel adds that must NOT be forwarded to Fanvue
const HOP_BY_HOP = new Set([
  "host", "connection", "keep-alive", "transfer-encoding",
  "te", "trailer", "upgrade", "proxy-authorization",
  "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto",
  "x-vercel-id", "x-vercel-deployment-url", "x-real-ip",
]);

export default async function handler(req: any, res: any) {
  // Allow any HTTP method (GET, POST, PATCH, DELETE)
  const rawPath = req.query?.path;
  const path = typeof rawPath === "string" ? rawPath : Array.isArray(rawPath) ? rawPath[0] : null;

  if (!path) {
    res.status(400).json({ error: "Missing ?path= query parameter. Example: /api/fanvue-api?path=/users/me" });
    return;
  }

  // Security: only proxy to api.fanvue.com — never allow arbitrary URL forwarding
  if (!path.startsWith("/")) {
    res.status(400).json({ error: "path must start with /" });
    return;
  }

  const targetUrl = `${FANVUE_API_BASE}${path}`;

  // Forward all headers from the browser except hop-by-hop ones
  const forwardHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers as Record<string, string | string[]>)) {
    if (HOP_BY_HOP.has(k.toLowerCase())) continue;
    forwardHeaders[k] = Array.isArray(v) ? v.join(", ") : v;
  }

  try {
    // Read body for POST/PATCH/PUT — Vercel parses JSON automatically,
    // so we re-serialise it so the upstream gets the correct Content-Type.
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
      method:  req.method ?? "GET",
      headers: forwardHeaders,
      body,
    });

    // Forward response headers (minus hop-by-hop)
    for (const [k, v] of upstream.headers.entries()) {
      if (HOP_BY_HOP.has(k.toLowerCase())) continue;
      try { res.setHeader(k, v); } catch {}
    }

    // For the presigned-URL endpoint (/media/uploads/.../parts/.../url)
    // Fanvue returns plain text — forward as-is.
    const ct = upstream.headers.get("content-type") ?? "";
    if (ct.includes("text/plain") || ct === "") {
      const text = await upstream.text();
      res.status(upstream.status).send(text);
    } else {
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.status(upstream.status).send(buf);
    }
  } catch (e: any) {
    console.error("[fanvue-api proxy] error:", e?.message);
    res.status(502).json({
      error: `Proxy fetch to Fanvue failed: ${e?.message ?? "Unknown error"}`,
      target: targetUrl,
    });
  }
}
