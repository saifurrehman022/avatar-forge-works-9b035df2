const FANVUE_API_BASE = "https://api.fanvue.com";

export default async function handler(req: any, res: any) {
  const rawPath = req.query?.path;
  const path =
    typeof rawPath === "string"
      ? rawPath
      : Array.isArray(rawPath)
      ? rawPath[0]
      : null;

  if (!path) {
    return res.status(400).json({ error: "Missing path" });
  }

  const targetUrl = `${FANVUE_API_BASE}${path}`;

  try {
    const headers: Record<string, string> = {
      Authorization: req.headers.authorization || "",
      "X-Fanvue-API-Version":
        req.headers["x-fanvue-api-version"] || "2025-06-26",
    };

    let body: any = undefined;

    if (req.method !== "GET" && req.method !== "HEAD") {
      body = req.body;
    }

    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      body:
        typeof body === "string"
          ? body
          : body instanceof Buffer
          ? body
          : JSON.stringify(body),
    });

    const text = await upstream.text();

    res.status(upstream.status);
    res.send(text);
  } catch (e: any) {
    res.status(500).json({
      error: e?.message || "Proxy failed",
    });
  }
}
