# Quoting API v1

Turn a walkthrough video into a priced, costed cleaning job.

You send frames sampled from a video of the property. You get back how many
minutes of labor it represents, a price in your currency, the supplies the job
needs, and your own margin on it.

The estimate is not a lookup table on bedroom count. Time is computed from what
is actually visible — how greasy the kitchen is, whether the bathroom has mold,
how much clutter is in the way — and then corrected by a time model fitted to
**your** completed jobs, not ours.

---

## Authentication

Send your API key as a bearer token:

```
Authorization: Bearer hk_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

`X-API-Key: <key>` also works if a bearer token is awkward in your stack.

Keys are shown once, at creation, and stored only as a hash. If a key is lost
it is replaced, never recovered.

**This is a server-to-server API.** No CORS headers are sent, deliberately: a
key in browser JavaScript is a published key. Call it from your backend.

---

## `POST /api/v1/quote`

### Request

```json
{
  "frames": ["data:image/jpeg;base64,...", "https://your-cdn.com/frame2.jpg"],
  "serviceSlug": "deep-cleaning",
  "reference": "JOB-2026-8891"
}
```

| Field | Required | Notes |
|---|---|---|
| `frames` | yes | 1–20 frames. Inline `data:` JPEG/PNG/WebP, or public `https://` URLs. **400 KB per frame, 4 MB per request.** |
| `serviceSlug` | yes | See the list below. |
| `reference` | no | Your own job ID, echoed back so you can reconcile. |

Sample 6–12 frames spread across the walkthrough. More frames from the same
room does not improve the estimate; coverage of *different* rooms does.

**Size the frames before sending.** Downscale to 768px on the long edge and
encode as JPEG at ~0.7 quality — that lands around 60–120 KB each, well inside
both limits, and the analysis is no worse for it. Full-resolution phone frames
will blow the 4 MB request budget at three or four images.

**On https frame URLs:** they must point at a public hostname on port 443.
Raw IP addresses, private and internal hosts, non-standard ports and embedded
credentials are rejected — a frame URL is fetched by our analysis backend, and
we will not let a caller aim that at an address only they can see.

**Service slugs:** `house-cleaning`, `apartment-cleaning`, `deep-cleaning`,
`move-in-cleaning`, `move-out-cleaning`, `airbnb-cleaning`, `office-cleaning`,
`commercial-cleaning`, `post-construction-cleaning`.

### Response `200`

```json
{
  "reference": "JOB-2026-8891",
  "currency": "USD",
  "quote": {
    "low": 148, "high": 227,
    "tax": 17, "totalLow": 161, "totalHigh": 247,
    "taxNote": "NYC sales tax",
    "minutes": 150, "hours": 2.5, "crewSize": 1
  },
  "internal": {
    "laborCost": 100, "supplyCost": 14, "margin": 74
  },
  "property": {
    "condition": "fair", "confidence": 0.72,
    "rooms": [
      { "type": "kitchen", "label": "Kitchen", "condition": "poor",
        "minutes": 62, "soil": { "grease": 70, "dust": 30, "...": 0 },
        "objects": [{ "name": "oven", "count": 1, "confidence": 0.8 }] }
    ]
  },
  "supplies": {
    "lines": [{ "id": "degreaser", "name": "Heavy-duty degreaser (concentrate)",
                "quantity": 1, "unit": "gallon", "estimatedCost": 2.0,
                "reason": "Heavy kitchen grease", "hazard": "caustic" }],
    "ppe": ["gloves"],
    "safetyWarnings": ["..."],
    "totalCost": 14.2
  },
  "warnings": [],
  "engine": { "source": "vision-llm", "calibratedOn": 40 },
  "usage": { "used": 12, "limit": 500, "remaining": 488, "period": "2026-08" }
}
```

**`quote` is what you may show your customer. `internal` is not** — it is your
cost structure. They are separated in the payload so a careless template can't
put your margin on a customer's estimate.

### Two things worth reading twice

**`quote.low`–`quote.high` is a confidence band, not a sales tactic.** The
range widens when the footage is poor. A narrow band means the analysis was
confident; a wide one is the model telling you a human should look before you
commit to a fixed price.

**`supplies.safetyWarnings` is not decorative.** It fires when the job needs two
products that must never meet — bleach with ammonia releases chloramine gas,
bleach with acid releases chlorine gas. Surface it to whoever packs the van.

### Errors

| Status | `error` | Meaning |
|---|---|---|
| 400 | `invalid_json` | Body was not valid JSON. |
| 401 | `invalid_api_key` | Missing, malformed, unknown, or deactivated key. |
| 422 | `invalid_request` | Failed validation; `message` says which field. |
| 422 | `invalid_frames` | Wrong format, oversized, or a non-https URL. |
| 422 | `no_rooms_detected` | Nothing identifiable in the footage. |
| 429 | `quota_exceeded` | Monthly quota spent. Includes a `usage` object. |

---

## `GET /api/v1/usage`

Quota and month-to-date quoted value. Free — it does not consume a quote, so
you can poll it for your own dashboard.

```json
{
  "tenant": { "name": "Sparkle Cleaning Ltd", "slug": "sparkle-cleaning-ltd", "plan": "growth" },
  "period": "2026-08",
  "quotes": { "used": 12, "limit": 2500, "remaining": 2488 },
  "quotedValue": 4310.5,
  "currency": "GBP",
  "calibration": { "sampleSize": 40, "globalTimeFactor": 0.8, "calibratedAt": "2026-08-01T09:00:00.000Z" }
}
```

---

## Calibration — why the same footage prices differently for you

Every account carries its own time model. Out of the box you get our shipped
constants, which are a starting hypothesis, not a fact about your business.

As your completed jobs accumulate — predicted minutes against actual minutes —
the model is refitted to your crews:

- **`globalTimeFactor`** — one dial for "we run faster/slower than baseline".
  `0.8` means your teams finish in 80% of the default time. This alone removes
  most of the systematic error.
- **`roomBaseMinutes`** — per-room-type corrections, for the rooms you handle
  differently from the average.
- **`serviceMultiplier`** — what each service actually means in your operation.

`engine.calibratedOn` tells you how many jobs the current model was fit on.
While it reads `0`, you are running on our defaults and should treat the
estimates as a starting point, not a committed price.

The practical consequence: identical frames sent by two accounts return
different minutes and different money — different rate, currency, tax rule,
supply costs and crew speed. That is the intended behavior, and it is the
reason the estimate gets better the longer you use it.

---

## Quotas

| Plan | Quotes / month |
|---|---|
| `trial` | 50 |
| `starter` | 500 |
| `growth` | 2,500 |
| `scale` | 25,000 |

Quotas are calendar months in **UTC**, so a billing period never shifts under
daylight saving. Requests raced at the boundary may land a small number over
the limit; that is a billing line, not a blocked request.

---

## Example

```bash
curl -X POST https://your-domain.com/api/v1/quote \
  -H "Authorization: Bearer $HOMIGO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "frames": ["data:image/jpeg;base64,/9j/4AAQ..."],
    "serviceSlug": "deep-cleaning",
    "reference": "JOB-2026-8891"
  }'
```
