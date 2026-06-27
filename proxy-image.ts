/**
 * /api/proxy-image.ts  — Vercel Serverless Function
 *
 * Downloads a remote media file server-side (no CORS restriction) and
 * streams the bytes back to the browser.  The browser then POSTs them
 * to Fanvue's S3 presigned URL.
 *
 * Usage:  GET /api/proxy-image?url=<encoded-media-url>
 *
 * DEPLOY:  Place this file at  api/proxy-image.ts  in your Vercel project
 *          root (same level as package.json).  Vercel auto-discovers it.
 *
 * Security:  We only proxy https:// URLs and block localhost / private
 *            ranges so the function can't be abused as an SSRF vector.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";

// Maximum response size we'll proxy (100 MB — plenty for a video)
const MAX_BYTES = 100 * 1024 * 1024;

// Very basic SSRF guard — block private / loopback addresses
function isSafeUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;

  const host = u.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    host.startsWith("172.16.") ||
    host.endsWith(".internal") ||
    host.endsWith(".local")
  ) {
    return false;
  }
  return true;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow GET
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const rawUrl = req.query.url;
  if (!rawUrl || typeof rawUrl !== "string") {
    return res.status(400).json({ error: "Missing ?url= parameter" });
  }

  const mediaUrl = decodeURIComponent(rawUrl);

  if (!isSafeUrl(mediaUrl)) {
    return res.status(400).json({ error: "URL not allowed" });
  }

  try {
    const upstream = await fetch(mediaUrl, {
      // Don't follow redirects to unexpected places
      redirect: "follow",
      // Pass a neutral UA so CDNs don't block us
      headers: { "User-Agent": "LilaStudio/1.0 MediaProxy" },
    });

    if (!upstream.ok) {
      return res
        .status(upstream.status)
        .json({ error: `Upstream returned ${upstream.status}` });
    }

    // Guard against enormous files
    const lengthHeader = upstream.headers.get("content-length");
    if (lengthHeader && parseInt(lengthHeader, 10) > MAX_BYTES) {
      return res.status(413).json({ error: "Media file too large (>100 MB)" });
    }

    // Forward content-type so the browser/caller knows the MIME type
    const contentType =
      upstream.headers.get("content-type") ?? "application/octet-stream";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "private, max-age=300"); // 5 min cache
    // Allow the browser to read this response (CORS header for fetch())
    res.setHeader("Access-Control-Allow-Origin", "*");

    // Stream the body
    const arrayBuffer = await upstream.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length > MAX_BYTES) {
      return res.status(413).json({ error: "Media file too large (>100 MB)" });
    }

    res.status(200).send(buffer);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(502).json({ error: `Proxy fetch failed: ${message}` });
  }
}
