# Strata — Launch Checklist

**Version:** 1.0
**Date:** August 15, 2026
**Companion to:** `strata-PRD.md`, `strata-TECH_SPEC.md`

---

## How to use this

Items marked **🔒 BLOCKER** must be green before production traffic. Everything else is strongly recommended but survivable.

Strata carries three risks that a generic checklist would not catch, so they are called out repeatedly below: **cross-tenant data leakage**, **undo that doesn't fully undo**, and **a grid that stutters**. Each is a trust-destroying failure that a customer notices before you do.

> ⚠️ **Assumption:** Launch means a design-partner or private beta of 5–20 workspaces, not Product Hunt. The PRD's open questions include whether to launch self-serve at all. If this becomes a public launch, revisit the scaling and support sections — they are sized for the smaller case.

---

## Pre-Launch: Engineering

### Correctness — the three that matter most

- [ ] 🔒 **Tenant isolation test passes**, including the deliberately mis-written query with no application-level `WHERE workspace_id`, proving RLS catches it (Tech Spec §8, test 1)
- [ ] 🔒 **Every data access path goes through `withWorkspace()`** — verified by grepping for direct `db.` usage outside `src/server/db/index.ts`
- [ ] 🔒 **`SET LOCAL` used everywhere; no `SET` anywhere** — a single occurrence is a cross-tenant leak on pooled connections
- [ ] 🔒 **Undo fidelity test passes for all 9 change-set operations** — snapshot → apply → undo → deep equal, including `effective_values`, `item_field_index`, `completeness_pct`, and `path` (Tech Spec §8, test 2)
- [ ] 🔒 **Projection consistency test passes** — `item_field_index` matches a from-scratch rebuild after every mutation path (Tech Spec §8, test 3)
- [ ] 🔒 Variant resolution property tests pass across arbitrary model/variant/override combinations
- [ ] 🔒 `path`/`depth` remain consistent under arbitrary reparent sequences (property test)
- [ ] Cycle detection rejects a reparent into a descendant with `HIERARCHY_CYCLE`
- [ ] `STALE_PREVIEW` fires correctly on a concurrent edit and never auto-retries

### Code quality

- [ ] 🔒 No hardcoded secrets, API keys, or credentials anywhere in the repo — verified by a secret scanner in CI, not by reading
- [ ] `.env.example` lists every variable from Tech Spec §4, with descriptions and no real values
- [ ] No `console.log` in production paths; structured logging only
- [ ] TypeScript strict passes with zero `any` in `src/server/services/` and `src/server/search/`
- [ ] ESLint rules active: `dangerouslySetInnerHTML` banned; string concatenation inside `sql` templates banned
- [ ] Error boundaries around the grid, the detail panel, and each view type — a crashing cell renderer must not white-screen the app
- [ ] All 16 build steps in `strata-CLAUDE.md` complete, with their per-step verifications green

### Security

- [ ] 🔒 Every `/api/v1` endpoint authenticated; a scripted sweep confirms no route responds 200 without credentials
- [ ] 🔒 **Guests cannot create or use API keys** — returns `GUEST_API_FORBIDDEN` (this is what contains the field-permission gap)
- [ ] 🔒 Guest tree-node scoping verified in every view type and every list endpoint
- [ ] 🔒 **CSV injection escaping on export** — values starting with `=`, `+`, `-`, `@`, tab, or CR are prefixed with `'`. Verified by exporting a crafted row and opening it in real Excel
- [ ] Cross-tenant probing returns 404, never 403 (a 403 confirms existence)
- [ ] All input validated with Zod before any handler body runs
- [ ] Dynamic field values validated against the compiled Item Type schema; invalid values land in `invalid_values` rather than rejecting the write
- [ ] File uploads: extension + MIME + magic-byte checked, 50MB capped, parsed in a job, stored under a workspace-prefixed path
- [ ] HTTPS enforced; HSTS with `preload`; no mixed content
- [ ] CORS: session endpoints app-origin-only with credentials; API-key endpoints `*` without credentials
- [ ] CSP active with no `unsafe-eval`; `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options` set
- [ ] Rate limiting live on auth, writes, bulk, import, and export — and confirmed to **fail open** when Redis is unavailable
- [ ] API keys stored as SHA-256 + pepper; plaintext returned exactly once
- [ ] Webhook signatures verified with a constant-time compare; timestamps older than 5 min rejected
- [ ] 🔒 **Sentry `beforeSend` strips request bodies and all `values`/`effective_values` payloads.** Verified by triggering a real error on an item with distinctive content and confirming it does not appear in Sentry
- [ ] PostHog captures event names and IDs only; session replay masks all grid cell text
- [ ] Dependency audit clean (`npm audit --production`); no known high or critical

### Performance — every budget in Tech Spec §6.1

Verified against the seeded **100k-item × 40-field** workspace. A miss here is a failed acceptance criterion, not a follow-up ticket.

- [ ] 🔒 Filtered + sorted page (100 rows, 8 clauses) — **p95 < 300 ms**
- [ ] 🔒 Keystroke → rendered filtered result — **p95 < 500 ms**
- [ ] 🔒 Grid scroll at 10k loaded rows — **60 fps**, confirmed with the React Profiler
- [ ] Text search — p95 < 400 ms
- [ ] Subtree filter at depth 8 — p95 < 300 ms
- [ ] Item detail with all fields and activity — p95 < 200 ms
- [ ] Single cell write confirmed — p95 < 150 ms
- [ ] Bulk commit, 500 items, synchronous — < 3 s
- [ ] Bulk commit, 10k items, async with progress — < 60 s
- [ ] Import validation, 10k rows — < 30 s
- [ ] App shell TTI on simulated Fast 3G — < 2 s
- [ ] 🔒 `EXPLAIN` assertions in CI: **no sequential scan on `items`** in any compiled filter query
- [ ] Grid chunk lazy-loaded; total initial JS under budget (check `next build` output)
- [ ] No N+1 on item list, tree sidebar, or activity feed — verified with `pg_stat_statements`

### Database

- [ ] 🔒 All migrations applied to production; `drizzle-kit check` reports no drift
- [ ] 🔒 Every index from Tech Spec §2 present — especially the GiST indexes on `items.path` and `tree_nodes.path`, the trigram index on `search_text`, and the partial indexes on `item_field_index`
- [ ] `ltree` and `pg_trgm` extensions enabled in production
- [ ] RLS enabled and policies present on **every** tenant table — enumerate `pg_policies` and diff against the table list, do not eyeball it
- [ ] Both `items` CHECK constraints active (variant model is neither variant child nor hierarchy child)
- [ ] PgBouncer transaction pooling configured; pool size sane for the Vercel function ceiling
- [ ] 🔒 **PITR enabled and a restore rehearsed on staging** — an untested backup is not a backup
- [ ] Nightly `projectionAudit` job scheduled and alerting on drift
- [ ] `change_entries` retention/compaction job scheduled (Tech Spec §6.5)
- [ ] Every migration's duration recorded against a production-sized clone; none takes `ACCESS EXCLUSIVE` on `items`

### Jobs & async

- [ ] All Inngest functions deployed and visible in the dashboard: `bulkCommit`, `importValidate`, `importCommit`, `exportGenerate`, `variantPropagate`, `fieldBackfill`, `webhookDeliver`, `projectionAudit`
- [ ] Every job is idempotent and resumable — kill one mid-run and confirm the retry completes correctly
- [ ] `BULK_SYNC_THRESHOLD` and `VARIANT_SYNC_THRESHOLD` set to production values
- [ ] Job failures alert; they do not fail silently
- [ ] Webhook retry schedule and the 20-failure auto-disable both verified

### Monitoring & observability

- [ ] Sentry receiving errors from production with source maps and release tagging
- [ ] PostHog capturing the PRD §8 funnel: signup → workspace → Item Type created → first item → first bulk op
- [ ] `X-Request-Id` on every response and correlated into Sentry
- [ ] Uptime monitoring on `/api/health` and the app root, 1-minute interval
- [ ] Alerts configured for: error rate spike, p95 latency breach on `GET /items`, job failure rate, DB connection saturation, Redis unavailability, webhook auto-disable
- [ ] On-call destination set — where alerts actually go, and who reads it

---

## Pre-Launch: Product

### UX completeness

- [ ] Every view has empty, loading, and error states — and **empty states teach the concept** rather than just offering a button (UI/UX Notes §3)
- [ ] Grid empty state offers "Import a spreadsheet" as prominently as "Add your first item"
- [ ] All async actions show appropriate feedback per UI/UX Notes §5.4
- [ ] No raw API errors surfaced to users; every error message is specific and actionable
- [ ] 🔒 **The full grid keyboard map (UI/UX Notes §5.1) implemented exactly** — every binding, no partial fidelity
- [ ] 🔒 **Clipboard round-trip verified against real Excel and real Google Sheets, on both macOS and Windows.** This cannot be automated meaningfully and cannot be skipped
- [ ] Fill-down and fill-handle drag work, including number and date increment detection
- [ ] Undo covers ≥ 50 operations and behaves identically for a single cell and a 300-row bulk edit
- [ ] Bulk preview names the count on the commit button ("Apply to 142 items") and always reports skipped items with reasons
- [ ] Undo toast persists 60s with a draining progress line, and the activity feed offers undo for 24h
- [ ] Inherited vs. overridden variant values are distinguishable by **two channels** (color/weight and icon/bar), never color alone
- [ ] Tree node deletion always offers the three dispositions; nothing is silently orphaned
- [ ] Responsive verified at 1280, 1024, 768, and 375px per UI/UX Notes §5.6
- [ ] Favicon, page titles, meta descriptions, and OG tags set
- [ ] 404, 500, and offline states exist and are branded

### Progressive disclosure & concept teaching

- [ ] 🔒 **Time from "New Item Type" to first item created: median ≤ 2 minutes**, measured with ≥ 5 first-time users. This is the product's central bet — if it fails, delay launch rather than launching against it
- [ ] All six starter presets create working schemas with sensible fields pre-populated
- [ ] The Advanced section is collapsed by default everywhere and remembers state per user
- [ ] A user who never enables variants never encounters the words "variant," "axis," or "inheritance"
- [ ] Concept hints ship for variants, category trees, completeness, and the three-axes diagram — inline, in context, dismissible-forever per user
- [ ] ≥ 4 of 5 usability participants can correctly explain what a variant is after 15 minutes of unaided use (PRD §8)

### Onboarding

- [ ] New signup creates a workspace with the built-in tree and a default Item Type — nobody lands in a true zero state
- [ ] Onboarding tested end-to-end with a genuinely fresh account, not a reset one
- [ ] Welcome email sends and renders correctly in Gmail, Outlook, and Apple Mail
- [ ] Invite → accept → correct role and scope verified for all five roles
- [ ] First value moment (an Item Type created and one item entered) reachable within 5 minutes of signup
- [ ] Sample-data option available for someone evaluating without their own data

### Legal & compliance

- [ ] Privacy Policy published and linked in the footer and signup flow
- [ ] Terms of Service published and linked
- [ ] Cookie consent for EU visitors (analytics cookies specifically)
- [ ] GDPR: export-my-data endpoint works; deletion cascades and purges Storage within 30 days
- [ ] DPA available on request for business customers
- [ ] Subprocessor list published (Supabase, Vercel, Upstash, Inngest, Resend, Sentry, PostHog)
- [ ] 🔒 **The shared-view warning ships**, verbatim in spirit: hiding fields controls display, not permission (PRD §9 Risk 3, UI/UX Notes §3.10). Uncomfortable copy that ships anyway
- [ ] Marketing and sales materials make **no** claim of field-level security, SOC 2, or compliance certification
- [ ] Accessibility: `@axe-core/playwright` passes on every major screen; manual keyboard-only walkthrough of the grid and Item Type builder completed
- [ ] The virtualized-grid screen-reader limitation is documented, with List view named as the accessible alternative

---

## Pre-Launch: Infrastructure

- [ ] Custom domain configured, DNS propagated, `www` redirect in place
- [ ] SSL certificate active with auto-renewal; expiry tracked
- [ ] Production env vars set in Vercel — 🔒 **verified as production values, not staging or dev**
- [ ] `SUPABASE_SERVICE_ROLE_KEY` confirmed absent from any client bundle (grep the built output)
- [ ] Supabase on a paid plan with PITR; Upstash, Inngest, and Resend on plans sized above expected launch volume
- [ ] Resend sending domain verified: SPF, DKIM, and DMARC records live
- [ ] CDN caching correct for static assets; no caching of API responses
- [ ] CI/CD pipeline green end to end, including the manual migration approval gate
- [ ] Rollback procedure documented and **rehearsed once**, not just written down
- [ ] Feature flags in place for variants, async bulk, and import commit, so any one can be disabled without a deploy
- [ ] Staging kept production-shaped for future migration rehearsals

---

## Launch Day

- [ ] Deploy to production during a low-traffic window with the team available
- [ ] Smoke test on production with a real signup: create a workspace → Item Type → 20 items → bulk edit → undo → import → export
- [ ] Verify a real email lands in a real inbox (not just the provider's dashboard)
- [ ] Confirm Sentry, PostHog, and uptime monitoring are all receiving production data
- [ ] Watch the error dashboard continuously for the first 2 hours, then hourly for the first day
- [ ] Watch p95 on `GET /items` specifically — it is the endpoint that will degrade first
- [ ] Watch DB connections and job queue depth
- [ ] Someone on standby able to hotfix and to disable a feature flag
- [ ] Announce to design partners individually before any public channel
- [ ] Public channels (if applicable): LinkedIn, relevant communities. Lead the demo with **the grid doing a 300-row bulk edit with preview and undo** — not with a feature list (PRD §7)
- [ ] Support inbox monitored and a response-time expectation set publicly

---

## Post-Launch: First Two Weeks

### Watch

- [ ] Session replays of the first 20 grid sessions — this is how grid usability bugs are actually found
- [ ] Onboarding funnel drop-off: signup → workspace → Item Type → first item → first bulk op
- [ ] **Time to first Item Type** against the 2-minute target
- [ ] **Differentiator adoption**: % of workspaces using variants, a custom tree, or a bulk edit > 20 items
- [ ] **Undo rate on bulk operations** — above 10% means the preview isn't being read, and the fix is design, not copy
- [ ] Import completion rate against the 80% target
- [ ] Filter and search p95 against budget as real data volume grows
- [ ] `FIELD_NOT_FILTERABLE` frequency — high counts mean the auto-index heuristic is wrong

### Do

- [ ] Interview 5 design partners: did they build the structure they intended? Where did they get stuck?
- [ ] Ask each one directly what a variant is, unprompted — comprehension is the thesis
- [ ] Triage and fix the top bugs and papercuts weekly
- [ ] Review every support ticket for whether the answer should have been in-product instead
- [ ] Review actual metrics against the PRD §8 targets and write down what was wrong
- [ ] Revisit the PRD §10 open questions with real evidence — especially pricing, guest seats, and whether comments are needed
- [ ] Prioritize Phase 2 against what customers actually hit, not the pre-written order

### Decide

- [ ] Is the differentiator being adopted? Near-zero adoption with decent retention means users adopted a slower Monday, and the strategy needs revisiting — not more features
- [ ] Is the 1-custom-tree cap a real constraint or an obvious limitation?
- [ ] Did anyone attempt to use a shared view as a security boundary despite the warning? If so, accelerate field-level permissions

---

## Ongoing

### Weekly
- [ ] Review error logs and Sentry issue trends
- [ ] Check p95 latency against the §6.1 budgets as data grows
- [ ] Review job failure rates and webhook auto-disables
- [ ] Check `projectionAudit` drift alerts

### Monthly
- [ ] Dependency audit (`npm audit`) and patch-level updates
- [ ] Review the largest workspaces against the growth-path triggers in Tech Spec §6.5 — item counts, `change_entries` volume, variant fan-out
- [ ] Review index bloat and `pg_stat_statements` for new slow queries
- [ ] Cost review across all five providers against usage

### Quarterly
- [ ] 🔒 **Test a database restore from backup.** Untested backups fail exactly when needed
- [ ] Rehearse a full rollback
- [ ] Review RLS policies against the current table list — a new table without a policy is a latent leak
- [ ] Rotate `API_KEY_PEPPER` and webhook signing secrets with a documented dual-accept window
- [ ] Review the retention/compaction jobs' actual effect on table sizes
- [ ] SSL and domain expiry check

### Always
- [ ] Every new tenant table gets `workspace_id`, an RLS policy, and a line in the isolation test — **in the same PR that creates it**
- [ ] Every new write path goes through a change set
- [ ] Every new list endpoint uses cursor pagination
- [ ] Every new filterable field lands in `item_field_index`
- [ ] Every performance-sensitive query gets an `EXPLAIN` assertion in CI
