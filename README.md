# LUMIN

*A living organism of light, shaped by the weather it has experienced.*

LUMIN is a browser-based generative artwork. A luminous creature drifts on
screen: it has a translucent membrane, a heavy beating nucleus, swimming
filaments that carry pulses of light, and a cloud of spores. It reacts to the
real weather where it lives. More importantly, it **remembers** that weather.
Weeks of wind streamline it, cold makes it crystalline, storms leave growth
rings. Come back after a few days and it will have changed, because of what
it lived through while you were away.

It runs entirely in your browser:

* no account and no API key;
* no tracking, microphone or camera;
* only a city name or coordinates are ever sent anywhere, to
  [Open-Meteo](https://open-meteo.com/).

## Using it

| Action | Effect |
| --- | --- |
| Move slowly near it | Curious organisms reach toward you; familiarity grows over many visits. |
| Move fast near it | It flinches, tenses and recoils, then recovers. |
| Click or tap | Sends a pulse: a ripple, light signals racing through nearby filaments, a burst of sparks. Repeated taps dull its response (habituation). |
| Arrow keys, then Space or Enter | Keyboard light probe and pulse |
| O | Observatory |
| L | Laboratory |
| H | Hide or show the interface |
| F | Full screen |
| Esc | Close panels |

**Place.** On first visit the place is guessed from your time zone, so no
location permission is needed. Click the place name to search for a city, or
optionally use device location (rounded to about 1 km).

**Observatory.** Shows:

* current weather, its source and its age;
* the eight internal states and the current behaviour mode;
* a 14-day timeline of temperature, wind and rain, with missing data hatched
  and the moment of birth marked;
* each adaptation trait against its starting point and its current target;
* remembered events;
* plain-language notes on what changed since your last visit and why.

**Laboratory.** Set temperature, wind, rain, humidity, cloud and time of day
by hand, or use the presets. *Expose for 1 or 7 days* feeds simulated hours
into memory so you can watch adaptation happen in seconds. Experiments run on
a temporary copy (discarded on exit) or on a separate experimental organism
(kept). The real organism's memory is never touched. Lab mode is framed in
amber and labelled throughout, and *Return to live weather* is always one
click away.

**Settings.**

* Quality: Automatic, Eco, Balanced or Ultra. Automatic learns your display's
  refresh rate and settles at the highest level that keeps pace with it.
* Motion: Match system, Reduced or Full. Reduced motion slows the organism
  and removes trails, lightning and strong ripples.
* Data: export, import, or begin a new organism (with confirmation).

## Weather honesty

The status line always says where conditions come from:

* **Live weather, updated N minutes ago:** fetched within the last 30 minutes.
* **Cached weather from N hours ago:** the last successful fetch, shown with
  its age, when the network fails.
* **Simulated weather:** a labelled stand-in when no real data exists yet
  (offline first run, or no place chosen). It is never recorded into memory.
* **Laboratory weather:** your manual conditions.

## Development

Requires Node.js 18 or newer (developed with Node 22).

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # Vitest: memory, adaptation, validation, persistence, behaviour, simulation
npm run typecheck
npm run build      # type-checks, then writes the static site to dist/
npm run preview    # serve dist/ locally
```

Optional visual smoke test. This needs Python with Playwright and Chromium.
It serves `dist/`, mocks Open-Meteo with deterministic weather (`mild`,
`gale`, `cold` or `rain`), drives the interface and saves screenshots:

```bash
pip install playwright && playwright install chromium
npm run build && python3 scripts/visual_smoke.py gale /tmp/shots
```

## Deploying to GitHub Pages

The build uses relative asset paths (`base: './'`), so `dist/` works from any
sub-path without configuration.

**Option A: GitHub Actions (included).**

1. Push this project to a GitHub repository whose default branch is `main`.
2. In the repository, open *Settings → Pages* and set *Source* to
   *GitHub Actions*.
3. Push to `main`. `.github/workflows/deploy.yml` installs dependencies, runs
   the tests, builds and publishes. The site appears at
   `https://<user>.github.io/<repo>/`.

**Option B: manual.** Run `npm run build`, then publish the contents of
`dist/` to a `gh-pages` branch or any static host (Netlify, Cloudflare Pages,
S3 and so on). Serve over HTTPS so the service worker and optional
geolocation work.

## Architecture

```
src/
  core/          math, seeded PRNG, simplex noise, world/screen scale
  weather/       1 acquisition (openMeteo.ts, service.ts), 2 validation (validate.ts), sun.ts
  memory/        3 environmental history and memory (environment.ts, features.ts),
                 interaction memory, plain-language narrative
  organism/      4 identity and adaptation (genome.ts, adaptation.ts, state.ts),
                 membrane shape and physical simulation (shape.ts, simulation.ts)
  behaviour/     5 behaviour engine (engine.ts)
  render/        6 WebGL2 renderer, Canvas 2D fallback, shaders, adaptive quality
  interaction/   7 pointer, touch and keyboard
  persistence/   8 IndexedDB → localStorage → memory, versioned serialisation and migration
  ui/            9 interface controller and Observatory timeline
  app.ts         orchestration and frame loop
docs/MEMORY.md   the weather-memory and adaptation system in detail
```

**Data flow:** completed weather hours go into memory (four exponential
averages, events and gaps). Memory drives morphology and marks. Behaviour
combines current conditions, memory, temperament and your interaction into
eight coupled internal states. The simulation turns those states and the
morphology into body physics, filaments and particles, and the renderer draws
them.

**Rendering (WebGL2).** Each frame:

1. A particle trail buffer is faded and redrawn.
2. An HDR scene is drawn: filament ribbons, and the membrane, evaluated per
   pixel from the same polar shape function the CPU uses to anchor filaments.
   The membrane has pseudo-3D sun-lit shading, domain-warped cytoplasm,
   Voronoi organelles, endoplasm, nucleus, growth rings and vacuoles.
3. A dual-filter bloom pass runs.
4. A composite pass adds a weather-driven sky (time of day, cloud, humidity
   haze, wind-carried fog, stars, lightning), ripple refraction, ACES tone
   mapping, vignette and grain.

If WebGL2 is unavailable, a Canvas 2D renderer draws the same simulation.

**Performance measures:**

* fixed sub-stepped Verlet filaments;
* no per-frame allocation in the simulation;
* instanced particles;
* adaptive render resolution, bloom depth and noise octaves (automatic mode);
* atmosphere at quarter resolution and particle trails at half resolution;
* the membrane shader skips interior work outside the membrane;
* Eco, Balanced and Ultra presets;
* rendering stops entirely while the tab is hidden.

**Offline.** After one visit, a service worker serves the app shell offline.
Weather is cached separately in IndexedDB and labelled with its age.

## Testing status

* `npm test` runs 42 Vitest tests. They cover:
  * memory ordering, de-duplication, gaps, events and timescales;
  * determinism, adaptation and persistence of acquired structure;
  * history-dependent individuality;
  * laboratory isolation;
  * validation and catch-up planning;
  * live/cached labelling;
  * export and import round-trips, migration and rejection of bad files;
  * behaviour bounds and autonomy;
  * simulation stability, inextensibility and absence of kinks in a gale at
    60 and 12 fps;
  * automatic quality behaviour on simulated 60 Hz and 144 Hz displays with
    fast, mid-range and slow GPUs.
* The visual smoke script was run in headless Chromium (SwiftShader software
  WebGL) against the production build with mocked weather. It reported no
  console errors for the gale and cold scenarios.
* **Not measured:** frame rates on real GPUs or phones. The automatic quality
  manager is designed for about 60 fps on mid-range laptops, but no hardware
  benchmark was performed. Real Open-Meteo responses were not exercised from
  the build environment, which had no access to the API; the client follows
  the documented API and is tested against fixture payloads.

## Credits and licence

* Code: MIT, see `LICENSE`.
* Weather data: [Open-Meteo](https://open-meteo.com/), CC BY 4.0.
* Simplex noise in the shaders: adapted from Ashima Arts and Stefan
  Gustavson, MIT.
* Fonts: Newsreader and Hanken Grotesk (SIL Open Font License 1.1), bundled
  locally through Fontsource.

See `THIRD_PARTY_NOTICES.md` for details.
