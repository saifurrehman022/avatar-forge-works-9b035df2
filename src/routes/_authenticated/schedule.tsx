import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { scheduleService } from "@/services";
import {
  CalendarClock, CalendarPlus, CheckCircle2, Clock, Search,
  Image as ImageIcon, Video as VideoIcon, Play, ArrowLeft, Send,
  Filter, Inbox, ChevronLeft, ChevronRight, MoreHorizontal,
  Trash2, Eye, RefreshCw, Link2, AlertTriangle,
  Loader2, Plug, CheckCircle, XCircle, ExternalLink,
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
const FANVUE_CLIENT_ID     = "f9d35fff-3d12-4dd5-8945-750c37d65ae9";
const FANVUE_CLIENT_SECRET = "05275891c81581c5cb79d336c8e9f87680f0976843bf17d6737bdcf0dde38b1a";
const FANVUE_REDIRECT_URI  = "https://avatar-forge-works-9b035df2-j56ivc6di-saifurrehman022s-projects.vercel.app/schedule";
const FANVUE_AUTH_URL      = "https://auth.fanvue.com/oauth2/auth";
const FANVUE_TOKEN_URL     = "https://auth.fanvue.com/oauth2/token";
const FANVUE_API_BASE      = "https://api.fanvue.com";
const FANVUE_API_VERSION   = "2025-06-26";

// ─────────────────────────────────────────────────────────────────────────────
// localStorage token store — zero Supabase dependency for auth
// ─────────────────────────────────────────────────────────────────────────────
const LS_TOKEN_KEY = "fanvue_token_v2";

type StoredToken = {
  accessToken:   string;
  refreshToken?: string;
  expiresAt?:    number; // unix ms
  name:          string;
  handle:        string;
  uuid:          string;
};

function saveToken(t: StoredToken)     { localStorage.setItem(LS_TOKEN_KEY, JSON.stringify(t)); }
function loadToken(): StoredToken|null { try { const r = localStorage.getItem(LS_TOKEN_KEY); return r ? JSON.parse(r) : null; } catch { return null; } }
function clearToken()                  { localStorage.removeItem(LS_TOKEN_KEY); }

// ─────────────────────────────────────────────────────────────────────────────
// PKCE helpers
// ─────────────────────────────────────────────────────────────────────────────
function b64url(buf: ArrayBuffer): string {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
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

async function exchangeFanvueCode(code: string): Promise<StoredToken> {
  const verifier = sessionStorage.getItem(PKCE_KEY);
  if (!verifier) throw new Error("PKCE verifier missing — please click Connect again");
  sessionStorage.removeItem(PKCE_KEY);
  sessionStorage.removeItem(STATE_KEY);

  console.info("[OAuth] exchanging code…");
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
  console.info(`[OAuth] token response (${tokenRes.status}):`, tokenText);
  if (!tokenRes.ok) throw new Error(`Token exchange failed (${tokenRes.status}): ${tokenText}`);

  const tokens       = JSON.parse(tokenText);
  const accessToken  = tokens.access_token  as string;
  const refreshToken = tokens.refresh_token as string | undefined;
  const expiresIn    = tokens.expires_in    as number | undefined;

  if (!accessToken) throw new Error("No access_token in response: " + tokenText);

  // GET /users/me — confirmed correct endpoint from Fanvue API docs
  console.info("[OAuth] fetching /users/me…");
  const meRes  = await fetch(`${FANVUE_API_BASE}/users/me`, {
    headers: { Authorization: `Bearer ${accessToken}`, "X-Fanvue-API-Version": FANVUE_API_VERSION },
  });
  const meText = await meRes.text();
  console.info(`[OAuth] /users/me (${meRes.status}):`, meText);

  // Even if /users/me fails, we still have a valid token — use fallback values
  let profile: any = {};
  if (meRes.ok) { try { profile = JSON.parse(meText); } catch {} }

  const stored: StoredToken = {
    accessToken,
    refreshToken,
    expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : undefined,
    name:   profile.displayName ?? profile.name   ?? profile.username ?? "Fanvue Account",
    handle: profile.username    ?? profile.handle ?? profile.uuid     ?? "fanvue",
    uuid:   profile.uuid        ?? profile.id     ?? crypto.randomUUID(),
  };

  saveToken(stored);
  console.info(`[OAuth] ✅ saved token to localStorage: @${stored.handle}`);
  return stored;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fanvue publish pipeline
// NO fake fallback IDs — every failure throws so the UI shows the real error.
// ─────────────────────────────────────────────────────────────────────────────
const fvHeaders = (token: string, extra?: Record<string,string>) => ({
  Authorization: `Bearer ${token}`,
  "X-Fanvue-API-Version": FANVUE_API_VERSION,
  ...extra,
});

// Download media blob — try direct first, then Vercel proxy
async function fetchMediaBlob(mediaUrl: string, onProgress?: (s:string)=>void): Promise<Blob> {
  onProgress?.("Downloading media…");
  console.info("[media] fetching:", mediaUrl);

  // Direct fetch — works when Supabase bucket is public (no CORS issue for same-origin)
  try {
    const r = await fetch(mediaUrl);
    if (r.ok) {
      const b = await r.blob();
      if (b.size > 0) { console.info(`[media] direct OK: ${b.size} bytes, type=${b.type}`); return b; }
      throw new Error("Empty blob from direct fetch");
    }
    throw new Error(`Direct fetch ${r.status}`);
  } catch (e) {
    console.warn("[media] direct failed:", (e as Error).message, "→ trying proxy…");
  }

  // Proxy fallback — needs /api/proxy-media.ts in Vercel project
  // Create this file: export default async(req,res)=>{ const r=await fetch(req.query.url); res.setHeader("Content-Type",r.headers.get("content-type")||"application/octet-stream"); res.send(Buffer.from(await r.arrayBuffer())); }
  onProgress?.("Downloading via proxy…");
  const proxyUrl = `/api/proxy-media?url=${encodeURIComponent(mediaUrl)}`;
  const r2 = await fetch(proxyUrl);
  if (!r2.ok) throw new Error(
    `Cannot download media (proxy ${r2.status}). ` +
    `Either make your Supabase bucket public OR create /api/proxy-media.ts in your Vercel project.`
  );
  const b2 = await r2.blob();
  if (b2.size === 0) throw new Error("Proxy returned empty blob — check the media URL");
  console.info(`[media] proxy OK: ${b2.size} bytes`);
  return b2;
}

async function publishToFanvue(params: {
  accessToken: string;
  mediaUrl:    string;
  mediaType:   "image" | "video";
  caption:     string;
  onProgress?: (s: string) => void;
}): Promise<string> {
  const { accessToken, mediaUrl, mediaType, caption, onProgress } = params;
  const rep = (s: string) => { console.info("[publish]", s); onProgress?.(s); };

  // ── Verify token is still valid ───────────────────────────────────────────
  rep("Verifying Fanvue token…");
  const meR = await fetch(`${FANVUE_API_BASE}/users/me`, { headers: fvHeaders(accessToken) });
  if (!meR.ok) {
    const meText = await meR.text();
    throw new Error(
      `Fanvue token rejected (${meR.status}): ${meText}. ` +
      `Please disconnect and reconnect your Fanvue account.`
    );
  }
  const me = await meR.json();
  rep(`Authenticated as @${me.username ?? me.handle ?? "?"}`);

  // ── Download media ────────────────────────────────────────────────────────
  const blob = await fetchMediaBlob(mediaUrl, onProgress);
  const ext  = mediaType === "video" ? "mp4" : "jpeg";
  const filename = `lila-${Date.now()}.${ext}`;
  rep(`Media ready: ${(blob.size / 1024).toFixed(0)} KB`);

  // ── Step 1: Create upload session ────────────────────────────────────────
  rep("Step 1/5 — Creating Fanvue upload session…");
  const sessR = await fetch(`${FANVUE_API_BASE}/media/uploads`, {
    method:  "POST",
    headers: fvHeaders(accessToken, { "Content-Type": "application/json" }),
    body:    JSON.stringify({ name: filename, filename, mediaType }),
  });
  const sessText = await sessR.text();
  console.info(`[publish] Step 1 (${sessR.status}):`, sessText);
  if (!sessR.ok) throw new Error(`Step 1 failed (${sessR.status}): ${sessText}`);
  const sess = JSON.parse(sessText);
  const { mediaUuid, uploadId } = sess;
  if (!mediaUuid || !uploadId)
    throw new Error(`Step 1: missing mediaUuid/uploadId in: ${sessText}`);
  rep(`Step 1 ✓  mediaUuid=${mediaUuid}`);

  // ── Step 2: Get presigned S3 URL ─────────────────────────────────────────
  rep("Step 2/5 — Getting upload URL…");
  const urlR = await fetch(`${FANVUE_API_BASE}/media/uploads/${uploadId}/parts/1/url`, {
    headers: fvHeaders(accessToken),
  });
  const urlText = (await urlR.text()).trim();
  console.info(`[publish] Step 2 (${urlR.status}):`, urlText.slice(0, 100));
  if (!urlR.ok) throw new Error(`Step 2 failed (${urlR.status}): ${urlText}`);
  if (!urlText.startsWith("https://"))
    throw new Error(`Step 2: response is not a URL: "${urlText.slice(0, 120)}"`);
  rep("Step 2 ✓");

  // ── Step 3: PUT to S3 ─────────────────────────────────────────────────────
  rep(`Step 3/5 — Uploading ${(blob.size / 1024).toFixed(0)} KB to Fanvue storage…`);
  const s3R = await fetch(urlText, { method: "PUT", body: blob });
  console.info(`[publish] Step 3 S3 (${s3R.status})`);
  if (!s3R.ok) throw new Error(`Step 3 S3 upload failed (${s3R.status}): ${await s3R.text()}`);
  // Strip quotes S3 wraps around ETags
  const rawEtag = s3R.headers.get("ETag") ?? s3R.headers.get("etag") ?? "";
  const etag    = rawEtag.replace(/^"|"$/g, "") || "1";
  rep(`Step 3 ✓  ETag=${etag}`);

  // ── Step 4: Complete upload session ──────────────────────────────────────
  rep("Step 4/5 — Finalising upload…");
  const compR = await fetch(`${FANVUE_API_BASE}/media/uploads/${uploadId}`, {
    method:  "PATCH",
    headers: fvHeaders(accessToken, { "Content-Type": "application/json" }),
    body:    JSON.stringify({ parts: [{ PartNumber: 1, ETag: etag }] }),
  });
  const compText = await compR.text();
  console.info(`[publish] Step 4 (${compR.status}):`, compText);
  if (!compR.ok) throw new Error(`Step 4 failed (${compR.status}): ${compText}`);
  rep("Step 4 ✓");

  // ── Step 5: Poll until media is ready ────────────────────────────────────
  rep("Step 5/5 — Waiting for Fanvue to process media…");
  const READY_STATUSES = new Set(["ready","finalised","finalized","READY","FINALISED","FINALIZED"]);
  const deadline = Date.now() + 180_000; // 3 minute max
  let   pollAttempt = 0;

  while (Date.now() < deadline) {
    pollAttempt++;
    await new Promise(r => setTimeout(r, 4000));

    const pollR    = await fetch(`${FANVUE_API_BASE}/media/${mediaUuid}`, { headers: fvHeaders(accessToken) });
    const pollText = await pollR.text();
    console.info(`[publish] poll #${pollAttempt} (${pollR.status}):`, pollText);

    if (pollR.status === 404) continue; // briefly 404 right after upload

    if (pollR.ok) {
      const d      = JSON.parse(pollText);
      const status = (d.status ?? "").toLowerCase();
      rep(`Processing… status="${status}" (check #${pollAttempt})`);

      if (READY_STATUSES.has(d.status ?? "")) { rep("Media ready ✓"); break; }
      if (status === "error") throw new Error(
        `Fanvue rejected the media (status=error). ` +
        `Images must be JPEG or PNG; videos must be MP4 (H.264). Response: ${pollText}`
      );
    }
    // Non-404/non-ok during processing is transient — keep polling
  }

  if (Date.now() >= deadline) throw new Error("Timed out waiting for Fanvue media (3 min). File may be too large.");

  // ── Step 6: Create post ───────────────────────────────────────────────────
  rep("Creating post on Fanvue…");
  const postBody = { text: caption, mediaUuids: [mediaUuid], audience: "followers-and-subscribers" };
  console.info("[publish] POST /posts:", JSON.stringify(postBody));

  const postR    = await fetch(`${FANVUE_API_BASE}/posts`, {
    method:  "POST",
    headers: fvHeaders(accessToken, { "Content-Type": "application/json" }),
    body:    JSON.stringify(postBody),
  });
  const postText = await postR.text();
  console.info(`[publish] POST /posts (${postR.status}):`, postText);
  if (!postR.ok) throw new Error(`Create post failed (${postR.status}): ${postText}`);

  let postData: any;
  try { postData = JSON.parse(postText); }
  catch { throw new Error(`Non-JSON response from POST /posts: ${postText.slice(0, 300)}`); }

  // NEVER use a fallback here — if uuid is missing, throw so we know immediately
  const postUuid = postData.uuid ?? postData.id ?? null;
  if (!postUuid) throw new Error(`No UUID in Fanvue post response: ${postText.slice(0, 300)}`);

  rep(`✅ Done! Post UUID: ${postUuid}`);
  return postUuid as string;
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

type HistoryEvent = {
  at: string; label: string;
  kind: "approved"|"scheduled"|"queued"|"publishing"|"published"|"failed"|"retried";
};
type ScheduledItem = {
  id: string; contentName: string; type: ContentType; character: string;
  thumbnail: string; mediaUrl: string; scheduledAt: string;
  status: PublishStatus; queueStatus: QueueStatus; autoPublish: boolean;
  externalPostId?: string; publishedAt?: string;
  settings: { fps: number; framesPerScene: number; numScenes: number; samplingSteps: number };
  scenePrompts: string[]; negativePrompt: string; history: HistoryEvent[];
};

const EMPTY_SCHEDULE_ITEMS: ScheduledItem[] = [];
const PLACEHOLDER = "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=600&q=80";

// ─────────────────────────────────────────────────────────────────────────────
// Supabase fetchers (schedules/images/videos only — NOT accounts)
// ─────────────────────────────────────────────────────────────────────────────
async function fetchSchedules(): Promise<ScheduledItem[]> {
  const { data: rows, error } = await supabase.from("schedules").select("*").order("publish_time");
  if (error) throw error;

  const imageIds = (rows ?? []).filter((r:any) => r.content_type==="image").map((r:any) => r.content_id);
  const videoIds = (rows ?? []).filter((r:any) => r.content_type==="video").map((r:any) => r.content_id);

  const [imgRes, vidRes, charRes] = await Promise.all([
    imageIds.length ? supabase.from("images").select("id,image_url,prompt,character_id,published_at,external_post_id,publish_status").in("id",imageIds) : Promise.resolve({data:[]} as any),
    videoIds.length ? supabase.from("videos").select("id,video_url,prompt,scene_prompts,character_id,published_at,external_post_id,publish_status").in("id",videoIds) : Promise.resolve({data:[]} as any),
    supabase.from("characters").select("id,name,reference_image_url"),
  ]);

  const imgMap  = new Map((imgRes.data  ?? []).map((i:any) => [i.id,i]));
  const vidMap  = new Map((vidRes.data  ?? []).map((v:any) => [v.id,v]));
  const charMap = new Map((charRes.data ?? []).map((c:any) => [c.id,c]));

  return (rows ?? []).map((r:any): ScheduledItem => {
    const isVideo = r.content_type === "video";
    const src:any  = isVideo ? vidMap.get(r.content_id) : imgMap.get(r.content_id);
    const char:any = src?.character_id ? charMap.get(src.character_id) : null;
    const scenes: string[] = isVideo && Array.isArray(src?.scene_prompts) ? src.scene_prompts : src?.prompt ? [src.prompt] : [];
    const media = isVideo ? src?.video_url : src?.image_url;
    const thumb = char?.reference_image_url || media || PLACEHOLDER;

    const status: PublishStatus =
      r.status==="published" ? "published" : r.status==="failed" ? "failed" :
      r.status==="publishing" ? "publishing" : "scheduled";
    const queueStatus: QueueStatus =
      status==="published" ? "published" : status==="failed" ? "failed" :
      status==="publishing" ? "publishing" :
      new Date(r.publish_time) <= new Date() ? "ready" : "waiting";

    return {
      id: r.id,
      contentName: `${char?.name ?? "Lila"} — ${(scenes[0] ?? "Untitled").slice(0,40)}`,
      type: r.content_type, character: char?.name ?? "Lila",
      thumbnail: thumb, mediaUrl: media || "",
      scheduledAt: r.publish_time, status, queueStatus, autoPublish: true,
      externalPostId: src?.external_post_id ?? undefined,
      publishedAt:    src?.published_at      ?? undefined,
      settings: { fps:16, framesPerScene:257, numScenes:scenes.length||1, samplingSteps:29 },
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
  const charMap = new Map((charRes.data ?? []).map((c:any) => [c.id,c]));
  return [
    ...(imgRes.data ?? []).map((i:any) => ({
      id:i.id, type:"image" as const,
      name:`${charMap.get(i.character_id)?.name ?? "Lila"} — ${(i.prompt ?? "Image").slice(0,40)}`,
      thumbnail: i.image_url ?? "",
    })),
    ...(vidRes.data ?? []).map((v:any) => ({
      id:v.id, type:"video" as const,
      name:`${charMap.get(v.character_id)?.name ?? "Lila"} — ${(v.prompt ?? "Video").slice(0,40)}`,
      thumbnail: charMap.get(v.character_id)?.reference_image_url ?? "",
    })),
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Style helpers
// ─────────────────────────────────────────────────────────────────────────────
const statusStyle: Record<PublishStatus,string> = {
  scheduled:"bg-chart-2/15 text-chart-2 border-chart-2/30",
  publishing:"bg-primary/15 text-primary border-primary/30",
  published:"bg-success/15 text-success border-success/30",
  failed:"bg-destructive/15 text-destructive border-destructive/30",
};
const queueStyle: Record<QueueStatus,string> = {
  waiting:"bg-muted text-muted-foreground border-border",
  ready:"bg-chart-2/15 text-chart-2 border-chart-2/30",
  publishing:"bg-primary/15 text-primary border-primary/30",
  published:"bg-success/15 text-success border-success/30",
  failed:"bg-destructive/15 text-destructive border-destructive/30",
};
const fmtTime     = (s:string) => new Date(s).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
const fmtDate     = (s:string) => new Date(s).toLocaleDateString([],{month:"short",day:"numeric"});
const fmtDateTime = (s:string) => `${fmtDate(s)} · ${fmtTime(s)}`;
const isSameDay   = (a:Date,b:Date) => a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate();

function StatusBadge({status}:{status:PublishStatus}) {
  return <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider",statusStyle[status])}>
    {status==="publishing"&&<Loader2 className="h-2.5 w-2.5 animate-spin"/>}{status}
  </span>;
}
function QueueBadge({status}:{status:QueueStatus}) {
  return <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider",queueStyle[status])}>{status}</span>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Account dialog — localStorage only, no Supabase
// ─────────────────────────────────────────────────────────────────────────────
function AccountDialog({open,onOpenChange,token,onDisconnect}:{
  open:boolean; onOpenChange:(o:boolean)=>void; token:StoredToken|null; onDisconnect:()=>void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Fanvue Account</DialogTitle>
          <DialogDescription>Connect your Fanvue creator account to publish content directly from Lila Studio.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {token ? (
            <div className="flex items-center justify-between rounded-lg border border-border bg-card p-3">
              <div className="flex items-center gap-3">
                <div className="grid h-9 w-9 place-items-center rounded-full bg-success/10 text-success font-semibold text-sm">
                  {token.name.slice(0,1).toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-medium">{token.name}</p>
                  <p className="text-xs text-muted-foreground">@{token.handle}</p>
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
              <p className="mt-1 text-xs text-muted-foreground">Connect your Fanvue creator account to start publishing.</p>
            </div>
          )}
          <div className="rounded-lg border border-border bg-muted/20 p-4">
            <p className="text-xs font-medium mb-1">{token ? "Reconnect account" : "Connect a new account"}</p>
            <p className="text-xs text-muted-foreground mb-3">
              You'll be redirected to Fanvue to authorise. Your token is saved in your browser only — no server storage.
            </p>
            <Button className="w-full gap-2" onClick={()=>{onOpenChange(false);startFanvueOAuth();}}>
              <ExternalLink className="h-4 w-4"/> {token ? "Reconnect Fanvue" : "Connect Fanvue Account"}
            </Button>
          </div>
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
  const { data: scheduleData = EMPTY_SCHEDULE_ITEMS } = useQuery({ queryKey:["schedules"], queryFn:fetchSchedules, staleTime:10_000 });
  const [items, setItems]               = useState<ScheduledItem[]>([]);
  const [fanvueToken, setFanvueToken]   = useState<StoredToken|null>(() => loadToken());

  useEffect(()=>setItems(scheduleData),[scheduleData]);

  // OAuth redirect handler
  useEffect(()=>{
    const p   = new URLSearchParams(window.location.search);
    const code = p.get("code");
    const err  = p.get("error");
    if (err) {
      window.history.replaceState({},"",window.location.pathname);
      toast.error(`Fanvue auth error: ${p.get("error_description") ?? err}`);
      return;
    }
    if (!code) return;
    window.history.replaceState({},"",window.location.pathname);
    toast.loading("Connecting Fanvue account…",{id:"fv-connect"});
    exchangeFanvueCode(code)
      .then(t => {
        setFanvueToken(t);
        toast.success(`Connected as @${t.handle}!`,{id:"fv-connect"});
      })
      .catch(e => {
        console.error("[OAuth]",e);
        toast.error(e.message ?? "Failed to connect",{id:"fv-connect"});
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  // Realtime schedules
  useEffect(()=>{
    const ch = supabase.channel("schedules-rt")
      .on("postgres_changes",{event:"*",schema:"public",table:"schedules"},()=>queryClient.invalidateQueries({queryKey:["schedules"]}))
      .subscribe();
    return ()=>{ supabase.removeChannel(ch); };
  },[queryClient]);

  const [tab,          setTab]          = useState("calendar");
  const [search,       setSearch]       = useState("");
  const [statusFilter, setStatusFilter] = useState<"all"|PublishStatus>("all");
  const [rangeFilter,  setRangeFilter]  = useState<"all"|"today"|"week"|"month">("all");
  const [selected,     setSelected]     = useState<ScheduledItem|null>(null);
  const [createOpen,   setCreateOpen]   = useState(false);
  const [accountOpen,  setAccountOpen]  = useState(false);
  const [weekStart,    setWeekStart]    = useState(()=>{
    const d=new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()-d.getDay()); return d;
  });

  const stats = useMemo(()=>{
    const now=new Date(); const wa=new Date(now); wa.setDate(wa.getDate()-7);
    return {
      scheduled:     items.filter(i=>i.status==="scheduled").length,
      todayCount:    items.filter(i=>i.status==="scheduled"&&isSameDay(new Date(i.scheduledAt),now)).length,
      weekPublished: items.filter(i=>i.status==="published"&&i.publishedAt&&new Date(i.publishedAt)>=wa).length,
      failed:        items.filter(i=>i.status==="failed").length,
    };
  },[items]);

  const filteredItems = useMemo(()=>{
    const now=new Date();
    return items.filter(i=>{
      if(statusFilter!=="all"&&i.status!==statusFilter) return false;
      if(rangeFilter!=="all"){
        const d=new Date(i.scheduledAt);
        if(rangeFilter==="today"&&!isSameDay(d,now)) return false;
        if(rangeFilter==="week"){const wk=new Date(now);wk.setDate(wk.getDate()+7);if(d<now||d>wk)return false;}
        if(rangeFilter==="month"&&(d.getMonth()!==now.getMonth()||d.getFullYear()!==now.getFullYear()))return false;
      }
      if(search.trim()){const q=search.toLowerCase();if(![i.contentName,i.character].join(" ").toLowerCase().includes(q))return false;}
      return true;
    });
  },[items,statusFilter,rangeFilter,search]);

  const updateItem = (id:string,patch:Partial<ScheduledItem>) =>
    setItems(prev=>prev.map(i=>i.id===id?{...i,...patch}:i));

  const removeItem = async(id:string)=>{
    setItems(prev=>prev.filter(i=>i.id!==id)); setSelected(null);
    try{const{error}=await supabase.from("schedules").delete().eq("id",id);if(error)throw error;toast.success("Removed");queryClient.invalidateQueries({queryKey:["schedules"]});}
    catch(e:any){toast.error(e?.message??"Failed to remove");}
  };

  const retryPublish=async(id:string)=>{
    updateItem(id,{status:"scheduled",queueStatus:"ready"});
    try{await scheduleService.update(id,{status:"scheduled"});toast.success("Queued for retry");}
    catch(e:any){toast.error(e?.message??"Failed");}
  };

  // ── PUBLISH NOW ──────────────────────────────────────────────────────────
  const publishNow=async(id:string)=>{
    const item=items.find(i=>i.id===id);
    if(!item) return;

    // Read fresh from localStorage every time (not stale React state)
    const token = loadToken();
    if(!token?.accessToken){
      toast.error("No Fanvue account connected.",{
        description:"Click the account button in the top-right to connect first.",
        action:{label:"Connect",onClick:()=>setAccountOpen(true)},
        duration:10_000,
      });
      return;
    }

    if(!item.mediaUrl){
      toast.error("No media URL — the image or video may still be generating.");
      return;
    }

    updateItem(id,{status:"publishing",queueStatus:"publishing"});
    const toastId=`pub-${id}`;
    toast.loading("Starting Fanvue publish…",{id:toastId,duration:Infinity});

    try{
      const caption  = item.scenePrompts[0] ?? item.contentName;
      const postUuid = await publishToFanvue({
        accessToken: token.accessToken,
        mediaUrl:    item.mediaUrl,
        mediaType:   item.type,
        caption,
        onProgress: s=>toast.loading(s,{id:toastId,duration:Infinity}),
      });

      // postUuid is a REAL Fanvue UUID — no fallback reached this point
      const now   = new Date().toISOString();
      const table = item.type==="image" ? "images" : "videos";

      const{data:schedRow}=await supabase.from("schedules").select("content_id").eq("id",id).single();
      if(schedRow?.content_id){
        await supabase.from(table).update({
          publish_status:   "published",
          published_at:     now,
          external_post_id: postUuid,
        }).eq("id",schedRow.content_id);
      }
      await scheduleService.update(id,{status:"published"});

      updateItem(id,{
        status:"published", queueStatus:"published",
        externalPostId:postUuid, publishedAt:now,
        history:[...item.history,{at:now,label:`Published to @${token.handle}`,kind:"published"}],
      });

      toast.success(`🎉 Published to @${token.handle}!`,{
        id:toastId, duration:12_000,
        description:`Post UUID: ${postUuid}`,
        action:{label:"View on Fanvue",onClick:()=>window.open(`https://www.fanvue.com/post/${postUuid}`,"_blank")},
      });
      queryClient.invalidateQueries({queryKey:["schedules"]});

    }catch(e:any){
      const msg=e?.message??"Unknown error";
      console.error("[publishNow] FAILED:",msg);
      updateItem(id,{
        status:"failed", queueStatus:"failed",
        history:[...item.history,{at:new Date().toISOString(),label:`Failed: ${msg.slice(0,100)}`,kind:"failed"}],
      });
      try{await scheduleService.update(id,{status:"failed"});}catch{}
      toast.error("Publish failed",{id:toastId,duration:30_000,description:msg});
    }
  };

  const [dragId,setDragId]=useState<string|null>(null);
  const onDropOnDay=async(day:Date)=>{
    if(!dragId)return;
    const item=items.find(i=>i.id===dragId);if(!item)return;
    const oldD=new Date(item.scheduledAt);const newD=new Date(day);
    newD.setHours(oldD.getHours(),oldD.getMinutes(),0,0);
    const iso=newD.toISOString();
    updateItem(dragId,{scheduledAt:iso});
    try{await scheduleService.update(dragId,{publish_time:iso});toast.success("Rescheduled");}
    catch(e:any){toast.error(e?.message??"Failed");}
    setDragId(null);
  };

  const connected = !!fanvueToken?.accessToken;

  return (
    <SidebarProvider>
      <AppSidebar/>
      <SidebarInset>
        <AppHeader/>
        <main className="flex-1 overflow-y-auto bg-background">
          <div className="mx-auto max-w-[1400px] space-y-6 p-4 sm:p-6 lg:p-8">

            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <Link to="/" className="mb-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
                  <ArrowLeft className="h-3.5 w-3.5"/> Dashboard
                </Link>
                <h1 className="font-display text-3xl font-semibold tracking-tight">Scheduling</h1>
                <p className="mt-1 text-sm text-muted-foreground">Plan, queue and publish approved content to your Fanvue account.</p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="gap-2" onClick={()=>setAccountOpen(true)}>
                  <Plug className="h-4 w-4"/>
                  {connected
                    ? <span className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-success animate-pulse"/>
                        @{fanvueToken!.handle}
                      </span>
                    : "Connect Fanvue"}
                </Button>
                <Button size="sm" className="gap-2" onClick={()=>setCreateOpen(true)}>
                  <CalendarPlus className="h-4 w-4"/> Schedule content
                </Button>
              </div>
            </div>

            {!connected&&(
              <div className="flex items-center gap-3 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3">
                <AlertTriangle className="h-4 w-4 flex-shrink-0 text-warning"/>
                <p className="flex-1 text-sm">No Fanvue account connected. Connect one to publish.</p>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={()=>setAccountOpen(true)}>
                  <ExternalLink className="h-3.5 w-3.5"/> Connect now
                </Button>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <DashboardCard label="Scheduled posts"     value={stats.scheduled}    icon={CalendarClock} accent="primary" hint="Awaiting publish"/>
              <DashboardCard label="Publishing today"    value={stats.todayCount}   icon={Clock}         accent="chart-2" hint="Next 24h"/>
              <DashboardCard label="Published this week" value={stats.weekPublished} icon={CheckCircle2}  accent="chart-3"/>
              <DashboardCard label="Failed"              value={stats.failed}        icon={AlertTriangle} accent="chart-5" hint={stats.failed?"Needs attention":"All clear"}/>
            </div>

            <Card className="border-border/60 bg-card">
              <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"/>
                  <Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search…" className="pl-9"/>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Filter className="h-4 w-4 text-muted-foreground"/>
                  <Select value={statusFilter} onValueChange={v=>setStatusFilter(v as never)}>
                    <SelectTrigger className="h-9 w-[150px]"><SelectValue placeholder="Status"/></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      <SelectItem value="scheduled">Scheduled</SelectItem>
                      <SelectItem value="publishing">Publishing</SelectItem>
                      <SelectItem value="published">Published</SelectItem>
                      <SelectItem value="failed">Failed</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={rangeFilter} onValueChange={v=>setRangeFilter(v as never)}>
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

            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                <TabsTrigger value="calendar">Calendar</TabsTrigger>
                <TabsTrigger value="queue">Publishing Queue</TabsTrigger>
                <TabsTrigger value="history">History</TabsTrigger>
              </TabsList>
              <TabsContent value="calendar" className="mt-4">
                <CalendarView weekStart={weekStart} setWeekStart={setWeekStart} items={filteredItems}
                  onOpen={setSelected} onDragStart={setDragId} onDropOnDay={onDropOnDay} onSchedule={()=>setCreateOpen(true)}/>
              </TabsContent>
              <TabsContent value="queue" className="mt-4">
                <QueueView
                  items={filteredItems.filter(i=>["scheduled","publishing","failed"].includes(i.status))}
                  onOpen={setSelected} onCancel={removeItem} onPublishNow={publishNow} onRetry={retryPublish}
                  onSchedule={()=>setCreateOpen(true)}/>
              </TabsContent>
              <TabsContent value="history" className="mt-4">
                <HistoryView items={filteredItems.filter(i=>["published","failed"].includes(i.status))}
                  onOpen={setSelected} onRetry={retryPublish}/>
              </TabsContent>
            </Tabs>
          </div>
        </main>
      </SidebarInset>

      <DetailSheet item={selected} onClose={()=>setSelected(null)}
        fanvueHandle={fanvueToken?.handle} onRetry={retryPublish} onPublishNow={publishNow} onRemove={removeItem}/>
      <CreateScheduleDialog open={createOpen} onOpenChange={setCreateOpen} fanvueToken={fanvueToken}/>
      <AccountDialog open={accountOpen} onOpenChange={setAccountOpen} token={fanvueToken}
        onDisconnect={()=>{clearToken();setFanvueToken(null);toast.success("Fanvue account disconnected");}}/>
    </SidebarProvider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Calendar
// ─────────────────────────────────────────────────────────────────────────────
function CalendarView({weekStart,setWeekStart,items,onOpen,onDragStart,onDropOnDay,onSchedule}:{
  weekStart:Date;setWeekStart:(d:Date)=>void;items:ScheduledItem[];
  onOpen:(i:ScheduledItem)=>void;onDragStart:(id:string|null)=>void;
  onDropOnDay:(d:Date)=>void;onSchedule:()=>void;
}) {
  const days=Array.from({length:7}).map((_,idx)=>{const d=new Date(weekStart);d.setDate(d.getDate()+idx);return d;});
  const move=(n:number)=>{const d=new Date(weekStart);d.setDate(d.getDate()+n*7);setWeekStart(d);};
  const todayD=new Date();
  return (
    <Card className="border-border/60 bg-card">
      <CardContent className="p-4">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="font-display text-lg font-semibold">{weekStart.toLocaleDateString([],{month:"long",year:"numeric"})}</p>
            <p className="text-xs text-muted-foreground">Drag cards to reschedule</p>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={()=>move(-1)}><ChevronLeft className="h-4 w-4"/></Button>
            <Button variant="outline" size="sm" className="h-8" onClick={()=>{const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-d.getDay());setWeekStart(d);}}>Today</Button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={()=>move(1)}><ChevronRight className="h-4 w-4"/></Button>
          </div>
        </div>
        {items.length===0?<EmptyState onSchedule={onSchedule}/>:(
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-7">
            {days.map(day=>{
              const di=items.filter(i=>isSameDay(new Date(i.scheduledAt),day)).sort((a,b)=>+new Date(a.scheduledAt)-+new Date(b.scheduledAt));
              const isToday=isSameDay(day,todayD);
              return (
                <div key={day.toISOString()} onDragOver={e=>e.preventDefault()} onDrop={()=>onDropOnDay(day)}
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
                          <div className="absolute right-1 top-1"><StatusBadge status={i.status}/></div>
                        </div>
                        <div className="px-0.5">
                          <p className="truncate text-xs font-medium">{i.character}</p>
                          <p className="text-[10px] text-muted-foreground">{fmtTime(i.scheduledAt)}</p>
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
function QueueView({items,onOpen,onCancel,onPublishNow,onRetry,onSchedule}:{
  items:ScheduledItem[];onOpen:(i:ScheduledItem)=>void;onCancel:(id:string)=>void;
  onPublishNow:(id:string)=>void;onRetry:(id:string)=>void;onSchedule:()=>void;
}) {
  if(items.length===0) return <Card className="border-border/60 bg-card"><CardContent className="p-4"><EmptyState onSchedule={onSchedule} message="Publishing queue is empty."/></CardContent></Card>;
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
                <QueueBadge status={i.queueStatus}/>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{i.character}</p>
              <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground"><Clock className="h-3 w-3"/>{fmtDateTime(i.scheduledAt)}</p>
              {!i.mediaUrl&&<p className="mt-0.5 text-[10px] text-destructive font-medium">⚠ No media URL — asset may still be processing</p>}
            </div>
            <div className="flex items-center gap-1.5">
              {i.status==="failed"?(
                <Button size="sm" variant="outline" className="gap-1.5" onClick={()=>onRetry(i.id)}><RefreshCw className="h-3.5 w-3.5"/> Retry</Button>
              ):(
                <Button size="sm" variant="outline" className="gap-1.5" onClick={()=>onPublishNow(i.id)}
                  disabled={i.status==="publishing"||!i.mediaUrl}>
                  {i.status==="publishing"?<Loader2 className="h-3.5 w-3.5 animate-spin"/>:<Send className="h-3.5 w-3.5"/>}
                  {i.status==="publishing"?"Publishing…":"Publish now"}
                </Button>
              )}
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
      <p className="mt-3 font-medium">No publishing history yet</p>
      <p className="mt-1 text-sm text-muted-foreground">Published and failed posts will appear here.</p>
    </CardContent></Card>
  );
  return (
    <Card className="border-border/60 bg-card"><CardContent className="p-0">
      <div className="grid grid-cols-12 gap-3 border-b border-border/60 px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        <div className="col-span-6">Content</div>
        <div className="col-span-3">Publish date</div>
        <div className="col-span-2">Post UUID</div>
        <div className="col-span-1 text-right">Status</div>
      </div>
      {items.map(i=>(
        <button key={i.id} type="button" onClick={()=>onOpen(i)}
          className="grid w-full grid-cols-12 items-center gap-3 border-b border-border/40 px-4 py-3 text-left hover:bg-muted/40 last:border-b-0 transition-colors">
          <div className="col-span-6 flex items-center gap-3">
            <div className="relative h-12 w-16 shrink-0 overflow-hidden rounded">
              <img src={i.thumbnail} alt="" className="h-full w-full object-cover"/>
              {i.type==="video"&&<div className="absolute inset-0 grid place-items-center bg-black/30"><Play className="h-3.5 w-3.5 text-white"/></div>}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{i.contentName}</p>
              <p className="truncate text-xs text-muted-foreground">{i.character}</p>
            </div>
          </div>
          <div className="col-span-3 text-xs text-muted-foreground">{i.publishedAt?fmtDateTime(i.publishedAt):fmtDateTime(i.scheduledAt)}</div>
          <div className="col-span-2">
            {i.externalPostId?(
              <a href={`https://www.fanvue.com/post/${i.externalPostId}`} target="_blank" rel="noopener noreferrer"
                onClick={e=>e.stopPropagation()}
                className="inline-flex items-center gap-1 truncate font-mono text-[11px] text-primary hover:underline">
                {i.externalPostId.slice(0,12)}… <ExternalLink className="h-3 w-3 flex-shrink-0"/>
              </a>
            ):<span className="font-mono text-[11px] text-muted-foreground">—</span>}
          </div>
          <div className="col-span-1 flex items-center justify-end gap-2">
            <StatusBadge status={i.status}/>
            {i.status==="failed"&&<Button size="icon" variant="ghost" className="h-7 w-7" onClick={e=>{e.stopPropagation();onRetry(i.id);}}><RefreshCw className="h-3.5 w-3.5"/></Button>}
          </div>
        </button>
      ))}
    </CardContent></Card>
  );
}

function EmptyState({onSchedule,message="No scheduled content."}:{onSchedule:()=>void;message?:string;}) {
  return (
    <div className="mx-auto max-w-md py-10 text-center">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-border/60 bg-background"><CalendarClock className="h-6 w-6 text-muted-foreground"/></div>
      <p className="mt-4 font-display text-lg font-semibold">{message}</p>
      <p className="mt-1 text-sm text-muted-foreground">Pick an approved asset and schedule it to your connected Fanvue account.</p>
      <Button size="sm" className="mt-5 gap-2" onClick={onSchedule}><CalendarPlus className="h-4 w-4"/> Schedule content</Button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Detail sheet
// ─────────────────────────────────────────────────────────────────────────────
function DetailSheet({item,onClose,fanvueHandle,onRetry,onPublishNow,onRemove}:{
  item:ScheduledItem|null;onClose:()=>void;fanvueHandle?:string;
  onRetry:(id:string)=>void;onPublishNow:(id:string)=>void;onRemove:(id:string)=>void;
}) {
  return (
    <Sheet open={!!item} onOpenChange={o=>!o&&onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {item&&(<>
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">{item.contentName}<StatusBadge status={item.status}/></SheetTitle>
            <SheetDescription>{item.character} · {item.type} · {fmtDateTime(item.scheduledAt)}</SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-6">
            <div className="relative aspect-video overflow-hidden rounded-lg bg-muted">
              {item.type==="video"
                ?<video src={item.mediaUrl||item.thumbnail} controls playsInline className="h-full w-full object-cover"/>
                :<img src={item.mediaUrl||item.thumbnail} alt="" className="h-full w-full object-cover"/>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Scheduled"      value={fmtDateTime(item.scheduledAt)}/>
              <Field label="Fanvue account" value={fanvueHandle?`@${fanvueHandle}`:"Not connected"}/>
              <Field label="Media URL"      value={item.mediaUrl?"✓ Available":"✗ Missing — asset still processing"}/>
              <Field label="Review status"  value="Approved"/>
            </div>
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
                <ol className="space-y-2 text-xs">
                  {item.scenePrompts.map((p,idx)=><li key={idx} className="leading-relaxed"><span className="mr-1 text-muted-foreground">{idx+1}.</span>{p}</li>)}
                </ol>
              </ScrollArea>
            </div>
            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Publishing history</p>
              <ol className="relative space-y-3 border-l border-border pl-4">
                {item.history.map((h,idx)=>(
                  <li key={idx} className="relative">
                    <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-primary ring-4 ring-background"/>
                    <p className="text-xs font-medium">{h.label}</p>
                    <p className="text-[11px] text-muted-foreground">{fmtDateTime(h.at)}</p>
                  </li>
                ))}
              </ol>
            </div>
            <Separator/>
            <div className="flex flex-wrap items-center gap-2">
              {item.status==="failed"
                ?<Button size="sm" className="gap-2" onClick={()=>onRetry(item.id)}><RefreshCw className="h-4 w-4"/> Retry</Button>
                :item.status!=="published"
                  ?<Button size="sm" className="gap-2" onClick={()=>onPublishNow(item.id)} disabled={item.status==="publishing"||!item.mediaUrl}>
                      {item.status==="publishing"?<Loader2 className="h-4 w-4 animate-spin"/>:<Send className="h-4 w-4"/>}
                      {item.status==="publishing"?"Publishing…":"Publish now to Fanvue"}
                    </Button>
                  :null}
              <Button size="sm" variant="outline" className="gap-2 text-destructive hover:text-destructive" onClick={()=>onRemove(item.id)}>
                <Trash2 className="h-4 w-4"/> Remove
              </Button>
            </div>
          </div>
        </>)}
      </SheetContent>
    </Sheet>
  );
}

function Field({label,value}:{label:string;value:string;}) {
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
function CreateScheduleDialog({open,onOpenChange,fanvueToken}:{
  open:boolean;onOpenChange:(o:boolean)=>void;fanvueToken:StoredToken|null;
}) {
  const queryClient=useQueryClient();
  const{data:assets=[]}=useQuery({queryKey:["approved-assets"],queryFn:fetchApprovedAssets,enabled:open});
  const[contentIdx,setContentIdx]=useState("0");
  const[date,setDate]=useState(()=>{const d=new Date();d.setDate(d.getDate()+1);return d.toISOString().slice(0,10);});
  const[time,setTime]=useState("18:00");

  const submit=async()=>{
    const asset=assets[Number(contentIdx)];
    if(!asset){toast.error("Pick an approved asset first");return;}
    const iso=new Date(`${date}T${time}:00`).toISOString();
    try{
      const{data:u}=await supabase.auth.getUser();
      await scheduleService.create({
        content_type:asset.type, content_id:asset.id,
        publish_time:iso, platform:"Fanvue", status:"scheduled",
        created_by:u.user?.id??null,
      } as any);
      toast.success("Content scheduled ✅");
      queryClient.invalidateQueries({queryKey:["schedules"]});
      onOpenChange(false);
    }catch(e:any){toast.error(e?.message??"Failed to schedule");}
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
              ?<p className="rounded-md border border-dashed border-border bg-muted/30 p-3 text-xs text-muted-foreground">No approved content yet. Approve items in the Review Queue first.</p>
              :<Select value={contentIdx} onValueChange={setContentIdx}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>{assets.map((a,idx)=><SelectItem key={a.id} value={String(idx)}>{a.name}</SelectItem>)}</SelectContent>
              </Select>}
