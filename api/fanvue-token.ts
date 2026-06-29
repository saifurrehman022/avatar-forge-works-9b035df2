const FANVUE_CLIENT_ID = "f9d35fff-3d12-4dd5-8945-750c37d65ae9";
const FANVUE_CLIENT_SECRET = "05275891c81581c5cb79d336c8e9f87680f0976843bf17d6737bdcf0dde38b1a";
const FANVUE_REDIRECT_URI = "https://www.madamlila.com/schedule";
const FANVUE_TOKEN_URL = "https://auth.fanvue.com/oauth2/token";
const FANVUE_API_BASE = "https://api.fanvue.com";
const FANVUE_API_VERSION = "2025-06-26";

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed",
    });
  }

  try {
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : req.body ?? {};

    const { code, code_verifier } = body;

    if (!code || !code_verifier) {
      return res.status(400).json({
        error: "Missing code or code_verifier",
      });
    }

    const basicAuth = Buffer.from(
      `${FANVUE_CLIENT_ID}:${FANVUE_CLIENT_SECRET}`
    ).toString("base64");

    const tokenRes = await fetch(FANVUE_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: FANVUE_REDIRECT_URI,
        code_verifier,
      }).toString(),
    });

    const tokenText = await tokenRes.text();

    if (!tokenRes.ok) {
      return res.status(tokenRes.status).json({
        error: `Fanvue token exchange failed (${tokenRes.status})`,
        details: tokenText,
      });
    }

    const tokens = JSON.parse(tokenText);

    let profile: any = null;

    try {
      const meRes = await fetch(`${FANVUE_API_BASE}/users/me`, {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          "X-Fanvue-API-Version": FANVUE_API_VERSION,
        },
      });

      if (meRes.ok) {
        profile = await meRes.json();
      }
    } catch {}

    return res.status(200).json({
      ...tokens,
      profile,
    });
  } catch (e: any) {
    return res.status(500).json({
      error: e?.message ?? "Unknown server error",
    });
  }
}
