# Changelog

## 5.0.0

Final version: automatic quality that reaches the right level quickly, a
cleaner membrane, and the returning-visitor moment the brief asks for.

- **Automatic quality climbs quickly.** v4 needed about 23 seconds to reach
  the top level from a cold start. It also chose its starting level from the
  CPU core count, which privacy-focused browsers deliberately under-report.
  Now desktops start at the middle level (touch devices at the bottom) and
  headroom is confirmed in 1.5 seconds. A fast desktop reaches the top within
  10 seconds. Downgrades still need sustained slowness, and retries still back
  off exponentially. New tests cover the climb speed and level-change stalls.
- **"While you were away".** When you return, the organism's name appears with
  one sentence built only from recorded hours: how long you were gone, the
  notable weather (rain totals, gusts, cold or heat, storms and other
  remembered events), and how that changed the organism. Hours that could not
  be recovered are named, never filled in. It appears once per visit, only
  after real catch-up data has arrived, and replaces the plainer catch-up
  notice. It is announced to screen readers through a dedicated live region.
- **Membrane.** The far side of the rim stays clearly present (shaded rather
  than missing), and the inner membrane is a softer, wider, dimmer layer
  instead of a hard bright ring.
- **Layout.** The first-light and welcome overlay is anchored from the top with
  a safe margin, and the corner name and conditions step aside while it plays.

## 4.0.0

Measuring performance instead of guessing, removing the last misleading
visuals, and night-time bioluminescence.

- **Frame timing in Settings.** The Rendering quality line now splits each
  frame into simulation and drawing time on the CPU, and GPU time (through
  `EXT_disjoint_timer_query_webgl2`, where the browser supports it). v3's
  speed-up was measured in software rendering and did not show up on a real
  machine; this shows where the time really goes.
- **Cheaper simulation.** The kink check now uses a cosine threshold instead
  of trigonometry, with one fewer pass. The Ultra simulation step is 11 %
  cheaper (4.52 to 4.01 ms per frame, measured in Node at 26 fps).
- **No misleading streaks.** Spores now drift as crisp points like the
  ambient motes. Only rain and tap sparks leave trails, so streaks on screen
  now mean it is raining.
- **Pointer response is coherent.** Moving the pointer fast near a tentacle
  sways the whole tentacle away, instead of denting single points into
  zigzags. The joint limit is also tighter.
- **Nucleus and highlight exposure.** The nucleus is smaller and dimmer, and
  the specular highlight is sharper and fainter, so the interior is no longer
  washed out at full resolution.
- **Night bioluminescence.** After dark, heartbeats light far more filaments,
  including the cilia, and the pulses burn brighter while the steady glow
  dims slightly. The organism looks visibly different by night.

## 3.0.0

Performance, automatic quality, and the last visual faults found at full
resolution.

- **Automatic quality fixed.** v2 needed frames under 14.5 ms before stepping
  up, which a 60 Hz display can never report. Machines were stuck at Eco and
  60 % resolution. The manager now:
  - learns the display's refresh interval and treats keeping pace as headroom;
  - climbs a five-level ladder;
  - retries a level that proved too slow only after an exponentially growing
    wait (1, 2, then 4 minutes), so it settles instead of oscillating;
  - starts capable desktops at Balanced.
- **Faster rendering.**
  - The weather atmosphere (sky and two noise fog fields) now renders at
    quarter resolution.
  - The membrane shader skips all interior work for the roughly 80 % of its
    area that lies outside the membrane.
  - Particle trails render at half resolution.
  - Two noise evaluations in the membrane were simplified.
  - Measured in headless Chromium with software WebGL: 1.36× faster at Ultra
    with identical settings. Not yet measured on a hardware GPU.
- **No more kinks.** Filament joints bent past a limit (tighter for crystalline
  organisms) are smoothed locally by curvature diffusion. This is stable and
  only removes energy, and gentle curves are untouched. Tests assert that every
  joint stays within limits in a 90 km/h gale with rain, a sweeping pointer and
  repeated taps, at 60 and 12 fps.
- **Motes no longer look like rain.** Ambient motes are drawn as crisp round
  points, never smeared into trails. Only real rain, spores and sparks streak.
- **Tests.** Added automatic quality tests: a fast GPU behind 60 Hz vsync, a
  GPU that cannot sustain the top levels, a slow device, a 144 Hz display, and
  manual presets staying fixed. 42 tests in total.

## 2.0.0

The organism's filaments were rebuilt so it reads as a living creature rather than a burst of light rays.

- **Filament physics.** Each segment now aims relative to the actual previous
  segment (follow-the-leader) instead of being pulled toward a fixed rest shape.
  The v1 smoothing pass, which mathematically straightened every chain, is gone.
  Waves now travel along filaments, filaments trail behind the moving body, and
  only crystalline (cold-raised) organisms keep rigid spines.
- **Hierarchy.** There are 3–5 thick primary tentacles, shorter fine secondary
  filaments, and cilia. They have varied lengths, root-to-tip taper and fading
  tips.
- **Reach is capped,** so the whole organism stays in view.
- **Wind response.** Breezes barely bend filaments; gales and acquired
  streamlining make everything stream downstream.
- **Depth.** A slow 3D tumble carries filaments in front of and behind the
  body. Rear filaments are dimmer and thinner, and are seen dimmed through the
  membrane where they pass behind it.
- **Membrane.**
  - The rim is lit more brightly on the sunlit side.
  - The inner membrane is a soft translucent volume rather than a drawn line.
  - Each heartbeat sends a visible pressure wave from the nucleus to the rim,
    which continues as light signals along the primary tentacles.
- **Starting pose.** Filaments now start laid out along their outward direction
  and can no longer begin tangled inside the body.
- **Fixed:** retracted filaments used to stay frozen in place while the body
  swam away, then whipped in from afar when they regrew. They now stay folded
  at their anchor.
- **Testing.**
  - `?debug` exposes the running app as `window.lumin`.
  - The visual smoke test now waits on simulated time, so screenshots from slow
    software rendering show a settled organism.
  - Simulation tests now check reach against the exact physical limit and
    reject overstretched segments.
