# Lila Studio — Service Layer

All Supabase access flows through this layer. UI components must import from
`@/services` and never call `supabase` directly.

## Services

| Service              | Responsibility                                              |
| -------------------- | ----------------------------------------------------------- |
| `authService`        | Admin sign-in / sign-out, session + admin role checks       |
| `characterService`   | CRUD for virtual creator characters                         |
| `contentService`     | Images, videos, signed-URL storage access (4 buckets)       |
| `generationService`  | Queue + lifecycle of AI image/video generation jobs         |
| `reviewService`      | Moderation queue; mirrors decision onto image/video row     |
| `scheduleService`    | Scheduled publishes to platforms (Fanvue, etc.)             |

## Storage buckets (all private)

- `reference-images`   — character reference uploads
- `character-assets`   — supporting character assets (loras, embeddings, etc.)
- `generated-images`   — AI generation output (images)
- `generated-videos`   — AI generation output (videos)

Access is admin-only via RLS on `storage.objects`. Use
`contentService.getSignedUrl(bucket, path)` to render.

## Auth & roles

- Email + password admin login (Lovable Cloud Auth).
- Roles are stored in `public.user_roles` (separate from `profiles`) and
  checked via the security-definer function `public.has_role`.
- Bootstrap the first admin manually after the user signs up:

```sql
INSERT INTO public.user_roles (user_id, role)
VALUES ('<auth-user-uuid>', 'admin');
```

## Planned UI shell (not yet implemented)

```
AppLayout (Sidebar + Header)
├── /dashboard
├── /generate           (Content Generation)
├── /library            (Content Library: images & videos)
├── /review             (Review Queue)
├── /schedule           (Scheduling)
├── /characters         (Character Manager)
└── /settings
```

## Pipeline flow

```
Admin → characterService → generationService.enqueue
   → worker (RunPod) → updates job + uploads to generated-* bucket
   → contentService.createImage/createVideo
   → reviewService.enqueue → admin decides
   → scheduleService.create → publish worker → platform
```
