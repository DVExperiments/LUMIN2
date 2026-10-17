/**
 * Application orchestrator. Owns the frame loop and connects:
 * weather acquisition → memory and adaptation → behaviour → simulation → rendering,
 * plus interaction, persistence and the interface.
 */
import { approach, clamp, degToRad } from './core/math';
import { viewExtent } from './core/view';
import { freshSeed, mulberry32 } from './core/random';
import { BehaviourEngine, MODE_LABEL, type BehaviourKey } from './behaviour/engine';
import { InteractionController } from './interaction/controller';
import { HOUR, markUnrecoverableGap, recentAverage, totalGapHours } from './memory/environment';
import { FEATURE_KEYS, conditionsToFeatures, copyFeatures, emptyFeatures, type Features } from './memory/features';
import { beginSession, recordGentle, recordTouch, tickInteraction } from './memory/interaction';
import { awaySummary, compassName, conditionsSentence, narrate, windFromName } from './memory/narrative';
import { morphologyTargets, neutralMorphology, type Morphology } from './organism/adaptation';
import { ageDays, cloneOrganism, createOrganism, genomeOf, ingestWeather, setLocation, type OrganismState } from './organism/state';
import { OrganismSimulation, QUALITY_PRESETS } from './organism/simulation';
import { fromExport, migrate, toExport, ImportError } from './persistence/serialize';
import { openBestStore, type KeyValueStore } from './persistence/storage';
import { CanvasRenderer } from './render/canvasRenderer';
import { QualityManager, type QualitySetting } from './render/quality';
import type { Renderer } from './render/types';
import { WebGLRenderer } from './render/webglRenderer';
import { UI, type LabValues, type ObservatoryData } from './ui/ui';
import { hitToLocation, locationId, searchLocations } from './weather/openMeteo';
import { WeatherService, formatAge, statusLabel } from './weather/service';
import { daylightFromElevation, solarAzimuth, solarElevation } from './weather/sun';
import type { Conditions, GeoLocation, HourRecord } from './weather/types';
import { describeCode } from './weather/validate';

type Motion = 'system' | 'reduce' | 'full';
interface Settings {
  quality: QualitySetting;
  motion: Motion;
  hintsShown: number;
}

const KEY_LIVE = 'organism:live';
const KEY_LAB = 'organism:lab';
const KEY_SETTINGS = 'settings';
const SAVE_INTERVAL = 30;

const EVENT_TEXT: Record<string, (m: number) => string> = {
  storm: (m) => `Storm, wind to ${Math.round(m)} km/h`,
  frost: (m) => `Frost, down to −${Math.round(m)}°`,
  heat: (m) => `Heat, up to ${Math.round(m)}°`,
  deluge: (m) => `Deluge, ${m.toFixed(1)} mm in an hour`,
  'long-rain': () => 'Twelve hours of unbroken rain',
  stillness: () => 'A day and a half of still air',
};

export class App {
  private store!: KeyValueStore;
  private ui!: UI;
  private weather!: WeatherService;
  private interaction!: InteractionController;
  private quality!: QualityManager;
  private renderer!: Renderer;
  private sim!: OrganismSimulation;
  private engine!: BehaviourEngine;
  private settings: Settings = { quality: 'auto', motion: 'system', hintsShown: 0 };

  private live!: OrganismState;
  private lab: OrganismState | null = null;
  private labKind: 'copy' | 'separate' = 'copy';
  private labValues: LabValues | null = null;
  private labExposedHours = 0;

  private envTarget: Features = emptyFeatures();
  private envSmooth: Features = emptyFeatures();
  private envInitialised = false;
  private lightAngle = Math.PI * 0.6;
  private weatherCode = 0;

  private rafId = 0;
  private lastFrame = 0;
  private saveClock = 0;
  private obsClock = 0;
  private obsFullClock = 0;
  private statusClock = 0;
  private gentleClock = 0;
  private roughClock = 0;
  private fogX = 0;
  private fogY = 0;
  private reducedMotion = false;
  private systemReduced = false;
  private lastWeatherError: string | null = null;
  private storageWarned = false;
  /** Smoothed CPU milliseconds per frame: behaviour + simulation, and draw submission. */
  private simMs = 0;
  /** Whether this visit's 'while you were away' line has been shown. */
  private welcomed = false;
  private drawMs = 0;

  constructor(private canvas: HTMLCanvasElement) {}

  private get active(): OrganismState {
    return this.lab ?? this.live;
  }

  // ---------------------------------------------------------------------------
  // Start-up
  // ---------------------------------------------------------------------------

  async start() {
    this.store = await openBestStore();
    try {
      const s = await this.store.get<Settings>(KEY_SETTINGS);
      if (s) this.settings = { ...this.settings, ...s };
    } catch {
      /* defaults */
    }

    const now = Date.now();
    let restored: OrganismState | null = null;
    try {
      const raw = await this.store.get<unknown>(KEY_LIVE);
      if (raw) restored = migrate(raw, now);
    } catch (e) {
      console.warn('Could not restore organism', e);
    }
    const newborn = !restored;
    this.live = restored ?? createOrganism(freshSeed(), now, 'live');

    // Session bookkeeping: remember what it looked like when you last left.
    const lastSeen = this.live.interaction.lastSeen;
    if (!newborn && (!this.live.previousVisit || now - lastSeen > 2 * HOUR)) {
      this.live.previousVisit = { t: lastSeen, m: { ...this.live.morphology } };
    }
    beginSession(this.live.interaction, now);

    this.ui = new UI({
      searchLocations: (q) => searchLocations(q),
      chooseLocation: (h) => this.changeLocation(hitToLocation(h, 'search')),
      useDeviceLocation: () => this.useDeviceLocation(),
      enterLab: (k) => this.enterLab(k),
      exitLab: () => this.exitLab(),
      labChanged: (v) => (this.labValues = v),
      labExpose: (h) => this.labExpose(h),
      setQuality: (q) => this.setQuality(q as QualitySetting),
      setMotion: (m) => this.setMotion(m as Motion),
      exportData: () => this.exportData(),
      importData: (f) => this.importData(f),
      reset: () => this.reset(),
      observatoryOpened: () => this.refreshObservatory(true),
    });
    this.ui.setSettings(this.settings.quality, this.settings.motion);
    this.ui.setStorageInfo(this.storageText());

    // Motion preference.
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    this.systemReduced = mq.matches;
    mq.addEventListener?.('change', (e) => {
      this.systemReduced = e.matches;
      this.applyMotion();
    });
    this.applyMotion();

    // Rendering.
    this.quality = new QualityManager(this.settings.quality);
    this.createRenderer();
    this.interaction = new InteractionController(this.canvas);
    this.buildSimulation(this.live);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => this.onVisibility());
    window.addEventListener('pagehide', () => void this.save());

    this.updateIdentity();

    // Weather: restore cache, then fetch. The organism is already alive meanwhile.
    await this.weather_init(newborn);

    this.lastFrame = performance.now();
    this.rafId = requestAnimationFrame(this.frame);
    // `?debug` exposes the running app for inspection from the console.
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as { lumin: unknown }).lumin = this;

    if (newborn) {
      const g = genomeOf(this.live);
      this.ui.genesis(g.name, 'has just formed');
    }
    if (this.settings.hintsShown < 2) {
      window.setTimeout(() => this.ui.showHint(), newborn ? 6200 : 2500);
      this.settings.hintsShown++;
      void this.saveSettings();
    }
  }

  private async weather_init(newborn: boolean) {
    this.weather = new WeatherService(this.store);
    await this.weather.restore(this.live.location, Date.now());
    this.applyConditions(true);
    if (!this.live.location) {
      void this.guessLocation(newborn);
    } else {
      void this.refreshWeather();
    }
  }

  private createRenderer() {
    try {
      this.renderer = new WebGLRenderer(this.canvas, this.quality.settings);
    } catch (e) {
      console.info('WebGL2 unavailable, using Canvas 2D', e);
      this.renderer = new CanvasRenderer(this.canvas, this.quality.settings);
      this.ui.toast('Your browser lacks WebGL2, so LUMIN is drawing a simpler version of itself.', 6000);
    }
  }

  private buildSimulation(o: OrganismState) {
    const g = genomeOf(o);
    this.sim = new OrganismSimulation(g, QUALITY_PRESETS[this.quality.preset]);
    this.engine = new BehaviourEngine(g, o.mood);
    this.resize();
  }

  private resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const [vx, vy] = viewExtent(w, h);
    this.sim?.setView(vx, vy);
    this.interaction?.setViewport(w, h);
    this.renderer?.resize(w, h, window.devicePixelRatio || 1);
  }

  // ---------------------------------------------------------------------------
  // Location
  // ---------------------------------------------------------------------------

  private async guessLocation(newborn: boolean) {
    let tz = '';
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch {
      tz = '';
    }
    const city = tz.includes('/') ? tz.split('/').pop()!.replace(/_/g, ' ') : '';
    if (city) {
      try {
        const hits = await searchLocations(city);
        const hit = hits.find((h) => h.timezone === tz) ?? hits[0];
        if (hit) {
          await this.changeLocation(hitToLocation(hit, 'timezone-guess'), true);
          this.ui.toast(`Living in ${hit.name}, guessed from your time zone. Choose another place any time.`, 6500);
          return;
        }
      } catch {
        /* fall through to manual choice */
      }
    }
    this.ui.openLocation(
      newborn
        ? 'Choose a place to give it real weather. Until then it lives in a simulated environment.'
        : 'Choose a place to give it real weather.',
    );
  }

  private async useDeviceLocation() {
    const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, () => reject(new Error('Location permission was not granted. Search for a city instead.')), {
        enableHighAccuracy: false,
        timeout: 12000,
        maximumAge: 3600000,
      }),
    );
    // Round to ~1 km: precision beyond that adds nothing to the weather.
    const lat = Math.round(pos.coords.latitude * 100) / 100;
    const lon = Math.round(pos.coords.longitude * 100) / 100;
    await this.changeLocation({
      id: locationId(lat, lon),
      name: 'Your location',
      region: `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? 'E' : 'W'}`,
      latitude: lat,
      longitude: lon,
      origin: 'geolocation',
    });
  }

  private async changeLocation(loc: GeoLocation, quiet = false) {
    const moved = this.live.location && this.live.location.id !== loc.id;
    setLocation(this.live, loc, Date.now());
    this.updateIdentity();
    await this.weather.restore(loc, Date.now());
    this.applyConditions(false);
    void this.save();
    await this.refreshWeather();
    if (moved && !quiet) this.ui.toast(`${genomeOf(this.live).name} now lives in ${loc.name}. Its memory comes with it.`);
  }

  private placeText(o: OrganismState): string | null {
    const l = o.location;
    if (!l) return null;
    return l.country && l.origin !== 'geolocation' ? `${l.name}, ${l.country}` : l.name;
  }

  private updateIdentity() {
    const o = this.active;
    const g = genomeOf(o);
    const place = this.lab ? 'the laboratory' : this.placeText(o);
    this.ui.setIdentity(g.name, place);
    this.ui.setLabCopyLabel(genomeOf(this.live).name);
  }

  // ---------------------------------------------------------------------------
  // Weather → memory
  // ---------------------------------------------------------------------------

  private async refreshWeather() {
    const loc = this.live.location;
    if (!loc) return;
    const now = Date.now();
    const since = this.live.memory.processedUntil;
    const newborn = since === null;
    try {
      const res = await this.weather.acquire(loc, since, now);
      if (this.live.location?.id !== loc.id) return; // location changed mid-flight
      this.lastWeatherError = null;
      if (res.truncatedFrom !== null) {
        const firstAvailable = res.hours.length ? res.hours[0].t : now;
        markUnrecoverableGap(this.live.memory, res.truncatedFrom, firstAvailable);
      }
      const report = ingestWeather(this.live, res.hours);
      if (newborn && res.hours.length) {
        this.live.ancestral = { from: res.hours[0].t, to: res.hours[res.hours.length - 1].t + HOUR, hours: report.added };
      }
      // Returning visitor: once per visit, after real catch-up data has arrived. The
      // 'while you were away' moment replaces the plainer catch-up notice.
      let welcomeLine: string | null = null;
      if (!this.welcomed && !newborn && !this.lab) {
        this.welcomed = true;
        welcomeLine = awaySummary(this.live, Date.now(), genomeOf(this.live).name);
      }
      if (welcomeLine) this.ui.welcomeBack(genomeOf(this.live).name, welcomeLine);
      else if (!newborn && since !== null && report.added > 2) {
        const parts = [`Caught up on ${report.added} hours of weather since your last visit.`];
        if (report.gapHours > 0) parts.push(`${report.gapHours} hours had no data and were left out.`);
        if (res.archiveFailed) parts.push('Older history could not be fetched this time.');
        this.ui.toast(parts.join(' '), 6500);
      }
      this.applyConditions(false);
      this.refreshObservatory(true);
      void this.save();
    } catch (e) {
      const msg = (e as Error).message || 'Weather unavailable';
      if (msg !== this.lastWeatherError) {
        const s = this.weather.status;
        this.ui.toast(
          s.fetchedAt !== null
            ? `${msg}. Showing cached conditions from ${formatAge(Date.now() - s.fetchedAt)}.`
            : `${msg}. Showing a simulated environment until the connection returns.`,
          6500,
        );
      }
      this.lastWeatherError = msg;
      this.applyConditions(false);
    }
  }

  /** Convert current conditions (or lab values) into target features. */
  private applyConditions(immediate: boolean) {
    const now = Date.now();
    let c: Conditions;
    let daylight: number;
    if (this.lab && this.labValues) {
      const v = this.labValues;
      const el = -Math.cos(((v.hour - 0.5) / 24) * Math.PI * 2) * 62;
      daylight = daylightFromElevation(el);
      c = {
        time: now, temperature: v.temperature, windSpeed: v.windSpeed, windDirection: v.windDirection,
        precipitation: v.precipitation, humidity: v.humidity, cloudCover: v.cloudCover,
        weatherCode: v.windSpeed > 70 && v.precipitation > 2 ? 95 : v.precipitation > 0.2 ? 61 : v.cloudCover > 80 ? 3 : 1,
        isDay: daylight > 0.5, sunrise: null, sunset: null,
      };
      const az = 90 + (v.hour - 6) * 15;
      this.lightAngle = this.lightFrom(az, el);
    } else {
      c = this.weather.status.conditions;
      const loc = this.live.location;
      if (loc) {
        const el = solarElevation(now, loc.latitude, loc.longitude);
        daylight = daylightFromElevation(el);
        this.lightAngle = this.lightFrom(solarAzimuth(now, loc.latitude, loc.longitude), el);
      } else {
        daylight = c.isDay ? 1 : 0;
      }
    }
    this.weatherCode = c.weatherCode;
    conditionsToFeatures(c, daylight, this.envTarget);
    if (immediate || !this.envInitialised) {
      copyFeatures(this.envTarget, this.envSmooth);
      this.envInitialised = true;
    }
  }

  private lightFrom(azimuthDeg: number, elevationDeg: number): number {
    if (elevationDeg < -6) return Math.PI * 0.62; // moonlight from above-left
    return Math.PI / 2 + degToRad(180 - azimuthDeg) * 0.5;
  }

  // ---------------------------------------------------------------------------
  // Frame loop
  // ---------------------------------------------------------------------------

  private frame = (tNow: number) => {
    this.rafId = requestAnimationFrame(this.frame);
    const dtMs = tNow - this.lastFrame;
    this.lastFrame = tNow;
    const dt = Math.min(0.1, Math.max(0, dtMs / 1000));
    if (dt <= 0) return;
    const now = Date.now();
    const o = this.active;
    const g = genomeOf(o);

    // Environment smoothing: slow for real weather, quicker in the laboratory.
    if (this.lab) this.applyConditions(false);
    const tau = this.lab ? 2.5 : 25;
    for (const k of FEATURE_KEYS) this.envSmooth[k] = approach(this.envSmooth[k], this.envTarget[k], dt, tau);

    // Interaction.
    const disturbances = this.interaction.update(dt);
    const p = this.interaction.pointer;
    const dx = p.x - this.sim.cx, dy = p.y - this.sim.cy;
    const dist = Math.hypot(dx, dy);
    const proximity = p.present ? clamp(1 - (dist - this.sim.shape.radius) / 0.7) : 0;
    const speed = Math.hypot(p.vx, p.vy);
    let impulse = 0;
    for (const d of disturbances) {
      const near = clamp(1 - (Math.hypot(d.x - this.sim.cx, d.y - this.sim.cy) - this.sim.shape.radius) / 1.2);
      impulse += d.intensity * (0.3 + near * 0.7);
      this.sim.disturb(d.x, d.y, d.intensity);
      recordTouch(o.interaction, d.intensity * (0.6 + near * 0.6));
    }
    if (p.present && proximity > 0.35 && speed < 0.6) {
      this.gentleClock += dt;
      if (this.gentleClock > 5) {
        recordGentle(o.interaction, this.gentleClock);
        this.gentleClock = 0;
      }
    }
    this.roughClock -= dt;
    if (p.present && proximity > 0.5 && speed > 2.8 && this.roughClock <= 0) {
      recordTouch(o.interaction, 0.9);
      this.roughClock = 1.5;
    }
    tickInteraction(o.interaction, dt, now);
    if (this.interaction.keyboardActive) {
      const [sx, sy] = this.interaction.toScreen(p.x, p.y);
      this.ui.setProbe(true, sx, sy);
    } else this.ui.setProbe(false);

    // Behaviour.
    const tSim = performance.now();
    this.engine.update(dt, {
      env: this.envSmooth,
      exposure: o.memory.exposure,
      morph: o.morphology,
      genome: g,
      familiarity: o.interaction.familiarity,
      wariness: o.interaction.wariness,
      stimulus: { proximity, speed, impulse, present: p.present },
      idleSeconds: this.interaction.idleSeconds,
    });

    // Simulation and rendering.
    this.sim.update(dt, {
      env: this.envSmooth,
      mood: this.engine.state,
      arousal: this.engine.arousal,
      boredom: this.engine.boredom,
      morph: o.morphology,
      marks: o.marks,
      genome: g,
      familiarity: o.interaction.familiarity,
      pointer: p,
      lightAngle: this.lightAngle,
      reducedMotion: this.reducedMotion,
      weatherCode: this.weatherCode,
    });
    this.fogX += this.envSmooth.windX * dt * 0.035 * (this.reducedMotion ? 0.4 : 1);
    this.fogY += (this.envSmooth.windY * 0.035 + 0.002) * dt * (this.reducedMotion ? 0.4 : 1);
    const tDraw = performance.now();
    if (!this.renderer.lost) this.renderer.render(this.sim, { lab: !!this.lab, reducedMotion: this.reducedMotion, fogX: this.fogX, fogY: this.fogY });
    const tEnd = performance.now();
    this.simMs += (tDraw - tSim - this.simMs) * 0.05;
    this.drawMs += (tEnd - tDraw - this.drawMs) * 0.05;

    if (this.quality.sample(dtMs, dt)) {
      this.renderer.configure(this.quality.settings);
      this.resize();
    }

    // Periodic work.
    this.statusClock -= dt;
    if (this.statusClock <= 0) {
      this.statusClock = 1;
      this.weather.tick(now);
      this.updateStatus(now);
      // Real weather keeps being recorded into the real organism, even during experiments.
      if (this.live.location && this.weather.needsRefresh(now)) void this.refreshWeather();
      if (!this.lab) this.applyConditions(false);
    }
    this.obsClock -= dt;
    this.obsFullClock -= dt;
    if (this.ui.isOpen('observatory') && this.obsClock <= 0) {
      this.obsClock = 0.5;
      const full = this.obsFullClock <= 0;
      if (full) this.obsFullClock = 6;
      this.refreshObservatory(full);
    }
    this.saveClock += dt;
    if (this.saveClock > SAVE_INTERVAL) {
      this.saveClock = 0;
      void this.save();
    }
  };

  private onVisibility() {
    if (document.hidden) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
      void this.save();
    } else if (!this.rafId) {
      this.lastFrame = performance.now();
      this.rafId = requestAnimationFrame(this.frame);
      if (this.live.location && this.weather.needsRefresh(Date.now())) void this.refreshWeather();
    }
  }

  private updateStatus(now: number) {
    const s = this.weather.status;
    if (this.lab) {
      this.ui.setStatus('laboratory', this.labKind === 'copy' ? 'Laboratory weather, temporary copy' : 'Laboratory weather, experimental organism');
      const v = this.labValues;
      if (v) this.ui.setConditions(conditionsSentence({ ...v, weatherCode: this.weatherCode }, describeCode));
      return;
    }
    let label = statusLabel(s, now);
    if (s.source === 'simulated') label = this.live.location ? 'Simulated weather, live data unavailable' : 'Simulated weather, no place chosen yet';
    this.ui.setStatus(s.source, this.weather.busy && s.fetchedAt === null ? 'Fetching weather' : label);
    this.ui.setConditions(s.source === 'simulated' ? '' : conditionsSentence(s.conditions, describeCode));
    const gpu = this.renderer.gpuMs;
    this.ui.setQualityInfo(
      `${this.quality.describe(this.renderer.kind === 'webgl2' ? 'WebGL2' : 'Canvas 2D fallback')} ` +
        `Each frame: simulation ${this.simMs.toFixed(1)} ms and drawing ${this.drawMs.toFixed(1)} ms on the CPU` +
        (gpu !== null ? `, ${gpu.toFixed(1)} ms on the GPU.` : '; GPU timing is not available in this browser.'),
    );
    const mode = MODE_LABEL[this.engine.mode];
    this.canvas.setAttribute('aria-label', `${genomeOf(this.active).name}, a luminous organism, is ${mode.toLowerCase()}. Move the pointer near it, click or tap to send a pulse, or use the arrow keys and space.`);
  }

  // ---------------------------------------------------------------------------
  // Observatory
  // ---------------------------------------------------------------------------

  private refreshObservatory(full: boolean) {
    if (!this.ui.isOpen('observatory')) return;
    const o = this.active;
    const g = genomeOf(o);
    const now = Date.now();
    const s = this.weather.status;
    const inLab = !!this.lab;
    const c: Conditions = inLab && this.labValues
      ? { ...s.conditions, temperature: this.labValues.temperature, windSpeed: this.labValues.windSpeed, windDirection: this.labValues.windDirection, precipitation: this.labValues.precipitation, humidity: this.labValues.humidity, cloudCover: this.labValues.cloudCover, weatherCode: this.weatherCode }
      : s.conditions;
    const tz = o.location?.timezone;
    const time = (t: number | null) => {
      if (t === null) return 'Not available';
      try {
        return new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', timeZone: tz });
      } catch {
        return new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      }
    };
    const placeName = inLab ? 'the laboratory' : o.location?.name ?? 'a simulated place';
    const nowText = inLab
      ? `${g.name} is in the laboratory, under weather you control.`
      : s.source === 'simulated'
        ? `${g.name} is living in a simulated environment${o.location ? ' until live weather returns' : ' until you choose a place'}.`
        : `${g.name} is living in ${placeName}: ${conditionsSentence(c, describeCode).toLowerCase()}.`;
    const sourceText = inLab
      ? 'Source: laboratory controls. Nothing here is written into the real organism’s memory.'
      : s.source === 'simulated'
        ? 'Source: simulated stand-in. It is not recorded into memory.'
        : `Source: Open-Meteo, ${s.source === 'live' ? 'live' : 'cached'}, fetched ${formatAge(now - (s.fetchedAt ?? now))}${s.lastError ? `. Last attempt failed: ${s.lastError}` : ''}.`;

    const behaviourLabels: Record<BehaviourKey, string> = {
      energy: 'Energy', curiosity: 'Curiosity', openness: 'Openness', cohesion: 'Cohesion',
      tension: 'Tension', stability: 'Stability', comfort: 'Comfort', sensitivity: 'Sensitivity',
    };
    const m = o.morphology;
    const target = morphologyTargets(o.memory.exposure);
    const neutral = neutralMorphology();
    const adapt = (key: keyof Morphology, label: string, min = 0, max = 1) => ({ label, value: m[key], neutral: neutral[key], target: target[key], min, max });

    const d24 = recentAverage(o.memory, 24);
    const lastWeek = o.memory.daily.slice(-7);
    const weekRain = lastWeek.reduce((a, d) => a + d.Ptot, 0);
    const weekT = lastWeek.length ? lastWeek.reduce((a, d) => a + d.Tavg, 0) / lastWeek.length : null;
    const weekWmax = lastWeek.reduce((a, d) => Math.max(a, d.Wmax), 0);
    const L = o.memory.exposure.long;
    const end = o.memory.processedUntil ?? now;

    const data: ObservatoryData = {
      now: nowText,
      weather: [
        ['Temperature', `${c.temperature.toFixed(1)} °C`],
        ['Wind', c.windSpeed < 1 ? 'Calm' : `${Math.round(c.windSpeed)} km/h from the ${compassName(c.windDirection)}`],
        ['Precipitation', `${c.precipitation.toFixed(1)} mm`],
        ['Humidity', `${Math.round(c.humidity)} %`],
        ['Cloud cover', `${Math.round(c.cloudCover)} %`],
        ['Sky', describeCode(c.weatherCode)],
        ...(!inLab ? ([['Sunrise', time(c.sunrise)], ['Sunset', time(c.sunset)]] as [string, string][]) : []),
      ],
      source: sourceText,
      mode: MODE_LABEL[this.engine.mode],
      behaviour: (Object.keys(behaviourLabels) as BehaviourKey[]).map((k) => ({ label: behaviourLabels[k], value: this.engine.state[k] })),
      timeline: { records: o.memory.records, gaps: o.memory.gaps, events: o.memory.events, birth: o.bornAt, end, days: 14 },
      trends: [
        ['Last 24 hours', d24 ? `${d24.T.toFixed(1)}°, ${d24.Ptot.toFixed(1)} mm rain, wind ${Math.round(d24.W)} km/h` : 'No data'],
        ['Last 7 days', weekT !== null ? `${weekT.toFixed(1)}°, ${weekRain.toFixed(0)} mm rain, gusts to ${Math.round(weekWmax)} km/h` : 'No data'],
        ['Prevailing wind', L.wind > 0.08 ? `from the ${windFromName(L.windX, L.windY)}` : 'None to speak of'],
        ['Missing data', `${totalGapHours(o.memory)} hours`],
      ],
      adaptation: [
        adapt('elongation', 'Streamlining'),
        adapt('crystal', 'Crystallinity'),
        adapt('expanse', 'Size'),
        adapt('filament', 'Filament reach'),
        adapt('density', 'Cilia density'),
        adapt('luminance', 'Inner light'),
        adapt('softness', 'Softness'),
        adapt('hueDrift', 'Colour drift', -1, 1),
        adapt('resilience', 'Resilience'),
      ],
      notes: full ? narrate(o, now, g.name) : [],
      events: o.memory.events.slice(-12).reverse().map((e) => ({
        t: e.t,
        text: (EVENT_TEXT[e.kind]?.(e.magnitude) ?? e.kind) + (e.prenatal ? ', before birth' : ''),
        prenatal: e.prenatal,
      })),
      identity: [
        ['Name', g.name],
        ['Seed', o.seed.toString(16).padStart(8, '0')],
        ['Formed', new Date(o.bornAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })],
        ['Age', formatDays(ageDays(o, now))],
        ['Weather lived through', `${Math.max(0, o.memory.exposure.observedHours - (o.ancestral?.hours ?? 0))} hours`],
        ['Ancestral climate', o.ancestral ? `${o.ancestral.hours} hours before it formed` : inLab && this.labKind === 'separate' ? 'None (laboratory-born)' : 'None recorded'],
        ['Visits', String(o.interaction.sessions)],
        ['Time in company', formatDuration(o.interaction.gentleSeconds)],
        ['Familiarity with you', `${Math.round(o.interaction.familiarity * 100)} %`],
        ['Temperament', `${g.curiosity > 0.55 ? 'curious' : 'reserved'}, ${g.skittishness > 0.5 ? 'easily startled' : 'steady'}`],
        ...(o.locationLog.length > 1 ? ([['Places lived', o.locationLog.map((l) => l.name).filter((v, i, a) => a.indexOf(v) === i).join(', ')]] as [string, string][]) : []),
      ],
    };
    this.ui.updateObservatory(data, full);
  }

  // ---------------------------------------------------------------------------
  // Laboratory
  // ---------------------------------------------------------------------------

  private async enterLab(kind: 'copy' | 'separate') {
    if (this.lab) return;
    if (this.engine) this.live.mood = this.engine.snapshot();
    this.labKind = kind;
    this.labExposedHours = 0;
    if (kind === 'copy') {
      this.lab = cloneOrganism(this.live);
      this.lab.kind = 'experimental';
    } else {
      let spec: OrganismState | null = null;
      try {
        const raw = await this.store.get<unknown>(KEY_LAB);
        if (raw) spec = migrate(raw);
      } catch {
        spec = null;
      }
      this.lab = spec ?? createOrganism(freshSeed(), Date.now(), 'experimental');
      this.buildSimulation(this.lab);
    }
    // Start from the weather that is actually outside, so the change is visible.
    const c = this.weather.status.conditions;
    const d = new Date();
    this.labValues = {
      temperature: Math.round(c.temperature * 2) / 2,
      windSpeed: Math.round(c.windSpeed),
      windDirection: Math.round(c.windDirection),
      precipitation: Math.round(c.precipitation * 10) / 10,
      humidity: Math.round(c.humidity),
      cloudCover: Math.round(c.cloudCover),
      hour: d.getHours() + d.getMinutes() / 60,
    };
    this.ui.setLabValues(this.labValues);
    const name = genomeOf(this.lab).name;
    this.ui.setLabMode(
      true,
      kind === 'copy'
        ? `Simulated weather on a temporary copy of ${genomeOf(this.live).name}. The real one’s memory is untouched.`
        : `Simulated weather on ${name}, a separate experimental organism.`,
    );
    this.ui.setLabClock('');
    this.updateIdentity();
    this.applyConditions(false);
    this.refreshObservatory(true);
  }

  private async exitLab() {
    if (!this.lab) return;
    const wasSeparate = this.labKind === 'separate';
    if (wasSeparate) {
      this.lab.mood = this.engine.snapshot();
      try {
        await this.store.set(KEY_LAB, this.lab);
      } catch {
        /* best effort */
      }
    }
    const differentBody = this.lab.seed !== this.live.seed || wasSeparate;
    this.lab = null;
    this.labValues = null;
    if (differentBody) this.buildSimulation(this.live);
    this.ui.setLabMode(false);
    this.updateIdentity();
    this.applyConditions(false);
    this.updateStatus(Date.now());
    this.refreshObservatory(true);
    this.ui.toast(`Back to live weather. ${genomeOf(this.live).name}’s memory was not changed by the experiment.`);
  }

  /** Feed simulated hours of the current lab weather into the lab organism only. */
  private labExpose(hours: number) {
    const lab = this.lab;
    const v = this.labValues;
    if (!lab || !v) return;
    this.ui.setExposeBusy(true);
    const start = lab.memory.processedUntil ?? Math.floor(Date.now() / HOUR) * HOUR;
    const rnd = mulberry32((lab.seed ^ Math.floor(start / HOUR)) >>> 0);
    const out: HourRecord[] = [];
    for (let i = 0; i < hours; i++) {
      const hod = (v.hour + i) % 24;
      const el = -Math.cos(((hod - 0.5) / 24) * Math.PI * 2) * 62;
      const diurnal = Math.sin(((hod - 9) / 24) * Math.PI * 2);
      const jitter = rnd() - 0.5;
      out.push({
        t: start + i * HOUR,
        T: clamp(v.temperature + diurnal * 2.5 + jitter * 1.5, -60, 55),
        W: Math.max(0, v.windSpeed * (0.8 + rnd() * 0.4)),
        D: (v.windDirection + jitter * 30 + 360) % 360,
        P: v.precipitation > 0 ? Math.max(0, v.precipitation * (0.5 + rnd())) : 0,
        H: clamp(v.humidity + jitter * 6, 0, 100),
        C: clamp(v.cloudCover + jitter * 10, 0, 100),
        c: v.windSpeed > 70 && v.precipitation > 2 ? 95 : v.precipitation > 0.2 ? 61 : 1,
        d: el > -0.83 ? 1 : 0,
        l: 'laboratory',
      });
    }
    const report = ingestWeather(lab, out);
    this.labExposedHours += report.added;
    const days = this.labExposedHours / 24;
    this.ui.setLabClock(`Simulated exposure in this session: ${formatDays(days)}.${report.events.length ? ` Remembered: ${report.events.map((e) => e.kind.replace('-', ' ')).join(', ')}.` : ''}`);
    this.ui.toast(`${genomeOf(lab).name} has lived through ${hours === 24 ? 'a day' : `${Math.round(hours / 24)} days`} of this weather. Watch its shape settle.`);
    this.refreshObservatory(true);
    window.setTimeout(() => this.ui.setExposeBusy(false), 600);
  }

  // ---------------------------------------------------------------------------
  // Settings and data
  // ---------------------------------------------------------------------------

  private setQuality(q: QualitySetting) {
    const before = this.quality.preset;
    this.quality.setMode(q);
    this.settings.quality = q;
    this.renderer.configure(this.quality.settings);
    if (before !== this.quality.preset) this.sim.build(QUALITY_PRESETS[this.quality.preset]);
    this.resize();
    void this.saveSettings();
  }

  private setMotion(m: Motion) {
    this.settings.motion = m;
    this.applyMotion();
    void this.saveSettings();
  }

  private applyMotion() {
    const m = this.settings.motion;
    this.reducedMotion = m === 'reduce' || (m === 'system' && this.systemReduced);
    this.ui?.setReducedMotion(this.reducedMotion);
  }

  private storageText() {
    switch (this.store.kind) {
      case 'indexeddb':
        return 'Saved automatically in this browser (IndexedDB). Nothing is uploaded.';
      case 'localstorage':
        return 'Saved automatically in this browser (local storage). Nothing is uploaded.';
      default:
        return 'This browser is not allowing storage, so the organism will be forgotten when you close the page. Export it to keep it.';
    }
  }

  private async save() {
    if (!this.live) return;
    const now = Date.now();
    if (!this.lab && this.engine) this.live.mood = this.engine.snapshot();
    this.live.savedAt = now;
    try {
      await this.store.set(KEY_LIVE, this.live);
      if (this.lab && this.labKind === 'separate') {
        this.lab.mood = this.engine.snapshot();
        await this.store.set(KEY_LAB, this.lab);
      }
    } catch (e) {
      if (!this.storageWarned) {
        this.storageWarned = true;
        this.ui.toast('Saving failed. The browser may be out of storage space. Export your organism to keep it safe.', 7000);
      }
      console.warn('Save failed', e);
    }
  }

  private async saveSettings() {
    try {
      await this.store.set(KEY_SETTINGS, this.settings);
    } catch {
      /* non-critical */
    }
  }

  private exportData() {
    if (!this.lab) this.live.mood = this.engine.snapshot();
    const env = toExport(this.live);
    const blob = new Blob([JSON.stringify(env)], { type: 'application/json' });
    const a = document.createElement('a');
    const name = genomeOf(this.live).name.toLowerCase();
    a.href = URL.createObjectURL(blob);
    a.download = `lumin-${name}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    this.ui.toast(`Exported ${genomeOf(this.live).name}.`);
  }

  private async importData(file: File) {
    let imported: OrganismState;
    try {
      if (file.size > 20 * 1024 * 1024) throw new ImportError('The file is too large to be a LUMIN organism');
      imported = fromExport(await file.text());
    } catch (e) {
      this.ui.toast(e instanceof ImportError ? `Import failed: ${e.message}.` : 'Import failed: the file could not be read.', 6000);
      return;
    }
    const name = genomeOf(imported).name;
    const ok = await this.ui.confirm(
      `Import ${name}?`,
      `This replaces ${genomeOf(this.live).name} in this browser. Export the current organism first if you want to keep it.`,
      `Import ${name}`,
    );
    if (!ok) return;
    if (this.lab) await this.exitLab();
    imported.kind = 'live';
    beginSession(imported.interaction, Date.now());
    this.live = imported;
    this.buildSimulation(this.live);
    await this.save();
    this.updateIdentity();
    await this.weather.restore(this.live.location, Date.now());
    this.applyConditions(true);
    this.ui.toast(`${name} has arrived.`);
    if (this.live.location) void this.refreshWeather();
    else this.ui.openLocation('Choose a place for it to live.');
  }

  private async reset() {
    const name = genomeOf(this.live).name;
    const ok = await this.ui.confirm(
      'Begin a new organism?',
      `${name} and everything it remembers will be removed from this browser. This cannot be undone unless you have exported it.`,
      `Release ${name}`,
    );
    if (!ok) return;
    if (this.lab) await this.exitLab();
    const loc = this.live.location;
    this.live = createOrganism(freshSeed(), Date.now(), 'live');
    beginSession(this.live.interaction, Date.now());
    if (loc) setLocation(this.live, loc, Date.now());
    this.buildSimulation(this.live);
    this.updateIdentity();
    await this.save();
    const g = genomeOf(this.live);
    this.ui.genesis(g.name, 'has just formed');
    if (loc) void this.refreshWeather();
  }
}

function formatDays(d: number): string {
  if (d < 1 / 24) return 'less than an hour';
  if (d < 1) {
    const h = Math.round(d * 24);
    return h === 1 ? '1 hour' : `${h} hours`;
  }
  const n = Math.round(d * 10) / 10;
  return n === 1 ? '1 day' : `${n % 1 === 0 ? n.toFixed(0) : n.toFixed(1)} days`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return seconds < 5 ? 'none yet' : `${Math.round(seconds)} seconds`;
  const m = Math.round(seconds / 60);
  if (m < 60) return m === 1 ? '1 minute' : `${m} minutes`;
  const h = Math.round((m / 60) * 10) / 10;
  return `${h} hours`;
}
