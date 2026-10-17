import '@fontsource-variable/newsreader/standard.css';
import '@fontsource-variable/newsreader/standard-italic.css';
import '@fontsource-variable/hanken-grotesk/index.css';
import './styles.css';
import { App } from './app';

const canvas = document.getElementById('stage') as HTMLCanvasElement;

function fatal(message: string) {
  const p = document.createElement('p');
  p.className = 'noscript';
  p.textContent = message;
  document.body.append(p);
}

new App(canvas).start().catch((e) => {
  console.error(e);
  fatal('LUMIN could not start in this browser. Try a recent version of Chrome, Edge, Firefox or Safari.');
});

// Offline support: cache the app shell after first load (production builds only).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* offline support is optional */
    });
  });
}
