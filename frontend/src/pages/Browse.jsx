import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Bookmark, Flame, Heart, ListVideo, Sparkles } from 'lucide-react';
import DetailSheet from '../components/DetailSheet';
import Row from '../components/Row';
import Billboard from '../components/Billboard';
import { LogoMark } from '../components/Logo3D';
import { tmdb } from '../lib/api';
import { mediaTypeOf } from '../lib/config';
import { usePrefs } from '../context/Prefs';
import { spring, stagger, item3d, splitLetters, letter } from '../lib/motion';

/** Rows we ask the backend for, in display order. Names map to backend/lib/tmdb.js FEEDS. */
const PLAN = [
  { name: 'trending', headline: 'Top 10 in your region today', rank: true },
  { name: 'now_playing', headline: 'Fresh in theatres & streaming now' },
  { name: 'airing_today', headline: 'New episodes tonight' },
  { name: 'popular_movie', headline: 'Blockbuster movies' },
  { name: 'top_tv', headline: 'Binge-worthy series' },
  { name: 'anime_tv', headline: 'Anime & Asian cinema' },
  { name: 'action', headline: 'Action & adrenaline' },
  { name: 'bollywood', headline: 'Hindi cinema' },
  { name: 'tollywood', headline: 'Telugu & Tamil mass cinema' },
  { name: 'k_drama', headline: 'Korean dramas' },
  { name: 'horror', headline: 'Horror nights' },
  { name: 'documentary', headline: 'True stories' },
];

const GENRE_CHIPS = [
  { id: 28, label: 'Action' },
  { id: 35, label: 'Comedy' },
  { id: 16, label: 'Animation' },
  { id: 27, label: 'Horror' },
  { id: 878, label: 'Sci-Fi' },
  { id: 10749, label: 'Romance' },
  { id: 53, label: 'Thriller' },
  { id: 80, label: 'Crime' },
  { id: 18, label: 'Drama' },
  { id: 10759, label: 'Adventure' },
  { id: 99, label: 'Documentary' },
  { id: 10764, label: 'Reality' },
];

export default function Browse() {
  const navigate = useNavigate();
  const { localeKey, list, continueWatching } = usePrefs();
  const [feeds, setFeeds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sheet, setSheet] = useState(null);
  const [error, setError] = useState(null);

  const openSheet = useCallback((item_, sharedId) => setSheet({ ...item_, _sharedId: sharedId }), []);

  /* Priority feeds first (top of page), secondary feeds after a tiny tick to unblock initial paint */
  useEffect(() => {
    let dead = false;
    setFeeds([]);
    setLoading(true);
    setError(null);
    let pending = PLAN.length;

    const settle = () => {
      pending -= 1;
      if (pending <= 0 && !dead) setLoading(false);
    };

    const fetchFeed = (p) =>
      tmdb
        .feed(p.name)
        .then((results) => !dead && setFeeds((prev) => [...prev.filter((f) => f.name !== p.name), { name: p.name, results }]))
        .catch((e) => {
          if (!dead) {
            setFeeds((prev) => [...prev.filter((f) => f.name !== p.name), { name: p.name, results: [] }]);
            setError((prev) => prev || e?.response?.data?.detail || e.message);
          }
        })
        .finally(settle);

    // Critical rows for viewport (trending, now_playing, airing_today, popular_movie)
    const priority = PLAN.slice(0, 4);
    const secondary = PLAN.slice(4);

    priority.forEach((p) => fetchFeed(p));

    const timer = setTimeout(() => {
      if (!dead) {
        secondary.forEach((p) => fetchFeed(p));
      }
    }, 150);

    return () => {
      dead = true;
      clearTimeout(timer);
    };
  }, [localeKey]);

  /* the billboard rotates through the strongest art we have */
  const seeds = useMemo(() => {
    const trending = feeds.find((f) => f.name === 'trending')?.results || [];
    const fresh = feeds.find((f) => f.name === 'now_playing')?.results || [];
    return [...trending, ...fresh].filter((t) => t.backdrop_path).slice(0, 6);
  }, [feeds]);

  const named = useMemo(() => {
    const map = new Map(feeds.map((f) => [f.name, f.results]));
    return PLAN.map((p) => ({ ...p, items: map.get(p.name) || [], ready: map.has(p.name) }));
  }, [feeds]);

  return (
    <div className="min-h-screen bg-background pb-16">
      <>
          <Billboard seeds={seeds} onOpen={openSheet} />

          {error && (
            <div className="mx-[4vw] -mt-4 mb-4 rounded-xl border border-gold/30 bg-gold/[0.07] px-4 py-3 text-[12.5px] text-gold">
              Catalogue feed failed: {String(error)}. Backend proxy needs a valid <code className="tabular">TMDB_API_KEY</code> in <code>backend/.env</code>.
            </div>
          )}

          {/* quick rows */}
          <div className="relative z-10 -mt-10 sm:-mt-14">
            {(continueWatching.length > 0 || list.length > 0) && !loading && (
              <Row
                headline={continueWatching.length ? 'Continue watching' : 'Jump back in'}
                name="personal"
                variant="landscape"
                items={continueWatching.map((c) => ({ ...c, media_type: mediaTypeOf(c) }))}
                progressMap={Object.fromEntries(continueWatching.map((c) => [c.id, c.progress || 22]))}
                onOpen={openSheet}
              />
            )}

            {list.length > 0 && (
              <Row headline="My List" name="saved" items={list.map((l) => ({ ...l, media_type: mediaTypeOf(l) }))} onOpen={openSheet} right={
                <button onClick={() => navigate('/my-list')} className="text-[11px] font-bold uppercase tracking-wide text-textMuted hover:text-primaryLight">See all</button>
              } />
            )}

            {named.map((row) => (
              <Row
                key={row.name}
                name={row.name}
                headline={row.headline}
                items={row.items}
                rank={row.rank}
                loading={!row.ready}
                onOpen={openSheet}
              />
            ))}

            {/* browse by genre */}
            <section className="mt-8 px-[4vw]">
              <div className="mb-3 flex items-center gap-2">
                <Sparkles className="icon-breathe h-4 w-4 text-primary" />
                <h3 className="title-3d font-display text-[17px] font-bold text-white">Browse by genre</h3>
              </div>
              <motion.div variants={stagger(0.02, 0.035)} initial="hidden" whileInView="show" viewport={{ once: true }} className="scene flex flex-wrap gap-2">
                {GENRE_CHIPS.map((g) => (
                  <motion.button
                    key={g.id}
                    variants={item3d}
                    whileHover={{ y: -3, scale: 1.06, rotateX: 12, z: 16 }}
                    whileTap={{ y: 1, scale: 0.92, rotateX: -6 }}
                    transition={{ ...spring.snappy, transformPerspective: 520 }}
                    onClick={() => navigate(`/catalog/movie?genre=${g.id}`)}
                    className="btn-3d btn-3d-glass rounded-full border border-white/10 bg-white/[0.035] px-4 py-2 text-[13px] font-semibold text-textSub transition-colors hover:border-primary/45 hover:bg-primary/12 hover:text-white"
                  >
                    {g.label}
                  </motion.button>
                ))}
              </motion.div>
            </section>

            {/* curated shelves as rows too */}
            <Row headline="Top rated of all time" name="community" items={named.find((n) => n.name === 'top_tv')?.items || []} onOpen={openSheet} loading={!named.find((n) => n.name === 'top_tv')?.ready} />

            <section className="mt-10 px-[4vw]">
              <motion.div
                initial={{ opacity: 0, y: 24, rotateX: -8 }}
                whileInView={{ opacity: 1, y: 0, rotateX: 0 }}
                viewport={{ once: true }}
                transition={{ ...spring.soft, transformPerspective: 1000 }}
                className="flex flex-col items-start gap-4 overflow-hidden rounded-3xl border border-white/[0.08] bg-[linear-gradient(115deg,rgba(255,46,85,0.14),rgba(124,92,255,0.12)_55%,transparent)] p-6 sm:flex-row sm:items-center sm:p-8"
              >
                <div className="flex-1">
                  <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-primary">
                    <Flame className="h-3.5 w-3.5 icon-breathe" /> Watch together
                  </div>
                  <h3 className="title-3d font-display text-2xl font-extrabold tracking-tighter2 text-white">Frame-locked watch parties</h3>
                  <p className="mt-2 max-w-[60ch] text-[13.5px] leading-relaxed text-textSub">
                    Open a room, share the 7-character ID, and every pause, seek and episode change mirrors to your friends in under a second. Chat and reactions live in the sidebar.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2.5">
                  <motion.button
                    whileHover={{ y: -3, scale: 1.04, z: 24 }}
                    whileTap={{ y: 2, scale: 0.94, z: 0 }}
                    transition={spring.snappy}
                    style={{ transformPerspective: 550 }}
                    onClick={() => navigate('/create-group')}
                    className="sheen btn-3d btn-3d-ember rounded-xl bg-white px-5 py-3 font-display text-sm font-bold text-black hover:bg-primaryLight"
                  >
                    Create room
                  </motion.button>
                  <motion.button
                    whileHover={{ y: -3, scale: 1.04, z: 20 }}
                    whileTap={{ y: 2, scale: 0.94, z: 0 }}
                    transition={spring.snappy}
                    style={{ transformPerspective: 550 }}
                    onClick={() => navigate('/my-list')}
                    className="btn-3d btn-3d-glass flex items-center gap-2 rounded-xl border border-white/20 bg-black/30 px-5 py-3 font-display text-sm font-bold text-white hover:bg-white/10"
                  >
                    <Bookmark className="h-4 w-4 icon-swing" /> My list
                  </motion.button>
                </div>
              </motion.div>
            </section>

            <p className="mt-8 flex items-center justify-center gap-2 px-[4vw] text-center text-[11px] leading-relaxed text-textMuted">
              <ListVideo className="h-3.5 w-3.5" />
              Metadata &amp; artwork from TMDB. Playback uses third-party embed servers that may be unavailable or carry their own restrictions.
            </p>

            {/* ── signature: compact glowing pill, pops in when you scroll to the end ── */}
            <motion.div
              initial="hidden"
              whileInView="show"
              viewport={{ once: false, amount: 0.9 }}
              className="scene mt-10 flex justify-center"
            >
              <motion.div
                variants={letter}
                custom={0}
                className="flex items-center gap-2.5 rounded-full border border-white/12 bg-white/[0.03] py-2 pl-2 pr-5 shadow-[0_0_28px_-6px_rgba(255,46,85,0.35)] backdrop-blur-md"
              >
                <LogoMark size={26} />
                <span className="text-[9px] font-bold uppercase tracking-[0.3em] text-textMuted">made by</span>
                <span className="font-display text-[15px] font-extrabold tracking-tight [perspective:500px]">
                  {splitLetters('Vaibhav').map(({ ch, i }) => (
                    <motion.span
                      key={`v-${i}-${ch}`}
                      custom={i + 1}
                      variants={letter}
                      className="text-gradient-primary inline-block [transform-style:preserve-3d]"
                    >
                      {ch}
                    </motion.span>
                  ))}
                </span>
                <Heart className="h-3.5 w-3.5 fill-primary text-primary icon-breathe" />
                <span className="h-1.5 w-1.5 animate-pulse-glow rounded-full bg-lime" />
              </motion.div>
            </motion.div>
          </div>
      </>

      {sheet && <DetailSheet item={sheet} onClose={() => setSheet(null)} />}
    </div>
  );
}
