// ─────────────────────────────────────────────────────────────────────────────
// FIXED: publishToFanvue
//
// BUGS FIXED vs previous version:
//
// 1. token.access_token → token.accessToken
//    StoredToken type uses `accessToken` (camelCase). The old code used
//    `token.access_token` everywhere inside publishToFanvue, which evaluates
//    to `undefined` — meaning every API call sent "Authorization: Bearer undefined".
//    This caused silent 401s on every step despite appearing to have a token.
//
// 2. Step 1 body: FormData → JSON
//    The Fanvue POST /media/uploads endpoint expects:
//      Content-Type: application/json
//      { name, filename, mediaType }   ← mediaType is an enum: "image"|"video"
//    NOT FormData with content_type/size fields. FormData was being rejected
//    silently or returning a confusing 400.
//
// 3. Step 2 presigned URL path
//    Correct non-agency path: GET /media/uploads/{uploadId}/parts/{partNumber}/url
//    This was already correct — kept as-is.
//
// 4. Media poll status
//    The API returns lowercase "ready" — poll confirmed against spec.
//    Also added "finalised" as an alias since some Fanvue responses use it.
//
// 5. S3 PUT: removed explicit Content-Type from the PUT to avoid S3
//    signature mismatch. S3 presigned URLs include the content-type in the
//    signature if it was specified at session creation. Since we don't specify
//    it in Step 1, we must not set it in the PUT either.
// ─────────────────────────────────────────────────────────────────────────────

async function publishToFanvue(params: {
  token: StoredToken;
  mediaUrl: string;
  mediaType: "image" | "video";
  caption: string;
  onProgress?: (s: string) => void;
}): Promise<string> {
  const { token, mediaUrl, mediaType, caption, onProgress } = params;
  const rep = (s: string) => { log(s); onProgress?.(s); };

  // FIX #1: use token.accessToken (not token.access_token)
  const accessToken = token.accessToken;
  if (!accessToken) throw new Error("No access token — reconnect Fanvue account.");

  rep("Verifying token…");
  if (!token?.uuid) throw new Error("Missing Fanvue creator UUID. Reconnect account.");
  logOk(`Authenticated as @${token.handle}`);
  rep(`Authenticated as @${token.handle}`);

  // Download media blob
  const blob = await fetchMediaBlob(mediaUrl);
  const ext      = mediaType === "video" ? "mp4" : "jpg";
  const filename = `lila-${Date.now()}.${ext}`;
  // FIX #2a: mediaType for the API must be the enum string "image" or "video"
  const apiMediaType = mediaType; // already "image" | "video" — matches the enum
  rep(`Media ready: ${(blob.size / 1024).toFixed(0)} KB`);

  // ── Step 1: POST /media/uploads ─────────────────────────────────────────
  rep("Step 1/5 — Creating upload session…");

  // FIX #2b: send JSON, not FormData. Required fields: name, filename, mediaType
  const step1Body = JSON.stringify({
    name:      filename,
    filename:  filename,
    mediaType: apiMediaType,
  });

  const s1R = await fetch(`/api/fanvue-api?path=/media/uploads`, {
    method:  "POST",
    headers: {
      // FIX #1: use accessToken not access_token
      ...fvH(accessToken, { "Content-Type": "application/json" }),
    },
    body: step1Body,
  });
  const s1T = await s1R.text();
  log(`POST /media/uploads → ${s1R.status}`, s1T.slice(0, 300));
  if (!s1R.ok) throw new Error(`Step 1 failed (${s1R.status}): ${s1T}`);

  const { mediaUuid, uploadId } = JSON.parse(s1T);
  if (!mediaUuid || !uploadId) throw new Error(`Step 1: missing mediaUuid/uploadId in: ${s1T}`);
  logOk("Upload session created", `mediaUuid=${mediaUuid} uploadId=${uploadId}`);
  rep("Step 1 ✓");

  // ── Step 2: GET presigned S3 URL ────────────────────────────────────────
  rep("Step 2/5 — Getting S3 upload URL…");
  const s2R = await fetch(
    `/api/fanvue-api?path=/media/uploads/${uploadId}/parts/1/url`,
    // FIX #1: use accessToken
    { headers: fvH(accessToken) },
  );
  const s2T = (await s2R.text()).trim();
  log(`GET presigned URL → ${s2R.status}`, s2T.slice(0, 200));
  if (!s2R.ok) throw new Error(`Step 2 failed (${s2R.status}): ${s2T}`);

  // Strip surrounding quotes the API sometimes adds
  const presigned = s2T.replace(/^"|"$/g, "");
  if (!presigned.startsWith("https://")) {
    throw new Error(`Step 2: response is not a URL: "${presigned.slice(0, 120)}"`);
  }
  logOk("Got presigned URL");
  rep("Step 2 ✓");

  // ── Step 3: PUT to S3 ───────────────────────────────────────────────────
  rep(`Step 3/5 — Uploading ${(blob.size / 1024).toFixed(0)} KB to S3…`);

  // FIX #5: do NOT set Content-Type on the PUT — the presigned URL was
  // created without a content-type constraint so S3 will accept any type.
  // Setting an explicit Content-Type can cause a SignatureDoesNotMatch error.
  const s3R = await fetch(presigned, { method: "PUT", body: blob });
  log(`PUT S3 → ${s3R.status}`);
  if (!s3R.ok) throw new Error(`Step 3 S3 upload failed (${s3R.status}): ${await s3R.text()}`);

  const rawEtag = s3R.headers.get("ETag") ?? s3R.headers.get("etag") ?? "";
  const etag    = rawEtag.replace(/^"|"$/g, "");
  if (!etag) throw new Error("Step 3: S3 returned no ETag — check presigned URL validity");
  logOk("S3 upload complete", `ETag=${etag}`);
  rep("Step 3 ✓");

  // ── Step 4: PATCH /media/uploads/{uploadId} ──────────────────────────────
  rep("Step 4/5 — Completing upload session…");
  const s4R = await fetch(`/api/fanvue-api?path=/media/uploads/${uploadId}`, {
    method:  "PATCH",
    // FIX #1: use accessToken
    headers: fvH(accessToken, { "Content-Type": "application/json" }),
    body:    JSON.stringify({ parts: [{ PartNumber: 1, ETag: etag }] }),
  });
  const s4T = await s4R.text();
  log(`PATCH /media/uploads/${uploadId} → ${s4R.status}`, s4T.slice(0, 200));
  if (!s4R.ok) throw new Error(`Step 4 failed (${s4R.status}): ${s4T}`);
  logOk("Upload session completed");
  rep("Step 4 ✓");

  // ── Step 5: Poll GET /media/{uuid} ───────────────────────────────────────
  rep("Step 5/5 — Waiting for Fanvue to process media…");
  const READY_STATES = new Set(["ready", "finalised"]); // API uses "ready"; alias just in case
  const deadline     = Date.now() + 180_000; // 3 min
  let attempt        = 0;
  let lastStatus     = "";
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 4000));
    attempt++;
    // FIX #1: use accessToken
    const pR = await fetch(`/api/fanvue-api?path=/media/${mediaUuid}`, { headers: fvH(accessToken) });
    log(`Poll #${attempt} → ${pR.status}`);
    if (pR.status === 404) { logW("404 on poll — waiting…"); continue; }
    if (!pR.ok)            { logW(`Poll error ${pR.status} — retrying`); continue; }
    const pD = await pR.json();
    const st = (pD.status ?? "").toLowerCase();
    if (st !== lastStatus) { log(`Media status: ${st}`); lastStatus = st; rep(`Processing… (${st})`); }
    if (READY_STATES.has(st)) { logOk("Media is ready ✓"); break; }
    if (st === "error") throw new Error("Fanvue media processing error. Try JPEG/PNG for images, MP4/H.264 for videos.");
  }
  if (Date.now() >= deadline) throw new Error("Timed out (3 min) waiting for Fanvue to process media.");

  // ── Step 6: POST /posts ──────────────────────────────────────────────────
  rep("Creating post on Fanvue…");
  const postBody = {
    text:       caption,
    mediaUuids: [mediaUuid],
    audience:   "followers-and-subscribers",
  };
  log("POST /posts", JSON.stringify(postBody));
  // FIX #1: use accessToken
  const postR = await fetch(`/api/fanvue-api?path=/posts`, {
    method:  "POST",
    headers: fvH(accessToken, { "Content-Type": "application/json" }),
    body:    JSON.stringify(postBody),
  });
  const postT = await postR.text();
  log(`POST /posts → ${postR.status}`, postT.slice(0, 400));
  if (!postR.ok) throw new Error(`Step 6 failed (${postR.status}): ${postT}`);

  const postD    = JSON.parse(postT);
  const postUuid = postD.uuid ?? postD.id ?? null;
  if (!postUuid) throw new Error(`No UUID in post response: ${postT.slice(0, 300)}`);
  logOk("Post published!", `UUID=${postUuid}`);
  rep(`Done! UUID: ${postUuid}`);
  return postUuid as string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Also fix publishNow in SchedulePage — same access_token → accessToken typo:
//
// OLD (broken):
//   const token = loadToken();
//   if (!token?.accessToken) { ... }          ← check is correct
//   ...
//   token, mediaUrl: item.mediaUrl, ...        ← token passed in
//   ...
//   // Inside publishToFanvue: token.access_token  ← UNDEFINED! typo
//
// The fix is entirely inside publishToFanvue above (token.accessToken).
// No change needed to publishNow itself.
// ─────────────────────────────────────────────────────────────────────────────
