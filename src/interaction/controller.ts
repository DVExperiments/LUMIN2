/**
 * User interaction: mouse, touch and keyboard.
 *
 * Produces a smoothed pointer in world space plus discrete disturbances
 * (taps/clicks/keyboard pulses). Keyboard users steer a soft "light probe"
 * with the arrow keys and press Space or Enter to send a pulse.
 */
import { clamp } from '../core/math';
import type { PointerInput } from '../organism/simulation';
import { viewExtent, worldHalf } from '../core/view';

export interface Disturbance {
  x: number;
  y: number;
  intensity: number;
}

export class InteractionController {
  readonly pointer: PointerInput = { x: 0, y: 0, vx: 0, vy: 0, present: false, down: false };
  idleSeconds = 999;
  /** Set when keyboard steering is active, so the UI can show the probe. */
  keyboardActive = false;
  private targetX = 0;
  private targetY = 0;
  private rawPresent = false;
  private touchLinger = 0;
  private queue: Disturbance[] = [];
  private keys = new Set<string>();
  private lastMoveX = 0;
  private lastMoveY = 0;
  private downAt = 0;
  private downX = 0;
  private downY = 0;
  private cssW = 1;
  private cssH = 1;

  constructor(private surface: HTMLElement) {
    surface.addEventListener('pointermove', this.onMove, { passive: true });
    surface.addEventListener('pointerdown', this.onDown);
    surface.addEventListener('pointerup', this.onUp);
    surface.addEventListener('pointercancel', this.onLeave);
    surface.addEventListener('pointerleave', this.onLeave);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => this.keys.clear());
  }

  setViewport(w: number, h: number) {
    this.cssW = w;
    this.cssH = h;
  }

  private toWorld(clientX: number, clientY: number): [number, number] {
    const rect = this.surface.getBoundingClientRect();
    const half = worldHalf(this.cssW, this.cssH);
    return [(clientX - rect.left - this.cssW / 2) / half, -(clientY - rect.top - this.cssH / 2) / half];
  }

  /** World → CSS pixel position, for drawing the keyboard probe. */
  toScreen(x: number, y: number): [number, number] {
    const half = worldHalf(this.cssW, this.cssH);
    return [this.cssW / 2 + x * half, this.cssH / 2 - y * half];
  }

  private onMove = (e: PointerEvent) => {
    const [x, y] = this.toWorld(e.clientX, e.clientY);
    this.targetX = x;
    this.targetY = y;
    if (e.pointerType === 'mouse' || this.pointer.down) {
      if (!this.rawPresent) {
        this.pointer.x = x;
        this.pointer.y = y;
      }
      this.rawPresent = true;
    }
    this.keyboardActive = false;
    this.idleSeconds = 0;
  };

  private onDown = (e: PointerEvent) => {
    const [x, y] = this.toWorld(e.clientX, e.clientY);
    if (!this.rawPresent) {
      this.pointer.x = x;
      this.pointer.y = y;
    }
    this.targetX = x;
    this.targetY = y;
    this.rawPresent = true;
    this.pointer.down = true;
    this.downAt = performance.now();
    this.downX = x;
    this.downY = y;
    this.keyboardActive = false;
    this.idleSeconds = 0;
    try {
      this.surface.setPointerCapture(e.pointerId);
    } catch {
      /* not all pointers can be captured */
    }
  };

  private onUp = (e: PointerEvent) => {
    const [x, y] = this.toWorld(e.clientX, e.clientY);
    const held = (performance.now() - this.downAt) / 1000;
    const moved = Math.hypot(x - this.downX, y - this.downY);
    if (moved < 0.06) {
      // A tap: short taps are crisp, long presses are soft swells.
      this.queue.push({ x, y, intensity: held < 0.35 ? 0.75 : clamp(0.35 + held * 0.1, 0.35, 0.6) });
    }
    this.pointer.down = false;
    if (e.pointerType !== 'mouse') this.touchLinger = 0.8;
  };

  private onLeave = (e: PointerEvent) => {
    if (e.type === 'pointerleave' && this.pointer.down) return;
    this.pointer.down = false;
    if (e.pointerType === 'mouse') this.rawPresent = false;
    else this.touchLinger = 0.6;
  };

  private isTyping(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (k.startsWith('Arrow')) {
      // Only steer when focus is on the artwork itself, not inside a panel.
      if (document.activeElement && document.activeElement !== document.body && document.activeElement !== this.surface) return;
      e.preventDefault();
      if (!this.keyboardActive) {
        this.keyboardActive = true;
        this.targetX = this.pointer.x = 0.55;
        this.targetY = this.pointer.y = 0.2;
      }
      this.keys.add(k);
      this.rawPresent = true;
      this.idleSeconds = 0;
    } else if ((k === ' ' || k === 'Enter') && (document.activeElement === document.body || document.activeElement === this.surface)) {
      e.preventDefault();
      const x = this.keyboardActive ? this.pointer.x : 0;
      const y = this.keyboardActive ? this.pointer.y : 0;
      this.queue.push({ x, y, intensity: 0.7 });
      this.idleSeconds = 0;
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.key);
  };

  /** Advance smoothing; returns and clears pending disturbances. */
  update(dt: number): Disturbance[] {
    this.idleSeconds += dt;
    if (this.keys.size) {
      const sp = 0.9 * dt;
      if (this.keys.has('ArrowLeft')) this.targetX -= sp;
      if (this.keys.has('ArrowRight')) this.targetX += sp;
      if (this.keys.has('ArrowUp')) this.targetY += sp;
      if (this.keys.has('ArrowDown')) this.targetY -= sp;
      const [hx, hy] = viewExtent(this.cssW, this.cssH);
      this.targetX = clamp(this.targetX, -hx, hx);
      this.targetY = clamp(this.targetY, -hy, hy);
    }
    if (this.touchLinger > 0) {
      this.touchLinger -= dt;
      if (this.touchLinger <= 0 && !this.pointer.down) this.rawPresent = false;
    }
    const p = this.pointer;
    const k = 1 - Math.exp(-dt / 0.045);
    const nx = p.x + (this.targetX - p.x) * k;
    const ny = p.y + (this.targetY - p.y) * k;
    const ivx = (nx - p.x) / Math.max(dt, 1e-3);
    const ivy = (ny - p.y) / Math.max(dt, 1e-3);
    const kv = 1 - Math.exp(-dt / 0.08);
    p.vx += (ivx - p.vx) * kv;
    p.vy += (ivy - p.vy) * kv;
    p.x = nx;
    p.y = ny;
    p.present = this.rawPresent;
    this.lastMoveX = p.vx;
    this.lastMoveY = p.vy;
    const q = this.queue;
    this.queue = [];
    return q;
  }

  get speed() {
    return Math.hypot(this.lastMoveX, this.lastMoveY);
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }
}
