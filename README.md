# Homigo — Home services, on autopilot

The most automated home-services company, built to sell. Cleaning first, engineered from day one to scale into painting, moving, handyman, landscaping, pressure washing, junk removal and more — **without rewriting the system**.

> Goal isn't technology. The goal is **customers, bookings and revenue**. Every decision here optimizes for finding customers on Google, converting them in 60 seconds, and running the back office with AI.

---

## Why this architecture wins

Everything customer-facing is **config-driven**. Services, service-area cities and future business lines are *data*, not code:

| Add this…            | …by editing            | You automatically get                                            |
| -------------------- | ---------------------- | --------------------------------------------------------------- |
| A cleaning service   | `lib/config/services.ts` | A page at `/services/[slug]`, schema.org markup, pricing rule, booking option, chatbot knowledge, sitemap entry |
| A city               | `lib/config/cities.ts`   | A fully SEO-optimized local landing page at `/areas/[slug]` with LocalBusiness + Service schema |
| A new business line  | `lib/config/verticals.ts`| A pre-modeled vertical ready to flip from `soon` → `live`        |

This is the mechanism that satisfies *"escalar sin rehacer el sistema"*.

---

## Tech stack

- **Next.js 15** (App Router, RSC) + **React 19** + **TypeScript** (strict)
- **TailwindCSS** — premium design system (Apple / Stripe / Linear inspired), dark mode, smooth motion
- **Zod** — runtime validation on every API boundary
- **lucide-react** — icon system driven by config strings
- SEO-first: dynamic **metadata**, **JSON-LD** (Organization, LocalBusiness, Service, FAQ, Breadcrumb), **sitemap**, **robots**, **OpenGraph / Twitter cards**, canonical URLs
- Integrations are **env-gated**: the whole platform runs with zero keys and lights up as you add them (OpenAI, Stripe, Resend, Twilio, Google Calendar, Supabase, Redis).

Deploy target: **Vercel** + Cloudflare. Data layer (Phase 2): **Supabase / Postgres**.

---

## Business model: marketplace

Homigo operates as a **marketplace**, not an employer. Pros are independent
contractors who apply, choose their own service areas, and are **free to accept
or decline every job**. That right to decline is modeled explicitly (`JobOffer`)
rather than implied — it is a core product mechanic and a factor in worker
classification.

> ⚠️ Worker classification, licensing, insurance and sales tax vary by state and
> city. New York in particular applies strict contractor tests. Confirm your
> structure with employment counsel and an accountant before launching a market.
> `lib/config/cities.ts` carries per-market tax config with published rates —
> verify them; they change.

**How dispatch works:** a booking is offered to the top 3 approved pros covering
that city (lightest load that date first, then rating). First to accept claims
it; the rest expire. Admins can re-offer or force-assign if a round goes unclaimed.

## Vision AI — quote from a video walkthrough

The differentiator: a customer records a 60-second walkthrough and gets a real
price without an in-person estimate.

```
video → frames (in-browser) → vision model → rooms + objects + soil scores
      → time model → crew size + supplies → priced quote → booking
```

**Design decisions worth knowing:**

- **Frames are extracted in the browser** (`lib/vision/frames.ts`), so the video
  never leaves the device, there's no ffmpeg in a serverless runtime, and the
  upload is ~8 small JPEGs instead of hundreds of megabytes.
- **The vision backend is swappable** (`VisionAnalyzer` in `lib/vision/types.ts`).
  A hosted multimodal model runs today with no GPU infrastructure; a self-hosted
  YOLO/SAM/Grounding DINO service can implement the same interface later and drop
  in at `getAnalyzer()` without touching a single caller.
- **The model never estimates time or price.** It reports what it sees (rooms,
  objects, soil 0–100). Minutes and dollars are computed in code
  (`lib/vision/model.ts`, `estimate.ts`, `pricing.ts`) so the arithmetic is
  auditable and tunable.
- **Confidence widens the price band.** A dark or blurry walkthrough produces a
  wider range and a visible warning, rather than a confident wrong number.
- **Without an API key the flow still works** in demo mode, labeled as such so it
  is never mistaken for a real inspection.

> ⚠️ **The time model is a hypothesis until calibrated.** No model knows a greasy
> kitchen takes 52 minutes. `ROOM_BASE_MINUTES` and the soil weights are starting
> estimates. Pros must record `actualMinutes` on completed jobs; `/admin/vision`
> then reports bias, mean absolute error and hit rate so the constants can be
> tuned per market. **Until that page shows real accuracy data, treat quotes as
> provisional.**

## What's built (Phases 1–5 + marketplace + vision — live & verified)

**Vision AI** ✅
- `/quote/video` — record or upload a walkthrough, in-browser frame sampling, live analysis
- Per-room breakdown: soil scores across 7 dimensions, detected objects, condition, minutes
- Crew sizing, supply list derived from findings, tax-aware pricing, pro payout vs. platform margin
- `/admin/vision` — calibration dashboard (predicted vs. actual, bias, error, hit rate)
- Ground-truth capture via `POST /api/admin/bookings/[ref]/actual`



**Marketing automation** ✅
- **First-touch attribution**: UTM tags, `gclid`/`fbclid` and referrer inference captured in middleware and carried onto the booking. `/admin/marketing` reports bookings, booked value and **max CAC** per channel — the number that says whether a campaign pays for itself
- **Promo codes** (`lib/marketing/promos.ts`): percent or flat, with service, city, minimum-spend and first-time rules. Re-validated server-side on every booking, so a code typed into the form never gets the discount it claims
- **Lifecycle campaigns**: customers auto-segment into lapsed / one-time / loyal / high-value from booking history, each with its own message and cooldown. Runs weekly by cron, honors the opt-out list, and every send carries the CAN-SPAM footer
- **Messenger + Instagram DMs** answered by the same assistant brain as web, WhatsApp and voice
- `?dryRun=1` on the campaign cron reports who *would* be emailed before anything goes out

**Voice AI agent** ✅
- Answers calls on your Twilio number and runs the conversation: qualify → quote → text a booking link → transfer to a human on request
- Runs on the **same assistant brain** as web chat and WhatsApp, so a phone quote matches the website to the dollar (verified: $308–$393 on both channels)
- Prices come from `calculateQuote`, never from the model — a caller can't be told an invented number
- Speech is rewritten for synthesis (`speakable()`): amounts are spoken as dollars, URLs are texted rather than read aloud
- Twilio request signatures are verified (403 without a valid one), so learning the webhook URL doesn't let anyone drive your phone agent
- Unintelligible turns retry twice then exit gracefully with an SMS link; every call is captured as a lead, including hang-ups before quoting

> **On "completely natural":** this uses Twilio speech recognition plus a neural
> TTS voice — it is a turn-based agent, so there's a beat between the caller
> finishing and the reply. True interruptible, real-time conversation needs a
> streaming voice model over a persistent WebSocket, which doesn't fit
> serverless. The turn-based agent handles the qualify-and-quote job well; treat
> streaming as a later upgrade, not a missing feature.

**Pro accounts & payouts** ✅
- Passwordless magic-link sign-in (`/pros/login`) — separate cookie and JWT audience from admin, so a token can never cross surfaces
- Links are single-use (`UsedToken`) and expire in 15 minutes; the request endpoint never reveals whether an email belongs to a pro
- `/pros` dashboard: open offers, schedule, earnings — `/pros/payouts` runs Stripe Connect Express onboarding so Stripe holds bank and tax details, not us
- Payouts issue on job completion, once per booking (unique constraint + Stripe idempotency key derived from the ref)
- Claiming a job is authorized server-side: a pro can only accept work actually offered to them (403 otherwise), and the address plus customer contact appear only after claiming

**Marketplace** ✅
- `Pro` model with application → approval → active lifecycle, service areas, ratings
- Public `/pros/apply` — supply-side acquisition page with SEO + FAQ schema
- `/pros/jobs/[ref]` — pro-facing offer with pay shown up front; address withheld until claimed
- First-to-accept dispatch with a race-safe conditional claim; losers get a clear 409
- Admin `/admin/pros`: review applications, approve, suspend



**Phase 5 — Analytics** ✅
- `/admin/analytics`: booked value, average ticket, lead→booking conversion, completion rate, recurring share
- Conversion funnel (leads → bookings → completed), 14-day demand chart, booked value by service, bookings by city (with table view)
- Zero chart dependencies (server-rendered), brand hue validated for light & dark surfaces, works on in-memory or DB data
- `SETUP.md`: step-by-step account setup guide (Vercel → Supabase → Stripe → Resend → Twilio → WhatsApp → OpenAI → GA4/Pixel)



**Phase 4 — Operations & lifecycle** ✅
- **Dispatch engine** (`lib/dispatch.ts`) — since superseded by the marketplace offer/accept model above
- **Admin CRM**: `/admin/bookings` (dispatch + manage status), `/admin/customers` (with lifetime value), `/admin/pros` (roster + approvals)
- **Protected admin API** (`/api/admin/bookings/[ref]`): status updates, re-offer and force-assign, gated by RBAC permission
- **One-week win-back** email (15% off) added to the cron lifecycle
- **Dashboard** gains average customer LTV; Prisma gains `Photo` model + `followUpSent` flag
- Verified: 3 bookings load-balanced 1-per-pro; status change via API 200; unauthenticated API 401



**Phase 3 — Payments & messaging automation** ✅
- **Stripe** (`lib/stripe.ts`): hosted invoice created per booking; `/api/stripe/webhook` verifies signatures and reconciles paid invoices
- **Resend** (`lib/email.ts`): branded HTML confirmation, reminder and review-request emails
- **Twilio** (`lib/sms.ts`): SMS confirmations and reminders
- **Automation pipeline** (`lib/automations.ts`) now fires real email + SMS + invoice on every booking (env-gated, dry-run without keys)
- **Time-based automations** via `/api/cron/reminders` (Vercel Cron, hourly): 24h + 2h reminders and post-service review requests, each guarded by a per-booking flag so it fires exactly once
- Verified: booking → 24h reminder + review request sent once; second run is a no-op (idempotent); Stripe webhook rejects bad signatures (400)



**Phase 2 — Data & auth** ✅
- **Prisma + PostgreSQL** data model: users, customers, addresses, employees, bookings, invoices, reviews, leads (Supabase-ready, vertical-agnostic)
- **Persistence layer** (`lib/data.ts`) with a two-backend switch: Prisma when `DATABASE_URL` is set, in-memory otherwise — the app runs with zero infrastructure
- `/api/book` now **persists bookings + captures leads**
- **Admin auth**: JWT sessions (jose, edge-safe), scrypt password hashing, RBAC (ADMIN / DISPATCHER / STAFF), bootstrap admin via env
- **Protected `/admin`** via middleware; login/logout flow; admin shell with sidebar + sign-out
- **Dashboard wired to real data** (live KPIs + recent bookings)
- Seed script (`npm run db:seed`)

Verified end-to-end: unauthenticated `/admin` → 307 to login · wrong password → 401 · correct → session + role · booking persisted and rendered in the dashboard.



✅ Premium marketing site — home, services, areas, about, contact, careers, blog, FAQ, legal
✅ **Config-driven** services (9) and city landing pages (5), each SEO-optimized
✅ Full **technical + local SEO**: schema.org JSON-LD, sitemap, robots, OG/Twitter, breadcrumbs, canonicals
✅ **Instant quote engine** (`lib/quote.ts`) — one deterministic pricing source shared by web, API and chatbot
✅ **60-second booking flow** — multi-step, live quote, validated intake (`/book` + `/api/book`)
✅ **AI chatbot widget** — OpenAI-powered with a deterministic rules-based fallback (works with no API key)
✅ **WhatsApp AI agent** (Meta Cloud API) — the *same* assistant brain (`lib/assistant.ts`) answers on WhatsApp with identical pricing, capturing every chat as a lead. Webhook at `/api/whatsapp`
✅ **Automation pipeline seam** (`lib/automations.ts`) — email, SMS, calendar, invoicing, reminders, review requests (env-gated stubs)
✅ **Admin dashboard** preview (`/admin`) — KPIs, recent bookings
✅ Dark mode, responsive, fast (static-first, ~102 kB shared JS), accessible

Run it:

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build (35 static/SSG pages)
npm run typecheck
```

Copy `.env.example` → `.env.local` to enable integrations. **Nothing is required** to run in dev.

**Enable database persistence + admin login:**

```bash
# 1. Set DATABASE_URL (Supabase/Postgres), AUTH_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD in .env.local
openssl rand -base64 32          # value for AUTH_SECRET
npm run db:push                  # create tables from the Prisma schema
npm run db:seed                  # optional: admin user + sample data
```

Then sign in at **`/admin/login`**. Without `DATABASE_URL`, the admin login still works (bootstrap admin from env) and the dashboard shows in-memory bookings.

---

## Roadmap

### Phase 1 — Marketing engine & booking ✅
Premium site, SEO, config-driven services/cities, instant quotes, booking flow, chatbot, admin preview.

### Phase 2 — Data & auth ✅
Prisma/Postgres schema, persistence layer with in-memory fallback, booking + lead persistence, JWT+RBAC admin auth, protected dashboard on real data, seed script.
_Remaining polish: customer-facing auth/portal, DB migrations in CI, MDX/CMS blog._

### Phase 3 — Payments & messaging automation ✅
Stripe invoices + webhook reconciliation, Resend transactional email, Twilio SMS, and cron-driven 24h/2h reminders + review requests.
_Remaining: recurring billing subscriptions, Google Calendar sync._

### Phase 4 — Ops & lifecycle automation ✅
Dispatch/pro-matching engine, admin CRM (bookings, customers w/ LTV, team), protected admin API, one-week win-back automation.
_Remaining: photo upload (Supabase Storage), geo-aware matching, Redis-backed job queue._

### Phase 5 — Admin & analytics ✅
Analytics dashboard: funnel, conversion, demand trend, value by service/city.
_Remaining: calendar view, service map, ad-spend inputs for true CAC/ROI (needs GA4/Ads data)._

### Phase 6 — Voice AI & channels
- Voice agent (Twilio + realtime AI): answer calls, quote, book, transfer, SMS/email, CRM write
- Google Business (reviews, auto-replies, posts, Q&A), Facebook/Instagram/Messenger automation
- Email marketing lifecycle campaigns

### Phase 7 — Growth
- Google/Facebook/Instagram Ads + remarketing, coupons, landing-page system
- Programmatic SEO across every service × city

### Phase 8 — Multi-vertical launch
Flip painting / moving / handyman / landscaping / pressure washing / junk removal to `live`. The site, SEO, booking and CRM already support them by design.

---

## Project structure

```
app/
  page.tsx                 Home (hero, services, how-it-works, automation, pricing, FAQ, CTA)
  services/[slug]/         Config-driven service pages (SSG + schema)
  areas/[city]/            Config-driven local SEO pages (SSG + LocalBusiness schema)
  book/                    60-second booking flow
  admin/                   Dashboard preview
  api/{chat,quote,book}/   Chatbot, pricing, booking intake
  sitemap.ts robots.ts manifest.ts
components/
  layout/ ui/ home/ booking/ chat/ seo/ analytics/
lib/
  config/{site,services,cities,verticals}.ts   Single source of truth
  quote.ts     Deterministic pricing engine
  schema.ts    JSON-LD builders
  seo.ts       Metadata factory
  automations.ts  Env-gated booking automation pipeline
```

---

© Homigo Home Services LLC. Built to sell.
