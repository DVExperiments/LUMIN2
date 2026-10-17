/**
 * World ↔ screen scale, shared by simulation, interaction and both renderers.
 * One world unit is `worldHalf` CSS pixels. On portrait screens the world is
 * zoomed in a little so the organism doesn't shrink to a dot.
 */
export function worldHalf(cssW: number, cssH: number): number {
  return cssW < cssH ? Math.min(cssW * 1.2, cssH * 0.62) / 2 : Math.min(cssW, cssH) / 2;
}

export function viewExtent(cssW: number, cssH: number): [number, number] {
  const h = worldHalf(cssW, cssH);
  return [cssW / 2 / h, cssH / 2 / h];
}
