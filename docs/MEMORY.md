# How LUMIN remembers weather

LUMIN's organism is not a weather display. What you see is the sum of three
things: what it *is* (its seed), what it has *lived through* (its memory), and
what is happening *now* (current conditions and you). This document describes
the second part precisely, because it is the part that makes a returning
visitor's organism different from everyone else's.

Code: `src/memory/`, `src/organism/adaptation.ts`, `src/organism/state.ts`.

## 1. The unit of memory is one observed hour

Weather enters memory only as validated, completed hours (`HourRecord`):
temperature, wind speed and direction, precipitation, humidity, cloud cover,
WMO weather code, day or night, and the location it was observed at.

* An hour that has not finished yet is never recorded.
* An hour with any missing or out-of-range core value is rejected by
  `weather/validate.ts`, not repaired.
* Hours are processed strictly in time order. Each hour is processed exactly
  once (`processedUntil` marks the end of the last one); re-sent or duplicate
  hours are skipped.

Instantaneous "current conditions" drive the immediate reactions you see but
are **never** written into memory. This keeps memory reproducible: the same
sequence of hours always produces the same organism.

## 2. Features: what the organism feels

Each hour is mapped onto perceptual 0..1 axes with saturating response curves
(`memory/features.ts`):

| Feature | Curve |
| --- | --- |
| warmth | linear from −10 °C (0) to 35 °C (1) |
| frost | smoothstep from 2 °C down to −8 °C |
| heat | smoothstep from 26 °C to 36 °C |
| wind | 1 − e^(−speed / 28 km/h) |
| windX, windY | the direction the wind *pushes*, weighted by wind |
| rain | 1 − e^(−mm / 1.6) |
| humidity, cloud | percentage / 100 |
| light | daylight (solar elevation with soft twilight) |
| storm | thunder codes, or wind smoothstep 45→75 km/h |

## 3. Five timescales

| Timescale | Mechanism | Time constant | What it drives |
| --- | --- | --- | --- |
| Immediate | exponential smoothing of current conditions in the frame loop | 25 s (2.5 s in the lab) | movement, filament streaming, glow, colour tint |
| Short-term | EMA over observed hours | 6 hours | energy, mood |
| Medium-term | EMA | 3 days | stability, sensitivity, restlessness |
| Long-term | EMA, then lagged morphology | 7 days, plus 36 h lag | body shape and structure |
| Persistent identity | 30-day EMA, permanent marks, the seed | 30 days to months | acclimatisation, colour drift, scars |

The EMA weight for one hour is `1 − e^(−1/τ)`. Time constants are measured in
**observed hours**, not wall-clock time (see section 6).

## 4. Morphology: structure that lags its causes

`morphologyTargets()` turns the long and deep averages into targets for nine
traits. The organism's actual morphology then moves toward those targets with
a further 36-hour lag, scaled by the genome's per-trait plasticity (0.6 to 1.4).

| Trait | Mainly caused by | Visible as |
| --- | --- | --- |
| streamlining + axis | long-term wind and its prevailing direction | body stretched along the remembered wind, filaments trailing downstream |
| crystallinity | long-term cold and frost | faceted polygonal membrane, hard cell walls, stiff straight spines |
| size | warmth and light | larger, more open body |
| filament reach | humid warmth, wind, rain | longer, looser filaments |
| cilia density | rain and cloud | more fine cilia around the edge |
| inner light | short, grey days | brighter self-luminance (it compensates for darkness) |
| softness | humidity | diffuse glow, wider membrane rim |
| colour drift | 30-day warmth, rain and frost | hue shifts warm or cold, ten times slower than shape |
| resilience | volatile weather and storms | calmer under disturbance |

Because there are two stacked lags (the 7-day average and the 36-hour
morphology lag), acquired structure **persists after the weather changes**.
In the automated tests, seven days of 55 km/h wind raise streamlining by more
than 0.25; after a calm day the organism keeps over 75 % of that, and it
relaxes measurably over the following two calm weeks.

## 5. Marks: events that leave traces

Streaks of hours are watched for notable events. Events of the same kind
within 72 hours merge into one.

| Event | Rule | Mark |
| --- | --- | --- |
| storm | 3 consecutive storm hours | a growth ring in the body (up to 9) |
| frost | 3 hours at or below −1 °C | extra permanent facets |
| heat | 3 hours at or above 30 °C | an ember-warm nucleus |
| deluge | 5 mm or more in one hour | luminous vacuoles |
| long rain | 12 consecutive rainy hours | luminous vacuoles |
| stillness | 36 hours below 6 km/h | a quiet outer halo |

Marks fade over about four months of observed time; rings fade three times
more slowly. They are the clearest way two organisms with the same recent
weather can still look different.

## 6. Absence, gaps and honesty

LUMIN does not pretend to have run while closed.

On each visit, the app asks Open-Meteo for every completed hour since
`processedUntil`:

* up to 92 days back through the forecast API's `past_days`;
* older spans (up to 400 days) through the historical archive API;
* anything older than 400 days is recorded as an unrecoverable gap.

Inside memory:

* any hour that could not be obtained becomes an explicit **gap** record;
* gaps contribute nothing to the averages, so the organism is treated as
  dormant for that time rather than fed invented weather;
* the Observatory reports total missing hours, hatches them on the timeline,
  and explains them in its notes.

Interaction memory is different: it does model real elapsed time, because
forgetting is part of the organism, not an environmental observation.
Familiarity halves after about six weeks apart; wariness from rough handling
fades within hours.

## 7. Before birth: ancestral climate

A new organism is seeded with the previous 14 days of real weather at its
location, so it is not born neutral. These hours are:

* flagged as before-birth (`t < bornAt`) and shown shaded on the timeline;
* applied to morphology at 60 % strength, and to marks at 50 %;
* counted separately from "weather lived through" in the Observatory.

The organism's interaction history (visits, time in company, familiarity)
starts empty at birth and is stored separately.

## 8. Comfort is relative to history

The behaviour engine measures comfort as the distance between current
conditions and the organism's 30-day acclimatisation, blended with an innate
preference. An organism raised in cold weather is comfortable at −3 °C; one
raised in warmth is stressed by it, becoming tenser, more closed and less
curious. The tests check this directly.

## 9. Determinism and storage

* Seed → genome (name, hue family, symmetry, filament counts, plasticity,
  temperament) via Mulberry32. The same seed always gives the same individual.
* Memory and adaptation are pure functions of the ordered hours, so they are
  reproducible across export and import.
* Stored state is compact: about 21 days of raw hours, up to 400 daily
  summaries, the averages, morphology, marks, up to 120 daily morphology
  snapshots, events, gaps and interaction memory. It is typically a few
  hundred kilobytes.
* There is no frame-by-frame data.

## 10. The laboratory never writes to real memory

The laboratory runs either on a `structuredClone` of the real organism
(discarded on exit) or on a separate experimental organism with its own seed
and storage key (`organism:lab`).

"Expose for N days" generates deterministic synthetic hours with a daily
cycle and feeds them only to the laboratory organism. That organism's clock
runs on its own laboratory time.

While you experiment, real weather refreshes continue to be recorded into the
real organism in the background. A test confirms the real organism's
serialised state is byte-identical before and after a laboratory run.
