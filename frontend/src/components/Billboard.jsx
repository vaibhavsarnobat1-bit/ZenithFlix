import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, useScroll, useTransform } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Check, Info, Play, Plus, Volume2, VolumeX } from 'lucide-react';
import { tmdb } from '../lib/api';
import { ageRating, backdrop, mediaTypeOf, ratingOf, runtimeLabel, titleOf, yearOf } from '../lib/config';
import { usePrefs } from '../context/Prefs';
import { ambient, letter, spring, splitLetters, iconOrbit } from '../lib/motion';
import { Badge, RatingRing, toast } from './ui';

const ROTATE_MS = 13000;

/** Find this title's official trailer key (TMDB already ranks them for us). */
function pickTrailer(details) {
  const vids = (details?.videos?.results || []).filter((v) => v.site === 'YouTube');
  if (!vids.length) return null;
  const score = (v) => (v.type === 'Trailer' ? 0 : v.type === 'Teaser' ? 1 : 3) + (v.official ? 0 : 1) - Math.min(2, (v.publish_date || '').slice(0, 4) >= '2024' ? 0.5 : 0);
  return [...vids].sort((a, b) => score(a) - score(b))[0]?.key || null;
}

function Headline({ text }) {
  const letters = splitLetters(text);
  return (
    <h1 className="title-3d font-display text-[clamp(28px,6.2vw,68px)] font-extrabold leading-[0.95] tracking-tighter2 text-white [perspective:800px]">
      {letters.map(({ ch, i }) => (
        <motion.span
          key={`${i}-${ch}`}
          custom={i}
          variants={letter}
          initial="hidden"
          animate="show"
          className="inline-block [transform-style:preserve-3d]"
        >
          {ch}
        </motion.span>
      ))}
    </h1>
  );
}

export default function Billboard({ seeds, onOpen }) {
  const navigate = useNavigate();
  const { toggle, isInList } = usePrefs();
  const [index, setIndex] = useState(0);
  const [muted, setMuted] = useState(true);
  const [paused, setPaused] = useState(false);
  const [enriched, setEnriched] = useState({});
  const timer = useRef(null);
  const { scrollY } = useScroll();
  const layerY = useTransform(scrollY, [0, 700], [0, 120]);
  const layerFade = useTransform(scrollY, [0, 420], [1, 0.35]);
  const scrimShift = useTransform(scrollY, [0, 700], [0, 46]);

  const items = useMemo(() => (seeds || []).filter((t) => t?.id && (t.backdrop_path || t.poster_path)).slice(0, 6), [seeds]);
  const current = items[index];

  /* fetch full metadata + trailer for the 6 candidates, lazily */
  useEffect(() => {
    if (!current) return;
    const type = mediaTypeOf(current);
    if (enriched[`${type}-${current.id}`]) return;
    let dead = false;
    tmdb
      .details(type, current.id)
      .then((d) => !dead && setEnriched((e) => ({ ...e, [`${type}-${current.id}`]: d })))
      .catch(() => {});
    return () => {
      dead = true;
    };
  }, [current, enriched]);

  /* rotation */
  useEffect(() => {
    if (!items.length || paused) return;
    timer.current = setInterval(() => setIndex((i) => (i + 1) % items.length), ROTATE_MS);
    return () => clearInterval(timer.current);
  }, [items.length, paused]);

  const goTo = useCallback((i) => setIndex(i), []);

  if (!current) return null;

  const id = `${mediaTypeOf(current)}-${current.id}`;
  const detail = enriched[id];
  const type = mediaTypeOf(current);
  const label = titleOf(current);
  const trailerKey = pickTrailer(detail);
  const still = backdrop(detail?.backdrop_path || current.backdrop_path, 'backdrop2x');
  const overview = (detail?.overview || current.overview || '').trim();
  const genres = (detail?.genres || []).slice(0, 3).map((g) => g.name);
  const age = ageRating(detail);
  const runtime = type === 'tv' ? runtimeLabel((detail?.episode_run_time || [])[0]) : runtimeLabel(detail?.runtime);
  const rating = ratingOf(current.vote_average);
  const saved = isInList(String(current.id));

  const open = () => onOpen?.({ ...current, media_type: type }, `billboard-${id}`);

  const play = () => navigate(`/watch/${type}/${current.id}${trailerKey ? `?yt=${trailerKey}` : ''}`);

  const save = () => {
    const added = toggle({ ...current, media_type: type });
    setIndex((i) => i);
    toast(added ? `${label} added to My List` : `${label} removed from My List`, { icon: added ? Check : Plus });
  };

  return (
    <section
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className="film-grain relative min-h-[78vh] w-full overflow-hidden sm:min-h-[86vh]"
    >
      {/* backdrop / trailer layers */}
      <motion.div style={{ y: layerY, opacity: layerFade }} className="absolute inset-0">
        <AnimatePresence mode="sync">
          <motion.div
            key={id}
            initial={{ opacity: 0, scale: 1.09 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.02 }}
            transition={{ opacity: { duration: 0.85, ease: [0.16, 1, 0.3, 1] }, scale: { duration: 14, ease: 'linear' } }}
            className="absolute inset-0"
          >
            {still ? (
              <img src={still} alt="" className="h-full w-full object-cover object-[50%_26%]" />
            ) : (
              <div className="h-full w-full bg-surfaceHigh" />
            )}

            {trailerKey && (
              <div className="pointer-events-none absolute inset-0 overflow-hidden">
                {/* crop the player chrome out of frame */}
                <iframe
                  key={`${trailerKey}-${muted ? 'm' : 'u'}`}
                  title=""
                  src={`https://www.youtube-nocookie.com/embed/${trailerKey}?autoplay=1&mute=${muted ? 1 : 0}&loop=1&playlist=${trailerKey}&controls=0&showinfo=0&rel=0&modestbranding=1&playsinline=1&iv_load_policy=3&disablekb=1&enablejsapi=1`}
                  allow="autoplay; encrypted-media; picture-in-picture"
                  referrerPolicy="strict-origin-when-cross-origin"
                  className="absolute left-1/2 top-1/2 h-[132%] w-[180%] -translate-x-1/2 -translate-y-1/2 border-0 opacity-80"
                />
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </motion.div>

      {/* scrims — the text side stays readable over any artwork */}
      <motion.div
        style={{ x: scrimShift }}
        className="absolute inset-0 bg-gradient-to-r from-black/95 via-black/55 to-transparent md:via-black/40"
      />
      <div className="absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-background via-background/85 to-transparent" />

      {/* content */}
      <div className="relative z-10 flex min-h-[78vh] flex-col justify-end px-[4vw] pb-14 pt-28 sm:justify-center sm:pb-24">
        <AnimatePresence mode="wait">
          <motion.div
            key={`${id}-copy`}
            initial={{ opacity: 0, y: 26, rotateX: 8, filter: 'blur(10px)' }}
            animate={{ opacity: 1, y: 0, rotateX: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -18, rotateX: -5, filter: 'blur(8px)' }}
            transition={{ ...spring.soft, duration: 0.5 }}
            style={{ transformPerspective: 900 }}
            className="max-w-[min(680px,92vw)]"
          >
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08 }}
              className="mb-3 flex flex-wrap items-center gap-2"
            >
              <span className="flex items-center gap-1.5 rounded-md bg-ember-gradient px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.16em] text-white">
                <span className="h-1.5 w-1.5 animate-pulse-glow rounded-full bg-white" />
                {type === 'tv' ? 'Trending Series' : 'Featured Film'}
              </span>
              {age && <Badge tone="gold">{age}</Badge>}
              {rating && (
                <span className="flex items-center gap-1 text-[11px] font-bold tabular text-gold">
                  {rating} <span className="font-normal text-textMuted">/ 10</span>
                </span>
              )}
              {yearOf(current) && <span className="text-[11px] font-semibold tabular text-textSub">{yearOf(current)}</span>}
              {runtime && <span className="text-[11px] font-semibold tabular text-textMuted">{runtime}</span>}
            </motion.div>

            <Headline text={label} />

            {detail?.tagline && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.45 }}
                className="mt-3 font-display text-[15px] italic text-textSub"
              >
                {detail.tagline}
              </motion.p>
            )}

            <motion.p
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...spring.soft, delay: 0.3 }}
              className="mt-4 line-clamp-3 max-w-[58ch] text-[14px] leading-relaxed text-textSub sm:text-[15.5px]"
            >
              {overview || 'No synopsis available for this title yet.'}
            </motion.p>

            {genres.length > 0 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5 }}
                className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] font-medium text-textMuted"
              >
                {genres.map((g, i) => (
                  <span key={g}>
                    {g}
                    {i < genres.length - 1 && <span className="ml-2 text-primary/60">•</span>}
                  </span>
                ))}
              </motion.div>
            )}

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...spring.soft, delay: 0.42 }}
              className="mt-7 flex flex-wrap items-center gap-3"
            >
              <motion.button
                whileHover={{ y: -3, scale: 1.05, z: 30, rotateX: 5 }}
                whileTap={{ y: 2, scale: 0.95, z: 0 }}
                transition={spring.snappy}
                style={{ transformPerspective: 600 }}
                onClick={play}
                className="sheen btn-3d btn-3d-ember group flex items-center gap-2.5 rounded-xl bg-white px-6 py-3 font-display text-[15px] font-bold text-black shadow-lift transition-colors hover:bg-primaryLight"
              >
                <Play className="h-4 w-4 fill-current icon-bob" />
                Play now
              </motion.button>

              <motion.button
                whileHover={{ y: -3, scale: 1.04, z: 26, rotateX: 5 }}
                whileTap={{ y: 2, scale: 0.95, z: 0 }}
                transition={spring.snappy}
                style={{ transformPerspective: 600 }}
                onClick={open}
                className="btn-3d btn-3d-glass flex items-center gap-2.5 rounded-xl border border-white/20 bg-white/[0.07] px-5 py-3 font-display text-[15px] font-bold text-white backdrop-blur-md transition-colors hover:bg-white/[0.14]"
              >
                <Info className="h-4 w-4 icon-swing" />
                More info
              </motion.button>

              <motion.button
                {...iconOrbit}
                onClick={save}
                aria-label={saved ? 'Remove from My List' : 'Add to My List'}
                className={`grid h-11 w-11 place-items-center rounded-xl border backdrop-blur-md transition-colors ${
                  saved ? 'border-lime/50 bg-lime/15 text-lime' : 'border-white/20 bg-white/[0.07] text-white hover:bg-white/[0.14]'
                }`}
              >
                {saved ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              </motion.button>

              <div className="flex items-center gap-2">
                {rating && <RatingRing value={Number(current.vote_average)} size={44} />}
                {detail?.vote_count > 0 && (
                  <span className="text-[11px] leading-tight text-textMuted">
                    {detail.vote_count.toLocaleString()}
                    <br />
                    TMDB votes
                  </span>
                )}
              </div>
            </motion.div>

            {/* transport rail: mute + rotation progress, kept in flow so it never rides over the buttons */}
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }} className="mt-6 flex items-center gap-3">
              <motion.button
                onClick={() => setMuted((m) => !m)}
                whileHover={{ y: -2, scale: 1.1 }}
                whileTap={{ scale: 0.85, rotate: -12 }}
                transition={spring.pop}
                aria-label={muted ? 'Unmute trailer' : 'Mute trailer'}
                className="grid h-9 w-9 place-items-center rounded-full border border-white/20 bg-black/45 text-white/80 backdrop-blur-md transition-colors hover:border-primary/50 hover:text-white"
              >
                {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4 icon-breathe" />}
              </motion.button>
              <div className="flex items-center gap-1.5">
                {items.map((t, i) => (
                  <button key={t.id} onClick={() => goTo(i)} aria-label={`Show ${titleOf(t)}`} className="relative h-1 w-7 overflow-hidden rounded-full bg-white/20">
                    <motion.span
                      className="absolute inset-y-0 left-0 bg-white"
                      initial={{ width: 0 }}
                      animate={{ width: i === index ? '100%' : '0%' }}
                      transition={{ duration: i === index && !paused ? ROTATE_MS / 1000 : 0.25, ease: 'linear' }}
                    />
                  </button>
                ))}
              </div>
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-textMuted">
                {index + 1} / {items.length}
              </span>
            </motion.div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ambient light leak */}
      <motion.div
        {...ambient.breathe}
        className="pointer-events-none absolute -left-24 top-1/3 h-72 w-72 rounded-full bg-primary/25 blur-[110px]"
      />
    </section>
  );
}
