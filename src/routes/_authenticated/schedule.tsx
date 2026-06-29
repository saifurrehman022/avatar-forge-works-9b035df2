
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { scheduleService } from "@/services";
import {
  CalendarClock, CalendarPlus, CheckCircle2, Clock, Search,
  Image as ImageIcon, Video as VideoIcon, Play, ArrowLeft, Send,
  Filter, Inbox, ChevronLeft, ChevronRight, MoreHorizontal,
  Trash2, Eye, RefreshCw, AlertTriangle, Loader2, Plug,
  CheckCircle, ExternalLink, Bug, ChevronDown, ChevronUp,
  Link2, Copy, Info, Zap,
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
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Fanvue OAuth constants
// ─────────────────────────────────────────────────────────────────────────────
const FANVUE_CLIENT_ID     = "f9d35fff-3d12-4dd5-8945-750c37d65ae9";
const FANVUE_CLIENT_SECRET = "05275891c81581c5cb79d336c8e9f87680f0976843bf17d6737bdcf0dde38b1a";
const FANVUE_REDIRECT_URI  = "https://avatar-forge-works-9b035df2-olive.vercel.app/schedule";
const FANVUE_AUTH_URL      = "https://auth.fanvue.com/oauth2/auth";
const FANVUE_TOKEN_URL     = "https://auth.fanvue.com/oauth2/token";
const FANVUE_API_BASE      = "https://api.fanvue.com";
const FANVUE_API_VERSION   = "2025-06-26";

// ─────────────────────────────────────────────────────────────────────────────
// Debug log
// ─────────────────────────────────────────────────────────────────────────────
type LogLevel = "info" | "warn" | "error" | "success";
type LogEntry = { at: number; level: LogLevel; msg: string; detail?: string };

let _logListeners: Array<(e: LogEntry) => void> = [];
function emitLog(e: LogEntry) {
  console[e.level === "success" ? "info" : e.level]("[FV]", e.msg, e.detail ?? "");
  _logListeners.forEach(fn => fn(e));
}
const dbg   = (m: string, d?: string) => emitLog({ at: Date.now(), level: "info",    msg: m, detail: d });
const dbgOk = (m: string, d?: string) => emitLog({ at: Date.now(), level: "success", msg: m, detail: d });
const dbgW  = (m: string, d?: string) => emitLog({ at: Date.now(), level: "warn",    msg: m, detail: d });
const dbgE  = (m: string, d?: string) => emitLog({ at: Date.now(), level: "error",   msg: m, detail: d });

function useDebugLog() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  useEffect(() => {
    const fn = (e: LogEntry) => setLogs(p => [e, ...p].slice(0, 300));
    _logListeners.push(fn);
    return () => { _logListeners = _logListeners.filter(f => f !== fn); };
  }, []);
  return { logs, clearLogs: () => setLogs([]) };
}

// ─────────────────────────────────────────────────────────────────────────────
// localStorage token — persists across full page reloads (OAuth redirects)
// ─────────────────────────────────────────────────────────────────────────────
const LS_KEY = "fanvue_token_v2";

type StoredToken = {
  accessToken:   string;
  refreshToken?: string;
  expiresAt?:    number;   // unix ms
  name:          string;
  handle:        string;
  uuid:          string;
};

const saveToken  = (t: StoredToken) => localStorage.setItem(LS_KEY, JSON.stringify(t));
const clearToken = () => localStorage.removeItem(LS_KEY);
function loadToken(): StoredToken | null {
  try {
    const r = localStorage.getItem(LS_KEY);
    return r ? (JSON.parse(r) as StoredToken) : null;
  } catch { return null; }
}

// Token refresh helper
async function refreshAccessToken(refreshToken: string): Promise<StoredToken | null> {
  try {
    dbg("Refreshing access token…");
    const res = await fetch(FANVUE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type:    "refresh_token",
        client_id:     FANVUE_CLIENT_ID,
        client_secret: FANVUE_CLIENT_SECRET,
        refresh_token: refreshToken,
      }).toString(),
    });
    if (!res.ok) { dbgW(`Token refresh failed (${res.status})`); return null; }
    const t = await res.json();
    const existing = loadToken();
    const updated: StoredToken = {
      ...(existing ?? { name: "Fanvue Account", handle: "fanvue", uuid: "" }),
      accessToken:   t.access_token,
      refreshToken:  t.refresh_token ?? refreshToken,
      expiresAt:     t.expires_in ? Date.now() + (t.expires_in as number) * 1000 : undefined,
    };
    saveToken(updated);
    dbgOk("Token refreshed");
    return updated;
  } catch (e: any) { dbgW("Token refresh error", e.message); return null; }
}

// Get a valid (possibly refreshed) token
async function getValidToken(): Promise<StoredToken | null> {
  const t = loadToken();
  if (!t) return null;
  // If expiry known and within 2 min, refresh
  if (t.expiresAt && t.refreshToken && t.expiresAt - Date.now() < 120_000) {
    return refreshAccessToken(t.refreshToken);
  }
  return t;
}

// ─────────────────────────────────────────────────────────────────────────────
// PKCE helpers
// ─────────────────────────────────────────────────────────────────────────────
function b64url(buf: ArrayBuffer) {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
async function generatePKCE() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  const verifier  = b64url(arr.buffer);
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  return { verifier, challenge };
}
const PKCE_KEY = "fanvue_pkce_v";
const ST_KEY   = "fanvue_oauth_state";

async function startFanvueOAuth() {
  const { verifier, challenge } = await generatePKCE();
  const state = crypto.randomUUID();
  // Use localStorage so it survives the redirect (sessionStorage can be cleared)
  localStorage.setItem(PKCE_KEY, verifier);
  localStorage.setItem(ST_KEY, state);
  const p = new URLSearchParams({
    client_id:             FANVUE_CLIENT_ID,
    redirect_uri:          FANVUE_REDIRECT_URI,
    response_type:         "code",
    scope:                 "openid offline_access read:self read:media write:media write:post",
    state,
    code_challenge:        challenge,
    code_challenge_method: "S256",
  });
  window.location.href = `${FANVUE_AUTH_URL}?${p}`;
}

async function exchangeFanvueCode(code: string, returnedState: string): Promise<StoredToken> {
  // Verify state to prevent CSRF
  const savedState = localStorage.getItem(ST_KEY);
  // State check (warn but don't hard-fail — some environments strip state)
  if (savedState && savedState !== returnedState) {
    dbgW("OAuth state mismatch — possible CSRF, proceeding anyway");
  }
  const verifier = localStorage.getItem(PKCE_KEY);
  if (!verifier) throw new Error("PKCE verifier missing from localStorage — click Connect again");
  localStorage.removeItem(PKCE_KEY);
  localStorage.removeItem(ST_KEY);

  dbg("Exchanging auth code for token…");
  const tokenRes = await fetch(FANVUE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "authorization_code",
      code,
      redirect_uri:  FANVUE_REDIRECT_URI,
      client_id:     FANVUE_CLIENT_ID,
      client_secret: FANVUE_CLIENT_SECRET,
      code_verifier: verifier,
    }).toString(),
  });
  if (!tokenRes.ok) {
    const e = await tokenRes.text();
    dbgE(`Token exchange failed (${tokenRes.status})`, e);
    throw new Error(`Token exchange failed (${tokenRes.status}): ${e}`);
  }
  const tokens = await tokenRes.json();
  dbgOk("Token exchange success");
  dbg("Token details", JSON.stringify({ expires_in: tokens.expires_in, scope: tokens.scope }));

  const accessToken = tokens.access_token as string;

  // Fetch profile — use /users/me per official docs
  dbg("Fetching profile GET /users/me…");
  const profileRes = await fetch(`${FANVUE_API_BASE}/users/me`, {
    headers: { Authorization: `Bearer ${accessToken}`, "X-Fanvue-API-Version": FANVUE_API_VERSION },
  });
  const profileTxt = await profileRes.text();
  dbg(`/users/me (${profileRes.status})`, profileTxt.slice(0, 400));
  const profile = profileRes.ok ? JSON.parse(profileTxt) : {};

  const stored: StoredToken = {
    accessToken,
    refreshToken: tokens.refresh_token,
    expiresAt:    tokens.expires_in ? Date.now() + (tokens.expires_in as number) * 1000 : undefined,
    name:   profile.displayName ?? profile.name   ?? profile.username ?? "Fanvue Account",
    handle: profile.username    ?? profile.handle ?? profile.uuid     ?? "fanvue",
    uuid:   profile.uuid        ?? profile.id     ?? crypto.randomUUID(),
  };
  saveToken(stored);
  dbgOk(`Token saved to localStorage`, `@${stored.handle} — ${stored.name}`);
  return stored;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fanvue API helpers
// ─────────────────────────────────────────────────────────────────────────────
const fvH = (tok: string, extra?: Record<string, string>) => ({
  Authorization: `Bearer ${tok}`,
  "X-Fanvue-API-Version": FANVUE_API_VERSION,
  ...extra,
});

async function safeJson(res: Response): Promise<any> {
  const text = await res.text();
  const shortUrl = res.url.replace(/\?.*/, "").replace(FANVUE_API_BASE, "");
  dbg(`HTTP ${res.status} ${shortUrl}`, text.slice(0, 500));
  try { return JSON.parse(text); } catch { return { _raw: text }; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Media upload — multipart upload via Fanvue API
// Official flow:
//   1. POST /media/uploads → { mediaUuid, uploadId }
//   2. GET  /media/uploads/{uploadId}/parts/1/url → presigned S3 URL (text/plain)
//   3. PUT  blob → S3
//   4. PATCH /media/uploads/{uploadId} → complete
//   5. Poll GET /media/{uuid} until status=ready
// ─────────────────────────────────────────────────────────────────────────────
async function uploadMediaToFanvue(params: {
  accessToken: string;
  mediaUrl:    string;
  mediaType:   "image" | "video";
  onProgress?: (s: string) => void;
}): Promise<string> {
  const { accessToken, mediaUrl, mediaType, onProgress } = params;
  const rep = (s: string) => { dbg(s); onProgress?.(s); };

  // Download the blob from Supabase/CloudFront
  rep("Downloading media file…");
  dbg("Fetching blob from", mediaUrl);
  let blob: Blob;
  try {
    const r = await fetch(mediaUrl);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    blob = await r.blob();
    if (blob.size === 0) throw new Error("Empty blob");
    dbgOk(`Downloaded`, `${(blob.size / 1024).toFixed(0)} KB, type=${blob.type}`);
  } catch (e: any) {
    dbgW("Direct download failed, trying proxy…", e.message);
    // Proxy fallback
    const r2 = await fetch(`/api/proxy-media?url=${encodeURIComponent(mediaUrl)}`);
    if (!r2.ok) throw new Error(`Cannot download media (${r2.status}). Add api/proxy-media.ts to Vercel.`);
    blob = await r2.blob();
    if (blob.size === 0) throw new Error("Proxy returned empty blob");
    dbgOk(`Proxy download OK`, `${(blob.size / 1024).toFixed(0)} KB`);
  }
  rep(`Downloaded ${(blob.size / 1024).toFixed(0)} KB`);

  const ext      = mediaType === "video" ? "mp4" : "jpeg";
  const filename = `lila-${Date.now()}.${ext}`;

  // Step 1: POST /media/uploads
  rep("Creating Fanvue upload session…");
  const sessR = await fetch(`${FANVUE_API_BASE}/media/uploads`, {
    method:  "POST",
    headers: fvH(accessToken, { "Content-Type": "application/json" }),
    body:    JSON.stringify({ name: filename, filename, mediaType }),
  });
  const sess = await safeJson(sessR);
  if (!sessR.ok) {
    if (sessR.status === 403) throw new Error(`API_ACCESS_DENIED: write:media 403. Your account needs API access. Email support@fanvue.com`);
    throw new Error(`Upload session failed (${sessR.status}): ${JSON.stringify(sess)}`);
  }
  const { mediaUuid, uploadId } = sess;
  if (!mediaUuid || !uploadId) throw new Error(`Missing mediaUuid/uploadId: ${JSON.stringify(sess)}`);
  dbgOk("Session created", `mediaUuid=${mediaUuid} uploadId=${uploadId}`);

  // Step 2: GET presigned URL
  rep("Getting presigned upload URL…");
  const urlR = await fetch(`${FANVUE_API_BASE}/media/uploads/${uploadId}/parts/1/url`, {
    headers: fvH(accessToken),
  });
  if (!urlR.ok) {
    const t = await urlR.text();
    throw new Error(`Presigned URL (${urlR.status}): ${t}`);
  }
  const presigned = (await urlR.text()).trim().replace(/^"|"$/g, "");
  if (!presigned.startsWith("https://")) throw new Error(`Bad presigned URL: "${presigned.slice(0, 80)}"`);
  dbgOk("Presigned URL received");

  // Step 3: PUT to S3
  rep(`Uploading ${(blob.size / 1024).toFixed(0)} KB to S3…`);
  const contentType = blob.type || (mediaType === "video" ? "video/mp4" : "image/jpeg");
  const s3R = await fetch(presigned, { method: "PUT", body: blob, headers: { "Content-Type": contentType } });
  if (!s3R.ok) {
    const t = await s3R.text();
    throw new Error(`S3 upload failed (${s3R.status}): ${t}`);
  }
  const etag = (s3R.headers.get("ETag") ?? s3R.headers.get("etag") ?? "").replace(/^"|"$/g, "");
  dbgOk("S3 upload complete", `ETag: ${etag}`);

  // Step 4: PATCH to complete
  rep("Completing upload…");
  const compR = await fetch(`${FANVUE_API_BASE}/media/uploads/${uploadId}`, {
    method:  "PATCH",
    headers: fvH(accessToken, { "Content-Type": "application/json" }),
    body:    JSON.stringify({ parts: [{ PartNumber: 1, ETag: etag }] }),
  });
  const compBody = await safeJson(compR);
  if (!compR.ok) throw new Error(`Complete upload (${compR.status}): ${JSON.stringify(compBody)}`);
  dbgOk("Upload completed");

  // Step 5: Poll until status=ready
  // Official docs status values: created | processing | ready | error
  rep("Waiting for Fanvue to process media…");
  const deadline = Date.now() + 180_000;
  let lastStatus = "";
  while (Date.now() < deadline) {
    const pollR    = await fetch(`${FANVUE_API_BASE}/media/${mediaUuid}`, { headers: fvH(accessToken) });
    const pollBody = await safeJson(pollR);
    const status   = String(pollBody.status ?? "");
    if (status !== lastStatus) { dbg(`Media status → ${status}`); lastStatus = status; }
    rep(`Processing… (${status})`);
    if (status === "ready") { dbgOk("Media ready ✓"); break; }
    if (status === "error") throw new Error("Fanvue media processing error. Ensure JPEG/PNG or MP4 format.");
    await new Promise(r => setTimeout(r, 4000));
  }

  return mediaUuid as string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Create Fanvue post
// Per official docs:
//   POST /posts
//   body: { content, mediaIds, audience, price?, publishAt? }
//   NOTE: field is `content` (not `text`) and `mediaIds` (not `mediaUuids`)
// ─────────────────────────────────────────────────────────────────────────────
async function createFanvuePost(params: {
  accessToken: string;
  mediaId:     string;       // Fanvue mediaUuid after upload
  caption:     string;
  audience:    "subscribers" | "followers-and-subscribers";
  onProgress?: (s: string) => void;
}): Promise<string> {
  const { accessToken, mediaId, caption, audience, onProgress } = params;
  const rep = (s: string) => { dbg(s); onProgress?.(s); };

  rep("Creating post on Fanvue…");
  // Official API: field name is `content`, mediaIds array, audience string
  const body = {
    content:  caption,
    mediaIds: [mediaId],
    audience,
  };
  dbg("POST /posts", JSON.stringify(body));
  const postR = await fetch(`${FANVUE_API_BASE}/posts`, {
    method:  "POST",
    headers: fvH(accessToken, { "Content-Type": "application/json" }),
    body:    JSON.stringify(body),
  });
  const postData = await safeJson(postR);
  if (!postR.ok) {
    dbgE(`Create post failed (${postR.status})`, JSON.stringify(postData));
    throw new Error(`Create post (${postR.status}): ${JSON.stringify(postData)}`);
  }
  dbgOk("Post created", JSON.stringify(postData));

  // Official docs: response has `uuid` at top level
  const postUuid = postData.uuid ?? postData.id ?? postData.postId ?? postData.post?.uuid;
  if (!postUuid) throw new Error(`No UUID in post response: ${JSON.stringify(postData)}`);
  return postUuid as string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Full publish flow: upload + post
// ─────────────────────────────────────────────────────────────────────────────
async function publishToFanvue(params: {
  accessToken: string;
  mediaUrl:    string;
  mediaType:   "image" | "video";
  caption:     string;
  audience:    "subscribers" | "followers-and-subscribers";
  onProgress?: (s: string) => void;
}): Promise<string> {
  const { accessToken, onProgress } = params;
  const rep = (s: string) => { dbg(s); onProgress?.(s); };

  // 1. Verify token — use /users/me per official docs
  rep("Verifying Fanvue token…");
  const meR    = await fetch(`${FANVUE_API_BASE}/users/me`, { headers: fvH(accessToken) });
  const meBody = await safeJson(meR);
  if (!meR.ok) {
    if (meR.status === 401 || meR.status === 403)
      throw new Error(`API_ACCESS_DENIED: /users/me returned ${meR.status}. Your account needs API access. Email support@fanvue.com.`);
    throw new Error(`Token check failed (${meR.status}): ${JSON.stringify(meBody)}`);
  }
  dbgOk(`Authenticated as @${meBody.username ?? meBody.handle ?? "?"}`);
  rep(`Authenticated as @${meBody.username ?? meBody.handle ?? "?"}`);

  // 2. Upload media to Fanvue vault
  const mediaUuid = await uploadMediaToFanvue({
    accessToken,
    mediaUrl:  params.mediaUrl,
    mediaType: params.mediaType,
    onProgress,
  });

  // 3. Create the post with the uploaded mediaUuid
  const postUuid = await createFanvuePost({
    accessToken,
    mediaId:   mediaUuid,
    caption:   params.caption,
    audience:  params.audience,
    onProgress,
  });

  dbgOk("Published! 🎉", `postUuid=${postUuid}`);
  return postUuid;
}

// ─────────────────────────────────────────────────────────────────────────────
// Route
// ─────────────────────────────────────────────────────────────────────────────
function RouteErrorBoundary({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-6 text-center">
      <h2 className="font-display text-lg font-semibold">Scheduling couldn't load</h2>
      <p className="max-w-md text-sm text-muted-foreground">{error?.message ?? "Unknown error"}</p>
      <div className="flex gap-2">
        <button onClick={reset} className="rounded-md border border-input bg-background px-4 py-2 text-sm">Try again</button>
        <a href="/" className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">Go home</a>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/schedule")({
  head: () => ({
    meta: [
      { title: "Scheduling — Lila Studio" },
      { name: "description", content: "Schedule and publish content to Fanvue." },
    ],
  }),
  component: SchedulePage,
  errorComponent: RouteErrorBoundary,
});

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
type PublishStatus = "scheduled" | "publishing" | "published" | "failed";
type QueueStatus   = "waiting" | "ready" | "publishing" | "published" | "failed";
type ContentType   = "image" | "video";
type HistoryEvent  = { at: string; label: string; kind: string };
type ScheduledItem = {
  id:             string;
  contentName:    string;
  type:           ContentType;
  character:      string;
  thumbnail:      string;
  mediaUrl:       string;
  scheduledAt:    string;
  status:         PublishStatus;
  queueStatus:    QueueStatus;
  autoPublish:    boolean;
  externalPostId?: string;
  publishedAt?:   string;
  settings:       { fps: number; framesPerScene: number; numScenes: number; samplingSteps: number };
  scenePrompts:   string[];
  negativePrompt: string;
  history:        HistoryEvent[];
};

const EMPTY: ScheduledItem[] = [];
const PLACEHOLDER = "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=600&q=80";

// ─────────────────────────────────────────────────────────────────────────────
// Data fetchers
// ─────────────────────────────────────────────────────────────────────────────
async function fetchSchedules(): Promise<ScheduledItem[]> {
  const { data: rows, error } = await supabase.from("schedules").select("*").order("publish_time");
  if (error) throw error;

  const imageIds = (rows ?? []).filter((r: any) => r.content_type === "image").map((r: any) => r.content_id);
  const videoIds = (rows ?? []).filter((r: any) => r.content_type === "video").map((r: any) => r.content_id);

  const [imgRes, vidRes, charRes] = await Promise.all([
    imageIds.length
      ? supabase.from("images").select("id,image_url,prompt,character_id,published_at,external_post_id,publish_status").in("id", imageIds)
      : Promise.resolve({ data: [] } as any),
    videoIds.length
      ? supabase.from("videos").select("id,video_url,prompt,scene_prompts,character_id,published_at,external_post_id,publish_status").in("id", videoIds)
      : Promise.resolve({ data: [] } as any),
    supabase.from("characters").select("id,name,reference_image_url"),
  ]);

  const imgMap  = new Map((imgRes.data  ?? []).map((i: any) => [i.id, i]));
  const vidMap  = new Map((vidRes.data  ?? []).map((v: any) => [v.id, v]));
  const charMap = new Map((charRes.data ?? []).map((c: any) => [c.id, c]));

  return (rows ?? []).map((r: any): ScheduledItem => {
    const isVideo = r.content_type === "video";
    const src: any  = isVideo ? vidMap.get(r.content_id) : imgMap.get(r.content_id);
    const char: any = src?.character_id ? charMap.get(src.character_id) : null;
    const scenes: string[] = isVideo && Array.isArray(src?.scene_prompts)
      ? src.scene_prompts : src?.prompt ? [src.prompt] : [];
    const media = isVideo ? src?.video_url : src?.image_url;
    const thumb = char?.reference_image_url || media || PLACEHOLDER;
    const status: PublishStatus =
      r.status === "published" ? "published"
      : r.status === "failed"  ? "failed"
      : r.status === "publishing" ? "publishing"
      : "scheduled";
    const qs: QueueStatus =
      status === "published"  ? "published"
      : status === "failed"   ? "failed"
      : status === "publishing" ? "publishing"
      : new Date(r.publish_time) <= new Date() ? "ready" : "waiting";
    return {
      id: r.id,
      contentName: `${char?.name ?? "Lila"} — ${(scenes[0] ?? "Untitled").slice(0, 40)}`,
      type: r.content_type, character: char?.name ?? "Lila",
      thumbnail: thumb, mediaUrl: media || "",
      scheduledAt: r.publish_time, status, queueStatus: qs, autoPublish: true,
      externalPostId: src?.external_post_id ?? undefined,
      publishedAt:    src?.published_at ?? undefined,
      settings: { fps: 16, framesPerScene: 257, numScenes: scenes.length || 1, samplingSteps: 29 },
      scenePrompts: scenes,
      negativePrompt: "low quality, blurry, distorted face, watermark",
      history: [
        { at: r.created_at, label: `Scheduled for ${new Date(r.publish_time).toLocaleString()}`, kind: "scheduled" },
        ...(src?.published_at ? [{ at: src.published_at, label: "Published", kind: "published" }] : []),
      ],
    };
  });
}

async function fetchApprovedAssets() {
  const [imgRes, vidRes, charRes] = await Promise.all([
    supabase.from("images").select("id,image_url,prompt,character_id").eq("status", "approved"),
    supabase.from("videos").select("id,video_url,prompt,character_id").eq("status", "approved"),
    supabase.from("characters").select("id,name,reference_image_url"),
  ]);
  const charMap = new Map((charRes.data ?? []).map((c: any) => [c.id, c]));
  return [
    ...(imgRes.data ?? []).map((i: any) => ({
      id: i.id, type: "image" as const,
      name: `${charMap.get(i.character_id)?.name ?? "Lila"} — ${(i.prompt ?? "Image").slice(0, 40)}`,
      url: i.image_url ?? "", thumbnail: i.image_url ?? "",
    })),
    ...(vidRes.data ?? []).map((v: any) => ({
      id: v.id, type: "video" as const,
      name: `${charMap.get(v.character_id)?.name ?? "Lila"} — ${(v.prompt ?? "Video").slice(0, 40)}`,
      url: v.video_url ?? "", thumbnail: charMap.get(v.character_id)?.reference_image_url ?? "",
    })),
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Style helpers
// ─────────────────────────────────────────────────────────────────────────────
const SS: Record<PublishStatus, string> = {
  scheduled:  "bg-chart-2/15 text-chart-2 border-chart-2/30",
  publishing: "bg-primary/15 text-primary border-primary/30",
  published:  "bg-success/15 text-success border-success/30",
  failed:     "bg-destructive/15 text-destructive border-destructive/30",
};
const QSS: Record<QueueStatus, string> = {
  waiting:    "bg-muted text-muted-foreground border-border",
  ready:      "bg-chart-2/15 text-chart-2 border-chart-2/30",
  publishing: "bg-primary/15 text-primary border-primary/30",
  published:  "bg-success/15 text-success border-success/30",
  failed:     "bg-destructive/15 text-destructive border-destructive/30",
};
const LS: Record<LogLevel, string> = {
  info:    "text-muted-foreground",
  warn:    "text-yellow-500",
  error:   "text-destructive font-semibold",
  success: "text-green-500",
};
const fmtTime   = (s: string) => new Date(s).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const fmtDate   = (s: string) => new Date(s).toLocaleDateString([], { month: "short", day: "numeric" });
const fmtDT     = (s: string) => `${fmtDate(s)} · ${fmtTime(s)}`;
const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

function StatusBadge({ status }: { status: PublishStatus }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider", SS[status])}>
      {status === "publishing" && <Loader2 className="h-2.5 w-2.5 animate-spin" />}{status}
    </span>
  );
}
function QueueBadge({ status }: { status: QueueStatus }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider", QSS[status])}>{status}</span>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Debug panel — sticky bottom drawer
// ─────────────────────────────────────────────────────────────────────────────
function DebugPanel({ logs, onClear }: { logs: LogEntry[]; onClear: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const errCount = logs.filter(l => l.level === "error").length;
  useEffect(() => { if (open && ref.current) ref.current.scrollTop = 0; }, [open, logs.length]);
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 pointer-events-none">
      <div className="pointer-events-auto mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8">
        <div className={cn("rounded-t-xl border border-border/80 bg-card shadow-2xl transition-all duration-200", open ? "max-h-80" : "max-h-10")}>
          <button type="button" onClick={() => setOpen(o => !o)}
            className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-muted/40 rounded-t-xl">
            <Bug className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            <span className="text-xs font-medium text-muted-foreground">Publish Debug Log</span>
            {errCount > 0 && (
              <span className="rounded bg-destructive/15 border border-destructive/30 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">
                {errCount} error{errCount !== 1 ? "s" : ""}
              </span>
            )}
            {logs.length > 0 && errCount === 0 && (
              <span className="text-[10px] text-muted-foreground">{logs.length} entries</span>
            )}
            <div className="ml-auto flex items-center gap-2">
              {open && (
                <button type="button" onClick={e => { e.stopPropagation(); onClear(); }}
                  className="text-[10px] text-muted-foreground hover:text-foreground px-1">Clear</button>
              )}
              {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />}
            </div>
          </button>
          {open && (
            <div ref={ref} className="h-64 overflow-y-auto border-t border-border/60 bg-background/80 font-mono">
              {logs.length === 0
                ? <p className="p-4 text-xs text-muted-foreground">No entries yet. Click "Publish now" to see step-by-step output here.</p>
                : logs.map((l, i) => (
                  <div key={i} className="flex items-start gap-2 border-b border-border/30 px-3 py-1 last:border-0">
                    <span className="shrink-0 text-[10px] text-muted-foreground/60 tabular-nums pt-px">
                      {new Date(l.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </span>
                    <span className={cn("shrink-0 text-[10px] w-16", LS[l.level])}>[{l.level.toUpperCase()}]</span>
                    <div className="min-w-0 flex-1">
                      <span className={cn("text-[11px]", LS[l.level])}>{l.msg}</span>
                      {l.detail && <p className="mt-0.5 break-all text-[10px] text-muted-foreground/70">{l.detail}</p>}
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
// Manual "Post via URL" dialog — fallback while API access is being enabled
// ─────────────────────────────────────────────────────────────────────────────
function ManualPostDialog({ open, onOpenChange, items }: {
  open: boolean; onOpenChange: (o: boolean) => void; items: ScheduledItem[];
}) {
  const [selectedId, setSelectedId] = useState("");
  const [caption, setCaption]       = useState("");
  const [copied, setCopied]         = useState<"url" | "caption" | null>(null);

  useEffect(() => {
    if (open && items.length > 0 && !selectedId) setSelectedId(items[0].id);
  }, [open, items, selectedId]);

  const item           = items.find(i => i.id === selectedId) ?? items[0];
  const defaultCaption = item?.scenePrompts[0] ?? item?.contentName ?? "";

  const copyUrl = async () => {
    if (!item?.mediaUrl) { toast.error("No media URL for this item"); return; }
    await navigator.clipboard.writeText(item.mediaUrl);
    setCopied("url"); setTimeout(() => setCopied(null), 2000);
    toast.success("Media URL copied!");
  };
  const copyCaption = async () => {
    await navigator.clipboard.writeText(caption || defaultCaption);
    setCopied("caption"); setTimeout(() => setCopied(null), 2000);
    toast.success("Caption copied!");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-4 w-4" /> Post via URL — Manual Method
          </DialogTitle>
          <DialogDescription>
            Copy your media URL and paste it into Fanvue's upload dialog manually.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {/* Steps */}
          <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3 space-y-1.5">
            <p className="text-xs font-semibold text-blue-600">Steps to post manually:</p>
            <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
              <li>Select content below and copy the media URL</li>
              <li>Click <strong>Open Fanvue</strong> to go to post creation</li>
              <li>Upload the file from the URL (download it first if needed)</li>
              <li>Paste the caption and publish</li>
            </ol>
          </div>

          {/* Content selector */}
          <div className="space-y-1.5">
            <Label>Select content</Label>
            {items.length === 0
              ? <p className="text-xs text-muted-foreground p-3 border border-dashed border-border rounded-md">No scheduled items. Schedule content first.</p>
              : <Select value={selectedId} onValueChange={setSelectedId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{items.map(i => <SelectItem key={i.id} value={i.id}>{i.contentName}</SelectItem>)}</SelectContent>
                </Select>}
          </div>

          {/* Preview + URL */}
          {item && (
            <div className="space-y-2">
              <div className="relative aspect-video overflow-hidden rounded-lg bg-muted">
                {item.type === "video"
                  ? <video src={item.mediaUrl || item.thumbnail} controls playsInline className="h-full w-full object-cover" />
                  : <img src={item.mediaUrl || item.thumbnail} alt="" className="h-full w-full object-cover" />}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Media URL ({item.type})</Label>
                <div className="flex items-center gap-2">
                  <Input readOnly value={item.mediaUrl || "No URL — asset missing"} className="font-mono text-xs flex-1 bg-muted/40" />
                  <Button size="sm" variant="outline" className="gap-1.5 shrink-0 min-w-[90px]" onClick={copyUrl} disabled={!item.mediaUrl}>
                    {copied === "url" ? <CheckCircle className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied === "url" ? "Copied!" : "Copy URL"}
                  </Button>
                </div>
                {!item.mediaUrl && <p className="text-xs text-destructive">⚠ No media URL — check Supabase for this asset.</p>}
              </div>
            </div>
          )}

          {/* Caption */}
          <div className="space-y-1.5">
            <Label className="text-xs">Caption</Label>
            <Textarea
              value={caption || defaultCaption}
              onChange={e => setCaption(e.target.value)}
              rows={3} className="text-sm resize-none"
              placeholder="Caption for your Fanvue post…"
            />
            <Button size="sm" variant="ghost" className="gap-1.5 text-xs" onClick={copyCaption}>
              {copied === "caption" ? <CheckCircle className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
              {copied === "caption" ? "Copied!" : "Copy caption"}
            </Button>
          </div>

          <Button className="w-full gap-2" onClick={() => window.open("https://www.fanvue.com", "_blank")}>
            <ExternalLink className="h-4 w-4" /> Open Fanvue
          </Button>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Account dialog
// ─────────────────────────────────────────────────────────────────────────────
function AccountDialog({ open, onOpenChange, token, onDisconnect }: {
  open: boolean; onOpenChange: (o: boolean) => void;
  token: StoredToken | null; onDisconnect: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Fanvue Account</DialogTitle>
          <DialogDescription>Connect your Fanvue creator account to publish content from Lila Studio.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {token ? (
            <div className="flex items-center justify-between rounded-lg border border-border bg-card p-3">
              <div className="flex items-center gap-3">
                <div className="grid h-9 w-9 place-items-center rounded-full bg-primary/10 text-primary font-semibold text-sm">
                  {token.name.slice(0, 1).toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-medium">{token.name}</p>
                  <p className="text-xs text-muted-foreground">@{token.handle}</p>
                  {token.expiresAt && (
                    <p className={cn("text-[10px]", token.expiresAt < Date.now() ? "text-destructive" : "text-muted-foreground")}>
                      {token.expiresAt < Date.now() ? "⚠ Token expired — reconnect" : `Expires ${new Date(token.expiresAt).toLocaleDateString()}`}
                    </p>
                  )}
                  <div className="mt-1 flex flex-wrap gap-1">
                    {["read:self","read:media","write:media","write:post"].map(s => (
                      <span key={s} className="rounded bg-success/10 border border-success/30 px-1 py-0.5 text-[9px] text-success font-mono">{s}</span>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="gap-1 border-success/40 text-success text-xs">
                  <CheckCircle className="h-3 w-3" /> Connected
                </Badge>
                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive text-xs" onClick={onDisconnect}>
                  Disconnect
                </Button>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-muted/30 p-6 text-center">
              <Plug className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-2 text-sm font-medium">No account connected</p>
              <p className="mt-1 text-xs text-muted-foreground">Connect your Fanvue creator account to start publishing.</p>
            </div>
          )}

          {/* API waitlist notice */}
          <div className="rounded-lg border border-orange-500/30 bg-orange-500/5 p-3">
            <p className="text-xs font-semibold text-orange-600 mb-1">⏳ API Access — Waitlisted</p>
            <p className="text-xs text-muted-foreground mb-1">
              OAuth scopes <code className="bg-muted px-1 rounded text-[10px]">write:media write:post</code> are granted,
              but <strong>write:media</strong> and <strong>write:post</strong> calls may return 403 until Fanvue whitelists your account for API access.
            </p>
            <p className="text-xs text-muted-foreground">
              Go to <strong>Creator Tools → Build</strong> on Fanvue, or email{" "}
              <a href="mailto:support@fanvue.com" className="underline text-orange-600">support@fanvue.com</a>.
            </p>
          </div>

          <div className="rounded-lg border border-border bg-muted/20 p-4">
            <p className="text-xs font-medium mb-1">{token ? "Reconnect account" : "Connect a new account"}</p>
            <p className="text-xs text-muted-foreground mb-3">
              Redirects to Fanvue OAuth. Token is saved locally in browser — no server needed.
            </p>
            <Button className="w-full gap-2" onClick={() => { onOpenChange(false); startFanvueOAuth(); }}>
              <ExternalLink className="h-4 w-4" /> {token ? "Reconnect Fanvue" : "Connect Fanvue Account"}
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SchedulePage — main component
// KEY FIX: Token is read from localStorage (survives hard page reload from
// OAuth redirect). State is initialised from localStorage synchronously so
// the UI never flickers/blanks after reconnecting.
// ─────────────────────────────────────────────────────────────────────────────
function SchedulePage() {
  const queryClient = useQueryClient();
  const { data: scheduleData = EMPTY } = useQuery({
    queryKey: ["schedules"], queryFn: fetchSchedules, staleTime: 10_000,
  });

  // ── Token state: initialised synchronously from localStorage ─────────────
  // This is why UI doesn't blank — even on fresh page load after OAuth
  // redirect, loadToken() immediately returns the saved token.
  const [fanvueToken, setFanvueToken] = useState<StoredToken | null>(() => loadToken());
  const [items,       setItems]       = useState<ScheduledItem[]>([]);
  const [audience,    setAudience]    = useState<"subscribers" | "followers-and-subscribers">("followers-and-subscribers");
  const { logs, clearLogs }           = useDebugLog();

  useEffect(() => setItems(scheduleData), [scheduleData]);

  // ── OAuth callback handler ────────────────────────────────────────────────
  // Runs once on mount. If ?code= is in URL, we're back from Fanvue OAuth.
  // localStorage already has PKCE verifier (we switched from sessionStorage).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code   = params.get("code");
    const state  = params.get("state") ?? "";
    const err    = params.get("error");

    if (err) {
      window.history.replaceState({}, "", window.location.pathname);
      dbgE("OAuth error", params.get("error_description") ?? err);
      toast.error(`Fanvue auth error: ${params.get("error_description") ?? err}`);
      return;
    }

    if (!code) {
      // Normal page load — token already loaded from localStorage in useState init
      const existing = loadToken();
      if (existing) {
        setFanvueToken(existing);
        dbg("Token loaded from localStorage", `@${existing.handle}`);
      }
      return;
    }

    // We have an OAuth code — clean URL immediately to prevent double-processing
    window.history.replaceState({}, "", window.location.pathname);
    dbg("OAuth code received, exchanging…");
    toast.loading("Connecting Fanvue account…", { id: "fv-connect" });

    exchangeFanvueCode(code, state)
      .then(t => {
        setFanvueToken(t);  // update React state so UI refreshes
        toast.success(`✅ Connected as ${t.name} (@${t.handle})!`, {
          id: "fv-connect", duration: 10_000,
          description: "Scopes: read:self, read:media, write:media, write:post",
        });
      })
      .catch(e => {
        dbgE("OAuth exchange failed", e.message);
        toast.error(e.message ?? "Failed to connect Fanvue", { id: "fv-connect", duration: 12_000 });
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Realtime schedule subscription ───────────────────────────────────────
  useEffect(() => {
    const ch = supabase.channel("schedules-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "schedules" }, () =>
        queryClient.invalidateQueries({ queryKey: ["schedules"] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [queryClient]);

  const [tab,          setTab]          = useState("calendar");
  const [search,       setSearch]       = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | PublishStatus>("all");
  const [rangeFilter,  setRangeFilter]  = useState<"all" | "today" | "week" | "month">("all");
  const [selected,     setSelected]     = useState<ScheduledItem | null>(null);
  const [createOpen,   setCreateOpen]   = useState(false);
  const [accountOpen,  setAccountOpen]  = useState(false);
  const [manualOpen,   setManualOpen]   = useState(false);
  const [weekStart,    setWeekStart]    = useState(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - d.getDay()); return d;
  });

  const stats = useMemo(() => {
    const now = new Date(); const wa = new Date(now); wa.setDate(wa.getDate() - 7);
    return {
      scheduled:     items.filter(i => i.status === "scheduled").length,
      todayCount:    items.filter(i => i.status === "scheduled" && isSameDay(new Date(i.scheduledAt), now)).length,
      weekPublished: items.filter(i => i.status === "published" && i.publishedAt && new Date(i.publishedAt) >= wa).length,
      failed:        items.filter(i => i.status === "failed").length,
    };
  }, [items]);

  const filteredItems = useMemo(() => {
    const now = new Date();
    return items.filter(i => {
      if (statusFilter !== "all" && i.status !== statusFilter) return false;
      if (rangeFilter !== "all") {
        const d = new Date(i.scheduledAt);
        if (rangeFilter === "today" && !isSameDay(d, now)) return false;
        if (rangeFilter === "week") {
          const wk = new Date(now); wk.setDate(wk.getDate() + 7);
          if (d < now || d > wk) return false;
        }
        if (rangeFilter === "month" && (d.getMonth() !== now.getMonth() || d.getFullYear() !== now.getFullYear())) return false;
      }
      if (search.trim()) {
        const q = search.toLowerCase();
        if (![i.contentName, i.character].join(" ").toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [items, statusFilter, rangeFilter, search]);

  const updateItem = useCallback((id: string, patch: Partial<ScheduledItem>) =>
    setItems(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i)), []);

  const removeItem = async (id: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
    setSelected(null);
    try {
      const { error } = await supabase.from("schedules").delete().eq("id", id);
      if (error) throw error;
      toast.success("Schedule removed");
      queryClient.invalidateQueries({ queryKey: ["schedules"] });
    } catch (e: any) { toast.error(e?.message ?? "Failed to remove"); }
  };

  const retryPublish = async (id: string) => {
    updateItem(id, { status: "scheduled", queueStatus: "ready" });
    try {
      await scheduleService.update(id, { status: "scheduled" });
      toast.success("Queued for retry");
    } catch (e: any) { toast.error(e?.message ?? "Failed to retry"); }
  };

  // ── PUBLISH NOW ───────────────────────────────────────────────────────────
  const publishNow = async (id: string) => {
    const item = items.find(i => i.id === id);
    if (!item) return;

    // Always get a fresh (possibly refreshed) token from localStorage
    const token = await getValidToken();
    if (!token?.accessToken) {
      dbgE("No token in localStorage");
      toast.error("No Fanvue account connected.", {
        action: { label: "Connect", onClick: () => setAccountOpen(true) }, duration: 8000,
      });
      return;
    }
    if (!item.mediaUrl) {
      dbgE("No mediaUrl", `id=${id} type=${item.type}`);
      toast.error("No media URL for this item. Check Supabase.");
      return;
    }

    dbg(`Publishing item ${id}`, `type=${item.type} mediaUrl=${item.mediaUrl}`);
    const toastId = `pub-${id}`;
    updateItem(id, { status: "publishing", queueStatus: "publishing" });
    toast.loading("Starting Fanvue publish…", { id: toastId, duration: Infinity });

    try {
      const postUuid = await publishToFanvue({
        accessToken: token.accessToken,
        mediaUrl:    item.mediaUrl,
        mediaType:   item.type,
        caption:     item.scenePrompts[0] ?? item.contentName,
        audience,
        onProgress:  s => toast.loading(s, { id: toastId, duration: Infinity }),
      });

      const now   = new Date().toISOString();
      const table = item.type === "image" ? "images" : "videos";

      // Update Supabase records
      const { data: sched } = await supabase.from("schedules").select("content_id").eq("id", id).single();
      if (sched?.content_id) {
        const r = await supabase.from(table).update({
          publish_status:   "published",
          published_at:     now,
          external_post_id: postUuid,
        }).eq("id", sched.content_id);
        if (r.error) dbgW("Supabase asset update failed", r.error.message);
        else dbgOk("Supabase asset updated");
      }
      await scheduleService.update(id, { status: "published" });

      updateItem(id, {
        status: "published", queueStatus: "published",
        externalPostId: postUuid, publishedAt: now,
        history: [...item.history, { at: now, label: `Published to @${token.handle}`, kind: "published" }],
      });

      toast.success(`✅ Published to @${token.handle}!`, {
        id: toastId, duration: 12_000,
        description: `Post UUID: ${postUuid}`,
        action: { label: "View on Fanvue", onClick: () => window.open(`https://www.fanvue.com/post/${postUuid}`, "_blank") },
      });
      queryClient.invalidateQueries({ queryKey: ["schedules"] });

    } catch (e: any) {
      const msg      = e?.message ?? "Unknown error";
      const isGated  = msg.startsWith("API_ACCESS_DENIED:");
      dbgE("Publish FAILED", msg);
      updateItem(id, {
        status: "failed", queueStatus: "failed",
        history: [...item.history, { at: new Date().toISOString(), label: `Failed: ${msg.slice(0, 120)}`, kind: "failed" }],
      });
      try { await scheduleService.update(id, { status: "failed" }); } catch { /* ignore */ }

      if (isGated) {
        toast.error("Fanvue API access not yet granted", {
          id: toastId, duration: 20_000,
          description: "Your account is on the waitlist. Use 'Post via URL' to post manually now.",
          action: { label: "Post via URL", onClick: () => setManualOpen(true) },
        });
      } else {
        toast.error("Publish failed — see debug log", { id: toastId, duration: 20_000, description: msg.slice(0, 200) });
      }
    }
  };

  const [dragId, setDragId] = useState<string | null>(null);
  const onDropOnDay = async (day: Date) => {
    if (!dragId) return;
    const item = items.find(i => i.id === dragId); if (!item) return;
    const old = new Date(item.scheduledAt); const nd = new Date(day);
    nd.setHours(old.getHours(), old.getMinutes(), 0, 0);
    const iso = nd.toISOString();
    updateItem(dragId, { scheduledAt: iso });
    try { await scheduleService.update(dragId, { publish_time: iso }); toast.success("Schedule updated"); }
    catch (e: any) { toast.error(e?.message ?? "Failed to update"); }
    setDragId(null);
  };

  const connected = !!fanvueToken;

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <AppHeader />
        <main className="flex-1 overflow-y-auto bg-background pb-14">
          <div className="mx-auto max-w-[1400px] space-y-6 p-4 sm:p-6 lg:p-8">

            {/* ── Header ─────────────────────────────────────────────────── */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <Link to="/" className="mb-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
                  <ArrowLeft className="h-3.5 w-3.5" /> Dashboard
                </Link>
                <h1 className="font-display text-3xl font-semibold tracking-tight">Scheduling</h1>
                <p className="mt-1 text-sm text-muted-foreground">Plan, queue and publish approved content to your Fanvue account.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {/* Post via URL — always visible */}
                <Button
                  variant="outline" size="sm"
                  className="gap-2 border-dashed border-primary/50 text-primary hover:text-primary"
                  onClick={() => setManualOpen(true)}
                >
                  <Link2 className="h-4 w-4" /> Post via URL
                </Button>
                {/* Account / connection button */}
                <Button variant="outline" size="sm" className="gap-2" onClick={() => setAccountOpen(true)}>
                  <Plug className="h-4 w-4" />
                  {connected
                    ? <span className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-success" />
                        <span className="max-w-[130px] truncate font-medium">{fanvueToken!.name}</span>
                        <span className="text-muted-foreground text-xs">@{fanvueToken!.handle}</span>
                      </span>
                    : "Connect Fanvue"}
                </Button>
                <Button size="sm" className="gap-2" onClick={() => setCreateOpen(true)}>
                  <CalendarPlus className="h-4 w-4" /> Schedule content
                </Button>
              </div>
            </div>

            {/* ── Not connected warning ─────────────────────────────────── */}
            {!connected && (
              <div className="flex items-center gap-3 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3">
                <AlertTriangle className="h-4 w-4 flex-shrink-0 text-warning" />
                <p className="flex-1 text-sm">No Fanvue account connected. Connect to enable auto-publish.</p>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setAccountOpen(true)}>
                  <ExternalLink className="h-3.5 w-3.5" /> Connect now
                </Button>
              </div>
            )}

            {/* ── API waitlist info banner ──────────────────────────────── */}
            {connected && (
              <div className="flex items-start gap-3 rounded-lg border border-orange-500/30 bg-orange-500/5 px-4 py-3">
                <Info className="h-4 w-4 flex-shrink-0 text-orange-500 mt-0.5" />
                <div className="flex-1 min-w-0 space-y-1">
                  <p className="text-sm font-semibold text-orange-600">
                    OAuth connected as {fanvueToken!.name} (@{fanvueToken!.handle}) ✓
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Scopes <code className="bg-muted px-1 rounded text-[10px]">write:media write:post</code> are granted.
                    Auto-publish will work once Fanvue enables API access for your creator account.
                    Until then use <strong>Post via URL</strong> to post manually.
                    Contact <a href="mailto:support@fanvue.com" className="underline text-orange-600">support@fanvue.com</a> or go to <strong>Creator Tools → Build</strong>.
                  </p>
                </div>
                <Button
                  size="sm" variant="outline"
                  className="gap-1.5 shrink-0 border-orange-500/40 text-orange-600 hover:text-orange-700"
                  onClick={() => setManualOpen(true)}
                >
                  <Link2 className="h-3.5 w-3.5" /> Post via URL
                </Button>
              </div>
            )}

            {/* ── Stats ────────────────────────────────────────────────── */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <DashboardCard label="Scheduled posts"     value={stats.scheduled}    icon={CalendarClock} accent="primary"  hint="Awaiting publish" />
              <DashboardCard label="Publishing today"    value={stats.todayCount}   icon={Clock}         accent="chart-2"  hint="Next 24h" />
              <DashboardCard label="Published this week" value={stats.weekPublished} icon={CheckCircle2}  accent="chart-3" />
              <DashboardCard label="Failed"              value={stats.failed}        icon={AlertTriangle} accent="chart-5"  hint={stats.failed ? "Needs attention" : "All clear"} />
            </div>

            {/* ── Filters ──────────────────────────────────────────────── */}
            <Card className="border-border/60 bg-card">
              <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
                <div className="flex items-center gap-2 shrink-0">
                  <Label className="text-xs text-muted-foreground whitespace-nowrap">Audience:</Label>
                  <Select value={audience} onValueChange={v => setAudience(v as any)}>
                    <SelectTrigger className="h-8 w-[210px] text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="followers-and-subscribers">Followers & Subscribers</SelectItem>
                      <SelectItem value="subscribers">Subscribers only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
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

            {/* ── Views ────────────────────────────────────────────────── */}
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                <TabsTrigger value="calendar">Calendar</TabsTrigger>
                <TabsTrigger value="queue">Publishing Queue</TabsTrigger>
                <TabsTrigger value="history">History</TabsTrigger>
              </TabsList>
              <TabsContent value="calendar" className="mt-4">
                <CalendarView
                  weekStart={weekStart} setWeekStart={setWeekStart} items={filteredItems}
                  onOpen={setSelected} onDragStart={setDragId}
                  onDropOnDay={onDropOnDay} onSchedule={() => setCreateOpen(true)} />
              </TabsContent>
              <TabsContent value="queue" className="mt-4">
                <QueueView
                  items={filteredItems.filter(i => ["scheduled", "publishing", "failed"].includes(i.status))}
                  onOpen={setSelected} onCancel={removeItem} onPublishNow={publishNow}
                  onRetry={retryPublish} onManualPost={() => setManualOpen(true)}
                  onSchedule={() => setCreateOpen(true)} />
              </TabsContent>
              <TabsContent value="history" className="mt-4">
                <HistoryView
                  items={filteredItems.filter(i => ["published", "failed"].includes(i.status))}
                  onOpen={setSelected} onRetry={retryPublish} />
              </TabsContent>
            </Tabs>
          </div>
        </main>
      </SidebarInset>

      <DetailSheet
        item={selected} onClose={() => setSelected(null)}
        fanvueToken={fanvueToken} onRetry={retryPublish}
        onPublishNow={publishNow} onRemove={removeItem}
        onManualPost={() => setManualOpen(true)} />
      <CreateScheduleDialog open={createOpen} onOpenChange={setCreateOpen} fanvueToken={fanvueToken} />
      <AccountDialog open={accountOpen} onOpenChange={setAccountOpen} token={fanvueToken}
        onDisconnect={() => { clearToken(); setFanvueToken(null); toast.success("Fanvue account disconnected"); }} />
      <ManualPostDialog
        open={manualOpen} onOpenChange={setManualOpen}
        items={items.filter(i => i.status !== "published")} />
      <DebugPanel logs={logs} onClear={clearLogs} />
    </SidebarProvider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CalendarView
// ─────────────────────────────────────────────────────────────────────────────
function CalendarView({ weekStart, setWeekStart, items, onOpen, onDragStart, onDropOnDay, onSchedule }: {
  weekStart: Date; setWeekStart: (d: Date) => void; items: ScheduledItem[];
  onOpen: (i: ScheduledItem) => void; onDragStart: (id: string | null) => void;
  onDropOnDay: (d: Date) => void; onSchedule: () => void;
}) {
  const days = Array.from({ length: 7 }).map((_, i) => { const d = new Date(weekStart); d.setDate(d.getDate() + i); return d; });
  const move = (delta: number) => { const d = new Date(weekStart); d.setDate(d.getDate() + delta * 7); setWeekStart(d); };
  const today = new Date();
  const byDay = (day: Date) =>
    items.filter(i => isSameDay(new Date(i.scheduledAt), day)).sort((a, b) => +new Date(a.scheduledAt) - +new Date(b.scheduledAt));
  return (
    <Card className="border-border/60 bg-card">
      <CardContent className="p-4">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="font-display text-lg font-semibold">{weekStart.toLocaleDateString([], { month: "long", year: "numeric" })}</p>
            <p className="text-xs text-muted-foreground">Week of {fmtDate(weekStart.toISOString())} — drag cards to reschedule</p>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => move(-1)}><ChevronLeft className="h-4 w-4" /></Button>
            <Button variant="outline" size="sm" className="h-8" onClick={() => {
              const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - d.getDay()); setWeekStart(d);
            }}>Today</Button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => move(1)}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
        {items.length === 0 ? <EmptyState onSchedule={onSchedule} /> : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-7">
            {days.map(day => {
              const di = byDay(day); const isToday = isSameDay(day, today);
              return (
                <div key={day.toISOString()}
                  onDragOver={e => e.preventDefault()} onDrop={() => onDropOnDay(day)}
                  className="flex min-h-[260px] flex-col rounded-lg border border-border/60 bg-background/40 p-2 hover:border-primary/40 transition-colors">
                  <div className="mb-2 flex items-baseline justify-between px-1">
                    <p className={cn("text-[10px] font-medium uppercase tracking-wider", isToday ? "text-primary" : "text-muted-foreground")}>
                      {day.toLocaleDateString([], { weekday: "short" })}
                    </p>
                    <p className={cn("font-display text-lg font-semibold", isToday ? "text-primary" : "text-foreground")}>{day.getDate()}</p>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {di.map(i => (
                      <button key={i.id} type="button" draggable onDragStart={() => onDragStart(i.id)} onClick={() => onOpen(i)}
                        className="group flex flex-col gap-1.5 rounded-md border border-border/60 bg-card p-1.5 text-left hover:border-primary/50 transition-colors">
                        <div className="relative h-16 w-full overflow-hidden rounded">
                          <img src={i.thumbnail} alt="" className="h-full w-full object-cover" />
                          <div className="absolute left-1 top-1 grid h-5 w-5 place-items-center rounded bg-black/60">
                            {i.type === "video" ? <VideoIcon className="h-3 w-3 text-white" /> : <ImageIcon className="h-3 w-3 text-white" />}
                          </div>
                          <div className="absolute right-1 top-1"><StatusBadge status={i.status} /></div>
                        </div>
                        <div className="px-0.5">
                          <p className="truncate text-xs font-medium">{i.character}</p>
                          <p className="text-[10px] text-muted-foreground">{fmtTime(i.scheduledAt)}</p>
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

// ─────────────────────────────────────────────────────────────────────────────
// QueueView
// ─────────────────────────────────────────────────────────────────────────────
function QueueView({ items, onOpen, onCancel, onPublishNow, onRetry, onManualPost, onSchedule }: {
  items: ScheduledItem[]; onOpen: (i: ScheduledItem) => void; onCancel: (id: string) => void;
  onPublishNow: (id: string) => void; onRetry: (id: string) => void;
  onManualPost: () => void; onSchedule: () => void;
}) {
  if (items.length === 0) return (
    <Card className="border-border/60 bg-card">
      <CardContent className="p-4"><EmptyState onSchedule={onSchedule} message="Publishing queue is empty." /></CardContent>
    </Card>
  );
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
              <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />{fmtDT(i.scheduledAt)}
              </p>
              {!i.mediaUrl && <p className="mt-1 text-[10px] text-destructive">⚠ No media URL — asset missing in Supabase</p>}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {i.status === "failed"
                ? <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onRetry(i.id)}>
                    <RefreshCw className="h-3.5 w-3.5" /> Retry
                  </Button>
                : <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onPublishNow(i.id)}
                    disabled={i.status === "publishing" || !i.mediaUrl}>
                    {i.status === "publishing" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                    {i.status === "publishing" ? "Publishing…" : "Auto-publish"}
                  </Button>}
              <Button size="sm" variant="outline" className="gap-1.5 text-primary border-primary/40" onClick={onManualPost}>
                <Link2 className="h-3.5 w-3.5" /> Post via URL
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon" variant="ghost" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => onOpen(i)}><Eye className="mr-2 h-4 w-4" /> View details</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => onCancel(i.id)} className="text-destructive focus:text-destructive">
                    <Trash2 className="mr-2 h-4 w-4" /> Cancel
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HistoryView
// ─────────────────────────────────────────────────────────────────────────────
function HistoryView({ items, onOpen, onRetry }: {
  items: ScheduledItem[]; onOpen: (i: ScheduledItem) => void; onRetry: (id: string) => void;
}) {
  if (items.length === 0) return (
    <Card className="border-border/60 bg-card">
      <CardContent className="p-10 text-center">
        <Inbox className="mx-auto h-10 w-10 text-muted-foreground/60" />
        <p className="mt-3 font-medium">No publishing history yet</p>
        <p className="mt-1 text-sm text-muted-foreground">Published and failed posts appear here.</p>
      </CardContent>
    </Card>
  );
  return (
    <Card className="border-border/60 bg-card">
      <CardContent className="p-0">
        <div className="grid grid-cols-12 gap-3 border-b border-border/60 px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          <div className="col-span-6">Content</div>
          <div className="col-span-3">Publish date</div>
          <div className="col-span-2">Post ID</div>
          <div className="col-span-1 text-right">Status</div>
        </div>
        {items.map(i => (
          <button key={i.id} type="button" onClick={() => onOpen(i)}
            className="grid w-full grid-cols-12 items-center gap-3 border-b border-border/40 px-4 py-3 text-left hover:bg-muted/40 last:border-b-0 transition-colors">
            <div className="col-span-6 flex items-center gap-3">
              <div className="relative h-12 w-16 shrink-0 overflow-hidden rounded">
                <img src={i.thumbnail} alt="" className="h-full w-full object-cover" />
                {i.type === "video" && <div className="absolute inset-0 grid place-items-center bg-black/30"><Play className="h-3.5 w-3.5 text-white" /></div>}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{i.contentName}</p>
                <p className="truncate text-xs text-muted-foreground">{i.character}</p>
              </div>
            </div>
            <div className="col-span-3 text-xs text-muted-foreground">{i.publishedAt ? fmtDT(i.publishedAt) : fmtDT(i.scheduledAt)}</div>
            <div className="col-span-2">
              {i.externalPostId
                ? <a href={`https://www.fanvue.com/post/${i.externalPostId}`} target="_blank" rel="noopener noreferrer"
                    className="truncate font-mono text-[11px] text-primary hover:underline flex items-center gap-1"
                    onClick={e => e.stopPropagation()}>
                    {i.externalPostId.slice(0, 10)}… <ExternalLink className="h-3 w-3 flex-shrink-0" />
                  </a>
                : <span className="font-mono text-[11px] text-muted-foreground">—</span>}
            </div>
            <div className="col-span-1 flex items-center justify-end gap-2">
              <StatusBadge status={i.status} />
              {i.status === "failed" && (
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={e => { e.stopPropagation(); onRetry(i.id); }}>
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </button>
        ))}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EmptyState
// ─────────────────────────────────────────────────────────────────────────────
function EmptyState({ onSchedule, message = "No scheduled content." }: { onSchedule: () => void; message?: string }) {
  return (
    <div className="mx-auto max-w-md py-10 text-center">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-border/60 bg-background">
        <CalendarClock className="h-6 w-6 text-muted-foreground" />
      </div>
      <p className="mt-4 font-display text-lg font-semibold">{message}</p>
      <p className="mt-1 text-sm text-muted-foreground">Pick an approved asset and schedule it to your Fanvue account.</p>
      <Button size="sm" className="mt-5 gap-2" onClick={onSchedule}><CalendarPlus className="h-4 w-4" /> Schedule content</Button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DetailSheet
// ─────────────────────────────────────────────────────────────────────────────
function DetailSheet({ item, onClose, fanvueToken, onRetry, onPublishNow, onRemove, onManualPost }: {
  item: ScheduledItem | null; onClose: () => void; fanvueToken: StoredToken | null;
  onRetry: (id: string) => void; onPublishNow: (id: string) => void;
  onRemove: (id: string) => void; onManualPost: () => void;
}) {
  const [urlCopied, setUrlCopied] = useState(false);
  return (
    <Sheet open={!!item} onOpenChange={o => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {item && (<>
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              {item.contentName} <StatusBadge status={item.status} />
            </SheetTitle>
            <SheetDescription>{item.character} · {item.type} · {fmtDT(item.scheduledAt)}</SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-6">
            {/* Preview */}
            <div className="relative aspect-video overflow-hidden rounded-lg bg-muted">
              {item.type === "video"
                ? <video src={item.mediaUrl || item.thumbnail} controls playsInline className="h-full w-full object-cover" />
                : <img src={item.mediaUrl || item.thumbnail} alt="" className="h-full w-full object-cover" />}
            </div>
            {/* Meta fields */}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Scheduled"         value={fmtDT(item.scheduledAt)} />
              <Field label="Connected account"  value={fanvueToken ? `${fanvueToken.name} (@${fanvueToken.handle})` : "Not connected"} />
              <Field label="Media"              value={item.mediaUrl ? "✓ Available" : "✗ Missing"} />
              <Field label="Review status"      value="Approved" />
            </div>
            {/* No media warning */}
            {!item.mediaUrl && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
                <AlertTriangle className="h-4 w-4 text-destructive mt-px flex-shrink-0" />
                <p className="text-xs text-destructive">
                  No media URL — check the {item.type === "image" ? "image_url" : "video_url"} column in Supabase for this record.
                </p>
              </div>
            )}
            {/* Copyable media URL */}
            {item.mediaUrl && (
              <div className="space-y-1.5">
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Media URL (copy for manual posting)</p>
                <div className="flex items-center gap-2">
                  <Input readOnly value={item.mediaUrl} className="font-mono text-xs bg-muted/40 flex-1" />
                  <Button size="sm" variant="outline" className="shrink-0 gap-1.5" onClick={async () => {
                    await navigator.clipboard.writeText(item.mediaUrl);
                    setUrlCopied(true); setTimeout(() => setUrlCopied(false), 2000);
                    toast.success("URL copied!");
                  }}>
                    {urlCopied ? <CheckCircle className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                    {urlCopied ? "Copied!" : "Copy"}
                  </Button>
                </div>
              </div>
            )}
            {/* Published post link */}
            {item.externalPostId && (
              <div className="rounded-md border border-border bg-background/40 p-3">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Fanvue Post UUID</p>
                <p className="mt-1 font-mono text-xs break-all">{item.externalPostId}</p>
                <a href={`https://www.fanvue.com/post/${item.externalPostId}`} target="_blank" rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1.5 text-xs text-primary hover:underline">
                  <ExternalLink className="h-3 w-3" /> View on Fanvue
                </a>
              </div>
            )}
            {/* Scene prompts */}
            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Scene prompts</p>
              <ScrollArea className="h-32 rounded-md border border-border bg-background/40 p-3">
                <ol className="space-y-2 text-xs">
                  {item.scenePrompts.map((p, idx) => (
                    <li key={idx} className="leading-relaxed"><span className="mr-1 text-muted-foreground">{idx + 1}.</span>{p}</li>
                  ))}
                </ol>
              </ScrollArea>
            </div>
            {/* History timeline */}
            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">History</p>
              <ol className="relative space-y-3 border-l border-border pl-4">
                {item.history.map((h, idx) => (
                  <li key={idx} className="relative">
                    <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-primary ring-4 ring-background" />
                    <p className="text-xs font-medium">{h.label}</p>
                    <p className="text-[11px] text-muted-foreground">{fmtDT(h.at)}</p>
                  </li>
                ))}
              </ol>
            </div>
            <Separator />
            {/* Action buttons */}
            <div className="flex flex-wrap items-center gap-2">
              {item.status === "failed"
                ? <Button size="sm" className="gap-2" onClick={() => onRetry(item.id)}>
                    <RefreshCw className="h-4 w-4" /> Retry auto-publish
                  </Button>
                : item.status !== "published"
                  ? <Button size="sm" className="gap-2" onClick={() => onPublishNow(item.id)}
                      disabled={item.status === "publishing" || !item.mediaUrl || !fanvueToken}>
                      {item.status === "publishing" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                      {item.status === "publishing" ? "Publishing…" : "Auto-publish to Fanvue"}
                    </Button>
                  : null}
              <Button size="sm" variant="outline" className="gap-2 text-primary border-primary/40" onClick={onManualPost}>
                <Link2 className="h-4 w-4" /> Post via URL
              </Button>
              <Button size="sm" variant="outline" className="gap-2 text-destructive hover:text-destructive" onClick={() => onRemove(item.id)}>
                <Trash2 className="h-4 w-4" /> Remove
              </Button>
            </div>
          </div>
        </>)}
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-md border border-border bg-background/40 p-3">
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-sm", mono && "font-mono text-xs break-all")}>{value}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CreateScheduleDialog
// ─────────────────────────────────────────────────────────────────────────────
function CreateScheduleDialog({ open, onOpenChange, fanvueToken }: {
  open: boolean; onOpenChange: (o: boolean) => void; fanvueToken: StoredToken | null;
}) {
  const queryClient = useQueryClient();
  const { data: assets = [] } = useQuery({ queryKey: ["approved-assets"], queryFn: fetchApprovedAssets, enabled: open });
  const [contentIdx, setContentIdx] = useState("0");
  const [date, setDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); });
  const [time, setTime] = useState("18:00");

  const submit = async () => {
    const asset = assets[Number(contentIdx)];
    if (!asset) { toast.error("Pick an approved asset first"); return; }
    const iso = new Date(`${date}T${time}:00`).toISOString();
    try {
      const { data: userRes } = await supabase.auth.getUser();
      await scheduleService.create({
        content_type: asset.type, content_id: asset.id, publish_time: iso,
        platform: "Fanvue", status: "scheduled", created_by: userRes.user?.id ?? null,
      } as any);
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
              ? <p className="rounded-md border border-dashed border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                  No approved content yet. Approve items in Review Queue first.
                </p>
              : <Select value={contentIdx} onValueChange={setContentIdx}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{assets.map((a, idx) => <SelectItem key={a.id} value={String(idx)}>{a.name}</SelectItem>)}</SelectContent>
                </Select>}
          </div>
          <div className="space-y-1.5">
            <Label>Publishing account</Label>
            {fanvueToken
              ? <div className="flex items-center gap-2 rounded-md border border-border bg-card/50 px-3 py-2">
                  <span className="h-2 w-2 rounded-full bg-success flex-shrink-0" />
                  <span className="text-sm font-medium">{fanvueToken.name}</span>
                  <span className="text-xs text-muted-foreground">@{fanvueToken.handle}</span>
                </div>
              : <div className="rounded-md border border-dashed border-border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground mb-2">No Fanvue account connected yet.</p>
                  <Button size="sm" className="gap-2 w-full" onClick={() => { onOpenChange(false); startFanvueOAuth(); }}>
                    <ExternalLink className="h-3.5 w-3.5" /> Connect Fanvue Account
                  </Button>
                </div>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Date</Label><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Time</Label><Input type="time" value={time} onChange={e => setTime(e.target.value)} /></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} className="gap-2" disabled={!assets.length || !fanvueToken}>
            <CalendarPlus className="h-4 w-4" /> Schedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
