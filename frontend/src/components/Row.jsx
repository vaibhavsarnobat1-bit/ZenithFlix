import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, useAnimation } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Check, Info, Play, Plus, Tv, Zap } from 'lucide-react';
import { mediaTypeOf, poster, ratingOf, titleOf, yearOf } from '../lib/config';
import { usePrefs } from '../context/Prefs';
import { spring, stagger, item, tiltCard, layerUp, iconOrbit } from '../lib/motion';
import { Badge, SmartImage, toast } from './ui';

/* ─────────────────────────────────────────────────────────────
   TitleCard — poster tile with an in-bounds hover reveal.
   (Nothing overflows the scroller, so rows never clip.)
   ───────────────────────────────────────────────────────────── */
export function TitleCard({ title, index = 0, variant = 'poster', progress, onOpen, layoutIdPrefix = 'poster', rank }) {
  const navigate = useNavigate();
  const { toggle, isInList } = usePrefs();
  const [hovered, setHovered] = useState(false);
  const [saved, setSaved] = useState(() => isInList(`${title.id}`));

  const type = mediaTypeOf(title);
  const label = titleOf(title);
  const year = yearOf(title);
  const rating = ratingOf(title.vote_average);
  const imgPath = variant === 'landscape' ? title.backdrop_path || title.poster_path : title.poster_path;
  const src = poster(imgPath, variant === 'landscape' ? 'still' : 'poster');
  const sharedId = `${layoutIdPrefix}-${type}-${title.id}`;

  const go = useCallback(
    (e) => {
      e?.stopPropagation();
      navigate(`/watch/${type}/${title.id}`);
    },
    [navigate, title.id, type]
  );

  const open = useCallback(
    (e) => {
      e?.stopPropagation();
      onOpen?.({ ...title, media_type: type }, sharedId);
    },
    [onOpen, title, type, sharedId]
  );

  const save = useCallback(
    (e) => {
      e?.stopPropagation();
      const added = toggle({ id: title.id, media_type: type, title: title.title, name: title.name, poster_path: title.poster_path, backdrop_path: title.backdrop_path, vote_average: title.vote_average, release_date: title.release_date, first_air_date: title.first_air_date });
      setSaved(added);
      toast(added ? `${label} added to My List` : `${label} removed from My List`, { icon: added ? Check : Plus });
    },
    [toggle, title, type, label]
  );

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="scene group relative w-[clamp(140px,17vw,190px)] flex-shrink-0 snap-start"
    >
      <motion.div
        layoutId={sharedId}
        onClick={open}
        {...tiltCard}
        className={`depth-frame relative overflow-hidden rounded-xl border bg-surface shadow-card transition-colors duration-300 ${
          hovered ? 'border-primary/45 shadow-lift' : 'border-white/[0.06]'
        } ${variant === 'landscape' ? 'aspect-video' : 'aspect-[2/3]'}`}
      >
        <SmartImage src={src} alt={label} className="h-full w-full" fallbackLabel={label} loading={index > 8 ? 'lazy' : 'eager'} />

        {/* rank badge for numbered shelves */}
        {rank && (
          <span className="pointer-events-none absolute -bottom-1 left-0.5 select-none font-display text-[52px] font-extrabold leading-none text-transparent [-webkit-text-stroke:2px_rgba(255,255,255,0.32)]">
            {rank}
          </span>
        )}

        {/* top-left badges */}
        <div className="absolute left-1.5 top-1.5 flex flex-col items-start gap-1">
          {type === 'tv' && (
            <Badge tone="violet" className="!text-[9px]">
              <Tv className="h-2.5 w-2.5" /> Series
            </Badge>
          )}
          {title.media_type === 'tv' && title.first_air_date && new Date(title.first_air_date).getFullYear() === new Date().getFullYear() && (
            <Badge tone="live" className="!text-[9px]">
              <Zap className="h-2.5 w-2.5" /> New
            </Badge>
          )}
        </div>

        {rating && (
          <div className="absolute right-1.5 top-1.5 rounded-md border border-white/10 bg-black/60 px-1.5 py-0.5 backdrop-blur-sm">
            <span className="tabular text-[10px] font-bold text-gold">{rating}</span>
          </div>
        )}

        {/* hover reveal */}
        <AnimatePresence>
          {hovered && (
            <motion.div
              initial={{ opacity: 0, y: 14, rotateX: -18 }}
              animate={{ opacity: 1, y: 0, rotateX: 0 }}
              exit={{ opacity: 0, y: 10, rotateX: -12 }}
              transition={spring.soft}
              style={layerUp}
              className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black via-black/85 to-transparent px-2.5 pb-2.5 pt-7"
            >
              <div className="mb-2 line-clamp-2 text-[12px] font-semibold leading-snug text-white">{label}</div>
              <div className="flex items-center gap-1.5">
                <motion.button
                  onClick={go}
                  {...iconOrbit}
                  aria-label={`Play ${label}`}
                  className="grid h-8 w-8 place-items-center rounded-full bg-primary text-white shadow-glow-sm"
                >
                  <Play className="ml-0.5 h-3.5 w-3.5 fill-white" />
                </motion.button>
                <motion.button
                  onClick={save}
                  {...iconOrbit}
                  aria-label={saved ? 'Remove from My List' : 'Add to My List'}
                  className={`grid h-8 w-8 place-items-center rounded-full border backdrop-blur-sm transition-colors ${
                    saved ? 'border-lime/50 bg-lime/15 text-lime' : 'border-white/25 bg-white/5 text-white hover:bg-white/15'
                  }`}
                >
                  {saved ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                </motion.button>
                <motion.button
                  onClick={open}
                  {...iconOrbit}
                  aria-label={`More info about ${label}`}
                  className="ml-auto grid h-8 w-8 place-items-center rounded-full border border-white/25 bg-white/5 text-white hover:bg-white/15"
                >
                  <Info className="h-3.5 w-3.5" />
                </motion.button>
              </div>
              {typeof progress === 'number' && (
                <div className="mt-2 h-[3px] w-full overflow-hidden rounded-full bg-white/15">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(100, Math.max(2, progress))}%` }}
                    transition={spring.soft}
                    className="h-full rounded-full bg-primary"
                  />
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {year && !hovered && (
          <div className="absolute bottom-1.5 right-1.5 rounded bg-black/55 px-1 text-[9px] font-semibold tabular text-white/70 opacity-0 transition-opacity duration-200 group-hover:opacity-0">
            {year}
          </div>
        )}
      </motion.div>

      <div className="mt-2 px-0.5">
        <p className="truncate text-[12.5px] font-semibold text-textMain">{label}</p>
        <p className="mt-0.5 truncate text-[11px] tabular text-textMuted">
          {[year, type === 'tv' ? 'Series' : 'Film'].filter(Boolean).join(' · ')}
        </p>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Row — horizontally paged shelf with edge-aware arrows.
   ───────────────────────────────────────────────────────────── */
export default function Row({
  name,
  headline,
  items = [],
  loading,
  variant = 'poster',
  rank = false,
  onOpen,
  progressMap,
  right,
  id,
}) {
  const scroller = useRef(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);
  const controls = useAnimation();

  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 8);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 8);
  }, []);

  useEffect(() => {
    measure();
    const el = scroller.current;
    if (!el) return;
    el.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      el.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [measure, items.length]);

  const page = (dir) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ left: el.scrollLeft + dir * el.clientWidth * 0.86, behavior: 'smooth' });
  };

  // subtle settle bounce when the shelf can no longer scroll further
  const atEdge = useCallback(
    (dir) => {
      controls.start({ x: [0, dir * -14, 0], transition: { duration: 0.34, ease: [0.2, 0.9, 0.2, 1] } });
    },
    [controls]
  );

  const list = useMemo(
    () =>
      items
        .filter((t) => t && (t.poster_path || t.backdrop_path || t.title || t.name))
        .slice(0, 24),
    [items]
  );

  if (!loading && list.length === 0) return null;

  return (
    <section id={id} data-feed={name} className="group/row relative py-3.5">
      {headline && (
        <div className="mb-2.5 flex items-end justify-between gap-4 px-[4vw]">
          <h3 className="font-display text-[15px] font-bold tracking-tight text-white sm:text-[17px]">{headline}</h3>
          {right}
        </div>
      )}

      <div className="relative">
        {/* left arrow */}
        <AnimatePresence>
          {canLeft && (
            <motion.button
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              onClick={() => (canLeft ? page(-1) : atEdge(-1))}
              aria-label="Scroll left"
              className="absolute left-0 top-0 z-30 hidden h-full w-[4vw] min-w-9 items-center justify-center bg-gradient-to-r from-background via-background/85 to-transparent text-white/70 transition-colors hover:text-primaryLight md:flex"
            >
              <ChevronLeft className="h-7 w-7" />
            </motion.button>
          )}
        </AnimatePresence>

        <motion.div
          animate={controls}
          ref={scroller}
          className="no-scrollbar flex snap-x snap-mandatory gap-2.5 overflow-x-auto scroll-smooth px-[4vw] pb-2 pt-1"
        >
          {loading
            ? Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="w-[clamp(140px,17vw,190px)] flex-shrink-0">
                  <div className={`shimmer rounded-xl bg-surface ${variant === 'landscape' ? 'aspect-video' : 'aspect-[2/3]'}`} />
                </div>
              ))
            : list.map((t, i) => (
                <TitleCard
                  key={`${t.id}-${i}`}
                  title={t}
                  index={i}
                  variant={variant}
                  rank={rank ? i + 1 : null}
                  progress={progressMap?.[t.id]}
                  onOpen={onOpen}
                />
              ))}
        </motion.div>

        <AnimatePresence>
          {canRight && (
            <motion.button
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              onClick={() => (canRight ? page(1) : atEdge(1))}
              aria-label="Scroll right"
              className="absolute right-0 top-0 z-30 hidden h-full w-[4vw] min-w-9 items-center justify-center bg-gradient-to-l from-background via-background/85 to-transparent text-white/70 transition-colors hover:text-primaryLight md:flex"
            >
              <ChevronRight className="h-7 w-7" />
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}
