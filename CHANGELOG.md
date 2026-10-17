# Changelog

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
