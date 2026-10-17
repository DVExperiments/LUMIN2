import { defineConfig, type Plugin } from 'vitest/config';

// A strict Content-Security-Policy is added to the production build only
// (the dev server needs inline HMR connections). Network access is limited
// to the three Open-Meteo endpoints.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://api.open-meteo.com https://archive-api.open-meteo.com https://geocoding-api.open-meteo.com",
  "worker-src 'self'",
  "manifest-src 'self'",
].join('; ');

function cspPlugin(): Plugin {
  return {
    name: 'lumin-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
    },
  };
}

// `base: './'` keeps every asset URL relative, so the built `dist/` folder
// works from any GitHub Pages sub-path (https://user.github.io/repo/) or
// any other static host without reconfiguration.
export default defineConfig({
  base: './',
  plugins: [cspPlugin()],
  build: {
    target: 'es2022',
    sourcemap: false,
    assetsInlineLimit: 0,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
