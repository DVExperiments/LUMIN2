/**
 * Interface controller: floating chrome, panels, dialogs and their wiring.
 * Holds no organism logic; it renders data handed to it and reports intent
 * through callbacks.
 */
import type { GeocodeHit } from '../weather/validate';
import type { ConditionSource } from '../weather/types';
import { drawTimeline, type TimelineInput } from './timeline';
import { compassName } from '../memory/narrative';

export interface LabValues {
  temperature: number;
  windSpeed: number;
  windDirection: number;
  precipitation: number;
  humidity: number;
  cloudCover: number;
  hour: number;
}

export const LAB_PRESETS: Record<string, LabValues> = {
  calm: { temperature: -6, windSpeed: 2, windDirection: 0, precipitation: 0, humidity: 82, cloudCover: 5, hour: 6.5 },
  gale: { temperature: 3, windSpeed: 78, windDirection: 270, precipitation: 1.2, humidity: 88, cloudCover: 95, hour: 15 },
  downpour: { temperature: 28, windSpeed: 18, windDirection: 120, precipitation: 9, humidity: 97, cloudCover: 100, hour: 14 },
  summer: { temperature: 26, windSpeed: 8, windDirection: 200, precipitation: 0, humidity: 55, cloudCover: 15, hour: 19.6 },
};

export interface UICallbacks {
  searchLocations(q: string): Promise<GeocodeHit[]>;
  chooseLocation(hit: GeocodeHit): void;
  useDeviceLocation(): Promise<void>;
  enterLab(kind: 'copy' | 'separate'): void;
  exitLab(): void;
  labChanged(v: LabValues): void;
  labExpose(hours: number): void;
  setQuality(q: string): void;
  setMotion(m: string): void;
  exportData(): void;
  importData(file: File): void;
  reset(): void;
  observatoryOpened(): void;
}

export interface Meter {
  label: string;
  value: number;
  neutral?: number;
  target?: number;
  min?: number;
  max?: number;
}

export interface ObservatoryData {
  now: string;
  weather: [string, string][];
  source: string;
  mode: string;
  behaviour: Meter[];
  timeline: TimelineInput;
  trends: [string, string][];
  adaptation: Meter[];
  notes: string[];
  events: { t: number; text: string; prenatal: boolean }[];
  identity: [string, string][];
}

const SLIDERS: { key: keyof LabValues; label: string; min: number; max: number; step: number; fmt: (v: number) => string }[] = [
  { key: 'temperature', label: 'Temperature', min: -20, max: 40, step: 0.5, fmt: (v) => `${v.toFixed(1)} °C` },
  { key: 'windSpeed', label: 'Wind speed', min: 0, max: 100, step: 1, fmt: (v) => `${Math.round(v)} km/h` },
  { key: 'windDirection', label: 'Wind from', min: 0, max: 359, step: 1, fmt: (v) => `${compassName(v)} (${Math.round(v)}°)` },
  { key: 'precipitation', label: 'Precipitation', min: 0, max: 12, step: 0.1, fmt: (v) => `${v.toFixed(1)} mm/h` },
  { key: 'humidity', label: 'Humidity', min: 0, max: 100, step: 1, fmt: (v) => `${Math.round(v)} %` },
  { key: 'cloudCover', label: 'Cloud cover', min: 0, max: 100, step: 1, fmt: (v) => `${Math.round(v)} %` },
  {
    key: 'hour', label: 'Time of day', min: 0, max: 23.99, step: 0.05,
    fmt: (v) => `${String(Math.floor(v)).padStart(2, '0')}:${String(Math.floor((v % 1) * 60)).padStart(2, '0')}`,
  },
];

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export class UI {
  private idleTimer = 0;
  private toastTimer = 0;
  private hidden = false;
  private labValues: LabValues = { ...LAB_PRESETS.summer };
  private searchTimer = 0;
  private searchSeq = 0;
  private confirmResolve: ((ok: boolean) => void) | null = null;
  inLab = false;

  constructor(private cb: UICallbacks) {
    this.wirePanels();
    this.wireLocation();
    this.wireLab();
    this.wireSettings();
    this.wireConfirm();
    this.wireIdle();
    this.wireKeys();
  }

  // ---------------------------------------------------------------------------
  // Basic chrome
  // ---------------------------------------------------------------------------

  setIdentity(name: string, place: string | null) {
    $('specimen-name').textContent = name;
    $('place-text').textContent = place ?? 'Choose a place';
    document.title = `${name}, a LUMIN organism`;
  }

  setConditions(text: string) {
    $('conditions').textContent = text;
  }

  setStatus(source: ConditionSource, text: string) {
    const el = $('status');
    if (el.dataset.source !== source || $('status-text').textContent !== text) {
      el.dataset.source = source;
      $('status-text').textContent = text;
    }
  }

  toast(message: string, ms = 4200) {
    const t = $('toast');
    t.textContent = message;
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => t.classList.remove('show'), ms);
  }

  showHint(text?: string) {
    const h = $('hint');
    if (text) h.textContent = text;
    h.classList.add('show');
    window.setTimeout(() => h.classList.remove('show'), 7000);
  }

  genesis(name: string, line: string, ms = 5200) {
    $('genesis-name').textContent = name;
    $('genesis-line').textContent = line;
    const g = $('genesis');
    requestAnimationFrame(() => g.classList.add('show'));
    window.setTimeout(() => g.classList.remove('show'), ms);
  }

  /** The returning-visitor moment: the name, then what the weather did while you were gone. */
  welcomeBack(name: string, line: string) {
    // Long enough to read at a calm pace: ~60 ms per character, between 7 and 14 seconds.
    const ms = Math.min(14000, Math.max(7000, line.length * 60));
    this.genesis(name, line, ms);
    // The corner name and conditions step aside while the moment plays.
    document.body.classList.add('welcoming');
    window.setTimeout(() => document.body.classList.remove('welcoming'), ms);
    // The overlay is decorative, so announce the line to screen readers separately.
    $('announce').textContent = line;
  }

  setProbe(visible: boolean, x = 0, y = 0) {
    const p = $('probe');
    p.classList.toggle('show', visible);
    if (visible) p.style.transform = `translate(${x}px, ${y}px)`;
  }

  setReducedMotion(on: boolean) {
    document.body.classList.toggle('reduce-motion', on);
  }

  // ---------------------------------------------------------------------------
  // Panels
  // ---------------------------------------------------------------------------

  private panelButtons: Record<string, string> = {
    observatory: 'btn-observatory',
    laboratory: 'btn-lab',
    settings: 'btn-settings',
  };

  isOpen(id: string) {
    return !$(id).hidden;
  }

  openPanel(id: string) {
    for (const other of Object.keys(this.panelButtons)) {
      // Observatory and settings share the right edge; the lab sits on the left.
      if (other !== id && (id === 'laboratory') === (other === 'laboratory')) this.closePanel(other);
    }
    const el = $(id);
    el.hidden = false;
    el.removeAttribute('inert');
    $(this.panelButtons[id]).setAttribute('aria-expanded', 'true');
    if (id === 'observatory') this.cb.observatoryOpened();
    this.wake();
  }

  closePanel(id: string) {
    const el = $(id);
    if (el.hidden) return;
    const hadFocus = el.contains(document.activeElement);
    el.hidden = true;
    el.setAttribute('inert', '');
    $(this.panelButtons[id]).setAttribute('aria-expanded', 'false');
    if (hadFocus) $(this.panelButtons[id]).focus();
  }

  togglePanel(id: string) {
    if (this.isOpen(id)) this.closePanel(id);
    else this.openPanel(id);
  }

  private wirePanels() {
    for (const id of Object.keys(this.panelButtons)) {
      $(id).setAttribute('inert', '');
      $(this.panelButtons[id]).addEventListener('click', () => this.togglePanel(id));
    }
    document.querySelectorAll<HTMLButtonElement>('[data-close]').forEach((b) =>
      b.addEventListener('click', () => this.closePanel(b.dataset.close!)),
    );
    $('btn-fullscreen').addEventListener('click', () => this.toggleFullscreen());
    if (!document.fullscreenEnabled) $('btn-fullscreen').hidden = true;
  }

  toggleFullscreen() {
    if (!document.fullscreenEnabled) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => this.toast('Full screen is not available here.'));
  }

  private wireKeys() {
    window.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector('dialog[open]')) return;
      const k = e.key.toLowerCase();
      if (k === 'escape') {
        for (const id of Object.keys(this.panelButtons)) this.closePanel(id);
      } else if (k === 'o') this.togglePanel('observatory');
      else if (k === 'l') this.togglePanel('laboratory');
      else if (k === 'h') {
        this.hidden = !this.hidden;
        document.body.classList.toggle('ui-hidden', this.hidden);
        if (this.hidden) this.toast('Interface hidden. Press H to show it again.', 2600);
      } else if (k === 'f') this.toggleFullscreen();
    });
  }

  private wireIdle() {
    const wake = () => this.wake();
    window.addEventListener('pointermove', wake, { passive: true });
    window.addEventListener('pointerdown', wake, { passive: true });
    window.addEventListener('keydown', wake);
    window.addEventListener('focusin', wake);
    this.wake();
  }

  wake() {
    document.body.classList.remove('ui-idle');
    clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => {
      const anyOpen = Object.keys(this.panelButtons).some((id) => this.isOpen(id)) || !!document.querySelector('dialog[open]');
      if (!anyOpen) document.body.classList.add('ui-idle');
      else this.wake();
    }, 4500);
  }

  // ---------------------------------------------------------------------------
  // Location
  // ---------------------------------------------------------------------------

  openLocation(message = '') {
    const d = $<HTMLDialogElement>('location-dialog');
    $('loc-message').textContent = message;
    if (!d.open) d.showModal();
    const q = $<HTMLInputElement>('loc-query');
    q.focus();
    q.select();
  }

  private wireLocation() {
    const d = $<HTMLDialogElement>('location-dialog');
    $('place-button').addEventListener('click', () => this.openLocation());
    $('loc-cancel').addEventListener('click', () => d.close());
    $('location-form').addEventListener('submit', (e) => e.preventDefault());
    const q = $<HTMLInputElement>('loc-query');
    const list = $('loc-results');
    const msg = $('loc-message');
    q.addEventListener('input', () => {
      clearTimeout(this.searchTimer);
      const value = q.value.trim();
      if (value.length < 2) {
        list.replaceChildren();
        msg.textContent = '';
        return;
      }
      this.searchTimer = window.setTimeout(async () => {
        const seq = ++this.searchSeq;
        msg.textContent = 'Searching';
        try {
          const hits = await this.cb.searchLocations(value);
          if (seq !== this.searchSeq) return;
          list.replaceChildren(
            ...hits.map((h) => {
              const li = document.createElement('li');
              const b = document.createElement('button');
              b.type = 'button';
              b.setAttribute('role', 'option');
              const n = document.createElement('span');
              n.className = 'r-name';
              n.textContent = h.name;
              const r = document.createElement('span');
              r.className = 'r-region';
              r.textContent = [h.region, h.country].filter(Boolean).join(', ') || `${h.latitude.toFixed(2)}, ${h.longitude.toFixed(2)}`;
              b.append(n, r);
              b.addEventListener('click', () => {
                d.close();
                this.cb.chooseLocation(h);
              });
              li.append(b);
              return li;
            }),
          );
          msg.textContent = hits.length ? '' : `No places match “${value}”. Try a nearby city.`;
        } catch {
          if (seq === this.searchSeq) msg.textContent = 'The place search could not be reached. Check your connection and try again.';
        }
      }, 320);
    });
    q.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        (list.querySelector('button') as HTMLButtonElement | null)?.click();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        (list.querySelector('button') as HTMLButtonElement | null)?.focus();
      }
    });
    list.addEventListener('keydown', (e) => {
      const items = [...list.querySelectorAll('button')];
      const i = items.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); items[Math.min(items.length - 1, i + 1)]?.focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); if (i <= 0) q.focus(); else items[i - 1]?.focus(); }
    });
    const dev = $<HTMLButtonElement>('loc-device');
    if (!('geolocation' in navigator)) dev.hidden = true;
    dev.addEventListener('click', async () => {
      dev.disabled = true;
      msg.textContent = 'Asking your device for its location';
      try {
        await this.cb.useDeviceLocation();
        d.close();
      } catch (e) {
        msg.textContent = (e as Error).message || 'Location unavailable. Search for a city instead.';
      } finally {
        dev.disabled = false;
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Laboratory
  // ---------------------------------------------------------------------------

  setLabCopyLabel(name: string) {
    $('lab-copy-label').textContent = `A temporary copy of ${name}`;
  }

  private wireLab() {
    const host = $('lab-sliders');
    for (const s of SLIDERS) {
      const wrap = document.createElement('div');
      wrap.className = 'slider';
      const id = `lab-${s.key}`;
      wrap.innerHTML = `<label for="${id}"><span>${s.label}</span><output id="${id}-out" for="${id}"></output></label>
        <input type="range" id="${id}" min="${s.min}" max="${s.max}" step="${s.step}" />`;
      host.append(wrap);
      const input = wrap.querySelector('input')!;
      input.addEventListener('input', () => {
        this.labValues[s.key] = Number(input.value);
        $(`${id}-out`).textContent = s.fmt(this.labValues[s.key]);
        this.cb.labChanged({ ...this.labValues });
      });
    }
    this.syncSliders();
    document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((b) =>
      b.addEventListener('click', () => {
        this.labValues = { ...LAB_PRESETS[b.dataset.preset!] };
        this.syncSliders();
        this.cb.labChanged({ ...this.labValues });
      }),
    );
    $('lab-enter').addEventListener('click', () => {
      const kind = (document.querySelector('input[name="specimen"]:checked') as HTMLInputElement).value as 'copy' | 'separate';
      this.cb.enterLab(kind);
    });
    const exit = () => this.cb.exitLab();
    $('lab-exit').addEventListener('click', exit);
    $('lab-exit-banner').addEventListener('click', exit);
    $('lab-expose-1').addEventListener('click', () => this.cb.labExpose(24));
    $('lab-expose-7').addEventListener('click', () => this.cb.labExpose(168));
  }

  private syncSliders() {
    for (const s of SLIDERS) {
      const input = $<HTMLInputElement>(`lab-${s.key}`);
      input.value = String(this.labValues[s.key]);
      $(`lab-${s.key}-out`).textContent = s.fmt(this.labValues[s.key]);
    }
  }

  getLabValues(): LabValues {
    return { ...this.labValues };
  }

  setLabValues(v: LabValues) {
    this.labValues = { ...v };
    this.syncSliders();
  }

  setLabMode(on: boolean, specimenText = '') {
    this.inLab = on;
    document.body.classList.toggle('lab-mode', on);
    $('lab-banner').hidden = !on;
    $('lab-intro').hidden = on;
    $('lab-controls').hidden = !on;
    if (specimenText) $('lab-banner-text').textContent = specimenText;
    $('place-button').toggleAttribute('disabled', on);
  }

  setLabClock(text: string) {
    $('lab-clock').textContent = text;
  }

  setExposeBusy(busy: boolean) {
    $<HTMLButtonElement>('lab-expose-1').disabled = busy;
    $<HTMLButtonElement>('lab-expose-7').disabled = busy;
  }

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------

  setSettings(quality: string, motion: string) {
    const q = document.querySelector<HTMLInputElement>(`input[name="quality"][value="${quality}"]`);
    if (q) q.checked = true;
    const m = document.querySelector<HTMLInputElement>(`input[name="motion"][value="${motion}"]`);
    if (m) m.checked = true;
  }

  setQualityInfo(text: string) {
    $('set-quality-info').textContent = text;
  }

  setStorageInfo(text: string) {
    $('set-storage').textContent = text;
  }

  private wireSettings() {
    document.querySelectorAll<HTMLInputElement>('input[name="quality"]').forEach((i) =>
      i.addEventListener('change', () => this.cb.setQuality(i.value)),
    );
    document.querySelectorAll<HTMLInputElement>('input[name="motion"]').forEach((i) =>
      i.addEventListener('change', () => this.cb.setMotion(i.value)),
    );
    $('set-export').addEventListener('click', () => this.cb.exportData());
    const file = $<HTMLInputElement>('set-import-file');
    $('set-import').addEventListener('click', () => file.click());
    file.addEventListener('change', () => {
      const f = file.files?.[0];
      if (f) this.cb.importData(f);
      file.value = '';
    });
    $('set-reset').addEventListener('click', () => this.cb.reset());
  }

  // ---------------------------------------------------------------------------
  // Confirmation
  // ---------------------------------------------------------------------------

  private wireConfirm() {
    const d = $<HTMLDialogElement>('confirm-dialog');
    d.addEventListener('close', () => {
      this.confirmResolve?.(d.returnValue === 'confirm');
      this.confirmResolve = null;
    });
  }

  confirm(title: string, text: string, action: string): Promise<boolean> {
    const d = $<HTMLDialogElement>('confirm-dialog');
    $('confirm-title').textContent = title;
    $('confirm-text').textContent = text;
    $('confirm-ok').textContent = action;
    d.returnValue = '';
    d.showModal();
    $('confirm-cancel').focus();
    return new Promise((resolve) => (this.confirmResolve = resolve));
  }

  // ---------------------------------------------------------------------------
  // Observatory
  // ---------------------------------------------------------------------------

  updateObservatory(d: ObservatoryData, full: boolean) {
    $('obs-now').textContent = d.now;
    fillFacts($('obs-weather'), d.weather);
    $('obs-source').textContent = d.source;
    $('obs-mode').textContent = d.mode;
    fillMeters($('obs-behaviour'), d.behaviour);
    if (!full) return;
    drawTimeline($<HTMLCanvasElement>('obs-timeline'), d.timeline);
    fillFacts($('obs-trends'), d.trends);
    fillMeters($('obs-adaptation'), d.adaptation);
    $('obs-notes').replaceChildren(...d.notes.map((n) => Object.assign(document.createElement('p'), { textContent: n })));
    const ev = $('obs-events');
    if (!d.events.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'Nothing remarkable yet. Storms, frosts, heat, deluges and long calms are remembered here.';
      ev.replaceChildren(li);
    } else {
      ev.replaceChildren(
        ...d.events.map((e) => {
          const li = document.createElement('li');
          const t = document.createElement('time');
          t.dateTime = new Date(e.t).toISOString();
          t.textContent = new Date(e.t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
          const s = document.createElement('span');
          s.textContent = e.text;
          if (e.prenatal) s.className = 'prenatal';
          li.append(t, s);
          return li;
        }),
      );
    }
    fillFacts($('obs-identity'), d.identity);
  }
}

function fillFacts(dl: HTMLElement, rows: [string, string][]) {
  const nodes: HTMLElement[] = [];
  for (const [k, v] of rows) {
    nodes.push(Object.assign(document.createElement('dt'), { textContent: k }));
    nodes.push(Object.assign(document.createElement('dd'), { textContent: v }));
  }
  dl.replaceChildren(...nodes);
}

function fillMeters(host: HTMLElement, meters: Meter[]) {
  // Reuse existing rows so transitions animate instead of jumping.
  while (host.children.length > meters.length) host.lastChild!.remove();
  meters.forEach((m, i) => {
    let row = host.children[i] as HTMLElement | undefined;
    if (!row) {
      row = document.createElement('div');
      row.className = 'meter';
      row.innerHTML = `<span class="meter-label"></span><span class="meter-track" role="meter" aria-valuemin="0" aria-valuemax="100"><span class="meter-fill"></span><span class="meter-tick"></span><span class="meter-target"></span><span class="meter-dot"></span></span>`;
      host.append(row);
    }
    const min = m.min ?? 0, max = m.max ?? 1;
    const pct = (v: number) => `${(Math.max(min, Math.min(max, v)) - min) / (max - min) * 100}%`;
    (row.querySelector('.meter-label') as HTMLElement).textContent = m.label;
    const track = row.querySelector('.meter-track') as HTMLElement;
    track.setAttribute('aria-label', m.label);
    track.setAttribute('aria-valuenow', String(Math.round(((m.value - min) / (max - min)) * 100)));
    const neutral = m.neutral;
    const fill = row.querySelector('.meter-fill') as HTMLElement;
    if (neutral === undefined) {
      fill.style.left = '0';
      fill.style.width = pct(m.value);
    } else {
      const a = Math.min(neutral, m.value), b = Math.max(neutral, m.value);
      fill.style.left = pct(a);
      fill.style.width = `calc(${pct(b)} - ${pct(a)})`;
    }
    (row.querySelector('.meter-dot') as HTMLElement).style.left = pct(m.value);
    const tick = row.querySelector('.meter-tick') as HTMLElement;
    tick.hidden = neutral === undefined;
    if (neutral !== undefined) tick.style.left = pct(neutral);
    const target = row.querySelector('.meter-target') as HTMLElement;
    target.hidden = m.target === undefined;
    if (m.target !== undefined) target.style.left = pct(m.target);
  });
}
