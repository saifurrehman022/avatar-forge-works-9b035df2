import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { scheduleService } from "@/services";
import {
  CalendarClock, CalendarPlus, CheckCircle2, Clock, Search,
  Image as ImageIcon, Video as VideoIcon, Play, ArrowLeft, Send,
  Filter, Inbox, ChevronLeft, ChevronRight, MoreHorizontal,
  Trash2, Eye, RefreshCw, Link2, AlertTriangle,
  Loader2, Plug, CheckCircle, XCircle, ExternalLink, Bug,
  ChevronDown, ChevronUp,
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
// Fanvue OAuth config
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
function emit(entry: LogEntry) {
  console[entry.level === "success" ? "info" : entry.level](`[FV]`, entry.msg, entry.detail ?? "");
  _logListeners.forEach(fn => fn(entry));
}
const dbg   = (msg: string, d?: string) => emit({ at: Date.now(), level: "info",    msg, detail: d });
const dbgOk = (msg: string, d?: string) => emit({ at: Date.now(), level: "success", msg, detail: d });
const dbgW  = (msg: string, d?: string) => emit({ at: Date.now(), level: "warn",    msg, detail: d });
const dbgE  = (msg: string, d?: string) => emit({ at: Date.now(), level: "error",   msg, detail: d });

function useDebugLog() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  useEffect(() => {
    const fn = (e: LogEntry) => setLogs(prev => [e, ...prev].slice(0, 300));
    _logListeners.push(fn);
    return () => { _logListeners = _logListeners.filter(f => f !== fn); };
  }, []);
  return { logs, clearLogs: () => setLogs([]) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Token store
// ─────────────────────────────────────────────────────────────────────────────
const TOKEN_KEY = "fanvue_token_v2";

type StoredToken = {
  accessToken:   string;
  refreshToken?: string;
  expiresAt?:    number;
  name:          string;
  handle:        string;
  uuid:          string;
};

const saveToken  = (t: StoredToken) => localStorage.setItem(TOKEN_KEY, JSON.stringify(t));
const loadToken  = (): StoredToken | null => {
  try { const r = localStorage.getItem(TOKEN_KEY); return r ? JSON.parse(r) : null; }
  catch { return null; }
};
const clearToken = () => localStorage.removeItem(TOKEN_KEY);

// ─────────────────────────────────────────────────────────────────────────────
// PKCE helpers
// ─────────────────────────────────────────────────────────────────────────────
function b64url(buf: ArrayBuffer): string {
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
const PKCE_KEY  = "fanvue_pkce_v";
const STATE_KEY = "fanvue_state";

async function startFanvueOAuth() {
  const { verifier, challenge } = await generatePKCE();
  const state = crypto.randomUUID();
  sessionStorage.setItem(PKCE_KEY,  verifier);
  sessionStorage.setItem(STATE_KEY, state);
  const params = new URLSearchParams({
    client_id:             FANVUE_CLIENT_ID,
    redirect_uri:          FANVUE_REDIRECT_URI,
    response_type:         "code",
    scope:                 "openid offline_access read:self read:media write:media write:post",
    state,
    code_challenge:        challenge,
    code_challenge_method: "S256",
  });
  window.location.href = `${FANVUE_AUTH_URL}?${params.toString()}`;
}

async function exchangeFanvueCode(code: string): Promise<StoredToken> {
  const verifier = sessionStorage.getItem(PKCE_KEY);
  if (!verifier) throw new Error("PKCE verifier missing — please click Connect again");
  sessionStorage.removeItem(PKCE_KEY);
  sessionStorage.removeItem(STATE_KEY);

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

  const tokenText = await tokenRes.text();
  dbg(`Token exchange (${tokenRes.status})`, tokenText.slice(0, 300));
  if (!tokenRes.ok) throw new Error(`Token exchange failed (${tokenRes.status}): ${tokenText}`);

  const tokens       = JSON.parse(tokenText);
  const accessToken  = tokens.access_token  as string;
  const refreshToken = tokens.refresh_token as string | undefined;
  const expiresIn    = tokens.expires_in    as number | undefined;

  dbg("Fetching /me…");
  const meRes  = await fetch(`${FANVUE_API_BASE}/me`, {
    headers: {
      Authorization:          `Bearer ${accessToken}`,
      "X-Fanvue-API-Version": FANVUE_API_VERSION,
    },
  });
  const meText = await meRes.text();
  dbg(`/me (${meRes.status})`, meText.slice(0, 500));
  const me = meRes.ok ? JSON.parse(meText) : {};

  const stored: StoredToken = {
    accessToken,
    refreshToken,
    expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : undefined,
    name:   me.displayName ?? me.display_name ?? me.name ?? me.fullName ?? me.username ?? "Fanvue Account",
    handle: me.username    ?? me.handle       ?? me.email ?? me.uuid ?? "fanvue",
    uuid:   me.uuid        ?? me.id           ?? crypto.randomUUID(),
  };

  saveToken(stored);
  dbgOk(`Token saved for @${stored.handle}`, `uuid: ${stored.uuid}`);
  return stored;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fanvue API headers
// ─────────────────────────────────────────────────────────────────────────────
const fvH = (token: string, extra?: Record<string, string>) => ({
  Authorization:          `Bearer ${token}`,
  "X-Fanvue-API-Version": FANVUE_API_VERSION,
  ...extra,
});

// ─────────────────────────────────────────────────────────────────────────────
// Media download
//
// CloudFront (d2p7pge43lyniu.cloudfront.net) requires a server-side proxy
// because browsers enforce CORS.  Supabase public bucket URLs work directly.
//
// Required Vercel API route: /api/proxy-media.ts  (see bottom of file)
// ─────────────────────────────────────────────────────────────────────────────
async function fetchMediaBlob(mediaUrl: string): Promise<Blob> {
  dbg("Downloading media…", mediaUrl.slice(0, 100));

  const isCloudFront = mediaUrl.includes("cloudfront.net");
  const isSupabase   = mediaUrl.includes("supabase.co");

  // Supabase public bucket — direct fetch is fine
  if (isSupabase) {
    try {
      const r = await fetch(mediaUrl);
      if (r.ok) {
        const b = await r.blob();
        if (b.size > 0) { dbgOk(`Direct Supabase download OK`, `${b.size} bytes`); return b; }
      }
      dbgW(`Supabase direct fetch returned ${r.status}`);
    } catch (e: any) { dbgW("Supabase direct fetch error", e?.message); }
  }

  // CloudFront — go straight to server-side proxy (CORS will always block direct)
  if (isCloudFront) {
    dbg("CloudFront URL detected — using /api/proxy-media");
  } else {
    // Unknown CDN — try direct first
    try {
      const r = await fetch(mediaUrl);
      if (r.ok) {
        const b = await r.blob();
        if (b.size > 0) { dbgOk(`Direct download OK`, `${b.size} bytes`); return b; }
      }
    } catch (e: any) { dbgW("Direct fetch blocked", e?.message); }
  }

  // Server-side proxy (handles CloudFront + any other CORS-blocked source)
  dbg("Trying /api/proxy-media…");
  try {
    const r = await fetch(`/api/proxy-media?url=${encodeURIComponent(mediaUrl)}`);
    if (r.ok) {
      const b = await r.blob();
      if (b.size > 0) { dbgOk(`Proxy download OK`, `${b.size} bytes`); return b; }
      dbgW(`Proxy returned empty body (${r.status})`);
    } else {
      const errText = await r.text().catch(() => "");
      dbgW(`Proxy returned ${r.status}`, errText.slice(0, 200));
    }
  } catch (e: any) { dbgW("Proxy request failed", e?.message); }

  throw new Error(
    `Cannot download media from: ${mediaUrl.slice(0, 80)}…\n\n` +
    `This is a CORS issue. Create this Vercel API route:\n` +
    `  /api/proxy-media.ts\n\n` +
    `Contents:\n` +
    `  export default async function handler(req, res) {\n` +
    `    const url = req.query.url as string;\n` +
    `    if (!url) return res.status(400).end("Missing url");\n` +
    `    const r = await fetch(url);\n` +
    `    res.setHeader("Content-Type", r.headers.get("content-type") ?? "application/octet-stream");\n` +
    `    res.setHeader("Cache-Control", "no-store");\n` +
    `    res.send(Buffer.from(await r.arrayBuffer()));\n` +
    `  }`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Fanvue upload + publish pipeline
//
// Step 1  POST /media/uploads                                  → {mediaUuid, uploadId}
// Step 2  GET  /creators/{uuid}/media/uploads/{id}/parts/1/url → presigned S3 URL
// Step 3  PUT  {presignedUrl}                                  → ETag
// Step 4  PATCH /media/uploads/{uploadId}                      → complete session
// Step 5  Poll GET /media/{mediaUuid} until status = "ready"
// Step 6  POST /posts                                          → {uuid}
// ─────────────────────────────────────────────────────────────────────────────
async function publishToFanvue(params: {
  token:       StoredToken;
  mediaUrl:    string;
  mediaType:   "image" | "video";
  caption:     string;
  onProgress?: (s: string) => void;
}): Promise<string> {
  const { token, mediaUrl, mediaType, caption, onProgress } = params;
  const rep = (s: string) => { dbg(s); onProgress?.(s); };

  // ── Verify token ──────────────────────────────────────────────────────────
  rep("Verifying Fanvue token…");
  const meR = await fetch(`${FANVUE_API_BASE}/me`, { headers: fvH(token.accessToken) });
  if (!meR.ok) {
    const body = await meR.text();
    dbgE(`Token rejected (${meR.status})`, body);
    throw new Error(`Fanvue token rejected (${meR.status}). Disconnect and reconnect your account.`);
  }
  const me = await meR.json();
  const userUuid = me.uuid ?? me.id ?? token.uuid;
  dbgOk(`Authenticated as @${me.username ?? me.handle ?? "?"}`, `uuid: ${userUuid}`);
  rep(`Authenticated as @${me.username ?? me.handle ?? "?"}`);

  // ── Download media ────────────────────────────────────────────────────────
  rep("Downloading media file…");
  const blob     = await fetchMediaBlob(mediaUrl);
  const ext      = mediaType === "video" ? "mp4" : "jpeg";
  const mimeType = mediaType === "video" ? "video/mp4" : "image/jpeg";
  const filename = `lila-${Date.now()}.${ext}`;
  rep(`Downloaded ${(blob.size / 1024).toFixed(0)} KB`);

  // ── Step 1 — Create upload session ───────────────────────────────────────
  rep("Creating upload session…");
  const s1Body = { name: filename, filename, mediaType };
  dbg("POST /media/uploads", JSON.stringify(s1Body));
  const s1R = await fetch(`${FANVUE_API_BASE}/media/uploads`, {
    method:  "POST",
    headers: fvH(token.accessToken, { "Content-Type": "application/json" }),
    body:    JSON.stringify(s1Body),
  });
  const s1Text = await s1R.text();
  dbg(`POST /media/uploads → ${s1R.status}`, s1Text.slice(0, 400));
  if (!s1R.ok) throw new Error(`Step 1 (${s1R.status}): ${s1Text}`);
  const s1 = JSON.parse(s1Text);
  const { mediaUuid, uploadId } = s1;
  if (!mediaUuid) throw new Error(`Step 1: no mediaUuid in response: ${s1Text}`);
  if (!uploadId)  throw new Error(`Step 1: no uploadId in response: ${s1Text}`);
  dbgOk(`Upload session`, `mediaUuid=${mediaUuid} uploadId=${uploadId}`);

  // ── Step 2 — Get presigned S3 URL ────────────────────────────────────────
  rep("Getting S3 upload URL…");
  const s2Url = `${FANVUE_API_BASE}/creators/${userUuid}/media/uploads/${uploadId}/parts/1/url`;
  dbg(`GET ${s2Url}`);
  const s2R = await fetch(s2Url, { headers: fvH(token.accessToken) });
  const s2Text = await s2R.text();
  dbg(`GET presigned URL → ${s2R.status}`, s2Text.slice(0, 300));
  if (!s2R.ok) throw new Error(`Step 2 (${s2R.status}): ${s2Text}`);
  const presignedUrl = s2Text.trim().replace(/^"|"$/g, "");
  if (!presignedUrl.startsWith("https://")) {
    throw new Error(`Step 2: unexpected presigned URL: "${presignedUrl.slice(0, 120)}"`);
  }
  dbgOk("Got S3 presigned URL", presignedUrl.slice(0, 70) + "…");

  // ── Step 3 — PUT to S3 ───────────────────────────────────────────────────
  rep(`Uploading ${(blob.size / 1024).toFixed(0)} KB to S3…`);
  const uploadBlob = new Blob([blob], { type: blob.type || mimeType });
  const s3R = await fetch(presignedUrl, {
    method:  "PUT",
    body:    uploadBlob,
    headers: { "Content-Type": blob.type || mimeType },
  });
  if (!s3R.ok) {
    const s3Err = await s3R.text();
    dbgE(`S3 upload failed (${s3R.status})`, s3Err.slice(0, 300));
    throw new Error(`Step 3 S3 (${s3R.status}): ${s3Err}`);
  }
  const rawEtag = s3R.headers.get("ETag") ?? s3R.headers.get("etag") ?? "";
  const etag    = rawEtag.replace(/^"|"$/g, "");
  if (!etag) throw new Error("Step 3: S3 returned no ETag");
  dbgOk("S3 upload complete", `ETag: ${etag}`);
  rep("Upload complete, finalising…");

  // ── Step 4 — Complete multipart session ──────────────────────────────────
  const s4Body = { parts: [{ PartNumber: 1, ETag: etag }] };
  dbg(`PATCH /media/uploads/${uploadId}`, JSON.stringify(s4Body));
  const s4R = await fetch(`${FANVUE_API_BASE}/media/uploads/${uploadId}`, {
    method:  "PATCH",
    headers: fvH(token.accessToken, { "Content-Type": "application/json" }),
    body:    JSON.stringify(s4Body),
  });
  const s4Text = await s4R.text();
  dbg(`PATCH complete → ${s4R.status}`, s4Text.slice(0, 200));
  if (!s4R.ok) throw new Error(`Step 4 (${s4R.status}): ${s4Text}`);
  dbgOk("Upload session completed");

  // ── Step 5 — Poll until media is "ready" ─────────────────────────────────
  rep("Waiting for Fanvue to process media…");
  const READY   = new Set(["ready",  "READY"]);
  const FAILED  = new Set(["error",  "ERROR", "failed"]);
  const deadline = Date.now() + 180_000;
  let lastStatus = "";
  let pollCount  = 0;

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 4000));
    pollCount++;
    try {
      const pR = await fetch(`${FANVUE_API_BASE}/media/${mediaUuid}`, {
        headers: fvH(token.accessToken),
      });
      if (pR.ok) {
        const pData  = await pR.json();
        const status = pData.status ?? "";
        if (status !== lastStatus) {
          dbg(`Poll #${pollCount}: status="${status}"`, JSON.stringify(pData).slice(0, 200));
          lastStatus = status;
          rep(`Processing… (${status})`);
        }
        if (READY.has(status))  { dbgOk("Media ready ✓", mediaUuid); break; }
        if (FAILED.has(status)) throw new Error(`Fanvue media processing failed (status: ${status})`);
      } else {
        dbgW(`Poll #${pollCount} returned ${pR.status}`);
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes("processing failed")) throw e;
      dbgW(`Poll #${pollCount} error`, String(e));
    }
  }

  if (Date.now() >= deadline) {
    throw new Error("Timed out (3 min) waiting for Fanvue to process media. File may be too large.");
  }

  // ── Step 6 — Create post ─────────────────────────────────────────────────
  rep("Creating post on Fanvue…");
  const postBody = {
    text:       caption,
    mediaUuids: [mediaUuid],
    audience:   "followers-and-subscribers" as const,
  };
  dbg("POST /posts", JSON.stringify(postBody));
  const pR = await fetch(`${FANVUE_API_BASE}/posts`, {
    method:  "POST",
    headers: fvH(token.accessToken, { "Content-Type": "application/json" }),
    body:    JSON.stringify(postBody),
  });
  const pText = await pR.text();
  dbg(`POST /posts → ${pR.status}`, pText.slice(0, 400));
  if (!pR.ok) throw new Error(`Step 6 (${pR.status}): ${pText}`);
  const pData    = JSON.parse(pText);
  const postUuid = pData.uuid ?? pData.id ?? pData.postId ?? pData.post?.uuid;
  if (!postUuid) throw new Error(`Post created but no UUID returned. Response: ${pText.slice(0, 400)}`);

  dbgOk("🎉 Post published!", `UUID: ${postUuid}`);
  rep(`Published! UUID: ${postUuid}`);
  return postUuid as string;
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
type HistoryEvent  = { at: string; label: string; kind: "scheduled"|"queued"|"publishing"|"published"|"failed"|"retried" };

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
// Data fetching
// ─────────────────────────────────────────────────────────────────────────────
async function fetchSchedules(): Promise<ScheduledItem[]> {
  const { data: rows, error } = await supabase.from("schedules").select("*").order("publish_time");
  if (error) throw error;

  const imgIds = (rows ?? []).filter((r: any) => r.content_type === "image").map((r: any) => r.content_id);
  const vidIds = (rows ?? []).filter((r: any) => r.content_type === "video").map((r: any) => r.content_id);

  const [imgR, vidR, charR] = await Promise.all([
    imgIds.length
      ? supabase.from("images").select("id,image_url,prompt,character_id,published_at,external_post_id,publish_status").in("id", imgIds)
      : Promise.resolve({ data: [] } as any),
    vidIds.length
      ? supabase.from("videos").select("id,video_url,prompt,scene_prompts,character_id,published_at,external_post_id,publish_status").in("id", vidIds)
      : Promise.resolve({ data: [] } as any),
    supabase.from("characters").select("id,name,reference_image_url"),
  ]);

  const imgMap  = new Map((imgR.data  ?? []).map((i: any) => [i.id, i]));
  const vidMap  = new Map((vidR.data  ?? []).map((v: any) => [v.id, v]));
  const charMap = new Map((charR.data ?? []).map((c: any) => [c.id, c]));

  return (rows ?? []).map((r: any): ScheduledItem => {
    const isVideo  = r.content_type === "video";
    const src: any = isVideo ? vidMap.get(r.content_id) : imgMap.get(r.content_id);
    const char: any= src?.character_id ? charMap.get(src.character_id) : null;
    const scenes   = isVideo && Array.isArray(src?.scene_prompts) ? src.scene_prompts : src?.prompt ? [src.prompt] : [];
    const media    = isVideo ? src?.video_url : src?.image_url;
    const thumb    = char?.reference_image_url || media || PLACEHOLDER;
    const status: PublishStatus =
      r.status === "published"  ? "published"  :
      r.status === "failed"     ? "failed"     :
      r.status === "publishing" ? "publishing" : "scheduled";
    const queueStatus: QueueStatus =
      status === "published"  ? "published"  :
      status === "failed"     ? "failed"     :
      status === "publishing" ? "publishing" :
      new Date(r.publish_time) <= new Date() ? "ready" : "waiting";
    return {
      id: r.id,
      contentName: `${char?.name ?? "Lila"} — ${(scenes[0] ?? "Untitled").slice(0, 40)}`,
      type: r.content_type, character: char?.name ?? "Lila",
      thumbnail: thumb, mediaUrl: media || "",
      scheduledAt: r.publish_time, status, queueStatus, autoPublish: true,
      externalPostId: src?.external_post_id ?? undefined,
      publishedAt:    src?.published_at     ?? undefined,
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
    supabase.from("images").select("id,image_url,prompt,character_id").eq("status","approved"),
    supabase.from("videos").select("id,video_url,prompt,character_id").eq("status","approved"),
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
  scheduled:  "bg-chart-2/15 text-chart-2 border-chart-2/30",
  publishing: "bg-primary/15 text-primary border-primary/30",
  published:  "bg-success/15 text-success border-success/30",
  failed:     "bg-destructive/15 text-destructive border-destructive/30",
};
const queueStyle: Record<QueueStatus, string> = {
  waiting:    "bg-muted text-muted-foreground border-border",
  ready:      "bg-chart-2/15 text-chart-2 border-chart-2/30",
  publishing: "bg-primary/15 text-primary border-primary/30",
  published:  "bg-success/15 text-success border-success/30",
  failed:     "bg-destructive/15 text-destructive border-destructive/30",
};
const logStyle: Record<LogLevel, string> = {
  info:    "text-muted-foreground",
  warn:    "text-yellow-400",
  error:   "text-red-400 font-semibold",
  success: "text-green-400",
};
const fmtT  = (s: string) => new Date(s).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
const fmtD  = (s: string) => new Date(s).toLocaleDateString([],{month:"short",day:"numeric"});
const fmtDT = (s: string) => `${fmtD(s)} · ${fmtT(s)}`;
const sameDay = (a: Date, b: Date) =>
  a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();

function StatusBadge({ status }: { status: PublishStatus }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider", statusStyle[status])}>
      {status === "publishing" && <Loader2 className="h-2.5 w-2.5 animate-spin"/>}
      {status}
    </span>
  );
}
function QueueBadge({ status }: { status: QueueStatus }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider", queueStyle[status])}>
      {status}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Debug panel
// ─────────────────────────────────────────────────────────────────────────────
function DebugPanel({ logs, onClear }: { logs: LogEntry[]; onClear: () => void }) {
  const [open, setOpen] = useState(false);
  const errorCount = logs.filter(l => l.level === "error").length;
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 pointer-events-none">
      <div className="pointer-events-auto mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8">
        <div className={cn("rounded-t-xl border border-border/80 bg-card shadow-2xl transition-all", open ? "max-h-80" : "max-h-10")}>
          <button type="button" onClick={() => setOpen(o => !o)}
            className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-muted/40 rounded-t-xl">
            <Bug className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0"/>
            <span className="text-xs font-medium text-muted-foreground">Fanvue Publish Log</span>
            {errorCount > 0 && (
              <span className="rounded bg-destructive/15 border border-destructive/30 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">
                {errorCount} error{errorCount !== 1 ? "s" : ""}
              </span>
            )}
            {logs.length > 0 && errorCount === 0 && (
              <span className="text-[10px] text-muted-foreground">{logs.length} entries</span>
            )}
            <div className="ml-auto flex items-center gap-2">
              {open && (
                <button type="button" onClick={e=>{e.stopPropagation();onClear();}}
                  className="text-[10px] text-muted-foreground hover:text-foreground px-1">
                  Clear
                </button>
              )}
              {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground"/> : <ChevronUp className="h-3.5 w-3.5 text-muted-foreground"/>}
            </div>
          </button>
          {open && (
            <div className="h-64 overflow-y-auto border-t border-border/60 bg-black/90 font-mono">
              {logs.length === 0
                ? <p className="p-4 text-xs text-muted-foreground">No entries yet. Click "Publish now" to see step-by-step output.</p>
                : logs.map((l, i) => (
                  <div key={i} className="flex items-start gap-2 border-b border-white/5 px-3 py-1">
                    <span className="shrink-0 text-[10px] text-white/30 tabular-nums pt-px">
                      {new Date(l.at).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"})}
                    </span>
                    <span className={cn("shrink-0 text-[10px] w-16", logStyle[l.level])}>[{l.level.toUpperCase()}]</span>
                    <div className="min-w-0 flex-1">
                      <span className={cn("text-[11px]", logStyle[l.level])}>{l.msg}</span>
                      {l.detail && <p className="mt-0.5 break-all text-[10px] text-white/40">{l.detail}</p>}
                    </div>
                  </div>
                ))
              }
            </div>
          )}
        </div>
      </div>
    </div>
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
          <DialogDescription>
            Connect your Fanvue creator account to publish content from Lila Studio.
            Your token is stored locally in the browser.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {token ? (
            <div className="flex items-center justify-between rounded-lg border border-success/30 bg-success/5 p-3">
              <div className="flex items-center gap-3">
                <div className="grid h-9 w-9 place-items-center rounded-full bg-primary/10 text-primary font-semibold text-sm">
                  {token.name.slice(0, 1).toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-medium">{token.name}</p>
                  <p className="text-xs text-muted-foreground">@{token.handle}</p>
                  {token.expiresAt && (
                    <p className={cn("text-[10px]", token.expiresAt < Date.now() ? "text-destructive" : "text-success")}>
                      {token.expiresAt < Date.now()
                        ? "⚠ Token expired — reconnect"
                        : `Expires ${new Date(token.expiresAt).toLocaleDateString()}`}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="gap-1 border-success/40 text-success text-xs">
                  <CheckCircle className="h-3 w-3"/> Connected
                </Badge>
                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive text-xs" onClick={onDisconnect}>
                  Disconnect
                </Button>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-muted/30 p-6 text-center">
              <Plug className="mx-auto h-8 w-8 text-muted-foreground"/>
              <p className="mt-2 text-sm font-medium">No account connected</p>
              <p className="mt-1 text-xs text-muted-foreground">Connect your Fanvue creator account to publish.</p>
            </div>
          )}
          <div className="rounded-lg border border-border bg-muted/20 p-4">
            <p className="text-xs font-medium mb-1">{token ? "Reconnect account" : "Connect Fanvue"}</p>
            <p className="text-xs text-muted-foreground mb-3">
              You'll be redirected to Fanvue to authorise access (PKCE OAuth). After approving,
              you'll land back here automatically.
            </p>
            <Button className="w-full gap-2" onClick={() => { onOpenChange(false); startFanvueOAuth(); }}>
              <ExternalLink className="h-4 w-4"/>
              {token ? "Reconnect Fanvue Account" : "Connect Fanvue Account"}
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
// Main page
//
// FIX: The previous version had the UI disappear after OAuth redirect because:
//
//   1. `useState(() => loadToken())` only runs on first mount. When Fanvue
//      redirects back with ?code=..., TanStack Router may remount the component
//      from scratch (URL change → route re-evaluation). On that remount the
//      token ISN'T in localStorage yet (exchange hasn't completed), so the
//      initial state is null, and the connected=false UI renders immediately.
//
//   2. The exchange is async — it sets `fanvueToken` state *after* the initial
//      render, but by then the "no account" empty state is already showing.
//
//   3. We introduced `isExchanging` state to show a proper loading overlay
//      during the exchange, so the UI never flashes to an empty/disconnected
//      state while we're mid-exchange.
//
//   4. We snapshot the ?code= param BEFORE calling replaceState, preventing
//      any race between URL mutation and the exchange effect.
// ─────────────────────────────────────────────────────────────────────────────
function SchedulePage() {
  const queryClient = useQueryClient();
  const { data: scheduleData = EMPTY } = useQuery({ queryKey: ["schedules"], queryFn: fetchSchedules, staleTime: 10_000 });
  const [items,         setItems]         = useState<ScheduledItem[]>([]);
  const [fanvueToken,   setFanvueToken]   = useState<StoredToken | null>(() => loadToken());
  // ↑ On first mount this is correct. On post-OAuth remount it may be null
  //   momentarily, which is handled by isExchanging below.
  const [isExchanging,  setIsExchanging]  = useState(false);
  const { logs, clearLogs }              = useDebugLog();

  useEffect(() => setItems(scheduleData), [scheduleData]);

  // ── Handle OAuth callback ─────────────────────────────────────────────────
  // CRITICAL: Read ?code= BEFORE replacing the URL.
  // Then set isExchanging=true to suppress the "not connected" UI while we
  // complete the token exchange. Only clear isExchanging once we've settled.
  useEffect(() => {
    const params   = new URLSearchParams(window.location.search);
    const code     = params.get("code");
    const oauthErr = params.get("error");

    // Always clean up the URL immediately, before any async work
    if (code || oauthErr) {
      window.history.replaceState({}, "", window.location.pathname);
    }

    if (oauthErr) {
      dbgE(`OAuth error: ${params.get("error_description") ?? oauthErr}`);
      toast.error(`Fanvue auth error: ${params.get("error_description") ?? oauthErr}`);
      return;
    }

    if (!code) return;

    // We have a code — show the loading state to prevent UI flash
    setIsExchanging(true);
    toast.loading("Connecting Fanvue account…", { id: "fv-connect" });

    exchangeFanvueCode(code)
      .then(t => {
        setFanvueToken(t);
        toast.success(`✅ Connected as ${t.name} (@${t.handle})`, { id: "fv-connect", duration: 8000 });
      })
      .catch(e => {
        dbgE("OAuth exchange failed", e.message);
        toast.error(e.message ?? "Failed to connect Fanvue", { id: "fv-connect", duration: 10000 });
      })
      .finally(() => {
        setIsExchanging(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Also sync fanvueToken from localStorage if it was saved externally
  // (e.g. another tab completed the exchange)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === TOKEN_KEY) {
        setFanvueToken(loadToken());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Realtime schedule updates
  useEffect(() => {
    const ch = supabase.channel("schedules-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "schedules" },
        () => queryClient.invalidateQueries({ queryKey: ["schedules"] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [queryClient]);

  const [tab,          setTab]          = useState("calendar");
  const [search,       setSearch]       = useState("");
  const [statusFilter, setStatusFilter] = useState<"all"|PublishStatus>("all");
  const [rangeFilter,  setRangeFilter]  = useState<"all"|"today"|"week"|"month">("all");
  const [selected,     setSelected]     = useState<ScheduledItem|null>(null);
  const [createOpen,   setCreateOpen]   = useState(false);
  const [accountOpen,  setAccountOpen]  = useState(false);
  const [weekStart,    setWeekStart]    = useState(() => {
    const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()-d.getDay()); return d;
  });

  const stats = useMemo(() => {
    const now = new Date();
    const wa  = new Date(now); wa.setDate(wa.getDate()-7);
    return {
      scheduled:     items.filter(i => i.status==="scheduled").length,
      todayCount:    items.filter(i => i.status==="scheduled" && sameDay(new Date(i.scheduledAt), now)).length,
      weekPublished: items.filter(i => i.status==="published" && i.publishedAt && new Date(i.publishedAt)>=wa).length,
      failed:        items.filter(i => i.status==="failed").length,
    };
  }, [items]);

  const filtered = useMemo(() => {
    const now = new Date();
    return items.filter(i => {
      if (statusFilter !== "all" && i.status !== statusFilter) return false;
      if (rangeFilter  !== "all") {
        const d = new Date(i.scheduledAt);
        if (rangeFilter === "today" && !sameDay(d, now)) return false;
        if (rangeFilter === "week")  { const wk=new Date(now); wk.setDate(wk.getDate()+7); if(d<now||d>wk) return false; }
        if (rangeFilter === "month" && (d.getMonth()!==now.getMonth()||d.getFullYear()!==now.getFullYear())) return false;
      }
      if (search.trim()) {
        const q = search.toLowerCase();
        if (![i.contentName, i.character].join(" ").toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [items, statusFilter, rangeFilter, search]);

  const updateItem = (id: string, patch: Partial<ScheduledItem>) =>
    setItems(prev => prev.map(i => i.id===id ? {...i,...patch} : i));

  const removeItem = async (id: string) => {
    setItems(prev => prev.filter(i => i.id!==id));
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

  // ── PUBLISH NOW ──────────────────────────────────────────────────────────
  const publishNow = async (id: string) => {
    const item = items.find(i => i.id===id);
    if (!item) return;

    // Always read fresh from localStorage — catches tokens saved after redirect
    const token = loadToken();
    if (!token?.accessToken) {
      dbgE("No Fanvue token in localStorage");
      toast.error("No Fanvue account connected.", {
        description: "Click the account button at the top to connect your Fanvue account first.",
        action: { label: "Connect", onClick: () => setAccountOpen(true) },
        duration: 10_000,
      });
      return;
    }
    if (!item.mediaUrl) {
      dbgE("No mediaUrl on item", JSON.stringify({ id: item.id, type: item.type }));
      toast.error("No media URL for this item — check the Supabase images/videos table.");
      return;
    }

    dbg(`Publishing item ${id}`, `type=${item.type} url=${item.mediaUrl}`);
    updateItem(id, { status: "publishing", queueStatus: "publishing" });
    const tid = `pub-${id}`;
    toast.loading("Starting Fanvue publish…", { id: tid, duration: Infinity });

    try {
      const caption  = item.scenePrompts[0] ?? item.contentName;
      const postUuid = await publishToFanvue({
        token,
        mediaUrl:  item.mediaUrl,
        mediaType: item.type,
        caption,
        onProgress: s => toast.loading(s, { id: tid, duration: Infinity }),
      });

      const now     = new Date().toISOString();
      const table   = item.type === "image" ? "images" : "videos";
      const { data: schedRow } = await supabase.from("schedules").select("content_id").eq("id", id).single();
      if (schedRow?.content_id) {
        const upd = await supabase.from(table).update({
          publish_status:   "published",
          published_at:     now,
          external_post_id: postUuid,
        }).eq("id", schedRow.content_id);
        if (upd.error) dbgW("Supabase asset update failed", upd.error.message);
        else           dbgOk("Supabase asset row updated");
      }
      await scheduleService.update(id, { status: "published" });

      updateItem(id, {
        status: "published", queueStatus: "published",
        externalPostId: postUuid, publishedAt: now,
        history: [...item.history, { at: now, label: `Published to @${token.handle}`, kind: "published" }],
      });

      toast.success(`🎉 Published to @${token.handle}!`, {
        id:          tid,
        duration:    12_000,
        description: `Post UUID: ${postUuid}`,
        action: {
          label:   "View on Fanvue",
          onClick: () => window.open(`https://www.fanvue.com/post/${postUuid}`, "_blank"),
        },
      });
      queryClient.invalidateQueries({ queryKey: ["schedules"] });

    } catch (e: any) {
      const msg = e?.message ?? "Unknown error";
      dbgE("Publish FAILED", msg);
      updateItem(id, {
        status: "failed", queueStatus: "failed",
        history: [...item.history, { at: new Date().toISOString(), label: `Failed: ${msg.slice(0, 120)}`, kind: "failed" }],
      });
      try { await scheduleService.update(id, { status: "failed" }); } catch {}
      toast.error("Publish failed — check debug log below", {
        id:          tid,
        duration:    20_000,
        description: msg.slice(0, 200),
      });
    }
  };

  const [dragId, setDragId] = useState<string|null>(null);
  const onDropOnDay = async (day: Date) => {
    if (!dragId) return;
    const item = items.find(i => i.id===dragId);
    if (!item) return;
    const d   = new Date(day);
    const old = new Date(item.scheduledAt);
    d.setHours(old.getHours(), old.getMinutes(), 0, 0);
    const iso = d.toISOString();
    updateItem(dragId, { scheduledAt: iso });
    try {
      await scheduleService.update(dragId, { publish_time: iso });
      toast.success("Schedule updated");
    } catch (e: any) { toast.error(e?.message ?? "Failed to update"); }
    setDragId(null);
  };

  const connected = !!fanvueToken;

  // ── Loading overlay during OAuth exchange ─────────────────────────────────
  // This is the KEY fix: instead of rendering the full page (which shows
  // the "not connected" warning and empty queue), show a spinner while
  // we're in the middle of the token exchange.
  if (isExchanging) {
    return (
      <SidebarProvider>
        <AppSidebar/>
        <SidebarInset>
          <AppHeader/>
          <main className="flex flex-1 items-center justify-center min-h-[60vh]">
            <div className="flex flex-col items-center gap-4 text-center">
              <Loader2 className="h-10 w-10 animate-spin text-primary"/>
              <p className="font-display text-lg font-semibold">Connecting Fanvue…</p>
              <p className="text-sm text-muted-foreground">
                Completing account authorisation, please wait.
              </p>
            </div>
          </main>
        </SidebarInset>
      </SidebarProvider>
    );
  }

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
                <Link to="/" className="mb-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
                  <ArrowLeft className="h-3.5 w-3.5"/> Dashboard
                </Link>
                <h1 className="font-display text-3xl font-semibold tracking-tight">Scheduling</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Plan, queue and publish approved content to your Fanvue account.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="gap-2" onClick={() => setAccountOpen(true)}>
                  <Plug className="h-4 w-4"/>
                  {connected ? (
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-success"/>
                      <span className="max-w-[140px] truncate font-medium">{fanvueToken!.name}</span>
                      <span className="text-muted-foreground text-xs">@{fanvueToken!.handle}</span>
                    </span>
                  ) : "Connect Fanvue"}
                </Button>
                <Button size="sm" className="gap-2" onClick={() => setCreateOpen(true)}>
                  <CalendarPlus className="h-4 w-4"/> Schedule content
                </Button>
              </div>
            </div>

            {/* No account warning — only shown when NOT exchanging */}
            {!connected && (
              <div className="flex items-center gap-3 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3">
                <AlertTriangle className="h-4 w-4 flex-shrink-0 text-warning"/>
                <p className="flex-1 text-sm">No Fanvue account connected. Connect one to publish content.</p>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setAccountOpen(true)}>
                  <ExternalLink className="h-3.5 w-3.5"/> Connect now
                </Button>
              </div>
            )}

            {/* Stats */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <DashboardCard label="Scheduled posts"     value={stats.scheduled}     icon={CalendarClock} accent="primary"  hint="Awaiting publish"/>
              <DashboardCard label="Publishing today"    value={stats.todayCount}    icon={Clock}         accent="chart-2"  hint="Next 24h"/>
              <DashboardCard label="Published this week" value={stats.weekPublished} icon={CheckCircle2}  accent="chart-3"/>
              <DashboardCard label="Failed"              value={stats.failed}        icon={AlertTriangle} accent="chart-5"  hint={stats.failed ? "Needs attention" : "All clear"}/>
            </div>

            {/* Filters */}
            <Card className="border-border/60 bg-card">
              <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"/>
                  <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search character, content…" className="pl-9"/>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Filter className="h-4 w-4 text-muted-foreground"/>
                  <Select value={statusFilter} onValueChange={v => setStatusFilter(v as never)}>
                    <SelectTrigger className="h-9 w-[150px]"><SelectValue placeholder="Status"/></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      <SelectItem value="scheduled">Scheduled</SelectItem>
                      <SelectItem value="publishing">Publishing</SelectItem>
                      <SelectItem value="published">Published</SelectItem>
                      <SelectItem value="failed">Failed</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={rangeFilter} onValueChange={v => setRangeFilter(v as never)}>
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
                <CalendarView
                  weekStart={weekStart} setWeekStart={setWeekStart} items={filtered}
                  onOpen={setSelected} onDragStart={setDragId} onDropOnDay={onDropOnDay}
                  onSchedule={() => setCreateOpen(true)}
                />
              </TabsContent>
              <TabsContent value="queue" className="mt-4">
                <QueueView
                  items={filtered.filter(i => ["scheduled","publishing","failed"].includes(i.status))}
                  onOpen={setSelected} onCancel={removeItem} onPublishNow={publishNow} onRetry={retryPublish}
                  onSchedule={() => setCreateOpen(true)}
                />
              </TabsContent>
              <TabsContent value="history" className="mt-4">
                <HistoryView
                  items={filtered.filter(i => ["published","failed"].includes(i.status))}
                  onOpen={setSelected} onRetry={retryPublish}
                />
              </TabsContent>
            </Tabs>
          </div>
        </main>
      </SidebarInset>

      <DetailSheet
        item={selected} onClose={() => setSelected(null)}
        fanvueToken={fanvueToken} onRetry={retryPublish} onPublishNow={publishNow} onRemove={removeItem}
      />
      <CreateScheduleDialog open={createOpen} onOpenChange={setCreateOpen} fanvueToken={fanvueToken}/>
      <AccountDialog
        open={accountOpen} onOpenChange={setAccountOpen} token={fanvueToken}
        onDisconnect={() => { clearToken(); setFanvueToken(null); toast.success("Fanvue account disconnected"); }}
      />
      <DebugPanel logs={logs} onClear={clearLogs}/>
    </SidebarProvider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Calendar view
// ─────────────────────────────────────────────────────────────────────────────
function CalendarView({ weekStart, setWeekStart, items, onOpen, onDragStart, onDropOnDay, onSchedule }: {
  weekStart: Date; setWeekStart: (d: Date) => void; items: ScheduledItem[];
  onOpen: (i: ScheduledItem) => void; onDragStart: (id: string|null) => void;
  onDropOnDay: (d: Date) => void; onSchedule: () => void;
}) {
  const days  = Array.from({ length: 7 }).map((_, i) => { const d = new Date(weekStart); d.setDate(d.getDate()+i); return d; });
  const move  = (n: number) => { const d = new Date(weekStart); d.setDate(d.getDate()+n*7); setWeekStart(d); };
  const today = new Date();
  const byDay = (day: Date) => items.filter(i => sameDay(new Date(i.scheduledAt), day)).sort((a, b) => +new Date(a.scheduledAt) - +new Date(b.scheduledAt));

  return (
    <Card className="border-border/60 bg-card">
      <CardContent className="p-4">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="font-display text-lg font-semibold">{weekStart.toLocaleDateString([],{month:"long",year:"numeric"})}</p>
            <p className="text-xs text-muted-foreground">Drag cards to reschedule</p>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => move(-1)}><ChevronLeft className="h-4 w-4"/></Button>
            <Button variant="outline" size="sm" className="h-8" onClick={() => {
              const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()-d.getDay()); setWeekStart(d);
            }}>Today</Button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => move(1)}><ChevronRight className="h-4 w-4"/></Button>
          </div>
        </div>
        {items.length === 0 ? <EmptyState onSchedule={onSchedule}/> : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-7">
            {days.map(day => {
              const di      = byDay(day);
              const isToday = sameDay(day, today);
              return (
                <div key={day.toISOString()} onDragOver={e => e.preventDefault()} onDrop={() => onDropOnDay(day)}
                  className="flex min-h-[260px] flex-col rounded-lg border border-border/60 bg-background/40 p-2 hover:border-primary/40 transition-colors">
                  <div className="mb-2 flex items-baseline justify-between px-1">
                    <p className={cn("text-[10px] font-medium uppercase tracking-wider", isToday ? "text-primary" : "text-muted-foreground")}>
                      {day.toLocaleDateString([],{weekday:"short"})}
                    </p>
                    <p className={cn("font-display text-lg font-semibold", isToday ? "text-primary" : "text-foreground")}>
                      {day.getDate()}
                    </p>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {di.map(i => (
                      <button key={i.id} type="button" draggable onDragStart={() => onDragStart(i.id)} onClick={() => onOpen(i)}
                        className="flex flex-col gap-1.5 rounded-md border border-border/60 bg-card p-1.5 text-left hover:border-primary/50 transition-colors">
                        <div className="relative h-16 w-full overflow-hidden rounded">
                          <img src={i.thumbnail} alt="" className="h-full w-full object-cover"/>
                          <div className="absolute left-1 top-1 grid h-5 w-5 place-items-center rounded bg-black/60">
                            {i.type==="video" ? <VideoIcon className="h-3 w-3 text-white"/> : <ImageIcon className="h-3 w-3 text-white"/>}
                          </div>
                          <div className="absolute right-1 top-1"><StatusBadge status={i.status}/></div>
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

// ─────────────────────────────────────────────────────────────────────────────
// Queue view
// ─────────────────────────────────────────────────────────────────────────────
function QueueView({ items, onOpen, onCancel, onPublishNow, onRetry, onSchedule }: {
  items: ScheduledItem[]; onOpen: (i: ScheduledItem) => void;
  onCancel: (id: string) => void; onPublishNow: (id: string) => void;
  onRetry: (id: string) => void; onSchedule: () => void;
}) {
  if (items.length === 0) return (
    <Card className="border-border/60 bg-card">
      <CardContent className="p-4"><EmptyState onSchedule={onSchedule} message="Publishing queue is empty."/></CardContent>
    </Card>
  );
  return (
    <div className="grid gap-3">
      {items.map(i => (
        <Card key={i.id} className="border-border/60 bg-card hover:border-primary/40 transition-colors">
          <CardContent className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
            <button type="button" onClick={() => onOpen(i)} className="relative h-20 w-32 shrink-0 overflow-hidden rounded-md bg-muted">
              <img src={i.thumbnail} alt="" className="h-full w-full object-cover hover:scale-105 transition-transform"/>
              {i.type==="video" && <div className="absolute inset-0 grid place-items-center bg-black/30"><Play className="h-5 w-5 text-white"/></div>}
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-semibold">{i.contentName}</p>
                <QueueBadge status={i.queueStatus}/>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{i.character}</p>
              <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3"/> {fmtDT(i.scheduledAt)}
              </p>
              {!i.mediaUrl && (
                <p className="mt-1 text-[10px] text-destructive font-medium">
                  ⚠ No media URL — check Supabase images/videos table
                </p>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {i.status === "failed" ? (
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onRetry(i.id)}>
                  <RefreshCw className="h-3.5 w-3.5"/> Retry
                </Button>
              ) : (
                <Button size="sm" variant="outline" className="gap-1.5"
                  onClick={() => onPublishNow(i.id)}
                  disabled={i.status==="publishing" || !i.mediaUrl}>
                  {i.status==="publishing"
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin"/>
                    : <Send className="h-3.5 w-3.5"/>}
                  {i.status==="publishing" ? "Publishing…" : "Publish now"}
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon" variant="ghost" className="h-8 w-8"><MoreHorizontal className="h-4 w-4"/></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => onOpen(i)}><Eye className="mr-2 h-4 w-4"/> View details</DropdownMenuItem>
                  <DropdownMenuSeparator/>
                  <DropdownMenuItem onClick={() => onCancel(i.id)} className="text-destructive focus:text-destructive">
                    <Trash2 className="mr-2 h-4 w-4"/> Cancel
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
// History view
// ─────────────────────────────────────────────────────────────────────────────
function HistoryView({ items, onOpen, onRetry }: {
  items: ScheduledItem[]; onOpen: (i: ScheduledItem) => void; onRetry: (id: string) => void;
}) {
  if (items.length === 0) return (
    <Card className="border-border/60 bg-card">
      <CardContent className="p-10 text-center">
        <Inbox className="mx-auto h-10 w-10 text-muted-foreground/60"/>
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
          <div className="col-span-3">Published</div>
          <div className="col-span-2">Post ID</div>
          <div className="col-span-1 text-right">Status</div>
        </div>
        {items.map(i => (
          <button key={i.id} type="button" onClick={() => onOpen(i)}
            className="grid w-full grid-cols-12 items-center gap-3 border-b border-border/40 px-4 py-3 text-left hover:bg-muted/40 last:border-b-0 transition-colors">
            <div className="col-span-6 flex items-center gap-3">
              <div className="relative h-12 w-16 shrink-0 overflow-hidden rounded">
                <img src={i.thumbnail} alt="" className="h-full w-full object-cover"/>
                {i.type==="video" && <div className="absolute inset-0 grid place-items-center bg-black/30"><Play className="h-3.5 w-3.5 text-white"/></div>}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{i.contentName}</p>
                <p className="truncate text-xs text-muted-foreground">{i.character}</p>
              </div>
            </div>
            <div className="col-span-3 text-xs text-muted-foreground">
              {i.publishedAt ? fmtDT(i.publishedAt) : fmtDT(i.scheduledAt)}
            </div>
            <div className="col-span-2">
              {i.externalPostId ? (
                <a href={`https://www.fanvue.com/post/${i.externalPostId}`} target="_blank" rel="noopener noreferrer"
                  className="truncate font-mono text-[11px] text-primary hover:underline flex items-center gap-1"
                  onClick={e => e.stopPropagation()}>
                  {i.externalPostId.slice(0, 10)}… <ExternalLink className="h-3 w-3 flex-shrink-0"/>
                </a>
              ) : (
                <span className="font-mono text-[11px] text-muted-foreground">—</span>
              )}
            </div>
            <div className="col-span-1 flex items-center justify-end gap-2">
              <StatusBadge status={i.status}/>
              {i.status==="failed" && (
                <Button size="icon" variant="ghost" className="h-7 w-7"
                  onClick={e => { e.stopPropagation(); onRetry(i.id); }}>
                  <RefreshCw className="h-3.5 w-3.5"/>
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
// Empty state
// ─────────────────────────────────────────────────────────────────────────────
function EmptyState({ onSchedule, message = "No scheduled content." }: { onSchedule: () => void; message?: string }) {
  return (
    <div className="mx-auto max-w-md py-10 text-center">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-border/60 bg-background">
        <CalendarClock className="h-6 w-6 text-muted-foreground"/>
      </div>
      <p className="mt-4 font-display text-lg font-semibold">{message}</p>
      <p className="mt-1 text-sm text-muted-foreground">Pick an approved asset and schedule it to Fanvue.</p>
      <Button size="sm" className="mt-5 gap-2" onClick={onSchedule}>
        <CalendarPlus className="h-4 w-4"/> Schedule content
      </Button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Detail sheet
// ─────────────────────────────────────────────────────────────────────────────
function DetailSheet({ item, onClose, fanvueToken, onRetry, onPublishNow, onRemove }: {
  item: ScheduledItem|null; onClose: () => void; fanvueToken: StoredToken|null;
  onRetry: (id: string) => void; onPublishNow: (id: string) => void; onRemove: (id: string) => void;
}) {
  return (
    <Sheet open={!!item} onOpenChange={o => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {item && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                {item.contentName} <StatusBadge status={item.status}/>
              </SheetTitle>
              <SheetDescription>
                {item.character} · {item.type} · {fmtDT(item.scheduledAt)}
              </SheetDescription>
            </SheetHeader>
            <div className="mt-6 space-y-5">
              {/* Preview */}
              <div className="relative aspect-video overflow-hidden rounded-lg bg-muted">
                {item.type === "video"
                  ? <video src={item.mediaUrl || item.thumbnail} controls playsInline className="h-full w-full object-cover"/>
                  : <img src={item.mediaUrl || item.thumbnail} alt="" className="h-full w-full object-cover"/>}
              </div>

              {/* Meta */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-md border border-border bg-background/40 p-3">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Scheduled</p>
                  <p className="mt-1 text-sm">{fmtDT(item.scheduledAt)}</p>
                </div>
                <div className="rounded-md border border-border bg-background/40 p-3">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Fanvue Account</p>
                  <p className="mt-1 text-sm">
                    {fanvueToken
                      ? `${fanvueToken.name} (@${fanvueToken.handle})`
                      : <span className="text-muted-foreground">Not connected</span>}
                  </p>
                </div>
              </div>

              {/* No media URL warning */}
              {!item.mediaUrl && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
                  <AlertTriangle className="h-4 w-4 text-destructive mt-px flex-shrink-0"/>
                  <div className="text-xs text-destructive">
                    <p className="font-medium">No media URL found</p>
                    <p className="mt-0.5 text-destructive/80">
                      Check the <code>{item.type==="image" ? "images" : "videos"}</code> table in Supabase —
                      the <code>{item.type==="image" ? "image_url" : "video_url"}</code> column may be empty.
                    </p>
                  </div>
                </div>
              )}

              {/* Published post link */}
              {item.externalPostId && (
                <div className="rounded-md border border-success/30 bg-success/5 p-3">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Published Post</p>
                  <p className="mt-1 font-mono text-xs break-all">{item.externalPostId}</p>
                  <a href={`https://www.fanvue.com/post/${item.externalPostId}`} target="_blank" rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1.5 text-xs text-primary hover:underline">
                    <ExternalLink className="h-3 w-3"/> View post on Fanvue
                  </a>
                </div>
              )}

              {/* Manual fallback */}
              {item.mediaUrl && item.status !== "published" && (
                <div className="rounded-md border border-border bg-muted/20 p-3 space-y-2">
                  <p className="text-xs font-medium text-foreground">Post manually on Fanvue</p>
                  <p className="text-xs text-muted-foreground">
                    Can't publish via API? Copy the media URL to post manually from your Fanvue dashboard.
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 rounded bg-background border border-border px-2 py-1 text-[11px] font-mono break-all text-foreground">
                      {item.mediaUrl}
                    </code>
                    <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(item.mediaUrl); toast.success("URL copied!"); }}>
                      Copy
                    </Button>
                  </div>
                  <Button size="sm" variant="outline" className="w-full gap-1.5" asChild>
                    <a href="https://fanvue.com/posts/create" target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-3.5 w-3.5"/> Open Fanvue post creator
                    </a>
                  </Button>
                </div>
              )}

              {/* Scene prompts */}
              <div>
                <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Scene prompts</p>
                <ScrollArea className="h-32 rounded-md border border-border bg-background/40 p-3">
                  <ol className="space-y-2 text-xs">
                    {item.scenePrompts.map((p, i) => (
                      <li key={i} className="leading-relaxed">
                        <span className="mr-1 text-muted-foreground">{i+1}.</span>{p}
                      </li>
                    ))}
                  </ol>
                </ScrollArea>
              </div>

              {/* History */}
              <div>
                <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">History</p>
                <ol className="relative space-y-3 border-l border-border pl-4">
                  {item.history.map((h, i) => (
                    <li key={i} className="relative">
                      <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-primary ring-4 ring-background"/>
                      <p className="text-xs font-medium">{h.label}</p>
                      <p className="text-[11px] text-muted-foreground">{fmtDT(h.at)}</p>
                    </li>
                  ))}
                </ol>
              </div>

              <Separator/>
              <div className="flex flex-wrap items-center gap-2">
                {item.status === "failed" ? (
                  <Button size="sm" className="gap-2" onClick={() => onRetry(item.id)}>
                    <RefreshCw className="h-4 w-4"/> Retry
                  </Button>
                ) : item.status !== "published" ? (
                  <Button size="sm" className="gap-2" onClick={() => onPublishNow(item.id)}
                    disabled={item.status==="publishing" || !item.mediaUrl || !fanvueToken}>
                    {item.status==="publishing"
                      ? <Loader2 className="h-4 w-4 animate-spin"/>
                      : <Send className="h-4 w-4"/>}
                    {item.status==="publishing" ? "Publishing…" : "Publish now to Fanvue"}
                  </Button>
                ) : null}
                <Button size="sm" variant="outline" className="gap-2 text-destructive hover:text-destructive"
                  onClick={() => onRemove(item.id)}>
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

// ─────────────────────────────────────────────────────────────────────────────
// Create schedule dialog
// ─────────────────────────────────────────────────────────────────────────────
function CreateScheduleDialog({ open, onOpenChange, fanvueToken }: {
  open: boolean; onOpenChange: (o: boolean) => void; fanvueToken: StoredToken|null;
}) {
  const queryClient = useQueryClient();
  const { data: assets = [] } = useQuery({
    queryKey: ["approved-assets"],
    queryFn:  fetchApprovedAssets,
    enabled:  open,
  });
  const [contentIdx, setContentIdx] = useState("0");
  const [date,       setDate]       = useState(() => {
    const d = new Date(); d.setDate(d.getDate()+1); return d.toISOString().slice(0, 10);
  });
  const [time, setTime] = useState("18:00");

  const submit = async () => {
    const asset = assets[Number(contentIdx)];
    if (!asset) { toast.error("Pick an approved asset first"); return; }
    const iso = new Date(`${date}T${time}:00`).toISOString();
    try {
      const { data: userRes } = await supabase.auth.getUser();
      await scheduleService.create({
        content_type: asset.type,
        content_id:   asset.id,
        publish_time: iso,
        platform:     "Fanvue",
        status:       "scheduled",
        created_by:   userRes.user?.id ?? null,
      } as any);
      toast.success("Content scheduled ✅");
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
                  No approved content yet. Approve items in the Review Queue first.
                </p>
              : <Select value={contentIdx} onValueChange={setContentIdx}>
                  <SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent>
                    {assets.map((a, i) => <SelectItem key={a.id} value={String(i)}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
            }
          </div>
          <div className="space-y-1.5">
            <Label>Publishing account</Label>
            {fanvueToken ? (
              <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/5 px-3 py-2">
                <span className="h-2 w-2 rounded-full bg-success flex-shrink-0"/>
                <span className="text-sm font-medium">{fanvueToken.name}</span>
                <span className="text-xs text-muted-foreground">@{fanvueToken.handle}</span>
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground mb-2">No Fanvue account connected yet.</p>
                <Button size="sm" className="gap-2 w-full" onClick={() => { onOpenChange(false); startFanvueOAuth(); }}>
                  <ExternalLink className="h-3.5 w-3.5"/> Connect Fanvue Account
                </Button>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Date</Label>
              <Input type="date" value={date} onChange={e => setDate(e.target.value)}/>
            </div>
            <div className="space-y-1.5">
              <Label>Time</Label>
              <Input type="time" value={time} onChange={e => setTime(e.target.value)}/>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} className="gap-2" disabled={!assets.length}>
            <CalendarPlus className="h-4 w-4"/> Schedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
