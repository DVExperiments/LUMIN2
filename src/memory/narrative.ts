/**
 * Plain-language explanations of what the organism has lived through and how
 * that has shaped it. Every sentence is derived from stored memory, never invented.
 */
import { neutralMorphology, morphologyTargets, type Morphology } from '../organism/adaptation';
import type { OrganismState } from '../organism/state';
import { DAY, HOUR, recentAverage, totalGapHours } from './environment';

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

/** Compass name for a "blows toward" vector, reported as where the wind came FROM. */
export function windFromName(x: number, y: number): string {
  const toDeg = (Math.atan2(x, y) * 180) / Math.PI;
  const from = (toDeg + 180 + 360) % 360;
  return COMPASS[Math.round(from / 45) % 8];
}

export function compassName(deg: number): string {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

const TRAIT_WORDS: Record<string, [string, string]> = {
  elongation: ['drawn out into a streamlined shape', 'rounded out again'],
  crystal: ['grown more crystalline and faceted', 'softened, its facets melting'],
  expanse: ['expanded', 'drawn in and become smaller'],
  filament: ['grown longer, more flowing filaments', 'shortened its filaments'],
  density: ['sprouted more fine cilia', 'shed some of its cilia'],
  luminance: ['begun glowing more brightly from within', 'dimmed its inner light'],
  softness: ['taken on a softer, more diffuse glow', 'sharpened its outline'],
  hueDrift: ['shifted toward warmer colours', 'shifted toward colder colours'],
  resilience: ['toughened against unsettled weather', 'relaxed its guard'],
};

export function describeChanges(from: Morphology, to: Morphology, threshold = 0.04): string[] {
  const out: { mag: number; text: string }[] = [];
  for (const k of Object.keys(TRAIT_WORDS)) {
    const key = k as keyof Morphology;
    const d = to[key] - from[key];
    const th = key === 'hueDrift' ? threshold * 0.5 : threshold;
    if (Math.abs(d) < th) continue;
    out.push({ mag: Math.abs(d), text: TRAIT_WORDS[k][d > 0 ? 0 : 1] });
  }
  return out.sort((a, b) => b.mag - a.mag).slice(0, 3).map((x) => x.text);
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
}

function days(n: number): string {
  const d = Math.round(n);
  return d === 1 ? 'a day' : `${d} days`;
}

/** Short paragraphs for the Observatory "Notes" section. */
export function narrate(o: OrganismState, now: number, name: string): string[] {
  const notes: string[] = [];
  const m = o.morphology;
  const ex = o.memory.exposure;
  const neutral = neutralMorphology();

  // Since last visit.
  if (o.previousVisit && now - o.previousVisit.t > 2 * HOUR) {
    const changes = describeChanges(o.previousVisit.m, m);
    const away = (now - o.previousVisit.t) / DAY;
    const when = away < 1 ? 'Since earlier today' : `In the ${days(away)} since your last visit`;
    notes.push(changes.length ? `${when}, ${name} has ${joinList(changes)}.` : `${when}, ${name} has kept its shape.`);
  }

  // Dominant acquired traits, explained by their causes.
  const L = ex.long;
  if (m.elongation > 0.3) {
    notes.push(`A week of mostly ${L.wind > 0.5 ? 'strong' : 'steady'} wind from the ${windFromName(m.axisX, m.axisY)} has streamlined its body along the wind.`);
  }
  if (m.crystal > 0.4) {
    notes.push(m.crystal > 0.6 ? 'Sustained cold has made its structure distinctly crystalline.' : 'Cool weather has begun to stiffen its membrane into facets.');
  }
  if (m.filament > 0.6) notes.push('Mild, humid air has let its filaments grow long and loose.');
  if (m.density > 0.55) notes.push('Rainy days have filled its edges with fine cilia.');
  if (m.luminance > 0.75) notes.push('Short, grey days have pushed it to make more of its own light.');
  if (m.expanse > 0.62) notes.push('Warmth and light have let it spread to a generous size.');
  if (m.expanse < 0.32) notes.push('It has stayed small and compact through cold, dim weather.');

  // Where morphology is heading now.
  const target = morphologyTargets(ex);
  const heading = describeChanges(m, target, 0.08);
  if (heading.length) notes.push(`If the recent weather continues, it will slowly have ${joinList(heading)}.`);

  // Marks.
  const marks = o.marks;
  const markBits: string[] = [];
  if (marks.rings >= 0.5) markBits.push(`${Math.round(marks.rings)} growth ring${Math.round(marks.rings) === 1 ? '' : 's'} from storms`);
  if (marks.vacuoles >= 0.5) markBits.push('luminous vacuoles left by heavy rain');
  if (marks.facets > 0.1) markBits.push('frost-scarred facets');
  if (marks.ember > 0.1) markBits.push('an ember-warm core from hot spells');
  if (marks.halo > 0.1) markBits.push('a quiet outer halo from days of stillness');
  if (markBits.length) notes.push(`It carries ${joinList(markBits)}.`);

  // Gaps, explicitly.
  const gapHours = totalGapHours(o.memory);
  if (gapHours > 0) {
    const g = o.memory.gaps[o.memory.gaps.length - 1];
    const span = g.hours >= 48 ? days(g.hours / 24) : `${g.hours} hours`;
    notes.push(
      g.reason === 'beyond-catch-up'
        ? `There is a ${span} stretch with no recoverable weather. It was treated as dormant for that time.`
        : `Weather data is missing for ${gapHours} hour${gapHours === 1 ? '' : 's'} in total, most recently ${span}. Those hours were left out rather than guessed.`,
    );
  }

  const recent = recentAverage(o.memory, 24);
  if (!recent) notes.push('No weather history has been recorded yet.');

  if (!notes.length || (notes.length === 1 && recent)) {
    const close = describeChanges(neutral, m, 0.02);
    notes.push(close.length ? `So far it has ${joinList(close)}.` : 'It is still young and close to its original form.');
  }
  return notes;
}

/** One sentence describing current conditions in natural language. */
export function conditionsSentence(
  c: { temperature: number; windSpeed: number; windDirection: number; precipitation: number; cloudCover: number; weatherCode: number },
  describe: (code: number) => string,
): string {
  const t = `${Math.round(c.temperature)}°`;
  const sky = describe(c.weatherCode).toLowerCase();
  const wind = c.windSpeed < 3 ? 'still air' : `wind ${Math.round(c.windSpeed)} km/h from the ${compassName(c.windDirection)}`;
  return `${t}, ${sky}, ${wind}`;
}

const EVENT_PHRASE: Record<string, string> = {
  storm: 'a storm',
  frost: 'a frost',
  heat: 'a hot spell',
  deluge: 'a deluge',
  'long-rain': 'a long rain',
  stillness: 'a long calm',
};

function durationText(ms: number): string {
  const h = Math.round(ms / HOUR);
  if (h < 36) return h === 1 ? 'an hour' : `${h} hours`;
  return days(ms / DAY);
}

/**
 * The line shown when someone returns: what weather the organism lived through
 * since their last visit, and what it did to it. Built only from recorded hours;
 * returns null for short absences. Hours that could not be recovered are named,
 * never filled in.
 */
export function awaySummary(o: OrganismState, now: number, name: string): string | null {
  const pv = o.previousVisit;
  if (!pv || now - pv.t < 2 * HOUR) return null;
  const since = pv.t;
  const lived = o.memory.records.filter((r) => r.t >= since && r.t < now);
  const gapHours = o.memory.gaps.reduce((n, g) => (g.to > since ? n + Math.round((Math.min(g.to, now) - Math.max(g.from, since)) / HOUR) : n), 0);

  const parts: string[] = [];
  if (lived.length) {
    let rain = 0, wmax = 0, tmin = Infinity, tmax = -Infinity, tsum = 0;
    for (const r of lived) {
      rain += r.P;
      wmax = Math.max(wmax, r.W);
      tmin = Math.min(tmin, r.T);
      tmax = Math.max(tmax, r.T);
      tsum += r.T;
    }
    const highlights: string[] = [];
    const kinds = new Set(o.memory.events.filter((e) => e.t >= since && e.t < now).map((e) => e.kind));
    // The rain total already says it rained; don't name rain twice.
    if (rain >= 2) {
      kinds.delete('long-rain');
      kinds.delete('deluge');
    }
    for (const k of [...kinds].slice(0, 2)) if (EVENT_PHRASE[k]) highlights.push(EVENT_PHRASE[k]);
    if (rain >= 2) highlights.push(`${Math.round(rain)} mm of rain`);
    if (wmax >= 40) highlights.push(`gusts to ${Math.round(wmax)} km/h`);
    if (tmin <= 3) highlights.push(`cold down to ${Math.round(tmin)}°`);
    if (tmax >= 25) highlights.push(`warmth up to ${Math.round(tmax)}°`);
    const span = durationText(now - since);
    parts.push(
      highlights.length
        ? `While you were away: ${span} with ${joinList(highlights.slice(0, 3))}.`
        : `While you were away: ${span} of settled weather around ${Math.round(tsum / lived.length)}°.`,
    );
  } else {
    parts.push(`You were away for ${durationText(now - since)}.`);
  }

  const changes = describeChanges(pv.m, o.morphology, 0.03).slice(0, 2);
  parts.push(changes.length ? `${name} has ${joinList(changes)}.` : `${name} has kept its shape.`);
  if (gapHours > 0) parts.push(`Weather for ${gapHours} of those hours could not be recovered and was left out.`);
  return parts.join(' ');
}
