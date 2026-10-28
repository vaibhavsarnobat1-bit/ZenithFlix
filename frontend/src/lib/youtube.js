let apiJob = null;

/** Official iframe API, used only for the existing YouTube trailer provider. */
export function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiJob) return apiJob;
  apiJob = new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    let script = document.querySelector('script[data-zf-youtube-api]');
    let timer;
    const fail = (message) => {
      clearTimeout(timer);
      if (window.onYouTubeIframeAPIReady === ready) window.onYouTubeIframeAPIReady = previous;
      script?.remove();
      apiJob = null;
      reject(new Error(message));
    };
    const ready = () => {
      clearTimeout(timer);
      if (window.onYouTubeIframeAPIReady === ready) window.onYouTubeIframeAPIReady = previous;
      if (typeof previous === 'function') { try { previous(); } catch { /* Independent callback. */ } }
      if (!window.YT?.Player) return fail('YouTube player API is unavailable.');
      resolve(window.YT);
    };
    timer = setTimeout(() => fail('YouTube player API did not load. Reload the trailer to retry.'), 12000);
    window.onYouTubeIframeAPIReady = ready;
    if (!script) {
      script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.dataset.zfYoutubeApi = 'true';
      script.onerror = () => fail('YouTube player API was blocked or unavailable.');
      document.head.append(script);
    }
  });
  return apiJob;
}

/** Prevent a promoted host's stale local clock from overwriting room state. */
export function matchesYouTubeSync(playback, target) {
  return Boolean(playback?.ready && !playback.buffering && !playback.blocked && !playback.error && target
    && Number.isFinite(playback.currentTime) && Number.isFinite(target.currentTime)
    && Math.abs(playback.currentTime - target.currentTime) <= 2
    && playback.isPlaying === target.isPlaying);
}

/** Commands only target a real ready YT.Player, never an opaque movie iframe. */
export function applyYouTubeSync(player, sync) {
  if (!player || !sync || !['play', 'pause', 'seek', 'snapshot'].includes(sync.action)) return false;
  const time = sync.currentTime;
  if (typeof time !== 'number' || !Number.isFinite(time) || time < 0 || time > 604800) return false;
  if (sync.action === 'seek' || sync.action === 'snapshot' || Math.abs(player.getCurrentTime() - time) > 2) {
    player.seekTo(time, true);
  }
  if (sync.action === 'play') player.playVideo();
  else if (sync.action === 'pause') player.pauseVideo();
  else if (sync.isPlaying === true) player.playVideo();
  else if (sync.isPlaying === false) player.pauseVideo();
  return true;
}
