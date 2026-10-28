import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, ChevronRight, Film, Monitor, Play, Search, Users, Wand2 } from 'lucide-react';
import { tmdb } from '../lib/api';
import { DEFAULT_SERVER, embedServerIds, loadProviders } from '../lib/providers';
import { getPreferredServer, mediaTypeOf, poster, setPreferredServer, titleOf, yearOf } from '../lib/config';
import { item, rise, spring, stagger } from '../lib/motion';
import { Badge, SmartImage, toast } from '../components/ui';
import { LogoMark } from '../components/Logo3D';
import { createParty } from '../lib/party';
import { getUserName } from '../lib/config';

const YoutubeIcon = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s3.93.502 5.814 1.377a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
  </svg>
);

const TABS = [
  { id: 'library', label: 'ZenithFlix Library', icon: Film, hint: 'Pick from the live TMDB catalogue' },
  { id: 'youtube', label: 'YouTube', icon: YoutubeIcon, hint: 'Paste any YouTube link' },
  { id: 'screen', label: 'Screen Preview', icon: Monitor, hint: 'Local preview only — remote screen delivery is not implemented' },
];

const ytIdOf = (url) => url?.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1] || null;

function Picker({ label, value, onChange, options }) {
  return (
    <label className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-textMuted">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="rounded-lg border border-white/12 bg-black/60 px-2 py-1 text-[12px] font-semibold normal-case tracking-normal text-white outline-none focus:border-primary/50"
      >
        {options.map((o) => (
          <option key={o.value ?? o} value={o.value ?? o}>
            {o.label ?? o}
          </option>
        ))}
      </select>
    </label>
  );
}

/* ── TMDB picker ─────────────────────────────────────────────── */
function LibraryPicker({ picked, setPicked, season, setSeason, episode, setEpisode }) {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(true);
  const debounce = useRef(null);

  useEffect(() => {
    clearTimeout(debounce.current);
    let dead = false;
    setBusy(true);
    debounce.current = setTimeout(() => {
      const run = query.trim().length > 1 ? tmdb.search(query) : tmdb.feed('trending_day');
      run
        .then((r) => !dead && setRows(r || []))
        .catch(() => !dead && setRows([]))
        .finally(() => !dead && setBusy(false));
    }, query.trim() ? 300 : 0);
    return () => {
      clearTimeout(debounce.current);
      dead = true;
    };
  }, [query]);

  useEffect(() => {
    setSeason(1);
    setEpisode(1);
  }, [picked?.id, setSeason, setEpisode]);

  const type = picked ? mediaTypeOf(picked) : 'movie';

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        {busy ? (
          <span className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        ) : (
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-textMuted" />
        )}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={query ? 'Searching TMDB…' : 'Search a film or series, or pick from trending'}
          className="w-full rounded-xl border border-white/10 bg-black/45 py-3 pl-10 pr-3 text-sm text-white outline-none transition-colors placeholder:text-textMuted/60 focus:border-primary/50"
        />
      </div>

      <div className="no-scrollbar -mx-1 grid max-h-60 grid-cols-4 gap-2 overflow-y-auto px-1 sm:grid-cols-6">
        {rows.map((m, i) => {
          const active = !!picked && picked.id === m.id && mediaTypeOf(picked) === mediaTypeOf(m);
          return (
            <motion.button
              key={`${m.media_type}-${m.id}`}
              variants={item}
              initial="hidden"
              animate="show"
              whileHover={{ y: -4 }}
              transition={spring.snappy}
              onClick={() => setPicked(m)}
              className={`group relative overflow-hidden rounded-xl border text-left transition-colors ${
                active ? 'border-primary/70 shadow-glow-sm' : 'border-white/[0.07] hover:border-primary/40'
              }`}
            >
              <div className="aspect-[2/3]">
                <SmartImage src={poster(m.poster_path, 'face')} alt={titleOf(m)} className="h-full w-full" fallbackLabel={titleOf(m)} imgClassName="object-cover" loading={i > 10 ? 'lazy' : 'eager'} />
              </div>
              <p className="truncate px-1.5 pb-1 pt-1 text-[10px] font-semibold text-textMain">{titleOf(m)}</p>
              {active && (
                <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={spring.pop} className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-primary">
                  <Check className="h-3 w-3 text-white" />
                </motion.span>
              )}
            </motion.button>
          );
        })}
        {busy && rows.length === 0 && Array.from({ length: 8 }).map((_, i) => <div key={i} className="aspect-[2/3] rounded-xl shimmer" />)}
      </div>

      {picked && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={spring.soft} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <div className="flex gap-3">
            {picked.poster_path && <img src={poster(picked.poster_path, 'face')} alt="" className="h-16 w-11 rounded-lg object-cover" />}
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-sm font-bold text-white">{titleOf(picked)}</p>
              <p className="mt-0.5 text-[11px] text-textMuted">
                {type === 'tv' ? 'Series' : 'Film'} · {yearOf(picked) || '—'} · TMDB {picked.id}
              </p>
              {type === 'tv' && (
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <Picker label="Season" value={season} onChange={setSeason} options={Array.from({ length: 5 }, (_, i) => ({ value: i + 1, label: `S${i + 1}` }))} />
                  <Picker label="Episode" value={episode} onChange={setEpisode} options={Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: `E${i + 1}` }))} />
                </div>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}

/* ── main ─────────────────────────────────────────────────────── */
export default function GroupCreation() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('library');
  const [roomName, setRoomName] = useState('');
  const [picked, setPicked] = useState(null);
  const [season, setSeason] = useState(1);
  const [episode, setEpisode] = useState(1);
  const [ytUrl, setYtUrl] = useState('');
  const [server, setServer] = useState(getPreferredServer() || embedServerIds()[0] || DEFAULT_SERVER);
  const [servers, setServers] = useState([]);
  const [stream, setStream] = useState(null);
  const [label, setLabel] = useState('');
  const [creating, setCreating] = useState(false);
  const previewRef = useRef(null);

  useEffect(() => {
    loadProviders().then((r) => setServers(r.providers.filter((p) => p.kind === 'embed' || p.kind === 'proxy')));
  }, []);

  useEffect(() => {
    if (previewRef.current && stream) previewRef.current.srcObject = stream;
  }, [stream]);

  useEffect(() => () => stream?.getTracks().forEach((t) => t.stop()), [stream]);

  const yt = useMemo(() => ytIdOf(ytUrl), [ytUrl]);
  const ready = !creating && (tab === 'library' ? !!picked : tab === 'youtube' ? !!yt : false);

  const startShare = async () => {
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'always' }, audio: true, preferCurrentTab: true });
      setStream(s);
      const track = s.getVideoTracks()[0];
      setLabel(track?.label || 'Screen');
      track.addEventListener('ended', () => {
        setStream(null);
        setLabel('');
      });
    } catch {
      /* user dismissed the picker — that is fine */
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!ready) return;
    setCreating(true);
    try {
      const nowPlaying = tab === 'library'
        ? { type: mediaTypeOf(picked), tmdbId: picked.id, title: titleOf(picked), season, episode, provider: server, poster: picked.poster_path || null }
        : { type: 'movie', tmdbId: 0, title: 'YouTube', season: 1, episode: 1, provider: 'trailer', youtubeKey: yt };
      if (tab === 'library') setPreferredServer(server);
      const id = await createParty({ name: roomName.trim() || nowPlaying.title, username: getUserName() || 'Guest', nowPlaying });
      navigate(`/room/${id}`);
    } catch (error) {
      toast(error.message, { tone: 'warn', ttl: 6000 });
    } finally { setCreating(false); }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-background px-[4vw] pb-20 pt-[calc(var(--nav-h,94px)+16px)]">
      <div className="pointer-events-none absolute inset-0 cinema-grid opacity-70" />
      <motion.div initial={rise} animate="show" variants={stagger(0.02, 0.06)} className="relative mx-auto w-full max-w-2xl">
        <motion.div variants={item}>
          <button onClick={() => navigate(-1)} className="mb-4 flex items-center gap-1.5 text-[12px] font-bold text-textMuted transition-colors hover:text-white">
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </button>
        </motion.div>

        <motion.div variants={item} className="overflow-hidden rounded-3xl border border-white/[0.08] bg-white/[0.025] shadow-cinema backdrop-blur-xl">
          <div className="h-[3px] bg-ember-gradient" />
          <div className="p-6 sm:p-8">
            <motion.div variants={item} className="mb-6 flex items-start gap-3">
              <div className="relative">
                <LogoMark size={44} className="!rounded-2xl animate-float-idle" />
                <span className="absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full border border-white/15 bg-surfaceLift">
                  <Users className="h-3 w-3 text-primaryLight" />
                </span>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">Watch Party</p>
                <h1 className="mt-1 font-display text-[26px] font-extrabold leading-none tracking-tighter2 text-white">Open a theatre room</h1>
                <p className="mt-2 text-[13px] leading-relaxed text-textSub">Everyone in the room loads the same title, episode and server. Share the link, press start together.</p>
              </div>
            </motion.div>

            <form onSubmit={submit} className="flex flex-col gap-5">
              <motion.div variants={item}>
                <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.18em] text-textMuted">Room name</label>
                <input
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                  placeholder={picked ? titleOf(picked) : 'Friday night cinema'}
                  className="w-full rounded-xl border border-white/10 bg-black/45 px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-textMuted/55 focus:border-primary/50"
                />
              </motion.div>

              <motion.div variants={item} className="flex gap-1 rounded-2xl border border-white/[0.08] bg-black/35 p-1">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTab(t.id)}
                    className={`relative flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-[12px] font-bold transition-colors ${tab === t.id ? 'text-white' : 'text-textMuted hover:text-textSub'}`}
                  >
                    {tab === t.id && <motion.span layoutId="room-tab" className="absolute inset-0 rounded-xl bg-ember-gradient opacity-90" transition={spring.pop} />}
                    <t.icon className="relative h-3.5 w-3.5" />
                    <span className="relative">{t.label}</span>
                  </button>
                ))}
              </motion.div>

              <motion.p variants={item} className="-mt-2 text-[11.5px] text-textMuted">
                {TABS.find((t) => t.id === tab)?.hint}
              </motion.p>

              <AnimatePresence mode="wait">
                <motion.div key={tab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={spring.soft}>
                  {tab === 'library' && (
                    <LibraryPicker picked={picked} setPicked={setPicked} season={season} setSeason={setSeason} episode={episode} setEpisode={setEpisode} />
                  )}

                  {tab === 'youtube' && (
                    <div className="flex flex-col gap-3">
                      <div className="relative">
                        <YoutubeIcon className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-red-400" />
                        <input
                          value={ytUrl}
                          onChange={(e) => setYtUrl(e.target.value)}
                          placeholder="https://youtube.com/watch?v=…"
                          className="w-full rounded-xl border border-white/10 bg-black/45 py-3 pl-10 pr-3 text-sm text-white outline-none transition-colors placeholder:text-textMuted/55 focus:border-red-400/50"
                        />
                      </div>
                      {yt ? (
                        <div className="overflow-hidden rounded-2xl border border-white/10">
                          <div className="relative w-full aspect-video bg-black">
                            <iframe src={`https://www.youtube-nocookie.com/embed/${yt}?rel=0`} title="Preview" allow="autoplay; encrypted-media; picture-in-picture" className="absolute inset-0 h-full w-full border-0" />
                          </div>
                          <div className="flex items-center gap-2 border-t border-white/[0.07] bg-black/40 px-3 py-2">
                            <span className="h-1.5 w-1.5 animate-pulse-glow rounded-full bg-red-400" />
                            <span className="text-[11.5px] text-textSub">Ready to create — trailer sync requires a ready player API on each device.</span>
                          </div>
                        </div>
                      ) : (
                        ytUrl && <p className="text-[11.5px] text-gold">Paste a full YouTube link (youtube.com or youtu.be).</p>
                      )}
                    </div>
                  )}

                  {tab === 'screen' && (
                    <div className="flex flex-col gap-3">
                      {!stream ? (
                        <button
                          type="button"
                          onClick={startShare}
                          className="group flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-white/12 py-8 transition-colors hover:border-primary/50"
                        >
                          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/12 transition-colors group-hover:bg-primary/22">
                            <Monitor className="h-6 w-6 text-primary" />
                          </div>
                          <span className="font-display text-sm font-bold text-white">Share your screen</span>
                          <span className="text-[11.5px] text-textMuted">Chrome tab, window or the whole desktop — no extension needed</span>
                        </button>
                      ) : (
                        <div className="overflow-hidden rounded-2xl border border-lime/30 bg-black">
                          <video ref={previewRef} autoPlay muted className="max-h-52 w-full object-contain" />
                          <div className="flex items-center justify-between gap-3 px-3 py-2">
                            <span className="truncate text-[11.5px] text-lime">{label}</span>
                            <button type="button" onClick={() => stream.getTracks().forEach((t) => t.stop())} className="rounded-lg border border-white/12 px-2.5 py-1 text-[11px] font-bold text-textSub hover:text-white">
                              Stop
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>

              {tab === 'library' && picked && (
                <motion.div variants={item} className="rounded-2xl border border-white/[0.08] bg-black/35 p-3">
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-textMuted">Starting server</p>
                  <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
                    {servers.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => {
                          setServer(s.id);
                          setPreferredServer(s.id);
                        }}
                        className={`flex items-center gap-1.5 whitespace-nowrap rounded-xl border px-3 py-1.5 text-[11.5px] font-bold transition-colors ${
                          server === s.id ? 'border-primary/55 bg-primary/15 text-white' : 'border-white/10 text-textMuted hover:text-textSub'
                        }`}
                      >
                        {s.kind === 'proxy' && <Wand2 className="h-3 w-3" />}
                        {s.label.replace(/^Server \d+ · /, '')}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 flex items-center gap-1.5 text-[11px] text-textMuted">
                    <Badge tone="muted">Audio languages and resolutions are unverified</Badge>
                  </p>
                </motion.div>
              )}

              <motion.button
                variants={item}
                type="submit"
                disabled={!ready}
                whileHover={ready ? { scale: 1.015 } : undefined}
                whileTap={ready ? { scale: 0.985 } : undefined}
                transition={spring.snappy}
                className={`flex items-center justify-center gap-2 rounded-2xl py-4 font-display text-[15px] font-extrabold transition-all ${
                  ready ? 'bg-ember-gradient text-white shadow-glow-md hover:shadow-glow-lg' : 'cursor-not-allowed bg-white/[0.05] text-textMuted/50'
                }`}
              >
                <Play className="h-4 w-4 fill-white" />
                {creating ? 'Creating room…' : tab === 'screen' ? 'Local preview only' : 'Create Watch Party'}
                <ChevronRight className="h-4 w-4" />
              </motion.button>
            </form>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}
