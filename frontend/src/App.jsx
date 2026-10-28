import { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import TopNav from './components/TopNav';
import ErrorBoundary from './components/ErrorBoundary';
import IntroSplash from './components/IntroSplash';
import { ToastHost } from './components/ui';
import { PrefsProvider } from './context/Prefs';
import { spring, useMotionSafe } from './lib/motion';

/* One chunk per route: the browse shell stays small and the socket player only
   downloads when someone actually opens a theatre room. */
const Browse = lazy(() => import('./pages/Browse'));
const Catalog = lazy(() => import('./pages/Catalog'));
const SearchPage = lazy(() => import('./pages/SearchPage'));
const Watch = lazy(() => import('./pages/Watch'));
const TheatreRoom = lazy(() => import('./pages/TheatreRoom'));
const GroupCreation = lazy(() => import('./pages/GroupCreation'));
const Auth = lazy(() => import('./pages/Auth'));

/** Placeholder shown while a route chunk arrives — matches the shell's rhythm. */
function RouteSkeleton() {
  return (
    <div className="min-h-screen bg-background px-[4vw] pt-[calc(var(--nav-h,94px)+40px)]">
      <div className="mx-auto max-w-[1180px]">
        <div className="shimmer h-8 w-52 rounded-xl" />
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="shimmer aspect-[2/3] rounded-2xl" style={{ animationDelay: `${i * 45}ms` }} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Route-level transition: soft crossfade + lift, disabled when the user asks for less motion. */
function Page({ children, className = '', scope }) {
  const safe = useMotionSafe();
  const wrapped = <ErrorBoundary scope={scope}>{children}</ErrorBoundary>;
  if (safe) return <div className={className}>{wrapped}</div>;
  return (
    <motion.div
      initial={{ opacity: 0, y: 14, rotateX: 5 }}
      animate={{ opacity: 1, y: 0, rotateX: 0 }}
      exit={{ opacity: 0, y: -8, rotateX: -4 }}
      transition={{ ...spring.soft, duration: 0.34, transformPerspective: 1000 }}
      className={className}
    >
      {wrapped}
    </motion.div>
  );
}

/** Ambient 3D aurora — slow-depth orbs floating behind every screen. */
function Aurora() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <span className="aurora-orb aurora-orb--rose -left-32 -top-24 h-[26rem] w-[26rem] bg-primary/10" />
      <span className="aurora-orb aurora-orb--violet -right-40 top-1/3 h-[30rem] w-[30rem] bg-secondary/10" />
      <span className="aurora-orb aurora-orb--gold bottom-[-12rem] left-1/3 h-[24rem] w-[24rem] bg-gold/[0.06]" />
    </div>
  );
}

function Shell() {
  const location = useLocation();
  const inTheatre = location.pathname.startsWith('/room');
  const routeKey = inTheatre ? location.pathname : location.pathname + location.search;

  /*
   * An SPA keeps the previous page's scroll offset when a route swaps in, so
   * opening the player from a scrolled browse row could land the window halfway
   * down a page that is still filling in — which reads as a black screen.
   * Manual restoration also stops the browser putting us back at the bottom on
   * reload.
   */
  useEffect(() => {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
  }, [routeKey]);

  return (
    <div className="relative min-h-screen bg-background text-textMain">
      <Aurora />
      <IntroSplash />
      {!inTheatre && <TopNav />}
      <Suspense fallback={<RouteSkeleton />}>
        <AnimatePresence mode="wait" initial={false}>
          <Routes location={location} key={routeKey}>
            <Route path="/" element={<Page scope="Browse"><Browse /></Page>} />
            <Route path="/catalog/:type" element={<Page scope="Catalog"><Catalog mode="discover" /></Page>} />
            <Route path="/new" element={<Page scope="New & Popular"><Catalog mode="new" /></Page>} />
            <Route path="/new/:type" element={<Page scope="New & Popular"><Catalog mode="new" /></Page>} />
            <Route path="/my-list" element={<Page scope="My List"><Catalog mode="my-list" /></Page>} />
            <Route path="/my-list/:type" element={<Page scope="My List"><Catalog mode="my-list" /></Page>} />
            <Route path="/search" element={<Page scope="Search"><SearchPage /></Page>} />
            <Route path="/watch/:type/:id" element={<Page scope="Player"><Watch /></Page>} />
            <Route path="/room/:roomId" element={<Page scope="Watch party"><TheatreRoom /></Page>} />
            <Route path="/create-group" element={<Page scope="Create room"><GroupCreation /></Page>} />
            <Route path="/auth" element={<Page scope="Sign in"><Auth /></Page>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AnimatePresence>
      </Suspense>
      <ToastHost />
    </div>
  );
}

export default function App() {
  return (
    <PrefsProvider>
      <BrowserRouter>
        <Shell />
      </BrowserRouter>
    </PrefsProvider>
  );
}
