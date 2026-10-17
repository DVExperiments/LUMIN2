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
