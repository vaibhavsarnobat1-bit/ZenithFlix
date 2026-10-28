import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useMotionValueEvent, useScroll } from 'framer-motion';
import { useLocation, useNavigate } from 'react-router-dom';
import { ChevronDown, Globe, ListVideo, Search, Users, X } from 'lucide-react';
import { LANGUAGES, WATCH_REGIONS, getUserName, poster, titleOf, yearOf } from '../lib/config';
import { tmdb } from '../lib/api';
import { usePrefs } from '../context/Prefs';
import { spring, flipIn3d } from '../lib/motion';
import Logo3D from './Logo3D';

const LINKS = [
  { to: '/', label: 'Home' },
  { to: '/catalog/movie', label: 'Movies' },
  { to: '/catalog/tv', label: 'Series' },
  { to: '/new', label: 'New & Popular' },
  { to: '/my-list', label: 'My List' },
];

function Logo({ compact }) {
  return <Logo3D compact={compact} />;
}

function Picker({ icon: Icon, value, onChange, options, label, width = 'w-64' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const away = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);

  const current = options.find((o) => o.code === value);

  return (
    <div ref={ref} className="relative">
      <motion.button
        onClick={() => setOpen((v) => !v)}
        whileHover={{ y: -1 }}
        whileTap={{ scale: 0.94 }}
        transition={spring.snappy}
        aria-label={label}
        className="btn-3d btn-3d-glass flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs font-semibold text-textSub transition-colors hover:border-primary/40 hover:text-white"
      >
        <Icon className={`h-3.5 w-3.5 icon-swing ${open ? 'text-primaryLight' : ''}`} />
        <span className="tabular">{current?.short || current?.code || value}</span>
        <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            variants={flipIn3d}
            initial="hidden"
            animate="show"
            exit="exit"
            style={{ transformPerspective: 800 }}
            className={`absolute right-0 top-[calc(100%+8px)] ${width} max-h-80 origin-top overflow-y-auto rounded-2xl border border-white/10 bg-black/90 p-1.5 shadow-cinema backdrop-blur-2xl`}
          >
            <div className="px-2.5 pb-1.5 pt-1 text-[10px] font-bold uppercase tracking-[0.18em] text-textMuted">{label}</div>
            {options.map((o) => (
              <button
                key={o.code}
                onClick={() => {
                  onChange(o.code);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm transition-colors ${
                  o.code === value ? 'bg-primary/15 text-white' : 'text-textSub hover:bg-white/[0.06] hover:text-white'
                }`}
              >
                {o.flag ? (
                  <span className="w-6 text-center text-base leading-none">{o.flag}</span>
                ) : (
                  <span className="w-6 text-center text-[10px] font-bold text-textMuted">{o.short || o.code}</span>
                )}
                <span className="flex-1 truncate">{o.label}</span>
                {o.code === value && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function TopNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { language, region, setLanguage, setRegion, list } = usePrefs();
  const { scrollY } = useScroll();
  const [solid, setSolid] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);
  const debounce = useRef(null);

  /* live TMDB search for the dropdown */
  useEffect(() => {
    clearTimeout(debounce.current);
    if (query.trim().length < 2) {
      setResults([]);
      setBusy(false);
      return undefined;
    }
    setBusy(true);
    debounce.current = setTimeout(() => {
      tmdb
        .search(query)
        .then((r) => setResults(r.slice(0, 7)))
        .catch(() => setResults([]))
        .finally(() => setBusy(false));
    }, 330);
    return () => clearTimeout(debounce.current);
  }, [query]);

  useMotionValueEvent(scrollY, 'change', (y) => setSolid(y > 28));

  useEffect(() => {
    if (searchOpen) inputRef.current?.focus();
  }, [searchOpen]);

  useEffect(() => {
    const esc = (e) => {
      if (e.key === 'Escape') {
        setSearchOpen(false);
        setQuery('');
      }
      if ((e.key === '/' || (e.ctrlKey && e.key === 'k')) && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setQuery('');
    setResults([]);
  }, []);

  /* Leaving the page by any other route (nav links, logo, a card) should drop the
     dropdown too — otherwise it floats over the next screen. */
  useEffect(() => {
    setResults([]);
    setSearchOpen(false);
  }, [location.pathname]);

  const pick = useCallback(
    (r) => {
      navigate(`/watch/${r.media_type || (r.first_air_date ? 'tv' : 'movie')}/${r.id}`);
      closeSearch();
    },
    [navigate, closeSearch]
  );

  const submit = useCallback(
    (e) => {
      e.preventDefault();
      if (query.trim()) navigate(`/search?q=${encodeURIComponent(query.trim())}`);
    },
    [navigate, query]
  );

  const onWatch = location.pathname.startsWith('/watch') || location.pathname.startsWith('/room');

  /* Publish the real nav height so pages can offset content with pt-(--nav-h)
     instead of hard-coding a pixel value that drifts when the bar changes. */
  const barRef = useRef(null);
  useEffect(() => {
    const el = barRef.current;
    if (!el) return undefined;
    const publish = () =>
      document.documentElement.style.setProperty('--nav-h', `${Math.round(el.getBoundingClientRect().height)}px`);
    publish();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(publish) : null;
    ro?.observe(el);
    window.addEventListener('resize', publish);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', publish);
    };
  }, []);

  return (
    <motion.header
      ref={barRef}
      initial={{ y: -34, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ ...spring.soft, delay: 0.05 }}
      className={`fixed inset-x-0 top-0 z-[90] transition-all duration-300 ease-cinema ${
        solid || onWatch ? 'glass-dark border-b border-white/[0.07]' : 'bg-gradient-to-b from-black/85 via-black/35 to-transparent'
      }`}
    >
      <div className="flex h-[58px] items-center gap-3 px-[4vw] sm:gap-5">
        <button onClick={() => navigate('/')} className="flex-shrink-0" aria-label="ZenithFlix home">
          <Logo compact={solid || onWatch} />
        </button>

        {/* nav */}
        <nav className="hidden items-center gap-0.5 lg:flex">
          {LINKS.map((l) => {
            const active = l.to === '/' ? location.pathname === '/' : location.pathname.startsWith(l.to);
            return (
              <button
                key={l.to}
                onClick={() => navigate(l.to)}
                className={`nav-3d relative rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                  active ? 'text-white' : 'text-textMuted hover:text-textSub'
                }`}
              >
                {l.label}
                {l.to === '/my-list' && list.length > 0 && (
                  <span className="ml-1.5 rounded-full bg-primary/25 px-1.5 text-[10px] font-bold tabular text-primaryLight">{list.length}</span>
                )}
                {active && <motion.span layoutId="nav-active" className="absolute inset-x-2.5 -bottom-0.5 h-[2px] rounded-full bg-ember-gradient" transition={spring.pop} />}
              </button>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {/* search */}
          <div className="relative flex items-center">
            <AnimatePresence mode="wait">
              {searchOpen ? (
                <motion.form
                  key="open"
                  onSubmit={submit}
                  initial={{ width: 0, opacity: 0 }}
                  animate={{ width: 'min(320px, 46vw)', opacity: 1 }}
                  exit={{ width: 0, opacity: 0 }}
                  transition={spring.sheet}
                  className="overflow-hidden"
                >
                  <div className="search-3d flex items-center gap-2 rounded-xl border border-white/15 bg-black/75 px-3 py-2 backdrop-blur-xl transition-all duration-300">
                    {busy ? (
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    ) : (
                      <motion.span
                        animate={query ? { rotateY: 360 } : { rotateY: 0 }}
                        transition={{ duration: 0.5, ease: 'easeInOut' }}
                        style={{ transformPerspective: 400 }}
                        className="grid place-items-center"
                      >
                        <Search className="h-3.5 w-3.5 text-textMuted" />
                      </motion.span>
                    )}
                    <input
                      ref={inputRef}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Movies, series, anime…"
                      className="w-full bg-transparent text-sm text-white placeholder:text-textMuted/70"
                    />
                    <button type="button" onClick={closeSearch} className="text-textMuted hover:text-white" aria-label="Close search">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <AnimatePresence>
                    {query.trim().length > 1 && (
                      <motion.div
                        variants={flipIn3d}
                        initial="hidden"
                        animate="show"
                        exit="exit"
                        style={{ transformPerspective: 900 }}
                        className="absolute right-0 top-[calc(100%+8px)] w-[min(420px,86vw)] origin-top rounded-2xl border border-white/10 bg-black/92 p-2 shadow-cinema backdrop-blur-2xl"
                      >
                        {(results || []).length === 0 ? (
                          <p className="px-3 py-6 text-center text-sm text-textMuted">{busy ? 'Searching TMDB…' : 'Nothing found for that.'}</p>
                        ) : (
                          (results || []).map((r) => (
                            <motion.button
                              key={`${r.media_type}-${r.id}`}
                              onClick={() => pick(r)}
                              whileHover={{ x: 4, scale: 1.015, z: 14 }}
                              whileTap={{ scale: 0.97 }}
                              transition={spring.snappy}
                              className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-white/[0.07]"
                            >
                              <img
                                src={poster(r.poster_path, 'face') || ''}
                                alt=""
                                loading="lazy"
                                className="h-12 w-8 flex-shrink-0 rounded-md bg-surfaceHigh object-cover shadow-card transition-transform duration-300 group-hover:scale-105"
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-semibold text-white">{titleOf(r)}</span>
                                <span className="block text-[11px] uppercase tracking-wide text-textMuted">
                                  {r.media_type === 'tv' ? 'Series' : 'Movie'} · {yearOf(r) || '—'}
                                </span>
                              </span>
                            </motion.button>
                          ))
                        )}
                        <motion.button
                          onClick={submit}
                          whileHover={{ y: -1, scale: 1.02 }}
                          whileTap={{ scale: 0.95 }}
                          transition={spring.snappy}
                          className="btn-3d mt-1 flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/10 py-2 text-xs font-bold text-textSub hover:bg-white/[0.05]"
                        >
                          <ListVideo className="h-3.5 w-3.5 icon-swing" /> See all results
                        </motion.button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.form>
              ) : (
                <motion.button
                  key="closed"
                  initial={{ opacity: 0, scale: 0.85 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.85 }}
                  transition={spring.pop}
                  onClick={() => setSearchOpen(true)}
                  whileHover={{ y: -2, rotateY: 180 }}
                  whileTap={{ scale: 0.8, rotateY: 360 }}
                  style={{ transformPerspective: 420 }}
                  aria-label="Search"
                  className="btn-3d btn-3d-glass grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-textSub transition-colors hover:border-primary/40 hover:text-white"
                >
                  <Search className="h-4 w-4" />
                </motion.button>
              )}
            </AnimatePresence>
          </div>

          <Picker icon={Globe} label="Subtitle & title language" value={language} onChange={setLanguage} options={LANGUAGES} />

          <Picker icon={Globe} label="Releases from" value={region} onChange={setRegion} options={WATCH_REGIONS} width="w-56" />

          <motion.button
            whileHover={{ y: -2, scale: 1.05, z: 20 }}
            whileTap={{ y: 1, scale: 0.93 }}
            transition={spring.snappy}
            style={{ transformPerspective: 500 }}
            onClick={() => navigate('/create-group')}
            className="btn-3d btn-3d-glass hidden items-center gap-1.5 rounded-xl border border-white/12 bg-white/[0.05] px-3 py-1.5 text-xs font-bold text-white transition-colors hover:border-primary/45 hover:bg-primary/15 sm:flex"
          >
            <Users className="h-3.5 w-3.5 icon-bob" /> Watch Party
          </motion.button>

          <motion.button
            onClick={() => navigate('/auth')}
            whileHover={{ scale: 1.1, rotate: 4, y: -2 }}
            whileTap={{ scale: 0.85, rotate: -4 }}
            transition={spring.pop}
            className="btn-3d btn-3d-ember grid h-9 w-9 place-items-center rounded-lg bg-ember-gradient text-[11px] font-black text-white shadow-glow-sm"
            title={getUserName() ? getUserName() : 'Sign in'}
          >
            {(getUserName() || 'G').slice(0, 2).toUpperCase()}
          </motion.button>
        </div>
      </div>

      {/* mobile nav strip */}
      <div className="no-scrollbar flex gap-1 overflow-x-auto px-[4vw] pb-2 lg:hidden">
        {LINKS.map((l) => {
          const active = l.to === '/' ? location.pathname === '/' : location.pathname.startsWith(l.to);
          return (
            <button
              key={l.to}
              onClick={() => navigate(l.to)}
              className={`whitespace-nowrap rounded-lg px-2.5 py-1 text-[12px] font-semibold transition-colors ${
                active ? 'bg-primary/20 text-white' : 'text-textMuted'
              }`}
            >
              {l.label}
            </button>
          );
        })}
      </div>
    </motion.header>
  );
}
