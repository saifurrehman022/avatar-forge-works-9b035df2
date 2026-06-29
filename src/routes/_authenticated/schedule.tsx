
/**
 * schedule.tsx — Lila Studio Scheduling Page
 *
 * Fixed issues:
 * 1. UI wipe after OAuth redirect — now uses "connecting" state to prevent
 *    premature re-renders while code exchange is in flight
 * 2. Token stored in localStorage so it survives page reloads
 * 3. Publish pipeline corrected against official Fanvue API docs:
 *    POST   /media/uploads           → { mediaUuid, uploadId }
 *    GET    /media/uploads/{id}/parts/1/url → presigned S3 URL (text/plain)
 *    PUT    {presignedUrl}           → binary upload, returns ETag
 *    PATCH  /media/uploads/{id}      → complete; status becomes "processing"
 *    GET    /media/{uuid}            → poll until status === "ready"
 *    POST   /posts                   → 201 { uuid, … }
 * 4. "Quick Post by URL" feature — paste any CloudFront/Supabase URL directly
 * 5. Debug log panel at bottom of page
 */

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { scheduleService } from "@/services";
import {
  CalendarClock, CalendarPlus, CheckCircle2, Clock, Search,
  Image as ImageIcon, Video as VideoIcon, Play, ArrowLeft, Send,
  Filter, Inbox, ChevronLeft, ChevronRight, MoreHorizontal,
  Trash2, Eye, RefreshCw, Link2, AlertTriangle, Loader2, Plug,
  CheckCircle, XCircle, ExternalLink, Bug, ChevronDown, ChevronUp,
  Link as LinkIcon,
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
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Fanvue OAuth constants
// ─────────────────────────────────────────────────────────────────────────────
const FV_CLIENT_ID     = "f9d35fff-3d12-4dd5-8945-750c37d65ae9";
const FV_CLIENT_SECRET = "05275891c81581c5cb79d336c8e9f87680f0976843bf17d6737bdcf0dde38b1a";
const FV_REDIRECT_URI  = "https://avatar-forge-works-9b035df2-j56ivc6di-saifurrehman022s-projects.vercel.app/schedule";
const FV_AUTH_URL      = "https://auth.fanvue.com/oauth2/auth";
const FV_TOKEN_URL     = "https://auth.fanvue.com/oauth2/token";
const FV_API           = "https://api.fanvue.com";
const FV_VERSION       = "2025-06-26"; // required on every request

const fvHeaders = (token: string, extra?: Record<string, string>) => ({
  Authorization: `Bearer ${token}`,
  "X-Fanvue-API-Version": FV_VERSION,
  ...extra,
});

// ─────────────────────────────────────────────────────────────────────────────
// Token — stored in localStorage so it survives page reloads & OAuth redirects
// ─────────────────────────────────────────────────────────────────────────────
const TOKEN_KEY = "fanvue_token_v2";

type FvToken = {
  accessToken:   string;
  refreshToken?: string;
  expiresAt?:    number; // ms epoch
  name:          string;
  handle:        string;
};

const tokenStore = {
  save:  (t: FvToken)        => { try { localStorage.setItem(TOKEN_KEY, JSON.stringify(t)); } catch {} },
  load:  (): FvToken | null  => { try { const r = localStorage.getItem(TOKEN_KEY); return r ? JSON.parse(r) : null; } catch { return null; } },
  clear: ()                  => { try { localStorage.removeItem(TOKEN_KEY); } catch {} },
};

// ─────────────────────────────────────────────────────────────────────────────
// Debug log (pub/sub so it works outside React)
// ─────────────────────────────────────────────────────────────────────────────
type LogLevel = "info" | "warn" | "error" | "ok";
type LogEntry = { id: number; at: number; level: LogLevel; msg: string; detail?: string };
let _logSeq = 0;
const _logListeners = new Set<(e: LogEntry) => void>();

function emit(level: LogLevel, msg: string, detail?: string) {
  const e: LogEntry = { id: ++_logSeq, at: Date.now(), level, msg, detail };
  const method = level === "error" ? "error" : level === "warn" ? "warn" : "log";
  console[method](`[FV:${level.toUpperCase()}]`, msg, detail ?? "");
  _logListeners.forEach(fn => fn(e));
}
const li  = (m: string, d?: string) => emit("info",  m, d);
const lw  = (m: string, d?: string) => emit("warn",  m, d);
const le  = (m: string, d?: string) => emit("error", m, d);
const lok = (m: string, d?: string) => emit("ok",    m, d);

function useDebugLog() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  useEffect(() => {
    const fn = (e: LogEntry) => setLogs(prev => [e, ...prev].slice(0, 400));
    _logListeners.add(fn);
    return () => { _logListeners.delete(fn); };
  }, []);
  const clearLogs = useCallback(() => setLogs([]), []);
  return { logs, clearLogs };
}

// ─────────────────────────────────────────────────────────────────────────────
// PKCE helpers (Fanvue requires PKCE — without it the auth server rejects)
// ─────────────────────────────────────────────────────────────────────────────
function b64url(buf: ArrayBuffer): string {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
async function makePKCE() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  const verifier  = b64url(arr.buffer);
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  return { verifier, challenge };
}
const SS_VERIFIER = "fv_pkce_verifier";
const SS_STATE    = "fv_oauth_state";

/** Redirects the browser to Fanvue for authorization */
async function startFanvueOAuth() {
  const { verifier, challenge } = await makePKCE();
  const state = crypto.randomUUID();
  sessionStorage.setItem(SS_VERIFIER, verifier);
  sessionStorage.setItem(SS_STATE, state);

  const params = new URLSearchParams({
    client_id:             FV_CLIENT_ID,
    redirect_uri:          FV_REDIRECT_URI,
    response_type:         "code",
    // Scopes per docs — read:media required to poll /media/{uuid} status
    scope:                 "openid offline_access read:self read:media write:media write:post",
    state,
    code_challenge:        challenge,
    code_challenge_method: "S256",
  });
  window.location.href = `${FV_AUTH_URL}?${params}`;
}

/**
 * Exchanges the OAuth authorization code for tokens.
 * Called once after Fanvue redirects back with ?code=...
 * Returns the token object and saves it to localStorage.
 */
async function exchangeFanvueCode(code: string): Promise<FvToken> {
  const verifier = sessionStorage.getItem(SS_VERIFIER);
  if (!verifier) throw new Error("PKCE verifier missing. Click Connect Fanvue again.");
  sessionStorage.removeItem(SS_VERIFIER);
  sessionStorage.removeItem(SS_STATE);

  li("Exchanging code for Fanvue token…");
  const res = await fetch(FV_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "authorization_code",
      code,
      redirect_uri:  FV_REDIRECT_URI,
      client_id:     FV_CLIENT_ID,
      client_secret: FV_CLIENT_SECRET,
      code_verifier: verifier,
    }).toString(),
  });

  const raw = await res.text();
  li(`Token endpoint ${res.status}`, raw.slice(0, 400));
  if (!res.ok) throw new Error(`Token exchange failed (${res.status}): ${raw.slice(0, 300)}`);

  const tokens = JSON.parse(raw);
  const at = tokens.access_token as string;

  // Fetch profile
  li("Fetching Fanvue profile…");
  const pr = await fetch(`${FV_API}/users/me`, { headers: fvHeaders(at) });
  const pt = await pr.text();
  li(`/users/me ${pr.status}`, pt.slice(0, 300));
  const profile = pr.ok ? JSON.parse(pt) : {};

  const token: FvToken = {
    accessToken:   at,
    refreshToken:  tokens.refresh_token,
    expiresAt:     tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined,
    name:   profile.displayName ?? profile.name   ?? profile.username ?? "Fanvue Account",
    handle: profile.username    ?? profile.handle ?? "fanvue",
  };
  tokenStore.save(token);
  lok(`Connected as @${token.handle} (${token.name})`);
  return token;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fanvue publish pipeline — based on official API docs
//
// Steps:
//  1. POST /media/uploads              → { mediaUuid, uploadId }
//  2. GET  /media/uploads/{id}/parts/1/url → text/plain presigned S3 URL
//  3. PUT  {presignedUrl}              → binary blob, get ETag from response
//  4. PATCH /media/uploads/{id}        → { parts:[{PartNumber,ETag}] } → complete
//  5. Poll GET /media/{uuid}           → wait for status === "ready"
//  6. POST /posts                      → 201 { uuid }
// ─────────────────────────────────────────────────────────────────────────────

/** Download binary from a URL. Tries direct fetch first, then a Vercel proxy. */
async function downloadBlob(url: string): Promise<Blob> {
  li("Downloading media…", url.slice(0, 120));
  // Direct fetch works for:
  //   - Supabase public storage URLs (CORS allows *)
  //   - CloudFront if the distribution allows browser requests
  try {
    const r = await fetch(url);
    if (r.ok) {
      const b = await r.blob();
      if (b.size > 0) {
        lok(`Direct download: ${(b.size / 1024).toFixed(0)} KB, type=${b.type}`);
        return b;
      }
    }
    lw(`Direct fetch ${r.status} or empty blob`);
  } catch (err: any) {
    lw("Direct fetch error", err?.message ?? String(err));
  }

  // Server-side proxy fallback — create /api/proxy-media.ts in Vercel
  lw("Falling back to /api/proxy-media…");
  const proxy = `/api/proxy-media?url=${encodeURIComponent(url)}`;
  const r2 = await fetch(proxy);
  if (r2.ok) {
    const b = await r2.blob();
    if (b.size > 0) {
      lok(`Proxy download: ${(b.size / 1024).toFixed(0)} KB`);
      return b;
    }
  }
  throw new Error(
    `Cannot download media (${r2.status}). ` +
    `Ensure the Supabase storage bucket is PUBLIC, or add api/proxy-media.ts to your Vercel project. ` +
    `URL: ${url.slice(0, 100)}`
  );
}

async function publishToFanvue(params: {
  accessToken: string;
  mediaUrl:    string;
  mediaType:   "image" | "video";
  caption:     string;
  onProgress?: (msg: string) => void;
}): Promise<string> {
  const { accessToken, mediaUrl, mediaType, caption, onProgress } = params;
  const rpt = (msg: string) => { li(msg); onProgress?.(msg); };

  // ── Verify token ────────────────────────────────────────────────────────
  rpt("Verifying Fanvue credentials…");
  const meRes = await fetch(`${FV_API}/users/me`, { headers: fvHeaders(accessToken) });
  const meRaw = await meRes.text();
  li(`/users/me → ${meRes.status}`, meRaw.slice(0, 200));
  if (!meRes.ok) {
    le("Token rejected", meRaw);
    throw new Error(`Fanvue token rejected (${meRes.status}). Please disconnect and reconnect your account.`);
  }
  const me = JSON.parse(meRaw);
  lok(`Token valid — @${me.username ?? me.handle ?? "?"}`);

  // ── Download media ──────────────────────────────────────────────────────
  rpt("Downloading media file…");
  const blob     = await downloadBlob(mediaUrl);
  const ext      = mediaType === "video" ? "mp4" : "jpeg";
  const mimeType = mediaType === "video" ? "video/mp4" : "image/jpeg";
  const filename = `lila-${Date.now()}.${ext}`;
  rpt(`Downloaded ${(blob.size / 1024).toFixed(0)} KB`);

  // ── Step 1: Create upload session ───────────────────────────────────────
  rpt("Step 1/5 — Creating upload session…");
  li("POST /media/uploads", JSON.stringify({ name: filename, filename, mediaType }));
  const sessRes = await fetch(`${FV_API}/media/uploads`, {
    method: "POST",
    headers: fvHeaders(accessToken, { "Content-Type": "application/json" }),
    body: JSON.stringify({ name: filename, filename, mediaType }),
  });
  const sessRaw = await sessRes.text();
  li(`/media/uploads → ${sessRes.status}`, sessRaw.slice(0, 400));
  if (!sessRes.ok) throw new Error(`Create upload session failed (${sessRes.status}): ${sessRaw.slice(0, 300)}`);

  const sess = JSON.parse(sessRaw);
  const { mediaUuid, uploadId } = sess;
  if (!mediaUuid) throw new Error(`No mediaUuid in response: ${sessRaw.slice(0, 200)}`);
  if (!uploadId)  throw new Error(`No uploadId in response: ${sessRaw.slice(0, 200)}`);
  lok(`Session: mediaUuid=${mediaUuid}  uploadId=${uploadId}`);

  // ── Step 2: Get presigned S3 URL ─────────────────────────────────────────
  rpt("Step 2/5 — Getting upload URL…");
  const partUrl = `${FV_API}/media/uploads/${uploadId}/parts/1/url`;
  li(`GET ${partUrl}`);
  const partRes = await fetch(partUrl, { headers: fvHeaders(accessToken) });
  const partRaw = await partRes.text();
  li(`Part URL → ${partRes.status}`, partRaw.slice(0, 120));
  if (!partRes.ok) throw new Error(`Get presigned URL failed (${partRes.status}): ${partRaw.slice(0, 200)}`);

  // Response is text/plain — strip any surrounding quotes
  const presignedUrl = partRaw.trim().replace(/^"|"$/g, "");
  if (!presignedUrl.startsWith("https://")) {
    throw new Error(`Expected HTTPS presigned URL, got: "${presignedUrl.slice(0, 100)}"`);
  }
  lok("Got presigned URL ✓");

  // ── Step 3: PUT to S3 ────────────────────────────────────────────────────
  rpt(`Step 3/5 — Uploading ${(blob.size / 1024).toFixed(0)} KB to S3…`);
  li("PUT to S3", presignedUrl.slice(0, 80) + "…");
  const s3Res = await fetch(presignedUrl, {
    method: "PUT",
    body: blob,
    headers: { "Content-Type": mimeType },
    // No Authorization header — S3 presigned URLs are self-authenticating
  });
  li(`S3 PUT → ${s3Res.status}`);
  if (!s3Res.ok) {
    const s3Err = await s3Res.text();
    throw new Error(`S3 upload failed (${s3Res.status}): ${s3Err.slice(0, 300)}`);
  }
  const rawEtag = (s3Res.headers.get("ETag") ?? s3Res.headers.get("etag") ?? "")
    .replace(/"/g, ""); // strip surrounding quotes S3 wraps ETag in
  if (!rawEtag) throw new Error("S3 returned no ETag — upload may have failed silently");
  lok(`S3 upload OK — ETag: ${rawEtag}`);

  // ── Step 4: Complete upload session ──────────────────────────────────────
  rpt("Step 4/5 — Completing upload…");
  const completeBody = { parts: [{ PartNumber: 1, ETag: rawEtag }] };
  li(`PATCH /media/uploads/${uploadId}`, JSON.stringify(completeBody));
  const completeRes = await fetch(`${FV_API}/media/uploads/${uploadId}`, {
    method: "PATCH",
    headers: fvHeaders(accessToken, { "Content-Type": "application/json" }),
    body: JSON.stringify(completeBody),
  });
  const completeRaw = await completeRes.text();
  li(`Complete → ${completeRes.status}`, completeRaw.slice(0, 200));
  if (!completeRes.ok) throw new Error(`Complete upload failed (${completeRes.status}): ${completeRaw.slice(0, 200)}`);
  lok(`Upload completed — status: ${JSON.parse(completeRaw).status}`);

  // ── Step 5: Poll until media is ready ────────────────────────────────────
  // Official docs: status enum = "created" | "processing" | "ready" | "error"
  // Non-FINALISED media only returns { uuid, status } (no URLs)
  rpt("Step 4/5 — Waiting for Fanvue to process media…");
  const DEADLINE = Date.now() + 180_000; // 3-minute timeout
  let   lastStatus = "";
  while (Date.now() < DEADLINE) {
    const pollRes = await fetch(`${FV_API}/media/${mediaUuid}`, { headers: fvHeaders(accessToken) });
    const pollRaw = await pollRes.text();

    if (!pollRes.ok && pollRes.status !== 404) {
      // 404 can happen briefly right after upload — safe to retry
      throw new Error(`Media poll failed (${pollRes.status}): ${pollRaw.slice(0, 200)}`);
    }

    if (pollRes.ok) {
      const pollData = JSON.parse(pollRaw);
      const status   = (pollData.status ?? "").toLowerCase();
      if (status !== lastStatus) {
        li(`Media status: "${status}"`, pollRaw.slice(0, 200));
        lastStatus = status;
      }
      rpt(`Processing… (${status})`);

      if (status === "ready") {
        lok("Media ready ✓");
        break;
      }
      if (status === "error") {
        throw new Error(
          "Fanvue rejected the media during processing. " +
          "Images must be JPEG or PNG. Videos must be MP4 (H.264). " +
          `Full response: ${pollRaw.slice(0, 200)}`
        );
      }
      // "created" or "processing" → keep polling
    }
    await new Promise(r => setTimeout(r, 4_000));
  }
  if (Date.now() >= DEADLINE) {
    throw new Error("Timed out (3 min) waiting for Fanvue media to be ready. File may be too large.");
  }

  // ── Step 6: Create post ───────────────────────────────────────────────────
  // POST /posts → 201 { uuid, createdAt, text, audience, … }
  // audience is REQUIRED: "subscribers" | "followers-and-subscribers"
  rpt("Step 5/5 — Creating post…");
  const postBody = {
    text:       caption,
    mediaUuids: [mediaUuid],
    audience:   "followers-and-subscribers" as const,
  };
  li("POST /posts", JSON.stringify(postBody));
  const postRes = await fetch(`${FV_API}/posts`, {
    method: "POST",
    headers: fvHeaders(accessToken, { "Content-Type": "application/json" }),
    body: JSON.stringify(postBody),
  });
  const postRaw = await postRes.text();
  li(`POST /posts → ${postRes.status}`, postRaw.slice(0, 500));

  // Docs say 201 on success
  if (postRes.status !== 201 && !postRes.ok) {
    throw new Error(`Create post failed (${postRes.status}): ${postRaw.slice(0, 400)}`);
  }

  let postData: any;
  try { postData = JSON.parse(postRaw); }
  catch { throw new Error(`Non-JSON response from POST /posts: ${postRaw.slice(0, 200)}`); }

  // Official response field is "uuid"
  const postUuid = postData.uuid ?? postData.id ?? null;
  if (!postUuid) {
    throw new Error(
      `Post was created but Fanvue returned no UUID. Full response: ${postRaw.slice(0, 300)}`
    );
  }

  lok(`Published! Post UUID: ${postUuid}`);
  rpt(`✅ Done! Post UUID: ${postUuid}`);
  return postUuid as string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Route setup
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
      { name: "description", content: "Schedule and publish approved content to Fanvue." },
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

type HistoryEvent = {
  at: string;
  label: string;
  kind: "scheduled" | "publishing" | "published" | "failed" | "retried";
};

type ScheduledItem = {
  id:            string;
  contentName:   string;
  type:          ContentType;
  character:     string;
  thumbnail:     string;
  mediaUrl:      string;
  scheduledAt:   string;
  status:        PublishStatus;
  queueStatus:   QueueStatus;
  autoPublish:   boolean;
  externalPostId?: string;
  publishedAt?:  string;
  settings: { fps: number; framesPerScene: number; numScenes: number; samplingSteps: number };
  scenePrompts:  string[];
  negativePrompt: string;
  history:       HistoryEvent[];
};

const EMPTY_ITEMS: ScheduledItem[] = [];
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
    imgIds.length
      ? supabase.from("images").select("id,image_url,prompt,character_id,published_at,external_post_id,publish_status").in("id", imgIds)
      : Promise.resolve({ data: [] } as any),
    vidIds.length
      ? supabase.from("videos").select("id,video_url,prompt,scene_prompts,character_id,published_at,external_post_id,publish_status").in("id", vidIds)
      : Promise.resolve({ data: [] } as any),
    supabase.from("characters").select("id,name,reference_image_url"),
  ]);

  const imgMap  = new Map((imgRes.data  ?? []).map((i: any) => [i.id, i]));
  const vidMap  = new Map((vidRes.data  ?? []).map((v: any) => [v.id, v]));
  const charMap = new Map((charRes.data ?? []).map((c: any) => [c.id, c]));

  return (rows ?? []).map((r: any): ScheduledItem => {
    const isVid  = r.content_type === "video";
    const src    = isVid ? vidMap.get(r.content_id) : imgMap.get(r.content_id);
    const char   = src?.character_id ? charMap.get(src.character_id) : null;
    const scenes = isVid && Array.isArray(src?.scene_prompts)
      ? (src.scene_prompts as string[])
      : src?.prompt ? [src.prompt as string] : [];
    const media  = isVid ? src?.video_url : src?.image_url;
    const thumb  = char?.reference_image_url ?? media ?? PLACEHOLDER;

    const status: PublishStatus =
      r.status === "published" ? "published"
      : r.status === "failed"  ? "failed"
      : r.status === "publishing" ? "publishing"
      : "scheduled";

    const queueStatus: QueueStatus =
      status === "published"  ? "published"
      : status === "failed"   ? "failed"
      : status === "publishing" ? "publishing"
      : new Date(r.publish_time) <= new Date() ? "ready"
      : "waiting";

    return {
      id:          r.id,
      contentName: `${char?.name ?? "Lila"} — ${(scenes[0] ?? "Untitled").slice(0, 40)}`,
      type:        r.content_type,
      character:   char?.name ?? "Lila",
      thumbnail:   thumb,
      mediaUrl:    media ?? "",
      scheduledAt: r.publish_time,
      status,
      queueStatus,
      autoPublish: true,
      externalPostId: src?.external_post_id ?? undefined,
      publishedAt:    src?.published_at ?? undefined,
      settings: { fps: 16, framesPerScene: 257, numScenes: scenes.length || 1, samplingSteps: 29 },
      scenePrompts:   scenes,
      negativePrompt: "low quality, blurry, distorted face, watermark",
      history: [
        { at: r.created_at, label: `Scheduled for ${new Date(r.publish_time).toLocaleString()}`, kind: "scheduled" },
        ...(src?.published_at ? [{ at: src.published_at, label: "Published", kind: "published" as const }] : []),
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
  const cm = new Map((charRes.data ?? []).map((c: any) => [c.id, c]));
  return [
    ...(imgRes.data ?? []).map((i: any) => ({
      id:       i.id,
      type:     "image" as const,
      name:     `${cm.get(i.character_id)?.name ?? "Lila"} — ${(i.prompt ?? "Image").slice(0, 40)}`,
      mediaUrl: i.image_url ?? "",
      thumb:    i.image_url ?? cm.get(i.character_id)?.reference_image_url ?? PLACEHOLDER,
    })),
    ...(vidRes.data ?? []).map((v: any) => ({
      id:       v.id,
      type:     "video" as const,
      name:     `${cm.get(v.character_id)?.name ?? "Lila"} — ${(v.prompt ?? "Video").slice(0, 40)}`,
      mediaUrl: v.video_url ?? "",
      thumb:    cm.get(v.character_id)?.reference_image_url ?? PLACEHOLDER,
    })),
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Style constants
// ─────────────────────────────────────────────────────────────────────────────
const statusCls: Record<PublishStatus, string> = {
  scheduled:  "bg-chart-2/15 text-chart-2 border-chart-2/30",
  publishing: "bg-primary/15 text-primary border-primary/30",
  published:  "bg-success/15 text-success border-success/30",
  failed:     "bg-destructive/15 text-destructive border-destructive/30",
};
const queueCls: Record<QueueStatus, string> = {
  waiting:    "bg-muted text-muted-foreground border-border",
  ready:      "bg-chart-2/15 text-chart-2 border-chart-2/30",
  publishing: "bg-primary/15 text-primary border-primary/30",
  published:  "bg-success/15 text-success border-success/30",
  failed:     "bg-destructive/15 text-destructive border-destructive/30",
};
const logCls: Record<LogLevel, string> = {
  info:  "text-muted-foreground",
  warn:  "text-yellow-400",
  error: "text-red-400 font-semibold",
  ok:    "text-green-400",
};

const fmtTime = (s: string) => new Date(s).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const fmtDate = (s: string) => new Date(s).toLocaleDateString([], { month: "short", day: "numeric" });
const fmtDT   = (s: string) => `${fmtDate(s)} · ${fmtTime(s)}`;
const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

// ─────────────────────────────────────────────────────────────────────────────
// Shared UI pieces
// ─────────────────────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: PublishStatus }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider", statusCls[status])}>
      {status === "publishing" && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
      {status}
    </span>
  );
}
function QueueBadge({ status }: { status: QueueStatus }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider", queueCls[status])}>
      {status}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Debug panel — collapsible bottom bar
// ─────────────────────────────────────────────────────────────────────────────
function DebugPanel({ logs, onClear }: { logs: LogEntry[]; onClear: () => void }) {
  const [open, setOpen] = useState(false);
  const scrollRef       = useRef<HTMLDivElement>(null);
  const errCount        = logs.filter(l => l.level === "error").length;

  // Auto-open on first error
  useEffect(() => { if (errCount > 0) setOpen(true); }, [errCount]);

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 pointer-events-none">
      <div className="pointer-events-auto mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8">
        <div className={cn(
          "rounded-t-xl border border-border/80 bg-card shadow-2xl transition-all duration-200",
          open ? "max-h-72" : "max-h-10"
        )}>
          {/* Toggle bar */}
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-muted/30 rounded-t-xl"
          >
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
            <div className="ml-auto flex items-center gap-3">
              {open && (
                <button type="button" onClick={e => { e.stopPropagation(); onClear(); }}
                  className="text-[10px] text-muted-foreground hover:text-foreground">
                  Clear
                </button>
              )}
              {open
                ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                : <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />}
            </div>
          </button>

          {/* Log entries */}
          {open && (
            <div ref={scrollRef} className="h-56 overflow-y-auto border-t border-border/60 bg-background/95 font-mono">
              {logs.length === 0
                ? <p className="p-4 text-xs text-muted-foreground">No events yet. Click "Publish now" to see step-by-step output.</p>
                : logs.map(l => (
                    <div key={l.id} className="flex items-start gap-2 border-b border-border/20 px-3 py-1 last:border-0">
                      <span className="shrink-0 text-[10px] text-muted-foreground/50 tabular-nums pt-px">
                        {new Date(l.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </span>
                      <span className={cn("shrink-0 w-[52px] text-[10px]", logCls[l.level])}>
                        [{l.level.toUpperCase()}]
                      </span>
                      <div className="min-w-0 flex-1">
                        <span className={cn("text-[11px]", logCls[l.level])}>{l.msg}</span>
                        {l.detail && (
                          <p className="mt-0.5 break-all text-[10px] text-muted-foreground/60">{l.detail}</p>
                        )}
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
// Quick-post-by-URL dialog
// Paste any CloudFront or Supabase URL and immediately post to Fanvue
// ─────────────────────────────────────────────────────────────────────────────
function detectMediaType(url: string): "image" | "video" | null {
  if (/\.(jpe?g|png|webp|gif)(\?.*)?$/i.test(url)) return "image";
  if (/\.(mp4|mov|webm|m4v)(\?.*)?$/i.test(url))   return "video";
  return null;
}

function QuickPostDialog({
  open, onOpenChange, token,
}: { open: boolean; onOpenChange: (o: boolean) => void; token: FvToken | null }) {
  const [url,        setUrl]        = useState("");
  const [caption,    setCaption]    = useState("");
  const [busy,       setBusy]       = useState(false);
  const [lastPostId, setLastPostId] = useState<string | null>(null);

  const detectedType = detectMediaType(url);

  const handlePost = async () => {
    if (!token) { toast.error("Connect your Fanvue account first"); return; }
    const trimmedUrl = url.trim();
    if (!trimmedUrl) { toast.error("Enter a media URL"); return; }
    if (!detectedType) {
      toast.error("Could not detect media type. URL must end in .jpg, .jpeg, .png, .mp4, etc.");
      return;
    }

    setBusy(true);
    const tid = "quick-post";
    toast.loading("Posting to Fanvue…", { id: tid, duration: Infinity });

    try {
      const postUuid = await publishToFanvue({
        accessToken: token.accessToken,
        mediaUrl:    trimmedUrl,
        mediaType:   detectedType,
        caption:     caption.trim() || "New post from Lila Studio",
        onProgress:  s => toast.loading(s, { id: tid, duration: Infinity }),
      });

      setLastPostId(postUuid);
      toast.success("Posted to Fanvue!", {
        id:       tid,
        duration: 15_000,
        description: `Post UUID: ${postUuid}`,
        action: { label: "View", onClick: () => window.open(`https://www.fanvue.com/post/${postUuid}`, "_blank") },
      });
      setUrl(""); setCaption("");
    } catch (e: any) {
      le("Quick-post failed", e.message);
      toast.error("Post failed — see debug log ↓", {
        id: tid,
        description: e.message.slice(0, 200),
        duration: 20_000,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LinkIcon className="h-4 w-4" /> Quick Post by URL
          </DialogTitle>
          <DialogDescription>
            Paste a CloudFront or Supabase media URL to post it directly to your Fanvue account.
            Works with your existing hosted assets — no re-upload to our servers needed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Media URL</Label>
            <Input
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://d2p7pge43lyniu.cloudfront.net/output/…jpeg"
            />
            {url.trim() && (
              <p className={cn("text-[11px]", detectedType ? "text-success" : "text-warning")}>
                {detectedType
                  ? `✓ Detected as ${detectedType} — will upload to Fanvue media vault then create post`
                  : "⚠ Cannot detect file type from URL extension. Add .jpg/.png/.mp4 etc."}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Caption <span className="text-muted-foreground">(optional)</span></Label>
            <Input
              value={caption}
              onChange={e => setCaption(e.target.value)}
              placeholder="Check out my latest content! ✨"
            />
          </div>

          {/* Example URLs from the user's setup */}
          <div className="rounded-md border border-border/60 bg-muted/20 p-3 space-y-1.5">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Your known assets</p>
            <button
              type="button"
              onClick={() => setUrl("https://d2p7pge43lyniu.cloudfront.net/output/c7cd0631-5025-4d0f-a333-a0eb612b05fc-u2_c3e1a90d-0401-45a7-bba5-4d0029047395.jpeg")}
              className="block w-full text-left text-[11px] text-primary hover:underline truncate"
            >
              📷 CloudFront image (c7cd0631…)
            </button>
            <button
              type="button"
              onClick={() => setUrl("https://yaiygjwbtzevjpxncvzu.supabase.co/storage/v1/object/public/videos/52c86425-0381-4307-bd32-138b30da3c9f-e2_final.mp4")}
              className="block w-full text-left text-[11px] text-primary hover:underline truncate"
            >
              🎬 Supabase video (52c86425…)
            </button>
          </div>

          {!token ? (
            <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/5 p-3">
              <AlertTriangle className="h-4 w-4 text-warning flex-shrink-0" />
              <p className="text-xs">Connect your Fanvue account first (top-right button).</p>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/5 p-3">
              <span className="h-2 w-2 rounded-full bg-success flex-shrink-0" />
              <span className="text-xs text-foreground">
                Posting as <strong>@{token.handle}</strong> ({token.name})
              </span>
            </div>
          )}

          {lastPostId && (
            <div className="rounded-md border border-success/30 bg-success/5 p-3">
              <p className="text-xs font-medium text-success mb-1">Last post published ✓</p>
              <p className="font-mono text-[11px] break-all text-muted-foreground">{lastPostId}</p>
              <a
                href={`https://www.fanvue.com/post/${lastPostId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1.5 inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3" /> View on Fanvue
              </a>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button
            onClick={handlePost}
            disabled={busy || !url.trim() || !detectedType || !token}
            className="gap-2"
          >
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
function AccountDialog({
  open, onOpenChange, token, onDisconnect,
}: { open: boolean; onOpenChange: (o: boolean) => void; token: FvToken | null; onDisconnect: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Fanvue Account</DialogTitle>
          <DialogDescription>
            Connect your Fanvue creator account. Token is stored locally in your browser — no database required.
          </DialogDescription>
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
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="gap-1 border-success/40 text-success text-xs">
                  <CheckCircle className="h-3 w-3" /> Connected
                </Badge>
                <Button
                  size="sm" variant="ghost"
                  className="text-destructive hover:text-destructive text-xs"
                  onClick={onDisconnect}
                >
                  Disconnect
                </Button>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-muted/30 p-6 text-center">
              <Plug className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-2 text-sm font-medium">No account connected</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Connect your Fanvue creator account to start publishing.
              </p>
            </div>
          )}

          <div className="rounded-lg border border-border bg-muted/20 p-4">
            <p className="text-xs font-medium mb-1">{token ? "Reconnect account" : "Connect account"}</p>
            <p className="text-xs text-muted-foreground mb-3">
              You'll be redirected to Fanvue. After approving, you'll return here automatically.
              The page state is preserved using localStorage.
            </p>
            <Button
              className="w-full gap-2"
              onClick={() => { onOpenChange(false); startFanvueOAuth(); }}
            >
              <ExternalLink className="h-4 w-4" />
              {token ? "Reconnect Fanvue" : "Connect Fanvue Account"}
            </Button>
          </div>

          <div className="rounded-lg border border-border/40 bg-muted/10 p-3">
            <p className="text-[11px] font-medium text-muted-foreground">Scopes granted</p>
            <p className="text-[10px] text-muted-foreground/80 mt-1">
              read:self · read:media · write:media · write:post
            </p>
            <p className="text-[10px] text-muted-foreground/50 mt-1">
              If a publish returns 403, disconnect and reconnect to re-grant all scopes.
            </p>
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
// Main page component
// ─────────────────────────────────────────────────────────────────────────────
function SchedulePage() {
  const queryClient = useQueryClient();
  const { data: scheduleData = EMPTY_ITEMS } = useQuery({
    queryKey: ["schedules"],
    queryFn:  fetchSchedules,
    staleTime: 10_000,
  });

  const [items, setItems] = useState<ScheduledItem[]>([]);
  useEffect(() => setItems(scheduleData), [scheduleData]);

  // ── FIX: "connecting" state prevents blank UI during OAuth code exchange ──
  // When Fanvue redirects back with ?code=..., we need a brief loading phase
  // before the token is available. Without this, the UI renders as "no account"
  // which wipes the page content momentarily.
  const [token,      setToken]      = useState<FvToken | null>(() => tokenStore.load());
  const [connecting, setConnecting] = useState(false);
  const { logs, clearLogs }         = useDebugLog();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code   = params.get("code");
    const error  = params.get("error");

    if (error) {
      window.history.replaceState({}, "", window.location.pathname);
      toast.error(`Fanvue auth error: ${params.get("error_description") ?? error}`);
      le(`OAuth error: ${error}`, params.get("error_description") ?? "");
      return;
    }

    if (!code) return; // normal page load, no action needed

    // ── We have a code: clean the URL immediately so a refresh doesn't re-trigger ──
    window.history.replaceState({}, "", window.location.pathname);

    // Show a loading state BEFORE the async exchange runs
    setConnecting(true);
    toast.loading("Connecting Fanvue account…", { id: "fv-connect" });

    exchangeFanvueCode(code)
      .then(t => {
        setToken(t);
        setConnecting(false);
        toast.success(`Connected as @${t.handle}!`, { id: "fv-connect", duration: 6_000 });
        // Refetch schedules in case the page data is stale from the redirect
        queryClient.invalidateQueries({ queryKey: ["schedules"] });
      })
      .catch(err => {
        setConnecting(false);
        le("OAuth exchange failed", err.message);
        toast.error(err.message ?? "Failed to connect", { id: "fv-connect", duration: 12_000 });
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // only on mount

  // Realtime schedule updates
  useEffect(() => {
    const ch = supabase
      .channel("schedules-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "schedules" }, () => {
        queryClient.invalidateQueries({ queryKey: ["schedules"] });
      })
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
  const [quickOpen,    setQuickOpen]    = useState(false);
  const [weekStart,    setWeekStart]    = useState(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - d.getDay()); return d;
  });

  const stats = useMemo(() => {
    const now = new Date(); const wa = new Date(now); wa.setDate(wa.getDate() - 7);
    return {
      scheduled:     items.filter(i => i.status === "scheduled").length,
      today:         items.filter(i => i.status === "scheduled" && sameDay(new Date(i.scheduledAt), now)).length,
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
        if (rangeFilter === "today" && !sameDay(d, now))                              return false;
        if (rangeFilter === "week") { const w = new Date(now); w.setDate(w.getDate() + 7); if (d < now || d > w) return false; }
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

  const publishNow = async (id: string) => {
    const item = items.find(i => i.id === id);
    if (!item) return;

    // Load fresh from localStorage in case state is slightly stale
    const t = tokenStore.load();
    if (!t?.accessToken) {
      toast.error("No Fanvue account connected.", {
        action: { label: "Connect", onClick: () => setAccountOpen(true) },
        duration: 8_000,
      });
      return;
    }
    if (!item.mediaUrl) {
      toast.error("No media URL for this item. Check the images/videos table in Supabase.");
      return;
    }

    li(`Publishing item ${id}`, `type=${item.type} url=${item.mediaUrl}`);
    updateItem(id, { status: "publishing", queueStatus: "publishing" });
    const toastId = `pub-${id}`;
    toast.loading("Starting Fanvue publish…", { id: toastId, duration: Infinity });

    try {
      const postUuid = await publishToFanvue({
        accessToken: t.accessToken,
        mediaUrl:    item.mediaUrl,
        mediaType:   item.type,
        caption:     item.scenePrompts[0] ?? item.contentName,
        onProgress:  s => toast.loading(s, { id: toastId, duration: Infinity }),
      });

      const now   = new Date().toISOString();
      const table = item.type === "image" ? "images" : "videos";

      const { data: schedRow } = await supabase.from("schedules").select("content_id").eq("id", id).single();
      if (schedRow?.content_id) {
        const { error: ue } = await supabase.from(table).update({
          publish_status:  "published",
          published_at:    now,
          external_post_id: postUuid,
        }).eq("id", schedRow.content_id);
        if (ue) lw("Supabase update error", ue.message);
        else lok("Supabase record updated");
      }

      await scheduleService.update(id, { status: "published" });

      updateItem(id, {
        status: "published", queueStatus: "published",
        externalPostId: postUuid, publishedAt: now,
        history: [...item.history, { at: now, label: `Published to @${t.handle}`, kind: "published" }],
      });

      toast.success(`✅ Published to @${t.handle}!`, {
        id: toastId, duration: 15_000,
        description: `Post UUID: ${postUuid}`,
        action: { label: "View on Fanvue", onClick: () => window.open(`https://www.fanvue.com/post/${postUuid}`, "_blank") },
      });
      queryClient.invalidateQueries({ queryKey: ["schedules"] });

    } catch (e: any) {
      le("Publish FAILED", e.message);
      updateItem(id, {
        status: "failed", queueStatus: "failed",
        history: [...item.history, { at: new Date().toISOString(), label: `Failed: ${e.message.slice(0, 100)}`, kind: "failed" }],
      });
      try { await scheduleService.update(id, { status: "failed" }); } catch {}
      toast.error("Publish failed — open debug log ↓", {
        id: toastId, duration: 20_000,
        description: e.message.slice(0, 200),
      });
    }
  };

  const [dragId, setDragId] = useState<string | null>(null);
  const onDropOnDay = async (day: Date) => {
    if (!dragId) return;
    const item = items.find(i => i.id === dragId);
    if (!item) return;
    const nd = new Date(day); const od = new Date(item.scheduledAt);
    nd.setHours(od.getHours(), od.getMinutes(), 0, 0);
    const iso = nd.toISOString();
    updateItem(dragId, { scheduledAt: iso });
    try { await scheduleService.update(dragId, { publish_time: iso }); toast.success("Rescheduled"); }
    catch (e: any) { toast.error(e?.message ?? "Failed to reschedule"); }
    setDragId(null);
  };

  // ── Connecting overlay — prevents blank UI during code exchange ───────────
  if (connecting) {
    return (
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <AppHeader />
          <main className="flex flex-1 items-center justify-center bg-background">
            <div className="text-center space-y-4">
              <Loader2 className="mx-auto h-10 w-10 animate-spin text-primary" />
              <p className="text-lg font-semibold">Connecting Fanvue account…</p>
              <p className="text-sm text-muted-foreground">Exchanging OAuth token. Please wait.</p>
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

            {/* Header */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <Link to="/" className="mb-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
                  <ArrowLeft className="h-3.5 w-3.5" /> Dashboard
                </Link>
                <h1 className="font-display text-3xl font-semibold tracking-tight">Scheduling</h1>
                <p className="mt-1 text-sm text-muted-foreground">Plan, queue and publish approved content to your Fanvue account.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" className="gap-2" onClick={() => setQuickOpen(true)}>
                  <LinkIcon className="h-4 w-4" /> Post by URL
                </Button>
                <Button variant="outline" size="sm" className="gap-2" onClick={() => setAccountOpen(true)}>
                  <Plug className="h-4 w-4" />
                  {token
                    ? <span className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-success" />
                        <span className="max-w-[120px] truncate text-sm">{token.name}</span>
                      </span>
                    : "Connect Fanvue"}
                </Button>
                <Button size="sm" className="gap-2" onClick={() => setCreateOpen(true)}>
                  <CalendarPlus className="h-4 w-4" /> Schedule content
                </Button>
              </div>
            </div>

            {!token && (
              <div className="flex items-center gap-3 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3">
                <AlertTriangle className="h-4 w-4 flex-shrink-0 text-warning" />
                <p className="flex-1 text-sm">No Fanvue account connected. Connect one to start publishing.</p>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setAccountOpen(true)}>
                  <ExternalLink className="h-3.5 w-3.5" /> Connect now
                </Button>
              </div>
            )}

            {/* Stats */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <DashboardCard label="Scheduled"  value={stats.scheduled}     icon={CalendarClock} accent="primary"  hint="Awaiting publish" />
              <DashboardCard label="Today"      value={stats.today}         icon={Clock}         accent="chart-2"  hint="Next 24h" />
              <DashboardCard label="This week"  value={stats.weekPublished} icon={CheckCircle2}  accent="chart-3" />
              <DashboardCard label="Failed"     value={stats.failed}        icon={AlertTriangle} accent="chart-5"  hint={stats.failed ? "Needs attention" : "All clear"} />
            </div>

            {/* Filters */}
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

            {/* Tabs */}
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
                  onSchedule={() => setCreateOpen(true)} />
              </TabsContent>
              <TabsContent value="queue" className="mt-4">
                <QueueView
                  items={filtered.filter(i => ["scheduled", "publishing", "failed"].includes(i.status))}
                  onOpen={setSelected} onCancel={removeItem} onPublishNow={publishNow}
                  onRetry={retryPublish} onSchedule={() => setCreateOpen(true)} />
              </TabsContent>
              <TabsContent value="history" className="mt-4">
                <HistoryView
                  items={filtered.filter(i => ["published", "failed"].includes(i.status))}
                  onOpen={setSelected} onRetry={retryPublish} />
              </TabsContent>
            </Tabs>

          </div>
        </main>
      </SidebarInset>

      {/* Dialogs */}
      <DetailSheet item={selected} onClose={() => setSelected(null)} token={token}
        onRetry={retryPublish} onPublishNow={publishNow} onRemove={removeItem} />
      <CreateScheduleDialog open={createOpen} onOpenChange={setCreateOpen} token={token} />
      <AccountDialog open={accountOpen} onOpenChange={setAccountOpen} token={token}
        onDisconnect={() => { tokenStore.clear(); setToken(null); toast.success("Fanvue account disconnected"); }} />
      <QuickPostDialog open={quickOpen} onOpenChange={setQuickOpen} token={token} />

      {/* Sticky debug panel */}
      <DebugPanel logs={logs} onClear={clearLogs} />
    </SidebarProvider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Calendar view
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
            <p className="text-xs text-muted-foreground">Drag cards between days to reschedule</p>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => move(-1)}><ChevronLeft className="h-4 w-4" /></Button>
            <Button variant="outline" size="sm" className="h-8" onClick={() => {
              const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - d.getDay()); setWeekStart(d);
            }}>Today</Button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => move(1)}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>

        {items.length === 0
          ? <EmptyState onSchedule={onSchedule} />
          : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-7">
              {days.map(day => {
                const dayItems = items.filter(i => sameDay(new Date(i.scheduledAt), day)).sort((a, b) => +new Date(a.scheduledAt) - +new Date(b.scheduledAt));
                const isToday  = sameDay(day, today);
                return (
                  <div key={day.toISOString()} onDragOver={e => e.preventDefault()} onDrop={() => onDropOnDay(day)}
                    className="flex min-h-[260px] flex-col rounded-lg border border-border/60 bg-background/40 p-2 transition-colors hover:border-primary/40">
                    <div className="mb-2 flex items-baseline justify-between px-1">
                      <p className={cn("text-[10px] font-medium uppercase tracking-wider", isToday ? "text-primary" : "text-muted-foreground")}>
                        {day.toLocaleDateString([], { weekday: "short" })}
                      </p>
                      <p className={cn("font-display text-lg font-semibold", isToday ? "text-primary" : "text-foreground")}>
                        {day.getDate()}
                      </p>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {dayItems.map(i => (
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
                      {dayItems.length === 0 && <p className="px-1 pt-2 text-[11px] text-muted-foreground/70">Nothing scheduled</p>}
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
  items: ScheduledItem[]; onOpen: (i: ScheduledItem) => void; onCancel: (id: string) => void;
  onPublishNow: (id: string) => void; onRetry: (id: string) => void; onSchedule: () => void;
}) {
  if (items.length === 0) return (
    <Card className="border-border/60 bg-card"><CardContent className="p-4">
      <EmptyState onSchedule={onSchedule} message="Queue is empty." />
    </CardContent></Card>
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
              <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground"><Clock className="h-3 w-3" />{fmtDT(i.scheduledAt)}</p>
              {!i.mediaUrl && (
                <p className="mt-1 text-[10px] text-destructive">
                  ⚠ No media URL — check the {i.type === "image" ? "image_url" : "video_url"} column in Supabase
                </p>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {i.status === "failed"
                ? <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onRetry(i.id)}><RefreshCw className="h-3.5 w-3.5" /> Retry</Button>
                : <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onPublishNow(i.id)}
                    disabled={i.status === "publishing" || !i.mediaUrl}>
                    {i.status === "publishing" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    {i.status === "publishing" ? "Publishing…" : "Publish now"}
                  </Button>}
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button size="icon" variant="ghost" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
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
// History view
// ─────────────────────────────────────────────────────────────────────────────
function HistoryView({ items, onOpen, onRetry }: {
  items: ScheduledItem[]; onOpen: (i: ScheduledItem) => void; onRetry: (id: string) => void;
}) {
  if (items.length === 0) return (
    <Card className="border-border/60 bg-card"><CardContent className="p-10 text-center">
      <Inbox className="mx-auto h-10 w-10 text-muted-foreground/60" />
      <p className="mt-3 font-medium">No history yet</p>
      <p className="mt-1 text-sm text-muted-foreground">Published and failed posts appear here.</p>
    </CardContent></Card>
  );
  return (
    <Card className="border-border/60 bg-card">
      <CardContent className="p-0">
        <div className="grid grid-cols-12 gap-3 border-b border-border/60 px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          <div className="col-span-6">Content</div>
          <div className="col-span-3">Published</div>
          <div className="col-span-2">Post UUID</div>
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
            <div className="col-span-3 text-xs text-muted-foreground">{i.publishedAt ? fmtDT(i.publishedAt) : "—"}</div>
            <div className="col-span-2">
              {i.externalPostId
                ? <a href={`https://www.fanvue.com/post/${i.externalPostId}`} target="_blank" rel="noopener noreferrer"
                    className="truncate font-mono text-[11px] text-primary hover:underline flex items-center gap-1"
                    onClick={e => e.stopPropagation()}>
                    {i.externalPostId.slice(0, 8)}…<ExternalLink className="h-3 w-3 shrink-0" />
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
// Empty state
// ─────────────────────────────────────────────────────────────────────────────
function EmptyState({ onSchedule, message = "No scheduled content." }: { onSchedule: () => void; message?: string }) {
  return (
    <div className="mx-auto max-w-md py-10 text-center">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-border/60 bg-background">
        <CalendarClock className="h-6 w-6 text-muted-foreground" />
      </div>
      <p className="mt-4 font-display text-lg font-semibold">{message}</p>
      <p className="mt-1 text-sm text-muted-foreground">Pick an approved asset and schedule it to your Fanvue account.</p>
      <Button size="sm" className="mt-5 gap-2" onClick={onSchedule}>
        <CalendarPlus className="h-4 w-4" /> Schedule content
      </Button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Detail sheet
// ─────────────────────────────────────────────────────────────────────────────
function DetailSheet({ item, onClose, token, onRetry, onPublishNow, onRemove }: {
  item: ScheduledItem | null; onClose: () => void; token: FvToken | null;
  onRetry: (id: string) => void; onPublishNow: (id: string) => void; onRemove: (id: string) => void;
}) {
  return (
    <Sheet open={!!item} onOpenChange={o => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {item && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">{item.contentName} <StatusBadge status={item.status} /></SheetTitle>
              <SheetDescription>{item.character} · {item.type} · {fmtDT(item.scheduledAt)}</SheetDescription>
            </SheetHeader>

            <div className="mt-6 space-y-6">
              {/* Preview */}
              <div className="relative aspect-video overflow-hidden rounded-lg bg-muted">
                {item.type === "video"
                  ? <video src={item.mediaUrl || item.thumbnail} controls playsInline className="h-full w-full object-cover" />
                  : <img src={item.mediaUrl || item.thumbnail} alt="" className="h-full w-full object-cover" />}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Scheduled"      value={fmtDT(item.scheduledAt)} />
                <Field label="Fanvue account" value={token ? `${token.name} (@${token.handle})` : "Not connected"} />
                <Field label="Media URL"      value={item.mediaUrl ? "✓ Available" : "✗ Missing"} />
                <Field label="Review status"  value="Approved" />
              </div>

              {!item.mediaUrl && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
                  <AlertTriangle className="h-4 w-4 text-destructive mt-px shrink-0" />
                  <p className="text-xs text-destructive">
                    No media URL. Check the {item.type === "image" ? "image_url" : "video_url"} column in the
                    {" "}{item.type === "image" ? "images" : "videos"} Supabase table for this record.
                  </p>
                </div>
              )}

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
                <ScrollArea className="h-40 rounded-md border border-border bg-background/40 p-3">
                  <ol className="space-y-2 text-xs">
                    {item.scenePrompts.map((p, idx) => (
                      <li key={idx} className="leading-relaxed"><span className="mr-1 text-muted-foreground">{idx + 1}.</span>{p}</li>
                    ))}
                  </ol>
                </ScrollArea>
              </div>

              {/* Timeline */}
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

              <div className="flex flex-wrap items-center gap-2">
                {item.status === "failed"
                  ? <Button size="sm" className="gap-2" onClick={() => onRetry(item.id)}><RefreshCw className="h-4 w-4" /> Retry</Button>
                  : item.status !== "published"
                    ? <Button size="sm" className="gap-2" onClick={() => onPublishNow(item.id)}
                        disabled={item.status === "publishing" || !item.mediaUrl || !token}>
                        {item.status === "publishing" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        {item.status === "publishing" ? "Publishing…" : "Publish to Fanvue"}
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

function Field({ label, value }: { label: string; value: string }) {
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
function CreateScheduleDialog({
  open, onOpenChange, token,
}: { open: boolean; onOpenChange: (o: boolean) => void; token: FvToken | null }) {
  const queryClient = useQueryClient();
  const { data: assets = [] } = useQuery({
    queryKey: ["approved-assets"],
    queryFn:  fetchApprovedAssets,
    enabled:  open,
  });

  const [idx,  setIdx]  = useState("0");
  const [date, setDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); });
  const [time, setTime] = useState("18:00");

  const submit = async () => {
    const asset = assets[Number(idx)];
    if (!asset) { toast.error("Pick an approved asset first"); return; }
    const iso = new Date(`${date}T${time}:00`).toISOString();
    try {
      const { data: u } = await supabase.auth.getUser();
      await scheduleService.create({
        content_type: asset.type,
        content_id:   asset.id,
        publish_time: iso,
        platform:     "Fanvue",
        status:       "scheduled",
        created_by:   u.user?.id ?? null,
      } as any);
      toast.success("Content scheduled!");
      queryClient.invalidateQueries({ queryKey: ["schedules"] });
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to schedule");
    }
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
                  No approved content. Approve items in the Review Queue first.
                </p>
              : <Select value={idx} onValueChange={setIdx}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {assets.map((a, i) => <SelectItem key={a.id} value={String(i)}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>}
          </div>

          <div className="space-y-1.5">
            <Label>Fanvue account</Label>
            {token
              ? <div className="flex items-center gap-2 rounded-md border border-border bg-card/50 px-3 py-2">
                  <span className="h-2 w-2 rounded-full bg-success shrink-0" />
                  <span className="text-sm font-medium">{token.name}</span>
                  <span className="text-xs text-muted-foreground">@{token.handle}</span>
                </div>
              : <div className="rounded-md border border-dashed border-border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground mb-2">No Fanvue account connected.</p>
                  <Button size="sm" className="gap-2 w-full" onClick={() => { onOpenChange(false); startFanvueOAuth(); }}>
                    <ExternalLink className="h-3.5 w-3.5" /> Connect Fanvue Account
                  </Button>
                </div>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Date</Label>
              <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Time</Label>
              <Input type="time" value={time} onChange={e => setTime(e.target.value)} />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} className="gap-2" disabled={!assets.length || !token}>
            <CalendarPlus className="h-4 w-4" /> Schedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
