
/**
 * schedule.tsx — Lila Studio Scheduling Page
 *
 * ════════════════════════════════════════════════════════════════════════
 * ROOT CAUSE OF ALL PREVIOUS FAILURES (discovered from official API docs):
 * ════════════════════════════════════════════════════════════════════════
 *
 * 1. GET /media/uploads/{uploadId}/parts/{partNumber}/url
 *    ↳ This is an AGENCY-ONLY endpoint.
 *    ↳ Requires write:creator scope (which you don't have — you have write:media).
 *    ↳ Operates on behalf of a creator your agency manages.
 *    ↳ YOU ARE THE CREATOR, not an agency. This endpoint is wrong for your use case.
 *
 * 2. The CORRECT self-creator upload flow per official docs:
 *    Step A: POST /media/uploads  (JSON body)              → {mediaUuid, uploadId}
 *    Step B: GET  /creators/{YOUR_uuid}/media/uploads/{uploadId}/parts/1/url
 *            ↳ Yes — even for self, you use the /creators/{uuid} path.
 *            ↳ Your uuid comes from GET /users/me → profile.uuid
 *            ↳ Requires write:creator + write:media scopes
 *    Step C: PUT  {presignedUrl}                           → ETag from S3
 *    Step D: PATCH /creators/{YOUR_uuid}/media/uploads/{uploadId}  → {status}
 *    Step E: Poll GET /media/{uuid}  until status === "ready"
 *    Step F: POST /posts  { audience, mediaUuids, text }   → 201 {uuid}
 *
 * 3. THE FIX: Add write:creator to the OAuth scope request + use /creators/{uuid} paths
 *
 * 4. All Fanvue API calls go through /api/fanvue-api proxy (fixes CORS)
 *    The proxy was DROPPING the Authorization header — now fixed in api/fanvue-api.ts
 *
 * 5. /users/me returns { uuid, handle, displayName, ... } — uuid is REQUIRED for upload
 *
 * 6. media status enum: "created" | "processing" | "ready" | "error" (all lowercase)
 *
 * 7. POST /posts returns 201 (not 200). audience field is REQUIRED.
 */

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { scheduleService } from "@/services";
import {
  CalendarClock, CalendarPlus, CheckCircle2, Clock, Search,
  Image as ImageIcon, Video as VideoIcon, Play, ArrowLeft, Send,
  Filter, Inbox, ChevronLeft, ChevronRight, MoreHorizontal,
  Trash2, Eye, RefreshCw, AlertTriangle,
  Loader2, Plug, CheckCircle, XCircle, ExternalLink, Bug,
  ChevronDown, ChevronUp, Link as LinkIcon,
} from "lucide-react";
import { toast } from "sonner";

import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { AppHeader } from "@/components/dashboard/app-header";
import { DashboardCard } from "@/components/dashboard/dashboard-card";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Fanvue config
// ─────────────────────────────────────────────────────────────────────────────
const FANVUE_CLIENT_ID    = "f9d35fff-3d12-4dd5-8945-750c37d65ae9";
const FANVUE_CLIENT_SECRET = "05275891c81581c5cb79d336c8e9f87680f0976843bf17d6737bdcf0dde38b1a";
// MUST match what's in your Fanvue developer portal AND api/fanvue-token.ts
const FANVUE_REDIRECT_URI = "https://www.madamlila.com/schedule";
const FANVUE_AUTH_URL     = "https://auth.fanvue.com/oauth2/auth";
const FANVUE_API_VERSION  = "2025-06-26";

// ─────────────────────────────────────────────────────────────────────────────
// Debug logger
// ─────────────────────────────────────────────────────────────────────────────
type LogLevel = "info" | "warn" | "error" | "success";
type LogEntry = { at: number; level: LogLevel; msg: string; detail?: string };
let _listeners: Array<(e: LogEntry) => void> = [];
const emit = (level: LogLevel, msg: string, detail?: string) => {
  const e: LogEntry = { at: Date.now(), level, msg, detail };
  console[level === "success" ? "info" : level]("[FV]", msg, detail ?? "");
  _listeners.forEach(fn => fn(e));
};
const log   = (m: string, d?: string) => emit("info",    m, d);
const logOk = (m: string, d?: string) => emit("success", m, d);
const logW  = (m: string, d?: string) => emit("warn",    m, d);
const logE  = (m: string, d?: string) => emit("error",   m, d);

function useDebugLog() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  useEffect(() => {
    const fn = (e: LogEntry) => setLogs(p => [e, ...p].slice(0, 300));
    _listeners.push(fn);
    return () => { _listeners = _listeners.filter(f => f !== fn); };
  }, []);
  return { logs, clearLogs: () => setLogs([]) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Token store — localStorage
// ─────────────────────────────────────────────────────────────────────────────
const TOKEN_KEY = "fanvue_token_v4"; // bumped version to clear stale tokens
type StoredToken = {
  accessToken:   string;
  refreshToken?: string;
  expiresAt?:    number;
  name:          string;
  handle:        string;
  uuid:          string; // creator's Fanvue UUID — required for upload endpoints
};
const saveToken  = (t: StoredToken) => { try { localStorage.setItem(TOKEN_KEY, JSON.stringify(t)); } catch {} };
const loadToken  = (): StoredToken | null => { try { const r = localStorage.getItem(TOKEN_KEY); return r ? JSON.parse(r) : null; } catch { return null; } };
const clearToken = () => { try { localStorage.removeItem(TOKEN_KEY); } catch {} };

// ─────────────────────────────────────────────────────────────────────────────
// PKCE helpers
// ─────────────────────────────────────────────────────────────────────────────
function b64url(buf: ArrayBuffer) {
  let s = ""; for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
async function generatePKCE() {
  const arr = new Uint8Array(32); crypto.getRandomValues(arr);
  const verifier  = b64url(arr.buffer);
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  return { verifier, challenge };
}
const PKCE_KEY  = "fv_pkce_v";
const STATE_KEY = "fv_state";

async function startFanvueOAuth() {
  const { verifier, challenge } = await generatePKCE();
  const state = crypto.randomUUID();
  sessionStorage.setItem(PKCE_KEY,  verifier);
  sessionStorage.setItem(STATE_KEY, state);

  const params = new URLSearchParams({
    client_id:             FANVUE_CLIENT_ID,
    redirect_uri:          FANVUE_REDIRECT_URI,
    response_type:         "code",
    // FIX: Added write:creator — required for GET/PATCH /creators/{uuid}/media/uploads/...
    scope:                 "openid offline_access read:self read:media write:media write:post write:creator",
    state,
    code_challenge:        challenge,
    code_challenge_method: "S256",
  });
  window.location.href = `${FANVUE_AUTH_URL}?${params}`;
}

// Token exchange goes through our Vercel function (avoids CORS on auth.fanvue.com)
async function exchangeFanvueCode(code: string): Promise<StoredToken> {
  const verifier = sessionStorage.getItem(PKCE_KEY);
  if (!verifier) throw new Error("PKCE verifier missing — click Connect again");
  sessionStorage.removeItem(PKCE_KEY);
  sessionStorage.removeItem(STATE_KEY);

  log("Exchanging code via /api/fanvue-token…");
  const res = await fetch("/api/fanvue-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, code_verifier: verifier }),
  });

  const text = await res.text();
  log(`/api/fanvue-token → ${res.status}`, text.slice(0, 400));
  if (!res.ok) throw new Error(`Token exchange failed (${res.status}): ${text}`);

  const data = JSON.parse(text);
  const { access_token, refresh_token, expires_in, profile } = data;
  if (!access_token) throw new Error("No access_token in response: " + text);

  // profile comes from /users/me called server-side in fanvue-token.ts
  const uuid   = profile?.uuid   ?? "";
  const handle = profile?.handle ?? profile?.username ?? "fanvue";
  const name   = profile?.displayName ?? profile?.name ?? handle;

  if (!uuid) {
    logW("No UUID in profile — upload will fail. Profile data:", JSON.stringify(profile));
  }

  const stored: StoredToken = {
    accessToken:  access_token,
    refreshToken: refresh_token,
    expiresAt:    expires_in ? Date.now() + expires_in * 1000 : undefined,
    name, handle, uuid,
  };

  saveToken(stored);
  logOk(`Connected as @${handle}`, `uuid=${uuid}`);
  return stored;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fanvue API proxy helper
// All API calls go through /api/fanvue-api to avoid CORS
// ─────────────────────────────────────────────────────────────────────────────
async function fvApi(
  token: string,
  path: string,
  options: { method?: string; body?: string; contentType?: string } = {}
): Promise<{ status: number; text: string; ok: boolean }> {
  const { method = "GET", body, contentType = "application/json" } = options;

  const headers: Record<string, string> = {
    Authorization:          `Bearer ${token}`,
    "X-Fanvue-API-Version": FANVUE_API_VERSION,
  };
  if (body) headers["Content-Type"] = contentType;

  log(`${method} ${path}`, body ? body.slice(0, 200) : undefined);

  const res = await fetch(`/api/fanvue-api?path=${encodeURIComponent(path)}`, {
    method, headers, body,
  });
  const text = await res.text();
  const label = `${method} ${path} → ${res.status}`;
  (res.ok ? log : logW)(label, text.slice(0, 400));
  return { status: res.status, text, ok: res.ok };
}

// ─────────────────────────────────────────────────────────────────────────────
// Media download (with proxy fallback for CORS-blocked URLs)
// ─────────────────────────────────────────────────────────────────────────────
async function fetchMediaBlob(mediaUrl: string): Promise<Blob> {
  log("Downloading media…", mediaUrl.slice(0, 100));
  try {
    const r = await fetch(mediaUrl);
    if (r.ok) {
      const b = await r.blob();
      if (b.size > 0) { logOk(`Direct download: ${(b.size / 1024).toFixed(0)} KB, type=${b.type}`); return b; }
    }
    logW(`Direct fetch ${r.status} or empty — trying proxy`);
  } catch (e: any) { logW("Direct fetch blocked (CORS)", e?.message); }

  const r2 = await fetch(`/api/proxy-media?url=${encodeURIComponent(mediaUrl)}`);
  const errText = await r2.text().catch(() => "");
  if (!r2.ok) throw new Error(`Proxy download failed (${r2.status}). Ensure api/proxy-media.ts is deployed. Error: ${errText.slice(0, 100)}`);
  // re-fetch as blob after text check
  const r3 = await fetch(`/api/proxy-media?url=${encodeURIComponent(mediaUrl)}`);
  const b2  = await r3.blob();
  if (b2.size === 0) throw new Error("Proxy returned empty blob");
  logOk(`Proxy download: ${(b2.size / 1024).toFixed(0)} KB`);
  return b2;
}

// ─────────────────────────────────────────────────────────────────────────────
// Publish pipeline — corrected to match official Fanvue API docs exactly
//
// SELF-CREATOR flow (you are the creator, not managing another):
//
// Step 1: POST /media/uploads
//         Body (JSON): { name, filename, mediaType }
//         Scope: write:media
//         Returns: { mediaUuid, uploadId }
//
// Step 2: GET /creators/{creatorUuid}/media/uploads/{uploadId}/parts/1/url
//         Scope: write:creator + write:media
//         Returns: text/plain presigned S3 URL
//         NOTE: Even for self-creators, this uses the /creators/{uuid} path
//
// Step 3: PUT {presignedUrl}  — binary upload to S3
//         Returns ETag in response headers
//
// Step 4: PATCH /creators/{creatorUuid}/media/uploads/{uploadId}
//         Body (JSON): { parts: [{ PartNumber: 1, ETag: "..." }] }
//         Scope: write:creator + write:media
//         Returns: { status: "processing" }
//
// Step 5: Poll GET /media/{mediaUuid}  (scope: read:media)
//         Until status === "ready"  (enum: created|processing|ready|error)
//
// Step 6: POST /posts
//         Body (JSON): { text, mediaUuids: [mediaUuid], audience }
//         Scope: write:post
//         Returns 201: { uuid, createdAt, text, audience, publishAt, publishedAt, ... }
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

  // Validate we have what we need
  if (!token.accessToken) throw new Error("No access token. Disconnect and reconnect Fanvue.");
  if (!token.uuid) throw new Error("No creator UUID — reconnect your Fanvue account to refresh the token.");

  rep(`Publishing as @${token.handle} (uuid: ${token.uuid})`);

  // ── Download media binary ────────────────────────────────────────────────
  rep("Downloading media file…");
  const blob     = await fetchMediaBlob(mediaUrl);
  const ext      = mediaType === "video" ? "mp4" : "jpeg";
  const mimeType = mediaType === "video" ? "video/mp4" : "image/jpeg";
  const filename = `lila-${Date.now()}.${ext}`;
  rep(`Downloaded ${(blob.size / 1024).toFixed(0)} KB`);

  // ── Step 1: POST /media/uploads ──────────────────────────────────────────
  // Self-creator endpoint. Scope: write:media. Body: JSON.
  rep("Step 1/5 — Creating upload session…");
  const s1 = await fvApi(token.accessToken, "/media/uploads", {
    method: "POST",
    body:   JSON.stringify({ name: filename, filename, mediaType }),
  });
  if (!s1.ok) throw new Error(`Step 1 — Create upload session failed (${s1.status}): ${s1.text}`);

  let sess: any;
  try { sess = JSON.parse(s1.text); } catch { throw new Error(`Step 1 — Non-JSON response: ${s1.text.slice(0, 200)}`); }

  const { mediaUuid, uploadId } = sess;
  if (!mediaUuid) throw new Error(`Step 1 — No mediaUuid in response: ${s1.text}`);
  if (!uploadId)  throw new Error(`Step 1 — No uploadId in response: ${s1.text}`);
  logOk(`Step 1 ✓ — mediaUuid=${mediaUuid}  uploadId=${uploadId}`);
  rep("Step 1 ✓");

  // ── Step 2: GET presigned S3 URL ─────────────────────────────────────────
  // Uses /creators/{creatorUuid}/... path — REQUIRED even for self-creators
  // Scope: write:creator + write:media
  rep("Step 2/5 — Getting S3 upload URL…");
  const partPath = `/creators/${token.uuid}/media/uploads/${uploadId}/parts/1/url`;
  const s2 = await fvApi(token.accessToken, partPath);
  if (!s2.ok) throw new Error(`Step 2 — Get presigned URL failed (${s2.status}): ${s2.text}\n\nThis likely means write:creator scope is missing. Disconnect and reconnect Fanvue to get the new scopes.`);

  const presigned = s2.text.trim().replace(/^"|"$/g, "");
  if (!presigned.startsWith("https://")) throw new Error(`Step 2 — Response is not a URL: "${presigned.slice(0, 120)}"`);
  logOk("Step 2 ✓ — Got presigned URL");
  rep("Step 2 ✓");

  // ── Step 3: PUT binary to S3 ─────────────────────────────────────────────
  // Direct S3 upload — no Authorization header (presigned URL is self-authenticating)
  rep(`Step 3/5 — Uploading ${(blob.size / 1024).toFixed(0)} KB to S3…`);
  log("PUT to S3 presigned URL…", presigned.slice(0, 80) + "…");
  const s3Res = await fetch(presigned, {
    method:  "PUT",
    body:    blob,
    headers: { "Content-Type": mimeType },
  });
  log(`S3 PUT → ${s3Res.status}`);
  if (!s3Res.ok) throw new Error(`Step 3 — S3 upload failed (${s3Res.status}): ${await s3Res.text()}`);

  const rawEtag = (s3Res.headers.get("ETag") ?? s3Res.headers.get("etag") ?? "").replace(/"/g, "");
  if (!rawEtag) throw new Error("Step 3 — S3 returned no ETag. Upload may have silently failed.");
  logOk(`Step 3 ✓ — ETag: ${rawEtag}`);
  rep("Step 3 ✓");

  // ── Step 4: PATCH /creators/{uuid}/media/uploads/{uploadId} ──────────────
  // Complete the multipart session. Scope: write:creator + write:media.
  rep("Step 4/5 — Completing upload session…");
  const completePath = `/creators/${token.uuid}/media/uploads/${uploadId}`;
  const s4 = await fvApi(token.accessToken, completePath, {
    method: "PATCH",
    body:   JSON.stringify({ parts: [{ PartNumber: 1, ETag: rawEtag }] }),
  });
  if (!s4.ok) throw new Error(`Step 4 — Complete upload failed (${s4.status}): ${s4.text}`);

  let compData: any;
  try { compData = JSON.parse(s4.text); } catch {}
  logOk(`Step 4 ✓ — status: ${compData?.status}`);
  rep("Step 4 ✓");

  // ── Step 5: Poll GET /media/{uuid} until status === "ready" ──────────────
  // Scope: read:media
  // Status enum per docs: "created" | "processing" | "ready" | "error"
  // For non-ready media only { uuid, status } is returned
  rep("Step 5/5 — Waiting for Fanvue to process media…");
  const DEADLINE = Date.now() + 180_000; // 3 min
  let lastStatus = "";
  let attempt    = 0;
  while (Date.now() < DEADLINE) {
    await new Promise(r => setTimeout(r, 4_000));
    attempt++;
    const poll = await fvApi(token.accessToken, `/media/${mediaUuid}`);
    if (poll.status === 404) { logW(`Poll #${attempt} — 404 (media not indexed yet)`); continue; }
    if (!poll.ok) { logW(`Poll #${attempt} — ${poll.status} (retrying)`); continue; }

    let pollData: any;
    try { pollData = JSON.parse(poll.text); } catch { continue; }

    const status = (pollData.status ?? "").toLowerCase();
    if (status !== lastStatus) { log(`Media status: "${status}"`); lastStatus = status; }
    rep(`Processing… (${status})`);

    if (status === "ready") { logOk("Media is ready ✓"); break; }
    if (status === "error") throw new Error("Fanvue media processing failed. Images must be JPEG/PNG, videos must be MP4 (H.264).");
  }
  if (Date.now() >= DEADLINE) throw new Error("Timed out (3 min) waiting for Fanvue media. File may be too large or wrong format.");

  // ── Step 6: POST /posts ───────────────────────────────────────────────────
  // audience is the only REQUIRED field. Returns 201 with { uuid }.
  rep("Creating post on Fanvue…");
  const postBody = {
    text:       caption,
    mediaUuids: [mediaUuid],
    audience:   "followers-and-subscribers" as const,
  };
  log("POST /posts", JSON.stringify(postBody));
  const s6 = await fvApi(token.accessToken, "/posts", {
    method: "POST",
    body:   JSON.stringify(postBody),
  });

  // POST /posts returns 201 on success
  if (s6.status !== 201 && !s6.ok) throw new Error(`Step 6 — Create post failed (${s6.status}): ${s6.text}`);

  let postData: any;
  try { postData = JSON.parse(s6.text); } catch { throw new Error(`Step 6 — Non-JSON response: ${s6.text.slice(0, 200)}`); }

  const postUuid = postData.uuid as string | undefined;
  if (!postUuid) throw new Error(`Step 6 — No UUID in post response: ${s6.text.slice(0, 300)}`);

  logOk(`Published! Post UUID: ${postUuid}`);
  rep(`✅ Done! Post UUID: ${postUuid}`);
  return postUuid;
}

// ─────────────────────────────────────────────────────────────────────────────
// Route
// ─────────────────────────────────────────────────────────────────────────────
function RouteErrorBoundary({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-6 text-center">
      <h2 className="font-display text-lg font-semibold">Scheduling couldn't load</h2>
      <p className="max-w-md text-sm text-muted-foreground">{error?.message}</p>
      <div className="flex gap-2">
        <button onClick={() => reset()} className="rounded-md border border-input bg-background px-4 py-2 text-sm">Try again</button>
        <a href="/" className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">Go home</a>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/schedule")({
  head: () => ({ meta: [{ title: "Scheduling — Lila Studio" }] }),
  component: SchedulePage,
  errorComponent: RouteErrorBoundary,
});

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
type PublishStatus = "scheduled" | "publishing" | "published" | "failed";
type QueueStatus   = "waiting" | "ready" | "publishing" | "published" | "failed";
type ContentType   = "image" | "video";
type HistoryEvent  = { at: string; label: string; kind: "scheduled"|"publishing"|"published"|"failed"|"retried" };
type ScheduledItem = {
  id: string; contentName: string; type: ContentType; character: string;
  thumbnail: string; mediaUrl: string; scheduledAt: string;
  status: PublishStatus; queueStatus: QueueStatus; autoPublish: boolean;
  externalPostId?: string; publishedAt?: string;
  settings: { fps: number; framesPerScene: number; numScenes: number; samplingSteps: number };
  scenePrompts: string[]; negativePrompt: string; history: HistoryEvent[];
};

const EMPTY: ScheduledItem[] = [];
const PLACEHOLDER = "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=600&q=80";

// ─────────────────────────────────────────────────────────────────────────────
// Data fetchers
// ─────────────────────────────────────────────────────────────────────────────
async function fetchSchedules(): Promise<ScheduledItem[]> {
  const { data: rows, error } = await supabase.from("schedules").select("*").order("publish_time");
  if (error) throw error;
  const imgIds = (rows ?? []).filter((r: any) => r.content_type === "image").map((r: any) => r.content_id);
  const vidIds = (rows ?? []).filter((r: any) => r.content_type === "video").map((r: any) => r.content_id);
  const [imgR, vidR, charR] = await Promise.all([
    imgIds.length ? supabase.from("images").select("id,image_url,prompt,character_id,published_at,external_post_id,publish_status").in("id", imgIds) : Promise.resolve({ data: [] } as any),
    vidIds.length ? supabase.from("videos").select("id,video_url,prompt,scene_prompts,character_id,published_at,external_post_id,publish_status").in("id", vidIds) : Promise.resolve({ data: [] } as any),
    supabase.from("characters").select("id,name,reference_image_url"),
  ]);
  const imgMap  = new Map((imgR.data  ?? []).map((i: any) => [i.id, i]));
  const vidMap  = new Map((vidR.data  ?? []).map((v: any) => [v.id, v]));
  const charMap = new Map((charR.data ?? []).map((c: any) => [c.id, c]));
  return (rows ?? []).map((r: any): ScheduledItem => {
    const isVideo = r.content_type === "video";
    const src: any = isVideo ? vidMap.get(r.content_id) : imgMap.get(r.content_id);
    const char: any = src?.character_id ? charMap.get(src.character_id) : null;
    const scenes: string[] = isVideo && Array.isArray(src?.scene_prompts) ? src.scene_prompts : src?.prompt ? [src.prompt] : [];
    const media = isVideo ? src?.video_url : src?.image_url;
    const status: PublishStatus = r.status === "published" ? "published" : r.status === "failed" ? "failed" : r.status === "publishing" ? "publishing" : "scheduled";
    const queueStatus: QueueStatus = status === "published" ? "published" : status === "failed" ? "failed" : status === "publishing" ? "publishing" : new Date(r.publish_time) <= new Date() ? "ready" : "waiting";
    return {
      id: r.id, contentName: `${char?.name ?? "Lila"} — ${(scenes[0] ?? "Untitled").slice(0, 40)}`,
      type: r.content_type, character: char?.name ?? "Lila",
      thumbnail: char?.reference_image_url || media || PLACEHOLDER, mediaUrl: media || "",
      scheduledAt: r.publish_time, status, queueStatus, autoPublish: true,
      externalPostId: src?.external_post_id ?? undefined, publishedAt: src?.published_at ?? undefined,
      settings: { fps: 16, framesPerScene: 257, numScenes: scenes.length || 1, samplingSteps: 29 },
      scenePrompts: scenes, negativePrompt: "low quality, blurry, distorted face, watermark",
      history: [
        { at: r.created_at, label: `Scheduled for ${new Date(r.publish_time).toLocaleString()}`, kind: "scheduled" },
        ...(src?.published_at ? [{ at: src.published_at, label: "Published", kind: "published" as const }] : []),
      ],
    };
  });
}

async function fetchApprovedAssets() {
  const [imgR, vidR, charR] = await Promise.all([
    supabase.from("images").select("id,image_url,prompt,character_id").eq("status", "approved"),
    supabase.from("videos").select("id,video_url,prompt,character_id").eq("status", "approved"),
    supabase.from("characters").select("id,name,reference_image_url"),
  ]);
  const charMap = new Map((charR.data ?? []).map((c: any) => [c.id, c]));
  return [
    ...(imgR.data ?? []).map((i: any) => ({ id: i.id, type: "image" as const, name: `${charMap.get(i.character_id)?.name ?? "Lila"} — ${(i.prompt ?? "Image").slice(0, 40)}`, thumbnail: i.image_url ?? "" })),
    ...(vidR.data ?? []).map((v: any) => ({ id: v.id, type: "video" as const, name: `${charMap.get(v.character_id)?.name ?? "Lila"} — ${(v.prompt ?? "Video").slice(0, 40)}`, thumbnail: charMap.get(v.character_id)?.reference_image_url ?? "" })),
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Style helpers
// ─────────────────────────────────────────────────────────────────────────────
const statusStyle: Record<PublishStatus, string> = {
  scheduled: "bg-chart-2/15 text-chart-2 border-chart-2/30",
  publishing: "bg-primary/15 text-primary border-primary/30",
  published: "bg-success/15 text-success border-success/30",
  failed: "bg-destructive/15 text-destructive border-destructive/30",
};
const queueStyle: Record<QueueStatus, string> = {
  waiting: "bg-muted text-muted-foreground border-border",
  ready: "bg-chart-2/15 text-chart-2 border-chart-2/30",
  publishing: "bg-primary/15 text-primary border-primary/30",
  published: "bg-success/15 text-success border-success/30",
  failed: "bg-destructive/15 text-destructive border-destructive/30",
};
const logStyle: Record<LogLevel, string> = {
  info: "text-muted-foreground", warn: "text-yellow-400",
  error: "text-red-400 font-semibold", success: "text-green-400",
};
const fmtT  = (s: string) => new Date(s).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const fmtD  = (s: string) => new Date(s).toLocaleDateString([], { month: "short", day: "numeric" });
const fmtDT = (s: string) => `${fmtD(s)} · ${fmtT(s)}`;
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

function StatusBadge({ status }: { status: PublishStatus }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider", statusStyle[status])}>
    {status === "publishing" && <Loader2 className="h-2.5 w-2.5 animate-spin" />}{status}
  </span>;
}
function QueueBadge({ status }: { status: QueueStatus }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider", queueStyle[status])}>{status}</span>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Debug panel
// ─────────────────────────────────────────────────────────────────────────────
function DebugPanel({ logs, onClear }: { logs: LogEntry[]; onClear: () => void }) {
  const [open, setOpen] = useState(false);
  const errCount = logs.filter(l => l.level === "error").length;
  useEffect(() => { if (errCount > 0) setOpen(true); }, [errCount]);
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 pointer-events-none">
      <div className="pointer-events-auto mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8">
        <div className={cn("rounded-t-xl border border-border/80 bg-card shadow-2xl transition-all", open ? "max-h-80" : "max-h-10")}>
          <button type="button" onClick={() => setOpen(o => !o)} className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-muted/40 rounded-t-xl">
            <Bug className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            <span className="text-xs font-medium text-muted-foreground">Fanvue Publish Log</span>
            {errCount > 0 && <span className="rounded bg-destructive/15 border border-destructive/30 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">{errCount} error{errCount !== 1 ? "s" : ""}</span>}
            {logs.length > 0 && errCount === 0 && <span className="text-[10px] text-muted-foreground">{logs.length} entries</span>}
            <div className="ml-auto flex items-center gap-2">
              {open && <button type="button" onClick={e => { e.stopPropagation(); onClear(); }} className="text-[10px] text-muted-foreground hover:text-foreground px-1">Clear</button>}
              {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />}
            </div>
          </button>
          {open && (
            <div className="h-64 overflow-y-auto border-t border-border/60 bg-black/90 font-mono">
              {logs.length === 0
                ? <p className="p-4 text-xs text-muted-foreground">No entries. Click Publish now to see output.</p>
                : logs.map((l, i) => (
                  <div key={i} className="flex items-start gap-2 border-b border-white/5 px-3 py-1">
                    <span className="shrink-0 text-[10px] text-white/30 tabular-nums pt-px">{new Date(l.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                    <span className={cn("shrink-0 text-[10px] w-16", logStyle[l.level])}>[{l.level.toUpperCase()}]</span>
                    <div className="min-w-0 flex-1">
                      <span className={cn("text-[11px]", logStyle[l.level])}>{l.msg}</span>
                      {l.detail && <p className="mt-0.5 break-all text-[10px] text-white/40">{l.detail}</p>}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Quick post by URL dialog
// ─────────────────────────────────────────────────────────────────────────────
function detectType(url: string): "image" | "video" | null {
  if (/\.(jpe?g|png|webp|gif)(\?.*)?$/i.test(url)) return "image";
  if (/\.(mp4|mov|webm|m4v)(\?.*)?$/i.test(url))   return "video";
  return null;
}

function QuickPostDialog({ open, onOpenChange, token }: {
  open: boolean; onOpenChange: (o: boolean) => void; token: StoredToken | null;
}) {
  const [url,     setUrl]     = useState("");
  const [caption, setCaption] = useState("");
  const [busy,    setBusy]    = useState(false);
  const [lastId,  setLastId]  = useState<string | null>(null);
  const detectedType = detectType(url);

  const handlePost = async () => {
    if (!token) { toast.error("Connect your Fanvue account first"); return; }
    const trimmed = url.trim();
    if (!trimmed) { toast.error("Enter a media URL"); return; }
    if (!detectedType) { toast.error("URL must end in .jpg, .jpeg, .png, .mp4 etc."); return; }
    setBusy(true);
    const tid = "quick-post";
    toast.loading("Posting to Fanvue…", { id: tid, duration: Infinity });
    try {
      const postUuid = await publishToFanvue({
        token, mediaUrl: trimmed, mediaType: detectedType,
        caption: caption.trim() || "New post from Lila Studio",
        onProgress: s => toast.loading(s, { id: tid, duration: Infinity }),
      });
      setLastId(postUuid);
      toast.success("Posted to Fanvue!", {
        id: tid, duration: 15_000, description: `Post UUID: ${postUuid}`,
        action: { label: "View", onClick: () => window.open(`https://www.fanvue.com/post/${postUuid}`, "_blank") },
      });
      setUrl(""); setCaption("");
    } catch (e: any) {
      logE("Quick-post failed", e.message);
      toast.error("Post failed — see debug log ↓", { id: tid, description: e.message.slice(0, 200), duration: 20_000 });
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><LinkIcon className="h-4 w-4" /> Quick Post by URL</DialogTitle>
          <DialogDescription>Paste a CloudFront or Supabase media URL to post it directly to your Fanvue account.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Media URL</Label>
            <Input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://d2p7pge43lyniu.cloudfront.net/output/….jpeg" />
            {url.trim() && (
              <p className={cn("text-[11px]", detectedType ? "text-success" : "text-warning")}>
                {detectedType ? `✓ Detected as ${detectedType}` : "⚠ Cannot detect type — URL must end in .jpg/.png/.mp4 etc."}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Caption <span className="text-muted-foreground">(optional)</span></Label>
            <Input value={caption} onChange={e => setCaption(e.target.value)} placeholder="Check out my latest content! ✨" />
          </div>
          {/* Quick-fill buttons for known assets */}
          <div className="rounded-md border border-border/60 bg-muted/20 p-3 space-y-1.5">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Your assets</p>
            <button type="button" onClick={() => setUrl("https://d2p7pge43lyniu.cloudfront.net/output/c7cd0631-5025-4d0f-a333-a0eb612b05fc-u2_c3e1a90d-0401-45a7-bba5-4d0029047395.jpeg")}
              className="block w-full text-left text-[11px] text-primary hover:underline truncate">📷 CloudFront image (c7cd0631…)</button>
            <button type="button" onClick={() => setUrl("https://yaiygjwbtzevjpxncvzu.supabase.co/storage/v1/object/public/videos/52c86425-0381-4307-bd32-138b30da3c9f-e2_final.mp4")}
              className="block w-full text-left text-[11px] text-primary hover:underline truncate">🎬 Supabase video (52c86425…)</button>
          </div>
          {!token
            ? <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/5 p-3">
                <AlertTriangle className="h-4 w-4 text-warning flex-shrink-0" />
                <p className="text-xs">Connect your Fanvue account first.</p>
              </div>
            : <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/5 p-3">
                <span className="h-2 w-2 rounded-full bg-success flex-shrink-0" />
                <span className="text-xs">Posting as <strong>@{token.handle}</strong> ({token.name})</span>
                {!token.uuid && <span className="text-[10px] text-destructive ml-auto">⚠ No UUID — reconnect</span>}
              </div>}
          {lastId && (
            <div className="rounded-md border border-success/30 bg-success/5 p-3">
              <p className="text-xs font-medium text-success mb-1">Last post published ✓</p>
              <p className="font-mono text-[11px] break-all text-muted-foreground">{lastId}</p>
              <a href={`https://www.fanvue.com/post/${lastId}`} target="_blank" rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline">
                <ExternalLink className="h-3 w-3" /> View on Fanvue
              </a>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={handlePost} disabled={busy || !url.trim() || !detectedType || !token} className="gap-2">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {busy ? "Posting…" : "Post to Fanvue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Account dialog
// ─────────────────────────────────────────────────────────────────────────────
function AccountDialog({ open, onOpenChange, token, onDisconnect }: {
  open: boolean; onOpenChange: (o: boolean) => void; token: StoredToken | null; onDisconnect: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Fanvue Account</DialogTitle>
          <DialogDescription>Token stored in your browser localStorage. No database required.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {token ? (
            <div className="flex items-center justify-between rounded-lg border border-success/30 bg-success/5 p-3">
              <div className="flex items-center gap-3">
                <div className="grid h-9 w-9 place-items-center rounded-full bg-primary/10 text-primary font-semibold text-sm">{token.name.slice(0, 1).toUpperCase()}</div>
                <div>
                  <p className="text-sm font-medium">{token.name}</p>
                  <p className="text-xs text-muted-foreground">@{token.handle}</p>
                  <p className="text-[10px] text-muted-foreground font-mono">uuid: {token.uuid || "⚠ missing"}</p>
                  {token.expiresAt && <p className={cn("text-[10px]", token.expiresAt < Date.now() ? "text-destructive" : "text-success")}>{token.expiresAt < Date.now() ? "⚠ Token expired" : `Expires ${new Date(token.expiresAt).toLocaleDateString()}`}</p>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="gap-1 border-success/40 text-success text-xs"><CheckCircle className="h-3 w-3" /> Connected</Badge>
                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive text-xs" onClick={onDisconnect}>Disconnect</Button>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-muted/30 p-6 text-center">
              <Plug className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-2 text-sm font-medium">No account connected</p>
            </div>
          )}

          <div className="rounded-lg border border-border bg-muted/20 p-4">
            <p className="text-xs font-medium mb-1">{token ? "Reconnect (gets new scopes)" : "Connect Fanvue"}</p>
            <p className="text-xs text-muted-foreground mb-3">
              Redirects to Fanvue then back here automatically. The new OAuth request now
              includes <code className="text-[10px] bg-muted px-1 rounded">write:creator</code> scope
              which is required for the upload flow.
            </p>
            <Button className="w-full gap-2" onClick={() => { onOpenChange(false); startFanvueOAuth(); }}>
              <ExternalLink className="h-4 w-4" /> {token ? "Reconnect (get write:creator scope)" : "Connect Fanvue Account"}
            </Button>
          </div>

          <div className="rounded-lg border border-border/40 bg-muted/10 p-3">
            <p className="text-[11px] font-medium text-muted-foreground">Scopes requested</p>
            <p className="text-[10px] text-muted-foreground/80 mt-1 font-mono">
              read:self · read:media · write:media · write:post · write:creator
            </p>
            <p className="text-[10px] text-muted-foreground/50 mt-1">
              write:creator is new — required for GET /creators/{"{uuid}"}/media/uploads/.../url
            </p>
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────
function SchedulePage() {
  const queryClient = useQueryClient();
  const { data: scheduleData = EMPTY } = useQuery({ queryKey: ["schedules"], queryFn: fetchSchedules, staleTime: 10_000 });
  const [items,        setItems]        = useState<ScheduledItem[]>([]);
  const [fanvueToken,  setFanvueToken]  = useState<StoredToken | null>(() => loadToken());
  const [isExchanging, setIsExchanging] = useState(false);
  const { logs, clearLogs }             = useDebugLog();

  useEffect(() => setItems(scheduleData), [scheduleData]);

  // Handle OAuth redirect — FIX: use connecting state to prevent UI wipe
  useEffect(() => {
    const p    = new URLSearchParams(window.location.search);
    const code = p.get("code");
    const err  = p.get("error");

    if (code || err) window.history.replaceState({}, "", window.location.pathname);

    if (err) {
      logE(`OAuth error: ${p.get("error_description") ?? err}`);
      toast.error(`Fanvue auth error: ${p.get("error_description") ?? err}`);
      return;
    }
    if (!code) return;

    setIsExchanging(true);
    toast.loading("Connecting Fanvue account…", { id: "fv-connect" });
    exchangeFanvueCode(code)
      .then(t => {
        setFanvueToken(t);
        toast.success(`Connected as @${t.handle}!`, { id: "fv-connect", duration: 8_000 });
        queryClient.invalidateQueries({ queryKey: ["schedules"] });
      })
      .catch(e => {
        logE("Exchange failed", e.message);
        toast.error(e.message ?? "Failed to connect", { id: "fv-connect", duration: 15_000 });
      })
      .finally(() => setIsExchanging(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync token across tabs
  useEffect(() => {
    const fn = (e: StorageEvent) => { if (e.key === TOKEN_KEY) setFanvueToken(loadToken()); };
    window.addEventListener("storage", fn);
    return () => window.removeEventListener("storage", fn);
  }, []);

  // Realtime
  useEffect(() => {
    const ch = supabase.channel("schedules-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "schedules" }, () => queryClient.invalidateQueries({ queryKey: ["schedules"] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [queryClient]);

  const [tab,        setTab]        = useState("calendar");
  const [search,     setSearch]     = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | PublishStatus>("all");
  const [rangeFilter,  setRangeFilter]  = useState<"all" | "today" | "week" | "month">("all");
  const [selected,   setSelected]   = useState<ScheduledItem | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [quickOpen,  setQuickOpen]  = useState(false);
  const [weekStart,  setWeekStart]  = useState(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - d.getDay()); return d;
  });

  const stats = useMemo(() => {
    const now = new Date(); const wa = new Date(now); wa.setDate(wa.getDate() - 7);
    return {
      scheduled:     items.filter(i => i.status === "scheduled").length,
      todayCount:    items.filter(i => i.status === "scheduled" && sameDay(new Date(i.scheduledAt), now)).length,
      weekPublished: items.filter(i => i.status === "published" && i.publishedAt && new Date(i.publishedAt) >= wa).length,
      failed:        items.filter(i => i.status === "failed").length,
    };
  }, [items]);

  const filtered = useMemo(() => {
    const now = new Date();
    return items.filter(i => {
      if (statusFilter !== "all" && i.status !== statusFilter) return false;
      if (rangeFilter !== "all") {
        const d = new Date(i.scheduledAt);
        if (rangeFilter === "today" && !sameDay(d, now)) return false;
        if (rangeFilter === "week") { const wk = new Date(now); wk.setDate(wk.getDate() + 7); if (d < now || d > wk) return false; }
        if (rangeFilter === "month" && (d.getMonth() !== now.getMonth() || d.getFullYear() !== now.getFullYear())) return false;
      }
      if (search.trim() && ![i.contentName, i.character].join(" ").toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [items, statusFilter, rangeFilter, search]);

  const updateItem = (id: string, patch: Partial<ScheduledItem>) => setItems(p => p.map(i => i.id === id ? { ...i, ...patch } : i));

  const removeItem = async (id: string) => {
    setItems(p => p.filter(i => i.id !== id)); setSelected(null);
    try { const { error } = await supabase.from("schedules").delete().eq("id", id); if (error) throw error; toast.success("Removed"); queryClient.invalidateQueries({ queryKey: ["schedules"] }); }
    catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };

  const retryPublish = async (id: string) => {
    updateItem(id, { status: "scheduled", queueStatus: "ready" });
    try { await scheduleService.update(id, { status: "scheduled" }); toast.success("Queued for retry"); }
    catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };

  const publishNow = async (id: string) => {
    const item = items.find(i => i.id === id); if (!item) return;
    const token = loadToken();
    if (!token?.accessToken) {
      logE("No token in localStorage");
      toast.error("No Fanvue account connected.", { action: { label: "Connect", onClick: () => setAccountOpen(true) }, duration: 10_000 });
      return;
    }
    if (!token.uuid) {
      toast.error("Token is missing the creator UUID. Disconnect and reconnect Fanvue to refresh.", {
        action: { label: "Reconnect", onClick: () => setAccountOpen(true) }, duration: 10_000,
      });
      return;
    }
    if (!item.mediaUrl) {
      logE("No mediaUrl", `item=${id}`);
      toast.error("No media URL — check the Supabase images/videos table.");
      return;
    }
    updateItem(id, { status: "publishing", queueStatus: "publishing" });
    const tid = `pub-${id}`;
    toast.loading("Starting Fanvue publish…", { id: tid, duration: Infinity });
    try {
      const postUuid = await publishToFanvue({
        token, mediaUrl: item.mediaUrl, mediaType: item.type,
        caption: item.scenePrompts[0] ?? item.contentName,
        onProgress: s => toast.loading(s, { id: tid, duration: Infinity }),
      });
      const now = new Date().toISOString();
      const table = item.type === "image" ? "images" : "videos";
      const { data: schedRow } = await supabase.from("schedules").select("content_id").eq("id", id).single();
      if (schedRow?.content_id) {
        const { error: ue } = await supabase.from(table).update({ publish_status: "published", published_at: now, external_post_id: postUuid }).eq("id", schedRow.content_id);
        if (ue) logW("Supabase update error", ue.message); else logOk("Supabase record updated");
      }
      await scheduleService.update(id, { status: "published" });
      updateItem(id, {
        status: "published", queueStatus: "published", externalPostId: postUuid, publishedAt: now,
        history: [...item.history, { at: now, label: `Published to @${token.handle}`, kind: "published" }],
      });
      toast.success(`Published to @${token.handle}!`, {
        id: tid, duration: 12_000, description: `Post UUID: ${postUuid}`,
        action: { label: "View on Fanvue", onClick: () => window.open(`https://www.fanvue.com/post/${postUuid}`, "_blank") },
      });
      queryClient.invalidateQueries({ queryKey: ["schedules"] });
    } catch (e: any) {
      const msg = e?.message ?? "Unknown error";
      logE("Publish FAILED", msg);
      updateItem(id, {
        status: "failed", queueStatus: "failed",
        history: [...item.history, { at: new Date().toISOString(), label: `Failed: ${msg.slice(0, 120)}`, kind: "failed" }],
      });
      try { await scheduleService.update(id, { status: "failed" }); } catch {}
      toast.error("Publish failed — see debug log below", { id: tid, duration: 20_000, description: msg.slice(0, 200) });
    }
  };

  const [dragId, setDragId] = useState<string | null>(null);
  const onDropOnDay = async (day: Date) => {
    if (!dragId) return;
    const item = items.find(i => i.id === dragId); if (!item) return;
    const d = new Date(day); const old = new Date(item.scheduledAt);
    d.setHours(old.getHours(), old.getMinutes(), 0, 0);
    const iso = d.toISOString();
    updateItem(dragId, { scheduledAt: iso });
    try { await scheduleService.update(dragId, { publish_time: iso }); toast.success("Rescheduled"); }
    catch (e: any) { toast.error(e?.message ?? "Failed"); }
    setDragId(null);
  };

  const connected = !!fanvueToken?.accessToken;

  // ── Loading overlay while exchanging OAuth code ───────────────────────────
  if (isExchanging) {
    return (
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <AppHeader />
          <main className="flex flex-1 items-center justify-center min-h-[60vh]">
            <div className="flex flex-col items-center gap-4 text-center">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <p className="font-display text-lg font-semibold">Connecting Fanvue…</p>
              <p className="text-sm text-muted-foreground">Completing account authorisation, please wait.</p>
            </div>
          </main>
        </SidebarInset>
      </SidebarProvider>
    );
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <AppHeader />
        <main className="flex-1 overflow-y-auto bg-background pb-14">
          <div className="mx-auto max-w-[1400px] space-y-6 p-4 sm:p-6 lg:p-8">

            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <Link to="/" className="mb-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" /> Dashboard</Link>
                <h1 className="font-display text-3xl font-semibold tracking-tight">Scheduling</h1>
                <p className="mt-1 text-sm text-muted-foreground">Plan, queue and publish approved content to your Fanvue account.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" className="gap-2" onClick={() => setQuickOpen(true)}>
                  <LinkIcon className="h-4 w-4" /> Post by URL
                </Button>
                <Button variant="outline" size="sm" className="gap-2" onClick={() => setAccountOpen(true)}>
                  <Plug className="h-4 w-4" />
                  {connected
                    ? <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-success" /><span className="max-w-[140px] truncate">{fanvueToken!.name}</span><span className="text-muted-foreground text-xs">@{fanvueToken!.handle}</span></span>
                    : "Connect Fanvue"}
                </Button>
                <Button size="sm" className="gap-2" onClick={() => setCreateOpen(true)}><CalendarPlus className="h-4 w-4" /> Schedule content</Button>
              </div>
            </div>

            {!connected && (
              <div className="flex items-center gap-3 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3">
                <AlertTriangle className="h-4 w-4 flex-shrink-0 text-warning" />
                <p className="flex-1 text-sm">No Fanvue account connected.</p>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setAccountOpen(true)}><ExternalLink className="h-3.5 w-3.5" /> Connect now</Button>
              </div>
            )}

            {/* Show warning if connected but missing UUID (old token) */}
            {connected && !fanvueToken?.uuid && (
              <div className="flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
                <AlertTriangle className="h-4 w-4 flex-shrink-0 text-destructive" />
                <p className="flex-1 text-sm text-destructive">Token is missing the creator UUID — publishing will fail. Reconnect to fix.</p>
                <Button size="sm" variant="outline" className="gap-1.5 border-destructive/40 text-destructive" onClick={() => setAccountOpen(true)}>Reconnect</Button>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <DashboardCard label="Scheduled posts"     value={stats.scheduled}     icon={CalendarClock} accent="primary"  hint="Awaiting publish" />
              <DashboardCard label="Publishing today"    value={stats.todayCount}    icon={Clock}         accent="chart-2"  hint="Next 24h" />
              <DashboardCard label="Published this week" value={stats.weekPublished} icon={CheckCircle2}  accent="chart-3" />
              <DashboardCard label="Failed"              value={stats.failed}        icon={AlertTriangle} accent="chart-5"  hint={stats.failed ? "Needs attention" : "All clear"} />
            </div>

            <Card className="border-border/60 bg-card">
              <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search character, content…" className="pl-9" />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Filter className="h-4 w-4 text-muted-foreground" />
                  <Select value={statusFilter} onValueChange={v => setStatusFilter(v as never)}>
                    <SelectTrigger className="h-9 w-[150px]"><SelectValue placeholder="Status" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      <SelectItem value="scheduled">Scheduled</SelectItem>
                      <SelectItem value="publishing">Publishing</SelectItem>
                      <SelectItem value="published">Published</SelectItem>
                      <SelectItem value="failed">Failed</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={rangeFilter} onValueChange={v => setRangeFilter(v as never)}>
                    <SelectTrigger className="h-9 w-[140px]"><SelectValue placeholder="Date range" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Any time</SelectItem>
                      <SelectItem value="today">Today</SelectItem>
                      <SelectItem value="week">Next 7 days</SelectItem>
                      <SelectItem value="month">This month</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                <TabsTrigger value="calendar">Calendar</TabsTrigger>
                <TabsTrigger value="queue">Publishing Queue</TabsTrigger>
                <TabsTrigger value="history">History</TabsTrigger>
              </TabsList>
              <TabsContent value="calendar" className="mt-4">
                <CalendarView weekStart={weekStart} setWeekStart={setWeekStart} items={filtered}
                  onOpen={setSelected} onDragStart={setDragId} onDropOnDay={onDropOnDay} onSchedule={() => setCreateOpen(true)} />
              </TabsContent>
              <TabsContent value="queue" className="mt-4">
                <QueueView items={filtered.filter(i => ["scheduled", "publishing", "failed"].includes(i.status))}
                  onOpen={setSelected} onCancel={removeItem} onPublishNow={publishNow} onRetry={retryPublish} onSchedule={() => setCreateOpen(true)} />
              </TabsContent>
              <TabsContent value="history" className="mt-4">
                <HistoryView items={filtered.filter(i => ["published", "failed"].includes(i.status))} onOpen={setSelected} onRetry={retryPublish} />
              </TabsContent>
            </Tabs>
          </div>
        </main>
      </SidebarInset>

      <DetailSheet item={selected} onClose={() => setSelected(null)} fanvueToken={fanvueToken}
        onRetry={retryPublish} onPublishNow={publishNow} onRemove={removeItem} />
      <CreateScheduleDialog open={createOpen} onOpenChange={setCreateOpen} fanvueToken={fanvueToken} />
      <AccountDialog open={accountOpen} onOpenChange={setAccountOpen} token={fanvueToken}
        onDisconnect={() => { clearToken(); setFanvueToken(null); toast.success("Disconnected"); }} />
      <QuickPostDialog open={quickOpen} onOpenChange={setQuickOpen} token={fanvueToken} />
      <DebugPanel logs={logs} onClear={clearLogs} />
    </SidebarProvider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components (Calendar, Queue, History, Detail, Create)
// ─────────────────────────────────────────────────────────────────────────────
function CalendarView({ weekStart, setWeekStart, items, onOpen, onDragStart, onDropOnDay, onSchedule }: {
  weekStart: Date; setWeekStart: (d: Date) => void; items: ScheduledItem[];
  onOpen: (i: ScheduledItem) => void; onDragStart: (id: string | null) => void;
  onDropOnDay: (d: Date) => void; onSchedule: () => void;
}) {
  const days  = Array.from({ length: 7 }).map((_, i) => { const d = new Date(weekStart); d.setDate(d.getDate() + i); return d; });
  const move  = (n: number) => { const d = new Date(weekStart); d.setDate(d.getDate() + n * 7); setWeekStart(d); };
  const today = new Date();
  return (
    <Card className="border-border/60 bg-card">
      <CardContent className="p-4">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="font-display text-lg font-semibold">{weekStart.toLocaleDateString([], { month: "long", year: "numeric" })}</p>
            <p className="text-xs text-muted-foreground">Drag cards to reschedule</p>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => move(-1)}><ChevronLeft className="h-4 w-4" /></Button>
            <Button variant="outline" size="sm" className="h-8" onClick={() => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - d.getDay()); setWeekStart(d); }}>Today</Button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => move(1)}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
        {items.length === 0 ? <EmptyState onSchedule={onSchedule} /> : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-7">
            {days.map(day => {
              const di      = items.filter(i => sameDay(new Date(i.scheduledAt), day)).sort((a, b) => +new Date(a.scheduledAt) - +new Date(b.scheduledAt));
              const isToday = sameDay(day, today);
              return (
                <div key={day.toISOString()} onDragOver={e => e.preventDefault()} onDrop={() => onDropOnDay(day)}
                  className="flex min-h-[260px] flex-col rounded-lg border border-border/60 bg-background/40 p-2 hover:border-primary/40 transition-colors">
                  <div className="mb-2 flex items-baseline justify-between px-1">
                    <p className={cn("text-[10px] font-medium uppercase tracking-wider", isToday ? "text-primary" : "text-muted-foreground")}>{day.toLocaleDateString([], { weekday: "short" })}</p>
                    <p className={cn("font-display text-lg font-semibold", isToday ? "text-primary" : "text-foreground")}>{day.getDate()}</p>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {di.map(i => (
                      <button key={i.id} type="button" draggable onDragStart={() => onDragStart(i.id)} onClick={() => onOpen(i)}
                        className="flex flex-col gap-1.5 rounded-md border border-border/60 bg-card p-1.5 text-left hover:border-primary/50 transition-colors">
                        <div className="relative h-16 w-full overflow-hidden rounded">
                          <img src={i.thumbnail} alt="" className="h-full w-full object-cover" />
                          <div className="absolute left-1 top-1 grid h-5 w-5 place-items-center rounded bg-black/60">
                            {i.type === "video" ? <VideoIcon className="h-3 w-3 text-white" /> : <ImageIcon className="h-3 w-3 text-white" />}
                          </div>
                          <div className="absolute right-1 top-1"><StatusBadge status={i.status} /></div>
                        </div>
                        <div className="px-0.5">
                          <p className="truncate text-xs font-medium">{i.character}</p>
                          <p className="text-[10px] text-muted-foreground">{fmtT(i.scheduledAt)}</p>
                        </div>
                      </button>
                    ))}
                    {di.length === 0 && <p className="px-1 pt-2 text-[11px] text-muted-foreground/70">Nothing scheduled</p>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function QueueView({ items, onOpen, onCancel, onPublishNow, onRetry, onSchedule }: {
  items: ScheduledItem[]; onOpen: (i: ScheduledItem) => void; onCancel: (id: string) => void;
  onPublishNow: (id: string) => void; onRetry: (id: string) => void; onSchedule: () => void;
}) {
  if (items.length === 0) return <Card className="border-border/60 bg-card"><CardContent className="p-4"><EmptyState onSchedule={onSchedule} message="Queue is empty." /></CardContent></Card>;
  return (
    <div className="grid gap-3">
      {items.map(i => (
        <Card key={i.id} className="border-border/60 bg-card hover:border-primary/40 transition-colors">
          <CardContent className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
            <button type="button" onClick={() => onOpen(i)} className="relative h-20 w-32 shrink-0 overflow-hidden rounded-md bg-muted">
              <img src={i.thumbnail} alt="" className="h-full w-full object-cover hover:scale-105 transition-transform" />
              {i.type === "video" && <div className="absolute inset-0 grid place-items-center bg-black/30"><Play className="h-5 w-5 text-white" /></div>}
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-semibold">{i.contentName}</p>
                <QueueBadge status={i.queueStatus} />
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{i.character}</p>
              <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground"><Clock className="h-3 w-3" />{fmtDT(i.scheduledAt)}</p>
              {!i.mediaUrl && <p className="mt-1 text-[10px] text-destructive font-medium">⚠ No media URL — check Supabase table</p>}
            </div>
            <div className="flex items-center gap-1.5">
              {i.status === "failed"
                ? <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onRetry(i.id)}><RefreshCw className="h-3.5 w-3.5" /> Retry</Button>
                : <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onPublishNow(i.id)} disabled={i.status === "publishing" || !i.mediaUrl}>
                    {i.status === "publishing" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    {i.status === "publishing" ? "Publishing…" : "Publish now"}
                  </Button>}
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button size="icon" variant="ghost" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => onOpen(i)}><Eye className="mr-2 h-4 w-4" /> View details</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => onCancel(i.id)} className="text-destructive focus:text-destructive"><Trash2 className="mr-2 h-4 w-4" /> Cancel</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function HistoryView({ items, onOpen, onRetry }: { items: ScheduledItem[]; onOpen: (i: ScheduledItem) => void; onRetry: (id: string) => void; }) {
  if (items.length === 0) return (
    <Card className="border-border/60 bg-card"><CardContent className="p-10 text-center">
      <Inbox className="mx-auto h-10 w-10 text-muted-foreground/60" />
      <p className="mt-3 font-medium">No history yet</p>
      <p className="mt-1 text-sm text-muted-foreground">Published and failed posts appear here.</p>
    </CardContent></Card>
  );
  return (
    <Card className="border-border/60 bg-card"><CardContent className="p-0">
      <div className="grid grid-cols-12 gap-3 border-b border-border/60 px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        <div className="col-span-6">Content</div><div className="col-span-3">Published</div>
        <div className="col-span-2">Post UUID</div><div className="col-span-1 text-right">Status</div>
      </div>
      {items.map(i => (
        <button key={i.id} type="button" onClick={() => onOpen(i)}
          className="grid w-full grid-cols-12 items-center gap-3 border-b border-border/40 px-4 py-3 text-left hover:bg-muted/40 last:border-b-0 transition-colors">
          <div className="col-span-6 flex items-center gap-3">
            <div className="relative h-12 w-16 shrink-0 overflow-hidden rounded">
              <img src={i.thumbnail} alt="" className="h-full w-full object-cover" />
              {i.type === "video" && <div className="absolute inset-0 grid place-items-center bg-black/30"><Play className="h-3.5 w-3.5 text-white" /></div>}
            </div>
            <div className="min-w-0"><p className="truncate text-sm font-medium">{i.contentName}</p><p className="truncate text-xs text-muted-foreground">{i.character}</p></div>
          </div>
          <div className="col-span-3 text-xs text-muted-foreground">{i.publishedAt ? fmtDT(i.publishedAt) : "—"}</div>
          <div className="col-span-2">
            {i.externalPostId
              ? <a href={`https://www.fanvue.com/post/${i.externalPostId}`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                  className="inline-flex items-center gap-1 truncate font-mono text-[11px] text-primary hover:underline">
                  {i.externalPostId.slice(0, 10)}… <ExternalLink className="h-3 w-3 flex-shrink-0" />
                </a>
              : <span className="font-mono text-[11px] text-muted-foreground">—</span>}
          </div>
          <div className="col-span-1 flex items-center justify-end gap-2">
            <StatusBadge status={i.status} />
            {i.status === "failed" && <Button size="icon" variant="ghost" className="h-7 w-7" onClick={e => { e.stopPropagation(); onRetry(i.id); }}><RefreshCw className="h-3.5 w-3.5" /></Button>}
          </div>
        </button>
      ))}
    </CardContent></Card>
  );
}

function EmptyState({ onSchedule, message = "No scheduled content." }: { onSchedule: () => void; message?: string }) {
  return (
    <div className="mx-auto max-w-md py-10 text-center">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-border/60 bg-background"><CalendarClock className="h-6 w-6 text-muted-foreground" /></div>
      <p className="mt-4 font-display text-lg font-semibold">{message}</p>
      <p className="mt-1 text-sm text-muted-foreground">Pick an approved asset and schedule it to Fanvue.</p>
      <Button size="sm" className="mt-5 gap-2" onClick={onSchedule}><CalendarPlus className="h-4 w-4" /> Schedule content</Button>
    </div>
  );
}

function DetailSheet({ item, onClose, fanvueToken, onRetry, onPublishNow, onRemove }: {
  item: ScheduledItem | null; onClose: () => void; fanvueToken: StoredToken | null;
  onRetry: (id: string) => void; onPublishNow: (id: string) => void; onRemove: (id: string) => void;
}) {
  return (
    <Sheet open={!!item} onOpenChange={o => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {item && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">{item.contentName}<StatusBadge status={item.status} /></SheetTitle>
              <SheetDescription>{item.character} · {item.type} · {fmtDT(item.scheduledAt)}</SheetDescription>
            </SheetHeader>
            <div className="mt-6 space-y-5">
              <div className="relative aspect-video overflow-hidden rounded-lg bg-muted">
                {item.type === "video"
                  ? <video src={item.mediaUrl || item.thumbnail} controls playsInline className="h-full w-full object-cover" />
                  : <img src={item.mediaUrl || item.thumbnail} alt="" className="h-full w-full object-cover" />}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-md border border-border bg-background/40 p-3">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Scheduled</p>
                  <p className="mt-1 text-sm">{fmtDT(item.scheduledAt)}</p>
                </div>
                <div className="rounded-md border border-border bg-background/40 p-3">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Fanvue Account</p>
                  <p className="mt-1 text-sm">{fanvueToken ? `${fanvueToken.name} (@${fanvueToken.handle})` : <span className="text-muted-foreground">Not connected</span>}</p>
                </div>
              </div>
              {!item.mediaUrl && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
                  <AlertTriangle className="h-4 w-4 text-destructive mt-px flex-shrink-0" />
                  <p className="text-xs text-destructive">No media URL. Check the {item.type === "image" ? "image_url" : "video_url"} column in the Supabase {item.type === "image" ? "images" : "videos"} table.</p>
                </div>
              )}
              {item.externalPostId && (
                <div className="rounded-md border border-success/30 bg-success/5 p-3">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Published Post UUID</p>
                  <p className="mt-1 font-mono text-xs break-all">{item.externalPostId}</p>
                  <a href={`https://www.fanvue.com/post/${item.externalPostId}`} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-xs text-primary hover:underline">
                    <ExternalLink className="h-3 w-3" /> View on Fanvue
                  </a>
                </div>
              )}
              <div>
                <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Scene prompts</p>
                <ScrollArea className="h-32 rounded-md border border-border bg-background/40 p-3">
                  <ol className="space-y-2 text-xs">{item.scenePrompts.map((p, i) => <li key={i} className="leading-relaxed"><span className="mr-1 text-muted-foreground">{i + 1}.</span>{p}</li>)}</ol>
                </ScrollArea>
              </div>
              <div>
                <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">History</p>
                <ol className="relative space-y-3 border-l border-border pl-4">
                  {item.history.map((h, i) => (
                    <li key={i} className="relative">
                      <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-primary ring-4 ring-background" />
                      <p className="text-xs font-medium">{h.label}</p>
                      <p className="text-[11px] text-muted-foreground">{fmtDT(h.at)}</p>
                    </li>
                  ))}
                </ol>
              </div>
              <Separator />
              <div className="flex flex-wrap items-center gap-2">
                {item.status === "failed"
                  ? <Button size="sm" className="gap-2" onClick={() => onRetry(item.id)}><RefreshCw className="h-4 w-4" /> Retry</Button>
                  : item.status !== "published"
                    ? <Button size="sm" className="gap-2" onClick={() => onPublishNow(item.id)} disabled={item.status === "publishing" || !item.mediaUrl || !fanvueToken}>
                        {item.status === "publishing" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        {item.status === "publishing" ? "Publishing…" : "Publish now to Fanvue"}
                      </Button>
                    : null}
                <Button size="sm" variant="outline" className="gap-2 text-destructive hover:text-destructive" onClick={() => onRemove(item.id)}>
                  <Trash2 className="h-4 w-4" /> Remove
                </Button>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function CreateScheduleDialog({ open, onOpenChange, fanvueToken }: {
  open: boolean; onOpenChange: (o: boolean) => void; fanvueToken: StoredToken | null;
}) {
  const queryClient = useQueryClient();
  const { data: assets = [] } = useQuery({ queryKey: ["approved-assets"], queryFn: fetchApprovedAssets, enabled: open });
  const [idx,  setIdx]  = useState("0");
  const [date, setDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); });
  const [time, setTime] = useState("18:00");

  const submit = async () => {
    const asset = assets[Number(idx)];
    if (!asset) { toast.error("Pick an approved asset first"); return; }
    const iso = new Date(`${date}T${time}:00`).toISOString();
    try {
      const { data: u } = await supabase.auth.getUser();
      await scheduleService.create({ content_type: asset.type, content_id: asset.id, publish_time: iso, platform: "Fanvue", status: "scheduled", created_by: u.user?.id ?? null } as any);
      toast.success("Content scheduled!");
      queryClient.invalidateQueries({ queryKey: ["schedules"] });
      onOpenChange(false);
    } catch (e: any) { toast.error(e?.message ?? "Failed to schedule"); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Schedule content</DialogTitle>
          <DialogDescription>Queue an approved asset for publishing to Fanvue.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Content</Label>
            {assets.length === 0
              ? <p className="rounded-md border border-dashed border-border bg-muted/30 p-3 text-xs text-muted-foreground">No approved content. Approve items in Review Queue first.</p>
              : <Select value={idx} onValueChange={setIdx}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{assets.map((a, i) => <SelectItem key={a.id} value={String(i)}>{a.name}</SelectItem>)}</SelectContent>
                </Select>}
          </div>
          <div className="space-y-1.5">
            <Label>Publishing account</Label>
            {fanvueToken
              ? <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/5 px-3 py-2">
                  <span className="h-2 w-2 rounded-full bg-success flex-shrink-0" />
                  <span className="text-sm font-medium">{fanvueToken.name}</span>
                  <span className="text-xs text-muted-foreground">@{fanvueToken.handle}</span>
                </div>
              : <div className="rounded-md border border-dashed border-border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground mb-2">No Fanvue account connected yet.</p>
                  <Button size="sm" className="gap-2 w-full" onClick={() => { onOpenChange(false); startFanvueOAuth(); }}><ExternalLink className="h-3.5 w-3.5" /> Connect Fanvue Account</Button>
                </div>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Date</Label><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Time</Label><Input type="time" value={time} onChange={e => setTime(e.target.value)} /></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} className="gap-2" disabled={!assets.length}>
            <CalendarPlus className="h-4 w-4" /> Schedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
