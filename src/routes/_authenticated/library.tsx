import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Library as LibraryIcon,
  Image as ImageIcon,
  Video as VideoIcon,
  ClipboardCheck,
  CheckCircle2,
  Search,
  MoreHorizontal,
  Eye,
  Send,
  CalendarPlus,
  Trash2,
  Play,
  Sparkles,
  Film,
  ListFilter,
  ArrowUpDown,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";

import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { AppHeader } from "@/components/dashboard/app-header";
import { DashboardCard } from "@/components/dashboard/dashboard-card";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";

export const Route = createFileRoute("/_authenticated/library")({
  head: () => ({
    meta: [
      { title: "Content Library — Lila Studio" },
      {
        name: "description",
        content:
          "Central asset library for Lila Studio — browse, review and schedule AI-generated videos and images.",
      },
    ],
  }),
  component: LibraryPage,
});

// ---------- Types ----------

type AssetStatus = "pending" | "approved" | "rejected" | "scheduled";

type VideoSettings = {
  fps: number;
  framesPerScene: number;
  numScenes: number;
  samplingSteps: number;
};

type VideoAsset = {
  id: string;
  kind: "video";
  title: string;
  createdAt: string; // ISO
  status: AssetStatus;
  thumbnail: string;
  referenceImage: string;
  settings: VideoSettings;
  scenes: string[];
  negativePrompt: string;
  durationSec: number;
};

type ImageAsset = {
  id: string;
  kind: "image";
  title: string;
  createdAt: string;
  status: AssetStatus;
  thumbnail: string;
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  samplingSteps: number;
};

type Asset = VideoAsset | ImageAsset;

// ---------- Mock data ----------

const STOCK_VIDEO_THUMBS = [
  "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=800&auto=format&fit=crop&q=70",
  "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=800&auto=format&fit=crop&q=70",
  "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=800&auto=format&fit=crop&q=70",
  "https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=800&auto=format&fit=crop&q=70",
  "https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?w=800&auto=format&fit=crop&q=70",
  "https://images.unsplash.com/photo-1502823403499-6ccfcf4fb453?w=800&auto=format&fit=crop&q=70",
];

const STOCK_IMAGES = [
  "https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?w=800&auto=format&fit=crop&q=70",
  "https://images.unsplash.com/photo-1496359392544-eb7b3b54dd97?w=800&auto=format&fit=crop&q=70",
  "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=800&auto=format&fit=crop&q=70",
  "https://images.unsplash.com/photo-1488716820095-cbe80883c496?w=800&auto=format&fit=crop&q=70",
  "https://images.unsplash.com/photo-1521252659862-eec69941b071?w=800&auto=format&fit=crop&q=70",
  "https://images.unsplash.com/photo-1492288991661-058aa541ff43?w=800&auto=format&fit=crop&q=70",
  "https://images.unsplash.com/photo-1485875437342-9b39470b3d95?w=800&auto=format&fit=crop&q=70",
  "https://images.unsplash.com/photo-1502323777036-f29e3972d82f?w=800&auto=format&fit=crop&q=70",
];

const NEG_PROMPT =
  "lowres, blurry, distorted face, extra limbs, watermark, text, low quality, deformed hands";

const MOCK_VIDEOS: VideoAsset[] = [
  {
    id: "v-001",
    kind: "video",
    title: "Tokyo Cafe — Morning Routine",
    createdAt: "2026-06-18T09:14:00Z",
    status: "approved",
    thumbnail: STOCK_VIDEO_THUMBS[0],
    referenceImage: STOCK_IMAGES[0],
    settings: { fps: 16, framesPerScene: 257, numScenes: 10, samplingSteps: 29 },
    scenes: [
      "Lila walks into a sunlit Tokyo cafe, warm tones, soft bokeh.",
      "Close-up portrait, gentle smile, natural window light.",
      "She picks up a ceramic cup, steam rising, cinematic shallow depth.",
      "Wide shot of cafe interior, golden hour, film grain.",
      "Lila looks out the window, contemplative, rain on glass.",
      "She turns to camera, soft laugh, lens flare.",
      "Hand pours latte art into the cup, macro shot.",
      "Lila opens a notebook, writes a few lines, cozy mood.",
      "Reflection in the window, neon signs blurred outside.",
      "She walks out, door bell rings, gentle slow motion.",
    ],
    negativePrompt: NEG_PROMPT,
    durationSec: 160,
  },
  {
    id: "v-002",
    kind: "video",
    title: "Seoul Rooftop — Sunset Edit",
    createdAt: "2026-06-17T18:42:00Z",
    status: "pending",
    thumbnail: STOCK_VIDEO_THUMBS[1],
    referenceImage: STOCK_IMAGES[1],
    settings: { fps: 24, framesPerScene: 200, numScenes: 8, samplingSteps: 32 },
    scenes: [
      "Lila stands on a Seoul rooftop, city skyline glowing pink.",
      "Slow camera dolly forward, wind in her hair.",
      "She leans on the railing, soft profile shot.",
      "Cut to wide drone shot pulling back over the city.",
      "Sun dips behind a tower, lens flare across frame.",
      "Lila smiles at the camera, anamorphic warmth.",
      "Close-up on hands holding a polaroid, faded color.",
      "She walks toward the edge, silhouette against orange sky.",
    ],
    negativePrompt: NEG_PROMPT,
    durationSec: 67,
  },
  {
    id: "v-003",
    kind: "video",
    title: "Studio Portrait Reel — V2",
    createdAt: "2026-06-15T11:08:00Z",
    status: "scheduled",
    thumbnail: STOCK_VIDEO_THUMBS[2],
    referenceImage: STOCK_IMAGES[2],
    settings: { fps: 16, framesPerScene: 257, numScenes: 6, samplingSteps: 29 },
    scenes: [
      "Studio portrait, neutral background, key light from the left.",
      "Slow turn of the head, eye contact with camera.",
      "Outfit change cut — black turtleneck, minimal jewelry.",
      "Close-up of eyes, catchlight, shallow depth of field.",
      "She tucks hair behind ear, soft smile.",
      "Final hero pose, confident, magazine-style framing.",
    ],
    negativePrompt: NEG_PROMPT,
    durationSec: 96,
  },
  {
    id: "v-004",
    kind: "video",
    title: "Beach Walk — Golden Hour",
    createdAt: "2026-06-12T07:31:00Z",
    status: "rejected",
    thumbnail: STOCK_VIDEO_THUMBS[3],
    referenceImage: STOCK_IMAGES[3],
    settings: { fps: 16, framesPerScene: 257, numScenes: 10, samplingSteps: 29 },
    scenes: [
      "Lila walks barefoot along the shoreline, soft waves.",
      "Wide shot, footprints in wet sand.",
      "She bends down, picks up a shell, examines it.",
      "Hair catches the wind, sun behind her.",
      "Cut to flowing white dress detail shot.",
      "She turns and smiles, warm backlight.",
      "Aerial pull-back revealing empty beach.",
      "Close-up, salt water droplets on skin.",
      "She writes her name in the sand with a stick.",
      "Final wide, walking toward horizon.",
    ],
    negativePrompt: NEG_PROMPT,
    durationSec: 160,
  },
  {
    id: "v-005",
    kind: "video",
    title: "Late Night Diner — Neon",
    createdAt: "2026-06-10T22:55:00Z",
    status: "approved",
    thumbnail: STOCK_VIDEO_THUMBS[4],
    referenceImage: STOCK_IMAGES[4],
    settings: { fps: 24, framesPerScene: 220, numScenes: 7, samplingSteps: 30 },
    scenes: [
      "Lila sits in a vinyl booth, magenta neon glow on her face.",
      "She stirs coffee, steam rising, slow motion.",
      "Across the diner, a jukebox glows blue.",
      "She glances out the rain-streaked window.",
      "Close-up of fries and a milkshake on the table.",
      "She laughs at something off-camera, candid framing.",
      "Wide shot, lonely diner at 2am, cinematic.",
    ],
    negativePrompt: NEG_PROMPT,
    durationSec: 64,
  },
  {
    id: "v-006",
    kind: "video",
    title: "Park Bench — Autumn Mood",
    createdAt: "2026-06-08T14:20:00Z",
    status: "pending",
    thumbnail: STOCK_VIDEO_THUMBS[5],
    referenceImage: STOCK_IMAGES[5],
    settings: { fps: 16, framesPerScene: 257, numScenes: 9, samplingSteps: 29 },
    scenes: [
      "Lila sits on a park bench, golden leaves falling.",
      "Wide shot of an empty autumn path, dappled light.",
      "She reads a paperback, soft focus background.",
      "Close-up of leaves drifting past her face.",
      "She looks up, catches a leaf in her hand.",
      "Cut to wide tracking shot as she walks the path.",
      "Camera tilts up to bare branches and pale sky.",
      "She zips up her coat, breath visible in the cold.",
      "Final shot, she disappears into golden fog.",
    ],
    negativePrompt: NEG_PROMPT,
    durationSec: 135,
  },
];

const IMAGE_PROMPTS = [
  "Lila in a minimalist Tokyo apartment, soft window light, film look.",
  "High-fashion editorial portrait, cream background, sharp catchlight.",
  "Lila on a Lisbon street, pastel buildings, mid-afternoon sun.",
  "Cozy library setting, warm tungsten light, candid reading pose.",
  "Outdoor café in Paris, espresso cup, soft bokeh of bicycles behind.",
  "Studio beauty shot, gradient grey backdrop, glossy makeup.",
  "Rainy Seoul night, umbrella, neon reflections on pavement.",
  "Sunlit kitchen, baking cookies, candid laugh, lifestyle aesthetic.",
];

const MOCK_IMAGES: ImageAsset[] = STOCK_IMAGES.map((src, i) => ({
  id: `i-${String(i + 1).padStart(3, "0")}`,
  kind: "image" as const,
  title: `Lila — Set ${i + 1}`,
  createdAt: new Date(2026, 5, 18 - i, 10 + i, 12).toISOString(),
  status: (["approved", "pending", "scheduled", "rejected"] as AssetStatus[])[
    i % 4
  ],
  thumbnail: src,
  prompt: IMAGE_PROMPTS[i % IMAGE_PROMPTS.length],
  negativePrompt: NEG_PROMPT,
  width: 1024,
  height: 1536,
  samplingSteps: 32,
}));

// ---------- Helpers ----------

const STATUS_META: Record<
  AssetStatus,
  { label: string; className: string; dot: string }
> = {
  pending: {
    label: "Pending Review",
    className: "bg-chart-3/15 text-chart-3 border-chart-3/30",
    dot: "bg-chart-3",
  },
  approved: {
    label: "Approved",
    className: "bg-success/15 text-success border-success/30",
    dot: "bg-success",
  },
  rejected: {
    label: "Rejected",
    className: "bg-destructive/15 text-destructive border-destructive/30",
    dot: "bg-destructive",
  },
  scheduled: {
    label: "Scheduled",
    className: "bg-chart-4/15 text-chart-4 border-chart-4/30",
    dot: "bg-chart-4",
  },
};

function StatusBadge({ status }: { status: AssetStatus }) {
  const m = STATUS_META[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium ${m.className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
      {m.label}
    </span>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

type DateRange = "all" | "7d" | "30d" | "90d";
type Sort = "newest" | "oldest" | "status" | "reviewed";

function withinRange(iso: string, range: DateRange) {
  if (range === "all") return true;
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return new Date(iso).getTime() >= cutoff;
}

function sortAssets<T extends Asset>(items: T[], sort: Sort): T[] {
  const arr = [...items];
  if (sort === "newest")
    arr.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  if (sort === "oldest")
    arr.sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
  if (sort === "status") arr.sort((a, b) => a.status.localeCompare(b.status));
  if (sort === "reviewed")
    arr.sort((a, b) => {
      const rank = (s: AssetStatus) =>
        s === "approved" || s === "rejected" ? 0 : 1;
      return rank(a.status) - rank(b.status);
    });
  return arr;
}

// ---------- Page ----------

function LibraryPage() {
  const [tab, setTab] = useState<"videos" | "images">("videos");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | AssetStatus>("all");
  const [dateRange, setDateRange] = useState<DateRange>("all");
  const [sort, setSort] = useState<Sort>("newest");
  const [selected, setSelected] = useState<Asset | null>(null);

  const [videos, setVideos] = useState<VideoAsset[]>(MOCK_VIDEOS);
  const [images, setImages] = useState<ImageAsset[]>(MOCK_IMAGES);

  const stats = useMemo(() => {
    const all: Asset[] = [...videos, ...images];
    return {
      total: all.length,
      images: images.length,
      videos: videos.length,
      pending: all.filter((a) => a.status === "pending").length,
      approved: all.filter((a) => a.status === "approved").length,
    };
  }, [videos, images]);

  const filteredVideos = useMemo(() => {
    const q = query.trim().toLowerCase();
    const items = videos.filter((v) => {
      if (statusFilter !== "all" && v.status !== statusFilter) return false;
      if (!withinRange(v.createdAt, dateRange)) return false;
      if (!q) return true;
      return (
        v.title.toLowerCase().includes(q) ||
        v.scenes.some((s) => s.toLowerCase().includes(q))
      );
    });
    return sortAssets(items, sort);
  }, [videos, query, statusFilter, dateRange, sort]);

  const filteredImages = useMemo(() => {
    const q = query.trim().toLowerCase();
    const items = images.filter((i) => {
      if (statusFilter !== "all" && i.status !== statusFilter) return false;
      if (!withinRange(i.createdAt, dateRange)) return false;
      if (!q) return true;
      return (
        i.title.toLowerCase().includes(q) ||
        i.prompt.toLowerCase().includes(q)
      );
    });
    return sortAssets(items, sort);
  }, [images, query, statusFilter, dateRange, sort]);

  const updateStatus = (asset: Asset, status: AssetStatus) => {
    if (asset.kind === "video") {
      setVideos((v) =>
        v.map((x) => (x.id === asset.id ? { ...x, status } : x)),
      );
    } else {
      setImages((v) =>
        v.map((x) => (x.id === asset.id ? { ...x, status } : x)),
      );
    }
  };

  const deleteAsset = (asset: Asset) => {
    if (asset.kind === "video")
      setVideos((v) => v.filter((x) => x.id !== asset.id));
    else setImages((v) => v.filter((x) => x.id !== asset.id));
    toast.success(`Deleted "${asset.title}"`);
  };

  const handleAction = (asset: Asset, action: string) => {
    switch (action) {
      case "view":
        setSelected(asset);
        break;
      case "review":
        updateStatus(asset, "pending");
        toast.success(`Sent "${asset.title}" to review`);
        break;
      case "schedule":
        updateStatus(asset, "scheduled");
        toast.success(`Scheduled "${asset.title}"`);
        break;
      case "delete":
        deleteAsset(asset);
        break;
    }
  };

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background text-foreground">
        <AppSidebar />
        <SidebarInset className="flex min-w-0 flex-1 flex-col">
          <AppHeader />
          <main className="flex-1">
            <div className="bg-aurora">
              <div className="mx-auto w-full max-w-7xl px-4 py-8 md:px-8">
                {/* Heading */}
                <div className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                      Assets
                    </p>
                    <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight md:text-4xl">
                      Content Library
                    </h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Every image and video Lila has generated — browse,
                      review, and schedule.
                    </p>
                  </div>
                  <div className="mt-4 flex items-center gap-2 md:mt-0">
                    <Button asChild size="sm" variant="outline">
                      <Link to="/generate">
                        <Sparkles className="mr-1.5 h-4 w-4" />
                        Generate
                      </Link>
                    </Button>
                  </div>
                </div>

                {/* Stats */}
                <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
                  <DashboardCard
                    label="Total assets"
                    value={String(stats.total)}
                    icon={LibraryIcon}
                    accent="primary"
                  />
                  <DashboardCard
                    label="Images"
                    value={String(stats.images)}
                    icon={ImageIcon}
                    accent="chart-2"
                  />
                  <DashboardCard
                    label="Videos"
                    value={String(stats.videos)}
                    icon={VideoIcon}
                    accent="chart-4"
                  />
                  <DashboardCard
                    label="Pending review"
                    value={String(stats.pending)}
                    icon={ClipboardCheck}
                    accent="chart-3"
                  />
                  <DashboardCard
                    label="Approved"
                    value={String(stats.approved)}
                    icon={CheckCircle2}
                    accent="chart-5"
                  />
                </div>

                {/* Tabs + filters */}
                <Tabs
                  value={tab}
                  onValueChange={(v) => setTab(v as "videos" | "images")}
                  className="mt-6"
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <TabsList>
                      <TabsTrigger value="videos" className="gap-1.5">
                        <VideoIcon className="h-3.5 w-3.5" />
                        Videos
                      </TabsTrigger>
                      <TabsTrigger value="images" className="gap-1.5">
                        <ImageIcon className="h-3.5 w-3.5" />
                        Images
                      </TabsTrigger>
                    </TabsList>

                    <div className="flex flex-wrap items-center gap-2">
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          placeholder="Search prompts, scenes, names…"
                          className="h-9 w-full pl-8 sm:w-72"
                        />
                      </div>

                      <Select
                        value={statusFilter}
                        onValueChange={(v) =>
                          setStatusFilter(v as typeof statusFilter)
                        }
                      >
                        <SelectTrigger className="h-9 w-[150px]">
                          <ListFilter className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
                          <SelectValue placeholder="Status" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All statuses</SelectItem>
                          <SelectItem value="pending">Pending Review</SelectItem>
                          <SelectItem value="approved">Approved</SelectItem>
                          <SelectItem value="rejected">Rejected</SelectItem>
                          <SelectItem value="scheduled">Scheduled</SelectItem>
                        </SelectContent>
                      </Select>

                      <Select
                        value={dateRange}
                        onValueChange={(v) => setDateRange(v as DateRange)}
                      >
                        <SelectTrigger className="h-9 w-[140px]">
                          <SelectValue placeholder="Date range" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All time</SelectItem>
                          <SelectItem value="7d">Last 7 days</SelectItem>
                          <SelectItem value="30d">Last 30 days</SelectItem>
                          <SelectItem value="90d">Last 90 days</SelectItem>
                        </SelectContent>
                      </Select>

                      <Select
                        value={sort}
                        onValueChange={(v) => setSort(v as Sort)}
                      >
                        <SelectTrigger className="h-9 w-[160px]">
                          <ArrowUpDown className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
                          <SelectValue placeholder="Sort" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="newest">Newest first</SelectItem>
                          <SelectItem value="oldest">Oldest first</SelectItem>
                          <SelectItem value="status">Status</SelectItem>
                          <SelectItem value="reviewed">Recently reviewed</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <TabsContent value="videos" className="mt-5">
                    {filteredVideos.length === 0 ? (
                      <EmptyState kind="video" />
                    ) : (
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {filteredVideos.map((v) => (
                          <VideoCard
                            key={v.id}
                            video={v}
                            onAction={(a) => handleAction(v, a)}
                          />
                        ))}
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="images" className="mt-5">
                    {filteredImages.length === 0 ? (
                      <EmptyState kind="image" />
                    ) : (
                      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                        {filteredImages.map((img) => (
                          <ImageCard
                            key={img.id}
                            image={img}
                            onAction={(a) => handleAction(img, a)}
                          />
                        ))}
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
              </div>
            </div>
          </main>
        </SidebarInset>
      </div>

      <DetailsSheet
        asset={selected}
        onOpenChange={(open) => !open && setSelected(null)}
        onAction={(a) => selected && handleAction(selected, a)}
      />
    </SidebarProvider>
  );
}

// ---------- Cards ----------

function ActionMenu({ onAction }: { onAction: (a: string) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 bg-background/70 backdrop-blur hover:bg-background"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onClick={() => onAction("view")}>
          <Eye className="mr-2 h-4 w-4" /> View details
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onAction("review")}>
          <Send className="mr-2 h-4 w-4" /> Send to review
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onAction("schedule")}>
          <CalendarPlus className="mr-2 h-4 w-4" /> Schedule
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => onAction("delete")}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="mr-2 h-4 w-4" /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function VideoCard({
  video,
  onAction,
}: {
  video: VideoAsset;
  onAction: (a: string) => void;
}) {
  return (
    <Card
      className="group cursor-pointer overflow-hidden border-border bg-card/60 transition hover:border-primary/40 hover:shadow-[0_0_30px_-12px_var(--primary)]"
      onClick={() => onAction("view")}
    >
      <div className="relative aspect-video w-full overflow-hidden bg-muted">
        <img
          src={video.thumbnail}
          alt={video.title}
          className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-background/0 to-background/0" />
        <div className="absolute left-2 top-2">
          <StatusBadge status={video.status} />
        </div>
        <div className="absolute right-2 top-2">
          <ActionMenu onAction={onAction} />
        </div>
        <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-full bg-background/70 px-2 py-0.5 text-[10px] font-medium text-foreground backdrop-blur">
          <Film className="h-3 w-3" />
          {Math.floor(video.durationSec / 60)}:
          {String(video.durationSec % 60).padStart(2, "0")}
        </div>
        <div className="absolute inset-0 grid place-items-center opacity-0 transition group-hover:opacity-100">
          <div className="grid h-12 w-12 place-items-center rounded-full bg-primary/90 text-primary-foreground shadow-lg">
            <Play className="h-5 w-5" fill="currentColor" />
          </div>
        </div>
      </div>
      <CardContent className="p-4">
        <h3 className="line-clamp-1 font-display text-sm font-semibold tracking-tight">
          {video.title}
        </h3>
        <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{formatDate(video.createdAt)}</span>
          <span className="font-mono">
            {video.settings.numScenes} scenes · {video.settings.fps}fps
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function ImageCard({
  image,
  onAction,
}: {
  image: ImageAsset;
  onAction: (a: string) => void;
}) {
  return (
    <Card
      className="group cursor-pointer overflow-hidden border-border bg-card/60 transition hover:border-primary/40 hover:shadow-[0_0_30px_-12px_var(--primary)]"
      onClick={() => onAction("view")}
    >
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-muted">
        <img
          src={image.thumbnail}
          alt={image.title}
          className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-background/0 to-background/0" />
        <div className="absolute left-2 top-2">
          <StatusBadge status={image.status} />
        </div>
        <div className="absolute right-2 top-2">
          <ActionMenu onAction={onAction} />
        </div>
      </div>
      <CardContent className="p-3">
        <h3 className="line-clamp-1 text-xs font-medium">{image.title}</h3>
        <p className="mt-1 text-[10px] text-muted-foreground">
          {formatDate(image.createdAt)}
        </p>
      </CardContent>
    </Card>
  );
}

// ---------- Empty state ----------

function EmptyState({ kind }: { kind: "video" | "image" }) {
  return (
    <div className="grid place-items-center rounded-xl border border-dashed border-border bg-card/30 px-6 py-20 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary">
        {kind === "video" ? (
          <VideoIcon className="h-5 w-5" />
        ) : (
          <ImageIcon className="h-5 w-5" />
        )}
      </div>
      <h3 className="mt-4 font-display text-lg font-semibold">
        No generated content yet.
      </h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        When Lila generates {kind === "video" ? "videos" : "images"}, they
        will appear here for review and scheduling.
      </p>
      <Button asChild className="mt-5">
        <Link to="/generate">
          <Sparkles className="mr-1.5 h-4 w-4" />
          Generate Content
        </Link>
      </Button>
    </div>
  );
}

// ---------- Details sheet ----------

function DetailsSheet({
  asset,
  onOpenChange,
  onAction,
}: {
  asset: Asset | null;
  onOpenChange: (open: boolean) => void;
  onAction: (a: string) => void;
}) {
  return (
    <Sheet open={!!asset} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto p-0 sm:max-w-2xl"
      >
        {asset && (
          <div className="flex flex-col">
            <SheetHeader className="border-b border-border px-6 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <SheetTitle className="font-display text-lg">
                    {asset.title}
                  </SheetTitle>
                  <SheetDescription className="text-xs">
                    Generated {formatDateTime(asset.createdAt)} ·{" "}
                    <span className="font-mono">{asset.id}</span>
                  </SheetDescription>
                </div>
                <StatusBadge status={asset.status} />
              </div>
            </SheetHeader>

            <div className="space-y-6 px-6 py-6">
              {/* Preview */}
              <div className="relative overflow-hidden rounded-xl border border-border bg-muted">
                {asset.kind === "video" ? (
                  <div className="relative aspect-video">
                    <img
                      src={asset.thumbnail}
                      alt={asset.title}
                      className="h-full w-full object-cover"
                    />
                    <div className="absolute inset-0 grid place-items-center bg-background/30">
                      <div className="grid h-14 w-14 place-items-center rounded-full bg-primary/90 text-primary-foreground shadow-xl">
                        <Play className="h-6 w-6" fill="currentColor" />
                      </div>
                    </div>
                    <div className="absolute bottom-2 left-2 rounded-full bg-background/70 px-2 py-0.5 text-[10px] backdrop-blur">
                      Preview placeholder — RunPod stream not connected
                    </div>
                  </div>
                ) : (
                  <img
                    src={asset.thumbnail}
                    alt={asset.title}
                    className="w-full object-cover"
                  />
                )}
              </div>

              {asset.kind === "video" ? (
                <VideoDetails video={asset} />
              ) : (
                <ImageDetails image={asset} />
              )}
            </div>

            <Separator />
            <div className="flex flex-wrap items-center justify-end gap-2 px-6 py-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onAction("delete")}
              >
                <Trash2 className="mr-1.5 h-4 w-4" /> Delete
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onAction("review")}
              >
                <Send className="mr-1.5 h-4 w-4" /> Send to review
              </Button>
              <Button size="sm" onClick={() => onAction("schedule")}>
                <CalendarPlus className="mr-1.5 h-4 w-4" /> Schedule
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function StatRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-card/50 px-3 py-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-mono text-xs font-medium">{value}</span>
    </div>
  );
}

function VideoDetails({ video }: { video: VideoAsset }) {
  return (
    <>
      <section>
        <h4 className="mb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Reference image
        </h4>
        <div className="overflow-hidden rounded-lg border border-border">
          <img
            src={video.referenceImage}
            alt="Reference"
            className="aspect-[4/3] w-full object-cover"
          />
        </div>
      </section>

      <section>
        <h4 className="mb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Generation settings
        </h4>
        <div className="grid grid-cols-2 gap-2">
          <StatRow label="FPS" value={video.settings.fps} />
          <StatRow
            label="Frames / scene"
            value={video.settings.framesPerScene}
          />
          <StatRow label="Scenes" value={video.settings.numScenes} />
          <StatRow label="Sampling steps" value={video.settings.samplingSteps} />
        </div>
      </section>

      <section>
        <h4 className="mb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Scene prompts
        </h4>
        <ScrollArea className="max-h-72 rounded-lg border border-border">
          <ol className="divide-y divide-border">
            {video.scenes.map((s, i) => (
              <li key={i} className="flex gap-3 px-3 py-2.5">
                <span className="mt-0.5 grid h-5 w-5 flex-none place-items-center rounded-full bg-primary/15 text-[10px] font-medium text-primary">
                  {i + 1}
                </span>
                <p className="text-xs leading-relaxed">{s}</p>
              </li>
            ))}
          </ol>
        </ScrollArea>
      </section>

      <section>
        <h4 className="mb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Negative prompt
        </h4>
        <p className="rounded-lg border border-border bg-card/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          {video.negativePrompt}
        </p>
      </section>
    </>
  );
}

function ImageDetails({ image }: { image: ImageAsset }) {
  return (
    <>
      <section>
        <h4 className="mb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Generation settings
        </h4>
        <div className="grid grid-cols-2 gap-2">
          <StatRow
            label="Resolution"
            value={`${image.width}×${image.height}`}
          />
          <StatRow label="Sampling steps" value={image.samplingSteps} />
        </div>
      </section>

      <section>
        <h4 className="mb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Prompt
        </h4>
        <p className="rounded-lg border border-border bg-card/50 px-3 py-2 text-xs leading-relaxed">
          {image.prompt}
        </p>
      </section>

      <section>
        <h4 className="mb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Negative prompt
        </h4>
        <p className="rounded-lg border border-border bg-card/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          {image.negativePrompt}
        </p>
      </section>
    </>
  );
}
