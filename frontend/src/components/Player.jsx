import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, Check, Expand, Gauge, Loader, Maximize, Minimize, RefreshCw, Server, Shield, SkipForward, Sliders, Users, Volume2, Wand2 } from 'lucide-react';
import { buildSource, loadDubs, loadProviders, loadHealth, providersSync, findProvider, DEFAULT_SERVER } from '../lib/providers';
import { iframeAudioState, iframeQualityState } from '../lib/audio';
import { DirectHlsPlayer } from '../lib/hlsPlayer';
import { applyYouTubeSync, loadYouTubeApi } from '../lib/youtube';
import { getPreferred, getPreferredServer, setPreferred, setPreferredServer } from '../lib/config';
import { useForeignScrollGuard } from '../lib/scroll';
import { spring, stagger } from '../lib/motion';
import { Badge, Spinner, toast } from './ui';
import PlaybackPanel from './PlaybackPanel';

const STARTUP_BUDGET_MS = 13000;
const YT_REASON = {
  2: 'the trailer id was malformed',
  5: 'the trailer is not playable in this player',
  100: 'that trailer is no longer on YouTube',
  101: 'the rights holder blocked embedding',
  150: 'the rights holder blocked embedding',
  153: 'YouTube could not verify the embedding origin or referrer',
  203: "YouTube's servers could not deliver the trailer",
};
/**
 * A cross-origin embed never tells us whether a video actually started, and its
 * `load` event fires even when it rendered a "title not found" page. So once a
 * frame has answered, we wait this long before pushing the manual "switch
 * server" control into the viewer's face — we never reroute a loaded frame on
 * our own, because that would interrupt a stream that is working fine.
 */
const SILENT_FRAME_BUDGET_MS = 14000;

/** These are server-ranking preferences, never observed stream resolutions. */
const QUALITY_SHORT = { '1080': 'Prefer HD servers', '4k': 'Prefer 4K servers' };

/** Default preference for advertised HD servers; never a stream-quality claim. */
const DEFAULT_QUALITY = '1080';

/**
 * What a caged frame is still allowed to do.
 *
 * `allow-popups` is deliberately absent, and that absence is the whole point: an
 * iframe sandboxed without it cannot open a tab or a window, at browser level, in
 * any browser, with no extension installed. That kills the popunder that appears
 * the moment a film starts. Everything a player legitimately needs stays —
 * scripts, its own storage, forms, its modal, pointer lock for the theatre view.
 * What is also gone is the host's ability to detect the cage and sulk, which is
 * why only servers flagged `sandboxOk` (no sandbox sniffing in their own page)
 * ever get framed like this.
 */
const CAGE = 'allow-scripts allow-same-origin allow-forms allow-modals allow-pointer-lock allow-orientation-lock allow-popups allow-popups-to-escape-sandbox';

/**
 * The watch player.
 *
 * Nothing here can confirm a third-party iframe actually started a video — the
 * cross-origin document gives us no such event — so the honest model is:
 *   1. the backend health probe picks a server that is alive right now,
 *   2. onLoad tells us *something* answered,
 *   3. a watchdog auto-advances the server list if nothing answers,
 *   4. "Nothing playing? Switch server" hands the choice to the viewer.
 */
export default function Player({
  tmdbId,
  type = 'movie',
  season = 1,
  episode = 1,
  provider,
  onProviderChange,
  youtubeKey,
  title = '',
  compact = false,
  party = null,
  follow = false,
  sync = null,
  onPlaybackStatus,
}) {
  /**
   * The last server a viewer used is where the next title starts — with one
   * exception. An "+ AdShield" twin is an experiment for *this* stream, not a
   * permanent setting: several hosts lock their player to their own referrer and
   * answer 404 once we rewrite the document, so restoring a twin as the default
   * quietly strands every future title on a black rectangle. Letting the health
   * probe pick instead means the next opening lands on a direct embed again, and
   * the twin stays one tap away.
   */
  const preferredServer = () => {
    const saved = getPreferredServer();
    if (!saved) return null;
    return findProvider(saved)?.kind === 'proxy' ? null : saved;
  };
  const [localServer, setServer] = useState(provider || preferredServer() || DEFAULT_SERVER);
  // Party source changes render only after an authoritative server snapshot.
  const server = party && provider ? provider : localServer;

  const [ready, setReady] = useState(false);
  const [nudge, setNudge] = useState(false);
  const [failed, setFailed] = useState(false);
  const [ytError, setYtError] = useState(null);
  const [triedIds, setTriedIds] = useState([]);
  const [frameKey, setFrameKey] = useState(0);
  const [theater, setTheater] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [providers, setProviders] = useState(providersSync());
  const [health, setHealth] = useState(null);
  const [dubs, setDubs] = useState(null);
  const [panel, setPanel] = useState(false);
  // Ignore the legacy zf.pref.lang: no iframe API acknowledges an active track.
  const [quality, setQualityState] = useState(() => {
    const saved = getPreferred('quality', DEFAULT_QUALITY);
    return ['auto', '1080', '4k'].includes(saved) ? saved : DEFAULT_QUALITY;
  });
  const [subsOnly, setSubsOnlyState] = useState(() => getPreferred('subs', false));
  /** Pop-under guard, on by default: an ad tab is not a price of watching here. */
  const [blockPopups, setBlockPopupsState] = useState(() => getPreferred('popups', true));
  const wrapRef = useRef(null);
  const frameRef = useRef(null);
  const videoRef = useRef(null);
  const hlsPlayerRef = useRef(null);
  const rootRef = useRef(null);
  const autoPicked = useRef(Boolean(provider) || Boolean(preferredServer()));
  const [hlsAudioState, setHlsAudioState] = useState(null);
  const [hlsQualityState, setHlsQualityState] = useState(null);

  /* Server preferences survive reload; active audio/quality cannot be persisted. */
  const setQuality = (q) => {
    setQualityState(q);
    setPreferred('quality', q);
  };
  const setSubsOnly = (on) => {
    setSubsOnlyState(on);
    setPreferred('subs', on);
  };
  const setBlockPopups = (on) => {
    setBlockPopupsState(on);
    setPreferred('popups', on);
  };

  /* registry */
  useEffect(() => {
    let dead = false;
    loadProviders().then((r) => !dead && setProviders(r.providers));
    loadHealth().then((h) => {
      if (dead) return;
      setHealth(h);
      // Nobody chose explicitly → start on a server the backend says is alive,
      // instead of burning 13s on a dead host every single time. Direct embeds
      // win over AdShield twins for the same reason the watchdog does.
      if (!autoPicked.current && h?.working?.length) {
        const rank = (id) => (findProvider(id)?.kind === 'embed' ? 0 : 1);
        const usable = [...h.working]
          .sort((a, b) => rank(a) - rank(b))
          .find((id) => buildSource(id, { tmdbId, type, season, episode, youtubeKey }).ok);
        if (usable) {
          autoPicked.current = true;
          setServer(usable);
          onProviderChange?.(usable);
        }
      }
    });
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Title-language metadata is catalogue information, not a track manifest. */
  useEffect(() => {
    let dead = false;
    setDubs(null);
    loadDubs(type, tmdbId).then((d) => !dead && setDubs(d));
    return () => {
      dead = true;
    };
  }, [type, tmdbId]);

  /* respect an externally-changed server (watch party, saved preference) */
  useEffect(() => {
    if (provider && provider !== server) setServer(provider);
  }, [provider]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * A saved preference or an old room link can name a server we have since
   * dropped from the registry. Landing on an unknown id would show a failure
   * panel, so swap it for a real one and let the health probe refine the choice.
   */
  useEffect(() => {
    if (!providers.length || providers.some((p) => p.id === server)) return;
    const first = providers.find((p) => p.kind === 'embed') || providers.find((p) => p.kind === 'proxy');
    if (!first) return;
    autoPicked.current = false;
    setServer(first.id);
    onProviderChange?.(first.id);
  }, [providers, server]); // eslint-disable-line react-hooks/exhaustive-deps

  const source = buildSource(server, { tmdbId, type, season, episode, youtubeKey });
  // Derived from THIS source on every render: no stale selected-language state
  // can survive a server change, episode change or reload.
  const audioState = source.kind === 'hls' && hlsAudioState ? hlsAudioState : iframeAudioState(source);
  const qualityState = source.kind === 'hls' && hlsQualityState ? hlsQualityState : iframeQualityState(source);

  /**
   * The pop-under guard, resolved up here because both the iframe and the
   * watchdog need it: a frame sandboxed without `allow-popups` cannot open a tab,
   * and if one never answers we un-cage that same server before walking away from
   * it. `cageOff` is the one-shot escape described at the watchdog.
   */
  const [cageOff, setCageOff] = useState(false);
  const cageActive = findProvider(server);
  const cage = blockPopups && source.kind === 'embed' && !cageOff;

  /**
   * Anchor the scroll guard on the whole player block — not just the frame — so
   * the Playback trigger above it stays on screen too. Cross-origin embeds are
   * allowed to scroll our window, and several of their ad scripts do exactly
   * that, which is how a watch page ends up 4,000 pixels below the player while
   * the viewer sees a black box. YouTube never does this, so the guard only arms
   * for embeds and sanitized proxies.
   */
  const playerEl = useCallback(() => rootRef.current, []);
  useForeignScrollGuard(source.kind === 'embed' || source.kind === 'proxy', playerEl);

  /**
   * Shared fallback order for manual switches and the watchdog. Health measures
   * host reachability/frameability, not actual title playback. Subtitle and
   * quality preferences use advertised metadata, never observed media tracks.
   * Direct embeds precede proxies because sanitization can break a working host.
   */
  const serverRing = useCallback(
    (fromId) => {
      const dead = (id) => health?.servers?.[id]?.ok === false;
      const playable = providers.filter((p) => p.kind === 'embed' || p.kind === 'proxy');

      // Registry language claims cannot filter the playback ring. No selected
      // source has an observed audio-track list.
      const subsPool = playable.filter((p) => !subsOnly || p.subs);
      const list = subsPool.length ? subsPool : playable;
      const direct = list.filter((p) => p.kind === 'embed').map((p) => p.id);
      const sanitized = list.map((p) => p.id).filter((id) => !direct.includes(id));
      // Direct embeds win the chain; proxies only when nothing else is left.
      const pool = direct.length ? direct : [...direct, ...sanitized];
      const want = quality === '4k' ? 3 : quality === '720' || quality === '1080' ? 2 : 0;
      const meets = (id) => (findProvider(id)?.tier || 1) >= want;
      /**
       * Quality is a preference with teeth.
       *
       * Sorting HD-first left 720p-only hosts in the ring, so a viewer who asked
       * for Full HD still got bounced onto one the moment the top servers were
       * busy. Now the sub-HD hosts are dropped from the ring entirely — but only
       * while at least two servers still qualify. Below that the ceiling stops
       * being a filter and goes back to being a sort order, because a viewer with
       * one HD host left is better off watching it than reading "no server could
       * start this title" on three hosts we never tried.
       */
      const ceilinged = want > 0 ? pool.filter(meets) : pool;
      const qualityRing = ceilinged.length >= 2 ? ceilinged : pool;
      /**
       * The pop-under guard is a preference with the same teeth.
       *
       * A server we can cage (no sandbox sniffing in its page) cannot open an ad
       * tab at all, so with the guard on it is worth more than a host that plays
       * an ad-free-looking frame while firing three domains in the background.
       * An AdShield twin counts as satisfied too — its document is ours and its
       * `window.open` is already overridden. Same escape hatch as quality: if
       * fewer than two servers survive, the guard stops filtering and only sorts,
       * because "no server could start this title" is a worse outcome than an ad.
       */
      const cageOk = (id) => {
        const p = findProvider(id);
        return Boolean(p && (p.kind === 'proxy' || p.sandboxOk));
      };
      const caged = blockPopups ? qualityRing.filter(cageOk) : qualityRing;
      const ring = caged.length >= 2 ? caged : qualityRing;
      const proven = (health?.working || []).filter((id) => ring.includes(id) && !dead(id));
      const rest = ring.filter((id) => !dead(id) && !proven.includes(id));
      // Prefer configured sandbox compatibility and advertised HD ceilings,
      // preserving the reachability ordering inside each group.
      const score = (id) => Number(meets(id)) + (blockPopups && cageOk(id) ? 0.5 : 0);
      const order = [...proven, ...rest].sort((a, b) => score(b) - score(a));
      const cur = fromId || server;
      const at = order.indexOf(cur);
      // Rotate beyond the current server; exhausted history offers explicit
      // retry rather than endlessly bouncing between the same two hosts.
      const seq = at === -1 ? order : [...order.slice(at + 1), ...order.slice(0, at)];
      return { order, seq, cur };
    },
    [providers, health, server, quality, subsOnly, blockPopups]
  );

  const advance = useCallback(
    (fromId, restart = false) => {
      const { seq, cur } = serverRing(fromId);
      for (const candidate of seq) {
        if (candidate === cur || (!restart && triedIds.includes(candidate))) continue;
        if (!buildSource(candidate, { tmdbId, type, season, episode, youtubeKey }).ok) continue;
        setServer(candidate);
        onProviderChange?.(candidate);
        setTriedIds((t) => [...new Set([...t, candidate])]);
        return candidate;
      }
      return null;
    },
    [serverRing, tmdbId, type, season, episode, youtubeKey, onProviderChange, triedIds]
  );

  // Stop an exhausted chain, without inferring that a title or track is absent.
  const switchServer = useCallback(() => {
    const { order } = serverRing(server);
    const seen = new Set([...triedIds, server]);
    if (order.length && order.every((id) => seen.has(id))) {
      setFailed(true);
      return;
    }
    if (!advance(server)) setFailed(true);
  }, [advance, serverRing, server, triedIds]);

  // Only explicit subtitle/guard preference changes may reroute the current
  // source. Audio is never routed using guessed languages or URL parameters.
  useEffect(() => {
    if (follow || !providers.length) return;
    const cur = providers.find((p) => p.id === server);
    if (!cur || cur.kind === 'trailer') return;
    const cageOk = (p) => Boolean(p && (p.kind === 'proxy' || p.sandboxOk));
    const brokeSubs = subsOnly && !cur.subs;
    const brokeCage = blockPopups && !cageOk(cur);
    if (!brokeSubs && !brokeCage) return;
    const { order } = serverRing(server);
    const best = brokeCage ? order.find((id) => cageOk(findProvider(id))) : order[0];
    if (best && best !== server) {
      setServer(best);
      setTriedIds((t) => [...new Set([...t, best])]);
      onProviderChange?.(best);
      toast('Moved to a server matching your playback preferences');
    }
    // Only a user changing these preferences should interrupt playback.
  }, [subsOnly, blockPopups]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setTriedIds([]);
  }, [tmdbId, type, season, episode]);

  /**
   * Watchdog.
   *
   * Both budgets are driven by one 1-second ticker rather than a pair of
   * setTimeouts. A timer armed in an effect is only as fresh as the closure that
   * armed it — `ready` had to be read through the render that scheduled it, and
   * any re-arm race silently cancelled the reroute, which is how a hung embed
   * ended up stuck on screen. Deadlines in refs plus a tick cannot go stale.
   */
  const readyRef = useRef(false);
  const startBy = useRef(0);
  const silentBy = useRef(0);
  const nudged = useRef(false);
  // Existing one-shot uncaged retry for a nonloading iframe. Compatibility is
  // not guaranteed, and the visible guard badge follows the actual cage state.
  const cageTried = useRef(false);
  /**
   * Which frame the deadlines below belong to.
   *
   * `health` resolves a beat after first paint, and every dependency change used
   * to clear readiness and re-arm the startup budget — including the ones that
   * do not touch the frame at all. A frame that had already answered was then
   * declared silent 13 s later: it lost its ad cage mid-film, or worse, the
   * watchdog walked away from a stream that was playing. Only a real change of
   * source (server, reload counter, cage state, URL) may re-arm these refs.
   */
  const armedFor = useRef('');

  useEffect(() => {
    cageTried.current = false;
    setCageOff(false);
  }, [server]);

  const frameId = `${server}|${frameKey}|${cage ? 'caged' : 'open'}|${source.url}`;
  useEffect(() => {
    // The backend already knows this host is dead or refuses framing. An iframe
    // pointed at it still fires onLoad — with a browser error page — which is
    // exactly how the player ends up as a permanent black rectangle. Skip it.
    const knownDead = !follow && server !== 'trailer' && health?.servers?.[server]?.ok === false;

    if (armedFor.current === frameId) {
      // Same frame, only health or parent state changed: fail fast on a host we
      // now know is dead, but never take readiness away from an answered frame.
      if (knownDead && !readyRef.current) {
        startBy.current = Math.min(startBy.current || Infinity, Date.now() + 450);
      }
      return;
    }
    armedFor.current = frameId;

    readyRef.current = false;
    nudged.current = false;
    silentBy.current = 0;
    setReady(false);
    setNudge(false);
    setYtError(null);
    setFailed(!source.ok);
    if (!source.ok) return;

    startBy.current = Date.now() + (knownDead ? 450 : STARTUP_BUDGET_MS);
  }, [frameId, source.ok, follow, server, health]);

  useEffect(() => {
    const tick = setInterval(() => {
      if (follow) return;
      const now = Date.now();
      if (!readyRef.current) {
        if (startBy.current && now > startBy.current) {
          startBy.current = 0;
          if (cage && !cageTried.current) {
            // The guard is on and nothing came back at all: retry this same
            // server uncaged before walking the chain.
            cageTried.current = true;
            setCageOff(true);
            setFrameKey((k) => k + 1);
            return;
          }
          if (!advance()) setFailed(true);
        }
        return;
      }
      if (!nudged.current && silentBy.current && now > silentBy.current) {
        nudged.current = true;
        setNudge(true);
      }
    }, 1000);
    return () => clearInterval(tick);
  }, [follow, advance, cage]);


  useEffect(() => {
    const onFs = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  /**
   * YouTube is the one source that talks back. Its iframe API posts an onError
   * event to us, which is a real "this will never play" signal — so a blocked or
   * removed trailer reroutes to a live embed server instead of freezing on
   * "Video unavailable". The embed hosts are cross-origin and stay silent.
   */
  // Real transport commands and measured telemetry are available only through
  // the official ready YouTube API. Opaque movie frames remain cue-only.
  const youtubePlayer = useRef(null);
  const youtubeReady = useRef(false);
  const pendingSync = useRef(sync);
  const playbackCallback = useRef(onPlaybackStatus);
  const errorAdvance = useRef(advance);
  const followRef = useRef(follow);
  playbackCallback.current = onPlaybackStatus;
  errorAdvance.current = advance;
  followRef.current = follow || Boolean(party);

  useEffect(() => {
    pendingSync.current = sync;
    if (server === 'trailer' && youtubeReady.current) {
      applyYouTubeSync(youtubePlayer.current, sync);
    }
  }, [sync, server]);

  useEffect(() => {
    let disposed = false;
    let instance = null;
    let telemetry = null;
    let autoplayBlocked = false;
    let playbackError = null;
    youtubeReady.current = false;
    youtubePlayer.current = null;
    playbackCallback.current?.({ ready: false, currentTime: null, isPlaying: false, buffering: false });
    if (server !== 'trailer' || !source.ok) return undefined;
    const frame = frameRef.current;
    const report = () => {
      if (disposed || !youtubeReady.current || !instance || playbackError) return;
      const state = instance.getPlayerState();
      if (state === 1) autoplayBlocked = false;
      playbackCallback.current?.({
        ready: true,
        currentTime: instance.getCurrentTime(),
        isPlaying: state === 1,
        buffering: state === 3,
        blocked: autoplayBlocked,
      });
    };
    loadYouTubeApi().then((YT) => {
      if (disposed || !frame || frameRef.current !== frame) return;
      instance = new YT.Player(frame, {
        events: {
          onReady: () => {
            if (disposed) return;
            youtubeReady.current = true;
            youtubePlayer.current = instance;
            applyYouTubeSync(instance, pendingSync.current);
            report();
            telemetry = setInterval(report, 1000);
          },
          onStateChange: report,
          onAutoplayBlocked: () => { autoplayBlocked = true; report(); },
          onError: (event) => {
            if (disposed) return;
            playbackError = YT_REASON[event.data] || 'the trailer could not play';
            youtubeReady.current = false;
            clearInterval(telemetry);
            setYtError(playbackError);
            playbackCallback.current?.({ ready: false, error: 'YouTube playback failed.', currentTime: null, isPlaying: false, buffering: false });
            if (!followRef.current) errorAdvance.current('trailer');
          },
        },
      });
    }).catch((error) => {
      if (!disposed) playbackCallback.current?.({ ready: false, error: error.message, currentTime: null, isPlaying: false, buffering: false });
    });
    return () => {
      disposed = true;
      clearInterval(telemetry);
      youtubeReady.current = false;
      youtubePlayer.current = null;
      instance?.destroy();
    };
  }, [server, source.url, source.ok, frameKey]);

  /* Direct HLS Engine lifecycle */
  useEffect(() => {
    if (source.kind !== 'hls' || !source.ok) {
      if (hlsPlayerRef.current) {
        hlsPlayerRef.current.destroy();
        hlsPlayerRef.current = null;
      }
      setHlsAudioState(null);
      setHlsQualityState(null);
      return undefined;
    }

    const videoEl = videoRef.current;
    if (!videoEl) return undefined;

    let hls = new DirectHlsPlayer(videoEl, {
      onAudioTracksChange: (state) => {
        setHlsAudioState(state);
      },
      onLevelsChange: (state) => {
        setHlsQualityState(state);
      },
      onReady: () => {
        setReady(true);
        setFailed(false);
        playbackCallback.current?.({ ready: true, isPlaying: !videoEl.paused, currentTime: videoEl.currentTime, buffering: false });
      },
      onError: () => {
        setFailed(true);
      },
    });

    hlsPlayerRef.current = hls;
    hls.load(source.url);

    const onPlay = () => playbackCallback.current?.({ ready: true, isPlaying: true, currentTime: videoEl.currentTime, buffering: false });
    const onPause = () => playbackCallback.current?.({ ready: true, isPlaying: false, currentTime: videoEl.currentTime, buffering: false });
    const onTimeUpdate = () => playbackCallback.current?.({ ready: true, isPlaying: !videoEl.paused, currentTime: videoEl.currentTime, buffering: false });

    videoEl.addEventListener('play', onPlay);
    videoEl.addEventListener('pause', onPause);
    videoEl.addEventListener('timeupdate', onTimeUpdate);

    return () => {
      videoEl.removeEventListener('play', onPlay);
      videoEl.removeEventListener('pause', onPause);
      videoEl.removeEventListener('timeupdate', onTimeUpdate);
      hls.destroy();
      hlsPlayerRef.current = null;
    };
  }, [server, source.kind, source.url, source.ok, frameKey]);

  useEffect(() => {
    const keys = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
      if (e.key === 'f' || e.key === 'F') toggleFullscreen();
      if (e.key === 't' || e.key === 'T') setTheater((v) => !v);
    };
    window.addEventListener('keydown', keys);
    return () => window.removeEventListener('keydown', keys);
  });

  const toggleFullscreen = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el.requestFullscreen?.();
  }, []);

  const pick = (id) => {
    setServer(id);
    setTriedIds((t) => [...new Set([...t, id])]);
    setPreferredServer(id);
    onProviderChange?.(id);
  };

  /**
   * Reload the frame without changing server — the other escape hatch.
   *
   * Switching servers throws away the page that may already be twenty minutes
   * into a film. Sometimes the stream is fine and only the host's player froze:
   * paused with a dead play button, which is what one of their popunder scripts
   * looks like when it swallows the click. Remounting the iframe re-requests the
   * same URL, and re-arming the watchdog comes free because `frameKey` is one of
   * its dependencies. It is the only control we have over a cross-origin player.
   */
  const reloadFrame = useCallback(() => setFrameKey((k) => k + 1), []);

  const active = findProvider(server);
  /** AdShield twin of the server in use, else the first sanitized entry we ship. */
  const shieldTwin =
    providers.find((p) => p.kind === 'proxy' && p.upstream === server) ||
    providers.find((p) => p.kind === 'proxy');
  /** Live verdict for the server in use — drives the dot on the Playback trigger. */
  const currentVerdict = server === 'trailer' ? null : health?.servers?.[server];
  const currentDead = currentVerdict && currentVerdict.ok === false;

  // Unknown stream audio is never presented as selected or confirmed missing.
  const dubNotice = { tone: 'gold', text: audioState.reason };

  /** Whatever the slide has changed beyond its default, summarised on its trigger. */
  const playbackChips = [
    quality !== DEFAULT_QUALITY && quality !== 'auto' && QUALITY_SHORT[quality],
    subsOnly && 'Subs only',
    !blockPopups && 'Ads allowed',
  ].filter(Boolean);

  const aspect = compact ? 'aspect-video' : theater || fullscreen ? 'aspect-video' : 'aspect-video';

  return (
    <div ref={rootRef} className="flex w-full flex-col">
      {/* server bar */}
      <div className="mb-2.5 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {follow ? (
            <div className="flex items-center gap-2 rounded-xl border border-white/12 bg-white/[0.04] px-3 py-1.5 text-[11.5px] font-bold text-textSub">
              <Users className="h-3.5 w-3.5 text-primary" />
              <span>{active?.label || server}</span>
              <span className="font-normal text-textMuted">host picks the server</span>
            </div>
          ) : (
            <motion.button
              type="button"
              onClick={() => setPanel(true)}
              whileTap={{ scale: 0.97 }}
              transition={spring.snappy}
              title="All Servers & Audio Settings"
              className="group flex items-center gap-2 rounded-xl border border-primary/50 bg-primary/[0.12] px-3 py-1.5 text-[11.5px] font-bold text-white transition-colors hover:bg-primary/[0.2]"
            >
              <Sliders className="h-3.5 w-3.5 text-primary" />
              <span>Audio & Server Settings</span>
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${currentDead ? 'bg-gold' : currentVerdict ? 'bg-lime' : 'bg-white/35'}`} />
            </motion.button>
          )}

          {!follow && youtubeKey && server !== 'trailer' && (
            <button
              onClick={() => pick('trailer')}
              title="Play the official HD trailer instead"
              className="flex items-center gap-1.5 rounded-xl border border-white/12 bg-white/[0.03] px-2.5 py-1.5 text-[11.5px] font-bold text-textSub transition-colors hover:border-white/30 hover:text-white"
            >
              <Check className="h-3 w-3" /> Trailer
            </button>
          )}

          {/* Built-in VPN / AdShield Toggle Button */}
          <button
            type="button"
            onClick={() => {
              if (active?.kind === 'proxy') {
                if (active.upstream) pick(active.upstream);
              } else if (shieldTwin) {
                pick(shieldTwin.id);
              } else {
                pick('vidsrcpm-clean');
              }
            }}
            title="Toggle Built-in AdBlock & Clean Proxy Server"
            className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[11.5px] font-bold transition-all ${
              active?.kind === 'proxy'
                ? 'border-lime bg-lime/20 text-lime shadow-sm'
                : 'border-white/12 bg-white/[0.04] text-textSub hover:border-lime/50 hover:text-white'
            }`}
          >
            <Shield className="h-3.5 w-3.5" />
            <span>VPN & AdShield: {active?.kind === 'proxy' ? 'ON 🛡️' : 'OFF'}</span>
          </button>

          <div className="ml-auto flex items-center gap-1.5">
            {active?.kind === 'proxy' && <Badge tone="live" title="Ad scripts removed by our backend"><Shield className="h-2.5 w-2.5" /> Clean Proxy</Badge>}
            {active?.subs && <Badge tone="cyan">Subs</Badge>}
            <Badge tone="muted" title="Use in-player ⚙️ menu for stream audio / dubs">
              <Volume2 className="h-2.5 w-2.5" /> Audio in Player Menu
            </Badge>
            {!follow && (
              <button onClick={reloadFrame} title="Reload this server" className="grid h-7 w-7 place-items-center rounded-lg border border-white/12 text-textSub hover:border-primary/40 hover:text-white">
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            )}
            {!follow && (
              <button onClick={switchServer} title="Try next server" className="grid h-7 w-7 place-items-center rounded-lg border border-white/12 text-textSub hover:border-primary/40 hover:text-white">
                <SkipForward className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Quick Server Buttons with Direct 1-Click Access */}
        {!follow && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
            <span className="text-[11px] font-bold uppercase tracking-wider text-textMuted shrink-0 mr-1 flex items-center gap-1">
              <Server className="h-3 w-3 text-primary" /> Servers:
            </span>
            {providers
              .filter((p) => p.kind === 'embed' || p.kind === 'proxy' || p.id === 'hls-direct')
              .map((p) => {
                const isCurrent = p.id === server;
                const isMultiAudio = p.id === 'hls-direct' || p.id === 'vidsrcpm' || p.id === 'smashy' || p.id === 'videasy';
                return (
                  <button
                    key={p.id}
                    onClick={() => pick(p.id)}
                    className={`shrink-0 flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11.5px] font-semibold transition-all ${
                      isCurrent
                        ? 'border-primary bg-primary text-white shadow-sm'
                        : 'border-white/10 bg-white/[0.03] text-textSub hover:border-white/25 hover:text-white hover:bg-white/[0.07]'
                    }`}
                  >
                    <span>{p.label.replace('Server ', 'S').replace(' · ', ': ')}</span>
                    {isMultiAudio && (
                      <span className={`text-[9px] px-1 py-0.2 rounded font-bold uppercase tracking-wider ${isCurrent ? 'bg-black/30 text-lime' : 'bg-lime/15 text-lime'}`}>
                        Audio
                      </span>
                    )}
                  </button>
                );
              })}
          </div>
        )}
      </div>

      {/* we cannot read a dub out of someone else's player, so we say what we asked for */}
      <AnimatePresence>
        {dubNotice && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0 }}
            transition={spring.soft}
            className={`-mt-0.5 mb-2.5 flex items-start gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] leading-relaxed ${
              dubNotice.tone === 'gold' ? 'border-gold/30 bg-gold/[0.07] text-gold' : 'border-accent/30 bg-accent/[0.07] text-accent'
            }`}
          >
            <Volume2 className="mt-0.5 h-3 w-3 shrink-0" />
            <span className="min-w-0 flex-1">{dubNotice.text}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* YouTube told us the trailer is unplayable — say so, then keep going */}
      <AnimatePresence>
        {ytError && (
          <motion.p
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={spring.snappy}
            className="mb-2 flex items-center gap-1.5 rounded-lg border border-gold/30 bg-gold/10 px-2.5 py-1.5 text-[11.5px] text-gold"
          >
            <AlertTriangle className="h-3 w-3 shrink-0" /> HD trailer: {ytError} — moved you to {active?.label || 'the next server'}.
          </motion.p>
        )}
      </AnimatePresence>

      {/* frame */}
      <motion.div
        ref={wrapRef}
        layout
        initial={false}
        animate={{ scale: 1 }}
        className={`film-grain relative overflow-hidden rounded-xl border bg-black shadow-cinema transition-[max-height] duration-500 ease-cinema max-sm:order-first max-sm:-mx-3 max-sm:mb-3 sm:rounded-2xl ${
          fullscreen ? 'h-screen rounded-none border-0' : `${aspect} border-white/[0.07] ${theater ? 'max-h-[78vh]' : ''}`
        }`}
      >
        <div className="absolute inset-0 grid place-items-center bg-[radial-gradient(circle_at_50%_45%,#12121c_0%,#05050a_70%)]">
          {/* pre-roll animation while the upstream answers */}
          {!ready && !failed && (
            <motion.div variants={stagger(0, 0.1)} initial="hidden" animate="show" className="absolute inset-0 z-20 grid place-items-center bg-black/85 backdrop-blur-sm">
              <div className="text-center">
                <div className="mx-auto mb-4 flex h-10 items-end gap-1.5">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <span key={i} className="w-1.5 origin-bottom animate-eq rounded-full bg-primary" style={{ height: 26, animationDelay: `${i * 0.12}s` }} />
                  ))}
                </div>
                <p className="font-display text-[15px] font-bold text-white">{follow ? 'Starting with the party' : `Warming up ${active?.label || 'server'}`}</p>
                <p className="mt-1 max-w-[34ch] text-[12px] text-textMuted">
                  {source.ok ? (follow ? 'Your host picked this server — the stream should come up any second' : 'Loading stream… switching server automatically if it stalls') : source.reason}
                </p>
                {!follow && (
                  <button onClick={switchServer} className="mt-4 flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-[11px] font-bold text-textSub hover:border-primary/45 hover:text-white">
                    <RefreshCw className="h-3 w-3" /> Try another server
                  </button>
                )}
              </div>
            </motion.div>
          )}

          {failed && follow && (
            <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={spring.soft} className="z-20 max-w-[38ch] px-6 text-center">
              <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl border border-primary/35 bg-primary/10">
                <Users className="h-6 w-6 text-primary" />
              </div>
              <p className="font-display text-base font-bold text-white">This server is stalling for you</p>
              <p className="mt-2 text-[13px] leading-relaxed text-textSub">
                Your host chooses the server so everyone watches the same feed. Ask them to switch, or leave and rejoin the room.
              </p>
            </motion.div>
          )}

          {failed && !follow && (
            <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={spring.soft} className="z-20 max-w-[42ch] px-6 text-center">
              <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl border border-gold/35 bg-gold/10">
                <AlertTriangle className="h-6 w-6 text-gold" />
              </div>
              <p className="font-display text-base font-bold text-white">{ready ? 'Every server we know has now been on screen' : 'No server could start this title'}</p>
              <p className="mt-2 text-[13px] leading-relaxed text-textSub">
                {source.ok === false ? source.reason : `The attempted server chain for ${type === 'tv' ? `S${season}E${episode}` : 'this film'} is exhausted.`}{' '}
                We cannot inspect the video inside these external players, so this does not confirm that the title or an audio track is unavailable. Retry, choose a server manually, or use an official trailer.
                {ready ? ' That also means this panel can be wrong: if the frame behind it is in fact playing, say so and it stays.' : ''}
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                {ready && (
                  <button
                    onClick={() => {
                      setFailed(false);
                      setNudge(false);
                      nudged.current = true;
                    }}
                    className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-[13px] font-bold text-white hover:bg-primaryLight"
                  >
                    <Check className="h-3.5 w-3.5" /> It is playing — carry on
                  </button>
                )}
                <button onClick={() => { setFailed(false); setTriedIds([]); if (!advance(server, true)) reloadFrame(); }} className="flex items-center gap-1.5 rounded-xl border border-white/15 px-4 py-2 text-[13px] font-bold text-textSub hover:text-white">
                  <RefreshCw className="h-3.5 w-3.5" /> Retry chain
                </button>
                {youtubeKey && (
                  <button onClick={() => pick('trailer')} className="flex items-center gap-1.5 rounded-xl border border-white/15 px-4 py-2 text-[13px] font-bold text-textSub hover:text-white">
                    <Check className="h-3.5 w-3.5" /> Play HD trailer instead
                  </button>
                )}
                <button onClick={() => shieldTwin && pick(shieldTwin.id)} className="flex items-center gap-1.5 rounded-xl border border-lime/40 bg-lime/10 px-4 py-2 text-[13px] font-bold text-lime">
                  <Wand2 className="h-3.5 w-3.5" /> Use AdShield proxy
                </button>
              </div>
            </motion.div>
          )}

          {source.ok && source.kind === 'hls' ? (
            <video
              ref={videoRef}
              key={`hls-${server}-${tmdbId}-${frameKey}`}
              controls
              playsInline
              className="absolute inset-0 z-10 h-full w-full object-contain bg-black"
            />
          ) : source.ok ? (
            <iframe
              ref={frameRef}
              key={`${server}-${tmdbId}-${type}-${season}-${episode}-${frameKey}-${cage ? 'caged' : 'open'}`}
              src={source.url}
              title={title || 'ZenithFlix player'}
              onLoad={() => {
                readyRef.current = true;
                startBy.current = 0;
                silentBy.current = source.kind === 'trailer' ? 0 : Date.now() + SILENT_FRAME_BUDGET_MS;
                setReady(true);
                setFailed(false);
              }}
              onError={() => setFailed(true)}
              allow="autoplay; fullscreen; encrypted-media; picture-in-picture; clipboard-write"
              allowFullScreen
              className={`absolute inset-0 z-10 h-full w-full border-0 ${ready ? 'opacity-100' : 'opacity-0'} transition-opacity duration-500`}
            />
          ) : (
            <div className="absolute inset-0 z-10 grid place-items-center">
              <Spinner size={22} />
            </div>
          )}
        </div>

        {/* Audio + room badges go top-left: every one of these hosts paints its
            own control bar along the bottom of the frame, and our buttons were
            sitting on top of theirs. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start justify-between gap-3 p-3">
          <div className="pointer-events-auto flex flex-wrap items-center gap-1.5 pr-[13rem]">
            <Badge tone="muted" title="The iframe has not reported an active audio track">
              <Volume2 className="h-2.5 w-2.5" /> Audio unverified
            </Badge>
            {cage && (
              <Badge tone="live" title="This frame is sandboxed without pop-up permission — an ad tab cannot open from it">
                <Shield className="h-2.5 w-2.5" /> Ad tabs blocked
              </Badge>
            )}
            {blockPopups && !cage && source.kind === 'embed' && (
              <Badge tone="gold" title="This server detects sandboxing and would refuse to play, so its frame is uncaged — its pop-up tabs are Opera's job, or pick an + AdShield server">
                <AlertTriangle className="h-2.5 w-2.5" /> Can&apos;t cage this server
              </Badge>
            )}
            {party && (
              <Badge tone="violet" title="Room state">
                <Gauge className="h-2.5 w-2.5" /> {party}
              </Badge>
            )}
          </div>
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-10 z-30 flex items-end justify-end gap-3 p-3 sm:bottom-12">
          <div className="pointer-events-auto flex items-center gap-1.5 rounded-xl border border-white/10 bg-black/75 p-1 shadow-lg backdrop-blur-md">
            {!follow && (
              <button
                onClick={() => setPanel(true)}
                title="Playback settings"
                className={`grid h-8 w-8 place-items-center rounded-lg border transition-colors ${panel ? 'border-primary/45 bg-primary/20 text-white' : 'border-white/10 bg-white/[0.04] text-white/80 hover:text-white'}`}
              >
                <Sliders className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              onClick={() => setTheater((v) => !v)}
              title="Theater mode (T)"
              className={`grid h-8 w-8 place-items-center rounded-lg border transition-colors ${theater ? 'border-primary/45 bg-primary/20 text-white' : 'border-white/10 bg-white/[0.04] text-white/80 hover:text-white'}`}
            >
              {theater ? <Minimize className="h-3.5 w-3.5" /> : <Expand className="h-3.5 w-3.5" />}
            </button>
            <button
              onClick={toggleFullscreen}
              title="Fullscreen (F)"
              className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-white/80 transition-colors hover:text-white"
            >
              <Maximize className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* still black, or frozen mid-film? explicit escape hatches — we cannot
            detect iframe internals, so we hand the viewer both fixes: retry here
            and move on to the next server */}
        <AnimatePresence>
          {ready && !follow && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="absolute right-3 top-3 z-30 flex items-center gap-1.5"
            >
              <button
                onClick={reloadFrame}
                title="Reload this server without losing it — use this when the video sits paused and its own play button does nothing"
                className="grid h-7 w-7 place-items-center rounded-lg border border-white/15 bg-black/60 text-white/80 backdrop-blur-md transition-colors hover:border-primary/45 hover:text-white"
              >
                <RefreshCw className="h-3 w-3" />
              </button>
              <button
                onClick={switchServer}
                title="We cannot see inside another site's player, so this is a manual override — it moves to the next server that answers, and stops with a straight answer once every one has been tried"
                className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold backdrop-blur-md transition-colors ${
                  nudge ? 'animate-nudge-glow border-primary/60 bg-primary/25 text-white' : 'border-white/15 bg-black/60 text-white/80 hover:border-primary/45 hover:text-white'
                }`}
              >
                <SkipForward className="h-3 w-3" /> {nudge ? 'Try another server' : 'Switch server'}
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      <p className="mt-2 flex items-center gap-1.5 px-1 text-[11px] text-textMuted">
        <Loader className="h-3 w-3" />
        Free embed servers rate-limit and disappear often. {active?.blurb}
      </p>

      <PlaybackPanel
        open={panel}
        onClose={() => setPanel(false)}
        providers={providers}
        health={health}
        server={server}
        onServer={pick}
        audioState={audioState}
        qualityState={qualityState}
        quality={quality}
        onQuality={setQuality}
        subsOnly={subsOnly}
        onSubsOnly={setSubsOnly}
        blockPopups={blockPopups}
        onBlockPopups={setBlockPopups}
        dubs={dubs && dubs.type === type && String(dubs.id) === String(tmdbId) ? dubs : null}
        title={title}
        onSelectAudioTrack={(trackId) => hlsPlayerRef.current?.setAudioTrack(trackId)}
        onSelectLevel={(levelId) => hlsPlayerRef.current?.setLevel(levelId)}
      />
    </div>
  );
}
