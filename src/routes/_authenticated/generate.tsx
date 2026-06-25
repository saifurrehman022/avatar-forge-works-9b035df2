import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import {
  Upload,
  ImageIcon as ImageIconLucide,
  X,
  Replace,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Sparkles,
  Video,
  Image as ImageLucide,
  Check,
  Wand2,
  Loader2,
  Download,
  Copy,
  ExternalLink,
  AlertCircle,
  Clock,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { AppHeader } from "@/components/dashboard/app-header";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/generate")({
  head: () => ({
    meta: [
      { title: "Content Generation — Lila Studio" },
      { name: "description", content: "Generate AI videos and images for Lila." },
    ],
  }),
  component: GeneratePage,
});

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const RUNPOD_API_KEY      = import.meta.env.VITE_RUNPOD_API_KEY as string;
const RUNPOD_ENDPOINT_ID  = import.meta.env.VITE_RUNPOD_ENDPOINT_ID as string;
const RUNPOD_IMAGE_ENDPOINT_ID = import.meta.env.VITE_RUNPOD_IMAGE_ENDPOINT_ID as string ?? "qwen-image-edit-2511-lora";
const RUNPOD_BASE         = `https://api.runpod.ai/v2/${RUNPOD_ENDPOINT_ID}`;
const RUNPOD_IMAGE_BASE   = `https://api.runpod.ai/v2/${RUNPOD_IMAGE_ENDPOINT_ID}`;

const JOB_STORAGE_KEY     = "lila_video_job";
const IMAGE_JOB_STORAGE_KEY = "lila_image_job";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type Scene = { id: string; prompt: string };
type JobStatus = "idle" | "submitting" | "queued" | "in_progress" | "completed" | "failed";

interface VideoJobState {
  status: JobStatus;
  jobId: string | null;
  progress: number;
  progressLabel: string;
  elapsedSec: number;
  startedAt: number | null;
  finalVideoUrl: string | null;
  chunkUrls: string[];
  error: string | null;
}

interface ImageJobState {
  status: JobStatus;
  jobId: string | null;
  elapsedSec: number;
  startedAt: number | null;
  resultUrl: string | null;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const RECOMMENDED = { fps: 16, framesPerScene: 162, numScenes: 10, samplingSteps: 6 };

const SAMPLE_PROMPTS = [
  "A stable medium-wide shot. She reaches down and opens a notebook, sketching a butterfly. The lines begin to glow with golden light.",
  "A fixed wide shot. A glowing golden butterfly rises from the notebook pages, fluttering upward. She watches in awe.",
  "A stable medium shot. The butterfly swoops down and lands on her nose, morphing into a pencil sketch on her skin.",
  "A clear stable shot. She turns to a new page and a fresh drawing of magical creatures lifts off in 3D form.",
  "A wide cinematic shot. Golden swirls erupt from the open book, filling the room with volumetric lighting and stardust.",
  "A stable wide shot. She stands up and dances joyfully alongside floating animated paper origami creatures.",
  "A continuous medium-wide shot. Floating paper drawings descend and transform into miniature animals at her feet.",
  "A stable medium close-up. She holds her finger steady as a glowing paper bird softly lands on her fingertip.",
  "A grand wide-angle tracking shot. The bedroom walls dissolve into a vast surreal forest of living notebook pages.",
  "A final stable medium shot. She snaps the notebook shut. The paper forest dissolves and golden stardust settles.",
];

const GENERATION_STEPS = [
  "Job submitted to RunPod",
  "Workers initialising",
  "Loading models into GPU",
  "Generating scene batch 1",
  "Generating scene batch 2",
  "Generating scene batch 3",
  "Stitching final video",
  "Uploading to storage",
  "Complete",
];

const INITIAL_VIDEO_JOB: VideoJobState = {
  status: "idle", jobId: null, progress: 0, progressLabel: "",
  elapsedSec: 0, startedAt: null, finalVideoUrl: null, chunkUrls: [], error: null,
};

const INITIAL_IMAGE_JOB: ImageJobState = {
  status: "idle", jobId: null, elapsedSec: 0, startedAt: null, resultUrl: null, error: null,
};

const newId = () => Math.random().toString(36).slice(2, 10);
function makeDefaultScenes(): Scene[] {
  return Array.from({ length: RECOMMENDED.numScenes }, (_, i) => ({ id: newId(), prompt: SAMPLE_PROMPTS[i] ?? "" }));
}

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------
function saveJob<T>(key: string, job: T) {
  try { localStorage.setItem(key, JSON.stringify(job)); } catch {}
}

function loadJob<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch { return fallback; }
}

function clearJob(key: string) {
  try { localStorage.removeItem(key); } catch {}
}

// ---------------------------------------------------------------------------
// RunPod API helpers
// ---------------------------------------------------------------------------
async function rpFetch(url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RUNPOD_API_KEY}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`RunPod ${res.status}: ${t}`); }
  return res.json();
}

async function submitVideoJob(input: object): Promise<string> {
  const data = await rpFetch(`${RUNPOD_BASE}/run`, { method: "POST", body: JSON.stringify({ input }) });
  if (!data.id) throw new Error("No job ID returned from RunPod");
  return data.id as string;
}

async function submitImageJob(input: object): Promise<string> {
  const data = await rpFetch(`${RUNPOD_IMAGE_BASE}/run`, { method: "POST", body: JSON.stringify({ input }) });
  if (!data.id) throw new Error("No job ID returned from RunPod");
  return data.id as string;
}

async function pollVideo(jobId: string) {
  return rpFetch(`${RUNPOD_BASE}/status/${jobId}`);
}

async function pollImage(jobId: string) {
  return rpFetch(`${RUNPOD_IMAGE_BASE}/status/${jobId}`);
}

// ---------------------------------------------------------------------------
// Page shell
// ---------------------------------------------------------------------------
function GeneratePage() {
  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background text-foreground">
        <AppSidebar />
        <SidebarInset className="flex min-w-0 flex-1 flex-col">
          <AppHeader />
          <main className="flex-1">
            <div className="bg-aurora">
              <div className="mx-auto w-full max-w-7xl px-4 py-8 md:px-8">
                <PageHeading />
                <div className="mt-6"><GenerationTabs /></div>
              </div>
            </div>
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}

function PageHeading() {
  return (
    <div className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Studio</p>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight md:text-4xl">Content Generation</h1>
        <p className="mt-1 text-sm text-muted-foreground">Compose a multi-scene video or AI image and dispatch it to the RunPod pipeline.</p>
      </div>
      <span className="mt-4 inline-flex items-center gap-1.5 self-start rounded-full border border-border bg-card/60 px-2.5 py-1 text-xs text-muted-foreground md:mt-0">
        <span className="h-1.5 w-1.5 rounded-full bg-success shadow-[0_0_8px_var(--success)]" />
        RunPod · {RUNPOD_ENDPOINT_ID?.slice(0, 8) ?? "not set"}
      </span>
    </div>
  );
}

function GenerationTabs() {
  return (
    <Tabs defaultValue="video" className="w-full">
      <TabsList className="grid w-full max-w-md grid-cols-2">
        <TabsTrigger value="video" className="gap-2"><Video className="h-4 w-4" /> Video Generation</TabsTrigger>
        <TabsTrigger value="image" className="gap-2"><ImageLucide className="h-4 w-4" /> Image Generation</TabsTrigger>
      </TabsList>
      <TabsContent value="video" className="mt-6"><VideoGenerationTab /></TabsContent>
      <TabsContent value="image" className="mt-6"><ImageGenerationTab /></TabsContent>
    </Tabs>
  );
}

// ---------------------------------------------------------------------------
// Video Generation Tab
// ---------------------------------------------------------------------------
function VideoGenerationTab() {
  const [refImage, setRefImage] = useState<{ url: string; name: string; file: File } | null>(null);
  const [fps, setFps] = useState(RECOMMENDED.fps);
  const [framesPerScene, setFramesPerScene] = useState(RECOMMENDED.framesPerScene);
  const [samplingSteps, setSamplingSteps] = useState(RECOMMENDED.samplingSteps);
  const [scenes, setScenes] = useState<Scene[]>(() => makeDefaultScenes());
  const [negative, setNegative] = useState("extreme close-up, macro shot, static image, text, watermark, bad anatomy, deformed, blurry, low quality, sudden cuts, flickering artifacts");

  // Load persisted job on mount
  const [job, setJobRaw] = useState<VideoJobState>(() => {
    const saved = loadJob<VideoJobState>(JOB_STORAGE_KEY, INITIAL_VIDEO_JOB);
    // Only restore if it was running or completed
    if (["queued", "in_progress", "completed", "failed"].includes(saved.status)) return saved;
    return INITIAL_VIDEO_JOB;
  });

  const setJob = (updater: VideoJobState | ((prev: VideoJobState) => VideoJobState)) => {
    setJobRaw((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      saveJob(JOB_STORAGE_KEY, next);
      return next;
    });
  };

  const timerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(job.startedAt ?? 0);
  const pollRef    = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTimer = () => { if (timerRef.current) clearInterval(timerRef.current); };
  const stopPoll  = () => { if (pollRef.current)  clearInterval(pollRef.current); };

  // Resume polling if job was in progress when page was closed
  useEffect(() => {
    if (job.jobId && (job.status === "queued" || job.status === "in_progress")) {
      startTimeRef.current = job.startedAt ?? Date.now();
      startPollingVideo(job.jobId);
      timerRef.current = setInterval(() => {
        const elapsed = Math.round((Date.now() - startTimeRef.current) / 1000);
        setJob((j) => ({ ...j, elapsedSec: elapsed }));
      }, 1000);
    }
    return () => { stopTimer(); stopPoll(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getStepFromElapsed = useCallback((elapsed: number) => {
    if (elapsed < 60) return 2;
    if (elapsed < 120) return 3;
    if (elapsed < 600) return 4;
    if (elapsed < 1200) return 5;
    if (elapsed < 1800) return 6;
    return 7;
  }, []);

  function startPollingVideo(jobId: string) {
    pollRef.current = setInterval(async () => {
      try {
        const data = await pollVideo(jobId);
        const elapsed = Math.round((Date.now() - startTimeRef.current) / 1000);
        if (data.status === "IN_QUEUE") {
          setJob((j) => ({ ...j, status: "queued", progress: 8, progressLabel: "Waiting in queue…" }));
        } else if (data.status === "IN_PROGRESS") {
          const stepIdx = getStepFromElapsed(elapsed);
          const pct = Math.min(85, 12 + stepIdx * 11);
          setJob((j) => ({ ...j, status: "in_progress", progress: pct, progressLabel: GENERATION_STEPS[stepIdx] ?? "Generating…" }));
        } else if (data.status === "COMPLETED") {
          stopPoll(); stopTimer();
          const out = data.output;
          const videoUrl = out?.final_video_url;
          if (!videoUrl) {
            setJob((j) => ({ ...j, status: "failed", error: "No video URL in response." }));
            return;
          }
          setJob((j) => ({ ...j, status: "completed", progress: 100, progressLabel: "Complete!", finalVideoUrl: videoUrl, chunkUrls: out?.chunk_urls ?? [] }));
          toast.success("Video ready!");
        } else if (data.status === "FAILED") {
          stopPoll(); stopTimer();
          const errMsg = data.error ?? data.output?.error ?? "Job failed on RunPod";
          setJob((j) => ({ ...j, status: "failed", error: errMsg }));
          toast.error("Generation failed", { description: errMsg });
        }
      } catch (e) { console.warn("Poll error:", e); }
    }, 4000);
  }

  const onGenerate = async () => {
    if (!RUNPOD_API_KEY || !RUNPOD_ENDPOINT_ID) { toast.error("RunPod not configured. Set VITE_RUNPOD_API_KEY and VITE_RUNPOD_ENDPOINT_ID."); return; }
    if (!refImage) { toast.error("Upload a reference image first."); return; }
    if (!scenes.every((s) => s.prompt.trim().length > 0)) { toast.error("Fill in all scene prompts."); return; }

    setJob({ ...INITIAL_VIDEO_JOB, status: "submitting", progressLabel: "Submitting job to RunPod…" });

    let imageInput: { image_url?: string; images?: { name: string; image: string }[] } = {};
    if (refImage.url.startsWith("blob:")) {
      const b64 = await new Promise<string>((res, rej) => {
        const reader = new FileReader();
        reader.onload = () => res((reader.result as string).split(",")[1]);
        reader.onerror = rej;
        reader.readAsDataURL(refImage.file);
      });
      imageInput = { images: [{ name: refImage.name, image: b64 }] };
    } else {
      imageInput = { image_url: refImage.url };
    }

    const input = { ...imageInput, fps, frames_per_scene: framesPerScene, num_scenes: scenes.length, sampling_steps: samplingSteps, prompts: scenes.map((s) => s.prompt), negative_prompt: negative };

    try {
      const jobId = await submitVideoJob(input);
      const now = Date.now();
      startTimeRef.current = now;
      setJob((j) => ({ ...j, status: "queued", jobId, startedAt: now, progress: 8, progressLabel: "Job queued, waiting for worker…" }));
      toast.success("Job submitted", { description: `ID: ${jobId.slice(0, 12)}…` });

      timerRef.current = setInterval(() => {
        const elapsed = Math.round((Date.now() - startTimeRef.current) / 1000);
        setJob((j) => ({ ...j, elapsedSec: elapsed }));
      }, 1000);

      startPollingVideo(jobId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to submit job";
      setJob((j) => ({ ...j, status: "failed", error: msg }));
      toast.error(msg);
    }
  };

  const addScene    = () => setScenes((s) => [...s, { id: newId(), prompt: "" }]);
  const removeScene = (id: string) => setScenes((s) => s.length > 1 ? s.filter((x) => x.id !== id) : s);
  const updateScene = (id: string, prompt: string) => setScenes((s) => s.map((x) => x.id === id ? { ...x, prompt } : x));
  const moveScene   = (id: string, dir: -1 | 1) => setScenes((s) => {
    const i = s.findIndex((x) => x.id === id); const j = i + dir;
    if (i < 0 || j < 0 || j >= s.length) return s;
    const copy = [...s]; [copy[i], copy[j]] = [copy[j], copy[i]]; return copy;
  });

  const totalFrames = useMemo(() => scenes.length * framesPerScene, [scenes.length, framesPerScene]);
  const durationSec = useMemo(() => fps > 0 ? totalFrames / fps : 0, [totalFrames, fps]);
  const isRunning   = ["submitting", "queued", "in_progress"].includes(job.status);
  const canGenerate = !!refImage && scenes.every((s) => s.prompt.trim().length > 0) && !isRunning;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="flex flex-col gap-6 lg:col-span-2">
        <ReferenceImageCard image={refImage} setImage={setRefImage} />
        <SettingsCard fps={fps} setFps={setFps} framesPerScene={framesPerScene} setFramesPerScene={setFramesPerScene} numScenes={scenes.length} samplingSteps={samplingSteps} setSamplingSteps={setSamplingSteps} />
        <SceneBuilder scenes={scenes} addScene={addScene} removeScene={removeScene} updateScene={updateScene} moveScene={moveScene} />
        <NegativePromptCard value={negative} onChange={setNegative} />
        {isRunning && <JobProgressCard job={job} />}
        {job.status === "completed" && job.finalVideoUrl && (
          <VideoResultCard url={job.finalVideoUrl} chunkUrls={job.chunkUrls} elapsedSec={job.elapsedSec} onReset={() => { clearJob(JOB_STORAGE_KEY); setJob(INITIAL_VIDEO_JOB); }} />
        )}
        {job.status === "failed" && job.error && (
          <ErrorCard message={job.error} onRetry={() => { clearJob(JOB_STORAGE_KEY); setJob(INITIAL_VIDEO_JOB); }} />
        )}
      </div>
      <div className="flex flex-col gap-6 lg:col-span-1">
        <VideoSummaryPanel refImage={refImage} totalScenes={scenes.length} fps={fps} framesPerScene={framesPerScene} samplingSteps={samplingSteps} totalFrames={totalFrames} durationSec={durationSec} canGenerate={canGenerate} isRunning={isRunning} job={job} onGenerate={onGenerate} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Image Generation Tab
// ---------------------------------------------------------------------------
function ImageGenerationTab() {
  const [prompt, setPrompt] = useState("A futuristic city with a slightly dark neon atmosphere and glowing street lights. The girl in the foreground, her face and body well lit by the street lighting");
  const [size, setSize] = useState("1024*1024");
  const [seed, setSeed] = useState(-1);

  const [job, setJobRaw] = useState<ImageJobState>(() => {
    const saved = loadJob<ImageJobState>(IMAGE_JOB_STORAGE_KEY, INITIAL_IMAGE_JOB);
    if (["queued", "in_progress", "completed", "failed"].includes(saved.status)) return saved;
    return INITIAL_IMAGE_JOB;
  });

  const setJob = (updater: ImageJobState | ((prev: ImageJobState) => ImageJobState)) => {
    setJobRaw((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      saveJob(IMAGE_JOB_STORAGE_KEY, next);
      return next;
    });
  };

  const timerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(job.startedAt ?? 0);
  const pollRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopTimer  = () => { if (timerRef.current) clearInterval(timerRef.current); };
  const stopPoll   = () => { if (pollRef.current)  clearInterval(pollRef.current); };

  function startPollingImage(jobId: string) {
    pollRef.current = setInterval(async () => {
      try {
        const data = await pollImage(jobId);
        if (data.status === "IN_QUEUE" || data.status === "IN_PROGRESS") {
          setJob((j) => ({ ...j, status: data.status === "IN_QUEUE" ? "queued" : "in_progress" }));
        } else if (data.status === "COMPLETED") {
          stopPoll(); stopTimer();
          // Qwen returns output.image_url or output[0].url depending on version
          const out = data.output;
          const imgUrl = out?.image_url ?? out?.[0]?.url ?? out?.url ?? null;
          if (!imgUrl) { setJob((j) => ({ ...j, status: "failed", error: "No image URL in response." })); return; }
          setJob((j) => ({ ...j, status: "completed", resultUrl: imgUrl }));
          toast.success("Image ready!");
        } else if (data.status === "FAILED") {
          stopPoll(); stopTimer();
          const errMsg = data.error ?? "Image generation failed";
          setJob((j) => ({ ...j, status: "failed", error: errMsg }));
          toast.error(errMsg);
        }
      } catch (e) { console.warn("Image poll error:", e); }
    }, 3000);
  }

  useEffect(() => {
    if (job.jobId && (job.status === "queued" || job.status === "in_progress")) {
      startTimeRef.current = job.startedAt ?? Date.now();
      startPollingImage(job.jobId);
      timerRef.current = setInterval(() => {
        const elapsed = Math.round((Date.now() - startTimeRef.current) / 1000);
        setJob((j) => ({ ...j, elapsedSec: elapsed }));
      }, 1000);
    }
    return () => { stopTimer(); stopPoll(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onGenerate = async () => {
    if (!RUNPOD_API_KEY) { toast.error("Set VITE_RUNPOD_API_KEY in your .env file."); return; }
    if (!prompt.trim()) { toast.error("Enter a prompt."); return; }
    setJob({ ...INITIAL_IMAGE_JOB, status: "submitting" });
    try {
      const input = { enable_base64_output: false, enable_sync_mode: false, output_format: "jpeg", prompt: prompt.trim(), seed, size };
      const jobId = await submitImageJob(input);
      const now = Date.now();
      startTimeRef.current = now;
      setJob((j) => ({ ...j, status: "queued", jobId, startedAt: now }));
      toast.success("Image job submitted", { description: `ID: ${jobId.slice(0, 12)}…` });
      timerRef.current = setInterval(() => {
        const elapsed = Math.round((Date.now() - startTimeRef.current) / 1000);
        setJob((j) => ({ ...j, elapsedSec: elapsed }));
      }, 1000);
      startPollingImage(jobId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to submit image job";
      setJob((j) => ({ ...j, status: "failed", error: msg }));
      toast.error(msg);
    }
  };

  const isRunning = ["submitting", "queued", "in_progress"].includes(job.status);
  const m = Math.floor(job.elapsedSec / 60);
  const s = job.elapsedSec % 60;

  const copyUrl = () => {
    if (job.resultUrl) navigator.clipboard.writeText(job.resultUrl).then(() => toast.success("URL copied"));
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="flex flex-col gap-6 lg:col-span-2">
        {/* Prompt */}
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="font-display text-lg">Image Prompt</CardTitle>
                <CardDescription>Describe the image you want to generate using the Qwen image edit model.</CardDescription>
              </div>
              <span className="rounded-full border border-border bg-card/60 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">Step 1</span>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Prompt</Label>
              <Textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Describe what you want to generate…" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Size</Label>
                <select
                  value={size}
                  onChange={(e) => setSize(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {["512*512","768*768","1024*1024","1024*768","768*1024"].map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium text-muted-foreground">Seed</Label>
                  <button type="button" onClick={() => setSeed(-1)} className="text-[10px] uppercase tracking-wider text-muted-foreground hover:text-primary">Random</button>
                </div>
                <Input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} placeholder="-1 for random" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Progress */}
        {isRunning && (
          <Card className="border-primary/30 bg-primary/5">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <CardTitle className="font-display text-lg">Generating Image</CardTitle>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="font-mono text-xs text-muted-foreground">{m}m {String(s).padStart(2,"0")}s</span>
                  <Badge variant="outline" className="text-xs">{job.status === "queued" ? "Queued" : "Running"}</Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Progress value={job.status === "queued" ? 10 : 60} className="h-2" />
              {job.jobId && <p className="mt-2 text-[11px] text-muted-foreground">Job ID: <span className="font-mono">{job.jobId}</span></p>}
            </CardContent>
          </Card>
        )}

        {/* Result */}
        {job.status === "completed" && job.resultUrl && (
          <Card className="border-success/30">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-success" />
                  <CardTitle className="font-display text-lg">Image Ready</CardTitle>
                </div>
                <Badge variant="outline" className="border-success/40 text-success text-xs">Done in {m}m {s}s</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <img src={job.resultUrl} alt="Generated" className="w-full rounded-xl border border-border object-contain max-h-[600px]" />
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="default" className="gap-2 flex-1">
                  <a href={job.resultUrl} download="lila_generated_image.jpg"><Download className="h-4 w-4" /> Download</a>
                </Button>
                <Button variant="outline" className="gap-2" onClick={copyUrl}><Copy className="h-4 w-4" /> Copy URL</Button>
                <Button variant="outline" className="gap-2" asChild>
                  <a href={job.resultUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4" /> Open</a>
                </Button>
              </div>
              <Button variant="ghost" className="w-full text-muted-foreground" onClick={() => { clearJob(IMAGE_JOB_STORAGE_KEY); setJob(INITIAL_IMAGE_JOB); }}>
                Generate another image
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Error */}
        {job.status === "failed" && job.error && (
          <ErrorCard message={job.error} onRetry={() => { clearJob(IMAGE_JOB_STORAGE_KEY); setJob(INITIAL_IMAGE_JOB); }} />
        )}
      </div>

      {/* Right panel */}
      <div className="lg:col-span-1">
        <Card className="sticky top-24 overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />
          <CardHeader>
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <CardTitle className="font-display text-lg">Image Summary</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-border">
              <SummaryRow label="Model" value="Qwen Image Edit" />
              <SummaryRow label="Size" value={size} mono />
              <SummaryRow label="Seed" value={seed === -1 ? "Random" : seed} mono />
              <SummaryRow label="Format" value="JPEG" mono />
            </div>
            <Button
              size="lg"
              className="mt-5 w-full gap-2 bg-gradient-to-r from-primary to-chart-4 text-primary-foreground shadow-[0_10px_30px_-10px_var(--primary)] hover:opacity-95"
              onClick={onGenerate}
              disabled={!prompt.trim() || isRunning}
            >
              {isRunning ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating…</> : <><Wand2 className="h-4 w-4" /> Generate Image</>}
            </Button>
            {!prompt.trim() && !isRunning && (
              <p className="mt-2 text-center text-[11px] text-muted-foreground">Enter a prompt to enable.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------
function ReferenceImageCard({ image, setImage }: { image: { url: string; name: string; file: File } | null; setImage: (v: { url: string; name: string; file: File } | null) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const handleFile = (file: File | undefined | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Please upload an image file"); return; }
    setImage({ url: URL.createObjectURL(file), name: file.name, file });
  };
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="font-display text-lg">Reference Image</CardTitle>
            <CardDescription>Upload the starting image — used to maintain character consistency across all scenes.</CardDescription>
          </div>
          <span className="rounded-full border border-border bg-card/60 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">Step 1</span>
        </div>
      </CardHeader>
      <CardContent>
        {!image ? (
          <button type="button" onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files?.[0]); }}
            className={`group relative flex h-56 w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed transition-colors ${dragging ? "border-primary bg-primary/5" : "border-border bg-muted/20 hover:bg-muted/30"}`}
          >
            <div className="grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary"><Upload className="h-5 w-5" /></div>
            <div className="text-center">
              <p className="text-sm font-medium">Drop image here or click to upload</p>
              <p className="mt-1 text-xs text-muted-foreground">PNG, JPG, or WEBP · up to 20MB</p>
            </div>
          </button>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_auto]">
            <div className="relative overflow-hidden rounded-xl border border-border bg-muted/20">
              <img src={image.url} alt={image.name} className="h-56 w-full object-cover" />
            </div>
            <div className="flex flex-col justify-between gap-3 md:w-56">
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Selected</p>
                <p className="mt-1 truncate text-sm font-medium">{image.name}</p>
                <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[11px] text-success"><Check className="h-3 w-3" /> Ready</p>
              </div>
              <div className="flex flex-col gap-2">
                <Button variant="secondary" className="justify-start gap-2" onClick={() => inputRef.current?.click()}><Replace className="h-4 w-4" /> Replace image</Button>
                <Button variant="ghost" className="justify-start gap-2 text-destructive hover:text-destructive" onClick={() => setImage(null)}><X className="h-4 w-4" /> Remove image</Button>
              </div>
            </div>
          </div>
        )}
        <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
      </CardContent>
    </Card>
  );
}

function NumberField({ label, value, onChange, recommended, min = 1 }: { label: string; value: number; onChange: (n: number) => void; recommended: number; min?: number }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
        <button type="button" onClick={() => onChange(recommended)} className="text-[10px] uppercase tracking-wider text-muted-foreground transition-colors hover:text-primary">Rec · {recommended}</button>
      </div>
      <Input type="number" min={min} value={value} onChange={(e) => onChange(Math.max(min, Number(e.target.value) || min))} />
    </div>
  );
}

function SettingsCard({ fps, setFps, framesPerScene, setFramesPerScene, numScenes, samplingSteps, setSamplingSteps }: { fps: number; setFps: (n: number) => void; framesPerScene: number; setFramesPerScene: (n: number) => void; numScenes: number; samplingSteps: number; setSamplingSteps: (n: number) => void }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div><CardTitle className="font-display text-lg">Generation Settings</CardTitle><CardDescription>Recommended values are pre-filled for the RunPod pipeline.</CardDescription></div>
          <span className="rounded-full border border-border bg-card/60 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">Step 2</span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <NumberField label="FPS" value={fps} onChange={setFps} recommended={RECOMMENDED.fps} />
          <NumberField label="Frames Per Scene" value={framesPerScene} onChange={setFramesPerScene} recommended={RECOMMENDED.framesPerScene} />
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium text-muted-foreground">Number of Scenes</Label>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Auto</span>
            </div>
            <Input type="number" value={numScenes} readOnly className="opacity-70" />
          </div>
          <NumberField label="Sampling Steps" value={samplingSteps} onChange={setSamplingSteps} recommended={RECOMMENDED.samplingSteps} />
        </div>
      </CardContent>
    </Card>
  );
}

function SceneBuilder({ scenes, addScene, removeScene, updateScene, moveScene }: { scenes: Scene[]; addScene: () => void; removeScene: (id: string) => void; updateScene: (id: string, p: string) => void; moveScene: (id: string, d: -1 | 1) => void }) {
  const configuredCount = scenes.filter((s) => s.prompt.trim().length > 0).length;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div><CardTitle className="font-display text-lg">Scene Builder</CardTitle><CardDescription>Each scene becomes a clip stitched into the final video.</CardDescription></div>
          <div className="flex items-center gap-2">
            <span className="hidden rounded-full border border-border bg-card/60 px-2.5 py-1 text-xs text-muted-foreground sm:inline">{configuredCount} / {scenes.length} configured</span>
            <Button size="sm" variant="secondary" onClick={addScene} className="gap-1.5"><Plus className="h-4 w-4" /> Add Scene</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {scenes.map((scene, idx) => (
          <div key={scene.id} className="rounded-xl border border-border bg-card/40 p-4 transition-colors hover:border-primary/40">
            <div className="flex items-start gap-3">
              <div className="flex flex-col items-center gap-1">
                <div className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-primary/20 to-chart-4/20 font-display text-sm font-semibold text-primary">{String(idx + 1).padStart(2, "0")}</div>
                <div className="flex flex-col">
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => moveScene(scene.id, -1)} disabled={idx === 0}><ArrowUp className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => moveScene(scene.id, 1)} disabled={idx === scenes.length - 1}><ArrowDown className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
              <div className="flex-1 space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium text-muted-foreground">Scene {idx + 1} prompt</Label>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => removeScene(scene.id)} disabled={scenes.length <= 1} aria-label="Remove scene"><Trash2 className="h-4 w-4" /></Button>
                </div>
                <Textarea rows={2} placeholder="Describe the action, framing, lighting, and mood…" value={scene.prompt} onChange={(e) => updateScene(scene.id, e.target.value)} className="resize-none" />
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function NegativePromptCard({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Card>
      <CardHeader><CardTitle className="font-display text-lg">Negative Prompt</CardTitle><CardDescription>Elements that should not appear in the generated video.</CardDescription></CardHeader>
      <CardContent><Textarea rows={3} value={value} onChange={(e) => onChange(e.target.value)} placeholder="e.g. blurry, low quality, watermark, distorted hands…" /></CardContent>
    </Card>
  );
}

function JobProgressCard({ job }: { job: VideoJobState }) {
  const stepIdx = Math.max(0, GENERATION_STEPS.indexOf(job.progressLabel));
  const m = Math.floor(job.elapsedSec / 60);
  const s = job.elapsedSec % 60;
  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin text-primary" /><CardTitle className="font-display text-lg">Generating Video</CardTitle></div>
          <div className="flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-mono text-xs text-muted-foreground">{m}m {String(s).padStart(2, "0")}s</span>
            <Badge variant="outline" className="text-xs">{job.status === "queued" ? "Queued" : job.status === "submitting" ? "Submitting" : "Running"}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="mb-2 flex justify-between text-xs text-muted-foreground"><span>{job.progressLabel || "Initialising…"}</span><span>{job.progress}%</span></div>
          <Progress value={job.progress} className="h-2" />
        </div>
        <div className="space-y-1">
          {GENERATION_STEPS.map((step, i) => {
            const isDone = i < stepIdx; const isActive = i === stepIdx;
            return (
              <div key={step} className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 text-xs transition-colors ${isActive ? "bg-primary/10 font-medium text-primary" : isDone ? "text-muted-foreground" : "text-muted-foreground/40"}`}>
                <div className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${isDone ? "bg-success" : isActive ? "animate-pulse bg-primary" : "bg-muted-foreground/20"}`} />
                {step}
              </div>
            );
          })}
        </div>
        {job.jobId && <p className="text-[11px] text-muted-foreground">Job ID: <span className="font-mono">{job.jobId}</span></p>}
      </CardContent>
    </Card>
  );
}

function VideoResultCard({ url, chunkUrls, elapsedSec, onReset }: { url: string; chunkUrls: string[]; elapsedSec: number; onReset: () => void }) {
  const m = Math.floor(elapsedSec / 60); const s = elapsedSec % 60;
  const copyUrl = () => navigator.clipboard.writeText(url).then(() => toast.success("URL copied to clipboard"));
  return (
    <Card className="border-success/30">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2"><Check className="h-4 w-4 text-success" /><CardTitle className="font-display text-lg">Video Ready</CardTitle></div>
          <Badge variant="outline" className="border-success/40 text-success text-xs">Generated in {m}m {s}s</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <video src={url} controls playsInline className="w-full rounded-xl border border-border bg-black" />
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="default" className="gap-2 flex-1"><a href={url} download="lila_generated_video.mp4"><Download className="h-4 w-4" /> Download video</a></Button>
          <Button variant="outline" className="gap-2" onClick={copyUrl}><Copy className="h-4 w-4" /> Copy URL</Button>
          <Button variant="outline" className="gap-2" asChild><a href={url} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4" /> Open</a></Button>
        </div>
        <div className="rounded-lg border border-border bg-muted/20 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Supabase URL</p>
          <p className="break-all font-mono text-xs text-muted-foreground">{url}</p>
        </div>
        {chunkUrls.length > 1 && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer hover:text-foreground">{chunkUrls.length} batch chunks</summary>
            <div className="mt-2 space-y-1 pl-2">
              {chunkUrls.map((u, i) => (
                <a key={i} href={u} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-primary"><ExternalLink className="h-3 w-3" /> Batch {i + 1}</a>
              ))}
            </div>
          </details>
        )}
        <Button variant="ghost" className="w-full text-muted-foreground" onClick={onReset}>Generate another video</Button>
      </CardContent>
    </Card>
  );
}

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card className="border-destructive/30 bg-destructive/5">
      <CardContent className="flex items-start gap-3 py-5">
        <AlertCircle className="h-5 w-5 flex-shrink-0 text-destructive mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-medium text-destructive">Generation failed</p>
          <p className="mt-1 text-xs text-muted-foreground">{message}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>Dismiss and retry</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SummaryRow({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-sm font-medium ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

function VideoSummaryPanel({ refImage, totalScenes, fps, framesPerScene, samplingSteps, totalFrames, durationSec, canGenerate, isRunning, job, onGenerate }: {
  refImage: { url: string; name: string } | null; totalScenes: number; fps: number; framesPerScene: number; samplingSteps: number; totalFrames: number; durationSec: number; canGenerate: boolean; isRunning: boolean; job: VideoJobState; onGenerate: () => void;
}) {
  return (
    <Card className="sticky top-24 overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />
      <CardHeader>
        <div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /><CardTitle className="font-display text-lg">Generation Summary</CardTitle></div>
        <CardDescription>Live preview of the job configuration.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/20 p-3">
          <div className="grid h-12 w-12 place-items-center overflow-hidden rounded-md border border-border bg-card">
            {refImage ? <img src={refImage.url} alt="" className="h-full w-full object-cover" /> : <ImageIconLucide className="h-5 w-5 text-muted-foreground" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{refImage ? refImage.name : "No reference selected"}</p>
            <p className="text-[11px] text-muted-foreground">{refImage ? "Character anchor ready" : "Upload a reference to continue"}</p>
          </div>
        </div>
        <Separator className="my-4" />
        <div className="divide-y divide-border">
          <SummaryRow label="Total Scenes" value={totalScenes} mono />
          <SummaryRow label="FPS" value={fps} mono />
          <SummaryRow label="Frames Per Scene" value={framesPerScene} mono />
          <SummaryRow label="Sampling Steps" value={samplingSteps} mono />
          <SummaryRow label="Total Frames" value={totalFrames.toLocaleString()} mono />
          <SummaryRow label="Est. Duration" value={`~${durationSec.toFixed(1)}s`} mono />
          <SummaryRow label="Est. Gen Time" value={`~${Math.round(totalScenes * 8 / 60)} min`} mono />
        </div>
        {isRunning && (
          <div className="mt-4 space-y-1.5">
            <div className="flex justify-between text-xs text-muted-foreground"><span>{job.progressLabel || "Running…"}</span><span>{job.progress}%</span></div>
            <Progress value={job.progress} className="h-1.5" />
          </div>
        )}
        <Button size="lg" className="mt-5 w-full gap-2 bg-gradient-to-r from-primary to-chart-4 text-primary-foreground shadow-[0_10px_30px_-10px_var(--primary)] hover:opacity-95" onClick={onGenerate} disabled={!canGenerate || isRunning}>
          {isRunning ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating…</> : <><Wand2 className="h-4 w-4" /> Generate Video</>}
        </Button>
        {!canGenerate && !isRunning && (
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            {!refImage ? "Upload a reference image to enable." : "Fill every scene prompt to enable."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
