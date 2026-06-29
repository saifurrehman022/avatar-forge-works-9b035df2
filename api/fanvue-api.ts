/**
 * api/fanvue-api.ts
 *
 * Transparent reverse proxy for all Fanvue API calls.
 * Usage: GET/POST/PATCH /api/fanvue-api?path=/media/uploads
 *
 * FIXES vs previous version:
 * 1. Reads raw body buffer from Vercel (avoids Vercel auto-parsing JSON
 *    and breaking multipart or already-stringified bodies).
 * 2. Does NOT block Authorization header (was never blocked, confirmed kept).
 * 3. Passes Content-Type through for JSON and text/plain; skips multipart
 *    since we no longer send multipart from the client (Step 1 is JSON now).
 * 4. Properly forwards binary/text response bodies.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";

const FANVUE_API_BASE = "https://api.fanvue.com";

const BLOCKED_REQ_HEADERS = new Set([
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

const BLOCKED_RES_HEADERS = new Set([
  "connection",
  "transfer-encoding",
  "content-encoding", // avoid double-decoding
  "content-length",   // will be recalculated
]);

// Tell Vercel NOT to parse the body — we'll forward it raw.
export const config = { api: { bodyParser: false } };

async function readRawBody(req: VercelRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end",  () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  // Validate path
  const rawPath = req.query?.path;
  const path    = typeof rawPath === "string" ? rawPath : Array.isArray(rawPath) ? rawPath[0] : null;
  if (!path || !path.startsWith("/")) {
    return res.status(400).json({ error: "Missing or invalid ?path= (must start with /)" });
  }

  const targetUrl = `${FANVUE_API_BASE}${path}`;

  // Build forwarded headers
  const forwardHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers ?? {})) {
    if (BLOCKED_REQ_HEADERS.has(k.toLowerCase())) continue;
    forwardHeaders[k] = Array.isArray(v) ? v.join(", ") : String(v ?? "");
  }

  try {
    let body: Buffer | undefined;
    if (req.method !== "GET" && req.method !== "HEAD") {
      body = await readRawBody(req);
      // Set correct Content-Length now that we have the exact bytes
      if (body.length > 0) {
        forwardHeaders["content-length"] = String(body.length);
      }
    }

    console.log(`[fanvue-api] ${req.method} ${targetUrl}`);

    const upstream = await fetch(targetUrl, {
      method:  req.method ?? "GET",
      headers: forwardHeaders,
      body,
    });

    // Forward response headers
    res.status(upstream.status);
    for (const [k, v] of upstream.headers.entries()) {
      if (BLOCKED_RES_HEADERS.has(k.toLowerCase())) continue;
      try { res.setHeader(k, v); } catch {}
    }

    // Forward body
    const responseBuffer = Buffer.from(await upstream.arrayBuffer());
    console.log(`[fanvue-api] → ${upstream.status} (${responseBuffer.length} bytes) ${responseBuffer.slice(0, 200).toString("utf8")}`);
    res.send(responseBuffer);
  } catch (e: any) {
    console.error("[fanvue-api] proxy error:", e);
    res.status(500).json({ error: e?.message ?? "Proxy error" });
  }
}
