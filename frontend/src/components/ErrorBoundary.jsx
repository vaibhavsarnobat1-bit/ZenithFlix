import { Component } from 'react';
import { motion } from 'framer-motion';
import { Home, RefreshCw, TriangleAlert } from 'lucide-react';
import { spring } from '../lib/motion';

/**
 * A lazily-loaded page can fail for a reason that has nothing to do with our code:
 * the file it was referenced from no longer exists. Vite rewrites module URLs when
 * it re-optimizes dependencies, and a deploy swaps every hashed filename — so a tab
 * that was open across that line asks for a chunk that is gone, and React reports
 * it as a crashed route ("Failed to fetch dynamically imported module").
 *
 * The right move is a single reload from the server. `sessionStorage` is the guard:
 * if the fresh document hits the same wall, this is a real bug and an endless refresh
 * loop is worse than an error screen, so we stop and show the panel.
 */
const CHUNK_FAIL = /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed/i;
const RELOAD_KEY = 'zf.chunkReload';

function reloadOnceForChunkFailure(error) {
  if (!CHUNK_FAIL.test(String(error?.message || error))) return false;
  try {
    if (sessionStorage.getItem(RELOAD_KEY)) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

/**
 * Route-level safety net.
 *
 * React 19 unmounts the whole tree when a page throws, which leaves the user on
 * a black screen with no explanation (especially bad on /room, where the socket
 * is mid-handshake). This boundary keeps the rest of the app alive, shows what
 * broke, and gives a retry that remounts the subtree.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidMount() {
    // Arm the auto-reload only long enough to prove the bundle actually loaded.
    // Clearing on mount would reset the guard before a suspended `lazy()` child
    // ever resolved, which is exactly how a missing chunk turns into a refresh loop.
    this.armed = setTimeout(() => {
      try {
        sessionStorage.removeItem(RELOAD_KEY);
      } catch {
        /* private mode: the guard simply stays put */
      }
    }, 4000);
  }

  componentWillUnmount() {
    clearTimeout(this.armed);
  }

  componentDidCatch(error, info) {
    if (reloadOnceForChunkFailure(error)) return;
    // Keep it in the console too so `npm run dev` output shows the stack.
    console.error(`[ZenithFlix] ${(this.props.scope || 'route')} crashed`, error, info?.componentStack);
  }

  retry = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="grid min-h-screen place-items-center bg-background px-6 py-24">
        <motion.div
          initial={{ opacity: 0, y: 14, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={spring.glassy}
          className="w-full max-w-lg rounded-3xl border border-white/[0.08] bg-surface p-7 shadow-lift"
        >
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-primary/15 text-primary ring-1 ring-primary/35">
              <TriangleAlert className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-textMuted">
                {(this.props.scope || 'this screen')} hit a snag
              </p>
              <h2 className="font-display text-[20px] font-extrabold tracking-tighter2 text-white">The projector jammed</h2>
            </div>
          </div>

          <p className="mt-4 text-[13.5px] leading-relaxed text-textSub">
            Nothing was lost — your list and preferences are still here. Reload this screen, or head back to the catalogue.
          </p>

          <pre className="mt-4 max-h-40 overflow-auto rounded-2xl border border-white/[0.07] bg-black/50 p-3 text-[11px] leading-relaxed text-textMuted">
            {String(error?.message || error)}
          </pre>

          <div className="mt-5 flex flex-wrap gap-2">
            <button
              onClick={this.retry}
              className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-[13px] font-bold text-white transition-colors hover:bg-primaryLight"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Try again
            </button>
            <a
              href="/"
              className="flex items-center gap-2 rounded-xl border border-white/12 px-4 py-2.5 text-[13px] font-bold text-textSub hover:text-white"
            >
              <Home className="h-3.5 w-3.5" /> Back to browse
            </a>
          </div>
        </motion.div>
      </div>
    );
  }
}
