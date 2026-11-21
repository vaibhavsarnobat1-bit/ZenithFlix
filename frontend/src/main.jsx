import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { warmBackend } from './lib/api'

// Hosted installs run the API as a cold-starting serverless function; localhost
// Express boots instantly and does not need the extra request.
if (!['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)) warmBackend()

// Chrome restores the previous scroll offset once the (lazy, still-rendering)
// page gets tall, which can drop the viewer halfway down the player page.
// Opting out before the first paint is the only reliable place to do it.
if ('scrollRestoration' in history) history.scrollRestoration = 'manual'

// Service Worker — ad-domain blocker (all browsers, no extension needed)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
  });
}

// Zenith Ad-Shield VPN Engine: Intercept and eliminate unwanted popup ads, tabs & redirects
try {
  const originalOpen = window.open;
  window.open = function (url, target, features) {
    if (url && typeof url === 'string') {
      try {
        const parsed = new URL(url, window.location.href);
        // Strictly allow only same-origin navigations or explicitly trusted internal paths
        if (parsed.origin !== window.location.origin) {
          console.warn('[Ad-Shield VPN] Blocked third-party ad popup to:', url);
          return null;
        }
      } catch {
        return null;
      }
    }
    return null;
  };

  // Anti-popunder trick: if a background script attempts to steal window focus to spawn an ad
  window.addEventListener('blur', () => {
    setTimeout(() => {
      if (document.activeElement?.tagName === 'IFRAME') {
        window.focus();
      }
    }, 150);
  });
} catch {
  // Ignore in restricted environments
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
