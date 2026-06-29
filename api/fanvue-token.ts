/**
 * api/fanvue-token.ts
 *
 * Server-side OAuth token exchange.
 *
 * FIX: Fanvue OAuth client is configured as `client_secret_basic`.
 * That means credentials must go in the Authorization header as:
 *   Basic base64(client_id:client_secret)
 * NOT in the POST body (that would be client_secret_post, which Fanvue rejects with 401).
 */
const FANVUE_TOKEN_URL   = "https://auth.fanvue.com/oauth2/token";
const FANVUE_API_BASE    = "https://api.fanvue.com";
const FANVUE_API_VERSION = "2025-06-26";

const FANVUE_CLIENT_ID     = "f9d35fff-3d12-4dd5-8945-750c37d65ae9";
const FANVUE_CLIENT_SECRET = "05275891c81581c5cb79d336c8e9f87680f0976843bf17d6737bdcf0dde38b1a";
const FANVUE_REDIRECT_URI  = "https://www.madamlila.com/schedule";

// Basic auth header: base64(client_id:client_secret)
function basicAuth(): string {
  const creds = `${FANVUE_CLIENT_ID}:${FANVUE_CLIENT_SECRET}`;
  return "Basic " + Buffer.from(creds).toString("base64");
}

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body ?? {});
    const { code, code_verifier } = body;
    if (!code)          return res.status(400).json({ error: "Missing: code" });
    if (!code_verifier) return res.status(400).json({ error: "Missing: code_verifier" });

    // KEY FIX: send credentials via Authorization: Basic header (client_secret_basic)
    // Do NOT include client_id / client_secret in the body — that's client_secret_post
    // and Fanvue will reject it with "Client authentication failed".
    const tokenRes = await fetch(FANVUE_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type":  "application/x-www-form-urlencoded",
        "Authorization": basicAuth(),
      },
      body: new URLSearchParams({
        grant_type:    "authorization_code",
        code,
        code_verifier,
        redirect_uri:  FANVUE_REDIRECT_URI,
        // client_id and client_secret go in the Authorization header, NOT here
      }).toString(),
    });

    const tokenText = await tokenRes.text();
    console.log("[fanvue-token] exchange:", tokenRes.status, tokenText.slice(0, 300));

    if (!tokenRes.ok) {
      return res.status(tokenRes.status).json({
        error:   `Token exchange failed (${tokenRes.status})`,
        details: tokenText,
      });
    }

    const tokens = JSON.parse(tokenText);
    const accessToken = tokens.access_token;

    // Fetch user profile
    let profile: any = null;
    try {
      const meRes = await fetch(`${FANVUE_API_BASE}/users/me`, {
        headers: {
          Authorization:          `Bearer ${accessToken}`,
          "X-Fanvue-API-Version": FANVUE_API_VERSION,
        },
      });
      if (meRes.ok) {
        profile = await meRes.json();
        console.log("[fanvue-token] profile:", JSON.stringify(profile).slice(0, 300));
      } else {
        const meText = await meRes.text();
        console.warn("[fanvue-token] /users/me failed:", meRes.status, meText.slice(0, 200));
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
