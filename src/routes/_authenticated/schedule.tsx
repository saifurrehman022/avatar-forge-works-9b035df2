
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { scheduleService } from "@/services";
import {
  CalendarClock, CalendarPlus, CheckCircle2, Clock, Search,
  Image as ImageIcon, Video as VideoIcon, Play, ArrowLeft, Send,
  Filter, Inbox, ChevronLeft, ChevronRight, MoreHorizontal,
  Trash2, Eye, RefreshCw, Link2, AlertTriangle,
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
// Fanvue config  (per official API docs: https://api.fanvue.com/docs)
// ─────────────────────────────────────────────────────────────────────────────
const FV_CLIENT_ID     = "f9d35fff-3d12-4dd5-8945-750c37d65ae9";
const FV_CLIENT_SECRET = "05275891c81581c5cb79d336c8e9f87680f0976843bf17d6737bdcf0dde38b1a";
const FV_REDIRECT_URI  = "https://avatar-forge-works-9b035df2-j56ivc6di-saifurrehman022s-projects.vercel.app/schedule";
const FV_AUTH_URL      = "https://auth.fanvue.com/oauth2/auth";
const FV_TOKEN_URL     = "https://auth.fanvue.com/oauth2/token";
const FV_API           = "https://api.fanvue.com";
// Required on every request per docs
const FV_VERSION       = "2025-06-26";

const fvH = (token: string, extra?: Record<string, string>) => ({
  Authorization: `Bearer ${token}`,
  "X-Fanvue-API-Version": FV_VERSION,
  ...extra,
});

// ─────────────────────────────────────────────────────────────────────────────
// Debug log
// ─────────────────────────────────────────────────────────────────────────────
type LogLevel = "info" | "warn" | "error" | "ok";
type LogEntry = { at: number; level: LogLevel; msg: string; detail?: string };
let _logCbs: Array<(e: LogEntry) => void> = [];
const log = (level: LogLevel, msg: string, detail?: string) => {
  const e: LogEntry = { at: Date.now(), level, msg, detail };
  console[level === "ok" ? "info" : level === "info" ? "log" : level](`[FV ${level}]`, msg, detail ?? "");
  _logCbs.forEach(fn => fn(e));
};
const li  = (msg: string, d?: string) => log("info",  msg, d);
const lw  = (msg: string, d?: string) => log("warn",  msg, d);
const le  = (msg: string, d?: string) => log("error", msg, d);
const lok = (msg: string, d?: string) => log("ok",    msg, d);

function useDebugLog() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  useEffect(() => {
    const fn = (e: LogEntry) => setLogs(p => [e, ...p].slice(0, 300));
    _logCbs.push(fn);
    return () => { _logCbs = _logCbs.filter(f => f !== fn); };
  }, []);
  return { logs, clearLogs: () => setLogs([]) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Token stored in localStorage (no Supabase needed for the token)
// ─────────────────────────────────────────────────────────────────────────────
const LS_KEY = "fanvue_token";
type FvToken = { accessToken: string; refreshToken?: string; expiresAt?: number; name: string; handle: string };

function saveToken(t: FvToken)         { localStorage.setItem(LS_KEY, JSON.stringify(t)); }
function loadToken(): FvToken | null   { try { const r = localStorage.getItem(LS_KEY); return r ? JSON.parse(r) : null; } catch { return null; } }
function clearToken()                  { localStorage.removeItem(LS_KEY); }

// ─────────────────────────────────────────────────────────────────────────────
// PKCE  (required by Fanvue — without it the auth server rejects the request)
// ─────────────────────────────────────────────────────────────────────────────
const b64 = (buf: ArrayBuffer) => {
  let s = ""; for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
};
async function pkce() {
  const arr = new Uint8Array(32); crypto.getRandomValues(arr);
  const v = b64(arr.buffer);
  const c = b64(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)));
  return { v, c };
}
const PK = "fv_pkce"; const ST = "fv_state";

async function startOAuth() {
  const { v, c } = await pkce();
  const state = crypto.randomUUID();
  sessionStorage.setItem(PK, v); sessionStorage.setItem(ST, state);
  const p = new URLSearchParams({
    client_id: FV_CLIENT_ID, redirect_uri: FV_REDIRECT_URI,
    response_type: "code",
    // Scopes needed per official docs:
    // read:self  → GET /users/me (profile)
    // write:media → POST /media/uploads, PATCH /media/uploads/{id}, GET /media/{uuid} (needs read:media too)
    // read:media  → GET /media/{uuid} (poll status) — REQUIRED or poll returns 403
    // write:post  → POST /posts
    scope: "openid offline_access read:self read:media write:media write:post",
    state, code_challenge: c, code_challenge_method: "S256",
  });
  window.location.href = `${FV_AUTH_URL}?${p}`;
}

async function exchangeCode(code: string): Promise<FvToken> {
  const v = sessionStorage.getItem(PK);
  if (!v) throw new Error("PKCE verifier missing. Please click Connect again.");
  sessionStorage.removeItem(PK); sessionStorage.removeItem(ST);

  li("Exchanging auth code for token…");
  const res = await fetch(FV_TOKEN_URL, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code", code, redirect_uri: FV_REDIRECT_URI,
      client_id: FV_CLIENT_ID, client_secret: FV_CLIENT_SECRET, code_verifier: v,
    }).toString(),
  });
  const txt = await res.text();
  li(`Token response ${res.status}`, txt.slice(0, 300));
  if (!res.ok) throw new Error(`Token exchange failed (${res.status}): ${txt}`);

  const tokens = JSON.parse(txt);
  const at = tokens.access_token as string;

  // GET /users/me — correct endpoint per docs
  li("Fetching profile from /users/me…");
  const pr = await fetch(`${FV_API}/users/me`, { headers: fvH(at) });
  const pt = await pr.text();
  li(`/users/me ${pr.status}`, pt.slice(0, 300));
  const profile = pr.ok ? JSON.parse(pt) : {};

  const token: FvToken = {
    accessToken:  at,
    refreshToken: tokens.refresh_token,
    expiresAt:    tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined,
    name:   profile.displayName ?? profile.name   ?? profile.username ?? "Fanvue Account",
    handle: profile.username    ?? profile.handle ?? profile.uuid     ?? "fanvue",
  };
  saveToken(token);
  lok(`Connected as @${token.handle} (${token.name})`);
  return token;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fanvue publish pipeline — based 100% on official API docs
//
// Endpoints (self / non-agency):
//   POST   /media/uploads                               → { mediaUuid, uploadId }
//   GET    /media/uploads/{uploadId}/parts/{n}/url      → text/plain presigned URL
//   PUT    {presignedUrl}                               → S3 upload, returns ETag
//   PATCH  /media/uploads/{uploadId}                    → { status: "processing" }
//   GET    /media/{uuid}                                → poll { status: "ready"|"error"|… }
//   POST   /posts                                       → 201 { uuid, … }
//
// Status enum (from docs): created | processing | ready | error
// Post audience enum:       subscribers | followers-and-subscribers
// ─────────────────────────────────────────────────────────────────────────────

async function fvFetch(url: string, opts: RequestInit, label: string) {
  li(label, `${opts.method ?? "GET"} ${url}`);
  const res = await fetch(url, opts);
  const txt = await res.text();
  const ok  = res.ok;
  (ok ? lok : le)(`${label} → ${res.status}`, txt.slice(0, 500));
  return { ok, status: res.status, text: txt, json: () => JSON.parse(txt), headers: res.headers };
}

async function downloadMedia(url: string): Promise<Blob> {
  li("Downloading media…", url);
  // Direct fetch works for Supabase public bucket URLs
  let res = await fetch(url);
  if (res.ok) {
    const blob = await res.blob();
    if (blob.size > 0) { lok(`Downloaded ${(blob.size/1024).toFixed(0)} KB (${blob.type})`); return blob; }
  }
  lw(`Direct fetch ${res.status}, trying proxy…`);
  // Fall back to server-side proxy if direct fetch is blocked (CORS / private bucket)
  res = await fetch(`/api/proxy-media?url=${encodeURIComponent(url)}`);
  if (res.ok) {
    const blob = await res.blob();
    if (blob.size > 0) { lok(`Proxy download ${(blob.size/1024).toFixed(0)} KB`); return blob; }
  }
  throw new Error(
    `Cannot download media (HTTP ${res.status}).\n` +
    `URL: ${url}\n` +
    `Fix: Go to Supabase → Storage → Policies and make the bucket PUBLIC, ` +
    `or create a Vercel edge function at /api/proxy-media.ts to proxy the download.`
  );
}

async function publishToFanvue(params: {
  token: string; mediaUrl: string;
  mediaType: "image" | "video"; caption: string;
  onProgress?: (s: string) => void;
}): Promise<string> {
  const { token, mediaUrl, mediaType, caption, onProgress } = params;
  const rpt = (s: string) => { li(s); onProgress?.(s); };

  // ── Verify token is still valid ──────────────────────────────────────────
  rpt("Verifying Fanvue token…");
  const meR = await fvFetch(`${FV_API}/users/me`, { headers: fvH(token) }, "Verify token");
  if (!meR.ok) throw new Error(`Token rejected by Fanvue (${meR.status}). Disconnect and reconnect your account.`);
  lok(`Token valid — authenticated as @${meR.json().username ?? "?"}`);

  // ── Download media binary ────────────────────────────────────────────────
  rpt("Downloading media file…");
  const blob     = await downloadMedia(mediaUrl);
  const ext      = mediaType === "video" ? "mp4" : "jpeg";
  const filename = `lila-${Date.now()}.${ext}`;
  const mimeType = mediaType === "video" ? "video/mp4" : "image/jpeg";

  // ── Step 1: POST /media/uploads ──────────────────────────────────────────
  // Docs: POST /media/uploads  body: { name, filename, mediaType }
  // Returns: { mediaUuid, uploadId }
  rpt("Step 1/5 — Creating Fanvue upload session…");
  const sessR = await fvFetch(
    `${FV_API}/media/uploads`,
    {
      method: "POST",
      headers: fvH(token, { "Content-Type": "application/json" }),
      body: JSON.stringify({ name: filename, filename, mediaType }),
    },
    "Create upload session"
  );
  if (!sessR.ok) throw new Error(`Create upload session failed (${sessR.status}): ${sessR.text}`);
  const sess = sessR.json();
  const { mediaUuid, uploadId } = sess;
  if (!mediaUuid) throw new Error(`No mediaUuid in response: ${sessR.text}`);
  if (!uploadId)  throw new Error(`No uploadId in response: ${sessR.text}`);
  lok(`Session created: mediaUuid=${mediaUuid} uploadId=${uploadId}`);

  // ── Step 2a: GET presigned URL ───────────────────────────────────────────
  // Docs: GET /media/uploads/{uploadId}/parts/{partNumber}/url
  // Returns: text/plain — a raw S3 presigned URL
  rpt("Step 2/5 — Getting upload URL…");
  const urlR = await fvFetch(
    `${FV_API}/media/uploads/${uploadId}/parts/1/url`,
    { headers: fvH(token) },
    "Get presigned URL"
  );
  if (!urlR.ok) throw new Error(`Get presigned URL failed (${urlR.status}): ${urlR.text}`);
  const presignedUrl = urlR.text.trim().replace(/^"|"$/g, "");
  if (!presignedUrl.startsWith("https://")) {
    throw new Error(`Response is not a valid URL: "${presignedUrl.slice(0, 120)}"`);
  }

  // ── Step 2b: PUT to S3 ───────────────────────────────────────────────────
  // Standard S3 multipart PUT — no Authorization header (presigned URL is self-authenticating)
  rpt(`Step 2/5 — Uploading ${(blob.size/1024).toFixed(0)} KB to S3…`);
  li("PUT to S3 presigned URL…", presignedUrl.slice(0, 80) + "…");
  const s3R = await fetch(presignedUrl, {
    method: "PUT", body: blob,
    headers: { "Content-Type": mimeType },
  });
  if (!s3R.ok) throw new Error(`S3 upload failed (${s3R.status}): ${await s3R.text()}`);
  const rawEtag = (s3R.headers.get("ETag") ?? s3R.headers.get("etag") ?? "").replace(/"/g, "");
  if (!rawEtag) throw new Error("S3 returned no ETag — upload may have silently failed");
  lok(`S3 upload OK — ETag: ${rawEtag}`);

  // ── Step 3: PATCH /media/uploads/{uploadId} ──────────────────────────────
  // Docs: PATCH /media/uploads/{uploadId}  body: { parts: [{PartNumber, ETag}] }
  // Returns: { status: "processing" }
  rpt("Step 3/5 — Completing upload…");
  const compR = await fvFetch(
    `${FV_API}/media/uploads/${uploadId}`,
    {
      method: "PATCH",
      headers: fvH(token, { "Content-Type": "application/json" }),
      body: JSON.stringify({ parts: [{ PartNumber: 1, ETag: rawEtag }] }),
    },
    "Complete upload"
  );
  if (!compR.ok) throw new Error(`Complete upload failed (${compR.status}): ${compR.text}`);
  lok(`Upload completed — status: ${compR.json().status}`);

  // ── Step 4: Poll GET /media/{uuid} until status === "ready" ─────────────
  // Docs: status enum = created | processing | ready | error
  // NOTE: requires read:media scope. For non-FINALISED media only uuid + status returned.
  rpt("Step 4/5 — Waiting for Fanvue to process media…");
  const DEADLINE = Date.now() + 180_000; // 3 minute max
  let lastStatus = "";
  while (Date.now() < DEADLINE) {
    const pollR = await fvFetch(
      `${FV_API}/media/${mediaUuid}`,
      { headers: fvH(token) },
      "Poll media status"
    );
    if (!pollR.ok && pollR.status !== 404) {
      throw new Error(`Media poll failed (${pollR.status}): ${pollR.text}`);
    }
    if (pollR.ok) {
      const d = pollR.json();
      const s = (d.status ?? "").toLowerCase();
      if (s !== lastStatus) { li(`Media status: "${s}"`); lastStatus = s; }
      rpt(`Processing… (status: ${s})`);
      if (s === "ready")   { lok("Media is ready ✓"); break; }
      if (s === "error")   throw new Error("Fanvue rejected the media. Check format: images must be JPEG/PNG, videos must be MP4 (H.264).");
      // "created" or "processing" — keep polling
    }
    await new Promise(r => setTimeout(r, 4_000));
  }
  if (Date.now() >= DEADLINE) throw new Error("Timed out (3 min) waiting for Fanvue to process the media.");

  // ── Step 5: POST /posts ──────────────────────────────────────────────────
  // Docs: POST /posts  →  201  { uuid, createdAt, text, price, audience, … }
  // audience is REQUIRED: "subscribers" | "followers-and-subscribers"
  rpt("Step 5/5 — Creating post on Fanvue…");
  const postBody = {
    text: caption,
    mediaUuids: [mediaUuid],
    audience: "followers-and-subscribers" as const,
  };
  li("POST /posts body", JSON.stringify(postBody));
  const postR = await fvFetch(
    `${FV_API}/posts`,
    {
      method: "POST",
      headers: fvH(token, { "Content-Type": "application/json" }),
      body: JSON.stringify(postBody),
    },
    "Create post"
  );
  // Docs say 201 on success
  if (postR.status !== 201 && !postR.ok) {
    throw new Error(`Create post failed (${postR.status}): ${postR.text}`);
  }
  const postData = postR.json();
  // Docs confirm response field is "uuid"
  const postUuid = postData.uuid as string | undefined;
  if (!postUuid) throw new Error(`Post created but no UUID in response: ${postR.text.slice(0,300)}`);

  lok(`Post published! UUID: ${postUuid}`);
  rpt(`✅ Published! UUID: ${postUuid}`);
  return postUuid;
}

// ─────────────────────────────────────────────────────────────────────────────
// Post-by-URL helper  (the "quick post" feature — user pastes a CloudFront URL)
// This still uses the same 5-step pipeline, it just pre-fills the mediaUrl.
// ─────────────────────────────────────────────────────────────────────────────
function isImageUrl(url: string) {
  return /\.(jpe?g|png|webp|gif)(\?.*)?$/i.test(url);
}
function isVideoUrl(url: string) {
  return /\.(mp4|mov|webm)(\?.*)?$/i.test(url);
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
        <button onClick={() => reset()} className="rounded-md border border-input bg-background px-4 py-2 text-sm">Try again</button>
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

type HistoryEvent  = {
  at: string; label: string;
  kind: "scheduled"|"publishing"|"published"|"failed"|"retried";
};
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

  const [imgRes, vidRes, charRes] = await Promise.all([
    imgIds.length ? supabase.from("images").select("id,image_url,prompt,character_id,published_at,external_post_id,publish_status").in("id", imgIds) : Promise.resolve({ data: [] } as any),
    vidIds.length ? supabase.from("videos").select("id,video_url,prompt,scene_prompts,character_id,published_at,external_post_id,publish_status").in("id", vidIds) : Promise.resolve({ data: [] } as any),
    supabase.from("characters").select("id,name,reference_image_url"),
  ]);

  const imgMap  = new Map((imgRes.data  ?? []).map((i: any) => [i.id, i]));
  const vidMap  = new Map((vidRes.data  ?? []).map((v: any) => [v.id, v]));
  const charMap = new Map((charRes.data ?? []).map((c: any) => [c.id, c]));

  return (rows ?? []).map((r: any): ScheduledItem => {
    const isVid = r.content_type === "video";
    const src: any  = isVid ? vidMap.get(r.content_id) : imgMap.get(r.content_id);
    const char: any = src?.character_id ? charMap.get(src.character_id) : null;
    const scenes: string[] = isVid && Array.isArray(src?.scene_prompts) ? src.scene_prompts : src?.prompt ? [src.prompt] : [];
    const media = isVid ? src?.video_url : src?.image_url;

    const status: PublishStatus =
      r.status === "published" ? "published" : r.status === "failed" ? "failed" :
      r.status === "publishing" ? "publishing" : "scheduled";
    const queueStatus: QueueStatus =
      status === "published" ? "published" : status === "failed" ? "failed" :
      status === "publishing" ? "publishing" :
      new Date(r.publish_time) <= new Date() ? "ready" : "waiting";

    return {
      id: r.id,
      contentName: `${char?.name ?? "Lila"} — ${(scenes[0] ?? "Untitled").slice(0,40)}`,
      type: r.content_type, character: char?.name ?? "Lila",
      thumbnail: char?.reference_image_url || media || PLACEHOLDER,
      mediaUrl: media || "",
      scheduledAt: r.publish_time, status, queueStatus, autoPublish: true,
      externalPostId: src?.external_post_id ?? undefined,
      publishedAt: src?.published_at ?? undefined,
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
  const [imgRes, vidRes, charRes] = await Promise.all([
    supabase.from("images").select("id,image_url,prompt,character_id").eq("status","approved"),
    supabase.from("videos").select("id,video_url,prompt,character_id").eq("status","approved"),
    supabase.from("characters").select("id,name,reference_image_url"),
  ]);
  const cm = new Map((charRes.data ?? []).map((c: any) => [c.id, c]));
  return [
    ...(imgRes.data ?? []).map((i: any) => ({
      id: i.id, type: "image" as const,
      name: `${cm.get(i.character_id)?.name ?? "Lila"} — ${(i.prompt ?? "Image").slice(0,40)}`,
      mediaUrl: i.image_url ?? "", thumbnail: i.image_url ?? "",
    })),
    ...(vidRes.data ?? []).map((v: any) => ({
      id: v.id, type: "video" as const,
      name: `${cm.get(v.character_id)?.name ?? "Lila"} — ${(v.prompt ?? "Video").slice(0,40)}`,
      mediaUrl: v.video_url ?? "", thumbnail: cm.get(v.character_id)?.reference_image_url ?? "",
    })),
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// UI helpers
// ─────────────────────────────────────────────────────────────────────────────
const statusCls: Record<PublishStatus,string> = {
  scheduled:"bg-chart-2/15 text-chart-2 border-chart-2/30",
  publishing:"bg-primary/15 text-primary border-primary/30",
  published:"bg-success/15 text-success border-success/30",
  failed:"bg-destructive/15 text-destructive border-destructive/30",
};
const queueCls: Record<QueueStatus,string> = {
  waiting:"bg-muted text-muted-foreground border-border",
  ready:"bg-chart-2/15 text-chart-2 border-chart-2/30",
  publishing:"bg-primary/15 text-primary border-primary/30",
  published:"bg-success/15 text-success border-success/30",
  failed:"bg-destructive/15 text-destructive border-destructive/30",
};
const logCls: Record<LogLevel,string> = {
  info:"text-muted-foreground", warn:"text-yellow-400", error:"text-red-400 font-semibold", ok:"text-green-400",
};

const ft  = (s: string) => new Date(s).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
const fd  = (s: string) => new Date(s).toLocaleDateString([],{month:"short",day:"numeric"});
const fdt = (s: string) => `${fd(s)} · ${ft(s)}`;
const sameDay = (a: Date, b: Date) => a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate();

function SBadge({status}:{status:PublishStatus}) {
  return <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider",statusCls[status])}>
    {status==="publishing"&&<Loader2 className="h-2.5 w-2.5 animate-spin"/>}{status}
  </span>;
}
function QBadge({status}:{status:QueueStatus}) {
  return <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider",queueCls[status])}>{status}</span>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Debug panel (collapsible bottom bar)
// ─────────────────────────────────────────────────────────────────────────────
function DebugPanel({logs,onClear}:{logs:LogEntry[];onClear:()=>void}) {
  const [open,setOpen] = useState(false);
  const errCount = logs.filter(l=>l.level==="error").length;
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 pointer-events-none">
      <div className="pointer-events-auto mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8">
        <div className={cn("rounded-t-xl border border-border/80 bg-card shadow-2xl transition-all",open?"max-h-80":"max-h-10")}>
          <button type="button" onClick={()=>setOpen(o=>!o)}
            className="flex w-full items-center gap-2 px-4 py-2 hover:bg-muted/30 rounded-t-xl">
            <Bug className="h-3.5 w-3.5 text-muted-foreground"/>
            <span className="text-xs font-medium text-muted-foreground">Publish Debug Log</span>
            {errCount>0&&<span className="rounded bg-destructive/15 border border-destructive/30 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">{errCount} error{errCount!==1?"s":""}</span>}
            {logs.length>0&&errCount===0&&<span className="text-[10px] text-muted-foreground">{logs.length} entries</span>}
            <div className="ml-auto flex items-center gap-2">
              {open&&<button type="button" onClick={e=>{e.stopPropagation();onClear();}} className="text-[10px] text-muted-foreground hover:text-foreground px-1">Clear</button>}
              {open?<ChevronDown className="h-3.5 w-3.5 text-muted-foreground"/>:<ChevronUp className="h-3.5 w-3.5 text-muted-foreground"/>}
            </div>
          </button>
          {open&&(
            <div className="h-64 overflow-y-auto border-t border-border/60 bg-background/90 font-mono">
              {logs.length===0
                ?<p className="p-4 text-xs text-muted-foreground">No events yet. Click "Publish now" to see step-by-step output.</p>
                :logs.map((l,i)=>(
                  <div key={i} className="flex items-start gap-2 border-b border-border/20 px-3 py-1">
                    <span className="shrink-0 text-[10px] text-muted-foreground/50 tabular-nums">{new Date(l.at).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"})}</span>
                    <span className={cn("shrink-0 w-12 text-[10px]",logCls[l.level])}>[{l.level.toUpperCase()}]</span>
                    <div className="min-w-0 flex-1">
                      <span className={cn("text-[11px]",logCls[l.level])}>{l.msg}</span>
                      {l.detail&&<p className="mt-0.5 break-all text-[10px] text-muted-foreground/60">{l.detail}</p>}
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
// Quick-post-by-URL dialog  (paste any CloudFront/Supabase URL → post to Fanvue)
// ─────────────────────────────────────────────────────────────────────────────
function QuickPostDialog({open,onOpenChange,token}:{open:boolean;onOpenChange:(o:boolean)=>void;token:FvToken|null}) {
  const [url,setUrl]       = useState("");
  const [caption,setCaption] = useState("");
  const [busy,setBusy]     = useState(false);
  const [lastPost,setLastPost] = useState<string|null>(null);

  const detectedType = isVideoUrl(url) ? "video" : isImageUrl(url) ? "image" : null;

  const handlePost = async () => {
    if (!token) { toast.error("Connect your Fanvue account first"); return; }
    if (!url.trim()) { toast.error("Enter a media URL"); return; }
    if (!detectedType) { toast.error("URL must end in .jpg/.jpeg/.png/.mp4 etc."); return; }
    setBusy(true);
    const tid = "quick-post";
    toast.loading("Posting to Fanvue…",{id:tid,duration:Infinity});
    try {
      const postUuid = await publishToFanvue({
        token: token.accessToken,
        mediaUrl: url.trim(),
        mediaType: detectedType,
        caption: caption.trim() || "New post from Lila Studio",
        onProgress: s => toast.loading(s,{id:tid,duration:Infinity}),
      });
      setLastPost(postUuid);
      toast.success("Posted to Fanvue!",{
        id:tid,duration:12_000,
        description:`Post UUID: ${postUuid}`,
        action:{label:"View",onClick:()=>window.open(`https://www.fanvue.com/post/${postUuid}`,"_blank")},
      });
      setUrl(""); setCaption("");
    } catch(e:any) {
      le("Quick-post failed",e.message);
      toast.error("Post failed — check debug log",{id:tid,description:e.message.slice(0,200),duration:15_000});
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><LinkIcon className="h-4 w-4"/> Quick post by URL</DialogTitle>
          <DialogDescription>
            Paste any publicly-accessible image or video URL (Supabase, CloudFront, etc.) and post it directly to your Fanvue account.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Media URL</Label>
            <Input
              value={url} onChange={e=>setUrl(e.target.value)}
              placeholder="https://d2p7pge43lyniu.cloudfront.net/output/…jpeg"
            />
            {url && (
              <p className={cn("text-[11px]", detectedType ? "text-success" : "text-warning")}>
                {detectedType ? `✓ Detected as ${detectedType}` : "⚠ Cannot detect type from URL extension"}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Caption (optional)</Label>
            <Input value={caption} onChange={e=>setCaption(e.target.value)} placeholder="Check out my latest content!" />
          </div>
          {!token && (
            <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/5 p-3">
              <AlertTriangle className="h-4 w-4 text-warning flex-shrink-0"/>
              <p className="text-xs">Connect your Fanvue account first (top-right button).</p>
            </div>
          )}
          {token && (
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 p-3">
              <span className="h-2 w-2 rounded-full bg-success flex-shrink-0"/>
              <span className="text-xs">Posting as <strong>@{token.handle}</strong> ({token.name})</span>
            </div>
          )}
          {lastPost && (
            <div className="rounded-md border border-success/30 bg-success/5 p-3">
              <p className="text-xs font-medium text-success">Last post: {lastPost}</p>
              <a href={`https://www.fanvue.com/post/${lastPost}`} target="_blank" rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline">
                <ExternalLink className="h-3 w-3"/> View on Fanvue
              </a>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={()=>onOpenChange(false)}>Close</Button>
          <Button onClick={handlePost} disabled={busy||!url||!detectedType||!token} className="gap-2">
            {busy?<Loader2 className="h-4 w-4 animate-spin"/>:<Send className="h-4 w-4"/>}
            {busy?"Posting…":"Post to Fanvue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Account dialog
// ─────────────────────────────────────────────────────────────────────────────
function AccountDialog({open,onOpenChange,token,onDisconnect}:{
  open:boolean;onOpenChange:(o:boolean)=>void;token:FvToken|null;onDisconnect:()=>void;
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
                <div className="grid h-9 w-9 place-items-center rounded-full bg-primary/10 text-primary font-semibold text-sm">{token.name.slice(0,1).toUpperCase()}</div>
                <div>
                  <p className="text-sm font-medium">{token.name}</p>
                  <p className="text-xs text-muted-foreground">@{token.handle}</p>
                  {token.expiresAt&&<p className={cn("text-[10px]",token.expiresAt<Date.now()?"text-destructive":"text-muted-foreground")}>{token.expiresAt<Date.now()?"⚠ Token expired — reconnect":"✓ Token valid"}</p>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="gap-1 border-success/40 text-success text-xs"><CheckCircle className="h-3 w-3"/> Connected</Badge>
                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive text-xs" onClick={onDisconnect}>Disconnect</Button>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-muted/30 p-6 text-center">
              <Plug className="mx-auto h-8 w-8 text-muted-foreground"/>
              <p className="mt-2 text-sm font-medium">No account connected</p>
              <p className="mt-1 text-xs text-muted-foreground">Connect your Fanvue creator account to start publishing.</p>
            </div>
          )}
          <div className="rounded-lg border border-border bg-muted/20 p-4">
            <p className="text-xs font-medium mb-1">{token?"Reconnect account":"Connect account"}</p>
            <p className="text-xs text-muted-foreground mb-3">
              Your token is saved in your browser's localStorage — no server needed. You'll be redirected to Fanvue then back here automatically.
            </p>
            <Button className="w-full gap-2" onClick={()=>{onOpenChange(false);startOAuth();}}>
              <ExternalLink className="h-4 w-4"/> {token?"Reconnect Fanvue":"Connect Fanvue Account"}
            </Button>
          </div>
          {token && (
            <div className="rounded-lg border border-border bg-muted/10 p-3">
              <p className="text-[11px] font-medium text-muted-foreground mb-1">Token scopes granted</p>
              <p className="text-[10px] text-muted-foreground">read:self · read:media · write:media · write:post</p>
              <p className="text-[10px] text-muted-foreground/60 mt-1">If publishing fails with 403, reconnect to re-grant all scopes.</p>
            </div>
          )}
        </div>
        <DialogFooter><Button variant="outline" onClick={()=>onOpenChange(false)}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────
function SchedulePage() {
  const queryClient = useQueryClient();
  const {data:scheduleData=EMPTY} = useQuery({queryKey:["schedules"],queryFn:fetchSchedules,staleTime:10_000});
  const [items,setItems]       = useState<ScheduledItem[]>([]);
  const [token,setToken]       = useState<FvToken|null>(()=>loadToken());
  const {logs,clearLogs}       = useDebugLog();
  useEffect(()=>setItems(scheduleData),[scheduleData]);

  // OAuth redirect handler
  useEffect(()=>{
    const p   = new URLSearchParams(window.location.search);
    const code = p.get("code");
    const err  = p.get("error");
    if(err){ window.history.replaceState({},"",window.location.pathname); toast.error(`Fanvue error: ${p.get("error_description")??err}`); return; }
    if(!code) return;
    window.history.replaceState({},"",window.location.pathname);
    toast.loading("Connecting…",{id:"fv"});
    exchangeCode(code)
      .then(t=>{ setToken(t); toast.success(`Connected as @${t.handle}!`,{id:"fv"}); })
      .catch(e=>{ le("OAuth failed",e.message); toast.error(e.message,{id:"fv"}); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  // Realtime
  useEffect(()=>{
    const ch=supabase.channel("sched-rt").on("postgres_changes",{event:"*",schema:"public",table:"schedules"},()=>queryClient.invalidateQueries({queryKey:["schedules"]})).subscribe();
    return ()=>{supabase.removeChannel(ch);};
  },[queryClient]);

  const [tab,setTab]           = useState("calendar");
  const [search,setSearch]     = useState("");
  const [sf,setSf]             = useState<"all"|PublishStatus>("all");
  const [rf,setRf]             = useState<"all"|"today"|"week"|"month">("all");
  const [selected,setSelected] = useState<ScheduledItem|null>(null);
  const [createOpen,setCreateOpen]   = useState(false);
  const [accountOpen,setAccountOpen] = useState(false);
  const [quickOpen,setQuickOpen]     = useState(false);
  const [weekStart,setWeekStart]     = useState(()=>{ const d=new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()-d.getDay()); return d; });

  const stats = useMemo(()=>{
    const now=new Date(); const wa=new Date(now); wa.setDate(wa.getDate()-7);
    return {
      scheduled:     items.filter(i=>i.status==="scheduled").length,
      today:         items.filter(i=>i.status==="scheduled"&&sameDay(new Date(i.scheduledAt),now)).length,
      weekPublished: items.filter(i=>i.status==="published"&&i.publishedAt&&new Date(i.publishedAt)>=wa).length,
      failed:        items.filter(i=>i.status==="failed").length,
    };
  },[items]);

  const filtered = useMemo(()=>{
    const now=new Date();
    return items.filter(i=>{
      if(sf!=="all"&&i.status!==sf) return false;
      if(rf!=="all"){
        const d=new Date(i.scheduledAt);
        if(rf==="today"&&!sameDay(d,now)) return false;
        if(rf==="week"){const wk=new Date(now);wk.setDate(wk.getDate()+7);if(d<now||d>wk)return false;}
        if(rf==="month"&&(d.getMonth()!==now.getMonth()||d.getFullYear()!==now.getFullYear()))return false;
      }
      if(search.trim()){const q=search.toLowerCase();if(![i.contentName,i.character].join(" ").toLowerCase().includes(q))return false;}
      return true;
    });
  },[items,sf,rf,search]);

  const upd = (id:string,patch:Partial<ScheduledItem>) => setItems(p=>p.map(i=>i.id===id?{...i,...patch}:i));

  const remove = async(id:string)=>{
    setItems(p=>p.filter(i=>i.id!==id)); setSelected(null);
    try{ const{error}=await supabase.from("schedules").delete().eq("id",id); if(error)throw error; toast.success("Removed"); queryClient.invalidateQueries({queryKey:["schedules"]}); }
    catch(e:any){toast.error(e?.message??"Failed");}
  };

  const retry = async(id:string)=>{
    upd(id,{status:"scheduled",queueStatus:"ready"});
    try{await scheduleService.update(id,{status:"scheduled"});toast.success("Queued for retry");}
    catch(e:any){toast.error(e?.message??"Failed");}
  };

  const publishNow = async(id:string)=>{
    const item=items.find(i=>i.id===id); if(!item) return;
    const t=loadToken();
    if(!t?.accessToken){
      toast.error("No Fanvue account connected",{action:{label:"Connect",onClick:()=>setAccountOpen(true)},duration:8_000});
      return;
    }
    if(!item.mediaUrl){ toast.error("No media URL — asset may still be processing in Supabase"); return; }

    li(`Publishing item ${id}`,`type=${item.type} url=${item.mediaUrl}`);
    upd(id,{status:"publishing",queueStatus:"publishing"});
    const tid=`pub-${id}`;
    toast.loading("Starting publish…",{id:tid,duration:Infinity});

    try{
      const postUuid = await publishToFanvue({
        token:       t.accessToken,
        mediaUrl:    item.mediaUrl,
        mediaType:   item.type,
        caption:     item.scenePrompts[0] ?? item.contentName,
        onProgress:  s=>toast.loading(s,{id:tid,duration:Infinity}),
      });

      const now=new Date().toISOString();
      const table=item.type==="image"?"images":"videos";
      const{data:sr}=await supabase.from("schedules").select("content_id").eq("id",id).single();
      if(sr?.content_id){
        const{error:ue}=await supabase.from(table).update({publish_status:"published",published_at:now,external_post_id:postUuid}).eq("id",sr.content_id);
        if(ue) lw("Supabase asset update error",ue.message); else lok("Supabase asset updated");
      }
      await scheduleService.update(id,{status:"published"});
      upd(id,{status:"published",queueStatus:"published",externalPostId:postUuid,publishedAt:now,
        history:[...item.history,{at:now,label:`Published to @${t.handle}`,kind:"published"}]});

      toast.success(`✅ Published to @${t.handle}!`,{
        id:tid,duration:12_000,description:`Post UUID: ${postUuid}`,
        action:{label:"View on Fanvue",onClick:()=>window.open(`https://www.fanvue.com/post/${postUuid}`,"_blank")},
      });
      queryClient.invalidateQueries({queryKey:["schedules"]});

    }catch(e:any){
      le("Publish FAILED",e.message);
      upd(id,{status:"failed",queueStatus:"failed",
        history:[...item.history,{at:new Date().toISOString(),label:`Failed: ${e.message.slice(0,100)}`,kind:"failed"}]});
      try{await scheduleService.update(id,{status:"failed"});}catch{}
      toast.error("Publish failed — open debug log ↓",{id:tid,description:e.message.slice(0,200),duration:20_000});
    }
  };

  const [dragId,setDragId]=useState<string|null>(null);
  const onDrop=async(day:Date)=>{
    if(!dragId) return;
    const item=items.find(i=>i.id===dragId); if(!item) return;
    const nd=new Date(day); const od=new Date(item.scheduledAt);
    nd.setHours(od.getHours(),od.getMinutes(),0,0);
    const iso=nd.toISOString();
    upd(dragId,{scheduledAt:iso});
    try{await scheduleService.update(dragId,{publish_time:iso});toast.success("Rescheduled");}
    catch(e:any){toast.error(e?.message??"Failed");}
    setDragId(null);
  };

  return (
    <SidebarProvider>
      <AppSidebar/>
      <SidebarInset>
        <AppHeader/>
        <main className="flex-1 overflow-y-auto bg-background pb-14">
          <div className="mx-auto max-w-[1400px] space-y-6 p-4 sm:p-6 lg:p-8">

            {/* Header */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <Link to="/" className="mb-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5"/> Dashboard</Link>
                <h1 className="font-display text-3xl font-semibold tracking-tight">Scheduling</h1>
                <p className="mt-1 text-sm text-muted-foreground">Plan, queue and publish content to your Fanvue account.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {/* Quick-post by URL button */}
                <Button variant="outline" size="sm" className="gap-2" onClick={()=>setQuickOpen(true)}>
                  <LinkIcon className="h-4 w-4"/> Post by URL
                </Button>
                <Button variant="outline" size="sm" className="gap-2" onClick={()=>setAccountOpen(true)}>
                  <Plug className="h-4 w-4"/>
                  {token
                    ?<span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-success"/><span className="max-w-[120px] truncate">{token.name}</span></span>
                    :"Connect Fanvue"}
                </Button>
                <Button size="sm" className="gap-2" onClick={()=>setCreateOpen(true)}>
                  <CalendarPlus className="h-4 w-4"/> Schedule content
                </Button>
              </div>
            </div>

            {!token&&(
              <div className="flex items-center gap-3 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3">
                <AlertTriangle className="h-4 w-4 shrink-0 text-warning"/>
                <p className="flex-1 text-sm">No Fanvue account connected. Connect one to start publishing.</p>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={()=>setAccountOpen(true)}><ExternalLink className="h-3.5 w-3.5"/> Connect now</Button>
              </div>
            )}

            {/* Stats */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <DashboardCard label="Scheduled" value={stats.scheduled} icon={CalendarClock} accent="primary" hint="Awaiting publish"/>
              <DashboardCard label="Today"     value={stats.today}     icon={Clock}         accent="chart-2" hint="Next 24h"/>
              <DashboardCard label="This week" value={stats.weekPublished} icon={CheckCircle2} accent="chart-3"/>
              <DashboardCard label="Failed"    value={stats.failed}    icon={AlertTriangle} accent="chart-5" hint={stats.failed?"Needs attention":"All clear"}/>
            </div>

            {/* Filters */}
            <Card className="border-border/60 bg-card">
              <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"/>
                  <Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search character, content…" className="pl-9"/>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Filter className="h-4 w-4 text-muted-foreground"/>
                  <Select value={sf} onValueChange={v=>setSf(v as never)}>
                    <SelectTrigger className="h-9 w-[150px]"><SelectValue placeholder="Status"/></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      <SelectItem value="scheduled">Scheduled</SelectItem>
                      <SelectItem value="publishing">Publishing</SelectItem>
                      <SelectItem value="published">Published</SelectItem>
                      <SelectItem value="failed">Failed</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={rf} onValueChange={v=>setRf(v as never)}>
                    <SelectTrigger className="h-9 w-[140px]"><SelectValue placeholder="Date range"/></SelectTrigger>
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

            {/* Views */}
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                <TabsTrigger value="calendar">Calendar</TabsTrigger>
                <TabsTrigger value="queue">Publishing Queue</TabsTrigger>
                <TabsTrigger value="history">History</TabsTrigger>
              </TabsList>
              <TabsContent value="calendar" className="mt-4">
                <CalendarView weekStart={weekStart} setWeekStart={setWeekStart} items={filtered}
                  onOpen={setSelected} onDragStart={setDragId} onDrop={onDrop} onSchedule={()=>setCreateOpen(true)}/>
              </TabsContent>
              <TabsContent value="queue" className="mt-4">
                <QueueView items={filtered.filter(i=>["scheduled","publishing","failed"].includes(i.status))}
                  onOpen={setSelected} onCancel={remove} onPublish={publishNow} onRetry={retry} onSchedule={()=>setCreateOpen(true)}/>
              </TabsContent>
              <TabsContent value="history" className="mt-4">
                <HistoryView items={filtered.filter(i=>["published","failed"].includes(i.status))}
                  onOpen={setSelected} onRetry={retry}/>
              </TabsContent>
            </Tabs>
          </div>
        </main>
      </SidebarInset>

      <DetailSheet item={selected} onClose={()=>setSelected(null)} token={token}
        onRetry={retry} onPublish={publishNow} onRemove={remove}/>
      <CreateScheduleDialog open={createOpen} onOpenChange={setCreateOpen} token={token}/>
      <AccountDialog open={accountOpen} onOpenChange={setAccountOpen} token={token}
        onDisconnect={()=>{clearToken();setToken(null);toast.success("Disconnected");}}/>
      <QuickPostDialog open={quickOpen} onOpenChange={setQuickOpen} token={token}/>
      <DebugPanel logs={logs} onClear={clearLogs}/>
    </SidebarProvider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Calendar
// ─────────────────────────────────────────────────────────────────────────────
function CalendarView({weekStart,setWeekStart,items,onOpen,onDragStart,onDrop,onSchedule}:{
  weekStart:Date;setWeekStart:(d:Date)=>void;items:ScheduledItem[];
  onOpen:(i:ScheduledItem)=>void;onDragStart:(id:string|null)=>void;
  onDrop:(d:Date)=>void;onSchedule:()=>void;
}) {
  const days=Array.from({length:7}).map((_,i)=>{const d=new Date(weekStart);d.setDate(d.getDate()+i);return d;});
  const mv=(n:number)=>{const d=new Date(weekStart);d.setDate(d.getDate()+n*7);setWeekStart(d);};
  const today=new Date();
  return (
    <Card className="border-border/60 bg-card">
      <CardContent className="p-4">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="font-display text-lg font-semibold">{weekStart.toLocaleDateString([],{month:"long",year:"numeric"})}</p>
            <p className="text-xs text-muted-foreground">Drag cards to reschedule</p>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={()=>mv(-1)}><ChevronLeft className="h-4 w-4"/></Button>
            <Button variant="outline" size="sm"   className="h-8" onClick={()=>{const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-d.getDay());setWeekStart(d);}}>Today</Button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={()=>mv(1)}><ChevronRight className="h-4 w-4"/></Button>
          </div>
        </div>
        {items.length===0?<EmptyState onSchedule={onSchedule}/>:(
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-7">
            {days.map(day=>{
              const di=items.filter(i=>sameDay(new Date(i.scheduledAt),day)).sort((a,b)=>+new Date(a.scheduledAt)-+new Date(b.scheduledAt));
              const isToday=sameDay(day,today);
              return (
                <div key={day.toISOString()} onDragOver={e=>e.preventDefault()} onDrop={()=>onDrop(day)}
                  className="flex min-h-[260px] flex-col rounded-lg border border-border/60 bg-background/40 p-2 hover:border-primary/40 transition-colors">
                  <div className="mb-2 flex items-baseline justify-between px-1">
                    <p className={cn("text-[10px] font-medium uppercase tracking-wider",isToday?"text-primary":"text-muted-foreground")}>{day.toLocaleDateString([],{weekday:"short"})}</p>
                    <p className={cn("font-display text-lg font-semibold",isToday?"text-primary":"text-foreground")}>{day.getDate()}</p>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {di.map(i=>(
                      <button key={i.id} type="button" draggable onDragStart={()=>onDragStart(i.id)} onClick={()=>onOpen(i)}
                        className="group flex flex-col gap-1.5 rounded-md border border-border/60 bg-card p-1.5 text-left hover:border-primary/50 transition-colors">
                        <div className="relative h-16 w-full overflow-hidden rounded">
                          <img src={i.thumbnail} alt="" className="h-full w-full object-cover"/>
                          <div className="absolute left-1 top-1 grid h-5 w-5 place-items-center rounded bg-black/60">
                            {i.type==="video"?<VideoIcon className="h-3 w-3 text-white"/>:<ImageIcon className="h-3 w-3 text-white"/>}
                          </div>
                          <div className="absolute right-1 top-1"><SBadge status={i.status}/></div>
                        </div>
                        <div className="px-0.5">
                          <p className="truncate text-xs font-medium">{i.character}</p>
                          <p className="text-[10px] text-muted-foreground">{ft(i.scheduledAt)}</p>
                        </div>
                      </button>
                    ))}
                    {di.length===0&&<p className="px-1 pt-2 text-[11px] text-muted-foreground/70">Nothing scheduled</p>}
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
// Queue view
// ─────────────────────────────────────────────────────────────────────────────
function QueueView({items,onOpen,onCancel,onPublish,onRetry,onSchedule}:{
  items:ScheduledItem[];onOpen:(i:ScheduledItem)=>void;onCancel:(id:string)=>void;
  onPublish:(id:string)=>void;onRetry:(id:string)=>void;onSchedule:()=>void;
}) {
  if(items.length===0) return <Card className="border-border/60 bg-card"><CardContent className="p-4"><EmptyState onSchedule={onSchedule} msg="Queue is empty."/></CardContent></Card>;
  return (
    <div className="grid gap-3">
      {items.map(i=>(
        <Card key={i.id} className="border-border/60 bg-card hover:border-primary/40 transition-colors">
          <CardContent className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
            <button type="button" onClick={()=>onOpen(i)} className="relative h-20 w-32 shrink-0 overflow-hidden rounded-md bg-muted">
              <img src={i.thumbnail} alt="" className="h-full w-full object-cover hover:scale-105 transition-transform"/>
              {i.type==="video"&&<div className="absolute inset-0 grid place-items-center bg-black/30"><Play className="h-5 w-5 text-white"/></div>}
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-semibold">{i.contentName}</p>
                <QBadge status={i.queueStatus}/>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{i.character}</p>
              <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground"><Clock className="h-3 w-3"/>{fdt(i.scheduledAt)}</p>
              {!i.mediaUrl&&<p className="mt-1 text-[10px] text-destructive">⚠ No media URL — check Supabase images/videos table</p>}
            </div>
            <div className="flex items-center gap-1.5">
              {i.status==="failed"
                ?<Button size="sm" variant="outline" className="gap-1.5" onClick={()=>onRetry(i.id)}><RefreshCw className="h-3.5 w-3.5"/> Retry</Button>
                :<Button size="sm" variant="outline" className="gap-1.5" onClick={()=>onPublish(i.id)}
                    disabled={i.status==="publishing"||!i.mediaUrl}>
                    {i.status==="publishing"?<Loader2 className="h-3.5 w-3.5 animate-spin"/>:<Send className="h-3.5 w-3.5"/>}
                    {i.status==="publishing"?"Publishing…":"Publish now"}
                  </Button>}
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button size="icon" variant="ghost" className="h-8 w-8"><MoreHorizontal className="h-4 w-4"/></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={()=>onOpen(i)}><Eye className="mr-2 h-4 w-4"/> View details</DropdownMenuItem>
                  <DropdownMenuSeparator/>
                  <DropdownMenuItem onClick={()=>onCancel(i.id)} className="text-destructive focus:text-destructive"><Trash2 className="mr-2 h-4 w-4"/> Cancel</DropdownMenuItem>
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
// History view
// ─────────────────────────────────────────────────────────────────────────────
function HistoryView({items,onOpen,onRetry}:{items:ScheduledItem[];onOpen:(i:ScheduledItem)=>void;onRetry:(id:string)=>void;}) {
  if(items.length===0) return (
    <Card className="border-border/60 bg-card"><CardContent className="p-10 text-center">
      <Inbox className="mx-auto h-10 w-10 text-muted-foreground/60"/>
      <p className="mt-3 font-medium">No history yet</p>
      <p className="mt-1 text-sm text-muted-foreground">Published and failed posts appear here.</p>
    </CardContent></Card>
  );
  return (
    <Card className="border-border/60 bg-card">
      <CardContent className="p-0">
        <div className="grid grid-cols-12 gap-3 border-b border-border/60 px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          <div className="col-span-6">Content</div><div className="col-span-3">Published</div>
          <div className="col-span-2">Post UUID</div><div className="col-span-1 text-right">Status</div>
        </div>
        {items.map(i=>(
          <button key={i.id} type="button" onClick={()=>onOpen(i)}
            className="grid w-full grid-cols-12 items-center gap-3 border-b border-border/40 px-4 py-3 text-left hover:bg-muted/40 last:border-b-0 transition-colors">
            <div className="col-span-6 flex items-center gap-3">
              <div className="relative h-12 w-16 shrink-0 overflow-hidden rounded">
                <img src={i.thumbnail} alt="" className="h-full w-full object-cover"/>
                {i.type==="video"&&<div className="absolute inset-0 grid place-items-center bg-black/30"><Play className="h-3.5 w-3.5 text-white"/></div>}
              </div>
              <div className="min-w-0"><p className="truncate text-sm font-medium">{i.contentName}</p><p className="truncate text-xs text-muted-foreground">{i.character}</p></div>
            </div>
            <div className="col-span-3 text-xs text-muted-foreground">{i.publishedAt?fdt(i.publishedAt):"—"}</div>
            <div className="col-span-2">
              {i.externalPostId
                ?<a href={`https://www.fanvue.com/post/${i.externalPostId}`} target="_blank" rel="noopener noreferrer"
                    className="truncate font-mono text-[11px] text-primary hover:underline flex items-center gap-1" onClick={e=>e.stopPropagation()}>
                    {i.externalPostId.slice(0,10)}…<ExternalLink className="h-3 w-3 flex-shrink-0"/>
                  </a>
                :<span className="font-mono text-[11px] text-muted-foreground">—</span>}
            </div>
            <div className="col-span-1 flex items-center justify-end gap-2">
              <SBadge status={i.status}/>
              {i.status==="failed"&&<Button size="icon" variant="ghost" className="h-7 w-7" onClick={e=>{e.stopPropagation();onRetry(i.id);}}><RefreshCw className="h-3.5 w-3.5"/></Button>}
            </div>
          </button>
        ))}
      </CardContent>
    </Card>
  );
}

function EmptyState({onSchedule,msg="No scheduled content."}:{onSchedule:()=>void;msg?:string}) {
  return (
    <div className="mx-auto max-w-md py-10 text-center">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-border/60 bg-background"><CalendarClock className="h-6 w-6 text-muted-foreground"/></div>
      <p className="mt-4 font-display text-lg font-semibold">{msg}</p>
      <p className="mt-1 text-sm text-muted-foreground">Pick an approved asset and schedule it to your Fanvue account.</p>
      <Button size="sm" className="mt-5 gap-2" onClick={onSchedule}><CalendarPlus className="h-4 w-4"/> Schedule content</Button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Detail sheet
// ─────────────────────────────────────────────────────────────────────────────
function DetailSheet({item,onClose,token,onRetry,onPublish,onRemove}:{
  item:ScheduledItem|null;onClose:()=>void;token:FvToken|null;
  onRetry:(id:string)=>void;onPublish:(id:string)=>void;onRemove:(id:string)=>void;
}) {
  return (
    <Sheet open={!!item} onOpenChange={o=>!o&&onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {item&&(
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">{item.contentName} <SBadge status={item.status}/></SheetTitle>
              <SheetDescription>{item.character} · {item.type} · {fdt(item.scheduledAt)}</SheetDescription>
            </SheetHeader>
            <div className="mt-6 space-y-6">
              <div className="relative aspect-video overflow-hidden rounded-lg bg-muted">
                {item.type==="video"
                  ?<video src={item.mediaUrl||item.thumbnail} controls playsInline className="h-full w-full object-cover"/>
                  :<img src={item.mediaUrl||item.thumbnail} alt="" className="h-full w-full object-cover"/>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Scheduled"     value={fdt(item.scheduledAt)}/>
                <Field label="Fanvue account" value={token?`${token.name} (@${token.handle})`:"Not connected"}/>
                <Field label="Media"          value={item.mediaUrl?"✓ URL available":"✗ Missing — check Supabase"}/>
                <Field label="Review status"  value="Approved"/>
              </div>
              {!item.mediaUrl&&(
                <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
                  <AlertTriangle className="h-4 w-4 text-destructive mt-px shrink-0"/>
                  <p className="text-xs text-destructive">No media URL. Check the {item.type==="image"?"images":"videos"} table in Supabase for this record — the {item.type==="image"?"image_url":"video_url"} column may be empty.</p>
                </div>
              )}
              {item.externalPostId&&(
                <div className="rounded-md border border-border bg-background/40 p-3">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Fanvue Post UUID</p>
                  <p className="mt-1 font-mono text-xs break-all">{item.externalPostId}</p>
                  <a href={`https://www.fanvue.com/post/${item.externalPostId}`} target="_blank" rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1.5 text-xs text-primary hover:underline">
                    <ExternalLink className="h-3 w-3"/> View on Fanvue
                  </a>
                </div>
              )}
              <div>
                <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Scene prompts</p>
                <ScrollArea className="h-40 rounded-md border border-border bg-background/40 p-3">
                  <ol className="space-y-2 text-xs">{item.scenePrompts.map((p,i)=><li key={i} className="leading-relaxed"><span className="mr-1 text-muted-foreground">{i+1}.</span>{p}</li>)}</ol>
                </ScrollArea>
              </div>
              <div>
                <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">History</p>
                <ol className="relative space-y-3 border-l border-border pl-4">
                  {item.history.map((h,i)=>(
                    <li key={i} className="relative">
                      <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-primary ring-4 ring-background"/>
                      <p className="text-xs font-medium">{h.label}</p>
                      <p className="text-[11px] text-muted-foreground">{fdt(h.at)}</p>
                    </li>
                  ))}
                </ol>
              </div>
              <Separator/>
              <div className="flex flex-wrap items-center gap-2">
                {item.status==="failed"
                  ?<Button size="sm" className="gap-2" onClick={()=>onRetry(item.id)}><RefreshCw className="h-4 w-4"/> Retry</Button>
                  :item.status!=="published"
                    ?<Button size="sm" className="gap-2" onClick={()=>onPublish(item.id)}
                        disabled={item.status==="publishing"||!item.mediaUrl||!token}>
                        {item.status==="publishing"?<Loader2 className="h-4 w-4 animate-spin"/>:<Send className="h-4 w-4"/>}
                        {item.status==="publishing"?"Publishing…":"Publish to Fanvue"}
                      </Button>
                    :null}
                <Button size="sm" variant="outline" className="gap-2 text-destructive hover:text-destructive" onClick={()=>onRemove(item.id)}>
                  <Trash2 className="h-4 w-4"/> Remove
                </Button>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Field({label,value}:{label:string;value:string}) {
  return (
    <div className="rounded-md border border-border bg-background/40 p-3">
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm">{value}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Create schedule dialog
// ─────────────────────────────────────────────────────────────────────────────
function CreateScheduleDialog({open,onOpenChange,token}:{open:boolean;onOpenChange:(o:boolean)=>void;token:FvToken|null}) {
  const queryClient=useQueryClient();
  const {data:assets=[]}=useQuery({queryKey:["assets"],queryFn:fetchApprovedAssets,enabled:open});
  const [idx,setIdx]     = useState("0");
  const [date,setDate]   = useState(()=>{const d=new Date();d.setDate(d.getDate()+1);return d.toISOString().slice(0,10);});
  const [time,setTime]   = useState("18:00");

  const submit = async()=>{
    const asset=assets[Number(idx)];
    if(!asset){toast.error("Pick an approved asset first");return;}
    const iso=new Date(`${date}T${time}:00`).toISOString();
    try{
      const{data:u}=await supabase.auth.getUser();
      await scheduleService.create({content_type:asset.type,content_id:asset.id,publish_time:iso,platform:"Fanvue",status:"scheduled",created_by:u.user?.id??null} as any);
      toast.success("Scheduled!");
      queryClient.invalidateQueries({queryKey:["schedules"]});
      onOpenChange(false);
    }catch(e:any){toast.error(e?.message??"Failed");}
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
            {assets.length===0
              ?<p className="rounded-md border border-dashed border-border bg-muted/30 p-3 text-xs text-muted-foreground">No approved content. Approve items in Review Queue first.</p>
              :<Select value={idx} onValueChange={setIdx}>
                  <SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent>{assets.map((a,i)=><SelectItem key={a.id} value={String(i)}>{a.name}</SelectItem>)}</SelectContent>
                </Select>}
          </div>
          <div className="space-y-1.5">
            <Label>Fanvue account</Label>
            {token
              ?<div className="flex items-center gap-2 rounded-md border border-border bg-card/50 px-3 py-2">
                  <span className="h-2 w-2 rounded-full bg-success shrink-0"/>
                  <span className="text-sm font-medium">{token.name}</span>
                  <span className="text-xs text-muted-foreground">@{token.handle}</span>
                </div>
              :<div className="rounded-md border border-dashed border-border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground mb-2">No Fanvue account connected.</p>
                  <Button size="sm" className="gap-2 w-full" onClick={()=>{onOpenChange(false);startOAuth();}}><ExternalLink className="h-3.5 w-3.5"/> Connect Fanvue</Button>
                </div>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Date</Label><Input type="date" value={date} onChange={e=>setDate(e.target.value)}/></div>
            <div className="space-y-1.5"><Label>Time</Label><Input type="time" value={time} onChange={e=>setTime(e.target.value)}/></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={()=>onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} className="gap-2" disabled={!assets.length||!token}>
            <CalendarPlus className="h-4 w-4"/> Schedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
