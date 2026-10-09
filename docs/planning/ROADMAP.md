# Roadmap

## Milestone 0: Zero-Investment Curated Meme PWA

Goal: Build and launch a tiny, fast, owner-curated meme application with no paid infrastructure. The app should feel playful and shareable without becoming a feed, social network, or bloated content platform.

## Phase 1: MVP App Shell - Complete

Status: COMPLETE

Delivered:

- Vite + React + TypeScript PWA foundation.
- Single-screen meme capsule experience.
- Primary `Spawn a Random Meme` CTA.
- Meme reveal animation.
- Share, save, favorite, Daily Drop, rarity badge, and LOL reaction controls.
- Local curated fallback meme data.
- PWA metadata, icon, headers, and service worker.
- Cloudflare Pages Function stubs for random and daily memes.
- Supabase schema and admin workflow documentation.
- Duplicate `Again` action removed; public app now has one repeat CTA.

Acceptance already met:

- `npm.cmd run build` passes.
- Project can be opened from `C:\Users\avspn\Desktop\meme application`.

## Phase 1.5: Review + Starter Content Replacement - Complete

Status: COMPLETE

Goal: Review the implemented app and replace placeholder starter memes with real owner-curated content while keeping the app lightweight and locally runnable.

Tasks:

- Run `npm.cmd run dev` and review the UI.
- Check mobile layout, button spacing, text fit, reveal feel, and share/save behavior.
- Use `/admin` to add local draft memes by URL, Google Drive link, or upload preview.
- Mark reviewed local memes as `active` to test them in the public app.
- Replace placeholder generated memes in `src/data/fallbackMemes.ts` only if a static bundled collection is still wanted.
- Keep at least 20 curated memes available before backend launch testing.
- Confirm every meme has category, tags, rarity, share text, and rights note.

Acceptance criteria:

- App still builds with `npm.cmd run build`.
- Random spawn works without Supabase configured.
- Admin dashboard can add, edit, delete, preview, and export local collection items.
- Save downloads preserve original file type when possible.
- Public/admin previews preserve original media aspect ratio.
- No unapproved or scraped content is introduced.
- UI still feels like a single playful tool, not a feed.

## Phase 2: Cloudflare R2 + D1 Backend — Complete

Status: COMPLETE

Delivered:

- D1 database `meme-capsule-db` created and schema applied.
- R2 bucket `memes` created with public access enabled.
- `wrangler.toml` configured with D1 + R2 bindings.
- `functions/_shared/d1r2.ts` replaces all Supabase backend code.
- `/api/random-meme` and `/api/daily-meme` query D1.
- `/api/admin/memes` CRUD uses D1 prepared statements.
- `/api/admin/upload` stores files in R2.
- Admin dashboard has Backend/Local mode toggle with status indicators.
- `.dev.vars` configured with `ADMIN_API_TOKEN` and `R2_PUBLIC_URL`.
- Fallback memes still work when D1 is empty.
- `npm.cmd run build` passes.
- No active imports of `supabase.ts` remain.

Goal: Move curated memes into a zero-cost, zero-egress backend using Cloudflare R2 (file storage) and D1 (SQLite database), keeping everything on one platform with no external vendor dependency.

Why R2 + D1 instead of Supabase:

- Zero egress bandwidth fees forever (R2's killer feature).
- No external API keys or auth headers needed — native CF bindings.
- Everything stays on Cloudflare (Pages + Functions + D1 + R2 = one vendor).
- SQLite schema translates directly from the existing Postgres schema.
- Faster — no cross-network HTTP calls, everything runs at the edge.

Implementation direction:

- Create a D1 database via Cloudflare dashboard or Wrangler CLI.
- Create an R2 bucket named `memes` via Cloudflare dashboard or Wrangler CLI.
- Add a `wrangler.toml` with D1 and R2 bindings.
- Convert `supabase/schema.sql` to SQLite-compatible `d1/schema.sql`.
- Rewrite `functions/_shared/supabase.ts` → `functions/_shared/d1r2.ts` using native bindings.
- Rewrite `functions/api/random-meme.ts` and `functions/api/daily-meme.ts` to use D1.
- Rewrite `functions/api/admin/memes.ts` to use D1 for CRUD.
- Rewrite `functions/api/admin/upload.ts` to use R2 for file storage.
- Update `.dev.vars.example` to remove Supabase vars.
- Update admin frontend API client if endpoint shapes change.
- Keep `ADMIN_API_TOKEN` for admin route protection.

Previously implemented (Supabase — being replaced):

- `/api/admin/memes` for admin list/create/update/archive (Supabase REST).
- `/api/admin/upload` for Supabase Storage uploads.
- `/admin` backend mode that uses a session-entered admin token.
- `.dev.vars.example` for Cloudflare/Supabase environment setup.

Acceptance criteria:

- D1 database created and schema applied.
- R2 bucket created and accessible.
- `wrangler.toml` has correct D1 + R2 bindings.
- `/api/random-meme` returns a random active meme from D1.
- `/api/daily-meme` returns the daily meme from D1.
- `/api/admin/memes` CRUD works against D1.
- `/api/admin/upload` stores files in R2 and returns public URLs.
- Inactive/draft/archived memes are never returned to public users.
- Fallback memes still work if D1 is empty or unavailable.
- `npm.cmd run build` still passes.
- Admin dashboard works with the new backend.

## Phase 3: Launch Prep + Performance Polish — Complete

Status: COMPLETE (Deployed to Production)

Goal: Prepare the PWA for public sharing while staying on free tier edge infrastructure.

Delivered:

- Deployed to Cloudflare Pages with D1 + R2 native edge bindings (`meme-capsule-eww.pages.dev`).
- Environment variables (`ADMIN_API_TOKEN`, `R2_PUBLIC_URL`, `JWT_SECRET`, etc.) configured.
- R2-to-D1 sync feature: `POST /api/admin/sync-r2` scans R2 bucket and auto-creates D1 records for untracked files.
- Admin dashboard "Sync R2 Files to D1" button for bulk-importing memes uploaded directly to R2.
- Real-time global like/unlike system with SQLite (D1) database integration, client-side pre-liked state caching, and live count syncing.
- Mobile, tablet, and desktop responsive validation with native Web Share Sheet API and fallback download triggers.
- Privacy policy, cookie disclosure, content disclaimer, and structured data flows documented.
- Edge caching headers (`stale-while-revalidate`, immutable assets) and PWA manifest configuration.

## Phase 4: Production Workbenches & Feature Expansion — Delivered / Ongoing

Status: DELIVERED (Operational in Production)

Delivered features:

- Admin Authentication & Role Management: Admin token session gate with SuperAdmin credential resolution and bcrypt hashing.
- Five Admin Workbenches: Meme Library, Upload & Metadata Editor, R2 Storage Sync, Submissions Moderation Queue, and Analytics/Telemetry.
- AI Pre-Judge & Curation Pipeline: Curation statuses (`curation_status` from migration 012), automated scoring, and moderation workflows.
- User Vault & Interactions: Local favorites/saved memes, reaction counts, pre-cached likes, and offline vault persistence.
- Public APIs: Contact submission (`POST /api/contact`), telemetry logging (`POST /api/analytics/events`), random/daily drops, and like/unlike endpoints.
- Native Android Client: Full native Android companion app (Kotlin, Jetpack Compose, Material 3, Retrofit) v3.3 maintained in dedicated repository.

Ongoing & Future Backlog:

- Advanced multi-tenant role hierarchies if team scales.
- Direct Cloudflare Images/Workers AI on-the-fly thumbnail generation.
- Automated daily drop scheduling via Cloudflare Cron Triggers.

## Non-Goals

Do not add these unless the owner explicitly changes direction:

- Public meme scraping.
- User accounts for normal users.
- Feed, comments, follows, chat, profiles, or leaderboards.
- Auto-publishing user submissions.
- Video meme support in the first public version.
- Paid infrastructure before the free PWA has been validated.

## Backlog

- Add a small `content/` folder or CSV import workflow for easier meme metadata management.
- Add image compression guidance or scripts after real meme files are available.
- Add Play Store packaging notes if PWA traction justifies the one-time developer fee.
