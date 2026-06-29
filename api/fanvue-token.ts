
/**
 * api/fanvue-token.ts
 *
 * Server-side OAuth token exchange.
 * Browser cannot POST to auth.fanvue.com directly due to CORS.
 * This Vercel function proxies the exchange server-side.
 *
 * IMPORTANT: The redirect_uri here MUST exactly match:
 *   - What was registered in the Fanvue developer portal
 *   - What is passed in the OAuth authorization URL
 * They must ALL be identical. Currently using: https://www.madamlila.com/schedule
 */

const FANVUE_TOKEN_URL  = "https://auth.fanvue.com/oauth2/token";
const FANVUE_API_BASE   = "https://api.fanvue.com";
const FANVUE_API_VERSION = "2025-06-26";

// These MUST match your Fanvue developer portal registration exactly
const FANVUE_CLIENT_ID     = "f9d35fff-3d12-4dd5-8945-750c37d65ae9";
const FANVUE_CLIENT_SECRET = "05275891c81581c5cb79d336c8e9f87680f0976843bf17d6737bdcf0dde38b1a";
// The redirect URI that was used in the OAuth flow — must match the portal
const FANVUE_REDIRECT_URI  = "https://www.madamlila.com/schedule";

export default async function handler(req: any, res: any) {
  // CORS headers — allow from any origin (Vercel deployment)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body ?? {});
    const { code, code_verifier } = body;

    if (!code)         return res.status(400).json({ error: "Missing: code" });
    if (!code_verifier) return res.status(400).json({ error: "Missing: code_verifier" });

    // Exchange code for tokens — server-side, no CORS issue
    const tokenRes = await fetch(FANVUE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type:    "authorization_code",
        code,
        code_verifier,
        redirect_uri:  FANVUE_REDIRECT_URI,
        client_id:     FANVUE_CLIENT_ID,
        client_secret: FANVUE_CLIENT_SECRET,
      }).toString(),
    });

    const tokenText = await tokenRes.text();
    console.log("[fanvue-token] token exchange:", tokenRes.status, tokenText.slice(0, 200));

    if (!tokenRes.ok) {
      return res.status(tokenRes.status).json({
        error:   `Token exchange failed (${tokenRes.status})`,
        details: tokenText,
      });
    }

    const tokens = JSON.parse(tokenText);
    const accessToken = tokens.access_token;

    // Fetch user profile server-side using correct endpoint: GET /users/me
    // Requires read:self scope
    let profile: any = null;
    try {
      const meRes = await fetch(`${FANVUE_API_BASE}/users/me`, {
        headers: {
          Authorization:           `Bearer ${accessToken}`,
          "X-Fanvue-API-Version":  FANVUE_API_VERSION,
        },
      });
      if (meRes.ok) {
        profile = await meRes.json();
        console.log("[fanvue-token] profile:", JSON.stringify(profile).slice(0, 200));
      } else {
        console.warn("[fanvue-token] /users/me failed:", meRes.status, await meRes.text());
      }
    } catch (e) {
      console.error("[fanvue-token] /users/me error:", e);
    }

    return res.status(200).json({ ...tokens, profile });

  } catch (e: any) {
    console.error("[fanvue-token] error:", e);
    return res.status(500).json({ error: e?.message ?? "Unknown server error" });
  }
}
