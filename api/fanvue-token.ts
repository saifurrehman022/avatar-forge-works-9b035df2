// /api/fanvue-token.ts
//
// THIS FILE MUST LIVE AT EXACTLY THIS PATH IN YOUR REPO:
//   <repo root>/api/fanvue-token.ts
// (the same folder level as package.json — NOT inside src/, NOT inside app/).
// It must be committed to git and pushed to the branch your Vercel project
// deploys, or you will keep getting "404 NOT_FOUND" like before — that error
// means Vercel found no function/route at all for this path, i.e. the file
// simply isn't part of the deployment yet.
//
// The Fanvue Client Secret lives ONLY here, hardcoded, server-side. It is
// never sent from the browser and never appears in the React bundle.
// (Fanvue's own docs require this: https://api.fanvue.com/docs/tutorials/security)

const FANVUE_CLIENT_ID     = "f9d35fff-3d12-4dd5-8945-750c37d65ae9";
const FANVUE_CLIENT_SECRET = "05275891c81581c5cb79d336c8e9f87680f0976843bf17d6737bdcf0dde38b1a";
const FANVUE_REDIRECT_URI  = "https://avatar-forge-works-9b035df2-olive.vercel.app/schedule";
const FANVUE_TOKEN_URL     = "https://auth.fanvue.com/oauth2/token";
const FANVUE_API_BASE      = "https://api.fanvue.com";
const FANVUE_API_VERSION   = "2025-06-26";

// Using `any` for req/res on purpose so this file has ZERO extra npm
// dependencies (no @vercel/node needed) — one less thing that can fail to build.
export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed — this endpoint only accepts POST" });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body ?? {});
    const { code, code_verifier } = body;

    if (!code || !code_verifier) {
      res.status(400).json({ error: "Missing 'code' or 'code_verifier' in request body" });
      return;
    }

    // 1) Exchange the authorization code for tokens — server-to-server, no CORS issue here.
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
    if (!tokenRes.ok) {
      res.status(tokenRes.status).json({ error: `Fanvue token exchange failed (${tokenRes.status}): ${tokenText}` });
      return;
    }

    const tokens = JSON.parse(tokenText);

    // 2) Look up the profile so the client can show a name/handle.
    let profile: any = null;
    try {
      const meRes = await fetch(`${FANVUE_API_BASE}/users/me`, {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          "X-Fanvue-API-Version": FANVUE_API_VERSION,
        },
      });
      if (meRes.ok) profile = await meRes.json();
    } catch {
      // non-fatal — the caller still gets a usable token even if this lookup fails
    }

    res.status(200).json({ ...tokens, profile });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "Unknown server error in /api/fanvue-token" });
  }
}
