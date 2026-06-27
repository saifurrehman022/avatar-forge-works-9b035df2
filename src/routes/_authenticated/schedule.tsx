import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { scheduleService } from "@/services";
import {
  CalendarClock,
  CalendarPlus,
  CheckCircle2,
  Clock,
  Search,
  Image as ImageIcon,
  Video as VideoIcon,
  Play,
  ArrowLeft,
  Send,
  Filter,
  Inbox,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  Pause,
  Edit3,
  Trash2,
  Eye,
  RefreshCw,
  Link2,
  AlertTriangle,
  Loader2,
  Plug,
  CheckCircle,
  XCircle,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";

import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { AppHeader } from "@/components/dashboard/app-header";
import { DashboardCard } from "@/components/dashboard/dashboard-card";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Fanvue OAuth config
// ---------------------------------------------------------------------------
const FANVUE_CLIENT_ID     = "f9d35fff-3d12-4dd5-8945-750c37d65ae9";
const FANVUE_CLIENT_SECRET = "05275891c81581c5cb79d336c8e9f87680f0976843bf17d6737bdcf0dde38b1a";
const FANVUE_REDIRECT_URI  = "https://avatar-forge-works-9b035df2-j56ivc6di-saifurrehman022s-projects.vercel.app/schedule";
const FANVUE_AUTH_URL      = "https://auth.fanvue.com/oauth2/auth";
const FANVUE_TOKEN_URL     = "https://auth.fanvue.com/oauth2/token";
const FANVUE_API_BASE      = "https://api.fanvue.com";
const FANVUE_API_VERSION   = "2025-06-26";

const fanvueHeaders = (accessToken: string, extra?: Record<string, string>) => ({
  Authorization: `Bearer ${accessToken}`,
  "X-Fanvue-API-Version": FANVUE_API_VERSION,
  ...extra,
});

// ---------------------------------------------------------------------------
// Fanvue OAuth helpers
// ---------------------------------------------------------------------------

// PKCE helpers — Fanvue requires PKCE on all OAuth flows
function b64url(buf: ArrayBuffer): string {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
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
  // Store across redirect (sessionStorage survives same-tab redirects)
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

async function exchangeFanvueCode(code: string): Promise<void> {
  const verifier = sessionStorage.getItem(PKCE_KEY);
  if (!verifier) throw new Error("PKCE verifier missing — please click Connect again");
  sessionStorage.removeItem(PKCE_KEY);
  sessionStorage.removeItem(STATE_KEY);

  const body = new URLSearchParams({
    grant_type:    "authorization_code",
    code,
    redirect_uri:  FANVUE_REDIRECT_URI,
    client_id:     FANVUE_CLIENT_ID,
    client_secret: FANVUE_CLIENT_SECRET,
    code_verifier: verifier,   // ← required by Fanvue PKCE
  });

  const res = await fetch(FANVUE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Fanvue token exchange failed: ${err}`);
  }

  const tokens       = await res.json();
  const accessToken  = tokens.access_token  as string;
  const refreshToken = tokens.refresh_token as string | undefined;
  const expiresIn    = tokens.expires_in    as number | undefined;

  // Fetch profile — correct endpoint is GET /me (no /v1/ prefix)
  const profileRes = await fetch(`${FANVUE_API_BASE}/me`, {
    headers: fanvueHeaders(accessToken),
  });
  const profile = profileRes.ok ? await profileRes.json() : {};
  console.info("[exchangeFanvueCode] /me response:", JSON.stringify(profile));

  // Use uuid as the stable external_account_id so upsert works correctly
  const externalId = profile.uuid ?? profile.id ?? profile.username ?? `fv-${Date.now()}`;
  const name       = profile.displayName ?? profile.name ?? profile.username ?? profile.handle ?? "Fanvue Account";
  const handle     = profile.username ?? profile.handle ?? externalId;

  const { data: userRes } = await supabase.auth.getUser();

  // Try upsert first; if external_account_id already exists for a DIFFERENT
  // uuid just update the token on the existing row instead of failing.
  const { error: upsertErr } = await supabase.from("connected_accounts").upsert(
    {
      account_name:        name,
      external_account_id: externalId,
      platform:            "fanvue",
      connection_status:   "connected",
      access_token:        accessToken,
      refresh_token:       refreshToken ?? null,
      token_expires_at:    expiresIn
        ? new Date(Date.now() + expiresIn * 1000).toISOString()
        : null,
      created_by: userRes.user?.id ?? null,
    },
    { onConflict: "external_account_id" }
  );

  if (upsertErr) {
    console.warn("[exchangeFanvueCode] upsert failed, trying insert:", upsertErr.message);
    // If conflict on external_account_id, just update the token on the existing row
    const { error: updateErr } = await supabase
      .from("connected_accounts")
      .update({
        account_name:      name,
        connection_status: "connected",
        access_token:      accessToken,
        refresh_token:     refreshToken ?? null,
        token_expires_at:  expiresIn
          ? new Date(Date.now() + expiresIn * 1000).toISOString()
          : null,
      })
      .eq("platform", "fanvue");
    if (updateErr) throw new Error(`Failed to save account: ${updateErr.message}`);
  }

  console.info(`[exchangeFanvueCode] saved account: ${name} (@${handle})`);
}

// ---------------------------------------------------------------------------
// Fanvue publish flow — FIXED
//
// The core problem with the old code:
//   fetch(cloudFrontUrl) fails in the browser due to CORS.
//   The blob was empty/broken, so Fanvue received 0 bytes → no media on the post.
//
// Fix: route the image download through /api/proxy-image (your Vercel function).
// That function runs server-side where CORS does not apply.
//
// Also added: poll GET /media/{uuid} until status === "ready" before creating
// the post. Without this, Fanvue creates a post with missing/broken media.
// ---------------------------------------------------------------------------

/**
 * Download media binary.
 * Tries direct fetch first — works for Supabase public storage URLs because
 * Supabase sets permissive CORS headers on public buckets.
 * Falls back to /api/proxy-image if direct fetch fails or returns empty.
 */
async function fetchMediaBlob(mediaUrl: string): Promise<Blob> {
  // 1. Try direct fetch — works for Supabase public bucket URLs
  try {
    const res = await fetch(mediaUrl);
    if (res.ok) {
      const blob = await res.blob();
      if (blob.size > 0) {
        console.info(`[fetchMediaBlob] direct OK: ${blob.size} bytes`);
        return blob;
      }
    }
    console.warn(`[fetchMediaBlob] direct fetch ${res.status} or empty`);
  } catch (e) {
    console.warn("[fetchMediaBlob] direct fetch error:", e);
  }

  // 2. Fall back to server-side proxy (create api/proxy-image.ts in Vercel if needed)
  const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(mediaUrl)}`;
  try {
    const res = await fetch(proxyUrl);
    if (res.ok) {
      const blob = await res.blob();
      if (blob.size > 0) {
        console.info(`[fetchMediaBlob] proxy OK: ${blob.size} bytes`);
        return blob;
      }
    }
  } catch (e) {
    console.warn("[fetchMediaBlob] proxy error:", e);
  }

  throw new Error(
    `Cannot download media from: ${mediaUrl}\n` +
    `• If this is a Supabase URL, make sure the bucket is PUBLIC (Dashboard → Storage → Policies).\n` +
    `• If the URL is from another domain, create api/proxy-image.ts in your Vercel project root.`
  );
}

/** Step 1 — POST /media/uploads → { mediaUuid, uploadId } */
async function createUploadSession(
  accessToken: string,
  filename: string,
  mediaType: "image" | "video"
): Promise<{ mediaUuid: string; uploadId: string }> {
  const res = await fetch(`${FANVUE_API_BASE}/media/uploads`, {
    method: "POST",
    headers: fanvueHeaders(accessToken, { "Content-Type": "application/json" }),
    body: JSON.stringify({ name: filename, filename, mediaType }),
  });
  if (!res.ok) {
    throw new Error(`Create upload session failed (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  if (!data.mediaUuid || !data.uploadId) {
    throw new Error(`Unexpected session response: ${JSON.stringify(data)}`);
  }
  return { mediaUuid: data.mediaUuid, uploadId: data.uploadId };
}

/** Step 2a — GET presigned S3 URL for a specific part number (returns plain text) */
async function getPartUrl(
  accessToken: string,
  uploadId: string,
  partNumber: number
): Promise<string> {
  const res = await fetch(
    `${FANVUE_API_BASE}/media/uploads/${uploadId}/parts/${partNumber}/url`,
    { headers: fanvueHeaders(accessToken) }
  );
  if (!res.ok) {
    throw new Error(`Get part URL failed (${res.status}): ${await res.text()}`);
  }
  // Response is text/plain — a raw presigned S3 URL
  return res.text();
}

/** Step 2b — PUT blob directly to S3 presigned URL, returns ETag */
async function uploadToS3(presignedUrl: string, blob: Blob): Promise<string> {
  const res = await fetch(presignedUrl, {
    method: "PUT",
    body: blob,
    // No Authorization header — S3 presigned URLs are self-authenticating
  });
  if (!res.ok) {
    throw new Error(`S3 upload failed (${res.status}): ${await res.text()}`);
  }
  const etag = res.headers.get("ETag");
  if (!etag) throw new Error("S3 did not return an ETag for the uploaded part");
  return etag;
}

/** Step 3 — PATCH /media/uploads/{uploadId} to complete the multipart session */
async function completeUpload(
  accessToken: string,
  uploadId: string,
  parts: Array<{ PartNumber: number; ETag: string }>
): Promise<void> {
  const res = await fetch(`${FANVUE_API_BASE}/media/uploads/${uploadId}`, {
    method: "PATCH",
    headers: fanvueHeaders(accessToken, { "Content-Type": "application/json" }),
    body: JSON.stringify({ parts }),
  });
  if (!res.ok) {
    throw new Error(`Complete upload failed (${res.status}): ${await res.text()}`);
  }
}

/**
 * Step 4 — Poll GET /media/{mediaUuid} until media is processed and ready.
 *
 * CRITICAL: Fanvue processes uploads asynchronously. If you call POST /posts
 * while the media is still "processing", the post is created with no image.
 *
 * Fanvue status values observed: "created", "processing", "ready", "FINALISED"
 * We accept any of these as "done" to be safe.
 */
async function waitForMediaReady(
  accessToken: string,
  mediaUuid: string
): Promise<void> {
  const MAX_WAIT_MS    = 120_000; // 2 minutes max (videos take longer)
  const POLL_INTERVAL  = 4_000;
  const start = Date.now();
  const READY_STATUSES = new Set(["ready", "finalised", "finalized", "READY", "FINALISED", "FINALIZED"]);

  console.info(`[waitForMediaReady] polling /media/${mediaUuid}…`);

  while (Date.now() - start < MAX_WAIT_MS) {
    try {
      const res = await fetch(`${FANVUE_API_BASE}/media/${mediaUuid}`, {
        headers: fanvueHeaders(accessToken),
      });

      if (res.ok) {
        const data = await res.json();
        const status = data.status ?? "";
        console.info(`[waitForMediaReady] status: ${status}`);

        if (READY_STATUSES.has(status)) return; // ✅ safe to create post
        if (status === "error" || status === "ERROR") {
          throw new Error("Fanvue media processing failed — check the file is JPEG/PNG (image) or MP4 (video).");
        }
        // "created" or "processing" — keep polling
      } else {
        console.warn(`[waitForMediaReady] poll returned ${res.status}, retrying…`);
      }
    } catch (e) {
      // Re-throw only if it's our explicit error, not a transient network error
      if (e instanceof Error && e.message.includes("processing failed")) throw e;
      console.warn("[waitForMediaReady] transient error, retrying:", e);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }

  throw new Error(
    "Timed out waiting for Fanvue media to be ready (120s). " +
    "The file may be too large, unsupported format, or Fanvue is slow. " +
    "Check your Fanvue media vault to see if the upload arrived."
  );
}

/** Step 5 — POST /posts with the ready mediaUuid → returns post UUID */
async function createFanvuePost(
  accessToken: string,
  mediaUuid: string,
  caption: string,
  audience: "subscribers" | "followers-and-subscribers"
): Promise<string> {
  const res = await fetch(`${FANVUE_API_BASE}/posts`, {
    method: "POST",
    headers: fanvueHeaders(accessToken, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      text: caption,
      mediaUuids: [mediaUuid],
      audience,
    }),
  });
  if (!res.ok) {
    throw new Error(`Create post failed (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  return data.uuid ?? `fv_${Date.now()}`;
}

/**
 * Full publish pipeline:
 *  1. Download binary via proxy (bypasses CORS)
 *  2. Create Fanvue multipart upload session
 *  3. Get presigned S3 URL, upload blob, collect ETag
 *  4. Complete upload session
 *  5. Poll until media is "ready"  ← fixes missing-image bug
 *  6. Create post with mediaUuid
 *
 * Returns the Fanvue post UUID.
 */
async function publishToFanvue(params: {
  accessToken: string;
  mediaUrl: string;
  mediaType: "image" | "video";
  caption: string;
  audience?: "subscribers" | "followers-and-subscribers";
  onProgress?: (step: string) => void;
}): Promise<string> {
  const {
    accessToken,
    mediaUrl,
    mediaType,
    caption,
    audience = "subscribers",
    onProgress,
  } = params;

  const report = (msg: string) => {
    console.info("[publishToFanvue]", msg);
    onProgress?.(msg);
  };

  // ── 1. Download the media blob ────────────────────────────────────────────
  report("Downloading media…");
  const blob = await fetchMediaBlob(mediaUrl);

  const ext      = mediaType === "video" ? "mp4" : "jpeg";
  const filename = `upload-${Date.now()}.${ext}`;

  // ── 2. Create upload session ──────────────────────────────────────────────
  report("Creating Fanvue upload session…");
  const { mediaUuid, uploadId } = await createUploadSession(
    accessToken,
    filename,
    mediaType
  );

  // ── 3. Upload to S3 ───────────────────────────────────────────────────────
  report("Uploading to Fanvue storage…");
  const presignedUrl = await getPartUrl(accessToken, uploadId, 1);
  const etag = await uploadToS3(presignedUrl, blob);

  // ── 4. Complete upload session ────────────────────────────────────────────
  report("Finalising upload…");
  await completeUpload(accessToken, uploadId, [{ PartNumber: 1, ETag: etag }]);

  // ── 5. Wait until Fanvue finishes processing ──────────────────────────────
  report("Processing media (this may take up to 60s)…");
  await waitForMediaReady(accessToken, mediaUuid);

  // ── 6. Create the post ────────────────────────────────────────────────────
  report("Publishing post…");
  const postUuid = await createFanvuePost(accessToken, mediaUuid, caption, audience);

  report(`Done! Post UUID: ${postUuid}`);
  return postUuid;
}

// ---------------------------------------------------------------------------
// Route error boundary
// ---------------------------------------------------------------------------

function RouteErrorBoundary({ error, reset }: { error: Error; reset: () => void }) {
  console.error("[schedule route error]", error);
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
      { name: "description", content: "Schedule, queue and publish approved content to connected Fanvue accounts." },
    ],
  }),
  component: SchedulePage,
  errorComponent: RouteErrorBoundary,
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PublishStatus = "scheduled" | "publishing" | "published" | "failed";
type QueueStatus   = "waiting" | "ready" | "publishing" | "published" | "failed";
type ContentType   = "image" | "video";

type ConnectedAccount = {
  id: string;
  platform: "fanvue";
  name: string;
  handle: string;
  status: "connected" | "disconnected" | "error";
  accessToken?: string;
};

type HistoryEvent = {
  at: string;
  label: string;
  kind: "approved" | "scheduled" | "queued" | "publishing" | "published" | "failed" | "retried";
  by?: string;
};

type ScheduledItem = {
  id: string;
  contentName: string;
  type: ContentType;
  character: string;
  thumbnail: string;
  mediaUrl: string;
  referenceImage?: string;
  accountId: string;
  scheduledAt: string;
  status: PublishStatus;
  queueStatus: QueueStatus;
  autoPublish: boolean;
  notes?: string;
  externalPostId?: string;
  publishedAt?: string;
  reviewStatus: "approved";
  settings: { fps: number; framesPerScene: number; numScenes: number; samplingSteps: number };
  scenePrompts: string[];
  negativePrompt: string;
  history: HistoryEvent[];
};

const EMPTY_SCHEDULE_ITEMS: ScheduledItem[]    = [];
const EMPTY_CONNECTED_ACCOUNTS: ConnectedAccount[] = [];

const PLACEHOLDER =
  "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=600&q=80";

// ---------------------------------------------------------------------------
// Data fetchers
// ---------------------------------------------------------------------------

async function fetchAccounts(): Promise<ConnectedAccount[]> {
  const { data, error } = await supabase
    .from("connected_accounts")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((a: any) => ({
    id: a.id,
    platform: "fanvue",
    name: a.account_name,
    handle: a.external_account_id ?? "—",
    status:
      a.connection_status === "connected"
        ? "connected"
        : a.connection_status === "error"
          ? "error"
          : "disconnected",
    accessToken: a.access_token ?? undefined,
  }));
}

async function fetchSchedules(): Promise<ScheduledItem[]> {
  const { data: rows, error } = await supabase
    .from("schedules")
    .select("*")
    .order("publish_time", { ascending: true });
  if (error) throw error;

  const imageIds = (rows ?? [])
    .filter((r: any) => r.content_type === "image")
    .map((r: any) => r.content_id);
  const videoIds = (rows ?? [])
    .filter((r: any) => r.content_type === "video")
    .map((r: any) => r.content_id);

  const [imgRes, vidRes, charRes] = await Promise.all([
    imageIds.length
      ? supabase
          .from("images")
          .select("id, image_url, prompt, character_id, connected_account_id, published_at, external_post_id, publish_status")
          .in("id", imageIds)
      : Promise.resolve({ data: [] } as any),
    videoIds.length
      ? supabase
          .from("videos")
          .select("id, video_url, prompt, scene_prompts, character_id, connected_account_id, published_at, external_post_id, publish_status")
          .in("id", videoIds)
      : Promise.resolve({ data: [] } as any),
    supabase.from("characters").select("id, name, reference_image_url"),
  ]);

  const imgMap  = new Map((imgRes.data ?? []).map((i: any) => [i.id, i]));
  const vidMap  = new Map((vidRes.data ?? []).map((v: any) => [v.id, v]));
  const charMap = new Map((charRes.data ?? []).map((c: any) => [c.id, c]));

  return (rows ?? []).map((r: any): ScheduledItem => {
    const isVideo = r.content_type === "video";
    const src: any = isVideo ? vidMap.get(r.content_id) : imgMap.get(r.content_id);
    const char: any = src?.character_id ? charMap.get(src.character_id) : null;
    const scenes: string[] =
      isVideo && Array.isArray(src?.scene_prompts)
        ? src.scene_prompts
        : src?.prompt
          ? [src.prompt]
          : [];
    const media = isVideo ? src?.video_url : src?.image_url;
    const thumb = char?.reference_image_url || media || PLACEHOLDER;

    const status: PublishStatus =
      r.status === "published"
        ? "published"
        : r.status === "failed"
          ? "failed"
          : r.status === "publishing" || src?.publish_status === "publishing"
            ? "publishing"
            : "scheduled";

    const queueStatus: QueueStatus =
      status === "published"
        ? "published"
        : status === "failed"
          ? "failed"
          : status === "publishing"
            ? "publishing"
            : new Date(r.publish_time) <= new Date()
              ? "ready"
              : "waiting";

    return {
      id: r.id,
      contentName: `${char?.name ?? "Lila"} — ${(scenes[0] ?? "Untitled").slice(0, 40)}`,
      type: r.content_type,
      character: char?.name ?? "Lila",
      thumbnail: thumb,
      mediaUrl: media || "",
      referenceImage: char?.reference_image_url ?? undefined,
      // accountId comes from the image/video row's connected_account_id
      accountId: src?.connected_account_id ?? r.connected_account_id ?? "",
      scheduledAt: r.publish_time,
      status,
      queueStatus,
      autoPublish: true,
      reviewStatus: "approved",
      externalPostId: src?.external_post_id ?? undefined,
      publishedAt: src?.published_at ?? undefined,
      settings: {
        fps: 16,
        framesPerScene: 257,
        numScenes: scenes.length || 1,
        samplingSteps: 29,
      },
      scenePrompts: scenes,
      negativePrompt: "low quality, blurry, distorted face, watermark",
      history: [
        {
          at: r.created_at,
          label: `Scheduled for ${new Date(r.publish_time).toLocaleString()}`,
          kind: "scheduled",
        },
        ...(src?.published_at
          ? [{ at: src.published_at, label: "Published", kind: "published" as const }]
          : []),
      ],
    };
  });
}

// ---------------------------------------------------------------------------
// Style & format helpers
// ---------------------------------------------------------------------------

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

const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth()    === b.getMonth()    &&
  a.getDate()     === b.getDate();

function StatusBadge({ status }: { status: PublishStatus }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider", statusStyle[status])}>
      {status === "publishing" && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
      {status}
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

// ---------------------------------------------------------------------------
// Accounts dialog
// ---------------------------------------------------------------------------

function AccountsDialog({
  open,
  onOpenChange,
  accounts,
  onRefresh,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  accounts: ConnectedAccount[];
  onRefresh: () => void;
}) {
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  const disconnect = async (id: string) => {
    setDisconnecting(id);
    try {
      const { error } = await supabase
        .from("connected_accounts")
        .update({ connection_status: "disconnected", access_token: null, refresh_token: null })
        .eq("id", id);
      if (error) throw error;
      toast.success("Account disconnected");
      onRefresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to disconnect");
    } finally {
      setDisconnecting(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Fanvue Accounts</DialogTitle>
          <DialogDescription>Connect your Fanvue account to publish content directly.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {accounts.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-muted/30 p-6 text-center">
              <Plug className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-2 text-sm font-medium">No accounts connected</p>
              <p className="mt-1 text-xs text-muted-foreground">Connect your Fanvue account to start publishing.</p>
            </div>
          ) : (
            accounts.map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded-lg border border-border bg-card p-3">
                <div className="flex items-center gap-3">
                  <div className="grid h-9 w-9 place-items-center rounded-full bg-primary/10 text-primary font-semibold text-sm">
                    {a.name.slice(0, 1).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{a.name}</p>
                    <p className="text-xs text-muted-foreground">@{a.handle}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {a.status === "connected" ? (
                    <Badge variant="outline" className="gap-1 border-success/40 text-success text-xs">
                      <CheckCircle className="h-3 w-3" /> Connected
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="gap-1 border-destructive/40 text-destructive text-xs">
                      <XCircle className="h-3 w-3" /> Offline
                    </Badge>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive text-xs"
                    disabled={disconnecting === a.id}
                    onClick={() => disconnect(a.id)}
                  >
                    {disconnecting === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Disconnect"}
                  </Button>
                </div>
              </div>
            ))
          )}

          <div className="rounded-lg border border-border bg-muted/20 p-4">
            <p className="text-xs font-medium text-foreground mb-1">Connect a new account</p>
            <p className="text-xs text-muted-foreground mb-3">
              You'll be redirected to Fanvue to authorise access. After approving, you'll return here automatically.
            </p>
            <Button className="w-full gap-2" onClick={() => { onOpenChange(false); startFanvueOAuth(); }}>
              <ExternalLink className="h-4 w-4" /> Connect Fanvue Account
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

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

function SchedulePage() {
  const queryClient = useQueryClient();
  const { data: scheduleData = EMPTY_SCHEDULE_ITEMS } = useQuery({
    queryKey: ["schedules"],
    queryFn: fetchSchedules,
    staleTime: 10_000,
  });
  const { data: accounts = EMPTY_CONNECTED_ACCOUNTS, refetch: refetchAccounts } = useQuery({
    queryKey: ["connected-accounts"],
    queryFn: fetchAccounts,
    staleTime: 60_000,
  });

  const [items, setItems] = useState<ScheduledItem[]>([]);
  useEffect(() => setItems(scheduleData), [scheduleData]);

  // Handle Fanvue OAuth redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (!code) return;

    window.history.replaceState({}, "", window.location.pathname);

    toast.loading("Connecting Fanvue account…", { id: "fanvue-connect" });
    exchangeFanvueCode(code)
      .then(() => {
        toast.success("Fanvue account connected!", { id: "fanvue-connect" });
        refetchAccounts();
        queryClient.invalidateQueries({ queryKey: ["connected-accounts"] });
      })
      .catch((err) => {
        toast.error(err.message ?? "Failed to connect account", { id: "fanvue-connect" });
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Real-time schedule updates
  useEffect(() => {
    const ch = supabase
      .channel("schedules-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "schedules" }, () =>
        queryClient.invalidateQueries({ queryKey: ["schedules"] })
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [queryClient]);

  const characters = useMemo(() => Array.from(new Set(items.map((i) => i.character))), [items]);

  const [tab, setTab]                     = useState("calendar");
  const [search, setSearch]               = useState("");
  const [statusFilter, setStatusFilter]   = useState<"all" | PublishStatus>("all");
  const [accountFilter, setAccountFilter] = useState<string>("all");
  const [characterFilter, setCharacterFilter] = useState<string>("all");
  const [rangeFilter, setRangeFilter]     = useState<"all" | "today" | "week" | "month">("all");
  const [selected, setSelected]           = useState<ScheduledItem | null>(null);
  const [createOpen, setCreateOpen]       = useState(false);
  const [accountsOpen, setAccountsOpen]   = useState(false);

  const [weekStart, setWeekStart] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - d.getDay());
    return d;
  });

  const getAccount = (id: string) => accounts.find((a) => a.id === id);

  const stats = useMemo(() => {
    const now     = new Date();
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);
    return {
      scheduled:        items.filter((i) => i.status === "scheduled").length,
      todayCount:       items.filter((i) => i.status === "scheduled" && isSameDay(new Date(i.scheduledAt), now)).length,
      weekPublished:    items.filter((i) => i.status === "published" && i.publishedAt && new Date(i.publishedAt) >= weekAgo).length,
      failed:           items.filter((i) => i.status === "failed").length,
      connectedAccounts: accounts.filter((a) => a.status === "connected").length,
    };
  }, [items, accounts]);

  const filteredItems = useMemo(() => {
    const now = new Date();
    return items.filter((i) => {
      if (statusFilter !== "all" && i.status !== statusFilter) return false;
      if (accountFilter !== "all" && i.accountId !== accountFilter) return false;
      if (characterFilter !== "all" && i.character !== characterFilter) return false;
      if (rangeFilter !== "all") {
        const d = new Date(i.scheduledAt);
        if (rangeFilter === "today" && !isSameDay(d, now)) return false;
        if (rangeFilter === "week") {
          const wkAhead = new Date(now);
          wkAhead.setDate(wkAhead.getDate() + 7);
          if (d < now || d > wkAhead) return false;
        }
        if (rangeFilter === "month") {
          if (d.getMonth() !== now.getMonth() || d.getFullYear() !== now.getFullYear()) return false;
        }
      }
      if (search.trim()) {
        const q   = search.toLowerCase();
        const acc = getAccount(i.accountId);
        const hay = [i.contentName, i.character, acc?.name, acc?.handle, i.externalPostId]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, statusFilter, accountFilter, characterFilter, rangeFilter, search]);

  const updateItem = (id: string, patch: Partial<ScheduledItem>) =>
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  const removeItem = async (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    setSelected(null);
    try {
      const { error } = await supabase.from("schedules").delete().eq("id", id);
      if (error) throw error;
      toast.success("Schedule removed");
      queryClient.invalidateQueries({ queryKey: ["schedules"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to remove");
    }
  };

  const retryPublish = async (id: string) => {
    updateItem(id, {
      status: "scheduled",
      queueStatus: "ready",
      history: [
        ...(items.find((i) => i.id === id)?.history ?? []),
        { at: new Date().toISOString(), label: "Retry queued", kind: "retried" },
      ],
    });
    try {
      await scheduleService.update(id, { status: "scheduled" });
      toast.success("Queued for retry");
      queryClient.invalidateQueries({ queryKey: ["schedules"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to retry");
    }
  };

  const publishNow = async (id: string) => {
    const item = items.find((i) => i.id === id);
    if (!item) return;

    // Resolve account: try by accountId first, then fall back to ANY connected account with a token
    let account = accounts.find((a) => a.id === item.accountId && a.accessToken);
    if (!account) {
      account = accounts.find((a) => a.status === "connected" && a.accessToken);
    }
    if (!account) {
      // Last resort: query DB directly in case UI cache is stale
      const { data: dbAccounts } = await supabase
        .from("connected_accounts")
        .select("id, account_name, external_account_id, access_token, connection_status")
        .eq("platform", "fanvue")
        .not("access_token", "is", null)
        .order("updated_at", { ascending: false })
        .limit(1);
      const best = dbAccounts?.[0];
      if (best?.access_token) {
        account = {
          id: best.id,
          platform: "fanvue",
          name: best.account_name ?? "Fanvue",
          handle: best.external_account_id ?? "—",
          status: "connected",
          accessToken: best.access_token,
        };
      }
    }

    if (!account?.accessToken) {
      toast.error("No connected Fanvue account found.", {
        description: "Click 'Accounts' to connect your Fanvue creator account first.",
        action: { label: "Connect", onClick: () => setAccountsOpen(true) },
        duration: 10_000,
      });
      return;
    }

    if (!item.mediaUrl) {
      toast.error("No media URL for this item — the asset may still be processing or was not saved correctly.");
      return;
    }

    updateItem(id, { status: "publishing", queueStatus: "publishing" });

    const toastId = `publish-${id}`;
    toast.loading("Starting publish…", { id: toastId });

    try {
      const caption = item.scenePrompts[0] ?? item.contentName;
      console.info(`[publishNow] Publishing to @${account.handle}, mediaUrl: ${item.mediaUrl}`);

      const externalPostId = await publishToFanvue({
        accessToken: account.accessToken!,
        mediaUrl:    item.mediaUrl,
        mediaType:   item.type,
        caption,
        audience:    "followers-and-subscribers",
        onProgress:  (step) => toast.loading(step, { id: toastId }),
      });

      const now   = new Date().toISOString();
      const table = item.type === "image" ? "images" : "videos";

      const { data: schedRow } = await supabase
        .from("schedules")
        .select("content_id")
        .eq("id", id)
        .single();

      if (schedRow?.content_id) {
        await supabase.from(table).update({
          publish_status:      "published",
          published_at:        now,
          external_post_id:    externalPostId,
          connected_account_id: account.id,
        }).eq("id", schedRow.content_id);
      }

      await scheduleService.update(id, { status: "published" });

      updateItem(id, {
        status: "published",
        queueStatus: "published",
        externalPostId,
        publishedAt: now,
        history: [
          ...item.history,
          { at: now, label: `Published to Fanvue (@${account.handle})`, kind: "published" },
        ],
      });

      toast.success(`✅ Published to @${account.handle}!`, {
        id: toastId,
        description: `Post UUID: ${externalPostId}`,
        duration: 12_000,
        action: {
          label: "View on Fanvue",
          onClick: () => window.open(`https://www.fanvue.com/post/${externalPostId}`, "_blank"),
        },
      });
      queryClient.invalidateQueries({ queryKey: ["schedules"] });
    } catch (e: any) {
      const msg = e?.message ?? "Unknown error";
      console.error("[publishNow] FAILED:", msg);
      updateItem(id, { status: "failed", queueStatus: "failed" });
      try { await scheduleService.update(id, { status: "failed" }); } catch {}
      toast.error("Publish failed", {
        id: toastId,
        description: msg,
        duration: 15_000,
      });
    }
  };

  const pauseItem = (id: string) => {
    updateItem(id, { autoPublish: false });
    toast.message("Auto-publish paused");
  };

  const [dragId, setDragId] = useState<string | null>(null);

  const onDropOnDay = async (day: Date) => {
    if (!dragId) return;
    const item = items.find((i) => i.id === dragId);
    if (!item) return;
    const oldD = new Date(item.scheduledAt);
    const newD = new Date(day);
    newD.setHours(oldD.getHours(), oldD.getMinutes(), 0, 0);
    const iso = newD.toISOString();
    updateItem(dragId, {
      scheduledAt: iso,
      history: [
        ...item.history,
        { at: new Date().toISOString(), label: `Rescheduled to ${fmtDateTime(iso)}`, kind: "scheduled" },
      ],
    });
    try {
      await scheduleService.update(dragId, { publish_time: iso });
      toast.success("Schedule updated");
      queryClient.invalidateQueries({ queryKey: ["schedules"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to update");
    }
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

            {/* Header */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <Link
                  to="/"
                  className="mb-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> Dashboard
                </Link>
                <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">
                  Scheduling
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Plan, queue and publish approved content to your connected Fanvue accounts.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="gap-2" onClick={() => setAccountsOpen(true)}>
                  <Plug className="h-4 w-4" />
                  {connectedCount > 0 ? (
                    <span>
                      Accounts{" "}
                      <span className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-success text-[10px] font-bold text-white">
                        {connectedCount}
                      </span>
                    </span>
                  ) : (
                    "Connect Fanvue"
                  )}
                </Button>
                <Button size="sm" className="gap-2" onClick={() => setCreateOpen(true)}>
                  <CalendarPlus className="h-4 w-4" /> Schedule content
                </Button>
              </div>
            </div>

            {/* No account warning */}
            {connectedCount === 0 && (
              <div className="flex items-center gap-3 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3">
                <AlertTriangle className="h-4 w-4 flex-shrink-0 text-warning" />
                <p className="flex-1 text-sm text-foreground">
                  No Fanvue account connected. Connect one to start publishing.
                </p>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setAccountsOpen(true)}>
                  <ExternalLink className="h-3.5 w-3.5" /> Connect now
                </Button>
              </div>
            )}

            {/* Stats */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <DashboardCard label="Scheduled posts"      value={stats.scheduled}        icon={CalendarClock} accent="primary"  hint="Awaiting publish" />
              <DashboardCard label="Publishing today"     value={stats.todayCount}        icon={Clock}         accent="chart-2"  hint="In the next 24h" />
              <DashboardCard label="Published this week"  value={stats.weekPublished}     icon={CheckCircle2}  accent="chart-3"  delta={12} />
              <DashboardCard label="Failed publications"  value={stats.failed}            icon={AlertTriangle} accent="chart-5"  hint={stats.failed ? "Needs attention" : "All clear"} />
              <DashboardCard label="Connected accounts"   value={`${stats.connectedAccounts}/${accounts.length}`} icon={Link2} accent="chart-4" hint="Fanvue" />
            </div>

            {/* Filters */}
            <Card className="border-border/60 bg-card">
              <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search character, content, account, post ID…"
                    className="pl-9"
                  />
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
                  <Select value={characterFilter} onValueChange={setCharacterFilter}>
                    <SelectTrigger className="h-9 w-[150px]"><SelectValue placeholder="Character" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All characters</SelectItem>
                      {characters.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
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

            {/* Views */}
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                <TabsTrigger value="calendar">Calendar view</TabsTrigger>
                <TabsTrigger value="queue">Publishing queue</TabsTrigger>
                <TabsTrigger value="history">Publishing history</TabsTrigger>
              </TabsList>
              <TabsContent value="calendar" className="mt-4">
                <CalendarView
                  weekStart={weekStart}
                  setWeekStart={setWeekStart}
                  items={filteredItems}
                  getAccount={getAccount}
                  onOpen={setSelected}
                  onDragStart={setDragId}
                  onDropOnDay={onDropOnDay}
                  onSchedule={() => setCreateOpen(true)}
                />
              </TabsContent>
              <TabsContent value="queue" className="mt-4">
                <QueueView
                  items={filteredItems.filter((i) => ["scheduled", "publishing", "failed"].includes(i.status))}
                  getAccount={getAccount}
                  onOpen={setSelected}
                  onPause={pauseItem}
                  onCancel={removeItem}
                  onPublishNow={publishNow}
                  onRetry={retryPublish}
                  onSchedule={() => setCreateOpen(true)}
                />
              </TabsContent>
              <TabsContent value="history" className="mt-4">
                <HistoryView
                  items={filteredItems.filter((i) => ["published", "failed"].includes(i.status))}
                  getAccount={getAccount}
                  onOpen={setSelected}
                  onRetry={retryPublish}
                />
              </TabsContent>
            </Tabs>
          </div>
        </main>
      </SidebarInset>

      <DetailSheet
        item={selected}
        onClose={() => setSelected(null)}
        getAccount={getAccount}
        onRetry={retryPublish}
        onPublishNow={publishNow}
        onRemove={removeItem}
      />
      <CreateScheduleDialog open={createOpen} onOpenChange={setCreateOpen} />
      <AccountsDialog
        open={accountsOpen}
        onOpenChange={setAccountsOpen}
        accounts={accounts}
        onRefresh={() => {
          refetchAccounts();
          queryClient.invalidateQueries({ queryKey: ["connected-accounts"] });
        }}
      />
    </SidebarProvider>
  );
}

// ---------------------------------------------------------------------------
// Calendar view
// ---------------------------------------------------------------------------

function CalendarView({
  weekStart, setWeekStart, items, getAccount, onOpen, onDragStart, onDropOnDay, onSchedule,
}: {
  weekStart: Date;
  setWeekStart: (d: Date) => void;
  items: ScheduledItem[];
  getAccount: (id: string) => ConnectedAccount | undefined;
  onOpen: (i: ScheduledItem) => void;
  onDragStart: (id: string | null) => void;
  onDropOnDay: (d: Date) => void;
  onSchedule: () => void;
}) {
  const days = Array.from({ length: 7 }).map((_, idx) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + idx);
    return d;
  });
  const move = (delta: number) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + delta * 7);
    setWeekStart(d);
  };
  const todayD = new Date();
  const itemsByDay = (day: Date) =>
    items
      .filter((i) => isSameDay(new Date(i.scheduledAt), day))
      .sort((a, b) => +new Date(a.scheduledAt) - +new Date(b.scheduledAt));

  return (
    <Card className="border-border/60 bg-card">
      <CardContent className="p-4">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="font-display text-lg font-semibold">
              {weekStart.toLocaleDateString([], { month: "long", year: "numeric" })}
            </p>
            <p className="text-xs text-muted-foreground">
              Week of {fmtDate(weekStart.toISOString())} — drag cards between days to reschedule
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => move(-1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => {
                const d = new Date();
                d.setHours(0, 0, 0, 0);
                d.setDate(d.getDate() - d.getDay());
                setWeekStart(d);
              }}
            >
              Today
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => move(1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {items.length === 0 ? (
          <EmptyState onSchedule={onSchedule} />
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-7">
            {days.map((day) => {
              const dayItems = itemsByDay(day);
              const isToday  = isSameDay(day, todayD);
              return (
                <div
                  key={day.toISOString()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => onDropOnDay(day)}
                  className={cn(
                    "flex min-h-[260px] flex-col rounded-lg border border-border/60 bg-background/40 p-2 transition-colors hover:border-primary/40"
                  )}
                >
                  <div className="mb-2 flex items-baseline justify-between px-1">
                    <p className={cn("text-[10px] font-medium uppercase tracking-wider", isToday ? "text-primary" : "text-muted-foreground")}>
                      {day.toLocaleDateString([], { weekday: "short" })}
                    </p>
                    <p className={cn("font-display text-lg font-semibold", isToday ? "text-primary" : "text-foreground")}>
                      {day.getDate()}
                    </p>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {dayItems.map((i) => (
                      <CalendarCard
                        key={i.id}
                        item={i}
                        account={getAccount(i.accountId)}
                        onOpen={() => onOpen(i)}
                        onDragStart={() => onDragStart(i.id)}
                      />
                    ))}
                    {dayItems.length === 0 && (
                      <p className="px-1 pt-2 text-[11px] text-muted-foreground/70">Nothing scheduled</p>
                    )}
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

function CalendarCard({
  item, account, onOpen, onDragStart,
}: {
  item: ScheduledItem;
  account?: ConnectedAccount;
  onOpen: () => void;
  onDragStart: () => void;
}) {
  return (
    <button
      type="button"
      draggable
      onDragStart={onDragStart}
      onClick={onOpen}
      className="group flex flex-col gap-1.5 rounded-md border border-border/60 bg-card p-1.5 text-left transition-all hover:border-primary/50 hover:shadow-[0_0_20px_-8px_var(--primary)]"
    >
      <div className="relative h-16 w-full overflow-hidden rounded">
        <img src={item.thumbnail} alt={item.contentName} className="h-full w-full object-cover" />
        <div className="absolute left-1 top-1 grid h-5 w-5 place-items-center rounded bg-black/60 backdrop-blur">
          {item.type === "video"
            ? <VideoIcon className="h-3 w-3 text-white" />
            : <ImageIcon className="h-3 w-3 text-white" />}
        </div>
        <div className="absolute right-1 top-1"><StatusBadge status={item.status} /></div>
      </div>
      <div className="px-0.5">
        <p className="truncate text-xs font-medium text-foreground">{item.character}</p>
        <div className="mt-0.5 flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">{fmtTime(item.scheduledAt)}</span>
          <span className="truncate text-[10px] text-muted-foreground">
            {account?.name.replace("Fanvue Account ", "Acc ")}
          </span>
        </div>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Queue view
// ---------------------------------------------------------------------------

function QueueView({
  items, getAccount, onOpen, onPause, onCancel, onPublishNow, onRetry, onSchedule,
}: {
  items: ScheduledItem[];
  getAccount: (id: string) => ConnectedAccount | undefined;
  onOpen: (i: ScheduledItem) => void;
  onPause: (id: string) => void;
  onCancel: (id: string) => void;
  onPublishNow: (id: string) => void;
  onRetry: (id: string) => void;
  onSchedule: () => void;
}) {
  if (items.length === 0) {
    return (
      <Card className="border-border/60 bg-card">
        <CardContent className="p-4">
          <EmptyState onSchedule={onSchedule} message="The publishing queue is empty." />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-3">
      {items.map((i) => {
        const account = getAccount(i.accountId);
        return (
          <Card key={i.id} className="border-border/60 bg-card transition-colors hover:border-primary/40">
            <CardContent className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={() => onOpen(i)}
                className="relative h-20 w-32 shrink-0 overflow-hidden rounded-md bg-muted"
              >
                <img
                  src={i.thumbnail}
                  alt={i.contentName}
                  className="h-full w-full object-cover transition-transform hover:scale-105"
                />
                {i.type === "video" && (
                  <div className="absolute inset-0 grid place-items-center bg-black/30">
                    <Play className="h-5 w-5 text-white" />
                  </div>
                )}
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-semibold text-foreground">{i.contentName}</p>
                  <QueueBadge status={i.queueStatus} />
                  {!i.autoPublish && (
                    <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                      manual
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {i.character} · {account?.name ?? "Unknown account"}
                </p>
                <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />{fmtDateTime(i.scheduledAt)}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                {i.status === "failed" ? (
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onRetry(i.id)}>
                    <RefreshCw className="h-3.5 w-3.5" /> Retry
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => onPublishNow(i.id)}
                    disabled={i.status === "publishing"}
                  >
                    {i.status === "publishing"
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Send className="h-3.5 w-3.5" />}
                    {i.status === "publishing" ? "Publishing…" : "Publish now"}
                  </Button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon" variant="ghost" className="h-8 w-8">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => onOpen(i)}>
                      <Eye className="mr-2 h-4 w-4" /> View details
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onOpen(i)}>
                      <Edit3 className="mr-2 h-4 w-4" /> Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onPause(i.id)}>
                      <Pause className="mr-2 h-4 w-4" /> Pause auto-publish
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => onCancel(i.id)}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="mr-2 h-4 w-4" /> Cancel
                    </DropdownMenuItem>
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

// ---------------------------------------------------------------------------
// History view
// ---------------------------------------------------------------------------

function HistoryView({
  items, getAccount, onOpen, onRetry,
}: {
  items: ScheduledItem[];
  getAccount: (id: string) => ConnectedAccount | undefined;
  onOpen: (i: ScheduledItem) => void;
  onRetry: (id: string) => void;
}) {
  if (items.length === 0) {
    return (
      <Card className="border-border/60 bg-card">
        <CardContent className="p-10">
          <div className="mx-auto max-w-md text-center">
            <Inbox className="mx-auto h-10 w-10 text-muted-foreground/60" />
            <p className="mt-3 font-medium text-foreground">No publishing history yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Published and failed posts will appear here.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/60 bg-card">
      <CardContent className="p-0">
        <div className="grid grid-cols-12 gap-3 border-b border-border/60 px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          <div className="col-span-5">Content</div>
          <div className="col-span-2">Account</div>
          <div className="col-span-2">Publish date</div>
          <div className="col-span-2">Post ID</div>
          <div className="col-span-1 text-right">Status</div>
        </div>
        {items.map((i) => {
          const account = getAccount(i.accountId);
          return (
            <button
              key={i.id}
              type="button"
              onClick={() => onOpen(i)}
              className="grid w-full grid-cols-12 items-center gap-3 border-b border-border/40 px-4 py-3 text-left transition-colors hover:bg-muted/40 last:border-b-0"
            >
              <div className="col-span-5 flex items-center gap-3">
                <div className="relative h-12 w-16 shrink-0 overflow-hidden rounded">
                  <img src={i.thumbnail} alt={i.contentName} className="h-full w-full object-cover" />
                  {i.type === "video" && (
                    <div className="absolute inset-0 grid place-items-center bg-black/30">
                      <Play className="h-3.5 w-3.5 text-white" />
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{i.contentName}</p>
                  <p className="truncate text-xs text-muted-foreground">{i.character}</p>
                </div>
              </div>
              <div className="col-span-2 text-xs text-muted-foreground">
                <p className="truncate text-foreground">{account?.name}</p>
                <p className="truncate">{account?.handle}</p>
              </div>
              <div className="col-span-2 text-xs text-muted-foreground">
                {i.publishedAt ? fmtDateTime(i.publishedAt) : fmtDateTime(i.scheduledAt)}
              </div>
              <div className="col-span-2 truncate font-mono text-[11px] text-muted-foreground">
                {i.externalPostId ?? "—"}
              </div>
              <div className="col-span-1 flex items-center justify-end gap-2">
                <StatusBadge status={i.status} />
                {i.status === "failed" && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={(e) => { e.stopPropagation(); onRetry(i.id); }}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </button>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({
  onSchedule,
  message = "No scheduled content.",
}: {
  onSchedule: () => void;
  message?: string;
}) {
  return (
    <div className="mx-auto max-w-md py-10 text-center">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-border/60 bg-background">
        <CalendarClock className="h-6 w-6 text-muted-foreground" />
      </div>
      <p className="mt-4 font-display text-lg font-semibold text-foreground">{message}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Pick an approved asset from the library and schedule it to a connected Fanvue account.
      </p>
      <Button size="sm" className="mt-5 gap-2" onClick={onSchedule}>
        <CalendarPlus className="h-4 w-4" /> Schedule content
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail sheet
// ---------------------------------------------------------------------------

function DetailSheet({
  item, onClose, getAccount, onRetry, onPublishNow, onRemove,
}: {
  item: ScheduledItem | null;
  onClose: () => void;
  getAccount: (id: string) => ConnectedAccount | undefined;
  onRetry: (id: string) => void;
  onPublishNow: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const account = item ? getAccount(item.accountId) : undefined;
  return (
    <Sheet open={!!item} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {item && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                {item.contentName}
                <StatusBadge status={item.status} />
              </SheetTitle>
              <SheetDescription>
                {item.character} · {item.type === "video" ? "Video" : "Image"} · {fmtDateTime(item.scheduledAt)}
              </SheetDescription>
            </SheetHeader>
            <div className="mt-6 space-y-6">
              {/* Preview */}
              <div className="relative aspect-video overflow-hidden rounded-lg bg-muted">
                {item.type === "video" ? (
                  <video
                    src={item.mediaUrl || item.thumbnail}
                    controls
                    playsInline
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <img
                    src={item.mediaUrl || item.thumbnail}
                    alt={item.contentName}
                    className="h-full w-full object-cover"
                  />
                )}
              </div>

              {/* Meta */}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Scheduled"         value={fmtDateTime(item.scheduledAt)} />
                <Field label="Connected account" value={account ? `${account.name} (@${account.handle})` : "—"} />
                <Field label="Mode"              value={item.autoPublish ? "Auto publish" : "Manual publish"} />
                <Field label="Review status"     value="Approved" />
              </div>

              {/* Generation settings */}
              <div>
                <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Generation settings
                </p>
                <div className="grid grid-cols-4 gap-2">
                  <Mini label="FPS"    value={item.settings.fps} />
                  <Mini label="Frames" value={item.settings.framesPerScene} />
                  <Mini label="Scenes" value={item.settings.numScenes} />
                  <Mini label="Steps"  value={item.settings.samplingSteps} />
                </div>
              </div>

              {/* Scene prompts */}
              <div>
                <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Scene prompts
                </p>
                <ScrollArea className="h-40 rounded-md border border-border bg-background/40 p-3">
                  <ol className="space-y-2 text-xs text-foreground">
                    {item.scenePrompts.map((p, idx) => (
                      <li key={idx} className="leading-relaxed">
                        <span className="mr-1 text-muted-foreground">{idx + 1}.</span>{p}
                      </li>
                    ))}
                  </ol>
                </ScrollArea>
              </div>

              {/* Published info */}
              {(item.externalPostId || item.publishedAt) && (
                <div className="grid grid-cols-2 gap-3">
                  {item.publishedAt    && <Field label="Published at"    value={fmtDateTime(item.publishedAt)} />}
                  {item.externalPostId && <Field label="Fanvue Post UUID" value={item.externalPostId} mono />}
                </div>
              )}

              {/* History */}
              <div>
                <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Publishing history
                </p>
                <ol className="relative space-y-3 border-l border-border pl-4">
                  {item.history.map((h, idx) => (
                    <li key={idx} className="relative">
                      <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-primary ring-4 ring-background" />
                      <p className="text-xs font-medium text-foreground">{h.label}</p>
                      <p className="text-[11px] text-muted-foreground">{fmtDateTime(h.at)}</p>
                    </li>
                  ))}
                </ol>
              </div>

              <Separator />

              {/* Actions */}
              <div className="flex flex-wrap items-center gap-2">
                {item.status === "failed" ? (
                  <Button size="sm" className="gap-2" onClick={() => onRetry(item.id)}>
                    <RefreshCw className="h-4 w-4" /> Retry publication
                  </Button>
                ) : item.status !== "published" ? (
                  <Button
                    size="sm"
                    className="gap-2"
                    onClick={() => onPublishNow(item.id)}
                    disabled={item.status === "publishing"}
                  >
                    {item.status === "publishing"
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <Send className="h-4 w-4" />}
                    {item.status === "publishing" ? "Publishing…" : "Publish now"}
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-2 text-destructive hover:text-destructive"
                  onClick={() => onRemove(item.id)}
                >
                  <Trash2 className="h-4 w-4" /> Remove schedule
                </Button>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-md border border-border bg-background/40 p-3">
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-sm text-foreground", mono && "font-mono text-xs break-all")}>{value}</p>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-border bg-background/40 p-2 text-center">
      <p className="font-display text-lg font-semibold text-foreground">{value}</p>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create schedule dialog
// ---------------------------------------------------------------------------

type ApprovedAsset = {
  id: string;
  type: "image" | "video";
  name: string;
  character: string;
  thumbnail: string;
};
const EMPTY_APPROVED_ASSETS: ApprovedAsset[] = [];

async function fetchApprovedAssets(): Promise<ApprovedAsset[]> {
  const [imgRes, vidRes, charRes] = await Promise.all([
    supabase.from("images").select("id, image_url, prompt, character_id").eq("status", "approved"),
    supabase.from("videos").select("id, video_url, prompt, character_id").eq("status", "approved"),
    supabase.from("characters").select("id, name, reference_image_url"),
  ]);
  const charMap = new Map((charRes.data ?? []).map((c: any) => [c.id, c]));

  const imgs: ApprovedAsset[] = (imgRes.data ?? []).map((i: any) => ({
    id: i.id,
    type: "image",
    name: `${charMap.get(i.character_id)?.name ?? "Lila"} — ${(i.prompt ?? "Image").slice(0, 40)}`,
    character: charMap.get(i.character_id)?.name ?? "Lila",
    thumbnail: i.image_url ?? charMap.get(i.character_id)?.reference_image_url ?? "",
  }));
  const vids: ApprovedAsset[] = (vidRes.data ?? []).map((v: any) => ({
    id: v.id,
    type: "video",
    name: `${charMap.get(v.character_id)?.name ?? "Lila"} — ${(v.prompt ?? "Video").slice(0, 40)}`,
    character: charMap.get(v.character_id)?.name ?? "Lila",
    thumbnail: charMap.get(v.character_id)?.reference_image_url ?? "",
  }));
  return [...imgs, ...vids];
}

function CreateScheduleDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { data: assets   = EMPTY_APPROVED_ASSETS    } = useQuery({ queryKey: ["approved-assets"],    queryFn: fetchApprovedAssets, enabled: open });
  const { data: accounts = EMPTY_CONNECTED_ACCOUNTS } = useQuery({ queryKey: ["connected-accounts"], queryFn: fetchAccounts,       enabled: open });

  const [contentIdx,   setContentIdx]   = useState("0");
  const [accountId,    setAccountId]    = useState("");
  const [date,         setDate]         = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  });
  const [time,         setTime]         = useState("18:00");
  const [autoPublish,  setAutoPublish]  = useState(true);
  const [notes,        setNotes]        = useState("");

  useEffect(() => {
    if (accounts.length && !accountId) setAccountId(accounts[0].id);
  }, [accounts, accountId]);

  const submit = async () => {
    const asset = assets[Number(contentIdx)];
    if (!asset)     { toast.error("Pick an approved asset first");     return; }
    if (!accountId) { toast.error("Connect a Fanvue account first");   return; }

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

      // Save the chosen Fanvue account onto the asset row so publishNow can find it
      const table = asset.type === "image" ? "images" : "videos";
      await supabase
        .from(table)
        .update({ connected_account_id: accountId })
        .eq("id", asset.id);

      toast.success("Content scheduled");
      queryClient.invalidateQueries({ queryKey: ["schedules"] });
      onOpenChange(false);
      setNotes("");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to schedule");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Schedule content</DialogTitle>
          <DialogDescription>
            Queue an approved asset for publishing to a connected Fanvue account.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {/* Asset picker */}
          <div className="space-y-1.5">
            <Label>Content</Label>
            {assets.length === 0 ? (
              <p className="rounded-md border border-dashed border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                No approved content yet. Approve images or videos in the Review Queue first.
              </p>
            ) : (
              <Select value={contentIdx} onValueChange={setContentIdx}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {assets.map((a, idx) => (
                    <SelectItem key={a.id} value={String(idx)}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Account picker */}
          <div className="space-y-1.5">
            <Label>Publishing account</Label>
            {accounts.length === 0 ? (
              <div className="rounded-md border border-dashed border-border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground mb-2">No Fanvue account connected yet.</p>
                <Button
                  size="sm"
                  className="gap-2 w-full"
                  onClick={() => { onOpenChange(false); startFanvueOAuth(); }}
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Connect Fanvue Account
                </Button>
              </div>
            ) : (
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id} disabled={a.status !== "connected"}>
                      {a.name} {a.status !== "connected" ? "· offline" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Date & time */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Time</Label>
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label>Publishing notes</Label>
            <Textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional context for reviewers or publishers…"
            />
          </div>

          {/* Auto publish toggle */}
          <label className="flex items-center justify-between rounded-md border border-border bg-background/40 p-3">
            <div>
              <p className="text-sm font-medium text-foreground">Auto publish</p>
              <p className="text-xs text-muted-foreground">Push automatically at the scheduled time.</p>
            </div>
            <input
              type="checkbox"
              checked={autoPublish}
              onChange={(e) => setAutoPublish(e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={submit}
            className="gap-2"
            disabled={!assets.length || !accounts.length}
          >
            <CalendarPlus className="h-4 w-4" /> Schedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
