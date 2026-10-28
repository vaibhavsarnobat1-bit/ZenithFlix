import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronDown, Play, Plus, Share2, Users, Wand2 } from 'lucide-react';
import { tmdb } from '../lib/api';
import { IMG, ageRating, mediaTypeOf, poster, ratingOf, runtimeLabel, streamDateLabel, titleOf, yearOf } from '../lib/config';
import { DEFAULT_SERVER } from '../lib/providers';
import { createParty } from '../lib/party';
import { getUserName } from '../lib/config';
import { usePrefs } from '../context/Prefs';
import { scrim, spring, stagger, item, sheet3d } from '../lib/motion';
import { Badge, CloseButton, RatingRing, SmartImage, SegmentedTabs, toast } from './ui';

/* ── cast strip ────────────────────────────────────────────── */
function Cast({ cast = [] }) {
  if (!cast.length) return null;
  return (
    <div className="no-scrollbar -mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
      {cast.slice(0, 12).map((c) => (
        <motion.div
          key={`${c.id}-${c.character}`}
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={spring.soft}
          className="w-[74px] flex-shrink-0 text-center"
        >
          <div className="h-[74px] w-[74px] overflow-hidden rounded-full border border-white/10">
            <SmartImage src={c.profile_path ? `${IMG.face}${c.profile_path}` : null} alt={c.name} className="h-full w-full rounded-full" fallbackLabel={c.name?.[0]} />
          </div>
          <p className="mt-1.5 line-clamp-2 text-[10.5px] font-semibold leading-tight text-textMain">{c.name}</p>
          {c.character && <p className="mt-0.5 line-clamp-1 text-[10px] text-textMuted">{c.character}</p>}
        </motion.div>
      ))}
    </div>
  );
}

/* ── episode list ──────────────────────────────────────────── */
function Episodes({ seriesId, season, onPlayEpisode }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let dead = false;
    setLoading(true);
    tmdb
      .season(seriesId, season)
      .then((d) => !dead && setData(d))
      .finally(() => !dead && setLoading(false));
    return () => {
      dead = true;
    };
  }, [seriesId, season]);

  if (loading) {
    return (
      <div className="space-y-2 py-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="shimmer h-[84px] rounded-xl" />
        ))}
      </div>
    );
  }

  const episodes = data?.episodes || [];
  if (!episodes.length) return <p className="py-4 text-sm text-textMuted">TMDB has no episodes listed for this season yet.</p>;

  return (
    <motion.div variants={stagger(0, 0.05)} initial="hidden" animate="show" className="space-y-2">
      {episodes.map((e) => (
        <motion.button
          key={e.id}
          variants={item}
          onClick={() => onPlayEpisode(season, e.episode_number)}
          className="group flex w-full gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-2 text-left transition-colors hover:border-primary/35 hover:bg-primary/[0.07]"
        >
          <div className="relative aspect-video w-[126px] flex-shrink-0 overflow-hidden rounded-lg sm:w-[152px]">
            <SmartImage
              src={poster(e.still_path, 'still')}
              alt={e.name}
              className="h-full w-full rounded-lg"
              fallbackLabel={`E${e.episode_number}`}
            />
            <span className="absolute inset-0 grid place-items-center bg-black/55 opacity-0 transition-opacity group-hover:opacity-100">
              <Play className="h-5 w-5 fill-white text-white" />
            </span>
          </div>
          <div className="min-w-0 flex-1 py-0.5">
            <div className="flex items-baseline gap-2">
              <span className="tabular text-[11px] font-bold text-textMuted">E{e.episode_number}</span>
              <span className="truncate text-[13px] font-semibold text-white">{e.name}</span>
              {e.runtime && <span className="ml-auto tabular text-[10px] text-textMuted">{e.runtime}m</span>}
            </div>
            <p className="mt-1 line-clamp-2 text-[11.5px] leading-relaxed text-textSub">{e.overview}</p>
            {e.air_date && <p className="mt-1 tabular text-[10px] text-textMuted">{e.air_date}</p>}
          </div>
        </motion.button>
      ))}
    </motion.div>
  );
}

/* ── main sheet ────────────────────────────────────────────── */
export default function DetailSheet({ item, onClose }) {
  const navigate = useNavigate();
  const { toggle, isInList } = usePrefs();
  const type = mediaTypeOf(item);
  const sharedId = item._sharedId;
  const [data, setData] = useState(null);
  const [similar, setSimilar] = useState([]);
  const [tab, setTab] = useState('episodes');
  const [season, setSeason] = useState(1);
  const [seasonOpen, setSeasonOpen] = useState(false);
  const [creatingParty, setCreatingParty] = useState(false);
  const bodyRef = useRef(null);

  const seasons = useMemo(() => (data?.number_of_seasons ? Array.from({ length: data.number_of_seasons }, (_, i) => i + 1) : []), [data]);

  useEffect(() => {
    let dead = false;
    setData(null);
    bodyRef.current?.scrollTo({ top: 0 });
    tmdb
      .details(type, item.id)
      .then((d) => !dead && setData(d))
      .catch(() => !dead && setData({}));
    tmdb.similar(type, item.id).then((r) => !dead && setSimilar(r || [])).catch(() => {});
    return () => {
      dead = true;
    };
  }, [item.id, type]);

  // lock page scroll + escape to close
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const esc = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', esc);
    };
  }, [onClose]);

  const label = titleOf(item);
  const rating = ratingOf(item.vote_average ?? data?.vote_average);
  const age = ageRating(data);
  const stream = streamDateLabel(data);
  const saved = isInList(String(item.id));
  const trailerKey = (data?.videos?.results || []).find((v) => v.site === 'YouTube' && v.type === 'Trailer')?.key;
  const tabs =
    type === 'tv'
      ? [
          { id: 'episodes', label: 'Episodes' },
          { id: 'details', label: 'Details' },
          { id: 'more', label: 'More like this' },
        ]
      : [
          { id: 'details', label: 'Details' },
          { id: 'more', label: 'More like this' },
        ];

  useEffect(() => {
    if (type !== 'tv' && tab === 'episodes') setTab('details');
  }, [type, tab]);

  const play = (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    navigate(`/watch/${type}/${item.id}${qs ? `?${qs}` : ''}${trailerKey && !qs ? `?yt=${trailerKey}` : ''}`);
    onClose();
  };

  const share = async () => {
    const url = `${window.location.origin}/watch/${type}/${item.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied to clipboard');
    } catch {
      toast('Could not copy link', { tone: 'warn', icon: Share2 });
    }
  };

  return (
    <motion.div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto p-0 sm:p-6" initial="hidden" animate="show" exit="exit">
      <motion.div variants={scrim} onClick={onClose} className="fixed inset-0 bg-black/70" />

      <motion.div
        variants={sheet3d}
        initial="hidden"
        animate="show"
        exit="exit"
        style={{ transformPerspective: 1200 }}
        className="relative z-10 mb-0 w-full max-w-[900px] origin-top overflow-hidden rounded-none border border-white/[0.08] bg-surface shadow-cinema sm:mb-10 sm:rounded-3xl"
      >
        {/* hero */}
        <div className="relative aspect-[16/8] w-full overflow-hidden sm:aspect-[16/7]">
          <motion.div layoutId={sharedId} className="absolute inset-0">
            <img src={poster(data?.backdrop_path || item.backdrop_path || item.poster_path, 'backdrop')} alt="" className="h-full w-full object-cover" />
          </motion.div>
          <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/25 to-transparent" />
          <div className="absolute inset-x-0 top-0 flex justify-end p-3">
            <CloseButton onClick={onClose} />
          </div>

          <div className="absolute inset-x-0 bottom-0 p-4 sm:p-6">
            <h2 className="max-w-[22ch] font-display text-[clamp(20px,3.4vw,34px)] font-extrabold leading-tight tracking-tighter2 text-white drop-shadow-lg">
              {data?.title || data?.name || label}
            </h2>

            <div className="mt-3 flex flex-wrap items-center gap-2.5">
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                transition={spring.snappy}
                onClick={() => play()}
                className="sheen flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 font-display text-sm font-bold text-black shadow-lift hover:bg-primaryLight"
              >
                <Play className="h-4 w-4 fill-current" /> Play
              </motion.button>

              <motion.button
                whileHover={{ scale: 1.08 }}
                whileTap={{ scale: 0.92 }}
                onClick={() => {
                  const added = toggle({ ...item, media_type: type });
                  toast(added ? `${label} added to My List` : `${label} removed`);
                }}
                aria-label="Toggle My List"
                className={`grid h-10 w-10 place-items-center rounded-full border backdrop-blur-md ${
                  saved ? 'border-lime/50 bg-lime/15 text-lime' : 'border-white/25 bg-black/45 text-white hover:bg-white/15'
                }`}
              >
                {saved ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              </motion.button>

              <motion.button
                whileHover={{ scale: 1.08 }}
                whileTap={{ scale: 0.92 }}
                onClick={share}
                aria-label="Copy link"
                className="grid h-10 w-10 place-items-center rounded-full border border-white/25 bg-black/45 text-white backdrop-blur-md hover:bg-white/15"
              >
                <Share2 className="h-4 w-4" />
              </motion.button>

              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.96 }}
                disabled={creatingParty}
                onClick={async () => {
                  if (creatingParty) return;
                  setCreatingParty(true);
                  try {
                    const id = await createParty({ name: label, username: getUserName() || 'Guest', nowPlaying: {
                      type, tmdbId: item.id, title: label, provider: DEFAULT_SERVER,
                      season, episode: 1, poster: item.poster_path || null,
                    } });
                    navigate(`/room/${id}`);
                    onClose();
                  } catch (error) {
                    toast(error.message, { tone: 'warn', ttl: 6000 });
                  } finally { setCreatingParty(false); }
                }}
                className="flex items-center gap-2 rounded-full border border-secondary/45 bg-secondary/15 px-4 py-2 text-[13px] font-bold text-white backdrop-blur-md hover:bg-secondary/25"
              >
                <Users className="h-3.5 w-3.5" /> {creatingParty ? 'Creating…' : 'Create Watch Party'}
              </motion.button>
            </div>
          </div>
        </div>

        {/* body */}
        <div ref={bodyRef} className="px-4 pb-6 sm:px-6">
          <div className="grid gap-6 py-5 md:grid-cols-[1.7fr_1fr]">
            <div>
              <div className="mb-3 flex flex-wrap items-center gap-2.5 text-[12px]">
                {rating && <RatingRing value={Number(item.vote_average ?? data?.vote_average ?? 0)} size={38} />}
                <span className="tabular font-semibold text-textSub">{yearOf(data || item)}</span>
                {data?.runtime ? <span className="tabular text-textMuted">{runtimeLabel(data.runtime)}</span> : type === 'tv' && data?.episode_run_time?.[0] ? <span className="tabular text-textMuted">{data.episode_run_time[0]}m / ep</span> : null}
                {age && <Badge tone="gold">{age}</Badge>}
                <Badge tone="muted">Quality unverified</Badge>
                {data?.original_language && <Badge tone="violet">{data.original_language.toUpperCase()}</Badge>}
                {stream && <span className="text-textMuted">Streaming {stream}</span>}
              </div>

              <p className="text-[14px] leading-relaxed text-textMain">{(data?.overview || item.overview || '').trim() || 'No synopsis yet.'}</p>

              <div className="mt-4 space-y-1.5 text-[12.5px] text-textMuted">
                {data?.genres?.length && (
                  <p>
                    <span className="text-textSub">Genres </span>
                    {data.genres.map((g) => g.name).join(' · ')}
                  </p>
                )}
                {data?.production_companies?.length > 0 && (
                  <p>
                    <span className="text-textSub">Studio </span>
                    {data.production_companies.slice(0, 2).map((p) => p.name).join(', ')}
                  </p>
                )}
                {type === 'tv' && data?.number_of_seasons && (
                  <p>
                    <span className="text-textSub">Seasons </span>
                    {data.number_of_seasons} · {data.number_of_episodes} episodes
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-textMuted">Cast</p>
                <Cast cast={data?.credits?.cast} />
              </div>
              {data?.tagline && (
                <p className="border-l-2 border-primary/50 pl-3 font-display text-[13px] italic text-textSub">“{data.tagline}”</p>
              )}
              {trailerKey && (
                <button
                  onClick={() => window.open(`https://www.youtube.com/watch?v=${trailerKey}`, '_blank', 'noopener')}
                  className="group flex w-full items-center gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 text-left transition-colors hover:border-primary/40"
                >
                  <Wand2 className="h-4 w-4 text-primary" />
                  <span className="flex-1 text-[12.5px] font-semibold text-textMain">Watch official trailer</span>
                  <span className="text-[10px] uppercase tracking-wide text-textMuted group-hover:text-primaryLight">YouTube</span>
                </button>
              )}
            </div>
          </div>

          {/* tabs */}
          <div className="sticky top-0 z-10 -mx-4 bg-surface/92 px-4 py-2 backdrop-blur-md sm:-mx-6 sm:px-6">
            <SegmentedTabs
              options={tabs}
              value={tab}
              onChange={setTab}
              layoutId="sheet-tab"
              size="sm"
            />
          </div>

          <AnimatePresence mode="wait">
            <motion.div key={tab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.22 }} className="pt-4">
              {tab === 'episodes' && type === 'tv' && (
                <>
                  <div className="relative mb-3 inline-block">
                    <button
                      onClick={() => setSeasonOpen((v) => !v)}
                      className="flex items-center gap-2 rounded-xl border border-white/12 bg-black/40 px-3.5 py-2 text-[13px] font-bold text-white hover:border-primary/40"
                    >
                      Season {season}
                      <ChevronDown className={`h-3.5 w-3.5 transition-transform ${seasonOpen ? 'rotate-180' : ''}`} />
                    </button>
                    <AnimatePresence>
                      {seasonOpen && (
                        <motion.ul
                          initial={{ opacity: 0, y: -8, scale: 0.96 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: -8, scale: 0.96 }}
                          transition={spring.soft}
                          className="absolute left-0 top-[calc(100%+6px)] z-20 max-h-56 w-44 overflow-y-auto rounded-xl border border-white/10 bg-black/92 p-1.5 shadow-cinema backdrop-blur-xl"
                        >
                          {seasons.map((s) => (
                            <li key={s}>
                              <button
                                onClick={() => {
                                  setSeason(s);
                                  setSeasonOpen(false);
                                }}
                                className={`w-full rounded-lg px-3 py-1.5 text-left text-[13px] ${s === season ? 'bg-primary/20 text-white' : 'text-textSub hover:bg-white/[0.06]'}`}
                              >
                                Season {s}
                              </button>
                            </li>
                          ))}
                        </motion.ul>
                      )}
                    </AnimatePresence>
                  </div>
                  <Episodes seriesId={item.id} season={season} onPlayEpisode={(s, e) => play({ season: s, episode: e })} />
                </>
              )}

              {tab === 'details' && (
                <div className="space-y-3 text-[13px] leading-relaxed text-textSub">
                  <p><span className="text-white">Original title:</span> {data?.original_title || data?.original_name || label}</p>
                  <p><span className="text-white">Status:</span> {data?.status || '—'}</p>
                  {data?.budget > 0 && <p><span className="text-white">Budget:</span> ${data.budget.toLocaleString()}</p>}
                  {data?.revenue > 0 && <p><span className="text-white">Box office:</span> ${data.revenue.toLocaleString()}</p>}
                  {data?.spoken_languages?.length > 0 && <p><span className="text-white">Audio languages:</span> {data.spoken_languages.map((l) => l.english_name).join(', ')}</p>}
                  <p><span className="text-white">Watch servers:</span> AutoEmbed, VidSrc, SmashyStream, MultiEmbed, VidLink — each with dub tracks where available.</p>
                </div>
              )}

              {tab === 'more' && (
                <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-5">
                  {(similar.length ? similar : []).slice(0, 10).map((s) => (
                    <motion.button
                      key={`${s.media_type || type}-${s.id}`}
                      variants={item}
                      initial="hidden"
                      animate="show"
                      onClick={() => {
                        setData(null);
                        navigate(`/watch/${s.media_type || type}/${s.id}`);
                        onClose();
                      }}
                      className="group overflow-hidden rounded-xl border border-white/[0.06] transition-colors hover:border-primary/40"
                    >
                      <div className="aspect-[2/3]">
                        <SmartImage src={poster(s.poster_path)} alt={titleOf(s)} className="h-full w-full" fallbackLabel={titleOf(s)} />
                      </div>
                      <p className="truncate px-1.5 py-1.5 text-[11px] font-semibold text-textMain">{titleOf(s)}</p>
                    </motion.button>
                  ))}
                  {!similar.length && <p className="col-span-full py-6 text-center text-sm text-textMuted">Nothing similar indexed yet.</p>}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>
  );
}
