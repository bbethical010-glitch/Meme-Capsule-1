# AI-Judgement Review Workflow Walkthrough

This document outlines the AI-Judgement Review Workflow and the three-human majority-consensus curation flow for `/curate`.

## Overview
The `/curate` dashboard integrates pre-evaluations from offline AI models (`user-judge4` and `user-judge5`) into each human judge's independent review. Human judges 1-3 review the AI evaluations, but their own votes are not final by themselves. The three human votes determine the consensus outcome.

---

## 1. The Core AI Review States

### State A: AI Consensus (Judge 4 & Judge 5 Agree)
- **Condition:** Both AI Judge 4 and AI Judge 5 have evaluated the meme and arrived at the same `corpus_status` (e.g., both voted `keep` or both voted `excluded`).
- **UI Presentation:** High-contrast Neo-Brutalist green banner (`AI CONSENSUS: KEEP`) or red banner (`AI CONSENSUS: EXCLUDE`).
- **Curator Action:**
  - Press `Space` or `Enter` to fast-approve the consensus in a single stroke.
  - If status matches but taxonomy details differ: press `4` to adopt Judge 4, press `5` to adopt Judge 5, or press `Space`/`Enter` to adopt Judge 4 by default.
  - To disagree with both: press `O` to enter Manual Override Mode.

### State B: AI Disagreement (Conflicting Evaluations)
- **Condition:** Both AIs evaluated the meme, but their verdicts differ (e.g., Judge 4 says `keep` while Judge 5 says `excluded`).
- **UI Presentation:** High-contrast orange banner (`⚠️ AI JUDGE DISAGREEMENT`) with two side-by-side cards detailing each AI's decision, topics, tone, and humor mechanisms.
- **Curator Action:**
  - Press `4` to adopt AI Judge 4's decision.
  - Press `5` to adopt AI Judge 5's decision.
  - Press `O` to manually curate from scratch.

### State Single AI: 1 AI Evaluation Ready
- **Condition:** Only one AI (either Judge 4 or Judge 5) has processed the meme.
- **UI Presentation:** Yellow/amber banner displaying the available AI verdict with a "1 AI Ready" badge.
- **Curator Action:**
  - Press `Space` or `Enter` to instantly adopt the available AI verdict without roadmap or delay.
  - Press `O` to manually curate.

### State None: Unprocessed Meme
- **Condition:** Neither AI has evaluated the meme yet.
- **UI Presentation:** Dark card prompting the curator to open manual curation (`O`).

---

## 2. Three-Human Majority Consensus (`POST /api/curate/approve`)

Each human judge submits one independent vote for a meme. Judges 1-3 do not see each other's votes in the regular `/curate` response. A meme remains in a judge's unreviewed queue until that judge votes, even if other judges have already voted.

- With fewer than three human votes, only the submitting judge's `meme_curation` row is written. No final decision is written to `meme_curation_final` or `memes`.
- Once all three human judges vote, Layer 0 resolves by majority. Keep and excluded accept 2:1 or 3:0 outcomes; 2:1 excluded is a soft archive.
- Duplicate resolves only when the applicable majority agrees on the same `duplicate_of` target. A 1:1:1 status split or unresolved duplicate target is sent to SuperAdmin arbitration.
- Review_later is stored directly in `memes.curation_status` and remains in the secondary queue.
- Only unanimous 3:0 excluded triggers the existing Force Remove path, deleting the R2 object and related D1 rows. This is non-undoable and emits a `[force-remove]` log entry.
- `meme_curation_final` is written only for keep/excluded. Resolved topics, tone, humour mechanisms, and duplicate target are stored directly on `memes` after additive Migration 014. Existing `tags` and `category` mapping remains `tags = JSON.stringify(topics)` and `category = topics[0]` for kept memes.

The AI review UI and hotkeys remain unchanged: States A/B/C still display AI Judge 4/5 context, and the existing `Enter`/`4`/`5`/`O` flow is used to form each judge's own vote.

## 3. Destructive Action: FORCE REMOVE (`Shift+Delete` / `POST /api/curate/force-remove`)

For non-meme uploads (e.g., random photos, corrupt images, spam):
- **Hotkey:** `Shift+Delete` or `Shift+Backspace`.
- **UI Button:** Prominent red `🗑️ FORCE REMOVE [SHIFT+DEL]` button available in both AI Review and Override views.
- **Physical Deletion:**
  - Deletes the media file directly from the Cloudflare R2 bucket (`env.MEMES_BUCKET`).
  - Purges all records across D1 tables: `memes`, `meme_curation`, `meme_curation_final`, `ai_curation_predictions`, `meme_events`, `meme_analytics`, `meme_daily_stats`.
- **Safety:** This action is intentionally non-undoable.

---

## 4. Keyboard Shortcuts Summary

### AI Review Mode (Default)
| Key | Action |
|---|---|
| `Space` or `Enter` | Fast-approve AI Consensus / Instantly Adopt Single AI |
| `4` | Adopt AI Judge 4 decision |
| `5` | Adopt AI Judge 5 decision |
| `O` | Enter Manual Override Mode |
| `Shift + Delete` | **FORCE REMOVE** (Permanently delete from R2 & D1) |
| `Ctrl + Z` / `Cmd + Z` / `U` | Undo last curation decision |
| `←` / `→` | Previous / Next meme in queue |

### Manual Override Mode (`O`)
| Key | Action |
|---|---|
| `Space` or `Enter` | Confirm & Advance manual curation |
| `K` | Keep |
| `X` | Exclude & Advance |
| `D` | Mark Duplicate |
| `R` | Review Later & Advance |
| `1-9, 0, -, =` | Toggle Topics (Max 3) |
| `Q, W, E, A, S, F` | Select Tone (1 dominant) |
| `Z, C, V, B, N, M, J, P, O` | Select Humor Mechanisms (Max 2) |
| `Esc` | Return to AI Review view |
| `Shift + Delete` | **FORCE REMOVE** (Permanently delete from R2 & D1) |
| `Ctrl + Z` / `Cmd + Z` / `U` | Undo last curation decision |
| `←` / `→` | Previous / Next meme in queue |

---

## 5. Verification & Testing
- **TypeScript & Vite Build:** Verified on October 17, 2026 with `npm run build` (0 errors, 1,634 modules transformed).
- **Consensus resolver tests:** Verified with `node --experimental-strip-types --test tests/curationConsensus.test.mjs` (9 passing tests covering pending votes, keep/excluded outcomes, arbitration, duplicate targets, review_later, AI fallback, and taxonomy ordering).
- **API integration:** Wrangler rejected `pages dev --config <custom-path>` because Pages requires its standard root configuration. Retrying with the root config started Pages against an isolated D1, but endpoint smoke requests were blocked because the local database bootstrap did not create `meme_curation`. No production/remote resources were used, and end-to-end API behavior remains unverified.
- **Routes updated:** `POST /api/curate/approve`, `POST /api/curate/force-remove`, `GET /api/curate/next`, and SuperAdmin arbitration query/resolve endpoints.
- **Migration rationale:** Migration 014 adds persisted resolved Layer 1-3 and duplicate-target fields to `memes`; those fields were absent from the existing schema, so the consensus result otherwise could not be persisted as required.

---

## 6. NSFW Flag Integration (Safe by Default & Public Delivery)

### 6.1 Database Migration & Schema
- Added `d1/migrations/013_add_nsfw_flag.sql` adding `is_nsfw INTEGER DEFAULT 0` and `nsfw_flagged_by TEXT`, plus index `idx_memes_is_nsfw`.
- Synchronized baseline schema in `d1/schema.sql` and updated `src/types.ts`.

### 6.2 Public Delivery Contract
- Core queries in `functions/_shared/d1r2.ts` default to filtering:
  `AND (m.is_nsfw IS NULL OR m.is_nsfw = 0)`.
- Passing `?nsfw=1` or `?nsfw=true` to `GET /api/random-meme`, `GET /api/daily-meme`, or `GET /api/memes/random` relaxes this filter to include NSFW memes.
- Privacy preservation: Client-side mobile app DOB/age calculation remains on-device; backend receives only the boolean toggle flag.

### 6.3 AI & Curator Classification
- Multimodal AI vision pre-judge (`functions/api/ai-judge/classify.ts`) and Python/NIM sync (`functions/api/admin/ai-categorise.ts`) detect NSFW/adult content and set `is_nsfw = 1, nsfw_flagged_by = 'ai-judge'`.
- Curator toggle on `/curate` (`functions/api/curate/nsfw.ts` & `src/curate/CurateApp.tsx`) allows instant non-destructive NSFW tagging.
- Admin dashboard (`/admin`) features an NSFW filter tab and cyber-pink badge.
- Reports moderation (`/reports`) allows non-destructive "Mark NSFW" resolution.

