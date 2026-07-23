# Phone-Dwell Specification — how long a look counts as a "likely call"

**What this document answers:** exactly how long a visitor must keep a phone or
text number on screen, and under what conditions, before the dashboard counts it
as a *Likely off-site call*. Every number here is the literal value the code
enforces, cited to its source. If you change a threshold, change it in
[`src/analytics-classification.mjs`](src/analytics-classification.mjs) — the one
place both the browser and the server read — and this doc.

---

## 1. The short answer

A desktop visitor who never clicks the number counts once the number has been
**at least half on screen, with the visitor present, for:**

| How the look ended | Time required | Why the difference |
| --- | --- | --- |
| **They left the number** — switched tab, clicked away to another app/window, or went idle | **≥ 4 seconds** | Stopping *at* the number is strong evidence they picked up a phone to dial it. |
| **They scrolled the number away** but kept using the site | **≥ 8 seconds** | They stayed on the page, so a shorter look is ambiguous; it needs to be a deliberate, longer read. |

Below the required time → **nothing is recorded.** This is intentional. The
metric is a *floor on interest*, never a proven call.

> The dwell clock counts **active, on-screen seconds**, not wall-clock time. Time
> while the tab is hidden, while the number is scrolled off, or after the visitor
> has gone idle does **not** count. See §4.

---

## 2. What moves — and what does *not*

Clicking a number and *dwelling* on a number are opposite signals. Be clear
about which one you are testing.

| Action | Event recorded | Dashboard number it moves |
| --- | --- | --- |
| **Click** a `tel:` / `sms:` / `mailto:` link (any device) | `cta_click` | **High-intent actions**, the **CTA table** (Clicks), the **Intent grid** (Phone/Text/Email link clicks) |
| **Dwell** on a `tel:` / `sms:` number without clicking (**desktop only**) | `phone_dwell` | **Likely off-site calls**, and the **"Read & dialed"** column of the CTA table |

Three consequences that surprise people:

1. **Clicking a phone button does _not_ increment "Likely off-site calls."** The
   click is already the strongest possible signal, so it is counted as a
   high-intent click instead. If you click the number *and* linger, the click
   wins and the dwell is suppressed for that number
   ([`site-analytics.js`](src/client/site-analytics.js#L247), and the dwell guard
   `if (!clickedContactCtas.has(detail.ctaId))`).
2. **Phone dwell is desktop-only.** On a phone, tapping the number *is* the call,
   and that tap is already a `cta_click`. A mobile visit can never produce a
   `phone_dwell` — the browser doesn't run the dwell timer
   ([`site-analytics.js`](src/client/site-analytics.js#L260-L261)) and the server
   rejects any dwell whose device isn't `desktop`
   ([`analytics.mjs`](src/analytics.mjs#L157)).
3. **Phone dwell is deliberately excluded from "High-intent actions."** It is
   inferred from a timer, not a click, so folding it in would change what that
   headline number means
   ([`analytics.mjs`](src/analytics.mjs#L293-L297)).

---

## 3. The exact thresholds

All defined once, frozen, and shared, in
[`src/analytics-classification.mjs`](src/analytics-classification.mjs#L33-L44):

| Constant | Value | Meaning |
| --- | --- | --- |
| `minMs` | **4000 ms (4 s)** | Minimum on-screen dwell for a look that ended in a **handoff** — window blur, tab hidden, or idle. |
| `activeMs` | **8000 ms (8 s)** | Minimum on-screen dwell for a look that ended only because the number **scrolled out of view** while the visitor kept using the page. |
| `idleMs` | **45000 ms (45 s)** | No pointer, key, wheel, or scroll for this long ends the dwell. Prevents an abandoned tab from reading as an hour-long call. |
| `maxMs` | **600000 ms (10 min)** | Hard cap on a single dwell. Anything longer is clamped to 10 minutes; the server rejects a raw value above this. |
| `tickMs` | **1000 ms (1 s)** | The dwell timer granularity — dwell is measured in ~1-second increments. |

**Exit reasons, strongest → weakest evidence** ([line 47](src/analytics-classification.mjs#L47)):
`blur` → `hidden` → `idle` → `dwell`.
The first three require **4 s** (`minMs`); `dwell` (scroll-away / page unload)
requires **8 s** (`activeMs`).

---

## 4. What starts and stops the clock

The timer lives in `setupPhoneDwell()`
([`site-analytics.js`](src/client/site-analytics.js#L260-L331)) and runs once per
second.

**A number accrues dwell time only while _all_ of these are true:**

- The element is a `tel:`, `sms:`, or `[data-analytics-phone]` target that is
  **≥ 50 % visible** in the viewport (`intersectionRatio >= 0.5`).
- The **tab is the foreground tab** (`document.visibilityState === 'visible'`).
- The visitor has been **active within the last 45 seconds** (`idleMs`) — any
  pointer move, key, scroll, or wheel resets the idle clock.
- The device is **desktop**.

**Anti-inflation guard:** each 1-second tick credits at most **3 seconds**
(`tickMs * 3`) of dwell ([line 293](src/client/site-analytics.js#L293)). A laptop
that sleeps or a throttled background timer can skip minutes between ticks; this
cap means a resumed tab can't dump that gap onto the counter.

**The look ends (and is evaluated against the threshold) when:**

| Trigger | Exit reason | Threshold applied |
| --- | --- | --- |
| Visitor leaves the browser window (`blur`) | `blur` | 4 s |
| Tab hidden / minimized / switched (`visibilitychange` → hidden) | `hidden` | 4 s |
| 45 s with no input while the number is visible | `idle` | 4 s |
| Number scrolled below 50 % visible | `dwell` | 8 s |
| Page unloads (`pagehide`) with the number still on screen | `dwell` | 8 s |

At the end, dwell is rounded, clamped to `maxMs`, and compared to the applicable
floor ([`report()`](src/client/site-analytics.js#L271-L283)). Meets it → a
`phone_dwell` event is queued. Misses it → discarded silently.

**Once per page load per number.** After a number reports, it will not report
again on that page load (`state.reported`). When every number on the page has
reported, the timer stops entirely.

---

## 5. Two enforcement layers, one set of numbers

The browser timer and the server validator read the **same** frozen constants, so
they can't drift apart and admit a signal the client would never have produced.

- **Browser** ([`site-analytics.js`](src/client/site-analytics.js#L271-L283)) —
  applies the 4 s / 8 s floor before sending anything.
- **Server** ([`analytics.mjs`](src/analytics.mjs#L147-L158)) — independently
  rejects a `phone_dwell` unless: `ctaType` is `phone`/`sms`; `4000 ≤ dwellMs ≤
  600000`; the exit reason is one of the four known reasons; a `dwell`-reason
  event is `≥ 8000 ms`; and the device is `desktop`. A hand-crafted request that
  violates any of these is dropped with `400`.

---

## 6. From event to the number on screen

Once a `phone_dwell` event is accepted, aggregation
([`analytics.mjs`](src/analytics.mjs#L279-L325)) does this:

- **`phoneDwellSignals`** += 1 — one per *number* that qualified.
- **`phoneDwellMs`** += the dwell duration — used for the **average** shown under
  the card (`averagePhoneDwellMs = phoneDwellMs / phoneDwellSignals`).
- **`phoneDwellSessions`** += 1 **only the first time in a session** — this is the
  headline **"Likely off-site calls"** number
  ([dashboard](src/client/admin.js#L295)).

> **One visit = at most one likely call.** If a visitor lingers over the office
> line *and then* the owner's line in the same session, that's **two signals but
> one session** — counted as one likely call, because it's most likely one person
> deciding who to phone. (Verified in
> [`tests/emulator-integration.mjs`](tests/emulator-integration.mjs#L93-L96).)

The per-number detail (count + average dwell) also appears in the CTA table's
**"Read & dialed"** column ([dashboard](src/client/admin.js#L233)).

---

## 7. Worked examples

Assume a **desktop** visitor on the homepage, office number `(201) 553-1919`
sitting ≥ 50 % on screen.

1. **Reads the number for 6 seconds, then switches to their email tab.**
   Exit = `hidden`, dwell = 6 s ≥ 4 s → **counts.** Likely off-site calls +1.

2. **Reads the number for 3 seconds, then switches tabs.**
   Exit = `hidden`, dwell = 3 s < 4 s → **does not count.**

3. **Looks at the number for 10 seconds while reading the page, then scrolls down
   to the gallery.** Exit = `dwell` (scrolled away), dwell = 10 s ≥ 8 s →
   **counts.**

4. **Glances at the number for 5 seconds, then scrolls to the gallery.**
   Exit = `dwell`, dwell = 5 s < 8 s → **does not count** (they kept browsing; too
   short to imply a call).

5. **Clicks the number, then leaves the window.**
   The click fires `cta_click` (High-intent +1). The dwell is **suppressed** — no
   double count. Likely off-site calls unchanged.

6. **Leaves the number on screen and walks away for 2 minutes.**
   At 45 s of no input the look ends as `idle`. Dwell credited = the active
   seconds *before* going idle (capped by the 3 s-per-tick rule), not the full 2
   minutes. Counts only if that active portion reached 4 s.

7. **Opens the page in a background tab and never focuses it.**
   `document.visibilityState` is never `visible` → **no dwell accrues** → never
   counts.

---

## 8. How to test it correctly

The pipeline is **eventually consistent**, so test with that in mind:

1. Use a **desktop** browser on the **live** site
   (`https://stonebellisimollc.com` or `https://www.stonebellisimollc.com` — the
   Firebase `*.web.app` URL is **not** an allowed origin and its events are
   rejected, see §9).
2. Scroll so a phone number is at least half on screen. **Do not click it.**
3. **Don't touch the mouse or keyboard.** Let it sit ≥ 8 seconds, then scroll it
   away — *or* let it sit ≥ 4 seconds, then switch to another tab.
4. Wait **~5–15 seconds.** The click/dwell is queued in the browser, POSTed,
   stored as a raw event, and only *then* rolled up into the dashboard's daily
   totals by a background Firestore trigger (observed latency ≈ 3–4 s, plus any
   cold start). **An immediate dashboard refresh will show nothing** — this is the
   single most common reason people think it's broken.
5. Refresh the dashboard's **Analytics** tab. "Likely off-site calls" (and, for a
   click test, "High-intent actions" and the CTA table) should increment.

**Ways a test silently produces nothing:**

- **You clicked the number.** That's a high-intent *click*, not a dwell — look at
  "High-intent actions" and the Intent grid instead.
- **You tested on a phone.** Dwell is desktop-only.
- **You kept moving the mouse over the number.** That's fine for accruing time,
  but the look only *reports* when it ends (tab switch, blur, scroll-away, idle,
  or unload). If the number never leaves the screen and you never leave the tab,
  it reports on page unload.
- **You added a `utm_source=test` / `utm_medium=qa`-style tag** (or similar QA
  markers). That traffic is classified as **test** and excluded from the default
  dashboard view; switch the dashboard's traffic toggle to *Include test* to see
  it ([`analytics.mjs`](src/analytics.mjs#L67-L76)).
- **You refreshed too fast.** See step 4.

---

## 9. Known limitation worth tracking

The analytics endpoint only accepts events whose browser `Origin` is the
canonical site (`stonebellisimollc.com` / `www.stonebellisimollc.com`). If the
site is ever browsed through the raw Firebase URL
`https://stone-bellisimo-dashboard.web.app`, its analytics POSTs return `403` and
**nothing is recorded** ([origin gate](src/analytics.mjs) via
[`firebase-security.mjs`](src/firebase-security.mjs#L29-L42) and
[`firebase-functions.mjs`](firebase-functions.mjs#L161-L174)). During/after the
DNS cutover, always verify through the apex domain. To intentionally allow the
`web.app` origin, add it to `ALLOWED_ORIGINS`.

---

## 10. Change log

- **2026-07-23** — Documented after fixing the root cause that had kept *every*
  page-view and CTA/dwell event out of production since launch: `boot()` threw on
  a fresh session because `safeParse(null, {})` returned `null` (JS quirk:
  `JSON.parse(null)` yields `null`, not the fallback), so `setupCtas()` crashed
  before `track('page_view')` ever ran. Fixed in
  [`src/client/site-analytics.js`](src/client/site-analytics.js) by hardening
  `safeParse` and isolating each `boot()` step so one failure can't silence all
  analytics. Only the inline form-wizard events, which bypass `boot()`, had been
  landing.
