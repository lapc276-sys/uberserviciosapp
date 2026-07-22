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

## What's built (Phase 1 — live & compiling)

✅ Premium marketing site — home, services, areas, about, contact, careers, blog, FAQ, legal
✅ **Config-driven** services (9) and city landing pages (5), each SEO-optimized
✅ Full **technical + local SEO**: schema.org JSON-LD, sitemap, robots, OG/Twitter, breadcrumbs, canonicals
✅ **Instant quote engine** (`lib/quote.ts`) — one deterministic pricing source shared by web, API and chatbot
✅ **60-second booking flow** — multi-step, live quote, validated intake (`/book` + `/api/book`)
✅ **AI chatbot widget** — OpenAI-powered with a deterministic rules-based fallback (works with no API key)
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

---

## Roadmap

### Phase 1 — Marketing engine & booking ✅ (this release)
Premium site, SEO, config-driven services/cities, instant quotes, booking flow, chatbot, admin preview.

### Phase 2 — Data & auth
- Supabase/Postgres schema (customers, addresses, bookings, invoices, employees, reviews)
- Prisma models, migrations
- Auth (customer + admin) with roles & permissions
- Persist bookings/leads; wire admin dashboard to real data
- MDX/CMS-driven blog for SEO content velocity

### Phase 3 — Payments & messaging automation
- Stripe checkout, invoices, recurring billing
- Resend transactional email + Twilio SMS (confirmations, 24h/2h reminders)
- Google Calendar sync + employee dispatch notifications

### Phase 4 — Ops & lifecycle automation
- Pro-matching engine (nearest available, ratings)
- Reminder + review-request + 1-week follow-up jobs (Redis/QStash)
- Full CRM (history, photos, follow-ups, LTV/CAC)

### Phase 5 — Admin & analytics
- Live KPI dashboard, calendar, service map
- Analytics: CAC, LTV, ROI, conversion, funnel, SEO/CTR

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
