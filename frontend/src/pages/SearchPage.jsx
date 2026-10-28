import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSearchParams } from 'react-router-dom';
import { Search, Sparkles, X } from 'lucide-react';
import DetailSheet from '../components/DetailSheet';
import { tmdb } from '../lib/api';
import { mediaTypeOf, poster, titleOf, yearOf } from '../lib/config';
import { usePrefs } from '../context/Prefs';
import { item, item3d, spring, stagger } from '../lib/motion';
import { Badge, EmptyState, SmartImage } from '../components/ui';

const FILTERS = [
  { id: 'all', label: 'Everything' },
  { id: 'movie', label: 'Movies' },
  { id: 'tv', label: 'Series' },
];

const SUGGESTIONS = ['Attack on Titan', 'Interstellar', 'Jujutsu Kaisen', 'Money Heist', 'KGF', 'Oppenheimer', 'Dark', 'Demon Slayer'];

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const { localeKey } = usePrefs();
  const q = params.get('q') || '';
  const [draft, setDraft] = useState(q);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('all');
  const [sheet, setSheet] = useState(null);

  useEffect(() => setDraft(q), [q]);

  useEffect(() => {
    if (!q.trim()) {
      setRows([]);
      return undefined;
    }
    let dead = false;
    setLoading(true);
    const t = setTimeout(() => {
      tmdb
        .search(q)
        .then((r) => !dead && setRows(r))
        .finally(() => !dead && setLoading(false));
    }, 320);
    return () => {
      clearTimeout(t);
      dead = true;
    };
  }, [q, localeKey]);

  const shown = useMemo(() => (filter === 'all' ? rows : rows.filter((r) => mediaTypeOf(r) === filter)), [rows, filter]);

  const submit = (value) => {
    const next = new URLSearchParams(params);
    if (value.trim()) next.set('q', value.trim());
    else next.delete('q');
    setParams(next, { replace: true });
  };

  return (
    <div className="min-h-screen bg-background px-[4vw] pb-24 pt-[calc(var(--nav-h,94px)+18px)]">
      <div className="mx-auto max-w-[1180px]">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(draft);
          }}
          className="search-3d scene relative rounded-2xl"
        >
          <motion.span
            className="pointer-events-none absolute left-4 top-1/2 z-10 -translate-y-1/2 text-textMuted"
            whileHover={{ rotateY: 360 }}
          >
            <Search className="h-4 w-4" />
          </motion.span>
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Search 100,000+ films and series by title, anime, k-drama…"
            className="w-full rounded-2xl border border-white/12 bg-white/[0.04] py-4 pl-12 pr-24 font-display text-[15px] font-semibold text-white placeholder:text-textMuted/70 transition-all duration-300 focus:border-primary/50 focus:bg-black/45"
          />
          {draft && (
            <motion.button
              type="button"
              onClick={() => { setDraft(''); submit(''); }}
              whileHover={{ scale: 1.2, rotate: 90 }}
              whileTap={{ scale: 0.8 }}
              transition={spring.pop}
              className="absolute right-16 top-1/2 -translate-y-1/2 text-textMuted hover:text-white" aria-label="Clear"
            >
              <X className="h-4 w-4" />
            </motion.button>
          )}
          <motion.button
            type="submit"
            whileHover={{ y: -2, scale: 1.04, z: 20 }}
            whileTap={{ y: 2, scale: 0.9, z: 0, rotateX: 12 }}
            transition={spring.snappy}
            style={{ transformPerspective: 500 }}
            className="btn-3d btn-3d-ember absolute right-2 top-1/2 -translate-y-1/2 rounded-xl bg-primary px-4 py-2 text-[13px] font-bold text-white hover:bg-primaryLight"
          >
            Search
          </motion.button>
        </form>

        {!q && (
          <div className="mt-8">
            <div className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-textMuted">
              <Sparkles className="h-3 w-3 text-primary" /> Try one of these
            </div>
            <motion.div variants={stagger(0.02, 0.04)} initial="hidden" animate="show" className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <motion.button
                  key={s}
                  variants={item}
                  whileHover={{ y: -3, scale: 1.06, rotateX: 10 }}
                  whileTap={{ y: 1, scale: 0.92, rotateX: -6 }}
                  transition={{ ...spring.snappy, transformPerspective: 500 }}
                  onClick={() => {
                    setDraft(s);
                    submit(s);
                  }}
                  className="btn-3d btn-3d-glass rounded-full border border-white/10 bg-white/[0.035] px-4 py-2 text-[13px] font-semibold text-textSub hover:border-primary/45 hover:text-white"
                >
                  {s}
                </motion.button>
              ))}
            </motion.div>
          </div>
        )}

        {q && (
          <>
            <div className="mt-6 flex flex-wrap items-center gap-2">
              <h2 className="font-display text-[19px] font-extrabold tracking-tighter2 text-white">
                {loading ? 'Searching…' : `${shown.length} results`}
              </h2>
              <span className="text-[13px] text-textMuted">for “{q}”</span>
              <div className="ml-auto flex gap-1.5">
                {FILTERS.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setFilter(f.id)}
                    className={`relative rounded-lg px-3 py-1.5 text-[12px] font-bold ${filter === f.id ? 'text-white' : 'text-textMuted hover:text-textSub'}`}
                  >
                    {filter === f.id && <motion.span layoutId="search-filter" className="absolute inset-0 rounded-lg bg-primary/25 ring-1 ring-primary/40" transition={spring.pop} />}
                    <span className="relative">{f.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {shown.length === 0 && !loading ? (
              <div className="mt-8">
                <EmptyState icon={Search} title={`Nothing found for “${q}”`} hint="TMDB titles are matched by name — try the English title or fewer words." />
              </div>
            ) : (
              <motion.div
                variants={stagger(0.012, 0.024)}
                initial="hidden"
                animate="show"
                className="scene mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-7"
              >
                {shown.map((t, i) => (
                  <motion.button
                    key={`${t.media_type}-${t.id}`}
                    variants={item3d}
                    whileHover={{ y: -8, rotateX: 7, scale: 1.04, z: 36 }}
                    whileTap={{ y: 2, scale: 0.96 }}
                    transition={{ ...spring.soft, transformPerspective: 850 }}
                    onClick={() => setSheet({ ...t, _sharedId: `s-${t.media_type}-${t.id}` })}
                    className="group overflow-hidden rounded-2xl border border-white/[0.06] bg-surface text-left hover:border-primary/45 hover:shadow-lift"
                  >
                    <motion.div layoutId={`s-${t.media_type}-${t.id}`} className="aspect-[2/3]">
                      <SmartImage src={poster(t.poster_path, 'poster2x')} alt={titleOf(t)} className="h-full w-full" fallbackLabel={titleOf(t)} loading={i > 10 ? 'lazy' : 'eager'} />
                    </motion.div>
                    <div className="p-2">
                      <p className="truncate text-[12px] font-semibold text-textMain">{titleOf(t)}</p>
                      <div className="mt-1 flex items-center gap-1.5">
                        <Badge tone={t.media_type === 'tv' ? 'violet' : 'ember'}>{t.media_type}</Badge>
                        <span className="tabular text-[10px] text-textMuted">{yearOf(t)}</span>
                        {t.vote_average ? <span className="ml-auto tabular text-[10px] font-bold text-gold">{t.vote_average.toFixed(1)}</span> : null}
                      </div>
                    </div>
                  </motion.button>
                ))}
                {loading && Array.from({ length: 7 }).map((_, i) => <div key={i} className="shimmer aspect-[2/3] rounded-2xl" />)}
              </motion.div>
            )}
          </>
        )}
      </div>

      <AnimatePresence>{sheet && <DetailSheet item={sheet} onClose={() => setSheet(null)} />}</AnimatePresence>
    </div>
  );
}
