# Pitchify

> **Football training plans built on the free ExerciseDB API.**
> Pick a goal, get a real 6-exercise session with rest timers, tutorials and a searchable library — no signup, no API key, no backend.

**Live site:** _link to be added before submission_ (load balancer → `7308-web-01` / `7308-web-02`)
**Demo video (≤ 2 min):** _link to be added before submission_

---

## 1. Purpose

Amateur football players rarely know *which* gym or pitch exercises actually develop the physical qualities the game demands — acceleration, repeat-sprint stamina, strength for duels, change-of-direction agility and flexibility for injury prevention. Existing apps are either generic bodybuilding catalogues or paid coaching products.

Pitchify turns a raw exercise database into a **football-specific training assistant**:

- You pick one **goal** (Speed, Stamina, Strength, Agility, Flexibility), your **available equipment** and your **level**.
- It maps those to the right ExerciseDB fields and returns a **6-exercise session**, ready to run, with coach guidance (sets, reps, rest) per goal.
- Everything is checkable, timed and saveable, and the full **1,500-exercise library** is searchable and filterable.

It solves a real need with real data: every exercise shown comes from the live API, not a hard-coded list.

---

## 2. Features

| Area | What it does |
|---|---|
| **Onboarding** | 3 steps: goal → equipment → level, stored locally |
| **Session plan** | Deterministic 6-exercise daily plan (same day + same answers = same plan), coach guidance per goal, re-roll button |
| **Workout tools** | Check off exercises, 1:30 rest timer with pause/reset, live progress |
| **Library** | Browse all 1,500 exercises, live search, body-part / equipment / muscle filters, sort, load-more pagination |
| **Detail sheet** | Full GIF demo, target muscles, numbered step-by-step instructions, 3 related exercises, favourite + add-to-session |
| **Favourites** | Starred exercises persist in `localStorage`, filterable in the library |
| **Resilience** | Offline/error banners, retry buttons, skeleton loaders, 24h response cache, rate-limit backoff |
| **UX** | Dark/light theme, fully responsive (390px → desktop), accessible labels/roles, respects `prefers-reduced-motion` |

---

## 3. Data source & attribution

**API: [ExerciseDB](https://oss.exercisedb.dev/docs) by [AscendAPI](https://www.ascendapi.com/)** — free, public, unauthenticated tier.
Documentation: **<https://oss.exercisedb.dev/docs>**

This project uses the ExerciseDB API and its exercise GIFs, provided by AscendAPI, under their free-tier terms (educational/personal use, 180p GIFs only, strict rate limits). All exercise data and media © AscendAPI.

**No API key is required** — the endpoint is fully public, so this repo contains **no keys, secrets or credentials** of any kind.

### Endpoints used

| Endpoint | Purpose in Pitchify |
|---|---|
| `GET /api/v1/exercises?…` | Paged, filtered library (goal queries, body part, equipment, muscle) — `limit`, `after` cursor |
| `GET /api/v1/exercises/search?search=…&threshold=…` | Live search-as-you-type |
| `GET /api/v1/exercises/{id}` | Detail sheet (instructions, secondary muscles) |
| `GET /api/v1/bodyparts`, `/equipments`, `/muscles` | Filter dropdowns (cached 24 h) |
| `GET /api/v1/liveness` | Non-blocking health check on page load |

### How goals map to the API

Football goals are translated into **real API query parameters** — this is the core of the app:

| Goal | API query | Why |
|---|---|---|
| **Speed** | `targetMuscles=quadriceps,hamstrings,glutes,calves` + `name=sprint` | Acceleration is posterior-chain + calf power |
| **Stamina** | `bodyParts=cardio` | Repeat-sprint / engine work |
| **Strength** | `bodyParts=upper legs,chest,back,shoulders` | Push, pull and squat patterns for duels |
| **Agility** | `bodyParts=cardio,waist` + `targetMuscles=abdominals,hip flexors,obliques` | Deceleration, cutting and trunk control |
| **Flexibility** | `name=stretch` + `targetMuscles=hamstrings,quadriceps,glutes` | Injury prevention around the hips/legs |

Equipment is applied as an `equipments` filter when the resulting pool still covers a full session; otherwise the filter is relaxed so users never get a broken plan. Sets, reps and rest are **app guidance** (labelled as such) — not API data.

---

## 4. Run locally

No build step, no dependencies — any static file server works.

```bash
git clone https://github.com/<you>/pitchify.git
cd pitchify
python3 -m http.server 8080
# open http://localhost:8080
```

(Or `npx serve .`, or open `index.html` directly — the app is plain HTML/CSS/JS.)

**Stack:** vanilla HTML5, CSS3 and ES2020 JavaScript. No frameworks, no bundler, no npm packages. Fonts: Google Fonts (Bebas Neue, Manrope, JetBrains Mono — all OFL licensed).

```
pitchify/
├── index.html          # all views: onboarding, session, library, detail sheet
├── css/style.css       # design system, dark/light themes, responsive + motion
├── js/api.js           # ExerciseDB client: timeout, retry/backoff, cache, dedupe
├── js/goals.js         # goal→API query mapping, session builder, coach guidance
├── js/ui.js            # icons, escaping, cards, skeletons, toasts, theme
├── js/app.js           # state, router, onboarding, session, browse, detail, timer
└── assets/favicon.svg  # original brand mark
```

---

## 5. Deployment

### Servers

| Host | Role | Public IP |
|---|---|---|
| `7308-web-01` | Nginx static server | `13.135.102.185` |
| `7308-web-02` | Nginx static server (identical config) | `35.179.186.89` |
| `7308-lb-01` | HAProxy load balancer (entry point) | `35.177.216.237` |

### Steps

**1. Copy the app to both web servers** (identical files on both):

```bash
ssh web-01
sudo mkdir -p /var/www/pitchify
# (from local) scp -r pitchify/* web-01:/tmp/pitchify/
sudo chown -R www-data:www-data /tmp/pitchify && sudo mv /tmp/pitchify/* /var/www/pitchify/
```

**2. Point Nginx at the app** (one line per server; the previous site in `/var/www/html` is left untouched):

```bash
sudo cp /etc/nginx/sites-enabled/default /etc/nginx/sites-enabled/default.bak
# edit:  root /var/www/html;  →  root /var/www/pitchify;
sudo nginx -t && sudo systemctl reload nginx
```

Repeat both steps on `web-02`.

**3. Load balancer** — HAProxy on `lb-01` already round-robins `7308-web-01:80` ↔ `7308-web-02:80`, so **no LB change was needed**. Each web server sets the response header `X-Served-By: 7308-web-0N`, which the app shows in its footer.

**4. Verify traffic is balanced:**

```bash
for i in 1 2 3 4; do curl -sI http://35.177.216.237/ | grep -i x-served-by; done
# → 7308-web-01, 7308-web-02, 7308-web-01, 7308-web-02  (alternating)
```

### Firewall rules (UFW)

| Server | Rules |
|---|---|
| `web-01`, `web-02` | `allow 22/tcp` (SSH), `allow from 35.177.216.237 to any port 80` (LB only) — everything else denied |
| `lb-01` | `allow 22/tcp`, `allow 80/tcp`, `allow 443/tcp` — everything else denied |

Web servers are **not directly reachable from the internet** — only the load balancer can talk to them.

---

## 6. Error handling & resilience

The API is free and rate-limited, so the client is deliberately defensive:

- **8 s timeout** per request via `AbortController`
- **Automatic retry with jittered exponential backoff** on `403/429/5xx`, honouring the `Retry-After` header for `429`
- **Detailed errors**: every failure carries `endpoint → status → body snippet` (visible in the console) while users get a friendly message + a **Retry** button
- **24 h response cache** in `localStorage`, **single-flight** deduplication (no duplicate concurrent calls), **`exerciseId` dedupe** across pages
- **Pagination guard**: a repeated `nextCursor` stops "Load more" instead of looping
- **Source indicator**: the library shows `live from API` vs `from local cache`
- **No-progress detection**: empty/failed pages surface as a retryable empty state, not a blank screen
- **Broken GIFs** swap to a labelled placeholder tile; all user data is escaped (`UI.esc`) before rendering
- **Offline banner** + liveness check on startup

---

## 7. Challenges & how they were solved

1. **The API silently clamps `limit`** — `limit=999` returns 25 items with HTTP 200. Probing the live API revealed the cap; the client now clamps to 25 and trusts `meta` for totals instead of assuming.
2. **Duplicates across filtered pages** — comma filters (`OR` semantics) can return the same exercise twice. All pages are deduped by `exerciseId`.
3. **Strict rate limits** (real `429`s during testing). Fixed with: 24 h cache, single-flight requests, `Retry-After` backoff, debounced search (300 ms), at most 1–2 calls per goal, and a **seeded daily session** (date + answers → same plan) so repeat visits need no API calls at all.
4. **Two different response shapes** — the `/liveness` endpoint has no `{success, …}` envelope while everything else does. Handled explicitly instead of forcing one `unwrap` on all endpoints.
5. **Mobile top bar overflow at 390 px** — headless Chrome has a 500 px minimum viewport, so a true mobile check needed an iframe harness; that exposed the overflow and drove the responsive CSS fixes.
6. **Invalid nested `<button>` markup** in exercise cards (button inside a clickable card) — restructured to `div[role="button"]` with keyboard support.
7. **Deploying without breaking other work** — the provided `/var/www/html` site was left in place; the app lives in `/var/www/pitchify` and only the Nginx `root` line changed (backed up first, one-line revert).

---

## 8. Credits

- **ExerciseDB API & exercise GIFs** — [AscendAPI](https://www.ascendapi.com/), docs at <https://oss.exercisedb.dev/docs>
- **Fonts** — Google Fonts: [Bebas Neue](https://fonts.google.com/specimen/Bebas+Neue), [Manrope](https://fonts.google.com/specimen/Manrope), [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono) (SIL Open Font License)
- All other code, design, icons and the favicon are original work for this assignment.

---

## 9. Author

Paul Kalisa — DAP (Playing Around with APIs) summative, Holberton School.
