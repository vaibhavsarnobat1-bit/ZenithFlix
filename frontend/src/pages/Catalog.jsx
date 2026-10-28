import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Bookmark, Grid2x2, Rows3, SlidersHorizontal, Sparkles } from 'lucide-react';
import DetailSheet from '../components/DetailSheet';
import { tmdb } from '../lib/api';
import { LANGUAGES, mediaTypeOf, titleOf, yearOf } from '../lib/config';
import { usePrefs } from '../context/Prefs';
import { item, spring, stagger } from '../lib/motion';
import { Badge, EmptyState, SmartImage } from '../components/ui';
import { poster } from '../lib/config';

const SORTS = [
  { id: 'popularity.desc', label: 'Most popular' },
  { id: 'primary_release_date.desc', label: 'Newest first' },
  { id: 'vote_average.desc', label: 'Highest rated' },
  { id: 'revenue.desc', label: 'Biggest box office' },
  { id: 'title.asc', label: 'A → Z' },
];

function Tile({ t, index, onOpen }) {
  const type = mediaTypeOf(t);
  const label = titleOf(t);
  return (
    <motion.button
      layout
      variants={item}
      whileHover={{ y: -5 }}
      transition={spring.soft}
      onClick={() => onOpen({ ...t, media_type: type }, `cat-${type}-${t.id}`)}
      className="group overflow-hidden rounded-2xl border border-white/[0.06] bg-surface text-left transition-colors hover:border-primary/45 hover:shadow-lift"
    >
      <div className="relative aspect-[2/3]">
        <motion.div layoutId={`cat-${type}-${t.id}`} className="h-full w-full">
          <SmartImage src={poster(t.poster_path, 'poster2x')} alt={label} className="h-full w-full" fallbackLabel={label} loading={index > 12 ? 'lazy' : 'eager'} />
        </motion.div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/95 via-black/45 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
        <div className="pointer-events-none absolute bottom-2 left-2 right-2 translate-y-2 opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">
          <p className="line-clamp-2 text-[11.5px] font-bold leading-snug text-white">{label}</p>
          <p className="mt-0.5 text-[10px] tabular text-textSub">{yearOf(t)}</p>
        </div>
        {t.vote_average ? (
          <span className="absolute right-1.5 top-1.5 rounded-md border border-white/10 bg-black/65 px-1.5 py-0.5 tabular text-[10px] font-bold text-gold backdrop-blur-sm">
            {t.vote_average.toFixed(1)}
          </span>
        ) : null}
      </div>
      <p className="truncate px-2.5 py-2 text-[12px] font-semibold text-textMain">{label}</p>
    </motion.button>
  );
}

export default function Catalog({ mode = 'discover' }) {
  const { type: typeParam } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { list, localeKey } = usePrefs();
  const type = typeParam === 'tv' ? 'tv' : 'movie';
  const base = mode === 'discover' ? '/catalog' : `/${mode}`;

  const [genres, setGenres] = useState([]);
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('grid');
  const [sheet, setSheet] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const genre = params.get('genre') || '';
  const sortBy = params.get('sort') || (mode === 'new' ? 'primary_release_date.desc' : 'popularity.desc');
  const original = params.get('original') || '';
  const year = params.get('year') || '';

  useEffect(() => {
    if (mode === 'my-list') return;
    let dead = false;
    tmdb.genres(type).then((g) => !dead && setGenres(g || [])).catch(() => {});
    return () => {
      dead = true;
    };
  }, [type, mode]);

  const setParam = useCallback(
    (key, value) => {
      const merged = new URLSearchParams(params);
      if (!value) merged.delete(key);
      else merged.set(key, String(value));
      setParams(merged, { replace: true });
      setPage(1);
      setRows([]);
    },
    [params, setParams]
  );

  const load = useCallback(
    async (nextPage) => {
      setLoading(true);
      try {
        let results;
        if (mode === 'new') {
          results = await tmdb.feed(nextPage === 1 ? 'trending' : 'trending', { page: nextPage });
          const fresh = await tmdb.discover({ type, sortBy: 'primary_release_date.desc', 'page': nextPage });
          results = [...new Map([...fresh, ...results].map((r) => [r.id, r])).values()];
        } else {
          results = await tmdb.discover({ type, genre, sortBy, originalLanguage: original, year, page: nextPage });
        }
        setRows((prev) => (nextPage === 1 ? results : [...prev, ...results]));
      } catch {
        if (nextPage === 1) setRows([]);
      } finally {
        setLoading(false);
      }
    },
    [mode, type, genre, sortBy, original, year]
  );

  useEffect(() => {
    if (mode === 'my-list') {
      setRows(list);
      setLoading(false);
      return;
    }
    load(1);
  }, [mode, list, localeKey, load]);

  const shown = useMemo(() => (view === 'list' ? rows : rows), [rows, view]);
  const heading = mode === 'my-list' ? 'My List' : mode === 'new' ? 'New & Popular' : type === 'tv' ? 'Series' : 'Movies';

  return (
    <div className="min-h-screen bg-background px-[4vw] pb-24 pt-[calc(var(--nav-h,94px)+18px)]">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-1 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.22em] text-primary">
            <Sparkles className="h-3 w-3" /> {mode === 'my-list' ? 'Saved by you' : `TMDB · ${localeKey}`}
          </div>
          <h1 className="font-display text-[28px] font-extrabold tracking-tighter2 text-white sm:text-[34px]">{heading}</h1>
        </div>

        <div className="flex items-center gap-2">
          {/* movies ⇄ series — same page, different catalogue */}
          <div className="flex overflow-hidden rounded-xl border border-white/12">
            {[
              { id: 'movie', label: 'Movies' },
              { id: 'tv', label: 'Series' },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => navigate(`${base}/${t.id}`)}
                className={`relative px-3 py-2 text-[12px] font-bold transition-colors ${type === t.id ? 'text-white' : 'text-textMuted hover:text-textSub'}`}
              >
                {type === t.id && <motion.span layoutId="type-pill" className="absolute inset-0 bg-ember-gradient opacity-80" transition={spring.pop} />}
                <span className="relative">{t.label}</span>
              </button>
            ))}
          </div>

          <button
            onClick={() => setFiltersOpen((v) => !v)}
            className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[12px] font-bold transition-colors ${filtersOpen ? 'border-primary/45 bg-primary/15 text-white' : 'border-white/12 bg-white/[0.04] text-textSub hover:text-white'}`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" /> Filters
          </button>
          <div className="flex overflow-hidden rounded-xl border border-white/12">
            {[
              { id: 'grid', icon: Grid2x2 },
              { id: 'list', icon: Rows3 },
            ].map((v) => (
              <button
                key={v.id}
                onClick={() => setView(v.id)}
                aria-label={`${v.id} view`}
                className={`relative grid h-9 w-9 place-items-center ${view === v.id ? 'text-white' : 'text-textMuted hover:text-textSub'}`}
              >
                {view === v.id && <motion.span layoutId="view-pill" className="absolute inset-0 bg-primary/25" transition={spring.pop} />}
                <v.icon className="relative h-3.5 w-3.5" />
              </button>
            ))}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {filtersOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={spring.soft}
            className="mb-5 overflow-hidden"
          >
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
              {mode === 'discover' && (
                <>
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-textMuted">Genre</p>
                  <div className="mb-4 flex flex-wrap gap-1.5">
                    <button onClick={() => setParam('genre', '')} className={`rounded-full border px-3 py-1.5 text-[12px] font-semibold ${!genre ? 'border-primary/50 bg-primary/18 text-white' : 'border-white/10 text-textSub hover:text-white'}`}>
                      Any
                    </button>
                    {genres.map((g) => (
                      <button
                        key={g.id}
                        onClick={() => setParam('genre', g.id)}
                        className={`rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors ${String(genre) === String(g.id) ? 'border-primary/50 bg-primary/18 text-white' : 'border-white/10 text-textSub hover:border-white/25 hover:text-white'}`}
                      >
                        {g.name}
                      </button>
                    ))}
                  </div>

                  <div className="grid gap-4 sm:grid-cols-3">
                    <label className="block">
                      <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.18em] text-textMuted">Sort by</span>
                      <select
                        value={sortBy}
                        onChange={(e) => setParam('sort', e.target.value)}
                        className="w-full rounded-xl border border-white/12 bg-black/45 px-3 py-2 text-[13px] font-semibold text-white"
                      >
                        {SORTS.map((s) => (
                          <option key={s.id} value={s.id} className="bg-surface">
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block">
                      <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.18em] text-textMuted">Original language</span>
                      <select
                        value={original}
                        onChange={(e) => setParam('original', e.target.value.split('-')[0])}
                        className="w-full rounded-xl border border-white/12 bg-black/45 px-3 py-2 text-[13px] font-semibold text-white"
                      >
                        <option value="">Any language</option>
                        {LANGUAGES.map((l) => (
                          <option key={l.code} value={l.code} className="bg-surface">
                            {l.flag} {l.label} ({l.short})
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block">
                      <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.18em] text-textMuted">Release year</span>
                      <input
                        type="number"
                        min="1900"
                        max="2035"
                        value={year}
                        placeholder="2026"
                        onChange={(e) => setParam('year', e.target.value)}
                        className="w-full rounded-xl border border-white/12 bg-black/45 px-3 py-2 tabular text-[13px] font-semibold text-white"
                      />
                    </label>
                  </div>
                </>
              )}

              {mode === 'my-list' && (
                <p className="text-[13px] text-textSub">
                  Your list lives in this browser only ({list.length} saved). Add titles with the <span className="font-bold text-white">+</span> button on any card.
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {shown.length === 0 && !loading ? (
        <EmptyState
          icon={mode === 'my-list' ? Bookmark : SlidersHorizontal}
          title={mode === 'my-list' ? 'Nothing saved yet' : 'No titles matched those filters'}
          hint={mode === 'my-list' ? 'Hit + on any poster and it will show up here.' : 'Try loosening the genre or language filter.'}
          action={
            mode === 'my-list' ? (
              <button onClick={() => navigate('/')} className="rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-white hover:bg-primaryLight">
                Browse the catalogue
              </button>
            ) : (
              <button onClick={() => { setParam('genre', ''); setParam('original', ''); setParam('year', ''); }} className="rounded-xl border border-white/15 px-5 py-2.5 text-sm font-bold text-textSub hover:text-white">
                Clear filters
              </button>
            )
          }
        />
      ) : (
        <motion.div
          variants={stagger(0.015, 0.028)}
          initial="hidden"
          animate="show"
          className={
            view === 'grid'
              ? 'grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-7'
              : 'flex flex-col gap-2.5'
          }
        >
          {shown.map((t, i) =>
            view === 'grid' ? (
              <Tile key={`${mediaTypeOf(t)}-${t.id}`} t={t} index={i} onOpen={(x, sid) => setSheet({ ...x, _sharedId: sid })} />
            ) : (
              <motion.button
                key={`${mediaTypeOf(t)}-${t.id}`}
                variants={item}
                onClick={() => setSheet({ ...t, media_type: mediaTypeOf(t), _sharedId: `cat-${mediaTypeOf(t)}-${t.id}` })}
                className="flex items-center gap-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3 text-left transition-colors hover:border-primary/40 hover:bg-white/[0.05]"
              >
                <div className="h-20 w-14 flex-shrink-0 overflow-hidden rounded-lg">
                  <SmartImage src={poster(t.poster_path)} alt={titleOf(t)} className="h-full w-full rounded-lg" fallbackLabel={titleOf(t)} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <p className="truncate text-[14px] font-bold text-white">{titleOf(t)}</p>
                    <span className="tabular text-[11px] text-textMuted">{yearOf(t)}</span>
                    <Badge tone="violet">{mediaTypeOf(t)}</Badge>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-textSub">{t.overview}</p>
                </div>
                {t.vote_average ? <span className="tabular text-[13px] font-bold text-gold">{t.vote_average.toFixed(1)}</span> : null}
              </motion.button>
            )
          )}

          {loading && Array.from({ length: 7 }).map((_, i) => <div key={i} className="shimmer aspect-[2/3] rounded-2xl" />)}
        </motion.div>
      )}

      {!loading && mode !== 'my-list' && shown.length > 0 && (
        <div className="mt-8 flex justify-center">
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => {
              const next = page + 1;
              setPage(next);
              load(next);
            }}
            className="rounded-xl border border-white/15 bg-white/[0.04] px-6 py-3 font-display text-sm font-bold text-white hover:border-primary/45 hover:bg-primary/12"
          >
            Load {type === 'tv' ? 'more series' : 'more movies'}
          </motion.button>
        </div>
      )}

      <AnimatePresence>{sheet && <DetailSheet item={sheet} onClose={() => setSheet(null)} />}</AnimatePresence>
    </div>
  );
}
