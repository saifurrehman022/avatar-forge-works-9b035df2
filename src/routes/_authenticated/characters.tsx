import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  Sparkles,
  Layers,
  MapPin,
  Mic,
  ShieldCheck,
  Camera,
  Heart,
  Save,
  Plus,
  Edit3,
  Trash2,
  Lock,
  Hash,
  Wand2,
  BookOpen,
  Dog,
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
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";

import lilaAsset from "@/assets/lila-identity.jpg.asset.json";

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

type SceneTemplate = {
  id: string;
  name: string;
  category: string;
  intensity: "SFW" | "Edge-of-SFW" | "NSFW Teaser" | "PPV";
  description: string;
  prompt: string;
};

const SCENE_TEMPLATES: SceneTemplate[] = [
  {
    id: "s1",
    name: "Morning Espresso, Loft Kitchen",
    category: "kitchen",
    intensity: "Edge-of-SFW",
    description:
      "Slow morning in the Boston loft, soft window light, oversized shirt, espresso machine glow.",
    prompt:
      "Lila in her Boston loft kitchen, warm morning light spilling through tall windows, wearing an oversized white shirt and gold necklace, pulling espresso, glossy hair, intimate cinematic 35mm.",
  },
  {
    id: "s2",
    name: "LUNA LUXE Studio Desk",
    category: "workplace",
    intensity: "SFW",
    description:
      "Creative director at her atelier desk — sketches, silk swatches, brand boards.",
    prompt:
      "Lila as creative director at the LUNA LUXE atelier, marble desk, silk lingerie swatches and mood boards, tailored blazer, focused expression, soft daylight, fashion editorial.",
  },
  {
    id: "s3",
    name: "Living Room, Golden Hour",
    category: "living",
    intensity: "Edge-of-SFW",
    description:
      "Curled up on a cream bouclé sofa, Apollo at her feet, vinyl playing.",
    prompt:
      "Lila on cream bouclé sofa in modern loft, golden hour, Apollo the yellow lab resting nearby, soft cashmere set, candid laugh, warm cinematic grade.",
  },
  {
    id: "s4",
    name: "Bedroom Silk Set",
    category: "bedroom",
    intensity: "NSFW Teaser",
    description:
      "Italian silk slip, low key lighting, linen sheets, mirror reflection.",
    prompt:
      "Lila in cream Italian silk slip, low-key bedroom lighting, linen sheets, antique mirror reflection, intimate eye contact, soft film grain.",
  },
  {
    id: "s5",
    name: "Storefront Reveal",
    category: "storefront",
    intensity: "SFW",
    description:
      "Standing in front of the LUNA LUXE Boston boutique window display.",
    prompt:
      "Lila in tailored trench in front of LUNA LUXE Boston boutique, illuminated window display behind her, brick sidewalk, dusk, cinematic.",
  },
  {
    id: "s6",
    name: "Apartment Window Shadows",
    category: "apartment",
    intensity: "NSFW Teaser",
    description: "Sheer curtains, venetian blind shadows across skin.",
    prompt:
      "Lila silhouetted against tall loft windows, venetian blind shadows across skin, sheer curtain, dawn blue tones, painterly noir.",
  },
];

type PromptTemplate = {
  id: string;
  name: string;
  intensity: "SFW" | "Edge-of-SFW" | "NSFW Teaser" | "PPV";
  template: string;
  caption: string;
};

const PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: "p1",
    name: "Morning Home",
    intensity: "Edge-of-SFW",
    template:
      "Lila waking up in her Boston loft, soft morning light, oversized shirt, glossy curls, [SCENE_DETAIL], cinematic 35mm, identity consistent.",
    caption:
      "Soft, flirty, Italian morning energy. Hint of romance. Italian phrase + emoji.",
  },
  {
    id: "p2",
    name: "Workplace",
    intensity: "SFW",
    template:
      "Lila as creative director of LUNA LUXE, [SCENE_DETAIL], tailored fit, editorial styling, confident gaze, fashion magazine lighting.",
    caption:
      "Boss-coded, brand-forward. Drops LUNA LUXE naturally. Confident, never desperate.",
  },
  {
    id: "p3",
    name: "Evening Apartment",
    intensity: "Edge-of-SFW",
    template:
      "Lila at home in her loft after dark, [SCENE_DETAIL], wine glass, candlelight, silk loungewear, warm intimate tone, painterly.",
    caption:
      "Slow, sultry, girlfriend-experience. Asks the audience a question.",
  },
  {
    id: "p4",
    name: "Weekend PPV",
    intensity: "PPV",
    template:
      "Lila in private bedroom session, [SCENE_DETAIL], Italian silk, low-key lighting, intimate gaze, sensual cinematic, identity consistent.",
    caption: "Hook + tease + paywall CTA. Promise an exclusive Saturday drop.",
  },
  {
    id: "p5",
    name: "Good Morning Saturday",
    intensity: "NSFW Teaser",
    template:
      "Lila stretching in bed Saturday morning, [SCENE_DETAIL], soft cotton sheets, sleepy smile, sun across collarbones, intimate handheld feel.",
    caption:
      "Weekend ritual hook. Saturday is for her. Teases the PPV drop later.",
  },
];

type IntensityPreset = {
  id: string;
  name: string;
  promptStyle: string;
  captionStyle: string;
  negativePrompt: string;
};

const INTENSITY_PRESETS: IntensityPreset[] = [
  {
    id: "weekday",
    name: "Weekday Edge-of-SFW",
    promptStyle:
      "Lifestyle, fashion-editorial framing. Suggestive but tasteful. Always covered.",
    captionStyle:
      "Playful, brand-leaning, Italian phrases, emoji-light, story-led.",
    negativePrompt:
      "nudity, explicit, distorted face, extra fingers, watermark, low quality, identity drift",
  },
  {
    id: "friday",
    name: "Friday NSFW Teaser",
    promptStyle:
      "Lingerie-forward, low-key lighting, sensual cinematic. Implied, never explicit.",
    captionStyle:
      "Slower cadence, second-person, romantic tension, hint at PPV drop tomorrow.",
    negativePrompt:
      "explicit nudity, child, distorted face, extra limbs, deformed hands, watermark, identity drift",
  },
  {
    id: "saturday",
    name: "Saturday PPV Video",
    promptStyle:
      "Long-form intimate video, silk + bedroom, cinematic intimate, identity locked.",
    captionStyle:
      "Hook → tease → CTA. Premium, exclusive language. Paywall framing.",
    negativePrompt:
      "explicit underage, deformed face, plastic skin, extra fingers, watermark, identity drift, blurry",
  },
];

const VOICE_FIELDS = [
  { label: "Voice Clone", value: "Lila (custom clone)" },
  { label: "Voice Provider", value: "ElevenLabs" },
  { label: "Speech Style", value: "Warm, slow, flirty" },
  { label: "Accent", value: "Soft Italian-American" },
  { label: "Language", value: "English / Italian" },
  { label: "Voice ID", value: "lila_v1_xxxxxxxx" },
];

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
  const [persona, setPersona] = useState({
    traits: [...TRAITS] as string[],
    writingStyle:
      "First-person, sensory, Italian-tinged. Short flirtatious lines mixed with longer poetic beats. Never desperate.",
    captionTone:
      "Warm, confident, playful. Italian phrases sprinkled. Always feels like a private message to one person.",
    brandVoice:
      "LUNA LUXE — Italian fire meets Boston loft. Luxury lingerie lifestyle. Brand always feels like Lila's world.",
    description:
      "Lila is a 28-year-old Italian-born creative director living in a Boston loft with Apollo, her yellow lab. She built LUNA LUXE from a silk-sketching obsession into a cult luxury lingerie label. Online she's the warm, flirtatious girlfriend who lets you into her world — espresso mornings, silk evenings, and Saturday rituals.",
  });

  const [defaults, setDefaults] = useState({
    fps: 16,
    framesPerScene: 257,
    samplingSteps: 29,
    sceneCount: 10,
    negativePrompt:
      "deformed face, extra fingers, plastic skin, identity drift, watermark, low quality, blurry, distorted anatomy",
  });

  const [memory, setMemory] = useState({
    locations:
      "Boston loft (primary), LUNA LUXE atelier, North End espresso bar, Public Garden, brownstone steps at sunset.",
    themes:
      "Espresso mornings, silk evenings, Saturday rituals, behind-the-scenes at LUNA LUXE, soft Italian nostalgia.",
    lifestyle:
      "Trains 5x/week pilates, reads in bed, hosts intimate dinners, collects vintage gold jewelry.",
    pet:
      "Apollo — yellow lab, 4 years old, sleeps at her feet, frequent supporting character in lifestyle shoots.",
    brand:
      "LUNA LUXE — Italian fire silk lingerie line. Boston flagship. Drops every other Saturday.",
  });

  const stats = [
    {
      label: "Total Templates",
      value: String(PROMPT_TEMPLATES.length + SCENE_TEMPLATES.length),
      hint: "Scene + prompt templates",
      icon: Layers,
      accent: "chart-4" as const,
    },
    {
      label: "Active Presets",
      value: String(INTENSITY_PRESETS.length),
      hint: "Intensity tiers",
      icon: Sparkles,
      accent: "primary" as const,
    },
    {
      label: "Scene Categories",
      value: String(SCENE_CATEGORIES.length),
      hint: `+${FUTURE_THEMES.length} future themes`,
      icon: MapPin,
      accent: "chart-3" as const,
    },
    {
      label: "Voice Profile",
      value: "Pending",
      hint: "Awaiting clone upload",
      icon: Mic,
      accent: "chart-5" as const,
    },
  ];

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="bg-aurora">
        <AppHeader />
        <main className="flex-1 space-y-8 p-4 md:p-8">
          {/* Header */}
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
                Persona, identity, scene library and generation defaults for
                Lila.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="outline" size="sm">
                <Edit3 className="mr-2 h-4 w-4" /> Edit persona
              </Button>
              <Button
                size="sm"
                onClick={() => toast.success("Character profile saved")}
              >
                <Save className="mr-2 h-4 w-4" /> Save changes
              </Button>
            </div>
          </header>

          {/* Stats */}
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {stats.map((s) => (
              <DashboardCard key={s.label} {...s} />
            ))}
          </section>

          {/* Identity */}
          <IdentitySection />

          {/* Persona + Consistency */}
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[2fr_1fr]">
            <PersonaSection persona={persona} setPersona={setPersona} />
            <ConsistencySection />
          </div>

          {/* Tabs: scenes / prompts / presets / defaults */}
          <Tabs defaultValue="scenes" className="w-full">
            <TabsList className="bg-card/60">
              <TabsTrigger value="scenes">Scene Library</TabsTrigger>
              <TabsTrigger value="prompts">Prompt Templates</TabsTrigger>
              <TabsTrigger value="presets">Intensity Presets</TabsTrigger>
              <TabsTrigger value="defaults">Generation Defaults</TabsTrigger>
            </TabsList>

            <TabsContent value="scenes" className="mt-6">
              <SceneLibrary />
            </TabsContent>
            <TabsContent value="prompts" className="mt-6">
              <PromptLibrary />
            </TabsContent>
            <TabsContent value="presets" className="mt-6">
              <PresetLibrary />
            </TabsContent>
            <TabsContent value="defaults" className="mt-6">
              <DefaultsPanel defaults={defaults} setDefaults={setDefaults} />
            </TabsContent>
          </Tabs>

          {/* Voice (future) + Memory */}
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_1fr]">
            <VoiceProfileSection />
            <MemorySection memory={memory} setMemory={setMemory} />
          </div>
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
            src={lilaAsset.url}
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

function PersonaSection({
  persona,
  setPersona,
}: {
  persona: {
    traits: string[];
    writingStyle: string;
    captionTone: string;
    brandVoice: string;
    description: string;
  };
  setPersona: React.Dispatch<React.SetStateAction<any>>;
}) {
  const toggleTrait = (t: string) => {
    setPersona((p: any) => ({
      ...p,
      traits: p.traits.includes(t)
        ? p.traits.filter((x: string) => x !== t)
        : [...p.traits, t],
    }));
  };

  return (
    <Card className="border-border/60 bg-card/80">
      <CardContent className="space-y-6 p-6 md:p-8">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-display text-lg font-semibold">
              Persona Settings
            </h3>
            <p className="text-sm text-muted-foreground">
              These signals steer every caption, scene, and script.
            </p>
          </div>
          <Sparkles className="h-5 w-5 text-primary" />
        </div>

        <div>
          <Label className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Personality Traits
          </Label>
          <div className="mt-3 flex flex-wrap gap-2">
            {TRAITS.map((t) => {
              const active = persona.traits.includes(t);
              return (
                <button
                  key={t}
                  onClick={() => toggleTrait(t)}
                  className={`rounded-full border px-3 py-1 text-xs transition ${
                    active
                      ? "border-primary/40 bg-primary/15 text-primary"
                      : "border-border bg-background/40 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Writing Style</Label>
            <Textarea
              rows={3}
              value={persona.writingStyle}
              onChange={(e) =>
                setPersona((p: any) => ({ ...p, writingStyle: e.target.value }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label>Caption Tone</Label>
            <Textarea
              rows={3}
              value={persona.captionTone}
              onChange={(e) =>
                setPersona((p: any) => ({ ...p, captionTone: e.target.value }))
              }
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Brand Voice</Label>
            <Textarea
              rows={2}
              value={persona.brandVoice}
              onChange={(e) =>
                setPersona((p: any) => ({ ...p, brandVoice: e.target.value }))
              }
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Persona Description</Label>
            <Textarea
              rows={5}
              value={persona.description}
              onChange={(e) =>
                setPersona((p: any) => ({ ...p, description: e.target.value }))
              }
            />
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

function SceneLibrary() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display text-lg font-semibold">
            Scene Template Library
          </h3>
          <p className="text-sm text-muted-foreground">
            Reusable environments for every drop and PPV cycle.
          </p>
        </div>
        <Button size="sm">
          <Plus className="mr-2 h-4 w-4" /> New scene
        </Button>
      </div>

      <div>
        <div className="mb-3 flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
          <MapPin className="h-3.5 w-3.5" /> Categories
        </div>
        <div className="flex flex-wrap gap-2">
          {SCENE_CATEGORIES.map((c) => (
            <Badge
              key={c.key}
              variant="outline"
              className="gap-1.5 border-border bg-background/40 text-foreground"
            >
              <c.icon className="h-3 w-3 text-primary" />
              {c.label}
            </Badge>
          ))}
          {FUTURE_THEMES.map((c) => (
            <Badge
              key={c.key}
              variant="outline"
              className="gap-1.5 border-dashed border-border text-muted-foreground"
            >
              <c.icon className="h-3 w-3" />
              {c.label}
              <span className="ml-1 text-[9px] uppercase tracking-wider">
                soon
              </span>
            </Badge>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {SCENE_TEMPLATES.map((s) => (
          <Card
            key={s.id}
            className="group border-border/60 bg-card/80 transition hover:border-primary/40"
          >
            <CardContent className="space-y-3 p-5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    {SCENE_CATEGORIES.find((c) => c.key === s.category)?.label ??
                      s.category}
                  </div>
                  <div className="mt-1 truncate font-medium">{s.name}</div>
                </div>
                <Badge
                  variant="outline"
                  className={intensityBadgeClass(s.intensity)}
                >
                  {s.intensity}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">{s.description}</p>
              <div className="rounded-lg border border-border/60 bg-background/40 p-3">
                <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  Default prompt
                </div>
                <p className="line-clamp-3 text-xs text-foreground/80">
                  {s.prompt}
                </p>
              </div>
              <div className="flex justify-end gap-1 opacity-0 transition group-hover:opacity-100">
                <Button size="sm" variant="ghost">
                  <Edit3 className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="ghost">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function PromptLibrary() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display text-lg font-semibold">
            Prompt Template Library
          </h3>
          <p className="text-sm text-muted-foreground">
            Ready-to-fire scaffolds for recurring drops.
          </p>
        </div>
        <Button size="sm">
          <Plus className="mr-2 h-4 w-4" /> New template
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {PROMPT_TEMPLATES.map((p) => (
          <Card key={p.id} className="border-border/60 bg-card/80">
            <CardContent className="space-y-3 p-5">
              <div className="flex items-start justify-between gap-2">
                <div className="font-medium">{p.name}</div>
                <Badge
                  variant="outline"
                  className={intensityBadgeClass(p.intensity)}
                >
                  {p.intensity}
                </Badge>
              </div>
              <div className="rounded-lg border border-border/60 bg-background/40 p-3">
                <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  <Wand2 className="h-3 w-3" /> Prompt template
                </div>
                <p className="line-clamp-3 text-xs">{p.template}</p>
              </div>
              <div className="rounded-lg border border-border/60 bg-background/40 p-3">
                <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  <BookOpen className="h-3 w-3" /> Caption direction
                </div>
                <p className="line-clamp-2 text-xs text-muted-foreground">
                  {p.caption}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function PresetLibrary() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display text-lg font-semibold">
            Content Intensity Presets
          </h3>
          <p className="text-sm text-muted-foreground">
            One-tap tone, prompt and negative-prompt bundles.
          </p>
        </div>
        <Button size="sm" variant="outline">
          <Plus className="mr-2 h-4 w-4" /> New preset
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {INTENSITY_PRESETS.map((p) => (
          <Card
            key={p.id}
            className="border-border/60 bg-card/80"
          >
            <CardContent className="space-y-3 p-5">
              <div className="flex items-center justify-between">
                <div className="font-medium">{p.name}</div>
                <Badge
                  variant="outline"
                  className={intensityBadgeClass(
                    p.id === "weekday"
                      ? "Edge-of-SFW"
                      : p.id === "friday"
                        ? "NSFW Teaser"
                        : "PPV",
                  )}
                >
                  {p.id === "weekday"
                    ? "Edge-of-SFW"
                    : p.id === "friday"
                      ? "NSFW Teaser"
                      : "PPV"}
                </Badge>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  Prompt style
                </div>
                <p className="mt-1 text-xs text-foreground/80">
                  {p.promptStyle}
                </p>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  Caption style
                </div>
                <p className="mt-1 text-xs text-foreground/80">
                  {p.captionStyle}
                </p>
              </div>
              <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3">
                <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-destructive/80">
                  Negative prompt
                </div>
                <p className="text-[11px] text-foreground/70">
                  {p.negativePrompt}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
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

function VoiceProfileSection() {
  return (
    <Card className="relative overflow-hidden border-border/60 bg-card/60">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-chart-2/5" />
      <CardContent className="relative space-y-5 p-6 md:p-8">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10">
              <Mic className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="font-display text-lg font-semibold">
                Voice Profile
              </h3>
              <p className="text-xs text-muted-foreground">
                Future: voice chat + script narration automation
              </p>
            </div>
          </div>
          <Badge
            variant="outline"
            className="gap-1 border-warning/40 bg-warning/10 text-warning"
          >
            <Lock className="h-3 w-3" /> Coming soon
          </Badge>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {VOICE_FIELDS.map((v) => (
            <div
              key={v.label}
              className="rounded-lg border border-dashed border-border/60 bg-background/30 p-3 opacity-70"
            >
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                {v.label}
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                {v.value}
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between rounded-xl border border-border/60 bg-background/40 p-4">
          <div className="flex items-center gap-3">
            <Mic className="h-4 w-4 text-muted-foreground" />
            <div>
              <div className="text-sm font-medium">Enable voice automation</div>
              <div className="text-xs text-muted-foreground">
                Wire ElevenLabs clone into captions + scripts
              </div>
            </div>
          </div>
          <Switch disabled />
        </div>
      </CardContent>
    </Card>
  );
}

function MemorySection({
  memory,
  setMemory,
}: {
  memory: {
    locations: string;
    themes: string;
    lifestyle: string;
    pet: string;
    brand: string;
  };
  setMemory: React.Dispatch<React.SetStateAction<any>>;
}) {
  const fields: Array<{
    key: keyof typeof memory;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { key: "locations", label: "Favorite Locations", icon: MapPin },
    { key: "themes", label: "Recurring Themes", icon: Sparkles },
    { key: "lifestyle", label: "Lifestyle Notes", icon: Heart },
    { key: "pet", label: "Pet Information", icon: Dog },
    { key: "brand", label: "Brand Context", icon: Crown },
  ];

  return (
    <Card className="border-border/60 bg-card/80">
      <CardContent className="space-y-5 p-6 md:p-8">
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-primary" />
          <h3 className="font-display text-lg font-semibold">Memory</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Persistent context for future caption + script generation.
        </p>
        <div className="space-y-4">
          {fields.map((f) => (
            <div key={f.key} className="space-y-2">
              <Label className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                <f.icon className="h-3.5 w-3.5 text-primary" />
                {f.label}
              </Label>
              <Textarea
                rows={2}
                value={memory[f.key]}
                onChange={(e) =>
                  setMemory((m: any) => ({ ...m, [f.key]: e.target.value }))
                }
              />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
