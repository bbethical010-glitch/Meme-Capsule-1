# Database and Storage Plan

## Current Storage

The project has fully migrated from Supabase to Cloudflare R2 + D1 as its production edge database and storage layer (with 15 production D1 migrations applied from `000_complete_setup.sql` through `013_add_nsfw_flag.sql`).

Current storage layers:

- `src/data/fallbackMemes.ts`: static placeholder/starter memes bundled into the app.
- Browser `localStorage`: local admin dashboard drafts stored under `meme-capsule:admin-collection`.
- `d1/schema.sql`: production database schema for Cloudflare D1 (SQLite).
- `functions/api/random-meme.ts` and `functions/api/daily-meme.ts`: Cloudflare Pages Functions that query D1 when bindings exist and fall back safely when they do not.
- `functions/api/admin/memes.ts`: admin metadata API for listing, creating, updating, and archiving memes via D1.
- `functions/api/admin/upload.ts`: admin upload API for sending files to Cloudflare R2.

Local admin changes sync to the public app only in the same browser. This is useful for review, but it is not global production sync.

## Production Architecture

Use this order:

1. **Cloudflare R2** for curated meme file storage (zero egress fees).
2. **Cloudflare D1** for meme metadata (SQLite at the edge).
3. **Cloudflare Pages Functions** for public random/daily API routes.
4. **Cloudflare Pages** for hosting the PWA.

Why R2 + D1 is the best v1 fit:

- Zero-cost friendly (generous free tiers on all services).
- Zero egress bandwidth fees on R2 — never pay for serving images.
- No external vendor dependency — everything on Cloudflare.
- Native bindings — no API keys, no auth headers, no HTTP hops.
- SQLite metadata is simple and easy to manage.
- Faster — D1 runs at the edge, right next to the Functions.

## Previous Architecture (Supabase — replaced)

The project originally planned to use Supabase Storage + Postgres. That code exists in `functions/_shared/supabase.ts` and `supabase/schema.sql` but is being replaced. The Supabase approach used external REST API calls with API keys. The R2+D1 approach uses native Cloudflare bindings instead.

## Alternatives Considered

| Option | Use Case | Tradeoff |
|---|---|---|
| Supabase | Good SQL database + storage in one | External vendor, 5 GB/month bandwidth cap on free tier, requires API keys |
| Google Drive | Staging area for your personal uploads | Not a reliable public CDN; sharing links may be awkward for direct display. |
| MEGA | Large free storage | Encrypted private storage, not a public CDN, rate-limited bandwidth |
| Cloudinary | Best image/video delivery and transformations | Great upgrade path, but free credits can be exhausted by heavy media traffic. |
| Firebase Storage | Good if the app later becomes Firebase-native | SDK incompatible with Cloudflare Workers, NoSQL mismatch. |
| GitHub/static files | Tiny prototype only | Editing content requires commits and redeploys. |

## Meme Metadata Shape

Production table: `memes` (D1 SQLite)

Core fields:

- `id`: stable text ID such as `meme-exam-001`.
- `title`: admin-facing name.
- `image_url`: direct CDN URL, only if externally hosted.
- `storage_path`: path inside R2 bucket `memes`.
- `source_link`: original source or staging link.
- `category`: loose grouping.
- `tags`: JSON text array (SQLite stores as TEXT).
- `rarity`: `Common`, `Rare`, or `Legendary`.
- `status`: `draft`, `active`, or `archived`.
- `media_type`: `image` or `video`.
- `input_method`: `url`, `upload`, `google-drive`, or `seed`.
- `is_active`: public eligibility switch (integer 0/1 in SQLite).
- `uploaded_at`: created/upload timestamp (ISO string).
- `shown_count`: optional analytics counter.
- `share_count`: optional analytics counter.
- `likes_count`: global like analytics counter (integer, default 0).
- `rights_note`: `original`, `licensed`, `permission`, or `reviewed`.
- `share_text`: text used by share actions.
- `random_key`: indexed random selection helper (REAL type).
- `curation_status`: `keep`, `excluded`, `duplicate`, `review_later`, or `NULL`. Added in Migration 012 to partition non-active memes into authoritatively rejected (`excluded`) vs uncurated backlog (`NULL`).
- `is_nsfw`: 18+ content flag (`INTEGER NOT NULL DEFAULT 0`). Added in Migration 013 (`013_add_nsfw_flag.sql`). Gated on public delivery routes (`is_nsfw = 0` by default; requested via `?nsfw=1`).
- `nsfw_flagged_by`: Flag source (`'ai-judge'`, `'curator'`, `'report'`, or `NULL`). Added in Migration 013.
- Index: `idx_memes_is_nsfw` on `memes(is_nsfw)`.

Only records with `status = 'active'`, `is_active = 1`, and `is_nsfw = 0` (unless `?nsfw=1` requested) should be returned to users.

### Reporting System Table: `meme_reports`
- `id`: Auto-incrementing integer primary key.
- `meme_id`: ID of the reported meme (if known).
- `meme_url`: URL of the reported meme.
- `meme_title`: Title of the reported meme.
- `author`: Name or identifier of the reporting user.
- `source`: Source of the report (e.g. "Meme Capsule").
- `reason`: Primary reason for the report.
- `details`: Optional extra details provided by the user.
- `device_id`: Device identifier of the reporting user.
- `status`: State of the report (`pending`, `resolved`, `dismissed`).
- `created_at`: Creation timestamp.
- `updated_at`: Last updated timestamp.

### Force Removals Audit Table: `meme_force_removals`
Created in Migration 011 (`011_force_removals.sql`) to provide an immutable audit trail when non-meme media or corrupt files are permanently expunged:
- `id`: Auto-generated string ID (`frm-` prefix followed by hex random blob).
- `meme_id`: Unique target meme ID (foreign key to `memes(id)`).
- `title`: Cached title of the removed meme.
- `image_url`: Original delivery/staging URL.
- `storage_path`: Original R2 storage path.
- `r2_key`: Extracted object key within Cloudflare R2 bucket `memes`.
- `removed_by`: ID of the judge who executed the removal (foreign key to `cat_users(id)`).
- `removed_by_name`: Display name of the judge.
- `reason`: Optional reason specified during removal (up to 200 characters).
- `r2_deleted`: Integer boolean (1 if object was deleted from R2, 0 if R2 deletion failed or media was non-R2/Reddit).
- `r2_error`: Error message text if R2 deletion encountered an exception.
- `removed_at`: ISO timestamp when removal was executed.
- `r2_deleted_at`: ISO timestamp when R2 deletion was confirmed.

## API Flow

Public random meme:

```text
User taps Spawn Another
  -> frontend calls getRandomMeme()
  -> local active admin drafts are checked first during development
  -> deployed app calls GET /api/random-meme
  -> Cloudflare Function queries D1 active memes via binding
  -> one approved meme is returned
```

Daily Drop:

```text
User taps Daily Drop
  -> frontend calls getDailyMeme()
  -> Function queries D1 for active memes
  -> stable daily pick returned based on date
```

## Admin Sync Plan

Phase 1.5 admin dashboard (local mode):

- Saves drafts in browser `localStorage`.
- Lets you test URLs, uploads, metadata, status, and previews quickly.
- Active local items are immediately visible in the same browser public app.

Phase 2 R2 + D1 admin (backend mode):

- Upload files to R2 bucket `memes` via `env.MEMES_BUCKET.put()`.
- Insert/update metadata rows in D1 `memes` table via `env.DB.prepare()`.
- Mark reviewed memes with `status = 'active'` and `is_active = 1`.
- Public API automatically starts returning the updated collection.

## Admin API Details

Backend mode uses same-origin Cloudflare Pages Functions. The frontend admin dashboard sends an admin token in `Authorization: Bearer <token>` and `X-Admin-Token`. The token must match `ADMIN_API_TOKEN` configured on Cloudflare.

Required Cloudflare environment variable:

- `ADMIN_API_TOKEN`

D1 and R2 are accessed via native bindings defined in `wrangler.toml` — no URL or key environment variables needed.

Routes:

- `GET /api/admin/memes`: returns all meme records for admin review.
- `POST /api/admin/memes`: creates one metadata row in D1.
- `PATCH /api/admin/memes`: updates one metadata row; pass `originalId` when changing an ID.
- `DELETE /api/admin/memes`: archives one metadata row instead of hard deleting.
- `POST /api/admin/upload`: uploads one image/video file to R2 and returns `storage_path` plus public URL.

## Report moderation

The token-protected `/reports` dashboard supports report status changes
(`pending`, `resolved`, and `dismissed`) plus destructive moderation actions for
reports linked to a `meme_id`:

- **Remove Meme** archives the row in `memes` and sets `is_active = 0`.
- **Blacklist + Remove** inserts the meme into the existing `content_blacklist`
  table, then archives it and resolves the report.
- **Mark NSFW** sets `is_nsfw = 1` and `nsfw_flagged_by = 'report'` on the meme without removing it from circulation (non-destructive moderation action for `NSFW` reports), resolving the report.

Destructive actions use the meme ID stored on the report rather than trusting a
browser-supplied target. The dashboard requires `ADMIN_API_TOKEN` and asks for
confirmation before removing or blacklisting content.

Public routes (`/api/random-meme`, `/api/daily-meme`, `/api/memes/random`) never use the admin token. They only return rows with `status = 'active'`, `is_active = 1`, and an authoritative finalization in `meme_curation_final` with `corpus_status = 'keep'`. By default, NSFW content (`is_nsfw = 1`) is strictly excluded (`AND (m.is_nsfw IS NULL OR m.is_nsfw = 0)`). Clients can request NSFW-inclusive results by supplying `?nsfw=1`. All unfinalized or excluded memes are maintained in `status = 'archived'` (`is_active = 0`) and are excluded at the SQL query level.

## Authoritative Resolution & Active Pool Synchronization

The platform enforces a canonical single-source-of-truth contract across `memes` and `meme_curation_final`:
1. **`meme_curation_final` Table**:
   - `corpus_status = 'keep'`: Memes approved by Superadmin for the public Capsule (111 memes).
   - `corpus_status = 'excluded'`: Memes rejected / discarded by Superadmin (53 memes).
   - Total Editorial Decisions: 164.
2. **`memes` Table (3-Way Partitioning via `curation_status`)**:
   - **Active Public Capsule** (`status = 'active'`, `is_active = 1`, `curation_status = 'keep'`): Strictly maps 1-to-1 with authoritative keep decisions (111 memes).
   - **Superadmin Excluded** (`status = 'archived'`, `is_active = 0`, `curation_status = 'excluded'`): Strictly isolated rejected memes (53 memes). Ineligible for public spawn.
   - **Uncurated Backlog** (`status = 'archived'`, `is_active = 0`, `curation_status IS NULL`): Memes awaiting curator / judge review (4,947 memes).
   - Total Corpus: 5,111 memes ($111 + 53 + 4,947 = 5,111$).
3. **Dashboard & UI Synchronization**:
   - Superadmin Command Center reports **111 Authoritative Resolved** memes with a dedicated badge for **53 Excluded**.
   - `/admin` top stats bar displays **Total (5,111)**, **Active (111)**, **Excluded (53)**, **Archived (4,947)**, and **Drafts (0)**.
   - Filtering by `[EXCLUDED]` in `/admin` renders the 53 rejected items with bright red `EXCLUDED` badges, distinct from general backlog items.
4. **Single-Judge Adoption & Force Remove Workflows**:
   - **`POST /api/curate/approve`**: Any human judge (Judge 1, 2, or 3) adopting an AI decision or finalizing a curation writes atomically to both `meme_curation` (audit log) and `meme_curation_final` (authoritative decision), automatically updating `memes` (`is_active`, `status`, `curation_status`, `tags`, `category`) without needing SuperAdmin arbitration.
   - **`POST /api/curate/force-remove` (`Shift+Delete`)**: Allows curators to permanently vanish non-meme / invalid media from the R2 storage bucket and all D1 tables (`memes`, `meme_curation`, `meme_curation_final`, `ai_curation_predictions`) in a single non-undoable operation.
5. **Migrations**:
   - **Migration 011 (`011_force_removals.sql`)**: Created `meme_force_removals` audit table and indexes (`idx_force_removals_removed_at`, `idx_force_removals_removed_by`, `idx_force_removals_meme_id`) to track permanent purging of non-meme content from R2 and D1.
   - **Migration 011 (`011_reconcile_active_and_curation_sync.sql`)**: Eliminated drift by enforcing $\text{status} = \text{'active'} \iff \text{is\_active} = 1$.
   - **Migration 012 (`012_add_curation_status_to_memes.sql`)**: Added `curation_status` column to `memes`, backfilling `'keep'` (111) and `'excluded'` (53) from `meme_curation_final` while leaving uncurated backlog items as `NULL`. Automatically maintained on all future superadmin single and bulk resolutions.
   - **Migration 013 (`013_add_nsfw_flag.sql`)**: Added `is_nsfw` (`INTEGER NOT NULL DEFAULT 0`) and `nsfw_flagged_by` (`TEXT`) columns to `memes` along with `idx_memes_is_nsfw` index for persistent 18+ content moderation and client-controlled delivery gating.

## Google Drive Workflow

Recommended use:

1. Upload raw memes to Google Drive as a private staging folder.
2. Copy the Drive link into the admin dashboard as `source_link`.
3. Review title, category, tags, rarity, and rights note.
4. Before production, upload the optimized file to R2 via the admin upload API.
5. Keep the Drive link as an audit/source reference, not the primary public delivery URL.

Google Drive is convenient for collecting content, but R2 is better for serving content to users.
