import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLila } from "@/hooks/use-lila";
import {
  characterService,
  sceneTemplateService,
  promptTemplateService,
  intensityPresetService,
} from "@/services";
import {
  Sparkles,
  Layers,
  MapPin,
  ShieldCheck,
  Camera,
  Heart,
  Save,
  Plus,
  Hash,
  Wand2,
  BookOpen,
  Building2,
  Briefcase,
  Sofa,
  ChefHat,
  BedDouble,
  Store,
  PartyPopper,
  Plane,
  Trees,
  Flame,
  Crown,
  Settings2,
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
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/characters")({
  head: () => ({
    meta: [
      { title: "Character Manager — Lila Studio" },
      {
        name: "description",
        content:
          "Manage Lila's persona, identity, prompt templates, scene library, and generation defaults.",
      },
    ],
  }),
  component: CharactersPage,
});

// ---------------- Mock data ----------------

const TRAITS = ["Playful", "Seductive", "Confident", "Luxury lifestyle"] as const;

const SCENE_CATEGORIES = [
  { key: "apartment", label: "Apartment", icon: Building2 },
  { key: "kitchen", label: "Kitchen", icon: ChefHat },
  { key: "living", label: "Living Room", icon: Sofa },
  { key: "bedroom", label: "Bedroom", icon: BedDouble },
  { key: "work", label: "Work", icon: Briefcase },
  { key: "workplace", label: "Workplace", icon: Briefcase },
  { key: "secondary", label: "Additional Workspace", icon: Briefcase },
  { key: "storefront", label: "Storefront", icon: Store },
] as const;

const FUTURE_THEMES = [
  { key: "club", label: "Club Nights", icon: PartyPopper },
  { key: "vacations", label: "Vacations", icon: Plane },
  { key: "parties", label: "Apartment Parties", icon: Flame },
  { key: "park", label: "Park Days with Apollo", icon: Trees },
] as const;

const HASHTAGS = ["#LUNALUXE", "#ItalianFire", "#SexyAndUnapologetic"];

// ---------------- Helpers ----------------

const intensityBadgeClass = (intensity: string) => {
  switch (intensity) {
    case "SFW":
      return "border-chart-2/40 bg-chart-2/15 text-chart-2";
    case "Edge-of-SFW":
      return "border-warning/40 bg-warning/15 text-warning";
    case "NSFW Teaser":
      return "border-primary/40 bg-primary/15 text-primary";
    case "PPV":
      return "border-chart-4/40 bg-chart-4/15 text-chart-4";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
};

// ---------------- Page ----------------

function CharactersPage() {
  const { data: lila } = useLila();
  const queryClient = useQueryClient();

  const DEFAULT_PERSONA = {
    traits: [...TRAITS] as string[],
    writingStyle:
      "First-person, sensory, Italian-tinged. Short flirtatious lines mixed with longer poetic beats. Never desperate.",
    captionTone:
      "Warm, confident, playful. Italian phrases sprinkled. Always feels like a private message to one person.",
    brandVoice:
      "LUNA LUXE — Italian fire meets Boston loft. Luxury lingerie lifestyle. Brand always feels like Lila's world.",
    description:
      lila?.description ??
      "Lila is a 28-year-old Italian-born creative director living in a Boston loft with Apollo, her yellow lab.",
  };
  const DEFAULT_DEFAULTS = {
    fps: 16, framesPerScene: 257, samplingSteps: 29, sceneCount: 10,
    negativePrompt: "deformed face, extra fingers, plastic skin, identity drift, watermark, low quality, blurry, distorted anatomy",
  };
  const DEFAULT_MEMORY = {
    locations: "", themes: "", lifestyle: "", pet: "", brand: "",
  };

  const [persona, setPersona] = useState(DEFAULT_PERSONA);
  const [defaults, setDefaults] = useState(DEFAULT_DEFAULTS);
  const [memory, setMemory] = useState(DEFAULT_MEMORY);

  // Hydrate from Supabase when Lila loads
  useEffect(() => {
    if (!lila) return;
    const p = (lila.persona as any) ?? {};
    setPersona({
      traits: (lila.personality_traits?.length ? lila.personality_traits : TRAITS) as string[],
      writingStyle: p.writingStyle ?? DEFAULT_PERSONA.writingStyle,
      captionTone: p.captionTone ?? DEFAULT_PERSONA.captionTone,
      brandVoice: p.brandVoice ?? DEFAULT_PERSONA.brandVoice,
      description: lila.description ?? DEFAULT_PERSONA.description,
    });
    const d = (lila.generation_defaults as any) ?? {};
    setDefaults({
      fps: d.fps ?? 16,
      framesPerScene: d.framesPerScene ?? 257,
      samplingSteps: d.samplingSteps ?? 29,
      sceneCount: d.numScenes ?? d.sceneCount ?? 10,
      negativePrompt: d.negativePrompt ?? DEFAULT_DEFAULTS.negativePrompt,
    });
    const m = (lila.memory as any) ?? {};
    setMemory({
      locations: m.locations ?? "",
      themes: m.themes ?? "",
      lifestyle: m.lifestyle ?? "",
      pet: m.pet ?? "",
      brand: m.brand ?? "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lila?.id]);

  const characterId = lila?.id;

  const { data: scenes = [] } = useQuery({
    queryKey: ["scene-templates", characterId],
    queryFn: () => sceneTemplateService.list(characterId!),
    enabled: !!characterId,
  });
  const { data: prompts = [] } = useQuery({
    queryKey: ["prompt-templates", characterId],
    queryFn: () => promptTemplateService.list(characterId!),
    enabled: !!characterId,
  });
  const { data: presets = [] } = useQuery({
    queryKey: ["intensity-presets", characterId],
    queryFn: () => intensityPresetService.list(characterId!),
    enabled: !!characterId,
  });

  const saveCharacter = async () => {
    if (!characterId) { toast.error("Lila character not loaded yet"); return; }
    try {
      await characterService.update(characterId, {
        description: persona.description,
        personality_traits: persona.traits,
        persona: {
          writingStyle: persona.writingStyle,
          captionTone: persona.captionTone,
          brandVoice: persona.brandVoice,
        } as any,
        generation_defaults: {
          fps: defaults.fps,
          framesPerScene: defaults.framesPerScene,
          samplingSteps: defaults.samplingSteps,
          numScenes: defaults.sceneCount,
          negativePrompt: defaults.negativePrompt,
        } as any,
        memory: memory as any,
      });
      toast.success("Character profile saved");
      queryClient.invalidateQueries({ queryKey: ["character", "lila"] });
    } catch (e: any) { toast.error(e?.message ?? "Failed to save"); }
  };

  const stats = [
    { label: "Scene Templates", value: String(scenes.length), hint: "in library", icon: Layers, accent: "chart-4" as const },
    { label: "Prompt Templates", value: String(prompts.length), hint: "ready to fire", icon: Sparkles, accent: "primary" as const },
    { label: "Intensity Presets", value: String(presets.length), hint: "Tones bundled", icon: MapPin, accent: "chart-3" as const },
  ];

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="bg-aurora">
        <AppHeader />
        <main className="flex-1 space-y-8 p-4 md:p-8">
          <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 sm:flex sm:flex-wrap sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                <Crown className="h-3.5 w-3.5 text-primary" />
                Source of truth
              </div>
              <h1 className="mt-2 truncate font-display text-2xl font-semibold sm:text-3xl">
                Character Manager
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Persona, identity, scene library and generation defaults for Lila.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button size="sm" onClick={saveCharacter}>
                <Save className="mr-2 h-4 w-4" /> Save changes
              </Button>
            </div>
          </header>

          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {stats.map((s) => (<DashboardCard key={s.label} {...s} />))}
          </section>

          <IdentitySection />

          <ConsistencySection />

          <Tabs defaultValue="scenes" className="w-full">
            <TabsList className="bg-card/60">
              <TabsTrigger value="scenes">Scene Library</TabsTrigger>
              <TabsTrigger value="prompts">Prompt Templates</TabsTrigger>
              <TabsTrigger value="video10">10-Scene Video</TabsTrigger>
              <TabsTrigger value="presets">Intensity Presets</TabsTrigger>
              <TabsTrigger value="defaults">Generation Defaults</TabsTrigger>
            </TabsList>

            <TabsContent value="scenes" className="mt-6"><SceneLibrary scenes={scenes} /></TabsContent>
            <TabsContent value="prompts" className="mt-6"><PromptLibrary prompts={prompts} /></TabsContent>
            <TabsContent value="video10" className="mt-6"><VideoSceneTemplateLibrary /></TabsContent>
            <TabsContent value="presets" className="mt-6"><PresetLibrary presets={presets} /></TabsContent>
            <TabsContent value="defaults" className="mt-6">
              <DefaultsPanel defaults={defaults} setDefaults={setDefaults} />
            </TabsContent>
          </Tabs>

          <ReviewCaptionsSection />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}



// ---------------- Sections ----------------

function IdentitySection() {
  const facts = [
    { label: "Name", value: "Lila Valentina Rossi" },
    { label: "Age", value: "28" },
    { label: "Role", value: "Creative Director — LUNA LUXE" },
    { label: "Origin", value: "Born in Italy · Boston loft" },
    { label: "Pet", value: "Apollo · Yellow Labrador" },
    { label: "Bio Tone", value: "Luxury lingerie · girlfriend experience" },
  ];

  return (
    <Card className="overflow-hidden border-border/60 bg-card/80 backdrop-blur">
      <CardContent className="grid grid-cols-1 gap-0 p-0 lg:grid-cols-[360px_1fr]">
        <div className="relative h-[420px] lg:h-auto">
          <img
            src="https://huggingface.co/buckets/KKKONNK/used123/resolve/Screenshot%202026-06-30%20144020.png?download=true"
            alt="Lila Valentina Rossi — primary identity reference"
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-card via-card/10 to-transparent" />
          <div className="absolute bottom-4 left-4 right-4">
            <Badge className="border-primary/30 bg-primary/15 text-primary">
              <ShieldCheck className="mr-1 h-3 w-3" /> Primary identity reference
            </Badge>
          </div>
        </div>

        <div className="space-y-6 p-6 md:p-8">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                <Heart className="h-3.5 w-3.5 text-primary" />
                Identity Profile
              </div>
              <h2 className="mt-2 truncate font-display text-3xl font-semibold">
                Lila Valentina Rossi
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Italian fire, Boston loft. Luxury lingerie lifestyle.
              </p>
            </div>
            <Button variant="outline" size="sm" className="shrink-0">
              <Camera className="mr-2 h-4 w-4" /> Replace reference
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {facts.map((f) => (
              <div
                key={f.label}
                className="rounded-lg border border-border/60 bg-background/40 p-3"
              >
                <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  {f.label}
                </div>
                <div className="mt-1 text-sm font-medium">{f.value}</div>
              </div>
            ))}
          </div>

          <div>
            <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
              <Hash className="h-3.5 w-3.5" /> Brand hashtags
            </div>
            <div className="flex flex-wrap gap-2">
              {HASHTAGS.map((h) => (
                <Badge
                  key={h}
                  variant="outline"
                  className="border-primary/30 bg-primary/10 text-primary"
                >
                  {h}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ConsistencySection() {
  const items = [
    {
      label: "Face Consistency",
      status: "Enabled",
      desc: "Reference image locked across all generations.",
      ok: true,
    },
    {
      label: "Identity Conditioning",
      status: "Ready",
      desc: "Embedding loaded into the generation pipeline.",
      ok: true,
    },
    {
      label: "Reference Conditioning",
      status: "Supported",
      desc: "ReferenceNet + IP-Adapter handoff configured.",
      ok: true,
    },
  ];
  return (
    <Card className="border-border/60 bg-card/80">
      <CardContent className="space-y-5 p-6 md:p-8">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-success" />
          <h3 className="font-display text-lg font-semibold">
            Identity Consistency
          </h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Lila must remain visually consistent across every image and video the
          studio generates.
        </p>
        <div className="space-y-3">
          {items.map((it) => (
            <div
              key={it.label}
              className="rounded-xl border border-border/60 bg-background/40 p-4"
            >
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">{it.label}</div>
                <Badge className="border-success/30 bg-success/15 text-success">
                  {it.status}
                </Badge>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">{it.desc}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

type SceneRow = {
  id: string; category: string; label: string; description: string | null;
  intensity: string; prompt: string;
};

function SceneLibrary({ scenes }: { scenes: SceneRow[] }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display text-lg font-semibold">Scene Template Library</h3>
          <p className="text-sm text-muted-foreground">Reusable environments for every drop and PPV cycle.</p>
        </div>
        <Button size="sm" disabled>
          <Plus className="mr-2 h-4 w-4" /> New scene
        </Button>
      </div>

      <div>
        <div className="mb-3 flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
          <MapPin className="h-3.5 w-3.5" /> Categories
        </div>
        <div className="flex flex-wrap gap-2">
          {SCENE_CATEGORIES.map((c) => (
            <Badge key={c.key} variant="outline" className="gap-1.5 border-border bg-background/40 text-foreground">
              <c.icon className="h-3 w-3 text-primary" />
              {c.label}
            </Badge>
          ))}
          {FUTURE_THEMES.map((c) => (
            <Badge key={c.key} variant="outline" className="gap-1.5 border-dashed border-border text-muted-foreground">
              <c.icon className="h-3 w-3" />
              {c.label}
              <span className="ml-1 text-[9px] uppercase tracking-wider">soon</span>
            </Badge>
          ))}
        </div>
      </div>

      {scenes.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border/60 bg-muted/20 p-8 text-center text-sm text-muted-foreground">
          No scene templates yet. They'll appear here once added to the database.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {scenes.map((s) => (
            <Card key={s.id} className="group border-border/60 bg-card/80 transition hover:border-primary/40">
              <CardContent className="space-y-3 p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      {SCENE_CATEGORIES.find((c) => c.key === s.category)?.label ?? s.category}
                    </div>
                    <div className="mt-1 truncate font-medium">{s.label}</div>
                  </div>
                  <Badge variant="outline" className={intensityBadgeClass(s.intensity)}>{s.intensity}</Badge>
                </div>
                {s.description && <p className="text-xs text-muted-foreground">{s.description}</p>}
                <div className="rounded-lg border border-border/60 bg-background/40 p-3">
                  <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Default prompt</div>
                  <p className="line-clamp-3 text-xs text-foreground/80">{s.prompt}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}


type PromptRow = {
  id: string; name: string; prompt: string; caption_direction: string | null; intensity: string | null;
};

function PromptLibrary({ prompts }: { prompts: PromptRow[] }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display text-lg font-semibold">Prompt Template Library</h3>
          <p className="text-sm text-muted-foreground">Ready-to-fire scaffolds for recurring drops.</p>
        </div>
        <Button size="sm" disabled>
          <Plus className="mr-2 h-4 w-4" /> New template
        </Button>
      </div>

      {prompts.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border/60 bg-muted/20 p-8 text-center text-sm text-muted-foreground">
          No prompt templates yet.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {prompts.map((p) => (
            <Card key={p.id} className="border-border/60 bg-card/80">
              <CardContent className="space-y-3 p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium">{p.name}</div>
                  {p.intensity && (
                    <Badge variant="outline" className={intensityBadgeClass(p.intensity)}>{p.intensity}</Badge>
                  )}
                </div>
                <div className="rounded-lg border border-border/60 bg-background/40 p-3">
                  <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    <Wand2 className="h-3 w-3" /> Prompt template
                  </div>
                  <p className="line-clamp-3 text-xs">{p.prompt}</p>
                </div>
                {p.caption_direction && (
                  <div className="rounded-lg border border-border/60 bg-background/40 p-3">
                    <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      <BookOpen className="h-3 w-3" /> Caption direction
                    </div>
                    <p className="line-clamp-2 text-xs text-muted-foreground">{p.caption_direction}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

const VIDEO10_STORAGE_KEY = "lila_video_10scene_template";
const MAX_VIDEO_SCENES = 10;

type VideoSceneEntry = { id: string; title: string; prompt: string };

const DEFAULT_VIDEO_SCENES: VideoSceneEntry[] = [
  { id: "v1",  title: "Scene 1 — Wake",        prompt: " Medium-wide cinematic shot of Lila Valentina Rossi completely nude under large rain showerhead, water cascading sensually over her voluptuous tanned body with long wavy dark hair, seductive smile looking at camera, golden hour light from window " },
  { id: "v2",  title: "Scene 2 — Kitchen",     prompt: " Close-up shot as she slowly caresses and squeezes her large full breasts, water droplets running down her hard nipples, sensual expression on her face  " },
  { id: "v3",  title: "Scene 3 — Mirror",      prompt: "Lila  reaches down with one hand and starts rubbing her wet pussy, legs slightly spread, steam rising in the luxurious marble shower, body glistening with water  ." },
  { id: "v4",  title: "Scene 4 — Closet",      prompt: " Intense close-up of two fingers sliding deep in and out of her vagina, water mixing with her juices, highly detailed wet sin texture and realistic motion  ." },
  { id: "v5",  title: "Scene 5 — Commute",     prompt: "Lila  arches her back against the marble wall in pleasure, breasts pushed forward, moaning expression on her face with eyes half closed ." },
  { id: "v6",  title: "Scene 6 — Studio Desk", prompt: "Lila Legs spread wider as she fingers herself faster, body moving rhythmically, cinematic side lighting highlighting her curves and wet skin " },
  { id: "v7",  title: "Scene 7 — Fitting",     prompt:  Lila Valentina Rossi standing completely naked in front of a large elegant bedroom mirror with soft warm lighting, taking a seductive selfie with her phone, perfect hourglass figure on full display." },
  { id: "v8",  title: "Scene 8 — Golden Hour", prompt: "Lila Valentina Rossi completely nude leaning on a luxurious marble kitchen island with Boston skyline visible through large windows, golden hour warm light illuminating her body  " },
  { id: "v9",  title: "Scene 9 — Evening",     prompt: " Post-orgasm, she gently touches her sensitive swollen pussy, breathing heavily with a satisfied glowing expression" },
  { id: "v10", title: "Scene 10 — Goodnight",  prompt: " Dramatic cinematic wide shot of Lila Valentina Rossi completely nude on a luxurious penthouse balcony at night, city lights twinkling in the background, strong chiaroscuro lighting with moonlight highlighting her curves ." },
];

function loadVideoScenes(): VideoSceneEntry[] {
  try {
    const raw = localStorage.getItem(VIDEO10_STORAGE_KEY);
    if (!raw) return DEFAULT_VIDEO_SCENES;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? parsed.slice(0, MAX_VIDEO_SCENES) : DEFAULT_VIDEO_SCENES;
  } catch {
    return DEFAULT_VIDEO_SCENES;
  }
}

function VideoSceneTemplateLibrary() {
  const [scenesList, setScenesList] = useState<VideoSceneEntry[]>(() => loadVideoScenes());
  const [dirty, setDirty] = useState(false);

  const updateScene = (id: string, patch: Partial<VideoSceneEntry>) => {
    setScenesList((list) => list.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    setDirty(true);
  };

  const addScene = () => {
    if (scenesList.length >= MAX_VIDEO_SCENES) {
      toast.error(`Max ${MAX_VIDEO_SCENES} scenes per video template`);
      return;
    }
    const n = scenesList.length + 1;
    setScenesList((list) => [...list, { id: `v${Date.now()}`, title: `Scene ${n}`, prompt: "" }]);
    setDirty(true);
  };

  const removeScene = (id: string) => {
    setScenesList((list) => list.filter((s) => s.id !== id));
    setDirty(true);
  };

  const save = () => {
    try {
      localStorage.setItem(VIDEO10_STORAGE_KEY, JSON.stringify(scenesList));
      setDirty(false);
      toast.success("10-scene video template saved");
    } catch {
      toast.error("Failed to save — check browser storage");
    }
  };

  const resetToDefaults = () => {
    setScenesList(DEFAULT_VIDEO_SCENES);
    setDirty(true);
  };

  const copyAll = async () => {
    const combined = scenesList
      .map((s, i) => `${i + 1}. ${s.title}: ${s.prompt}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(combined);
      toast.success("All scene prompts copied");
    } catch {
      toast.error("Clipboard copy failed");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-semibold">10-Scene Video Prompt Template</h3>
          <p className="text-sm text-muted-foreground">
            One continuous video built from up to {MAX_VIDEO_SCENES} scene prompts, fired in order.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="border-border bg-background/40 text-muted-foreground">
            {scenesList.length} / {MAX_VIDEO_SCENES} scenes
          </Badge>
          <Button size="sm" variant="outline" onClick={copyAll}>Copy all</Button>
          <Button size="sm" variant="outline" onClick={resetToDefaults}>Reset</Button>
          <Button size="sm" onClick={save} disabled={!dirty}>
            <Save className="mr-2 h-3.5 w-3.5" /> Save template
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        {scenesList.map((s, i) => (
          <Card key={s.id} className="border-border/60 bg-card/80">
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center gap-3">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-primary/30 bg-primary/10 text-xs font-semibold text-primary">
                  {i + 1}
                </span>
                <Input
                  value={s.title}
                  onChange={(e) => updateScene(s.id, { title: e.target.value })}
                  className="h-8 max-w-xs text-sm font-medium"
                  placeholder={`Scene ${i + 1} title`}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  className="ml-auto h-7 w-7 text-destructive hover:text-destructive"
                  onClick={() => removeScene(s.id)}
                  title="Remove scene"
                >
                  ×
                </Button>
              </div>
              <Textarea
                rows={2}
                value={s.prompt}
                onChange={(e) => updateScene(s.id, { prompt: e.target.value })}
                placeholder="Describe this scene — setting, action, lighting, mood…"
                className="text-xs"
              />
            </CardContent>
          </Card>
        ))}
      </div>

      <Button
        size="sm"
        variant="outline"
        className="gap-2"
        onClick={addScene}
        disabled={scenesList.length >= MAX_VIDEO_SCENES}
      >
        <Plus className="h-3.5 w-3.5" /> Add scene ({scenesList.length}/{MAX_VIDEO_SCENES})
      </Button>
    </div>
  );
}


  id: string; key: string; label: string;
  prompt_style: string | null; caption_style: string | null; negative_prompt: string | null;
};

function PresetLibrary({ presets }: { presets: PresetRow[] }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display text-lg font-semibold">Content Intensity Presets</h3>
          <p className="text-sm text-muted-foreground">One-tap tone, prompt and negative-prompt bundles.</p>
        </div>
        <Button size="sm" variant="outline" disabled>
          <Plus className="mr-2 h-4 w-4" /> New preset
        </Button>
      </div>
      {presets.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border/60 bg-muted/20 p-8 text-center text-sm text-muted-foreground">
          No intensity presets yet.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {presets.map((p) => {
            const tone =
              p.key === "weekday" ? "Edge-of-SFW"
              : p.key === "friday" ? "NSFW Teaser"
              : p.key === "saturday" ? "PPV"
              : "SFW";
            return (
              <Card key={p.id} className="border-border/60 bg-card/80">
                <CardContent className="space-y-3 p-5">
                  <div className="flex items-center justify-between">
                    <div className="font-medium">{p.label}</div>
                    <Badge variant="outline" className={intensityBadgeClass(tone)}>{tone}</Badge>
                  </div>
                  {p.prompt_style && (
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Prompt style</div>
                      <p className="mt-1 text-xs text-foreground/80">{p.prompt_style}</p>
                    </div>
                  )}
                  {p.caption_style && (
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Caption style</div>
                      <p className="mt-1 text-xs text-foreground/80">{p.caption_style}</p>
                    </div>
                  )}
                  {p.negative_prompt && (
                    <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3">
                      <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-destructive/80">Negative prompt</div>
                      <p className="text-[11px] text-foreground/70">{p.negative_prompt}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );

}

function DefaultsPanel({
  defaults,
  setDefaults,
}: {
  defaults: {
    fps: number;
    framesPerScene: number;
    samplingSteps: number;
    sceneCount: number;
    negativePrompt: string;
  };
  setDefaults: React.Dispatch<React.SetStateAction<any>>;
}) {
  const fields: Array<{
    key: "fps" | "framesPerScene" | "samplingSteps" | "sceneCount";
    label: string;
  }> = [
    { key: "fps", label: "FPS" },
    { key: "framesPerScene", label: "Frames per scene" },
    { key: "samplingSteps", label: "Sampling steps" },
    { key: "sceneCount", label: "Default scene count" },
  ];
  return (
    <Card className="border-border/60 bg-card/80">
      <CardContent className="space-y-6 p-6 md:p-8">
        <div className="flex items-center gap-2">
          <Settings2 className="h-5 w-5 text-primary" />
          <h3 className="font-display text-lg font-semibold">
            Generation Defaults
          </h3>
        </div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {fields.map((f) => (
            <div key={f.key} className="space-y-2">
              <Label className="text-xs">{f.label}</Label>
              <Input
                type="number"
                value={defaults[f.key]}
                onChange={(e) =>
                  setDefaults((d: any) => ({
                    ...d,
                    [f.key]: Number(e.target.value),
                  }))
                }
              />
            </div>
          ))}
        </div>
        <Separator />
        <div className="space-y-2">
          <Label>Default negative prompt</Label>
          <Textarea
            rows={3}
            value={defaults.negativePrompt}
            onChange={(e) =>
              setDefaults((d: any) => ({
                ...d,
                negativePrompt: e.target.value,
              }))
            }
          />
        </div>
      </CardContent>
    </Card>
  );
}

type ReviewPostMeta = { postType: "normal" | "ppv"; price: number; caption: string };
const REVIEW_POST_META_KEY = "lila_review_post_meta"; // MUST match review.tsx exactly

function ReviewCaptionsSection() {
  const [entries, setEntries] = useState<Array<{ contentId: string } & ReviewPostMeta>>([]);

  const load = () => {
    try {
      const raw = localStorage.getItem(REVIEW_POST_META_KEY);
      const map: Record<string, ReviewPostMeta> = raw ? JSON.parse(raw) : {};
      const list = Object.entries(map)
        .map(([contentId, meta]) => ({ contentId, ...meta }))
        .filter((e) => e.caption?.trim());
      setEntries(list.slice(-30).reverse());
    } catch {
      setEntries([]);
    }
  };

  useEffect(() => {
    load();
    const onStorage = (e: StorageEvent) => { if (e.key === REVIEW_POST_META_KEY) load(); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return (
    <Card className="border-border/60 bg-card/80">
      <CardContent className="space-y-5 p-6 md:p-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary" />
            <div>
              <h3 className="font-display text-lg font-semibold">Captions from Review</h3>
              <p className="text-xs text-muted-foreground">
                Every caption set on an image or video in the Review Queue, synced here.
              </p>
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={load}>Refresh</Button>
        </div>

        {entries.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border/60 bg-muted/20 p-6 text-center text-sm text-muted-foreground">
            No captions saved yet. Set a caption on an image or video in the Review Queue to see it here.
          </p>
        ) : (
          <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
            {entries.map((e) => (
              <div key={e.contentId} className="rounded-lg border border-border/60 bg-background/40 p-3">
                <div className="flex items-center justify-between gap-2">
                  <Badge
                    variant="outline"
                    className={
                      e.postType === "ppv"
                        ? "border-chart-4/40 bg-chart-4/15 text-chart-4"
                        : "border-border bg-muted text-muted-foreground"
                    }
                  >
                    {e.postType === "ppv" ? `PPV · $${e.price}` : "Normal"}
                  </Badge>
                  <span className="truncate font-mono text-[10px] text-muted-foreground">{e.contentId.slice(0, 8)}</span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-foreground/90">{e.caption}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
