/**
 * Persistent organism state: identity, environmental memory, interaction memory,
 * morphology and marks. This is the unit that is saved, exported and imported.
 */
import { createGenome, type Genome } from './genome';
import { adaptHour, applyEvent, emptyMarks, neutralMorphology, type Marks, type Morphology } from './adaptation';
import { createMemory, DAY, ingestHours, type EnvironmentMemory, type IngestReport } from '../memory/environment';
import { createInteractionMemory, type InteractionMemory } from '../memory/interaction';
import type { GeoLocation, HourRecord } from '../weather/types';

export const SCHEMA_VERSION = 2;
export const MAX_SNAPSHOTS = 120;

export interface MoodSnapshot {
  energy: number;
  curiosity: number;
  openness: number;
  cohesion: number;
  tension: number;
  stability: number;
  comfort: number;
  sensitivity: number;
}

export interface OrganismState {
  schema: number;
  kind: 'live' | 'experimental';
  seed: number;
  bornAt: number;
  location: GeoLocation | null;
  locationLog: { t: number; id: string; name: string }[];
  memory: EnvironmentMemory;
  morphology: Morphology;
  marks: Marks;
  interaction: InteractionMemory;
  /** One morphology snapshot per observed day, for the adaptation timeline. */
  snapshots: { t: number; m: Morphology }[];
  mood: MoodSnapshot | null;
  /** Ancestral climate fetched at birth (environmental context from before it existed). */
  ancestral: { from: number; to: number; hours: number } | null;
  /** Morphology at the start of the previous session, to explain change since then. */
  previousVisit: { t: number; m: Morphology } | null;
  savedAt: number;
}

export function createOrganism(seed: number, now: number, kind: OrganismState['kind'] = 'live'): OrganismState {
  return {
    schema: SCHEMA_VERSION,
    kind,
    seed: seed >>> 0,
    bornAt: now,
    location: null,
    locationLog: [],
    memory: createMemory(),
    morphology: neutralMorphology(),
    marks: emptyMarks(),
    interaction: createInteractionMemory(now),
    snapshots: [],
    mood: null,
    ancestral: null,
    previousVisit: null,
    savedAt: now,
  };
}

const genomeCache = new Map<number, Genome>();
export function genomeOf(o: OrganismState): Genome {
  let g = genomeCache.get(o.seed);
  if (!g) {
    g = createGenome(o.seed);
    genomeCache.set(o.seed, g);
  }
  return g;
}

/**
 * Fold weather hours into the organism: memory, morphology, marks and daily
 * snapshots all advance together, hour by hour, in time order.
 */
export function ingestWeather(o: OrganismState, hours: HourRecord[]): IngestReport {
  const genome = genomeOf(o);
  return ingestHours(o.memory, hours, o.bornAt, {
    onHour(_f, h, ex) {
      adaptHour(o.morphology, o.marks, ex, genome, h.t < o.bornAt);
      const day = Math.floor(h.t / DAY) * DAY;
      const last = o.snapshots[o.snapshots.length - 1];
      if (!last || last.t !== day) {
        o.snapshots.push({ t: day, m: { ...o.morphology } });
        if (o.snapshots.length > MAX_SNAPSHOTS) o.snapshots.shift();
      } else {
        last.m = { ...o.morphology };
      }
    },
    onEvent(ev) {
      applyEvent(o.marks, ev);
    },
  });
}

export function setLocation(o: OrganismState, loc: GeoLocation, now: number) {
  if (o.location?.id === loc.id) {
    o.location = loc;
    return;
  }
  o.location = loc;
  o.locationLog.push({ t: now, id: loc.id, name: loc.name });
  if (o.locationLog.length > 30) o.locationLog.shift();
}

export function cloneOrganism(o: OrganismState): OrganismState {
  return structuredClone(o);
}

export function ageDays(o: OrganismState, now: number): number {
  return Math.max(0, (now - o.bornAt) / DAY);
}
