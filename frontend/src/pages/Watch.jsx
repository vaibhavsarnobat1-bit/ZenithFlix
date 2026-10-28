import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Check, ChevronRight, Clock, Heart, Link2, Play, Plus, SkipForward, Users } from 'lucide-react';
import DetailSheet from '../components/DetailSheet';
import Player from '../components/Player';
import Row from '../components/Row';
import { tmdb } from '../lib/api';
import { IMG, ageRating, poster, ratingOf, runtimeLabel, saveProgress, titleOf, yearOf } from '../lib/config';
import { DEFAULT_SERVER, loadProviders } from '../lib/providers';
import { createParty } from '../lib/party';
import { getUserName } from '../lib/config';
import { usePrefs } from '../context/Prefs';
import { item, spring, stagger } from '../lib/motion';
import { Badge, EmptyState, RatingRing, SmartImage, toast } from '../components/ui';

export default function Watch() {
  const { type = 'movie', id } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { toggle, isInList } = usePrefs();

  const season = Number(params.get('season') || 1);
  const episode = Number(params.get('episode') || 1);
  const provider = params.get('provider') || null;
  const ytFromParams = params.get('yt');

  const [details, setDetails] = useState(null);
  const [similar, setSimilar] = useState([]);
  const [episodes, setEpisodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [server, setServer] = useState(provider);
  const [sheet, setSheet] = useState(null);
  const [creatingParty, setCreatingParty] = useState(false);

  useEffect(() => {
    loadProviders();
  }, []);

  /* metadata */
  useEffect(() => {
    let dead = false;
    setLoading(true);
    tmdb
      .details(type, id)
      .then((d) => !dead && setDetails(d))
      .catch(() => !dead && setDetails(null))
      .finally(() => !dead && setLoading(false));
    tmdb.similar(type, id).then((r) => !dead && setSimilar(r || [])).catch(() => {});
    return () => {
      dead = true;
    };
  }, [type, id]);

  /* episode list for the current season */
  useEffect(() => {
    if (type !== 'tv') {
      setEpisodes([]);
      return undefined;
    }
    let dead = false;
    tmdb
      .season(id, season)
      .then((d) => !dead && setEpisodes(d?.episodes || []))
      .catch(() => !dead && setEpisodes([]));
    return () => {
      dead = true;
    };
  }, [type, id, season]);

  const youtubeKey = useMemo(() => {
    const vids = (details?.videos?.results || []).filter((v) => v.site === 'YouTube');
    if (ytFromParams) return ytFromParams;
    const rank = (v) => (v.type === 'Trailer' ? 0 : v.type === 'Teaser' ? 1 : 3) + (v.official ? 0 : 1);
    return [...vids].sort((a, b) => rank(a) - rank(b))[0]?.key || null;
  }, [details, ytFromParams]);

  const label = titleOf(details) || `Title ${id}`;

  /* remember where the viewer was */
  useEffect(() => {
    if (!details) return;
    saveProgress(
      { id: Number(id), media_type: type, title: details.title, name: details.name, poster_path: details.poster_path, backdrop_path: details.backdrop_path, vote_average: details.vote_average, release_date: details.release_date, first_air_date: details.first_air_date },
      { season, episode, provider: server || DEFAULT_SERVER }
    );
  }, [details, id, type, season, episode, server]);

  const goto = useCallback(
    (next) => {
      const merged = new URLSearchParams(params);
      Object.entries(next).forEach(([k, v]) => (v == null ? merged.delete(k) : merged.set(k, String(v))));
      setParams(merged, { replace: false });
    },
    [params, setParams]
  );

  const playEpisode = (s, e) => goto({ season: s, episode: e });

  const nextEpisode = useMemo(() => {
    if (type !== 'tv') return null;
    const eNext = episodes.find((e) => e.episode_number === episode + 1);
    if (eNext) return { season, episode: eNext.episode_number, name: eNext.name };
    return { season: season + 1, episode: 1, name: 'Next season' };
  }, [episodes, episode, season, type]);

  const openParty = async () => {
    if (creatingParty) return;
    setCreatingParty(true);
    try {
      const roomId = await createParty({ name: label, username: getUserName() || 'Guest', nowPlaying: {
        type, tmdbId: Number(id), title: label, season, episode,
        provider: server || DEFAULT_SERVER, youtubeKey, poster: details?.poster_path || null,
      } });
      navigate(`/room/${roomId}`);
    } catch (error) {
      toast(error.message, { tone: 'warn', ttl: 6000 });
    } finally {
      setCreatingParty(false);
    }
  };

  const copyInvite = async () => {
    const url = `${window.location.origin}/watch/${type}/${id}?${params.toString()}`;
    try {
      await navigator.clipboard.writeText(url);
      toast('Watch link copied');
    } catch {
      toast('Clipboard blocked by the browser', { tone: 'warn' });
    }
  };

  const saved = isInList(String(id));
  const toggleSave = () => {
    const added = toggle({ id: Number(id), media_type: type, title: details?.title, name: details?.name, poster_path: details?.poster_path, backdrop_path: details?.backdrop_path, vote_average: details?.vote_average, release_date: details?.release_date, first_air_date: details?.first_air_date });
    toast(added ? `${label} added to My List` : `${label} removed`);
  };

  if (loading && !details) {
    return (
      <div className="min-h-screen bg-background px-[4vw] pb-16 pt-28">
        <div className="shimmer mx-auto aspect-video max-w-[1100px] rounded-2xl" />
        <div className="mx-auto mt-5 max-w-[1100px] space-y-3">
          <div className="shimmer h-7 w-1/2 rounded-lg" />
          <div className="shimmer h-4 w-3/4 rounded-lg" />
          <div className="shimmer h-4 w-2/3 rounded-lg" />
        </div>
      </div>
    );
  }

  if (!details) {
    return (
      <div className="min-h-screen bg-background pt-32">
        <EmptyState
          icon={Play}
          title="We could not load this title"
          hint="The TMDB proxy did not answer. Check that the backend is running on port 5000 and that TMDB_API_KEY is set."
          action={
            <button onClick={() => navigate('/')} className="rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-white hover:bg-primaryLight">
              Back to catalogue
            </button>
          }
        />
      </div>
    );
  }

  const age = ageRating(details);
  const rating = ratingOf(details.vote_average);

  return (
    <div className="min-h-screen bg-background pb-20 pt-[calc(var(--nav-h,94px)+14px)]">
      <div className="film-grain relative">
        <div className="absolute inset-0 bg-[radial-gradient(900px_340px_at_50%_0%,rgba(255,46,85,0.13),transparent_70%)]" />

        <div className="relative mx-auto max-w-[1160px] px-4 pb-6 pt-4 sm:px-6">
          {/* header */}
          <motion.div variants={stagger(0, 0.06)} initial="hidden" animate="show" className="mb-4 flex flex-wrap items-center gap-3">
            <motion.button
              variants={item}
              whileHover={{ x: -3 }}
              onClick={() => navigate(-1)}
              className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[12.5px] font-bold text-textSub hover:text-white"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </motion.button>

            <div className="min-w-0 flex-1">
              <AnimatePresence mode="wait">
                <motion.h1
                  key={`${label}-${season}-${episode}`}
                  initial={{ opacity: 0, y: 10, filter: 'blur(6px)' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={spring.soft}
                  className="truncate font-display text-[19px] font-extrabold tracking-tighter2 text-white sm:text-[23px]"
                >
                  {label}
                  {type === 'tv' && (
                    <span className="ml-2 text-[13px] font-bold tabular text-primaryLight">
                      S{season} · E{episode}
                    </span>
                  )}
                </motion.h1>
              </AnimatePresence>
              <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[11.5px] text-textMuted">
                <span className="tabular">{yearOf(details)}</span>
                {age && <Badge tone="gold">{age}</Badge>}
                <Badge tone="muted">Quality unverified</Badge>
                {details.original_language && <Badge tone="violet">{details.original_language.toUpperCase()} · TMDB title language</Badge>}
                {rating && <span className="tabular text-gold">{rating}/10</span>}
                {details.number_of_seasons && <span>{details.number_of_seasons} season{details.number_of_seasons > 1 ? 's' : ''}</span>}
                {details.runtime && <span className="tabular">{runtimeLabel(details.runtime)}</span>}
              </p>
            </div>

            <motion.div variants={item} className="flex items-center gap-2">
              <button onClick={toggleSave} className={`flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-[12.5px] font-bold transition-colors ${saved ? 'border-lime/45 bg-lime/12 text-lime' : 'border-white/12 bg-white/[0.04] text-textSub hover:text-white'}`}>
                {saved ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />} My List
              </button>
              <button onClick={copyInvite} className="grid h-9 w-9 place-items-center rounded-xl border border-white/12 text-textSub hover:text-white" title="Copy link">
                <Link2 className="h-3.5 w-3.5" />
              </button>
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                transition={spring.snappy}
                onClick={openParty}
                disabled={creatingParty}
                className="flex items-center gap-2 rounded-xl border border-secondary/45 bg-secondary/15 px-4 py-2 text-[12.5px] font-bold text-white hover:bg-secondary/25"
              >
                <Users className="h-3.5 w-3.5" /> {creatingParty ? 'Creating…' : 'Create Watch Party'}
              </motion.button>
            </motion.div>
          </motion.div>

          {/* the player */}
          <motion.div initial={{ opacity: 0, y: 24, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ ...spring.soft, duration: 0.5 }}>
            <Player
              tmdbId={id}
              type={type}
              season={season}
              episode={episode}
              provider={server || provider}
              onProviderChange={setServer}
              youtubeKey={youtubeKey}
              title={`${label}${type === 'tv' ? ` S${season}E${episode}` : ''}`}
            />
          </motion.div>

          {/* next episode / status strip */}
          <AnimatePresence>
            {type === 'tv' && nextEpisode && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={spring.soft}
                className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-3"
              >
                <span className="flex items-center gap-2 text-[12px] font-semibold text-textSub">
                  <Clock className="h-3.5 w-3.5 text-primary" />
                  Up next · {nextEpisode.name}
                </span>
                <button
                  onClick={() => playEpisode(nextEpisode.season, nextEpisode.episode)}
                  className="ml-auto flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-[12.5px] font-bold text-white hover:bg-primaryLight"
                >
                  <SkipForward className="h-3.5 w-3.5" /> Play next episode
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* meta grid */}
          <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
            <div>
              <p className="text-[14.5px] leading-relaxed text-textMain">{(details.overview || '').trim() || 'No synopsis available yet.'}</p>

              <div className="mt-4 flex flex-wrap gap-2 text-[11.5px] text-textMuted">
                {(details.genres || []).map((g) => (
                  <button
                    key={g.id}
                    onClick={() => navigate(`/catalog/${type}?genre=${g.id}`)}
                    className="rounded-full border border-white/10 bg-white/[0.035] px-3 py-1 font-semibold text-textSub transition-colors hover:border-primary/40 hover:text-white"
                  >
                    {g.name}
                  </button>
                ))}
              </div>

              {details.credits?.cast?.length > 0 && (
                <div className="mt-6">
                  <h3 className="mb-2.5 text-[10px] font-bold uppercase tracking-[0.18em] text-textMuted">Top billed</h3>
                  <motion.div variants={stagger(0, 0.04)} initial="hidden" whileInView="show" viewport={{ once: true }} className="no-scrollbar flex gap-3 overflow-x-auto pb-1">
                    {details.credits.cast.slice(0, 14).map((c) => (
                      <motion.div key={c.id} variants={item} className="w-[86px] flex-shrink-0 text-center">
                        <div className="h-[86px] w-[86px] overflow-hidden rounded-2xl border border-white/10">
                          <SmartImage src={c.profile_path ? `${IMG.face}${c.profile_path}` : null} alt={c.name} className="h-full w-full rounded-2xl" fallbackLabel={c.name?.[0]} />
                        </div>
                        <p className="mt-1.5 line-clamp-2 text-[10.5px] font-semibold leading-tight text-textMain">{c.name}</p>
                        <p className="mt-0.5 line-clamp-1 text-[10px] text-textMuted">{c.character}</p>
                      </motion.div>
                    ))}
                  </motion.div>
                </div>
              )}

              {type === 'tv' && (
                <div className="mt-8">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <h3 className="font-display text-[15px] font-bold text-white">Episodes</h3>
                    <div className="no-scrollbar ml-auto flex gap-1.5 overflow-x-auto">
                      {Array.from({ length: details.number_of_seasons || 1 }, (_, i) => i + 1)
                        .filter((s) => s <= (details.number_of_seasons || 1))
                        .map((s) => (
                          <button
                            key={s}
                            onClick={() => playEpisode(s, 1)}
                            className={`whitespace-nowrap rounded-lg border px-3 py-1.5 text-[12px] font-bold transition-colors ${
                              s === season ? 'border-primary/50 bg-primary/18 text-white' : 'border-white/10 bg-white/[0.03] text-textMuted hover:text-white'
                            }`}
                          >
                            Season {s}
                          </button>
                        ))}
                    </div>
                  </div>

                  <motion.div key={`eps-${season}`} variants={stagger(0, 0.04)} initial="hidden" animate="show" className="space-y-2.5">
                    {episodes.map((e) => {
                      const current = e.episode_number === episode;
                      return (
                        <motion.button
                          key={e.id}
                          variants={item}
                          onClick={() => playEpisode(season, e.episode_number)}
                          className={`group flex w-full gap-3 rounded-2xl border p-2.5 text-left transition-all ${
                            current ? 'border-primary/45 bg-primary/[0.09] shadow-glow-sm' : 'border-white/[0.06] bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.05]'
                          }`}
                        >
                          <div className="relative aspect-video w-[140px] flex-shrink-0 overflow-hidden rounded-xl sm:w-[180px]">
                            <SmartImage src={poster(e.still_path, 'still')} alt={e.name} className="h-full w-full rounded-xl" fallbackLabel={`E${e.episode_number}`} />
                            <span className={`absolute inset-0 grid place-items-center bg-black/55 transition-opacity ${current ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                              <Play className="h-6 w-6 fill-white text-white" />
                            </span>
                          </div>
                          <div className="min-w-0 flex-1 py-1">
                            <div className="flex items-baseline gap-2">
                              <span className="tabular text-[12px] font-extrabold text-textMuted">{e.episode_number}</span>
                              <span className={`truncate text-[13.5px] font-bold ${current ? 'text-primaryLight' : 'text-white'}`}>{e.name}</span>
                              {e.runtime ? <span className="ml-auto tabular text-[10.5px] text-textMuted">{e.runtime}m</span> : null}
                            </div>
                            <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-textSub">{e.overview}</p>
                            <div className="mt-1.5 flex items-center gap-2 text-[10.5px] tabular text-textMuted">
                              {e.air_date}
                              {e.vote_average ? <span className="text-gold">{e.vote_average.toFixed(1)} ★</span> : null}
                              {current && <Badge tone="ember">Now playing</Badge>}
                            </div>
                          </div>
                        </motion.button>
                      );
                    })}
                    {!episodes.length && <p className="text-sm text-textMuted">TMDB has no episodes for season {season} yet.</p>}
                  </motion.div>
                </div>
              )}
            </div>

            {/* side rail */}
            <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
              <div className="overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.025]">
                <motion.div layoutId={`poster-${type}-${id}`} className="aspect-[2/3] w-full">
                  <SmartImage src={poster(details.poster_path, 'poster2x')} alt={label} className="h-full w-full" fallbackLabel={label} />
                </motion.div>
                <div className="flex items-center gap-3 p-3">
                  <RatingRing value={Number(details.vote_average || 0)} size={42} />
                  <div className="text-[11px] leading-snug text-textMuted">
                    <div className="font-bold text-textMain">{details.vote_count?.toLocaleString?.() || 0} votes</div>
                    <div>{details.status}</div>
                    {details.number_of_episodes && <div className="tabular">{details.number_of_episodes} episodes</div>}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
                <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-textMuted">
                  <Heart className="h-3 w-3 text-primary" /> Facts
                </div>
                <dl className="space-y-1.5 text-[12px] leading-relaxed">
                  <div><dt className="inline text-textMuted">Director </dt><dd className="inline text-textSub">{(details.credits?.crew || []).filter((c) => c.job === 'Director').map((c) => c.name).slice(0, 2).join(', ') || '—'}</dd></div>
                  <div><dt className="inline text-textMuted">Studio </dt><dd className="inline text-textSub">{(details.production_companies || []).slice(0, 2).map((p) => p.name).join(', ') || '—'}</dd></div>
                  <div><dt className="inline text-textMuted">Country </dt><dd className="inline text-textSub">{(details.production_countries || []).map((c) => c.name).join(', ') || '—'}</dd></div>
                  <div><dt className="inline text-textMuted">Languages </dt><dd className="inline text-textSub">{(details.spoken_languages || []).slice(0, 4).map((l) => l.english_name).join(', ') || '—'}</dd></div>
                </dl>
              </div>

              <div className="rounded-2xl border border-primary/25 bg-primary/[0.07] p-4">
                <div className="mb-1.5 font-display text-[13.5px] font-bold text-white">Watch with friends</div>
                <p className="text-[12px] leading-relaxed text-textSub">
                  Creates a room with this title, server and episode. Copy the invitation inside the room. Opaque iframe playback supports cues only; remote friends need a public HTTPS deployment.
                </p>
                <button onClick={openParty} disabled={creatingParty} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-white py-2.5 text-[12.5px] font-bold text-black hover:bg-primaryLight">
                  <Users className="h-3.5 w-3.5" /> {creatingParty ? 'Creating…' : 'Create Watch Party'}
                </button>
              </div>

              <button onClick={() => navigate(`/catalog/${type}`)} className="flex w-full items-center justify-between rounded-2xl border border-white/[0.07] bg-white/[0.025] px-4 py-3 text-[12.5px] font-bold text-textSub hover:border-primary/35 hover:text-white">
                More {type === 'tv' ? 'series' : 'movies'} <ChevronRight className="h-4 w-4" />
              </button>
            </aside>
          </div>
        </div>
      </div>

      <Row headline="More like this" name="similar" items={similar} onOpen={(t, sid) => setSheet({ ...t, _sharedId: sid })} />

      <AnimatePresence>{sheet && <DetailSheet item={sheet} onClose={() => setSheet(null)} />}</AnimatePresence>
    </div>
  );
}
