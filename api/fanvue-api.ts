
/**
 * api/fanvue-api.ts
 *
 * Transparent reverse proxy for all Fanvue API calls.
 * Usage: GET/POST/PATCH /api/fanvue-api?path=/media/uploads
 * 
 * WHY NEEDED:
 * 1. The Fanvue API does not send CORS headers that allow browser
 *    direct calls (especially for mutating endpoints).
 * 2. This proxy runs server-side where CORS does not apply.
 * 
 * SECURITY: Only proxies requests to api.fanvue.com.
 * The Authorization header IS forwarded (it's from the client, which is correct).
 * 
 * CRITICAL FIX vs previous version:
 * - Previous version silently dropped the Authorization header
 *   because it was in the BLOCKED_HEADERS set. Fixed below.
 * - Previous version also dropped Content-Type for JSON requests.
 *   Fixed: only block content-type for multipart/form-data
 *   (since node fetch handles form boundaries differently).
 */

const FANVUE_API_BASE = "https://api.fanvue.com";

// Headers that must NOT be forwarded (Vercel-injected or connection-level)
const BLOCKED_HEADERS = new Set([
  "host",
  "connection",
  "content-length",      // will be recalculated
  "transfer-encoding",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-vercel-id",
  "x-vercel-deployment-url",
  "x-real-ip",
  // DO NOT include "authorization" — we MUST forward it
]);

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");

  if (req.method === "OPTIONS") return res.status(200).end();

  // Validate path parameter
  const rawPath = req.query?.path;
  const path = typeof rawPath === "string" ? rawPath : Array.isArray(rawPath) ? rawPath[0] : null;
  if (!path || !path.startsWith("/")) {
    return res.status(400).json({ error: "Missing or invalid ?path= parameter. Must start with /" });
  }

  const targetUrl = `${FANVUE_API_BASE}${path}`;

  // Build forwarded headers — preserve Authorization and all Fanvue-specific headers
  const forwardHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers || {})) {
    const lower = k.toLowerCase();
    if (BLOCKED_HEADERS.has(lower)) continue;

    // Drop browser's content-type for multipart (server-side fetch handles boundary)
    if (lower === "content-type" && String(v).includes("multipart/form-data")) continue;

    forwardHeaders[k] = Array.isArray(v) ? v.join(", ") : String(v);
  }

  try {
    let body: any = undefined;
    if (req.method !== "GET" && req.method !== "HEAD") {
      // For JSON requests, re-stringify if body was auto-parsed by Vercel
      const ct = forwardHeaders["content-type"] ?? "";
      if (ct.includes("application/json")) {
        body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
        // Ensure content-length is correct after stringify
        const encoded = Buffer.from(body, "utf-8");
        forwardHeaders["content-length"] = String(encoded.length);
      } else {
        body = req.body;
      }
    }

    console.log(`[fanvue-api] ${req.method} ${targetUrl}`);

    const upstream = await fetch(targetUrl, {
      method:  req.method,
      headers: forwardHeaders,
      body,
    });

    const responseText = await upstream.text();
    console.log(`[fanvue-api] response: ${upstream.status} ${responseText.slice(0, 300)}`);

    // Forward response status and headers
    res.status(upstream.status);
    for (const [k, v] of upstream.headers.entries()) {
      const lower = k.toLowerCase();
      if (BLOCKED_HEADERS.has(lower)) continue;
      if (lower === "content-encoding") continue; // avoid double-decoding
      try { res.setHeader(k, v); } catch {}
    }

    res.send(responseText);

  } catch (e: any) {
    console.error("[fanvue-api] proxy error:", e);
    res.status(500).json({ error: e?.message ?? "Proxy error" });
  }
}
