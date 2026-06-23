import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
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
} from "lucide-react";
import { toast } from "sonner";

import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { AppHeader } from "@/components/dashboard/app-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { generationService } from "@/services/generationService";
import { useLila } from "@/hooks/use-lila";
import { useAuth } from "@/hooks/use-auth";
import { Separator } from "@/components/ui/separator";

export const Route = createFileRoute("/_authenticated/generate")({
  head: () => ({
    meta: [
      { title: "Content Generation — Lila Studio" },
      {
        name: "description",
        content:
          "Generate AI videos and images for Lila — configure reference frames, scenes, sampling, and dispatch to the RunPod pipeline.",
      },
    ],
  }),
  component: GeneratePage,
});

type Scene = { id: string; prompt: string };

const RECOMMENDED = {
  fps: 16,
  framesPerScene: 257,
  numScenes: 10,
  samplingSteps: 29,
};

const SAMPLE_PROMPTS = [
  "Lila walks into a sunlit Tokyo cafe, warm tones, soft bokeh.",
  "Close-up portrait, gentle smile, natural window light.",
  "She picks up a ceramic cup, steam rising, cinematic shallow depth.",
  "Wide shot of cafe interior, golden hour, film grain.",
  "Lila looks out the window, contemplative, rain on glass.",
  "She turns to camera, soft laugh, lens flare.",
  "Detail shot of hands holding cup, warm rim light.",
  "Standing up, smoothing skirt, smooth tracking shot.",
  "Walking toward the door, back-lit silhouette.",
  "Exiting onto the street, neon reflections at dusk.",
];

const newId = () => Math.random().toString(36).slice(2, 10);

function makeDefaultScenes(): Scene[] {
  return Array.from({ length: RECOMMENDED.numScenes }, (_, i) => ({
    id: newId(),
    prompt: SAMPLE_PROMPTS[i] ?? "",
  }));
}

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
                <div className="mt-6">
                  <GenerationTabs />
                </div>
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
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Studio
        </p>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight md:text-4xl">
          Content Generation
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Compose a multi-scene video or image batch and dispatch it to the RunPod pipeline.
        </p>
      </div>
      <span className="mt-4 inline-flex items-center gap-1.5 self-start rounded-full border border-border bg-card/60 px-2.5 py-1 text-xs text-muted-foreground md:mt-0">
        <span className="h-1.5 w-1.5 rounded-full bg-success shadow-[0_0_8px_var(--success)]" />
        RunPod · 3 workers idle
      </span>
    </div>
  );
}

function GenerationTabs() {
  return (
    <Tabs defaultValue="video" className="w-full">
      <TabsList className="grid w-full max-w-md grid-cols-2">
        <TabsTrigger value="video" className="gap-2">
          <Video className="h-4 w-4" /> Video Generation
        </TabsTrigger>
        <TabsTrigger value="image" className="gap-2">
          <ImageLucide className="h-4 w-4" /> Image Generation
        </TabsTrigger>
      </TabsList>

      <TabsContent value="video" className="mt-6">
        <VideoGenerationTab />
      </TabsContent>

      <TabsContent value="image" className="mt-6">
        <ImageGenerationPlaceholder />
      </TabsContent>
    </Tabs>
  );
}

function VideoGenerationTab() {
  const [refImage, setRefImage] = useState<{ url: string; name: string } | null>(null);
  const [fps, setFps] = useState(RECOMMENDED.fps);
  const [framesPerScene, setFramesPerScene] = useState(RECOMMENDED.framesPerScene);
  const [samplingSteps, setSamplingSteps] = useState(RECOMMENDED.samplingSteps);
  const [scenes, setScenes] = useState<Scene[]>(() => makeDefaultScenes());
  const [negative, setNegative] = useState(
    "low quality, blurry, distorted face, extra fingers, watermark, text, logo"
  );
  const [submitting, setSubmitting] = useState(false);
  const { data: lila } = useLila();
  const { user } = useAuth();

  const addScene = () =>
    setScenes((s) => [...s, { id: newId(), prompt: "" }]);
  const removeScene = (id: string) =>
    setScenes((s) => (s.length > 1 ? s.filter((x) => x.id !== id) : s));
  const updateScene = (id: string, prompt: string) =>
    setScenes((s) => s.map((x) => (x.id === id ? { ...x, prompt } : x)));
  const moveScene = (id: string, dir: -1 | 1) =>
    setScenes((s) => {
      const i = s.findIndex((x) => x.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= s.length) return s;
      const copy = [...s];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });

  const totalFrames = useMemo(
    () => scenes.length * framesPerScene,
    [scenes.length, framesPerScene]
  );
  const durationSec = useMemo(
    () => (fps > 0 ? totalFrames / fps : 0),
    [totalFrames, fps]
  );

  const onGenerate = async () => {
    if (!user) {
      toast.error("You must be signed in to queue a job.");
      return;
    }
    setSubmitting(true);
    try {
      await generationService.enqueue({
        type: "video",
        character_id: lila?.id ?? null,
        created_by: user.id,
        status: "queued",
        input_payload: {
          fps,
          framesPerScene,
          samplingSteps,
          numScenes: scenes.length,
          totalFrames,
          durationSec,
          referenceImageName: refImage?.name ?? null,
          scenes: scenes.map((s) => s.prompt),
          negativePrompt: negative,
        },
      });
      toast.success("Generation job queued", {
        description: `${scenes.length} scenes · ${totalFrames.toLocaleString()} frames · ~${durationSec.toFixed(1)}s`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to queue job";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const canGenerate = !!refImage && scenes.every((s) => s.prompt.trim().length > 0);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="flex flex-col gap-6 lg:col-span-2">
        <ReferenceImageCard image={refImage} setImage={setRefImage} />
        <SettingsCard
          fps={fps}
          setFps={setFps}
          framesPerScene={framesPerScene}
          setFramesPerScene={setFramesPerScene}
          numScenes={scenes.length}
          samplingSteps={samplingSteps}
          setSamplingSteps={setSamplingSteps}
        />
        <SceneBuilder
          scenes={scenes}
          addScene={addScene}
          removeScene={removeScene}
          updateScene={updateScene}
          moveScene={moveScene}
        />
        <NegativePromptCard value={negative} onChange={setNegative} />
      </div>

      <div className="flex flex-col gap-6 lg:col-span-1">
        <SummaryPanel
          refImage={refImage}
          totalScenes={scenes.length}
          fps={fps}
          framesPerScene={framesPerScene}
          samplingSteps={samplingSteps}
          totalFrames={totalFrames}
          durationSec={durationSec}
          canGenerate={canGenerate}
          submitting={submitting}
          onGenerate={onGenerate}
        />
      </div>
    </div>
  );
}

/* ---------- Reference Image ---------- */

function ReferenceImageCard({
  image,
  setImage,
}: {
  image: { url: string; name: string } | null;
  setImage: (v: { url: string; name: string } | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleFile = (file: File | undefined | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please upload an image file");
      return;
    }
    const url = URL.createObjectURL(file);
    setImage({ url, name: file.name });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="font-display text-lg">Reference Image</CardTitle>
            <CardDescription>
              Upload the reference image that will be used to maintain character consistency.
            </CardDescription>
          </div>
          <span className="rounded-full border border-border bg-card/60 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            Step 1
          </span>
        </div>
      </CardHeader>
      <CardContent>
        {!image ? (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              handleFile(e.dataTransfer.files?.[0]);
            }}
            className={`group relative flex h-56 w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed transition-colors ${
              dragging
                ? "border-primary bg-primary/5"
                : "border-border bg-muted/20 hover:bg-muted/30"
            }`}
          >
            <div className="grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary">
              <Upload className="h-5 w-5" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium">Drop image here or click to upload</p>
              <p className="mt-1 text-xs text-muted-foreground">
                PNG, JPG, or WEBP · up to 20MB
              </p>
            </div>
          </button>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_auto]">
            <div className="relative overflow-hidden rounded-xl border border-border bg-muted/20">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image.url}
                alt={image.name}
                className="h-56 w-full object-cover"
              />
            </div>
            <div className="flex flex-col justify-between gap-3 md:w-56">
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                  Selected
                </p>
                <p className="mt-1 truncate text-sm font-medium">{image.name}</p>
                <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[11px] text-success">
                  <Check className="h-3 w-3" /> Ready
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <Button
                  variant="secondary"
                  className="justify-start gap-2"
                  onClick={() => inputRef.current?.click()}
                >
                  <Replace className="h-4 w-4" /> Replace image
                </Button>
                <Button
                  variant="ghost"
                  className="justify-start gap-2 text-destructive hover:text-destructive"
                  onClick={() => setImage(null)}
                >
                  <X className="h-4 w-4" /> Remove image
                </Button>
              </div>
            </div>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
      </CardContent>
    </Card>
  );
}

/* ---------- Settings ---------- */

function NumberField({
  label,
  value,
  onChange,
  recommended,
  min = 1,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  recommended: number;
  min?: number;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
        <button
          type="button"
          onClick={() => onChange(recommended)}
          className="text-[10px] uppercase tracking-wider text-muted-foreground transition-colors hover:text-primary"
        >
          Rec · {recommended}
        </button>
      </div>
      <Input
        type="number"
        min={min}
        value={value}
        onChange={(e) =>
          onChange(Math.max(min, Number(e.target.value) || min))
        }
      />
    </div>
  );
}

function SettingsCard({
  fps,
  setFps,
  framesPerScene,
  setFramesPerScene,
  numScenes,
  samplingSteps,
  setSamplingSteps,
}: {
  fps: number;
  setFps: (n: number) => void;
  framesPerScene: number;
  setFramesPerScene: (n: number) => void;
  numScenes: number;
  samplingSteps: number;
  setSamplingSteps: (n: number) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="font-display text-lg">Generation Settings</CardTitle>
            <CardDescription>
              Tune the pipeline. Recommended values are pre-filled for the RunPod default profile.
            </CardDescription>
          </div>
          <span className="rounded-full border border-border bg-card/60 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            Step 2
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <NumberField label="FPS" value={fps} onChange={setFps} recommended={RECOMMENDED.fps} />
          <NumberField
            label="Frames Per Scene"
            value={framesPerScene}
            onChange={setFramesPerScene}
            recommended={RECOMMENDED.framesPerScene}
          />
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium text-muted-foreground">
                Number of Scenes
              </Label>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Auto
              </span>
            </div>
            <Input type="number" value={numScenes} readOnly className="opacity-70" />
          </div>
          <NumberField
            label="Sampling Steps"
            value={samplingSteps}
            onChange={setSamplingSteps}
            recommended={RECOMMENDED.samplingSteps}
          />
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------- Scene Builder ---------- */

function SceneBuilder({
  scenes,
  addScene,
  removeScene,
  updateScene,
  moveScene,
}: {
  scenes: Scene[];
  addScene: () => void;
  removeScene: (id: string) => void;
  updateScene: (id: string, p: string) => void;
  moveScene: (id: string, d: -1 | 1) => void;
}) {
  const configuredCount = scenes.filter((s) => s.prompt.trim().length > 0).length;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="font-display text-lg">Scene Builder</CardTitle>
            <CardDescription>
              Each scene becomes a clip stitched into the final video.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden rounded-full border border-border bg-card/60 px-2.5 py-1 text-xs text-muted-foreground sm:inline">
              {configuredCount} / {scenes.length} configured
            </span>
            <Button size="sm" variant="secondary" onClick={addScene} className="gap-1.5">
              <Plus className="h-4 w-4" /> Add Scene
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {scenes.map((scene, idx) => (
          <div
            key={scene.id}
            className="rounded-xl border border-border bg-card/40 p-4 transition-colors hover:border-primary/40"
          >
            <div className="flex items-start gap-3">
              <div className="flex flex-col items-center gap-1">
                <div className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-primary/20 to-chart-4/20 font-display text-sm font-semibold text-primary">
                  {String(idx + 1).padStart(2, "0")}
                </div>
                <div className="flex flex-col">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={() => moveScene(scene.id, -1)}
                    disabled={idx === 0}
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={() => moveScene(scene.id, 1)}
                    disabled={idx === scenes.length - 1}
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <div className="flex-1 space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium text-muted-foreground">
                    Scene {idx + 1} prompt
                  </Label>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => removeScene(scene.id)}
                    disabled={scenes.length <= 1}
                    aria-label="Remove scene"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <Textarea
                  rows={2}
                  placeholder="Describe the action, framing, lighting, and mood…"
                  value={scene.prompt}
                  onChange={(e) => updateScene(scene.id, e.target.value)}
                  className="resize-none"
                />
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/* ---------- Negative Prompt ---------- */

function NegativePromptCard({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-lg">Negative Prompt</CardTitle>
        <CardDescription>
          Describe elements that should not appear in the generated video.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Textarea
          rows={4}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g. blurry, low quality, watermark, distorted hands…"
        />
      </CardContent>
    </Card>
  );
}

/* ---------- Summary Panel ---------- */

function SummaryRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-sm font-medium ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

function SummaryPanel({
  refImage,
  totalScenes,
  fps,
  framesPerScene,
  samplingSteps,
  totalFrames,
  durationSec,
  canGenerate,
  submitting,
  onGenerate,
}: {
  refImage: { url: string; name: string } | null;
  totalScenes: number;
  fps: number;
  framesPerScene: number;
  samplingSteps: number;
  totalFrames: number;
  durationSec: number;
  canGenerate: boolean;
  submitting: boolean;
  onGenerate: () => void;
}) {
  return (
    <Card className="sticky top-24 overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />
      <CardHeader>
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <CardTitle className="font-display text-lg">Generation Summary</CardTitle>
        </div>
        <CardDescription>Live preview of the job that will be queued.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/20 p-3">
          <div className="grid h-12 w-12 place-items-center overflow-hidden rounded-md border border-border bg-card">
            {refImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={refImage.url} alt="" className="h-full w-full object-cover" />
            ) : (
              <ImageIconLucide className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {refImage ? refImage.name : "No reference selected"}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {refImage ? "Character anchor ready" : "Upload a reference to continue"}
            </p>
          </div>
        </div>

        <Separator className="my-4" />

        <div className="divide-y divide-border">
          <SummaryRow label="Total Scenes" value={totalScenes} mono />
          <SummaryRow label="FPS" value={fps} mono />
          <SummaryRow label="Frames Per Scene" value={framesPerScene} mono />
          <SummaryRow label="Sampling Steps" value={samplingSteps} mono />
          <SummaryRow
            label="Total Frames"
            value={totalFrames.toLocaleString()}
            mono
          />
          <SummaryRow
            label="Est. Duration"
            value={`~${durationSec.toFixed(1)}s`}
            mono
          />
        </div>

        <Button
          size="lg"
          className="mt-5 w-full gap-2 bg-gradient-to-r from-primary to-chart-4 text-primary-foreground shadow-[0_10px_30px_-10px_var(--primary)] hover:opacity-95"
          onClick={onGenerate}
          disabled={!canGenerate || submitting}
        >
          <Wand2 className="h-4 w-4" />
          {submitting ? "Queueing job…" : "Generate Video"}
        </Button>
        {!canGenerate && (
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            Add a reference image and fill every scene prompt to enable.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------- Image Tab Placeholder ---------- */

function ImageGenerationPlaceholder() {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center gap-3 py-20 text-center">
        <div className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-primary/20 to-chart-4/20 text-primary">
          <ImageLucide className="h-6 w-6" />
        </div>
        <h3 className="font-display text-xl font-semibold tracking-tight">
          Image Generation Module — Coming Soon
        </h3>
        <p className="max-w-md text-sm text-muted-foreground">
          The image batch composer is on the roadmap. For now, dispatch single frames via the
          Video tab using a single scene.
        </p>
      </CardContent>
    </Card>
  );
}
