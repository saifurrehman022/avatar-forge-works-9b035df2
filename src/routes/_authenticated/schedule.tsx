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
  Loader2, Plug, CheckCircle, XCircle, ExternalLink, Bug,
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
// Fanvue config
// ─────────────────────────────────────────────────────────────────────────────
const FANVUE_CLIENT_ID     = "f9d35fff-3d12-4dd5-8945-750c37d65ae9";
const FANVUE_CLIENT_SECRET = "05275891c81581c5cb79d336c8e9f87680f0976843bf17d6737bdcf0dde38b1a";
const FANVUE_REDIRECT_URI  = "https://avatar-forge-works-9b035df2-j56ivc6di-saifurrehman022s-projects.vercel.app/schedule";
const FANVUE_AUTH_URL      = "https://auth.fanvue.com/oauth2/auth";
const FANVUE_TOKEN_URL     = "https://auth.fanvue.com/oauth2/token";
const FANVUE_API_BASE      = "https://api.fanvue.com";
const FANVUE_API_VERSION   = "2025-06-26";

const fanvueHeaders = (token: string, extra?: Record<string, string>) => ({
  Authorization: `Bearer ${token}`,
  "X-Fanvue-API-Version": FANVUE_API_VERSION,
  ...extra,
});

// ─────────────────────────────────────────────────────────────────────────────
// Helper: detect fake/legacy post IDs (not real Fanvue UUIDs)
// ─────────────────────────────────────────────────────────────────────────────
const isRealFanvueUUID = (id: string | undefined) =>
  !!id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

// ─────────────────────────────────────────────────────────────────────────────
// Debug logger
// ─────────────────────────────────────────────────────────────────────────────
class PublishLogger {
  lines: string[] = [];
  log(msg: string) {
    const ts = new Date().toISOString().slice(11, 23);
    const line = `[${ts}] ${msg}`;
    console.info("[publishToFanvue]", msg);
    this.lines.push(line);
  }
  dump() { return this.lines.join("\n"); }
}

// ─────────────────────────────────────────────────────────────────────────────
// PKCE OAuth
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
const PKCE_KEY  = "fanvue_pkce_verifier";
const STATE_KEY = "fanvue_oauth_state";

async function startFanvueOAuth() {
  const { verifier, challenge } = await generatePKCE();
  const state = crypto.randomUUID();
  sessionStorage.setItem(PKCE_KEY, verifier);
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

async function exchangeFanvueCode(code: string): Promise<void> {
  const verifier = sessionStorage.getItem(PKCE_KEY);
  if (!verifier) throw new Error("PKCE verifier missing — reconnect please");
  sessionStorage.removeItem(PKCE_KEY);
  sessionStorage.removeItem(STATE_KEY);

  const res = await fetch(FANVUE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code", code,
      redirect_uri: FANVUE_REDIRECT_URI,
      client_id: FANVUE_CLIENT_ID, client_secret: FANVUE_CLIENT_SECRET,
      code_verifier: verifier,
    }).toString(),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${await res.text()}`);
  const tokens = await res.json();

  const accessToken  = tokens.access_token  as string;
  const refreshToken = tokens.refresh_token as string | undefined;
  const expiresIn    = tokens.expires_in    as number | undefined;

  const profileRes = await fetch(`${FANVUE_API_BASE}/users/me`, { headers: fanvueHeaders(accessToken) });
  const profile    = profileRes.ok ? await profileRes.json() : {};

  const handle = profile.handle ?? profile.uuid ?? "fanvue-user";
  const name   = profile.displayName ?? handle;

  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase.from("connected_accounts").upsert({
    account_name: name, external_account_id: handle,
    platform: "fanvue", connection_status: "connected",
    access_token: accessToken, refresh_token: refreshToken ?? null,
    token_expires_at: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
    created_by: u.user?.id ?? null,
  }, { onConflict: "external_account_id" });
  if (error) throw new Error(`Failed to save account: ${error.message}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Fanvue publish pipeline
// ─────────────────────────────────────────────────────────────────────────────

async function fetchMediaBlob(url: string, log: PublishLogger): Promise<Blob> {
  log.log(`Fetching media: ${url}`);
  let res = await fetch(url);
  log.log(`Direct fetch → ${res.status} ${res.statusText}, type=${res.headers.get("content-type")}`);
  if (!res.ok) {
    log.log("Direct fetch failed, trying /api/proxy-image…");
    res = await fetch(`/api/proxy-image?url=${encodeURIComponent(url)}`);
    log.log(`Proxy fetch → ${res.status} ${res.statusText}`);
  }
  if (!res.ok) throw new Error(
    `Cannot download media (${res.status}). ` +
    `Ensure your Supabase storage bucket is PUBLIC, or deploy /api/proxy-image on Vercel.`
  );
  const blob = await res.blob();
  log.log(`Blob: size=${blob.size} bytes, type="${blob.type}"`);
  if (blob.size === 0) throw new Error("Downloaded blob is 0 bytes — file is missing or bucket is private.");
  return blob;
}

async function step1_createSession(token: string, filename: string, mediaType: "image" | "video", log: PublishLogger) {
  log.log(`Step 1 — POST /media/uploads  name="${filename}" mediaType="${mediaType}"`);
  const res  = await fetch(`${FANVUE_API_BASE}/media/uploads`, {
    method: "POST",
    headers: fanvueHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ name: filename, filename, mediaType }),
  });
  const text = await res.text();
  log.log(`Step 1 → ${res.status}: ${text}`);
  if (!res.ok) throw new Error(`Step 1 failed (${res.status}): ${text}`);
  const data = JSON.parse(text);
  if (!data.mediaUuid || !data.uploadId)
    throw new Error(`Step 1: missing mediaUuid/uploadId in response: ${text}`);
  log.log(`Step 1 ✅  mediaUuid=${data.mediaUuid}  uploadId=${data.uploadId}`);
  return data as { mediaUuid: string; uploadId: string };
}

async function step2a_getPresignedUrl(token: string, uploadId: string, partNumber: number, log: PublishLogger) {
  const url = `${FANVUE_API_BASE}/media/uploads/${uploadId}/parts/${partNumber}/url`;
  log.log(`Step 2a — GET ${url}`);
  const res  = await fetch(url, { headers: fanvueHeaders(token) });
  const text = (await res.text()).trim();
  log.log(`Step 2a → ${res.status}: "${text.slice(0, 120)}"`);
  if (!res.ok) throw new Error(`Step 2a failed (${res.status}): ${text}`);
  if (!text.startsWith("https://"))
    throw new Error(`Step 2a: response is not a URL — got: "${text.slice(0, 200)}"`);
  log.log(`Step 2a ✅  presigned URL obtained`);
  return text;
}

async function step2b_uploadToS3(presignedUrl: string, blob: Blob, log: PublishLogger) {
  log.log(`Step 2b — PUT ${blob.size} bytes to S3`);
  const res  = await fetch(presignedUrl, { method: "PUT", body: blob });
  const etag = (res.headers.get("ETag") ?? res.headers.get("etag") ?? "").replace(/"/g, "");
  log.log(`Step 2b → ${res.status}, ETag="${etag}"`);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Step 2b S3 upload failed (${res.status}): ${t}`);
  }
  if (!etag) throw new Error("Step 2b: S3 returned no ETag — upload may have failed silently");
  log.log(`Step 2b ✅  uploaded, ETag=${etag}`);
  return etag;
}

async function step3_completeUpload(token: string, uploadId: string, parts: { PartNumber: number; ETag: string }[], log: PublishLogger) {
  log.log(`Step 3 — PATCH /media/uploads/${uploadId}  parts=${JSON.stringify(parts)}`);
  const res  = await fetch(`${FANVUE_API_BASE}/media/uploads/${uploadId}`, {
    method: "PATCH",
    headers: fanvueHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ parts }),
  });
  const text = await res.text();
  log.log(`Step 3 → ${res.status}: ${text}`);
  if (!res.ok) throw new Error(`Step 3 failed (${res.status}): ${text}`);
  log.log(`Step 3 ✅  upload session completed`);
}

async function step4_waitUntilReady(token: string, mediaUuid: string, log: PublishLogger, onProgress?: (s: string) => void) {
  const TIMEOUT = 120_000;
  const POLL    =   3_000;
  const start   = Date.now();
  let   attempt = 0;
  log.log(`Step 4 — polling /media/${mediaUuid} until status=ready`);

  while (Date.now() - start < TIMEOUT) {
    attempt++;
    const res  = await fetch(`${FANVUE_API_BASE}/media/${mediaUuid}`, { headers: fanvueHeaders(token) });
    const text = await res.text();
    log.log(`Step 4 attempt ${attempt} → ${res.status}: ${text}`);

    if (res.status === 404) {
      await new Promise(r => setTimeout(r, POLL));
      continue;
    }
    if (!res.ok) throw new Error(`Step 4 poll failed (${res.status}): ${text}`);

    const data   = JSON.parse(text);
    const status = (data.status ?? "").toLowerCase();
    onProgress?.(`Processing media… status: ${status} (${attempt} checks, ${Math.round((Date.now() - start) / 1000)}s)`);

    if (status === "ready") { log.log(`Step 4 ✅  media is ready`); return; }
    if (status === "error") throw new Error(
      `Step 4: Fanvue rejected the media (status=error). ` +
      `Images must be JPEG/PNG; videos must be MP4 (H.264). Response: ${text}`
    );
    await new Promise(r => setTimeout(r, POLL));
  }
  throw new Error(`Step 4: timed out after 120s. Media UUID: ${mediaUuid}`);
}

async function step5_createPost(token: string, mediaUuid: string, caption: string, audience: "subscribers" | "followers-and-subscribers", log: PublishLogger) {
  const body = { text: caption, mediaUuids: [mediaUuid], audience };
  log.log(`Step 5 — POST /posts  body=${JSON.stringify(body)}`);
  const res  = await fetch(`${FANVUE_API_BASE}/posts`, {
    method: "POST",
    headers: fanvueHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  log.log(`Step 5 → ${res.status}: ${text}`);
  if (!res.ok) throw new Error(`Step 5 failed (${res.status}): ${text}`);
  let data: any;
  try { data = JSON.parse(text); } catch { throw new Error(`Step 5: non-JSON response: ${text.slice(0, 300)}`); }
  const postUuid = data.uuid ?? null;
  if (!postUuid) throw new Error(`Step 5: no UUID in response: ${text.slice(0, 300)}`);
  log.log(`Step 5 ✅  post created, UUID=${postUuid}`);
  return postUuid as string;
}

async function publishToFanvue(params: {
  accessToken: string; mediaUrl: string; mediaType: "image" | "video";
  caption: string; audience?: "subscribers" | "followers-and-subscribers";
  onProgress?: (s: string) => void;
}): Promise<{ postUuid: string; log: string }> {
  const { accessToken, mediaUrl, mediaType, caption, audience = "followers-and-subscribers", onProgress } = params;
  const logger = new PublishLogger();
  const report = (s: string) => { logger.log(s); onProgress?.(s); };

  report(`Starting publish: mediaType=${mediaType}, url=${mediaUrl}`);

  const blob     = await fetchMediaBlob(mediaUrl, logger);
  const sizekb   = (blob.size / 1024).toFixed(1);
  const ext      = mediaType === "video" ? "mp4" : "jpeg";
  const filename = `lila-${Date.now()}.${ext}`;

  report(`Media ready: ${sizekb} KB`);

  const { mediaUuid, uploadId } = await step1_createSession(accessToken, filename, mediaType, logger);
  const presignedUrl            = await step2a_getPresignedUrl(accessToken, uploadId, 1, logger);
  const etag                    = await step2b_uploadToS3(presignedUrl, blob, logger);
  await step3_completeUpload(accessToken, uploadId, [{ PartNumber: 1, ETag: etag }], logger);
  await step4_waitUntilReady(accessToken, mediaUuid, logger, onProgress);
  const postUuid = await step5_createPost(accessToken, mediaUuid, caption, audience, logger);

  return { postUuid, log: logger.dump() };
}

// ─────────────────────────────────────────────────────────────────────────────
// Debug log dialog
// ─────────────────────────────────────────────────────────────────────────────
function DebugLogDialog({ open, onClose, log }: { open: boolean; onClose: () => void; log: string }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Bug className="h-4 w-4" /> Publish Debug Log</DialogTitle>
          <DialogDescription>Full trace of the last publish attempt. Share this to diagnose issues.</DialogDescription>
        </DialogHeader>
        <ScrollArea className="h-96 rounded-md border border-border bg-black p-3">
          <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-green-400">{log || "No log yet."}</pre>
        </ScrollArea>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(log)}>Copy log</Button>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
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

type ConnectedAccount = {
  id: string; platform: "fanvue"; name: string; handle: string;
  status: "connected" | "disconnected" | "error"; accessToken?: string;
};
type HistoryEvent = {
  at: string; label: string;
  kind: "approved"|"scheduled"|"queued"|"publishing"|"published"|"failed"|"retried";
};
type ScheduledItem = {
  id: string; contentName: string; type: ContentType; character: string;
  thumbnail: string; mediaUrl: string; accountId: string;
  scheduledAt: string; status: PublishStatus; queueStatus: QueueStatus;
  autoPublish: boolean; externalPostId?: string; publishedAt?: string;
  settings: { fps: number; framesPerScene: number; numScenes: number; samplingSteps: number };
  scenePrompts: string[]; negativePrompt: string; history: HistoryEvent[];
};

const EMPTY_SCHEDULE_ITEMS:     ScheduledItem[]    = [];
const EMPTY_CONNECTED_ACCOUNTS: ConnectedAccount[] = [];
const PLACEHOLDER = "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=600&q=80";

// ─────────────────────────────────────────────────────────────────────────────
// Data fetchers
// ─────────────────────────────────────────────────────────────────────────────
async function fetchAccounts(): Promise<ConnectedAccount[]> {
  const { data, error } = await supabase.from("connected_accounts").select("*").order("created_at");
  if (error) throw error;
  return (data ?? []).map((a: any) => ({
    id: a.id, platform: "fanvue", name: a.account_name,
    handle: a.external_account_id ?? "—",
    status: a.connection_status === "connected" ? "connected" : a.connection_status === "error" ? "error" : "disconnected",
    accessToken: a.access_token ?? undefined,
  }));
}

async function fetchSchedules(): Promise<ScheduledItem[]> {
  const { data: rows, error } = await supabase.from("schedules").select("*").order("publish_time");
  if (error) throw error;

  const imageIds = (rows ?? []).filter((r: any) => r.content_type === "image").map((r: any) => r.content_id);
  const videoIds = (rows ?? []).filter((r: any) => r.content_type === "video").map((r: any) => r.content_id);

  const [imgRes, vidRes, charRes] = await Promise.all([
    imageIds.length
      ? supabase.from("images").select("id, image_url, prompt, character_id, connected_account_id, published_at, external_post_id, publish_status").in("id", imageIds)
      : Promise.resolve({ data: [] } as any),
    videoIds.length
      ? supabase.from("videos").select("id, video_url, prompt, scene_prompts, character_id, connected_account_id, published_at, external_post_id, publish_status").in("id", videoIds)
      : Promise.resolve({ data: [] } as any),
    supabase.from("characters").select("id, name, reference_image_url"),
  ]);

  const imgMap  = new Map((imgRes.data ?? []).map((i: any) => [i.id, i]));
  const vidMap  = new Map((vidRes.data ?? []).map((v: any) => [v.id, v]));
  const charMap = new Map((charRes.data ?? []).map((c: any) => [c.id, c]));

  return (rows ?? []).map((r: any): ScheduledItem => {
    const isVideo  = r.content_type === "video";
    const src: any = isVideo ? vidMap.get(r.content_id) : imgMap.get(r.content_id);
    const char: any = src?.character_id ? charMap.get(src.character_id) : null;
    const scenes   = isVideo && Array.isArray(src?.scene_prompts) ? src.scene_prompts : src?.prompt ? [src.prompt] : [];
    const media    = isVideo ? src?.video_url : src?.image_url;
    const thumb    = char?.reference_image_url || media || PLACEHOLDER;

    // FIX 1: Determine real publish status
    // If external_post_id is a fake legacy ID (not a real UUID), treat the item
    // as "scheduled" so the Publish Now button is shown again.
    const rawStatus = r.status ?? src?.publish_status ?? "scheduled";
    const fakeId    = src?.external_post_id && !isRealFanvueUUID(src?.external_post_id);
    const status: PublishStatus =
      rawStatus === "published" && fakeId ? "scheduled"   // ← force re-publish for fake IDs
      : rawStatus === "published"         ? "published"
      : rawStatus === "failed"            ? "failed"
      : rawStatus === "publishing"        ? "publishing"
      : "scheduled";

    const queueStatus: QueueStatus =
      status === "published"  ? "published"
      : status === "failed"   ? "failed"
      : status === "publishing" ? "publishing"
      : new Date(r.publish_time) <= new Date() ? "ready" : "waiting";

    // FIX 2: accountId priority — schedule row first, then asset row
    // The schedule row's connected_account_id is the most up-to-date (set at schedule creation)
    const accountId = (r.connected_account_id ?? src?.connected_account_id ?? "").toString();

    return {
      id: r.id,
      contentName: `${char?.name ?? "Lila"} — ${(scenes[0] ?? "Untitled").slice(0, 40)}`,
      type: r.content_type, character: char?.name ?? "Lila",
      thumbnail: thumb, mediaUrl: media || "", accountId,
      scheduledAt: r.publish_time, status, queueStatus, autoPublish: true,
      // FIX 3: only surface externalPostId if it's a real UUID
      externalPostId: isRealFanvueUUID(src?.external_post_id) ? src.external_post_id : undefined,
      publishedAt:    src?.published_at ?? undefined,
      settings: { fps: 16, framesPerScene: 257, numScenes: scenes.length || 1, samplingSteps: 29 },
      scenePrompts: scenes, negativePrompt: "low quality, blurry, distorted face, watermark",
      history: [
        { at: r.created_at, label: `Scheduled for ${new Date(r.publish_time).toLocaleString()}`, kind: "scheduled" },
        ...(src?.published_at && isRealFanvueUUID(src?.external_post_id)
          ? [{ at: src.published_at, label: "Published", kind: "published" as const }]
          : []),
      ],
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const statusStyle: Record<PublishStatus, string> = {
  scheduled: "bg-chart-2/15 text-chart-2 border-chart-2/30",
  publishing: "bg-primary/15 text-primary border-primary/30",
  published: "bg-success/15 text-success border-success/30",
  failed: "bg-destructive/15 text-destructive border-destructive/30",
};
const queueStatusStyle: Record<QueueStatus, string> = {
  waiting: "bg-muted text-muted-foreground border-border",
  ready: "bg-chart-2/15 text-chart-2 border-chart-2/30",
  publishing: "bg-primary/15 text-primary border-primary/30",
  published: "bg-success/15 text-success border-success/30",
  failed: "bg-destructive/15 text-destructive border-destructive/30",
};
const fmtTime     = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const fmtDate     = (iso: string) => new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
const fmtDateTime = (iso: string) => `${fmtDate(iso)} · ${fmtTime(iso)}`;
const isSameDay   = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

function StatusBadge({ status }: { status: PublishStatus }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider", statusStyle[status])}>
      {status === "publishing" && <Loader2 className="h-2.5 w-2.5 animate-spin" />}{status}
    </span>
  );
}
function QueueBadge({ status }: { status: QueueStatus }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider", queueStatusStyle[status])}>
      {status}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Accounts dialog
// ─────────────────────────────────────────────────────────────────────────────
function AccountsDialog({ open, onOpenChange, accounts, onRefresh }: {
  open: boolean; onOpenChange: (o: boolean) => void; accounts: ConnectedAccount[]; onRefresh: () => void;
}) {
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const disconnect = async (id: string) => {
    setDisconnecting(id);
    try {
      const { error } = await supabase.from("connected_accounts")
        .update({ connection_status: "disconnected", access_token: null, refresh_token: null }).eq("id", id);
      if (error) throw error;
      toast.success("Account disconnected"); onRefresh();
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
    finally { setDisconnecting(null); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Fanvue Accounts</DialogTitle>
          <DialogDescription>Connect your Fanvue creator account to publish content.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {accounts.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-muted/30 p-6 text-center">
              <Plug className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-2 text-sm font-medium">No accounts connected</p>
            </div>
          ) : accounts.map((a) => (
            <div key={a.id} className="flex items-center justify-between rounded-lg border border-border bg-card p-3">
              <div className="flex items-center gap-3">
                <div className="grid h-9 w-9 place-items-center rounded-full bg-primary/10 text-primary font-semibold text-sm">{a.name.slice(0,1).toUpperCase()}</div>
                <div><p className="text-sm font-medium">{a.name}</p><p className="text-xs text-muted-foreground">@{a.handle}</p></div>
              </div>
              <div className="flex items-center gap-2">
                {a.status === "connected"
                  ? <Badge variant="outline" className="gap-1 border-success/40 text-success text-xs"><CheckCircle className="h-3 w-3" /> Connected</Badge>
                  : <Badge variant="outline" className="gap-1 border-destructive/40 text-destructive text-xs"><XCircle className="h-3 w-3" /> Offline</Badge>}
                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive text-xs"
                  disabled={disconnecting === a.id} onClick={() => disconnect(a.id)}>
                  {disconnecting === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Disconnect"}
                </Button>
              </div>
            </div>
          ))}
          <div className="rounded-lg border border-border bg-muted/20 p-4">
            <p className="text-xs font-medium mb-1">Connect a new account</p>
            <p className="text-xs text-muted-foreground mb-3">
              Scopes: <span className="font-mono">read:self read:media write:media write:post</span>
            </p>
            <Button className="w-full gap-2" onClick={() => { onOpenChange(false); startFanvueOAuth(); }}>
              <ExternalLink className="h-4 w-4" /> Connect Fanvue Account
            </Button>
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
  const { data: scheduleData = EMPTY_SCHEDULE_ITEMS } = useQuery({ queryKey: ["schedules"], queryFn: fetchSchedules, staleTime: 10_000 });
  const { data: accounts = EMPTY_CONNECTED_ACCOUNTS, refetch: refetchAccounts } = useQuery({ queryKey: ["connected-accounts"], queryFn: fetchAccounts, staleTime: 60_000 });

  const [items, setItems] = useState<ScheduledItem[]>([]);
  useEffect(() => setItems(scheduleData), [scheduleData]);

  const [debugLog, setDebugLog]         = useState("");
  const [debugOpen, setDebugOpen]       = useState(false);

  // OAuth redirect
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const code = p.get("code"); const err = p.get("error");
    if (err) { window.history.replaceState({}, "", window.location.pathname); toast.error(`Fanvue auth error: ${p.get("error_description") ?? err}`); return; }
    if (!code) return;
    window.history.replaceState({}, "", window.location.pathname);
    toast.loading("Connecting Fanvue account…", { id: "fanvue-connect" });
    exchangeFanvueCode(code)
      .then(() => { toast.success("Connected!", { id: "fanvue-connect" }); refetchAccounts(); queryClient.invalidateQueries({ queryKey: ["connected-accounts"] }); })
      .catch((e) => toast.error(e.message ?? "Failed", { id: "fanvue-connect" }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Realtime
  useEffect(() => {
    const ch = supabase.channel("schedules-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "schedules" }, () =>
        queryClient.invalidateQueries({ queryKey: ["schedules"] })).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [queryClient]);

  const [tab, setTab]                     = useState("calendar");
  const [search, setSearch]               = useState("");
  const [statusFilter, setStatusFilter]   = useState<"all" | PublishStatus>("all");
  const [accountFilter, setAccountFilter] = useState<string>("all");
  const [rangeFilter, setRangeFilter]     = useState<"all" | "today" | "week" | "month">("all");
  const [selected, setSelected]           = useState<ScheduledItem | null>(null);
  const [createOpen, setCreateOpen]       = useState(false);
  const [accountsOpen, setAccountsOpen]   = useState(false);
  const [weekStart, setWeekStart] = useState(() => {
    const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() - d.getDay()); return d;
  });

  const getAccount = (id: string) => accounts.find((a) => a.id === id);

  const stats = useMemo(() => {
    const now = new Date(); const wa = new Date(now); wa.setDate(wa.getDate() - 7);
    return {
      scheduled:         items.filter((i) => i.status === "scheduled").length,
      todayCount:        items.filter((i) => i.status === "scheduled" && isSameDay(new Date(i.scheduledAt), now)).length,
      weekPublished:     items.filter((i) => i.status === "published" && i.publishedAt && new Date(i.publishedAt) >= wa).length,
      failed:            items.filter((i) => i.status === "failed").length,
      connectedAccounts: accounts.filter((a) => a.status === "connected").length,
    };
  }, [items, accounts]);

  const filteredItems = useMemo(() => {
    const now = new Date();
    return items.filter((i) => {
      if (statusFilter !== "all"  && i.status    !== statusFilter)  return false;
      if (accountFilter !== "all" && i.accountId !== accountFilter) return false;
      if (rangeFilter !== "all") {
        const d = new Date(i.scheduledAt);
        if (rangeFilter === "today" && !isSameDay(d, now)) return false;
        if (rangeFilter === "week")  { const wk = new Date(now); wk.setDate(wk.getDate() + 7); if (d < now || d > wk) return false; }
        if (rangeFilter === "month" && (d.getMonth() !== now.getMonth() || d.getFullYear() !== now.getFullYear())) return false;
      }
      if (search.trim()) {
        const q = search.toLowerCase();
        const acc = getAccount(i.accountId);
        const hay = [i.contentName, i.character, acc?.name, acc?.handle].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, statusFilter, accountFilter, rangeFilter, search]);

  const updateItem = (id: string, patch: Partial<ScheduledItem>) =>
    setItems((prev) => prev.map((i) => i.id === id ? { ...i, ...patch } : i));

  const removeItem = async (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    setSelected(null);
    try { const { error } = await supabase.from("schedules").delete().eq("id", id); if (error) throw error; toast.success("Removed"); queryClient.invalidateQueries({ queryKey: ["schedules"] }); }
    catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };

  const retryPublish = async (id: string) => {
    updateItem(id, { status: "scheduled", queueStatus: "ready" });
    try { await scheduleService.update(id, { status: "scheduled" }); toast.success("Queued for retry"); }
    catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };

  // FIX 4: publishNow — robust account resolution with clear diagnostics
  const publishNow = async (id: string) => {
    const item = items.find((i) => i.id === id);
    if (!item) return;

    // Step A: try to find the account linked to this specific item
    let account = item.accountId
      ? accounts.find((a) => a.id === item.accountId && a.status === "connected" && !!a.accessToken)
      : undefined;

    // Step B: if not found, fall back to ANY connected account
    if (!account) {
      account = accounts.find((a) => a.status === "connected" && !!a.accessToken);
      if (account) {
        // FIX 5: update the schedule row so it's properly linked going forward
        await supabase.from("schedules").update({ connected_account_id: account.id }).eq("id", id);
        updateItem(id, { accountId: account.id });
        toast.info(`Using account @${account.handle} (auto-selected)`);
      }
    }

    if (!account) {
      toast.error("No connected Fanvue account found. Please connect one first.", {
        action: { label: "Connect account", onClick: () => setAccountsOpen(true) },
      });
      return;
    }

    // FIX 6: validate media URL before starting
    if (!item.mediaUrl) {
      toast.error(
        "No media URL found on this item. The image/video may still be generating, or the URL was never saved.",
        { duration: 8000 }
      );
      return;
    }

    updateItem(id, { status: "publishing", queueStatus: "publishing" });
    const toastId = `pub-${id}`;
    toast.loading(`Uploading to Fanvue via @${account.handle}…`, { id: toastId });

    let publishLog = "";
    try {
      const caption = item.scenePrompts[0] ?? item.contentName;
      const { postUuid: externalPostId, log } = await publishToFanvue({
        accessToken: account.accessToken!,
        mediaUrl:    item.mediaUrl,
        mediaType:   item.type,
        caption,
        audience:    "followers-and-subscribers",
        onProgress:  (s) => toast.loading(s, { id: toastId }),
      });
      publishLog = log;

      // Save back to Supabase
      const now   = new Date().toISOString();
      const table = item.type === "image" ? "images" : "videos";
      const { data: schedRow } = await supabase.from("schedules").select("content_id").eq("id", id).single();
      if (schedRow?.content_id) {
        await supabase.from(table).update({
          publish_status:       "published",
          published_at:         now,
          external_post_id:     externalPostId,
          connected_account_id: account.id,
        }).eq("id", schedRow.content_id);
      }
      await supabase.from("schedules").update({ connected_account_id: account.id, status: "published" }).eq("id", id);
      await scheduleService.update(id, { status: "published" });

      updateItem(id, {
        status: "published", queueStatus: "published",
        accountId: account.id, externalPostId, publishedAt: now,
        history: [...item.history, { at: now, label: `Published to @${account.handle}`, kind: "published" }],
      });

      toast.success(`🎉 Published to @${account.handle}!`, {
        id: toastId, duration: 12_000,
        description: `Post UUID: ${externalPostId}`,
        action: { label: "View on Fanvue", onClick: () => window.open(`https://www.fanvue.com/post/${externalPostId}`, "_blank") },
      });
      queryClient.invalidateQueries({ queryKey: ["schedules"] });

    } catch (e: any) {
      const msg = e?.message ?? "Unknown error";
      publishLog = publishLog + `\n\nERROR: ${msg}`;
      console.error("[publishNow] FAILED:", msg);
      updateItem(id, { status: "failed", queueStatus: "failed" });
      try { await scheduleService.update(id, { status: "failed" }); } catch {}
      setDebugLog(publishLog);
      toast.error("Publish failed", {
        id: toastId, duration: 20_000,
        description: msg.slice(0, 120),
        action: { label: "View debug log", onClick: () => setDebugOpen(true) },
      });
    }
  };

  const [dragId, setDragId] = useState<string | null>(null);
  const onDropOnDay = async (day: Date) => {
    if (!dragId) return;
    const item = items.find((i) => i.id === dragId);
    if (!item) return;
    const newD = new Date(day); const oldD = new Date(item.scheduledAt);
    newD.setHours(oldD.getHours(), oldD.getMinutes(), 0, 0);
    const iso = newD.toISOString();
    updateItem(dragId, { scheduledAt: iso });
    try { await scheduleService.update(dragId, { publish_time: iso }); toast.success("Rescheduled"); }
    catch (e: any) { toast.error(e?.message ?? "Failed"); }
    setDragId(null);
  };

  const connectedCount = accounts.filter((a) => a.status === "connected").length;

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <AppHeader />
        <main className="flex-1 overflow-y-auto bg-background">
          <div className="mx-auto max-w-[1400px] space-y-6 p-4 sm:p-6 lg:p-8">

            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <Link to="/" className="mb-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
                  <ArrowLeft className="h-3.5 w-3.5" /> Dashboard
                </Link>
                <h1 className="font-display text-3xl font-semibold tracking-tight">Scheduling</h1>
                <p className="mt-1 text-sm text-muted-foreground">Plan, queue and publish approved content to your Fanvue account.</p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="gap-2" onClick={() => { if (debugLog) setDebugOpen(true); else toast.info("No debug log yet — attempt a publish first."); }}>
                  <Bug className="h-4 w-4" /> Debug log
                </Button>
                <Button variant="outline" size="sm" className="gap-2" onClick={() => setAccountsOpen(true)}>
                  <Plug className="h-4 w-4" />
                  {connectedCount > 0
                    ? <span>Accounts <span className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-success text-[10px] font-bold text-white">{connectedCount}</span></span>
                    : "Connect Fanvue"}
                </Button>
                <Button size="sm" className="gap-2" onClick={() => setCreateOpen(true)}>
                  <CalendarPlus className="h-4 w-4" /> Schedule content
                </Button>
              </div>
            </div>

            {connectedCount === 0 && (
              <div className="flex items-center gap-3 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3">
                <AlertTriangle className="h-4 w-4 flex-shrink-0 text-warning" />
                <p className="flex-1 text-sm">No Fanvue account connected.</p>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setAccountsOpen(true)}>
                  <ExternalLink className="h-3.5 w-3.5" /> Connect now
                </Button>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <DashboardCard label="Scheduled posts"     value={stats.scheduled}        icon={CalendarClock} accent="primary"  hint="Awaiting publish" />
              <DashboardCard label="Publishing today"    value={stats.todayCount}        icon={Clock}         accent="chart-2"  hint="Next 24h" />
              <DashboardCard label="Published this week" value={stats.weekPublished}     icon={CheckCircle2}  accent="chart-3" />
              <DashboardCard label="Failed"              value={stats.failed}            icon={AlertTriangle} accent="chart-5"  hint={stats.failed ? "Needs attention" : "All clear"} />
              <DashboardCard label="Connected accounts"  value={`${stats.connectedAccounts}/${accounts.length}`} icon={Link2} accent="chart-4" hint="Fanvue" />
            </div>

            <Card className="border-border/60 bg-card">
              <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className="pl-9" />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Filter className="h-4 w-4 text-muted-foreground" />
                  <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as never)}>
                    <SelectTrigger className="h-9 w-[150px]"><SelectValue placeholder="Status" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      <SelectItem value="scheduled">Scheduled</SelectItem>
                      <SelectItem value="publishing">Publishing</SelectItem>
                      <SelectItem value="published">Published</SelectItem>
                      <SelectItem value="failed">Failed</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={accountFilter} onValueChange={setAccountFilter}>
                    <SelectTrigger className="h-9 w-[180px]"><SelectValue placeholder="Account" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All accounts</SelectItem>
                      {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={rangeFilter} onValueChange={(v) => setRangeFilter(v as never)}>
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
                <CalendarView weekStart={weekStart} setWeekStart={setWeekStart}
                  items={filteredItems} getAccount={getAccount}
                  onOpen={setSelected} onDragStart={setDragId} onDropOnDay={onDropOnDay}
                  onSchedule={() => setCreateOpen(true)} />
              </TabsContent>
              <TabsContent value="queue" className="mt-4">
                {/* FIX 7: Queue now also shows items with fake IDs (re-publish needed) */}
                <QueueView
                  items={filteredItems.filter((i) => ["scheduled","publishing","failed"].includes(i.status))}
                  getAccount={getAccount} onOpen={setSelected}
                  onCancel={removeItem} onPublishNow={publishNow} onRetry={retryPublish}
                  onSchedule={() => setCreateOpen(true)} />
              </TabsContent>
              <TabsContent value="history" className="mt-4">
                <HistoryView
                  items={filteredItems.filter((i) => ["published","failed"].includes(i.status))}
                  getAccount={getAccount} onOpen={setSelected} onRetry={retryPublish} />
              </TabsContent>
            </Tabs>
          </div>
        </main>
      </SidebarInset>

      <DetailSheet item={selected} onClose={() => setSelected(null)}
        getAccount={getAccount} onRetry={retryPublish} onPublishNow={publishNow} onRemove={removeItem} />
      <CreateScheduleDialog open={createOpen} onOpenChange={setCreateOpen} accounts={accounts} />
      <AccountsDialog open={accountsOpen} onOpenChange={setAccountsOpen} accounts={accounts}
        onRefresh={() => { refetchAccounts(); queryClient.invalidateQueries({ queryKey: ["connected-accounts"] }); }} />
      <DebugLogDialog open={debugOpen} onClose={() => setDebugOpen(false)} log={debugLog} />
    </SidebarProvider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Calendar view
// ─────────────────────────────────────────────────────────────────────────────
function CalendarView({ weekStart, setWeekStart, items, getAccount, onOpen, onDragStart, onDropOnDay, onSchedule }: {
  weekStart: Date; setWeekStart: (d: Date) => void; items: ScheduledItem[];
  getAccount: (id: string) => ConnectedAccount | undefined; onOpen: (i: ScheduledItem) => void;
  onDragStart: (id: string | null) => void; onDropOnDay: (d: Date) => void; onSchedule: () => void;
}) {
  const days = Array.from({ length: 7 }).map((_, idx) => { const d = new Date(weekStart); d.setDate(d.getDate() + idx); return d; });
  const move = (n: number) => { const d = new Date(weekStart); d.setDate(d.getDate() + n * 7); setWeekStart(d); };
  const todayD = new Date();
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
            <Button variant="outline" size="sm" className="h-8" onClick={() => { const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()-d.getDay()); setWeekStart(d); }}>Today</Button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => move(1)}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
        {items.length === 0 ? <EmptyState onSchedule={onSchedule} /> : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-7">
            {days.map((day) => {
              const dayItems = items.filter((i) => isSameDay(new Date(i.scheduledAt), day)).sort((a,b) => +new Date(a.scheduledAt) - +new Date(b.scheduledAt));
              const isToday  = isSameDay(day, todayD);
              return (
                <div key={day.toISOString()} onDragOver={(e) => e.preventDefault()} onDrop={() => onDropOnDay(day)}
                  className="flex min-h-[260px] flex-col rounded-lg border border-border/60 bg-background/40 p-2 hover:border-primary/40">
                  <div className="mb-2 flex items-baseline justify-between px-1">
                    <p className={cn("text-[10px] font-medium uppercase tracking-wider", isToday ? "text-primary" : "text-muted-foreground")}>{day.toLocaleDateString([], { weekday: "short" })}</p>
                    <p className={cn("font-display text-lg font-semibold", isToday ? "text-primary" : "text-foreground")}>{day.getDate()}</p>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {dayItems.map((i) => (
                      <button key={i.id} type="button" draggable onDragStart={() => onDragStart(i.id)} onClick={() => onOpen(i)}
                        className="group flex flex-col gap-1.5 rounded-md border border-border/60 bg-card p-1.5 text-left hover:border-primary/50">
                        <div className="relative h-16 w-full overflow-hidden rounded">
                          <img src={i.thumbnail} alt={i.contentName} className="h-full w-full object-cover" />
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
function QueueView({ items, getAccount, onOpen, onCancel, onPublishNow, onRetry, onSchedule }: {
  items: ScheduledItem[]; getAccount: (id: string) => ConnectedAccount | undefined;
  onOpen: (i: ScheduledItem) => void; onCancel: (id: string) => void;
  onPublishNow: (id: string) => void; onRetry: (id: string) => void; onSchedule: () => void;
}) {
  if (items.length === 0) return (
    <Card className="border-border/60 bg-card"><CardContent className="p-4"><EmptyState onSchedule={onSchedule} message="Queue is empty." /></CardContent></Card>
  );
  return (
    <div className="grid gap-3">
      {items.map((i) => {
        const account = getAccount(i.accountId);
        return (
          <Card key={i.id} className="border-border/60 bg-card hover:border-primary/40">
            <CardContent className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
              <button type="button" onClick={() => onOpen(i)} className="relative h-20 w-32 shrink-0 overflow-hidden rounded-md bg-muted">
                <img src={i.thumbnail} alt={i.contentName} className="h-full w-full object-cover hover:scale-105 transition-transform" />
                {i.type === "video" && <div className="absolute inset-0 grid place-items-center bg-black/30"><Play className="h-5 w-5 text-white" /></div>}
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-semibold">{i.contentName}</p>
                  <QueueBadge status={i.queueStatus} />
                </div>
                {/* FIX 8: Show account info or helpful message */}
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {i.character} ·{" "}
                  {account
                    ? <span className="text-foreground">@{account.handle}</span>
                    : <span className="text-amber-500">No account linked — will auto-pick first connected account</span>}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground font-mono break-all">
                  {i.mediaUrl
                    ? <span className="text-muted-foreground">media: {i.mediaUrl.slice(0, 60)}…</span>
                    : <span className="text-destructive font-semibold">⚠ Media URL missing — image may still be generating</span>}
                </p>
                <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />{fmtDateTime(i.scheduledAt)}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                {i.status === "failed" ? (
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onRetry(i.id)}><RefreshCw className="h-3.5 w-3.5" /> Retry</Button>
                ) : (
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onPublishNow(i.id)} disabled={i.status === "publishing" || !i.mediaUrl}>
                    {i.status === "publishing" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    {i.status === "publishing" ? "Publishing…" : "Publish now"}
                  </Button>
                )}
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
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// History view
// ─────────────────────────────────────────────────────────────────────────────
function HistoryView({ items, getAccount, onOpen, onRetry }: {
  items: ScheduledItem[]; getAccount: (id: string) => ConnectedAccount | undefined;
  onOpen: (i: ScheduledItem) => void; onRetry: (id: string) => void;
}) {
  if (items.length === 0) return (
    <Card className="border-border/60 bg-card"><CardContent className="p-10 text-center">
      <Inbox className="mx-auto h-10 w-10 text-muted-foreground/60" />
      <p className="mt-3 font-medium">No publishing history yet</p>
    </CardContent></Card>
  );
  return (
    <Card className="border-border/60 bg-card"><CardContent className="p-0">
      <div className="grid grid-cols-12 gap-3 border-b border-border/60 px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        <div className="col-span-5">Content</div><div className="col-span-2">Account</div>
        <div className="col-span-2">Published</div><div className="col-span-2">Post UUID</div>
        <div className="col-span-1 text-right">Status</div>
      </div>
      {items.map((i) => {
        const account = getAccount(i.accountId);
        return (
          <button key={i.id} type="button" onClick={() => onOpen(i)}
            className="grid w-full grid-cols-12 items-center gap-3 border-b border-border/40 px-4 py-3 text-left hover:bg-muted/40 last:border-b-0">
            <div className="col-span-5 flex items-center gap-3">
              <div className="relative h-12 w-16 shrink-0 overflow-hidden rounded">
                <img src={i.thumbnail} alt={i.contentName} className="h-full w-full object-cover" />
                {i.type === "video" && <div className="absolute inset-0 grid place-items-center bg-black/30"><Play className="h-3.5 w-3.5 text-white" /></div>}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{i.contentName}</p>
                <p className="truncate text-xs text-muted-foreground">{i.character}</p>
              </div>
            </div>
            <div className="col-span-2 text-xs"><p className="truncate">{account?.name ?? "—"}</p><p className="truncate text-muted-foreground">@{account?.handle ?? "—"}</p></div>
            <div className="col-span-2 text-xs text-muted-foreground">{i.publishedAt ? fmtDateTime(i.publishedAt) : "—"}</div>
            <div className="col-span-2 truncate font-mono text-[11px] text-muted-foreground">{i.externalPostId ?? "—"}</div>
            <div className="col-span-1 flex items-center justify-end gap-2">
              <StatusBadge status={i.status} />
              {i.status === "failed" && (
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); onRetry(i.id); }}><RefreshCw className="h-3.5 w-3.5" /></Button>
              )}
            </div>
          </button>
        );
      })}
    </CardContent></Card>
  );
}

function EmptyState({ onSchedule, message = "No scheduled content." }: { onSchedule: () => void; message?: string }) {
  return (
    <div className="mx-auto max-w-md py-10 text-center">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-border/60 bg-background"><CalendarClock className="h-6 w-6 text-muted-foreground" /></div>
      <p className="mt-4 font-display text-lg font-semibold">{message}</p>
      <p className="mt-1 text-sm text-muted-foreground">Pick an approved asset and schedule it to your Fanvue account.</p>
      <Button size="sm" className="mt-5 gap-2" onClick={onSchedule}><CalendarPlus className="h-4 w-4" /> Schedule content</Button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Detail sheet
// ─────────────────────────────────────────────────────────────────────────────
function DetailSheet({ item, onClose, getAccount, onRetry, onPublishNow, onRemove }: {
  item: ScheduledItem | null; onClose: () => void;
  getAccount: (id: string) => ConnectedAccount | undefined;
  onRetry: (id: string) => void; onPublishNow: (id: string) => void; onRemove: (id: string) => void;
}) {
  const account = item ? getAccount(item.accountId) : undefined;

  // FIX 9: show Publish Now if not truly published (i.e. no real Fanvue UUID yet)
  const canPublish = item && item.status !== "publishing" && item.status !== "published";

  return (
    <Sheet open={!!item} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {item && (<>
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">{item.contentName} <StatusBadge status={item.status} /></SheetTitle>
            <SheetDescription>{item.character} · {item.type} · {fmtDateTime(item.scheduledAt)}</SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-6">
            <div className="relative aspect-video overflow-hidden rounded-lg bg-muted">
              {item.type === "video"
                ? <video src={item.mediaUrl || item.thumbnail} controls playsInline className="h-full w-full object-cover" />
                : <img src={item.mediaUrl || item.thumbnail} alt={item.contentName} className="h-full w-full object-cover" />}
            </div>

            {/* Media URL debug info */}
            <div className="rounded-md border border-border bg-background/40 p-3">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Media URL</p>
              {item.mediaUrl
                ? <p className="font-mono text-[11px] break-all text-foreground">{item.mediaUrl}</p>
                : <p className="text-destructive text-xs font-semibold">⚠️ MISSING — image/video URL is empty. The asset did not finish generating.</p>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Scheduled"         value={fmtDateTime(item.scheduledAt)} />
              <Field label="Connected account" value={account ? `${account.name} (@${account.handle})` : "Not linked — will auto-pick first connected"} />
              {item.publishedAt && <Field label="Published at" value={fmtDateTime(item.publishedAt)} />}
            </div>

            {item.externalPostId && (
              <div className="rounded-md border border-border bg-background/40 p-3">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Fanvue Post UUID</p>
                <p className="mt-1 font-mono text-xs break-all text-foreground">{item.externalPostId}</p>
                <a href={`https://www.fanvue.com/post/${item.externalPostId}`} target="_blank" rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1.5 text-xs text-primary hover:underline">
                  <ExternalLink className="h-3 w-3" /> View on Fanvue
                </a>
              </div>
            )}

            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Scene prompts</p>
              <ScrollArea className="h-40 rounded-md border border-border bg-background/40 p-3">
                <ol className="space-y-2 text-xs">
                  {item.scenePrompts.map((p, idx) => <li key={idx} className="leading-relaxed"><span className="mr-1 text-muted-foreground">{idx + 1}.</span>{p}</li>)}
                </ol>
              </ScrollArea>
            </div>

            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">History</p>
              <ol className="relative space-y-3 border-l border-border pl-4">
                {item.history.map((h, idx) => (
                  <li key={idx} className="relative">
                    <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-primary ring-4 ring-background" />
                    <p className="text-xs font-medium">{h.label}</p>
                    <p className="text-[11px] text-muted-foreground">{fmtDateTime(h.at)}</p>
                  </li>
                ))}
              </ol>
            </div>

            <Separator />
            <div className="flex flex-wrap items-center gap-2">
              {/* FIX 9: Show publish button for all non-truly-published items */}
              {canPublish && (
                <Button size="sm" className="gap-2" onClick={() => onPublishNow(item.id)} disabled={!item.mediaUrl}>
                  {item.status === "publishing" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {item.status === "publishing" ? "Publishing…" : item.status === "failed" ? "Retry publish" : "Publish now"}
                </Button>
              )}
              {item.status === "published" && (
                <Button size="sm" variant="outline" className="gap-2" onClick={() => onPublishNow(item.id)}>
                  <RefreshCw className="h-4 w-4" /> Re-publish
                </Button>
              )}
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

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-background/40 p-3">
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm text-foreground">{value}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Create schedule dialog
// ─────────────────────────────────────────────────────────────────────────────
type ApprovedAsset = { id: string; type: "image" | "video"; name: string };
const EMPTY_APPROVED_ASSETS: ApprovedAsset[] = [];

async function fetchApprovedAssets(): Promise<ApprovedAsset[]> {
  const [imgRes, vidRes, charRes] = await Promise.all([
    supabase.from("images").select("id, image_url, prompt, character_id").eq("status", "approved"),
    supabase.from("videos").select("id, video_url, prompt, character_id").eq("status", "approved"),
    supabase.from("characters").select("id, name"),
  ]);
  const charMap = new Map((charRes.data ?? []).map((c: any) => [c.id, c]));
  return [
    ...(imgRes.data ?? []).map((i: any): ApprovedAsset => ({
      id: i.id, type: "image",
      name: `${charMap.get(i.character_id)?.name ?? "Lila"} — ${(i.prompt ?? "Image").slice(0, 40)}`,
    })),
    ...(vidRes.data ?? []).map((v: any): ApprovedAsset => ({
      id: v.id, type: "video",
      name: `${charMap.get(v.character_id)?.name ?? "Lila"} — ${(v.prompt ?? "Video").slice(0, 40)}`,
    })),
  ];
}

function CreateScheduleDialog({ open, onOpenChange, accounts }: {
  open: boolean; onOpenChange: (o: boolean) => void; accounts: ConnectedAccount[];
}) {
  const queryClient    = useQueryClient();
  const { data: assets = EMPTY_APPROVED_ASSETS } = useQuery({ queryKey: ["approved-assets"], queryFn: fetchApprovedAssets, enabled: open });
  const connectedAccounts = accounts.filter((a) => a.status === "connected");

  const [contentIdx, setContentIdx] = useState("0");
  const [accountId,  setAccountId]  = useState("");
  const [date, setDate] = useState(() => { const d = new Date(); d.setDate(d.getDate()+1); return d.toISOString().slice(0,10); });
  const [time, setTime] = useState("18:00");

  useEffect(() => {
    if (connectedAccounts.length && !accountId) setAccountId(connectedAccounts[0].id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectedAccounts.length]);

  const submit = async () => {
    const asset = assets[Number(contentIdx)];
    if (!asset)     { toast.error("Pick an approved asset first"); return; }
    if (!accountId) { toast.error("Select a Fanvue account first"); return; }
    const iso = new Date(`${date}T${time}:00`).toISOString();
    try {
      const { data: u } = await supabase.auth.getUser();
      const { error: schedErr } = await supabase.from("schedules").insert({
        content_type: asset.type, content_id: asset.id,
        publish_time: iso, platform: "Fanvue", status: "scheduled",
        connected_account_id: accountId,
        created_by: u.user?.id ?? null,
      });
      if (schedErr) throw schedErr;
      // Also save on asset row as backup
      const table = asset.type === "image" ? "images" : "videos";
      await supabase.from(table).update({ connected_account_id: accountId }).eq("id", asset.id);
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
              ? <p className="rounded-md border border-dashed border-border bg-muted/30 p-3 text-xs text-muted-foreground">No approved content. Approve items in the Review Queue first.</p>
              : <Select value={contentIdx} onValueChange={setContentIdx}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{assets.map((a, idx) => <SelectItem key={a.id} value={String(idx)}>{a.name}</SelectItem>)}</SelectContent>
                </Select>}
          </div>
          <div className="space-y-1.5">
            <Label>Publishing account</Label>
            {connectedAccounts.length === 0
              ? <div className="rounded-md border border-dashed border-border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground mb-2">No Fanvue account connected yet.</p>
                  <Button size="sm" className="gap-2 w-full" onClick={() => { onOpenChange(false); startFanvueOAuth(); }}>
                    <ExternalLink className="h-3.5 w-3.5" /> Connect Fanvue Account
                  </Button>
                </div>
              : <Select value={accountId} onValueChange={setAccountId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{connectedAccounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name} (@{a.handle})</SelectItem>)}</SelectContent>
                </Select>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Time</Label><Input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} className="gap-2" disabled={!assets.length || !connectedAccounts.length}>
            <CalendarPlus className="h-4 w-4" /> Schedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
