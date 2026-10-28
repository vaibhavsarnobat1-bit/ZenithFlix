import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Chrome restores the previous scroll offset once the (lazy, still-rendering)
// page gets tall, which can drop the viewer halfway down the player page.
// Opting out before the first paint is the only reliable place to do it.
if ('scrollRestoration' in history) history.scrollRestoration = 'manual'

// Anti-popup guard: intercept unwanted ad tabs/popunders spawned by third-party embed scripts
try {
  const originalOpen = window.open;
  window.open = function (url, target, features) {
    if (url && typeof url === 'string') {
      try {
        const parsed = new URL(url, window.location.href);
        // Only allow opening same-origin links or explicitly allowed video providers
        if (parsed.origin !== window.location.origin) {
          console.warn('[AdBlock] Blocked third-party popup ad to:', url);
          return null;
        }
      } catch {
        return null;
      }
    }
    return originalOpen ? originalOpen.call(window, url, target, features) : null;
  };
} catch {
  // Ignore in restricted environments
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
