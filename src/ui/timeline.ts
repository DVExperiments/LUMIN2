/**
 * Observatory timeline: fourteen days of remembered weather drawn on a canvas.
 * Temperature as a line, wind as a soft band, rain as bars, missing data hatched,
 * with the moment of birth and remembered events marked.
 */
import type { GapRecord, WeatherEvent } from '../memory/environment';
import type { HourRecord } from '../weather/types';

const HOUR = 3600000;
const DAY = 86400000;

export interface TimelineInput {
  records: HourRecord[];
  gaps: GapRecord[];
  events: WeatherEvent[];
  birth: number;
  end: number;
  days: number;
}

export function drawTimeline(canvas: HTMLCanvasElement, data: TimelineInput) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cssW = canvas.clientWidth || 340;
  const cssH = Math.round(cssW * 0.44);
  if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.height = `${cssH}px`;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  const W = cssW, H = cssH;
  const padL = 26, padR = 6, padT = 14, padB = 18;
  const end = data.end;
  const start = end - data.days * DAY;
  const x = (t: number) => padL + ((t - start) / (end - start)) * (W - padL - padR);
  const inRange = data.records.filter((r) => r.t >= start && r.t < end);

  ctx.font = '10px "Hanken Grotesk Variable", system-ui, sans-serif';
  ctx.textBaseline = 'middle';

  // Before birth: ancestral climate, shaded.
  if (data.birth > start) {
    const bx = Math.min(W - padR, x(data.birth));
    ctx.fillStyle = 'rgba(220,230,234,0.035)';
    ctx.fillRect(padL, padT, bx - padL, H - padT - padB);
    ctx.fillStyle = 'rgba(220,230,234,0.42)';
    ctx.textAlign = 'left';
    if (bx - padL > 70) ctx.fillText('before birth', padL + 4, padT + 6);
    if (data.birth < end) {
      ctx.strokeStyle = 'rgba(220,230,234,0.45)';
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(bx + 0.5, padT);
      ctx.lineTo(bx + 0.5, H - padB);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.textAlign = 'left';
      ctx.fillText('born', Math.min(bx + 4, W - 30), padT + 6);
    }
  }

  // Day grid.
  ctx.strokeStyle = 'rgba(220,230,234,0.07)';
  ctx.fillStyle = 'rgba(220,230,234,0.38)';
  ctx.textAlign = 'center';
  const firstDay = Math.ceil(start / DAY) * DAY;
  for (let d = firstDay, i = 0; d < end; d += DAY, i++) {
    const gx = Math.round(x(d)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(gx, padT);
    ctx.lineTo(gx, H - padB);
    ctx.stroke();
    if (i % 2 === 0) {
      const label = new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
      ctx.fillText(label, gx, H - padB / 2 + 1);
    }
  }

  // Gaps.
  for (const g of data.gaps) {
    if (g.to < start || g.from > end) continue;
    const gx0 = x(Math.max(start, g.from)), gx1 = x(Math.min(end, g.to));
    ctx.save();
    ctx.beginPath();
    ctx.rect(gx0, padT, Math.max(1, gx1 - gx0), H - padT - padB);
    ctx.clip();
    ctx.strokeStyle = 'rgba(220,230,234,0.22)';
    for (let k = -H; k < gx1 - gx0 + H; k += 5) {
      ctx.beginPath();
      ctx.moveTo(gx0 + k, H - padB);
      ctx.lineTo(gx0 + k + H, padT);
      ctx.stroke();
    }
    ctx.restore();
  }

  if (!inRange.length) {
    ctx.fillStyle = 'rgba(220,230,234,0.5)';
    ctx.textAlign = 'center';
    ctx.font = 'italic 13px "Newsreader Variable", Georgia, serif';
    ctx.fillText('No weather recorded yet', W / 2, H / 2);
    return;
  }

  const plotH = H - padT - padB;
  let tMin = Infinity, tMax = -Infinity, wMax = 20, pMax = 2;
  for (const r of inRange) {
    tMin = Math.min(tMin, r.T);
    tMax = Math.max(tMax, r.T);
    wMax = Math.max(wMax, r.W);
    pMax = Math.max(pMax, r.P);
  }
  if (tMax - tMin < 6) {
    const mid = (tMax + tMin) / 2;
    tMin = mid - 3;
    tMax = mid + 3;
  }
  const yT = (T: number) => padT + 8 + (1 - (T - tMin) / (tMax - tMin)) * (plotH - 16);
  const barW = Math.max(1, (W - padL - padR) / (data.days * 24));

  // Wind band (filled area from the bottom), broken across gaps.
  ctx.fillStyle = 'rgba(143,213,227,0.16)';
  let open = false;
  let lastT = -Infinity;
  let firstX = 0;
  ctx.beginPath();
  for (const r of inRange) {
    const px = x(r.t + HOUR / 2);
    const py = H - padB - (r.W / wMax) * plotH * 0.55;
    if (open && r.t - lastT > HOUR) {
      ctx.lineTo(x(lastT + HOUR / 2), H - padB);
      ctx.lineTo(firstX, H - padB);
      ctx.closePath();
      open = false;
    }
    if (!open) {
      firstX = px;
      ctx.moveTo(px, H - padB);
      open = true;
    }
    ctx.lineTo(px, py);
    lastT = r.t;
  }
  if (open) {
    ctx.lineTo(x(lastT + HOUR / 2), H - padB);
    ctx.closePath();
  }
  ctx.fill();

  // Rain bars.
  ctx.fillStyle = 'rgba(138,166,255,0.85)';
  for (const r of inRange) {
    if (r.P <= 0.05) continue;
    const h = Math.max(1.5, (Math.min(r.P, pMax) / pMax) * plotH * 0.45);
    ctx.fillRect(x(r.t), H - padB - h, barW, h);
  }

  // Temperature line, broken across gaps.
  ctx.strokeStyle = '#ffcf9a';
  ctx.lineWidth = 1.4;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  lastT = -Infinity;
  for (const r of inRange) {
    const px = x(r.t + HOUR / 2), py = yT(r.T);
    if (r.t - lastT > HOUR) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
    lastT = r.t;
  }
  ctx.stroke();

  // Temperature scale.
  ctx.fillStyle = 'rgba(255,207,154,0.7)';
  ctx.textAlign = 'right';
  ctx.fillText(`${Math.round(tMax)}°`, padL - 5, yT(tMax));
  ctx.fillText(`${Math.round(tMin)}°`, padL - 5, yT(tMin));

  // Events.
  for (const e of data.events) {
    if (e.t < start || e.t > end) continue;
    const ex = x(e.t);
    ctx.fillStyle = e.prenatal ? 'rgba(220,230,234,0.45)' : 'rgba(220,230,234,0.95)';
    ctx.beginPath();
    ctx.arc(ex, padT + 2, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
}
