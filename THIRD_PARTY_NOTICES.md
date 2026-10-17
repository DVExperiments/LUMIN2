# Third-party notices

## Weather data: Open-Meteo
Weather and geocoding data are provided by Open-Meteo (https://open-meteo.com/)
under the Creative Commons Attribution 4.0 International licence (CC BY 4.0).
Attribution is shown in the app's Settings panel. The free API is intended for
non-commercial use; see https://open-meteo.com/en/terms for commercial terms.

## Simplex noise (GLSL)
`src/render/shaders.ts` contains 3D simplex noise adapted from
"webgl-noise" by Ashima Arts and Stefan Gustavson.
Copyright (C) 2011 Ashima Arts. Distributed under the MIT License.
https://github.com/ashima/webgl-noise

## Fonts
- Newsreader, by Production Type. SIL Open Font License 1.1.
- Hanken Grotesk, by Alfredo Marco Pradil. SIL Open Font License 1.1.
Both are bundled from the Fontsource packages (@fontsource-variable/*) and
served from the same origin, so no third-party font requests are made.

## Development tools
Vite, TypeScript and Vitest (MIT) are used to build and test; they are not
shipped in the production bundle.
