import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@supabase/supabase-js";
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
// DIRECT TARGETED SUPABASE CLIENT INSTANTIATION
// ─────────────────────────────────────────────────────────────────────────────
const SUPABASE_URL = "https://yaiygjwbtzevjpxncvzu.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlhaXlnandidHpldmpweG5jdnp1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTQ2NTA0MiwiZXhwIjoyMDk3MDQxMDQyfQ.ui2Nt6AmAJv8v5XLf2ozumHlBG4BXg7ROIuo80V9UXk";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true }
});

// ─────────────────────────────────────────────────────────────────────────────
// Fanvue Configuration
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

const isRealFanvueUUID = (id?: string) =>
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
// PKCE OAuth Flow
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
      grant_type:    "authorization_code",
      code,
      redirect_uri:  FANVUE_REDIRECT_URI,
      client_id:     FANVUE_CLIENT_ID,
      client_secret: FANVUE_CLIENT_SECRET,
      code_verifier: verifier,
    }).toString(),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${await res.text()}`);
  const tokens = await res.json();

  const accessToken  = tokens.access_token  as string;
  const refreshToken = tokens.refresh_token as string | undefined;
  const expiresIn    = tokens.expires_in    as number | undefined;

  const profileRes = await fetch(`${FANVUE_API_BASE}/v1/me`, { headers: fanvueHeaders(accessToken) });
  const profile    = profileRes.ok ? await profileRes.json() : {};

  const realUuid = profile.id || profile.uuid;
  const handle   = profile.handle || "fanvue-user";
  const name     = profile.displayName || handle;

  const { data: u } = await supabase.auth.getUser();

  const upsertPayload = {
    account_name:        name,
    external_account_id: realUuid || handle,
    platform:            "fanvue",
    connection_status:   "connected",
    access_token:        accessToken,
    refresh_token:       refreshToken ?? null,
    token_expires_at:    expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
    created_by:          u.user?.id || null, 
  };

  const { error } = await supabase
    .from("connected_accounts")
    .upsert(upsertPayload, { onConflict: "external_account_id" });

  if (error) {
    const { error: insertError } = await supabase.from("connected_accounts").insert(upsertPayload);
    if (insertError) throw new Error(`Database entry failure: ${insertError.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Token Retrieval Pipeline
// ─────────────────────────────────────────────────────────────────────────────
async function fetchBestFanvueAccount(): Promise<{
  id: string; handle: string; name: string; accessToken: string;
} | null> {
  const { data, error } = await supabase
    .from("connected_accounts")
    .select("id, account_name, external_account_id, access_token, connection_status, updated_at")
    .eq("platform", "fanvue")
    .not("access_token", "is", null)
    .order("updated_at", { ascending: false });

  if (error || !data || data.length === 0) return null;

  const connected = data.find((r: any) => r.connection_status === "connected" && r.access_token);
  const best = connected ?? data[0];

  return {
    id:          best.id,
    handle:      best.external_account_id ?? "—",
    name:        best.account_name ?? "Fanvue",
    accessToken: best.access_token,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Real 3-Step Fanvue Upload Pipeline Orchestration
// ─────────────────────────────────────────────────────────────────────────────
async function fetchMediaBlob(url: string, log: PublishLogger): Promise<Blob> {
  log.log(`Fetching asset: ${url}`);
  let res = await fetch(url);
  if (!res.ok) {
    log.log("Direct download mapping blocked, routing via proxy-image tunnel…");
    res = await fetch(`/api/proxy-image?url=${encodeURIComponent(url)}`);
  }
  if (!res.ok) throw new Error(`Asset down-stream transmission rejected (${res.status}).`);
  return await res.blob();
}

async function step1_createSession(token: string, mediaType: "image" | "video", log: PublishLogger) {
  log.log(`Step 1: Initializing multipart session for type: ${mediaType}`);
  const res = await fetch(`${FANVUE_API_BASE}/v1/media/uploads`, {
    method: "POST",
    headers: fanvueHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ type: mediaType }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Initialization failed (${res.status}): ${text}`);
  const data = JSON.parse(text);
  if (!data.mediaUuid || !data.uploadId) throw new Error(`Invalid registration structure response: ${text}`);
  return data as { mediaUuid: string; uploadId: string };
}

async function step2a_getPresignedUrl(token: string, uploadId: string, partNumber: number, log: PublishLogger) {
  const url = `${FANVUE_API_BASE}/v1/media/uploads/${uploadId}/parts/${partNumber}/url`;
  log.log(`Step 2a: Acquiring presigned object target url`);
  const res = await fetch(url, { headers: fanvueHeaders(token) });
  const text = await res.text();
  if (!res.ok) throw new Error(`Target mapping acquisition rejected (${res.status}): ${text}`);
  const data = JSON.parse(text);
  return data.url as string;
}

async function step2b_uploadToS3(presignedUrl: string, blob: Blob, log: PublishLogger) {
  log.log(`Step 2b: Streaming raw binary object block (${blob.size} bytes) via PUT directly to storage…`);
  const res = await fetch(presignedUrl, { method: "PUT", body: blob });
  const etag = (res.headers.get("ETag") ?? res.headers.get("etag") ?? "").replace(/"/g, "");
  if (!res.ok) throw new Error(`Storage ingestion rejected structure update (${res.status})`);
  if (!etag) throw new Error("Storage upload finished but unique hash parsing returned an invalid empty token.");
  return etag;
}

async function step3_completeUpload(token: string, uploadId: string, parts: { partNumber: number; eTag: string }[], log: PublishLogger) {
  log.log(`Step 3: Compiling tracking layers and executing assembly verification PATCH`);
  const res = await fetch(`${FANVUE_API_BASE}/v1/media/uploads/${uploadId}`, {
    method: "PATCH",
    headers: fanvueHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ parts }),
  });
  if (!res.ok) throw new Error(`Verification completion workflow failed (${res.status}): ${await res.text()}`);
}

async function step4_createPost(token: string, mediaUuid: string, caption: string, audience: "subscribers" | "followers-and-subscribers", log: PublishLogger) {
  const body = { text: caption, mediaUuids: [mediaUuid], audience };
  log.log(`Step 4: Creating target timeline post structure object…`);
  const res = await fetch(`${FANVUE_API_BASE}/v1/posts`, {
    method: "POST",
    headers: fanvueHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Publication pipeline rejected registration (${res.status}): ${text}`);
  const data = JSON.parse(text);
  const postUuid = data.id || data.uuid;
  if (!postUuid) throw new Error(`Post accepted but structural tracking parameters could not be read: ${text}`);
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

  report(`Beginning operational pipeline deployment task: type=${mediaType}`);
  const blob = await fetchMediaBlob(mediaUrl, logger);
  
  const { mediaUuid, uploadId } = await step1_createSession(accessToken, mediaType, logger);
  const presignedUrl            = await step2a_getPresignedUrl(accessToken, uploadId, 1, logger);
  const etag                    = await step2b_uploadToS3(presignedUrl, blob, logger);
  
  await step3_completeUpload(accessToken, uploadId, [{ partNumber: 1, eTag: etag }], logger);
  const postUuid = await step4_createPost(accessToken, mediaUuid, caption, audience, logger);

  return { postUuid, log: logger.dump() };
}

// ─────────────────────────────────────────────────────────────────────────────
// Debug log dialogs
// ─────────────────────────────────────────────────────────────────────────────
function DebugLogDialog({ open, onClose, log }: { open: boolean; onClose: () => void; log: string }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Bug className="h-4 w-4" /> Publish Debug Log</DialogTitle>
          <DialogDescription>Full trace of the last publish attempt.</DialogDescription>
        </DialogHeader>
        <ScrollArea className="h-96 rounded-md border border-border bg-black p-3">
          <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-green-400">{log || "No log records saved yet."}</pre>
        </ScrollArea>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(log)}>Copy log</Button>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DBDiagDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [rows, setRows]   = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    supabase
      .from("connected_accounts")
      .select("*")
      .then(({ data, error }) => {
        setRows(data ?? []);
        setLoading(false);
      });
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>DB Diagnostic — connected_accounts</DialogTitle>
          <DialogDescription>Direct view of data inside database schema.</DialogDescription>
        </DialogHeader>
        <ScrollArea className="h-80 rounded-md border border-border bg-black p-3">
          {loading
            ? <p className="text-green-400 font-mono text-xs">Loading target rows…</p>
            : rows.length === 0
              ? <p className="text-red-400 font-mono text-xs">⚠ THE TABLE IS COMPLETELY EMPTY (https://yaiygjwbtzevjpxncvzu.supabase.co)</p>
              : rows.map((r, i) => (
                  <pre key={i} className="whitespace-pre-wrap break-all font-mono text-[10px] text-green-400 border-b border-green-900 pb-2 mb-2">
{JSON.stringify({
  id: r.id,
  platform: r.platform,
  status: r.connection_status,
  name: r.account_name,
  handle: r.external_account_id,
  has_token: !!r.access_token,
  created: r.created_at,
  updated: r.updated_at,
}, null, 2)}
                  </pre>
                ))
          }
        </ScrollArea>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(JSON.stringify(rows, null, 2))}>Copy JSON</Button>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Types Declarations
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

type ApprovedAsset = {
  id: string;
  type: ContentType;
  name: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Page Routing Definitions
// ─────────────────────────────────────────────────────────────────────────────
function RouteErrorBoundary({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-6 text-center">
      <h2 className="font-display text-lg font-semibold">Scheduling interface failed to parse</h2>
      <p className="max-w-md text-sm text-muted-foreground">{error?.message ?? "Unknown error routing scope"}</p>
      <div className="flex gap-2">
        <button onClick={() => reset()} className="rounded-md border border-input bg-background px-4 py-2 text-sm">Try again</button>
        <a href="/" className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">Go home</a>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/schedule")({
  component: SchedulePage,
  errorComponent: RouteErrorBoundary,
});

// ─────────────────────────────────────────────────────────────────────────────
// Data Synchronizations
// ─────────────────────────────────────────────────────────────────────────────
const EMPTY_SCHEDULE_ITEMS:     ScheduledItem[] = [];
const EMPTY_CONNECTED_ACCOUNTS: ConnectedAccount[] = [];
const PLACEHOLDER = "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=600&q=80";

async function fetchAccounts(): Promise<ConnectedAccount[]> {
  const { data, error } = await supabase
    .from("connected_accounts")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data ?? []).map((a: any) => ({
    id:          a.id,
    platform:    "fanvue" as const,
    name:        a.account_name ?? a.external_account_id ?? "Fanvue Account",
    handle:      a.external_account_id ?? "—",
    status:      a.connection_status === "connected" || a.access_token ? "connected" : "disconnected",
    accessToken: a.access_token ?? undefined,
  }));
}

async function fetchSchedules(): Promise<ScheduledItem[]> {
  const { data: rows, error } = await supabase.from("schedules").select("*").order("publish_time");
  if (error) throw error;

  const imageIds = (rows ?? []).filter((r: any) => r.content_type === "image").map((r: any) => r.content_id);
  const videoIds = (rows ?? []).filter((r: any) => r.content_type === "video").map((r: any) => r.content_id);

  const [imgRes, vidRes, charRes] = await Promise.all([
    imageIds.length ? supabase.from("images").select("id, image_url, prompt, character_id, connected_account_id, published_at, external_post_id, publish_status").in("id", imageIds) : Promise.resolve({ data: [] }),
    videoIds.length ? supabase.from("videos").select("id, video_url, prompt, scene_prompts, character_id, connected_account_id, published_at, external_post_id, publish_status").in("id", videoIds) : Promise.resolve({ data: [] }),
    supabase.from("characters").select("id, name, reference_image_url"),
  ]);

  const imgMap  = new Map((imgRes.data ?? []).map((i: any) => [i.id, i]));
  const vidMap  = new Map((vidRes.data ?? []).map((v: any) => [v.id, v]));
  const charMap = new Map((charRes.data ?? []).map((c: any) => [c.id, c]));

  return (rows ?? []).map((r: any): ScheduledItem => {
    const isVideo   = r.content_type === "video";
    const src: any  = isVideo ? vidMap.get(r.content_id) : imgMap.get(r.content_id);
    const char: any = src?.character_id ? charMap.get(src.character_id) : null;
    const scenes    = isVideo && Array.isArray(src?.scene_prompts) ? src.scene_prompts : src?.prompt ? [src.prompt] : [];
    const media     = isVideo ? src?.video_url : src?.image_url;
    const thumb     = char?.reference_image_url || media || PLACEHOLDER;

    const hasFakeId = src?.external_post_id && !isRealFanvueUUID(src?.external_post_id);
    const rawStatus = r.status ?? src?.publish_status ?? "scheduled";
    const status: PublishStatus =
      rawStatus === "published" && hasFakeId ? "scheduled" :
      rawStatus === "published" ? "published" :
      rawStatus === "failed" ? "failed" :
      rawStatus === "publishing" ? "publishing" : "scheduled";

    const queueStatus: QueueStatus =
      status === "published" ? "published" :
      status === "failed" ? "failed" :
      status === "publishing" ? "publishing" :
      new Date(r.publish_time) <= new Date() ? "ready" : "waiting";

    return {
      id: r.id,
      contentName: `${char?.name ?? "Lila"} — ${(scenes[0] ?? "Untitled").slice(0, 40)}`,
      type: r.content_type, character: char?.name ?? "Lila",
      thumbnail: thumb, mediaUrl: media || "", accountId: (r.connected_account_id ?? "").toString(),
      scheduledAt: r.publish_time, status, queueStatus, autoPublish: true,
      externalPostId: isRealFanvueUUID(src?.external_post_id) ? src.external_post_id : undefined,
      publishedAt:    src?.published_at ?? undefined,
      settings: { fps: 16, framesPerScene: 257, numScenes: scenes.length || 1, samplingSteps: 29 },
      scenePrompts: scenes, negativePrompt: "low quality, blurry, distorted face, watermark",
      history: [
        { at: r.created_at, label: `Scheduled for ${new Date(r.publish_time).toLocaleString()}`, kind: "scheduled" },
        ...(src?.published_at && isRealFanvueUUID(src?.external_post_id) ? [{ at: src.published_at, label: "Published", kind: "published" as const }] : []),
      ],
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Render Helpers
// ─────────────────────────────────────────────────────────────────────────────
const statusStyle: Record<PublishStatus, string> = {
  scheduled:  "bg-chart-2/15 text-chart-2 border-chart-2/30",
  publishing: "bg-primary/15 text-primary border-primary/30",
  published:  "bg-success/15 text-success border-success/30",
  failed:     "bg-destructive/15 text-destructive border-destructive/30",
};
const queueStatusStyle: Record<QueueStatus, string> = {
  waiting:    "bg-muted text-muted-foreground border-border",
  ready:      "bg-chart-2/15 text-chart-2 border-chart-2/30",
  publishing: "bg-primary/15 text-primary border-primary/30",
  published:  "bg-success/15 text-success border-success/30",
  failed:     "bg-destructive/15 text-destructive border-destructive/30",
};
const fmtTime     = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const fmtDate     = (iso: string) => new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
const fmtDateTime = (iso: string) => `${fmtDate(iso)} · ${fmtTime(iso)}`;
const isSameDay   = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

function StatusBadge({ status }: { status: PublishStatus }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider", statusStyle[status])}>
      {status === "publishing" && <Loader2 className="h-2.5 w-2.5 animate-spin" />} {status}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Accounts Settings Dialog Component
// ─────────────────────────────────────────────────────────────────────────────
function AccountsDialog({ open, onOpenChange, accounts, onRefresh }: {
  open: boolean; onOpenChange: (o: boolean) => void; accounts: ConnectedAccount[]; onRefresh: () => void;
}) {
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const disconnect = async (id: string) => {
    setDisconnecting(id);
    try {
      await supabase.from("connected_accounts").delete().eq("id", id);
      toast.success("Account link purged"); onRefresh();
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
    finally { setDisconnecting(null); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Fanvue Access Integration Profiles</DialogTitle>
          <DialogDescription>Link your creator profile instance directly into the schedule engine.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {accounts.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-muted/30 p-6 text-center">
              <Plug className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-2 text-sm font-medium">No system rows connected yet</p>
            </div>
          ) : accounts.map((a) => (
            <div key={a.id} className="flex items-center justify-between rounded-lg border border-border bg-card p-3">
              <div className="flex items-center gap-3">
                <div className="grid h-9 w-9 place-items-center rounded-full bg-primary/10 text-primary font-semibold text-sm">{a.name.slice(0,1).toUpperCase()}</div>
                <div>
                  <p className="text-sm font-medium">{a.name}</p>
                  <p className="text-xs text-muted-foreground">@{a.handle}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="gap-1 border-success/40 text-success text-xs"><CheckCircle className="h-3 w-3" /> Active</Badge>
                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive text-xs"
                  disabled={disconnecting === a.id} onClick={() => disconnect(a.id)}>
                  {disconnecting === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Disconnect"}
                </Button>
              </div>
            </div>
          ))}
          <div className="rounded-lg border border-border bg-muted/20 p-4">
            <Button className="w-full gap-2" onClick={() => { onOpenChange(false); startFanvueOAuth(); }}>
              <ExternalLink className="h-4 w-4" /> Trigger New Handshake Setup
            </Button>
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Core UI Page Layout Component
// ─────────────────────────────────────────────────────────────────────────────
export function SchedulePage() {
  const queryClient = useQueryClient();
  const { data: scheduleData = EMPTY_SCHEDULE_ITEMS, refetch: refetchSchedules } = useQuery({ queryKey: ["schedules"], queryFn: fetchSchedules, staleTime: 5000 });
  const { data: accounts = EMPTY_CONNECTED_ACCOUNTS, refetch: refetchAccounts } = useQuery({ queryKey: ["connected-accounts"], queryFn: fetchAccounts, staleTime: 5000 });

  const [items, setItems] = useState<ScheduledItem[]>([]);
  useEffect(() => setItems(scheduleData), [scheduleData]);

  const [debugLog,   setDebugLog]   = useState("");
  const [debugOpen,  setDebugOpen]  = useState(false);
  const [dbDiagOpen, setDbDiagOpen] = useState(false);

  useEffect(() => {
    const p    = new URLSearchParams(window.location.search);
    const code = p.get("code");
    if (!code) return;
    window.history.replaceState({}, "", window.location.pathname);
    toast.loading("Parsing connected token records across schema…", { id: "oauth" });
    exchangeFanvueCode(code)
      .then(() => {
        toast.success("Profile integrated successfully into database!", { id: "oauth" });
        refetchAccounts();
        refetchSchedules();
        queryClient.invalidateQueries({ queryKey: ["connected-accounts"] });
        queryClient.invalidateQueries({ queryKey: ["schedules"] });
      })
      .catch((e) => toast.error(e.message ?? "Authorization error", { id: "oauth" }));
  }, [refetchAccounts, refetchSchedules, queryClient]);

  const [tab,           setTab]           = useState("calendar");
  const [search,        setSearch]        = useState("");
  const [statusFilter,  setStatusFilter]  = useState<"all" | PublishStatus>("all");
  const [accountFilter, setAccountFilter] = useState<string>("all");
  const [rangeFilter,   setRangeFilter]   = useState<"all" | "today" | "week" | "month">("all");
  const [selected,      setSelected]      = useState<ScheduledItem | null>(null);
  const [createOpen,    setCreateOpen]    = useState(false);
  const [accountsOpen,  setAccountsOpen]  = useState(false);
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
      connectedAccounts: accounts.length,
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
        if (!i.contentName.toLowerCase().includes(q) && !i.character.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [items, statusFilter, accountFilter, rangeFilter, search]);

  const updateItem = (id: string, patch: Partial<ScheduledItem>) =>
    setItems((prev) => prev.map((i) => i.id === id ? { ...i, ...patch } : i));

  const removeItem = async (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    setSelected(null);
    try {
      await supabase.from("schedules").delete().eq("id", id);
      toast.success("Scheduled event deleted");
      queryClient.invalidateQueries({ queryKey: ["schedules"] });
    } catch (e: any) { toast.error(e?.message); }
  };

  const retryPublish = async (id: string) => {
    updateItem(id, { status: "scheduled", queueStatus: "ready" });
    try { await scheduleService.update(id, { status: "scheduled" }); } catch {}
  };

  const publishNow = async (id: string) => {
    const item = items.find((i) => i.id === id);
    if (!item) return;

    toast.loading("Querying credential table configurations…", { id: `pub-${id}` });
    const account = await fetchBestFanvueAccount();

    if (!account) {
      toast.error("No integrated rows detected with standard credentials inside table connected_accounts.", { id: `pub-${id}` });
      return;
    }

    updateItem(id, { status: "publishing", queueStatus: "publishing", accountId: account.id });
    const toastId = `pub-${id}`;
    toast.loading(`Deploying multipart upload matrix to Fanvue (@${account.handle})…`, { id: toastId });

    let runLog = `Starting deploy trace mapping setup:\nAccount matching unique profile: id=${account.id}\n`;
    try {
      const caption = item.scenePrompts[0] ?? item.contentName;
      const { postUuid, log } = await publishToFanvue({
        accessToken: account.accessToken,
        mediaUrl:    item.mediaUrl,
        mediaType:   item.type,
        caption,
        onProgress:  (msg) => toast.loading(msg, { id: toastId }),
      });
      runLog += log;

      const now = new Date().toISOString();
      const table = item.type === "image" ? "images" : "videos";
      
      const { data: sRow } = await supabase.from("schedules").select("content_id").eq("id", id).single();
      if (sRow?.content_id) {
        await supabase.from(table).update({
          publish_status: "published",
          published_at: now,
          external_post_id: postUuid,
          connected_account_id: account.id
        }).eq("id", sRow.content_id);
      }
      
      await supabase.from("schedules").update({ connected_account_id: account.id, status: "published" }).eq("id", id);
      await scheduleService.update(id, { status: "published" });

      updateItem(id, {
        status: "published", queueStatus: "published", accountId: account.id,
        externalPostId: postUuid, publishedAt: now,
        history: [...item.history, { at: now, label: `Posted via @${account.handle}`, kind: "published" }]
      });

      toast.success("Entity deployed successfully to your live profile feed!", { id: toastId, duration: 6000 });
      queryClient.invalidateQueries({ queryKey: ["schedules"] });

    } catch (e: any) {
      const errMsg = e?.message ?? "Handshake rejected during asset stream processing loop";
      runLog += `\n\n[CRITICAL FAILURE]: ${errMsg}`;
      updateItem(id, { status: "failed", queueStatus: "failed" });
      try { await scheduleService.update(id, { status: "failed" }); } catch {}
      setDebugLog(runLog);
      toast.error("Publish action rejected", {
        id: toastId, duration: 15000,
        description: errMsg.slice(0, 100),
        action: { label: "Trace Logs", onClick: () => setDebugOpen(true) }
      });
    }
  };

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
                  <ArrowLeft className="h-3.5 w-3.5" /> Home Dashboard
                </Link>
                <h1 className="font-display text-3xl font-semibold tracking-tight">Scheduling Control Room</h1>
                <p className="mt-1 text-sm text-muted-foreground">Manage direct image and video uploads into connected timelines.</p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="gap-2" onClick={() => setDbDiagOpen(true)}><Bug className="h-4 w-4" /> DB Debug Inspection</Button>
                <Button variant="outline" size="sm" className="gap-2" onClick={() => setAccountsOpen(true)}><Plug className="h-4 w-4" /> Connected Accounts ({stats.connectedAccounts})</Button>
                <Button size="sm" className="gap-2" onClick={() => setCreateOpen(true)}><CalendarPlus className="h-4 w-4" /> Schedule Content Row</Button>
              </div>
            </div>

            {stats.connectedAccounts === 0 && (
              <div className="flex items-center gap-3 rounded-lg border border-yellow-600/30 bg-yellow-500/5 px-4 py-3">
                <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                <p className="flex-1 text-sm text-muted-foreground">Target project connected_accounts schema is evaluating as empty. Trigger a profile sync mapping handshake below.</p>
                <Button size="sm" className="bg-amber-600 text-white" onClick={startFanvueOAuth}>Authorize Profile Connection</Button>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <DashboardCard label="Scheduled row items" value={stats.scheduled} icon={CalendarClock} accent="primary" />
              <DashboardCard label="Publishing targets today" value={stats.todayCount} icon={Clock} accent="chart-2" />
              <DashboardCard label="Completed this week" value={stats.weekPublished} icon={CheckCircle2} accent="chart-3" />
              <DashboardCard label="System failed items" value={stats.failed} icon={AlertTriangle} accent="chart-5" />
              <DashboardCard label="Connected schema entries" value={stats.connectedAccounts} icon={Link2} accent="chart-4" />
            </div>

            <Card className="border-border/60 bg-card">
              <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search records matching character profiles…" />
              </CardContent>
            </Card>

            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                <TabsTrigger value="calendar">Calendar Layout Grid</TabsTrigger>
                <TabsTrigger value="queue">Active Flow Queue</TabsTrigger>
                <TabsTrigger value="history">Historical Outputs Archive</TabsTrigger>
              </TabsList>
              <TabsContent value="calendar" className="mt-4">
                <CalendarView weekStart={weekStart} setWeekStart={setWeekStart} items={filteredItems} getAccount={getAccount} onOpen={setSelected} onSchedule={() => setCreateOpen(true)} />
              </TabsContent>
              <TabsContent value="queue" className="mt-4">
                <QueueView items={filteredItems.filter((i) => ["scheduled","publishing","failed"].includes(i.status))} getAccount={getAccount} onOpen={setSelected} onCancel={removeItem} onPublishNow={publishNow} onSchedule={() => setCreateOpen(true)} />
              </TabsContent>
              <TabsContent value="history" className="mt-4">
                <HistoryView items={filteredItems.filter((i) => ["published","failed"].includes(i.status))} getAccount={getAccount} onOpen={setSelected} />
              </TabsContent>
            </Tabs>
          </div>
        </main>
      </SidebarInset>

      <DetailSheet item={selected} onClose={() => setSelected(null)} getAccount={getAccount} onPublishNow={publishNow} />
      <CreateScheduleDialog open={createOpen} onOpenChange={setCreateOpen} />
      <AccountsDialog open={accountsOpen} onOpenChange={setAccountsOpen} accounts={accounts} onRefresh={() => { refetchAccounts(); }} />
      <DebugLogDialog open={debugOpen} onClose={() => setDebugOpen(false)} log={debugLog} />
      <DBDiagDialog open={dbDiagOpen} onClose={() => setDbDiagOpen(false)} />
    </SidebarProvider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Calendar sub-components
// ─────────────────────────────────────────────────────────────────────────────
function CalendarView({ weekStart, setWeekStart, items, onOpen, onSchedule }: any) {
  const days = Array.from({ length: 7 }).map((_, idx) => { const d = new Date(weekStart); d.setDate(d.getDate() + idx); return d; });
  if (items.length === 0) return <EmptyState onSchedule={onSchedule} />;
  return (
    <div className="grid grid-cols-7 gap-2">
      {days.map((day) => {
        const dayItems = items.filter((i: any) => isSameDay(new Date(i.scheduledAt), day));
        return (
          <div key={day.toISOString()} className="border p-2 bg-muted/10 rounded min-h-[200px]">
            <p className="text-xs font-bold">{day.getDate()} {day.toLocaleDateString([], { weekday: "short" })}</p>
            {dayItems.map((i: any) => (
              <button key={i.id} onClick={() => onOpen(i)} className="text-left text-xs p-1 mt-1 border rounded w-full bg-card block truncate">
                {i.character} · {fmtTime(i.scheduledAt)}
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Queue sub-components
// ─────────────────────────────────────────────────────────────────────────────
function QueueView({ items, onPublishNow, onCancel }: any) {
  if (items.length === 0) return <div className="text-center p-8 text-xs text-muted-foreground">Queue schema matches zero remaining records.</div>;
  return (
    <div className="space-y-2">
      {items.map((i: any) => (
        <Card key={i.id} className="p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">{i.contentName}</p>
              <p className="text-xs text-muted-foreground">{fmtDateTime(i.scheduledAt)}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => onPublishNow(i.id)}>Publish now</Button>
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => onCancel(i.id)}>Cancel</Button>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// History sub-components
// ─────────────────────────────────────────────────────────────────────────────
function HistoryView({ items }: any) {
  if (items.length === 0) return <div className="text-center p-8 text-xs text-muted-foreground">No processing execution actions have finalized outputs yet.</div>;
  return (
    <div className="space-y-2">
      {items.map((i: any) => (
        <Card key={i.id} className="p-3 bg-muted/5">
          <div className="flex justify-between items-center">
            <div>
              <p className="text-xs font-bold">{i.contentName}</p>
              <p className="text-[11px] font-mono text-muted-foreground">Post ID: {i.externalPostId ?? "—"}</p>
            </div>
            <StatusBadge status={i.status} />
          </div>
        </Card>
      ))}
    </div>
  );
}

function EmptyState({ onSchedule }: any) {
  return (
    <div className="text-center p-12 border border-dashed rounded-lg bg-card">
      <p className="text-sm text-muted-foreground">No events populated inside calendar scope.</p>
      <Button size="sm" className="mt-3" onClick={onSchedule}>Schedule asset</Button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Detailed slide sheet layout
// ─────────────────────────────────────────────────────────────────────────────
function DetailSheet({ item, onClose, onPublishNow }: any) {
  return (
    <Sheet open={!!item} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="sm:max-w-md overflow-y-auto">
        {item && (
          <div className="space-y-4">
            <h3 className="text-lg font-bold">{item.contentName}</h3>
            <StatusBadge status={item.status} />
            <div className="aspect-video bg-muted rounded overflow-hidden">
              <img src={item.thumbnail} alt="preview" className="object-cover w-full h-full" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">System schedule timestamp</Label>
              <p className="text-sm font-medium">{fmtDateTime(item.scheduledAt)}</p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Presigned asset url location</Label>
              <p className="text-sm font-medium break-all">{item.mediaUrl || "No asset source file present"}</p>
            </div>
            {item.externalPostId && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Fanvue API post reference uuid</Label>
                <p className="text-sm font-mono bg-muted p-1.5 rounded">{item.externalPostId}</p>
              </div>
            )}
            <Button className="w-full" onClick={() => onPublishNow(item.id)}>Force execution sync now</Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// New schedule entry creation dialog
// ─────────────────────────────────────────────────────────────────────────────
function CreateScheduleDialog({ open, onOpenChange }: any) {
  const queryClient = useQueryClient();
  const [assets, setAssets] = useState<ApprovedAsset[]>([]);
  const [idx, setIdx]       = useState("0");
  const [date, setDate]     = useState(() => new Date().toISOString().slice(0,10));
  const [time, setTime]     = useState("12:00");

  useEffect(() => {
    if (!open) return;
    fetchApprovedAssets().then(setAssets);
  }, [open]);

  const saveRow = async () => {
    const asset = assets[Number(idx)];
    if (!asset) return;
    const account = await fetchBestFanvueAccount();
    const isoStr = new Date(`${date}T${time}:00`).toISOString();
    
    const { data: u } = await supabase.auth.getUser();
    await supabase.from("schedules").insert({
      content_type: asset.type,
      content_id: asset.id,
      publish_time: isoStr,
      platform: "Fanvue",
      status: "scheduled",
      connected_account_id: account?.id ?? null,
      created_by: u.user?.id ?? null
    });

    toast.success("Scheduled");
    queryClient.invalidateQueries({ queryKey: ["schedules"] });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Queue generation row</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Select approved source</Label>
            <Select value={idx} onValueChange={setIdx}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{assets.map((a, i) => <SelectItem key={a.id} value={String(i)}>{a.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
          <Button className="w-full" onClick={saveRow} disabled={assets.length === 0}>Commit to database</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

async function fetchApprovedAssets(): Promise<ApprovedAsset[]> {
  const [imgRes, vidRes] = await Promise.all([
    supabase.from("images").select("id, prompt").limit(10),
    supabase.from("videos").select("id, prompt").limit(10),
  ]);
  return [
    ...(imgRes.data ?? []).map((i: any) => ({ id: i.id, type: "image" as const, name: `Image: ${i.prompt?.slice(0,30)}` })),
    ...(vidRes.data ?? []).map((v: any) => ({ id: v.id, type: "video" as const, name: `Video: ${v.prompt?.slice(0,30)}` })),
  ];
}
