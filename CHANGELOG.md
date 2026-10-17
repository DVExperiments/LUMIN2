# Changelog

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
