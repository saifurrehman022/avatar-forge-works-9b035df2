import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { scheduleService } from "@/services";
import {  
  CalendarClock, CalendarPlus, CheckCircle2, Clock, Search,
  Image as ImageIcon, Video as VideoIcon, Play, ArrowLeft, Send,
  Filter, Inbox, ChevronLeft, ChevronRight, MoreHorizontal,
  Trash2, Eye, RefreshCw, AlertTriangle,
  Loader2, Plug, CheckCircle, ExternalLink, Bug,
  ChevronDown, ChevronUp, Link2, Copy, Info,
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
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Fanvue OAuth constants
// ─────────────────────────────────────────────────────────────────────────────
const FANVUE_CLIENT_ID     = "f9d35fff-3d12-4dd5-8945-750c37d65ae9";
const FANVUE_CLIENT_SECRET = "05275891c81581c5cb79d336c8e9f87680f0976843bf17d6737bdcf0dde38b1a";
const FANVUE_REDIRECT_URI  = "https://avatar-forge-works-9b035df2-j56ivc6di-saifurrehman022s-projects.vercel.app/schedule";
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
function emitLog(entry: LogEntry) {
  console[entry.level === "success" ? "info" : entry.level](`[FV]`, entry.msg, entry.detail ?? "");
  _logListeners.forEach(fn => fn(entry));
}
const dbg   = (msg: string, d?: string) => emitLog({ at: Date.now(), level: "info",    msg, detail: d });
const dbgOk = (msg: string, d?: string) => emitLog({ at: Date.now(), level: "success", msg, detail: d });
const dbgW  = (msg: string, d?: string) => emitLog({ at: Date.now(), level: "warn",    msg, detail: d });
const dbgE  = (msg: string, d?: string) => emitLog({ at: Date.now(), level: "error",   msg, detail: d });

function useDebugLog() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  useEffect(() => {
    const fn = (e: LogEntry) => setLogs(prev => [e, ...prev].slice(0, 200));
    _logListeners.push(fn);
    return () => { _logListeners = _logListeners.filter(f => f !== fn); };
  }, []);
  return { logs, clearLogs: () => setLogs([]) };
}

// ─────────────────────────────────────────────────────────────────────────────
// localStorage token store
// ─────────────────────────────────────────────────────────────────────────────
const LS_TOKEN_KEY = "fanvue_token_data";
type StoredToken = { accessToken: string; refreshToken?: string; expiresAt?: number; name: string; handle: string; uuid: string; };
const saveToken  = (t: StoredToken) => localStorage.setItem(LS_TOKEN_KEY, JSON.stringify(t));
const clearToken = () => localStorage.removeItem(LS_TOKEN_KEY);
function loadToken(): StoredToken | null {
  try { const r = localStorage.getItem(LS_TOKEN_KEY); return r ? JSON.parse(r) : null; } catch { return null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// PKCE helpers
// ─────────────────────────────────────────────────────────────────────────────
function b64url(buf: ArrayBuffer) {
  let s = ""; for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
}
async function generatePKCE() {
  const arr = new Uint8Array(32); crypto.getRandomValues(arr);
  const verifier  = b64url(arr.buffer);
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  return { verifier, challenge };
}
const PKCE_KEY = "fanvue_pkce_v"; const STATE_KEY = "fanvue_state";

async function startFanvueOAuth() {
  const { verifier, challenge } = await generatePKCE();
  const state = crypto.randomUUID();
  sessionStorage.setItem(PKCE_KEY, verifier); sessionStorage.setItem(STATE_KEY, state);
  const p = new URLSearchParams({
    client_id: FANVUE_CLIENT_ID, redirect_uri: FANVUE_REDIRECT_URI,
    response_type: "code",
    scope: "openid offline_access read:self read:media write:media write:post",
    state, code_challenge: challenge, code_challenge_method: "S256",
  });
  window.location.href = `${FANVUE_AUTH_URL}?${p}`;
}

async function exchangeFanvueCode(code: string): Promise<StoredToken> {
  const verifier = sessionStorage.getItem(PKCE_KEY);
  if (!verifier) throw new Error("PKCE verifier missing — click Connect again");
  sessionStorage.removeItem(PKCE_KEY); sessionStorage.removeItem(STATE_KEY);
  dbg("Exchanging auth code for token…");
  const tokenRes = await fetch(FANVUE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code", code,
      redirect_uri: FANVUE_REDIRECT_URI, client_id: FANVUE_CLIENT_ID,
      client_secret: FANVUE_CLIENT_SECRET, code_verifier: verifier,
    }).toString(),
  });
  if (!tokenRes.ok) { const e = await tokenRes.text(); dbgE(`Token exchange failed (${tokenRes.status})`, e); throw new Error(`Token exchange failed (${tokenRes.status}): ${e}`); }
  const tokens = await tokenRes.json();
  dbgOk("Token exchange success", JSON.stringify(tokens));
  const accessToken = tokens.access_token as string;
  dbg("Fetching Fanvue profile…");
  const profileRes = await fetch(`${FANVUE_API_BASE}/me`, {
    headers: { Authorization: `Bearer ${accessToken}`, "X-Fanvue-API-Version": FANVUE_API_VERSION },
  });
  const profileBody = await profileRes.text();
  dbg(`/me response (${profileRes.status})`, profileBody);
  const profile = profileRes.ok ? JSON.parse(profileBody) : {};
  const stored: StoredToken = {
    accessToken, refreshToken: tokens.refresh_token,
    expiresAt: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined,
    name:   profile.displayName ?? profile.name   ?? profile.username ?? "Fanvue Account",
    handle: profile.username    ?? profile.handle ?? profile.uuid     ?? "fanvue",
    uuid:   profile.uuid        ?? profile.id     ?? crypto.randomUUID(),
  };
  saveToken(stored);
  dbgOk(`Token saved`, `@${stored.handle} (${stored.name})`);
  return stored;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fanvue publish — hardened against API-access-gating
// Per official docs:
//   POST   /media/uploads              → { mediaUuid, uploadId }
//   GET    /media/uploads/{uploadId}/parts/{partNumber}/url → presigned URL (text/plain)
//   PUT    {presignedUrl}              → 200 + ETag header
//   PATCH  /media/uploads/{uploadId}   → { status }
//   GET    /media/{uuid}               → { status: created|processing|ready|error }
//   POST   /posts                      → { uuid, ... }
// ─────────────────────────────────────────────────────────────────────────────
const fvH = (token: string, extra?: Record<string,string>) => ({
  Authorization: `Bearer ${token}`, "X-Fanvue-API-Version": FANVUE_API_VERSION, ...extra,
});

async function safeJson(res: Response): Promise<any> {
  const text = await res.text();
  dbg(`HTTP ${res.status} ${res.url.replace(/\?.*/, "")}`, text.slice(0, 600));
  try { return JSON.parse(text); } catch { return { _raw: text }; }
}

async function fetchMediaBlob(mediaUrl: string): Promise<Blob> {
  dbg("Downloading media (direct)…", mediaUrl);
  try {
    const r = await fetch(mediaUrl);
    if (r.ok) { const b = await r.blob(); if (b.size > 0) { dbgOk(`Direct OK`, `${b.size} bytes type=${b.type}`); return b; } }
    dbgW(`Direct returned ${r.status} or empty`);
  } catch (e: any) { dbgW("Direct blocked", e?.message); }
  dbg("Trying proxy /api/proxy-media…");
  const r2 = await fetch(`/api/proxy-media?url=${encodeURIComponent(mediaUrl)}`);
  if (!r2.ok) { const t = await r2.text().catch(()=>""); dbgE(`Proxy failed (${r2.status})`, t); throw new Error(`Media download failed. Direct fetch blocked, proxy returned ${r2.status}.\nAdd api/proxy-media.ts to your Vercel project to enable proxy download.`); }
  const b2 = await r2.blob();
  if (b2.size === 0) throw new Error("Proxy returned empty blob");
  dbgOk(`Proxy OK`, `${b2.size} bytes`);
  return b2;
}

async function publishToFanvue(p: {
  accessToken: string; mediaUrl: string; mediaType: "image"|"video";
  caption: string; audience: "subscribers"|"followers-and-subscribers";
  onProgress?: (s: string) => void;
}): Promise<string> {
  const rep = (s: string) => { dbg(s); p.onProgress?.(s); };

  // 1. Verify token via GET /me
  rep("Verifying Fanvue token…");
  const meR = await fetch(`${FANVUE_API_BASE}/me`, { headers: fvH(p.accessToken) });
  const meBody = await safeJson(meR);
  if (!meR.ok) {
    const isGated = meR.status === 403 || meR.status === 401;
    dbgE(`/me failed (${meR.status})`, JSON.stringify(meBody));
    if (isGated) throw new Error(`API_ACCESS_DENIED: Your Fanvue creator account does not have API access yet (${meR.status}). Go to Creator Tools → Build on Fanvue, or contact support@fanvue.com.`);
    throw new Error(`Token check failed (${meR.status}): ${JSON.stringify(meBody)}`);
  }
  dbgOk(`Authenticated as @${meBody.username ?? "?"}`);
  rep(`Authenticated as @${meBody.username ?? "?"}`);

  // 2. Download media blob
  rep("Downloading media…");
  const blob = await fetchMediaBlob(p.mediaUrl);
  const ext  = p.mediaType === "video" ? "mp4" : "jpeg";
  const filename = `lila-${Date.now()}.${ext}`;
  rep(`Downloaded ${(blob.size/1024).toFixed(0)} KB`);

  // 3. POST /media/uploads — create upload session
  rep("Creating upload session…");
  const sessBody = { name: filename, filename, mediaType: p.mediaType };
  dbg("POST /media/uploads", JSON.stringify(sessBody));
  const sessR = await fetch(`${FANVUE_API_BASE}/media/uploads`, {
    method: "POST", headers: fvH(p.accessToken, { "Content-Type": "application/json" }),
    body: JSON.stringify(sessBody),
  });
  const sess = await safeJson(sessR);
  if (!sessR.ok) {
    const isGated = sessR.status === 403;
    dbgE(`Upload session failed (${sessR.status})`, JSON.stringify(sess));
    if (isGated) throw new Error(`API_ACCESS_DENIED: write:media permission denied (403). Your account is on the API access waitlist. Contact support@fanvue.com.`);
    throw new Error(`Upload session failed (${sessR.status}): ${JSON.stringify(sess)}`);
  }
  const { mediaUuid, uploadId } = sess;
  if (!mediaUuid) throw new Error(`Missing mediaUuid in response: ${JSON.stringify(sess)}`);
  if (!uploadId)  throw new Error(`Missing uploadId in response: ${JSON.stringify(sess)}`);
  dbgOk("Session created", `mediaUuid=${mediaUuid} uploadId=${uploadId}`);

  // 4. GET /media/uploads/{uploadId}/parts/1/url — presigned S3 URL
  rep("Getting presigned upload URL…");
  const urlR = await fetch(`${FANVUE_API_BASE}/media/uploads/${uploadId}/parts/1/url`, { headers: fvH(p.accessToken) });
  if (!urlR.ok) { const t = await urlR.text(); dbgE(`Presigned URL failed (${urlR.status})`, t); throw new Error(`Presigned URL (${urlR.status}): ${t}`); }
  const presigned = (await urlR.text()).trim().replace(/^"|"$/g,"");
  if (!presigned.startsWith("https://")) { dbgE("Bad presigned URL", presigned); throw new Error(`Invalid presigned URL: "${presigned.slice(0,100)}"`); }
  dbgOk("Got presigned URL", presigned.slice(0,80)+"…");

  // 5. PUT blob to S3
  rep(`Uploading ${(blob.size/1024).toFixed(0)} KB to S3…`);
  const contentType = blob.type || (p.mediaType === "video" ? "video/mp4" : "image/jpeg");
  const s3R = await fetch(presigned, { method: "PUT", body: blob, headers: { "Content-Type": contentType } });
  if (!s3R.ok) { const t = await s3R.text(); dbgE(`S3 PUT failed (${s3R.status})`, t); throw new Error(`S3 upload failed (${s3R.status}): ${t}`); }
  const etag = (s3R.headers.get("ETag") ?? s3R.headers.get("etag") ?? "").replace(/^"|"$/g,"");
  dbgOk("S3 upload complete", `ETag: ${etag}`);

  // 6. PATCH /media/uploads/{uploadId} — complete session
  rep("Completing upload…");
  const compR = await fetch(`${FANVUE_API_BASE}/media/uploads/${uploadId}`, {
    method: "PATCH", headers: fvH(p.accessToken, { "Content-Type": "application/json" }),
    body: JSON.stringify({ parts: [{ PartNumber: 1, ETag: etag }] }),
  });
  const compBody = await safeJson(compR);
  if (!compR.ok) { dbgE(`Complete failed (${compR.status})`, JSON.stringify(compBody)); throw new Error(`Complete upload (${compR.status}): ${JSON.stringify(compBody)}`); }
  dbgOk("Upload complete", JSON.stringify(compBody));

  // 7. Poll GET /media/{uuid} until status=ready
  // Per official docs: valid statuses are created | processing | ready | error
  rep("Waiting for Fanvue to process media…");
  const deadline = Date.now() + 180_000;
  let lastStatus = "";
  while (Date.now() < deadline) {
    const pollR = await fetch(`${FANVUE_API_BASE}/media/${mediaUuid}`, { headers: fvH(p.accessToken) });
    const pollBody = await safeJson(pollR);
    const status = String(pollBody.status ?? "");
    if (status !== lastStatus) { dbg(`Media status: ${status}`, JSON.stringify(pollBody)); lastStatus = status; }
    rep(`Processing… (${status})`);
    if (status === "ready")  { dbgOk("Media ready ✓", mediaUuid); break; }
    if (status === "error")  { dbgE("Media error", JSON.stringify(pollBody)); throw new Error(`Media processing failed. Check file format (JPEG/PNG or MP4).`); }
    await new Promise(r => setTimeout(r, 4000));
  }

  // 8. POST /posts — create post
  rep("Creating post on Fanvue…");
  const postBody = { text: p.caption, mediaUuids: [mediaUuid], audience: p.audience };
  dbg("POST /posts", JSON.stringify(postBody));
  const postR = await fetch(`${FANVUE_API_BASE}/posts`, {
    method: "POST", headers: fvH(p.accessToken, { "Content-Type": "application/json" }),
    body: JSON.stringify(postBody),
  });
  const postData = await safeJson(postR);
  if (!postR.ok) { dbgE(`Create post failed (${postR.status})`, JSON.stringify(postData)); throw new Error(`Create post (${postR.status}): ${JSON.stringify(postData)}`); }
  dbgOk("Post created", JSON.stringify(postData));

  // Per official docs the response has `uuid` at top level (required)
  const postUuid = postData.uuid ?? postData.id ?? postData.postId ?? postData.post?.uuid;
  if (!postUuid) {
    dbgE("No UUID in post response", JSON.stringify(postData));
    throw new Error(`Post created but no UUID returned. Full response: ${JSON.stringify(postData)}`);
  }
  dbgOk("Published!", `UUID: ${postUuid}`);
  rep(`Done! Post UUID: ${postUuid}`);
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
        <button onClick={reset} className="rounded-md border border-input bg-background px-4 py-2 text-sm">Try again</button>
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
type QueueStatus   = "waiting"   | "ready"      | "publishing"| "published" | "failed";
type ContentType   = "image" | "video";
type HistoryEvent  = { at: string; label: string; kind: string };
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
  const imageIds = (rows??[]).filter((r:any)=>r.content_type==="image").map((r:any)=>r.content_id);
  const videoIds = (rows??[]).filter((r:any)=>r.content_type==="video").map((r:any)=>r.content_id);
  const [imgRes, vidRes, charRes] = await Promise.all([
    imageIds.length ? supabase.from("images").select("id,image_url,prompt,character_id,published_at,external_post_id,publish_status").in("id",imageIds) : Promise.resolve({data:[]} as any),
    videoIds.length ? supabase.from("videos").select("id,video_url,prompt,scene_prompts,character_id,published_at,external_post_id,publish_status").in("id",videoIds) : Promise.resolve({data:[]} as any),
    supabase.from("characters").select("id,name,reference_image_url"),
  ]);
  const imgMap  = new Map((imgRes.data??[]).map((i:any)=>[i.id,i]));
  const vidMap  = new Map((vidRes.data??[]).map((v:any)=>[v.id,v]));
  const charMap = new Map((charRes.data??[]).map((c:any)=>[c.id,c]));
  return (rows??[]).map((r:any):ScheduledItem=>{
    const isVideo=r.content_type==="video";
    const src:any=isVideo?vidMap.get(r.content_id):imgMap.get(r.content_id);
    const char:any=src?.character_id?charMap.get(src.character_id):null;
    const scenes:string[]=isVideo&&Array.isArray(src?.scene_prompts)?src.scene_prompts:src?.prompt?[src.prompt]:[];
    const media=isVideo?src?.video_url:src?.image_url;
    const thumb=char?.reference_image_url||media||PLACEHOLDER;
    const status:PublishStatus=r.status==="published"?"published":r.status==="failed"?"failed":r.status==="publishing"?"publishing":"scheduled";
    const queueStatus:QueueStatus=status==="published"?"published":status==="failed"?"failed":status==="publishing"?"publishing":new Date(r.publish_time)<=new Date()?"ready":"waiting";
    return {
      id:r.id, contentName:`${char?.name??"Lila"} — ${(scenes[0]??"Untitled").slice(0,40)}`,
      type:r.content_type, character:char?.name??"Lila",
      thumbnail:thumb, mediaUrl:media||"", scheduledAt:r.publish_time, status, queueStatus, autoPublish:true,
      externalPostId:src?.external_post_id??undefined, publishedAt:src?.published_at??undefined,
      settings:{fps:16,framesPerScene:257,numScenes:scenes.length||1,samplingSteps:29},
      scenePrompts:scenes, negativePrompt:"low quality, blurry, distorted face, watermark",
      history:[
        {at:r.created_at,label:`Scheduled for ${new Date(r.publish_time).toLocaleString()}`,kind:"scheduled"},
        ...(src?.published_at?[{at:src.published_at,label:"Published",kind:"published"}]:[]),
      ],
    };
  });
}

async function fetchApprovedAssets() {
  const [imgRes,vidRes,charRes]=await Promise.all([
    supabase.from("images").select("id,image_url,prompt,character_id").eq("status","approved"),
    supabase.from("videos").select("id,video_url,prompt,character_id").eq("status","approved"),
    supabase.from("characters").select("id,name,reference_image_url"),
  ]);
  const charMap=new Map((charRes.data??[]).map((c:any)=>[c.id,c]));
  return [
    ...(imgRes.data??[]).map((i:any)=>({id:i.id,type:"image" as const,name:`${charMap.get(i.character_id)?.name??"Lila"} — ${(i.prompt??"Image").slice(0,40)}`,url:i.image_url??"",thumbnail:i.image_url??""})),
    ...(vidRes.data??[]).map((v:any)=>({id:v.id,type:"video" as const,name:`${charMap.get(v.character_id)?.name??"Lila"} — ${(v.prompt??"Video").slice(0,40)}`,url:v.video_url??"",thumbnail:charMap.get(v.character_id)?.reference_image_url??""})),
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Style helpers
// ─────────────────────────────────────────────────────────────────────────────
const SS:Record<PublishStatus,string>={
  scheduled:"bg-chart-2/15 text-chart-2 border-chart-2/30",
  publishing:"bg-primary/15 text-primary border-primary/30",
  published:"bg-success/15 text-success border-success/30",
  failed:"bg-destructive/15 text-destructive border-destructive/30",
};
const QS:Record<QueueStatus,string>={
  waiting:"bg-muted text-muted-foreground border-border",
  ready:"bg-chart-2/15 text-chart-2 border-chart-2/30",
  publishing:"bg-primary/15 text-primary border-primary/30",
  published:"bg-success/15 text-success border-success/30",
  failed:"bg-destructive/15 text-destructive border-destructive/30",
};
const LS:Record<LogLevel,string>={info:"text-muted-foreground",warn:"text-yellow-500",error:"text-destructive font-semibold",success:"text-green-500"};
const fmtTime=(s:string)=>new Date(s).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
const fmtDate=(s:string)=>new Date(s).toLocaleDateString([],{month:"short",day:"numeric"});
const fmtDT=(s:string)=>`${fmtDate(s)} · ${fmtTime(s)}`;
const isSameDay=(a:Date,b:Date)=>a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate();

function StatusBadge({status}:{status:PublishStatus}){
  return <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider",SS[status])}>
    {status==="publishing"&&<Loader2 className="h-2.5 w-2.5 animate-spin"/>}{status}
  </span>;
}
function QueueBadge({status}:{status:QueueStatus}){
  return <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider",QS[status])}>{status}</span>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Debug panel
// ─────────────────────────────────────────────────────────────────────────────
function DebugPanel({logs,onClear}:{logs:LogEntry[];onClear:()=>void}){
  const [open,setOpen]=useState(false);
  const ref=useRef<HTMLDivElement>(null);
  const errCount=logs.filter(l=>l.level==="error").length;
  useEffect(()=>{ if(open&&ref.current) ref.current.scrollTop=0; },[open,logs.length]);
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 pointer-events-none">
      <div className="pointer-events-auto mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8">
        <div className={cn("rounded-t-xl border border-border/80 bg-card shadow-2xl transition-all",open?"max-h-80":"max-h-10")}>
          <button type="button" onClick={()=>setOpen(o=>!o)}
            className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-muted/40 rounded-t-xl">
            <Bug className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0"/>
            <span className="text-xs font-medium text-muted-foreground">Publish Debug Log</span>
            {errCount>0&&<span className="flex items-center gap-1 rounded bg-destructive/15 border border-destructive/30 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">{errCount} error{errCount!==1?"s":""}</span>}
            {logs.length>0&&errCount===0&&<span className="text-[10px] text-muted-foreground">{logs.length} entries</span>}
            <div className="ml-auto flex items-center gap-2">
              {open&&<button type="button" onClick={e=>{e.stopPropagation();onClear();}} className="text-[10px] text-muted-foreground hover:text-foreground px-1">Clear</button>}
              {open?<ChevronDown className="h-3.5 w-3.5 text-muted-foreground"/>:<ChevronUp className="h-3.5 w-3.5 text-muted-foreground"/>}
            </div>
          </button>
          {open&&(
            <div ref={ref} className="h-64 overflow-y-auto border-t border-border/60 bg-background/80 font-mono">
              {logs.length===0
                ?<p className="p-4 text-xs text-muted-foreground">No entries yet. Click "Publish now" to see step-by-step output.</p>
                :logs.map((l,i)=>(
                  <div key={i} className="flex items-start gap-2 border-b border-border/30 px-3 py-1 last:border-0">
                    <span className="shrink-0 text-[10px] text-muted-foreground/60 tabular-nums pt-px">{new Date(l.at).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"})}</span>
                    <span className={cn("shrink-0 text-[10px] w-16",LS[l.level])}>[{l.level.toUpperCase()}]</span>
                    <div className="min-w-0 flex-1">
                      <span className={cn("text-[11px]",LS[l.level])}>{l.msg}</span>
                      {l.detail&&<p className="mt-0.5 break-all text-[10px] text-muted-foreground/70">{l.detail}</p>}
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
// Manual URL post dialog — "Post via URL" fallback
// ─────────────────────────────────────────────────────────────────────────────
function ManualPostDialog({open,onOpenChange,items}:{open:boolean;onOpenChange:(o:boolean)=>void;items:ScheduledItem[]}){
  const [selectedId,setSelectedId]=useState(items[0]?.id??"");
  const [caption,setCaption]=useState("");
  const [copying,setCopying]=useState(false);
  const item=items.find(i=>i.id===selectedId)??items[0];

  const copyUrl=async()=>{
    if(!item?.mediaUrl){toast.error("No media URL for this item");return;}
    await navigator.clipboard.writeText(item.mediaUrl);
    setCopying(true); setTimeout(()=>setCopying(false),2000);
    toast.success("Media URL copied to clipboard");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Link2 className="h-4 w-4"/>Post via URL — Manual Method</DialogTitle>
          <DialogDescription>
            Since API access is waitlisted, use this to copy your media URL and caption, then post manually on Fanvue.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {/* Info banner */}
          <div className="flex items-start gap-2 rounded-lg border border-blue-500/30 bg-blue-500/5 p-3">
            <Info className="h-4 w-4 text-blue-500 mt-px flex-shrink-0"/>
            <div className="text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">How to use this</p>
              <p>1. Select the content below and copy the media URL</p>
              <p>2. Copy the caption text</p>
              <p>3. Open <a href="https://www.fanvue.com" target="_blank" rel="noopener noreferrer" className="text-primary underline">fanvue.com</a>, go to Create Post, paste the URL and caption</p>
              <p>4. Alternatively, paste the media URL directly into Fanvue's upload dialog</p>
            </div>
          </div>

          {/* Content selector */}
          <div className="space-y-1.5">
            <Label>Content to post</Label>
            {items.length===0
              ?<p className="rounded-md border border-dashed border-border bg-muted/30 p-3 text-xs text-muted-foreground">No scheduled items found.</p>
              :<Select value={selectedId} onValueChange={setSelectedId}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>{items.map(i=><SelectItem key={i.id} value={i.id}>{i.contentName}</SelectItem>)}</SelectContent>
              </Select>}
          </div>

          {/* Media preview + URL */}
          {item&&(
            <div className="space-y-2">
              <div className="relative aspect-video overflow-hidden rounded-lg bg-muted">
                {item.type==="video"
                  ?<video src={item.mediaUrl||item.thumbnail} controls playsInline className="h-full w-full object-cover"/>
                  :<img src={item.mediaUrl||item.thumbnail} alt="" className="h-full w-full object-cover"/>}
              </div>
              <div className="flex items-center gap-2">
                <Input readOnly value={item.mediaUrl||"No URL available"} className="font-mono text-xs flex-1 bg-muted/40"/>
                <Button size="sm" variant="outline" className="gap-1.5 shrink-0" onClick={copyUrl} disabled={!item.mediaUrl}>
                  {copying?<CheckCircle className="h-3.5 w-3.5 text-success"/>:<Copy className="h-3.5 w-3.5"/>}
                  {copying?"Copied!":"Copy URL"}
                </Button>
              </div>
              {!item.mediaUrl&&<p className="text-xs text-destructive">⚠ No media URL — asset may still be processing in Supabase.</p>}
            </div>
          )}

          {/* Caption */}
          <div className="space-y-1.5">
            <Label>Caption (optional — copy this too)</Label>
            <Textarea
              value={caption||item?.scenePrompts[0]||item?.contentName||""}
              onChange={e=>setCaption(e.target.value)}
              rows={3} className="text-sm resize-none"
              placeholder="Write a caption for your Fanvue post…"
            />
            <Button size="sm" variant="ghost" className="gap-1.5 text-xs" onClick={async()=>{
              const text=caption||item?.scenePrompts[0]||item?.contentName||"";
              await navigator.clipboard.writeText(text);
              toast.success("Caption copied!");
            }}>
              <Copy className="h-3 w-3"/> Copy caption
            </Button>
          </div>

          {/* Open fanvue link */}
          <Button className="w-full gap-2" onClick={()=>window.open("https://www.fanvue.com/post/create","_blank")}>
            <ExternalLink className="h-4 w-4"/> Open Fanvue — Create Post
          </Button>
        </div>
        <DialogFooter><Button variant="outline" onClick={()=>onOpenChange(false)}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Account dialog
// ─────────────────────────────────────────────────────────────────────────────
function AccountDialog({open,onOpenChange,token,onDisconnect}:{open:boolean;onOpenChange:(o:boolean)=>void;token:StoredToken|null;onDisconnect:()=>void}){
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Fanvue Account</DialogTitle>
          <DialogDescription>Connect your Fanvue creator account to publish content from Lila Studio.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {token?(
            <div className="flex items-center justify-between rounded-lg border border-border bg-card p-3">
              <div className="flex items-center gap-3">
                <div className="grid h-9 w-9 place-items-center rounded-full bg-primary/10 text-primary font-semibold text-sm">{token.name.slice(0,1).toUpperCase()}</div>
                <div>
                  <p className="text-sm font-medium">{token.name}</p>
                  <p className="text-xs text-muted-foreground">@{token.handle}</p>
                  {token.expiresAt&&<p className={cn("text-[10px]",token.expiresAt<Date.now()?"text-destructive":"text-muted-foreground")}>
                    {token.expiresAt<Date.now()?"⚠ Token expired":`Expires ${new Date(token.expiresAt).toLocaleDateString()}`}
                  </p>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="gap-1 border-success/40 text-success text-xs"><CheckCircle className="h-3 w-3"/> Connected</Badge>
                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive text-xs" onClick={onDisconnect}>Disconnect</Button>
              </div>
            </div>
          ):(
            <div className="rounded-lg border border-dashed border-border bg-muted/30 p-6 text-center">
              <Plug className="mx-auto h-8 w-8 text-muted-foreground"/>
              <p className="mt-2 text-sm font-medium">No account connected</p>
              <p className="mt-1 text-xs text-muted-foreground">Connect your Fanvue creator account to start publishing.</p>
            </div>
          )}

          {/* API access warning */}
          <div className="rounded-lg border border-orange-500/30 bg-orange-500/5 p-3">
            <p className="text-xs font-medium text-orange-600 mb-1">⏳ API Access Status</p>
            <p className="text-xs text-muted-foreground mb-2">
              Fanvue API access is being rolled out gradually. Even with OAuth connected, you may see 403 errors until your account is whitelisted.
            </p>
            <p className="text-xs text-muted-foreground">
              To request access: Log in to Fanvue → <strong>Creator Tools → Build</strong> or email <strong>support@fanvue.com</strong>.
            </p>
          </div>

          <div className="rounded-lg border border-border bg-muted/20 p-4">
            <p className="text-xs font-medium mb-1">{token?"Reconnect account":"Connect a new account"}</p>
            <p className="text-xs text-muted-foreground mb-3">Redirects to Fanvue OAuth. Token is saved locally in the browser — no server needed.</p>
            <Button className="w-full gap-2" onClick={()=>{onOpenChange(false);startFanvueOAuth();}}>
              <ExternalLink className="h-4 w-4"/> {token?"Reconnect Fanvue":"Connect Fanvue Account"}
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
function SchedulePage(){
  const queryClient=useQueryClient();
  const {data:scheduleData=EMPTY}=useQuery({queryKey:["schedules"],queryFn:fetchSchedules,staleTime:10_000});
  const [items,setItems]=useState<ScheduledItem[]>([]);
  const [fanvueToken,setFanvueToken]=useState<StoredToken|null>(()=>loadToken());
  const {logs,clearLogs}=useDebugLog();
  useEffect(()=>setItems(scheduleData),[scheduleData]);

  // OAuth redirect handler
  useEffect(()=>{
    const params=new URLSearchParams(window.location.search);
    const code=params.get("code"); const err=params.get("error");
    if(err){window.history.replaceState({},"",window.location.pathname);dbgE(`OAuth error`,params.get("error_description")??err);toast.error(`Fanvue auth error: ${params.get("error_description")??err}`);return;}
    if(!code) return;
    window.history.replaceState({},"",window.location.pathname);
    toast.loading("Connecting Fanvue account…",{id:"fv-connect"});
    exchangeFanvueCode(code).then(t=>{setFanvueToken(t);toast.success(`Connected as @${t.handle}!`,{id:"fv-connect"});}).catch(e=>{dbgE("OAuth failed",e.message);toast.error(e.message??"Failed to connect",{id:"fv-connect"});});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  // Realtime subscription
  useEffect(()=>{
    const ch=supabase.channel("schedules-rt").on("postgres_changes",{event:"*",schema:"public",table:"schedules"},()=>queryClient.invalidateQueries({queryKey:["schedules"]})).subscribe();
    return ()=>{supabase.removeChannel(ch);};
  },[queryClient]);

  const [tab,setTab]=useState("calendar");
  const [search,setSearch]=useState("");
  const [statusFilter,setStatusFilter]=useState<"all"|PublishStatus>("all");
  const [rangeFilter,setRangeFilter]=useState<"all"|"today"|"week"|"month">("all");
  const [selected,setSelected]=useState<ScheduledItem|null>(null);
  const [createOpen,setCreateOpen]=useState(false);
  const [accountOpen,setAccountOpen]=useState(false);
  const [manualOpen,setManualOpen]=useState(false);
  const [weekStart,setWeekStart]=useState(()=>{const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-d.getDay());return d;});

  const stats=useMemo(()=>{
    const now=new Date(); const wa=new Date(now); wa.setDate(wa.getDate()-7);
    return {
      scheduled:items.filter(i=>i.status==="scheduled").length,
      todayCount:items.filter(i=>i.status==="scheduled"&&isSameDay(new Date(i.scheduledAt),now)).length,
      weekPublished:items.filter(i=>i.status==="published"&&i.publishedAt&&new Date(i.publishedAt)>=wa).length,
      failed:items.filter(i=>i.status==="failed").length,
    };
  },[items]);

  const filteredItems=useMemo(()=>{
    const now=new Date();
    return items.filter(i=>{
      if(statusFilter!=="all"&&i.status!==statusFilter) return false;
      if(rangeFilter!=="all"){
        const d=new Date(i.scheduledAt);
        if(rangeFilter==="today"&&!isSameDay(d,now)) return false;
        if(rangeFilter==="week"){const wk=new Date(now);wk.setDate(wk.getDate()+7);if(d<now||d>wk)return false;}
        if(rangeFilter==="month"&&(d.getMonth()!==now.getMonth()||d.getFullYear()!==now.getFullYear())) return false;
      }
      if(search.trim()){const q=search.toLowerCase();if(![i.contentName,i.character].join(" ").toLowerCase().includes(q))return false;}
      return true;
    });
  },[items,statusFilter,rangeFilter,search]);

  const updateItem=(id:string,patch:Partial<ScheduledItem>)=>setItems(prev=>prev.map(i=>i.id===id?{...i,...patch}:i));

  const removeItem=async(id:string)=>{
    setItems(prev=>prev.filter(i=>i.id!==id)); setSelected(null);
    try{const{error}=await supabase.from("schedules").delete().eq("id",id);if(error)throw error;toast.success("Schedule removed");queryClient.invalidateQueries({queryKey:["schedules"]});}
    catch(e:any){toast.error(e?.message??"Failed to remove");}
  };

  const retryPublish=async(id:string)=>{
    updateItem(id,{status:"scheduled",queueStatus:"ready"});
    try{await scheduleService.update(id,{status:"scheduled"});toast.success("Queued for retry");}
    catch(e:any){toast.error(e?.message??"Failed to retry");}
  };

  const [audienceChoice,setAudienceChoice]=useState<"subscribers"|"followers-and-subscribers">("followers-and-subscribers");

  const publishNow=async(id:string)=>{
    const item=items.find(i=>i.id===id); if(!item) return;
    const token=loadToken();
    if(!token?.accessToken){
      dbgE("No Fanvue token"); toast.error("No Fanvue account connected.",{action:{label:"Connect",onClick:()=>setAccountOpen(true)},duration:8000}); return;
    }
    if(!item.mediaUrl){dbgE("No mediaUrl",JSON.stringify({id:item.id,type:item.type}));toast.error("No media URL for this item.");return;}
    dbg(`Publishing item ${id}`,`type=${item.type}`);
    const toastId=`pub-${id}`;
    updateItem(id,{status:"publishing",queueStatus:"publishing"});
    toast.loading("Starting Fanvue publish…",{id:toastId,duration:Infinity});
    try{
      const postUuid=await publishToFanvue({
        accessToken:token.accessToken, mediaUrl:item.mediaUrl, mediaType:item.type,
        caption:item.scenePrompts[0]??item.contentName, audience:audienceChoice,
        onProgress:s=>toast.loading(s,{id:toastId,duration:Infinity}),
      });
      const now=new Date().toISOString(); const table=item.type==="image"?"images":"videos";
      const{data:sched}=await supabase.from("schedules").select("content_id").eq("id",id).single();
      if(sched?.content_id){
        const upRes=await supabase.from(table).update({publish_status:"published",published_at:now,external_post_id:postUuid}).eq("id",sched.content_id);
        if(upRes.error) dbgW("Supabase update failed",upRes.error.message); else dbgOk("Supabase updated");
      }
      await scheduleService.update(id,{status:"published"});
      updateItem(id,{status:"published",queueStatus:"published",externalPostId:postUuid,publishedAt:now,history:[...item.history,{at:now,label:`Published to @${token.handle}`,kind:"published"}]});
      toast.success(`✅ Published to @${token.handle}!`,{id:toastId,duration:12_000,description:`Post UUID: ${postUuid}`,action:{label:"View",onClick:()=>window.open(`https://www.fanvue.com/post/${postUuid}`,"_blank")}});
      queryClient.invalidateQueries({queryKey:["schedules"]});
    }catch(e:any){
      const msg=e?.message??"Unknown error";
      const isGated=msg.startsWith("API_ACCESS_DENIED:");
      dbgE("Publish FAILED",msg);
      updateItem(id,{status:"failed",queueStatus:"failed",history:[...item.history,{at:new Date().toISOString(),label:`Failed: ${msg.slice(0,120)}`,kind:"failed"}]});
      try{await scheduleService.update(id,{status:"failed"});}catch{}
      if(isGated){
        toast.error("API access not yet granted",{id:toastId,duration:20_000,
          description:"Your Fanvue account is on the API waitlist. Use 'Post via URL' to post manually.",
          action:{label:"Post manually",onClick:()=>setManualOpen(true)},
        });
      } else {
        toast.error("Publish failed — check debug log",{id:toastId,duration:20_000,description:msg.slice(0,200)});
      }
    }
  };

  const [dragId,setDragId]=useState<string|null>(null);
  const onDropOnDay=async(day:Date)=>{
    if(!dragId) return;
    const item=items.find(i=>i.id===dragId); if(!item) return;
    const oldD=new Date(item.scheduledAt); const newD=new Date(day);
    newD.setHours(oldD.getHours(),oldD.getMinutes(),0,0);
    const iso=newD.toISOString();
    updateItem(dragId,{scheduledAt:iso});
    try{await scheduleService.update(dragId,{publish_time:iso});toast.success("Schedule updated");}
    catch(e:any){toast.error(e?.message??"Failed to update");}
    setDragId(null);
  };

  const connected=!!fanvueToken;

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
                <p className="mt-1 text-sm text-muted-foreground">Plan, queue and publish approved content to your Fanvue account.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {/* Manual post button */}
                <Button variant="outline" size="sm" className="gap-2 border-dashed" onClick={()=>setManualOpen(true)}>
                  <Link2 className="h-4 w-4"/> Post via URL
                </Button>
                {/* Account button */}
                <Button variant="outline" size="sm" className="gap-2" onClick={()=>setAccountOpen(true)}>
                  <Plug className="h-4 w-4"/>
                  {connected
                    ?<span className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-success"/>
                        <span className="max-w-[120px] truncate">{fanvueToken!.name}</span>
                        <span className="text-muted-foreground text-xs">@{fanvueToken!.handle}</span>
                      </span>
                    :"Connect Fanvue"}
                </Button>
                <Button size="sm" className="gap-2" onClick={()=>setCreateOpen(true)}><CalendarPlus className="h-4 w-4"/> Schedule content</Button>
              </div>
            </div>

            {/* Not connected warning */}
            {!connected&&(
              <div className="flex items-center gap-3 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3">
                <AlertTriangle className="h-4 w-4 flex-shrink-0 text-warning"/>
                <p className="flex-1 text-sm">No Fanvue account connected. Connect one to enable auto-publish.</p>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={()=>setAccountOpen(true)}><ExternalLink className="h-3.5 w-3.5"/> Connect now</Button>
              </div>
            )}

            {/* API waitlist info banner — always shown when connected */}
            {connected&&(
              <div className="flex items-start gap-3 rounded-lg border border-orange-500/30 bg-orange-500/5 px-4 py-3">
                <AlertTriangle className="h-4 w-4 flex-shrink-0 text-orange-500 mt-0.5"/>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-orange-600">Fanvue API access is waitlisted</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    OAuth is connected as <strong>@{fanvueToken!.handle}</strong> ✓ but publish calls will return 403 until Fanvue grants your account API access.
                    Visit <strong>Creator Tools → Build</strong> on Fanvue or email <a href="mailto:support@fanvue.com" className="underline">support@fanvue.com</a> to request it.
                    In the meantime, use <strong>Post via URL</strong> to copy your media link and post manually.
                  </p>
                </div>
                <Button size="sm" variant="outline" className="gap-1.5 shrink-0 border-orange-500/40 text-orange-600" onClick={()=>setManualOpen(true)}>
                  <Link2 className="h-3.5 w-3.5"/> Post via URL
                </Button>
              </div>
            )}

            {/* Stats */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <DashboardCard label="Scheduled posts"     value={stats.scheduled}    icon={CalendarClock} accent="primary" hint="Awaiting publish"/>
              <DashboardCard label="Publishing today"    value={stats.todayCount}   icon={Clock}         accent="chart-2" hint="Next 24h"/>
              <DashboardCard label="Published this week" value={stats.weekPublished} icon={CheckCircle2}  accent="chart-3"/>
              <DashboardCard label="Failed"              value={stats.failed}        icon={AlertTriangle} accent="chart-5" hint={stats.failed?"Needs attention":"All clear"}/>
            </div>

            {/* Audience selector */}
            <div className="flex items-center gap-3">
              <Label className="text-xs text-muted-foreground whitespace-nowrap">Publish audience:</Label>
              <Select value={audienceChoice} onValueChange={v=>setAudienceChoice(v as any)}>
                <SelectTrigger className="h-8 w-[220px] text-xs"><SelectValue/></SelectTrigger>
                <SelectContent>
                  <SelectItem value="followers-and-subscribers">Followers & Subscribers</SelectItem>
                  <SelectItem value="subscribers">Subscribers only</SelectItem>
                </SelectContent>
              </Select>
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

            {/* Views */}
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
                <QueueView items={filteredItems.filter(i=>["scheduled","publishing","failed"].includes(i.status))}
                  onOpen={setSelected} onCancel={removeItem} onPublishNow={publishNow} onRetry={retryPublish}
                  onManualPost={()=>setManualOpen(true)} onSchedule={()=>setCreateOpen(true)}/>
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
        fanvueToken={fanvueToken} onRetry={retryPublish} onPublishNow={publishNow} onRemove={removeItem}
        onManualPost={()=>setManualOpen(true)}/>
      <CreateScheduleDialog open={createOpen} onOpenChange={setCreateOpen} fanvueToken={fanvueToken}/>
      <AccountDialog open={accountOpen} onOpenChange={setAccountOpen} token={fanvueToken}
        onDisconnect={()=>{clearToken();setFanvueToken(null);toast.success("Fanvue account disconnected");}}/>
      <ManualPostDialog open={manualOpen} onOpenChange={setManualOpen} items={items.filter(i=>i.status!=="published")}/>
      <DebugPanel logs={logs} onClear={clearLogs}/>
    </SidebarProvider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Calendar view
// ─────────────────────────────────────────────────────────────────────────────
function CalendarView({weekStart,setWeekStart,items,onOpen,onDragStart,onDropOnDay,onSchedule}:{
  weekStart:Date;setWeekStart:(d:Date)=>void;items:ScheduledItem[];
  onOpen:(i:ScheduledItem)=>void;onDragStart:(id:string|null)=>void;
  onDropOnDay:(d:Date)=>void;onSchedule:()=>void;
}){
  const days=Array.from({length:7}).map((_,idx)=>{const d=new Date(weekStart);d.setDate(d.getDate()+idx);return d;});
  const move=(delta:number)=>{const d=new Date(weekStart);d.setDate(d.getDate()+delta*7);setWeekStart(d);};
  const todayD=new Date();
  const byDay=(day:Date)=>items.filter(i=>isSameDay(new Date(i.scheduledAt),day)).sort((a,b)=>+new Date(a.scheduledAt)-+new Date(b.scheduledAt));
  return (
    <Card className="border-border/60 bg-card">
      <CardContent className="p-4">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="font-display text-lg font-semibold">{weekStart.toLocaleDateString([],{month:"long",year:"numeric"})}</p>
            <p className="text-xs text-muted-foreground">Week of {fmtDate(weekStart.toISOString())} — drag cards to reschedule</p>
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
              const di=byDay(day); const isToday=isSameDay(day,todayD);
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
function QueueView({items,onOpen,onCancel,onPublishNow,onRetry,onManualPost,onSchedule}:{
  items:ScheduledItem[];onOpen:(i:ScheduledItem)=>void;onCancel:(id:string)=>void;
  onPublishNow:(id:string)=>void;onRetry:(id:string)=>void;
  onManualPost:()=>void;onSchedule:()=>void;
}){
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
              <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground"><Clock className="h-3 w-3"/>{fmtDT(i.scheduledAt)}</p>
              {!i.mediaUrl&&<p className="mt-1 text-[10px] text-destructive">⚠ No media URL — asset missing in Supabase</p>}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {i.status==="failed"
                ?<Button size="sm" variant="outline" className="gap-1.5" onClick={()=>onRetry(i.id)}><RefreshCw className="h-3.5 w-3.5"/> Retry</Button>
                :<Button size="sm" variant="outline" className="gap-1.5" onClick={()=>onPublishNow(i.id)} disabled={i.status==="publishing"||!i.mediaUrl}>
                    {i.status==="publishing"?<Loader2 className="h-3.5 w-3.5 animate-spin"/>:<Send className="h-3.5 w-3.5"/>}
                    {i.status==="publishing"?"Publishing…":"Publish now"}
                  </Button>}
              <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground" onClick={onManualPost}>
                <Link2 className="h-3.5 w-3.5"/> Via URL
              </Button>
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
function HistoryView({items,onOpen,onRetry}:{items:ScheduledItem[];onOpen:(i:ScheduledItem)=>void;onRetry:(id:string)=>void}){
  if(items.length===0) return (
    <Card className="border-border/60 bg-card"><CardContent className="p-10 text-center">
      <Inbox className="mx-auto h-10 w-10 text-muted-foreground/60"/>
      <p className="mt-3 font-medium">No publishing history yet</p>
      <p className="mt-1 text-sm text-muted-foreground">Published and failed posts will appear here.</p>
    </CardContent></Card>
  );
  return (
    <Card className="border-border/60 bg-card">
      <CardContent className="p-0">
        <div className="grid grid-cols-12 gap-3 border-b border-border/60 px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          <div className="col-span-6">Content</div><div className="col-span-3">Publish date</div><div className="col-span-2">Post ID</div><div className="col-span-1 text-right">Status</div>
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
            <div className="col-span-3 text-xs text-muted-foreground">{i.publishedAt?fmtDT(i.publishedAt):fmtDT(i.scheduledAt)}</div>
            <div className="col-span-2">
              {i.externalPostId
                ?<a href={`https://www.fanvue.com/post/${i.externalPostId}`} target="_blank" rel="noopener noreferrer"
                    className="truncate font-mono text-[11px] text-primary hover:underline flex items-center gap-1" onClick={e=>e.stopPropagation()}>
                    {i.externalPostId.slice(0,10)}… <ExternalLink className="h-3 w-3 flex-shrink-0"/>
                  </a>
                :<span className="font-mono text-[11px] text-muted-foreground">—</span>}
            </div>
            <div className="col-span-1 flex items-center justify-end gap-2">
              <StatusBadge status={i.status}/>
              {i.status==="failed"&&<Button size="icon" variant="ghost" className="h-7 w-7" onClick={e=>{e.stopPropagation();onRetry(i.id);}}><RefreshCw className="h-3.5 w-3.5"/></Button>}
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
function EmptyState({onSchedule,message="No scheduled content."}:{onSchedule:()=>void;message?:string}){
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
function DetailSheet({item,onClose,fanvueToken,onRetry,onPublishNow,onRemove,onManualPost}:{
  item:ScheduledItem|null;onClose:()=>void;fanvueToken:StoredToken|null;
  onRetry:(id:string)=>void;onPublishNow:(id:string)=>void;onRemove:(id:string)=>void;
  onManualPost:()=>void;
}){
  return (
    <Sheet open={!!item} onOpenChange={o=>!o&&onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {item&&(<>
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">{item.contentName} <StatusBadge status={item.status}/></SheetTitle>
            <SheetDescription>{item.character} · {item.type} · {fmtDT(item.scheduledAt)}</SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-6">
            <div className="relative aspect-video overflow-hidden rounded-lg bg-muted">
              {item.type==="video"
                ?<video src={item.mediaUrl||item.thumbnail} controls playsInline className="h-full w-full object-cover"/>
                :<img src={item.mediaUrl||item.thumbnail} alt="" className="h-full w-full object-cover"/>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Scheduled"         value={fmtDT(item.scheduledAt)}/>
              <Field label="Connected account" value={fanvueToken?`${fanvueToken.name} (@${fanvueToken.handle})`:"Not connected"}/>
              <Field label="Media URL"         value={item.mediaUrl?"✓ Available":"✗ Missing"}/>
              <Field label="Review status"     value="Approved"/>
            </div>
            {!item.mediaUrl&&(
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
                <AlertTriangle className="h-4 w-4 text-destructive mt-px flex-shrink-0"/>
                <p className="text-xs text-destructive">No media URL — check the {item.type==="image"?"image_url":"video_url"} column in Supabase for this record.</p>
              </div>
            )}
            {/* Media URL copyable */}
            {item.mediaUrl&&(
              <div className="space-y-1.5">
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Media URL (copy for manual post)</p>
                <div className="flex items-center gap-2">
                  <Input readOnly value={item.mediaUrl} className="font-mono text-xs bg-muted/40 flex-1"/>
                  <Button size="sm" variant="outline" onClick={async()=>{await navigator.clipboard.writeText(item.mediaUrl);toast.success("URL copied!");}}><Copy className="h-3.5 w-3.5"/></Button>
                </div>
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
              <ScrollArea className="h-32 rounded-md border border-border bg-background/40 p-3">
                <ol className="space-y-2 text-xs">{item.scenePrompts.map((p,idx)=><li key={idx} className="leading-relaxed"><span className="mr-1 text-muted-foreground">{idx+1}.</span>{p}</li>)}</ol>
              </ScrollArea>
            </div>
            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">History</p>
              <ol className="relative space-y-3 border-l border-border pl-4">
                {item.history.map((h,idx)=>(
                  <li key={idx} className="relative">
                    <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-primary ring-4 ring-background"/>
                    <p className="text-xs font-medium">{h.label}</p>
                    <p className="text-[11px] text-muted-foreground">{fmtDT(h.at)}</p>
                  </li>
                ))}
              </ol>
            </div>
            <Separator/>
            <div className="flex flex-wrap items-center gap-2">
              {item.status==="failed"
                ?<Button size="sm" className="gap-2" onClick={()=>onRetry(item.id)}><RefreshCw className="h-4 w-4"/> Retry</Button>
                :item.status!=="published"
                  ?<Button size="sm" className="gap-2" onClick={()=>onPublishNow(item.id)} disabled={item.status==="publishing"||!item.mediaUrl||!fanvueToken}>
                      {item.status==="publishing"?<Loader2 className="h-4 w-4 animate-spin"/>:<Send className="h-4 w-4"/>}
                      {item.status==="publishing"?"Publishing…":"Auto-publish to Fanvue"}
                    </Button>
                  :null}
              <Button size="sm" variant="outline" className="gap-2" onClick={onManualPost}><Link2 className="h-4 w-4"/> Post via URL</Button>
              <Button size="sm" variant="outline" className="gap-2 text-destructive hover:text-destructive" onClick={()=>onRemove(item.id)}><Trash2 className="h-4 w-4"/> Remove</Button>
            </div>
          </div>
        </>)}
      </SheetContent>
    </Sheet>
  );
}

function Field({label,value,mono}:{label:string;value:string;mono?:boolean}){
  return (
    <div className="rounded-md border border-border bg-background/40 p-3">
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-sm",mono&&"font-mono text-xs break-all")}>{value}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Create schedule dialog
// ─────────────────────────────────────────────────────────────────────────────
function CreateScheduleDialog({open,onOpenChange,fanvueToken}:{open:boolean;onOpenChange:(o:boolean)=>void;fanvueToken:StoredToken|null}){
  const queryClient=useQueryClient();
  const {data:assets=[]}=useQuery({queryKey:["approved-assets"],queryFn:fetchApprovedAssets,enabled:open});
  const [contentIdx,setContentIdx]=useState("0");
  const [date,setDate]=useState(()=>{const d=new Date();d.setDate(d.getDate()+1);return d.toISOString().slice(0,10);});
  const [time,setTime]=useState("18:00");
  const submit=async()=>{
    const asset=assets[Number(contentIdx)];
    if(!asset){toast.error("Pick an approved asset first");return;}
    const iso=new Date(`${date}T${time}:00`).toISOString();
    try{
      const{data:userRes}=await supabase.auth.getUser();
      await scheduleService.create({content_type:asset.type,content_id:asset.id,publish_time:iso,platform:"Fanvue",status:"scheduled",created_by:userRes.user?.id??null} as any);
      toast.success("Content scheduled");
      queryClient.invalidateQueries({queryKey:["schedules"]});
      onOpenChange(false);
    }catch(e:any){toast.error(e?.message??"Failed to schedule");}
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Schedule content</DialogTitle><DialogDescription>Queue an approved asset for publishing to Fanvue.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Content</Label>
            {assets.length===0
              ?<p className="rounded-md border border-dashed border-border bg-muted/30 p-3 text-xs text-muted-foreground">No approved content yet. Approve items in Review Queue first.</p>
              :<Select value={contentIdx} onValueChange={setContentIdx}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{assets.map((a,idx)=><SelectItem key={a.id} value={String(idx)}>{a.name}</SelectItem>)}</SelectContent></Select>}
          </div>
          <div className="space-y-1.5">
            <Label>Publishing account</Label>
            {fanvueToken
              ?<div className="flex items-center gap-2 rounded-md border border-border bg-card/50 px-3 py-2">
                  <span className="h-2 w-2 rounded-full bg-success flex-shrink-0"/><span className="text-sm font-medium">{fanvueToken.name}</span><span className="text-xs text-muted-foreground">@{fanvueToken.handle}</span>
                </div>
              :<div className="rounded-md border border-dashed border-border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground mb-2">No Fanvue account connected yet.</p>
                  <Button size="sm" className="gap-2 w-full" onClick={()=>{onOpenChange(false);startFanvueOAuth();}}><ExternalLink className="h-3.5 w-3.5"/> Connect Fanvue Account</Button>
                </div>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Date</Label><Input type="date" value={date} onChange={e=>setDate(e.target.value)}/></div>
            <div className="space-y-1.5"><Label>Time</Label><Input type="time" value={time} onChange={e=>setTime(e.target.value)}/></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={()=>onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} className="gap-2" disabled={!assets.length||!fanvueToken}><CalendarPlus className="h-4 w-4"/> Schedule</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
