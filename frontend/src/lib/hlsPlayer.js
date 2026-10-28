import Hls from 'hls.js';

export function isHlsSupported() {
  return Hls.isSupported();
}

/**
 * Direct HLS Player adapter using HLS.js.
 * Provides real track selection, level switching, and state observations.
 */
export class DirectHlsPlayer {
  constructor(videoElement, options = {}) {
    this.video = videoElement;
    this.options = options;
    this.hls = null;
    this.destroyed = false;
    this.currentUrl = null;
    this.onAudioTracksChange = options.onAudioTracksChange || (() => {});
    this.onLevelsChange = options.onLevelsChange || (() => {});
    this.onError = options.onError || (() => {});
    this.onReady = options.onReady || (() => {});
  }

  load(url, startTime = 0) {
    this.currentUrl = url;
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        startPosition: startTime > 0 ? startTime : -1,
        ...this.options.hlsConfig,
      });

      this.hls = hls;
      hls.attachMedia(this.video);

      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        if (this.destroyed) return;
        hls.loadSource(url);
      });

      hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
        if (this.destroyed) return;
        this.emitLevels();
        this.emitAudioTracks();
        this.onReady(data);
        if (startTime > 0) {
          try {
            this.video.currentTime = startTime;
          } catch {
            // Video currentTime can fail if not ready yet
          }
        }
      });

      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
        if (this.destroyed) return;
        this.emitAudioTracks();
      });

      hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, () => {
        if (this.destroyed) return;
        this.emitAudioTracks();
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, () => {
        if (this.destroyed) return;
        this.emitLevels();
      });

      hls.on(Hls.Events.ERROR, (event, data) => {
        if (this.destroyed) return;
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              this.onError(data);
              hls.destroy();
              break;
          }
        }
      });
    } else if (this.video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native Safari HLS
      this.video.src = url;
      this.video.addEventListener('loadedmetadata', () => {
        if (startTime > 0) {
          try {
            this.video.currentTime = startTime;
          } catch {
            /* ignore */
          }
        }
        this.emitNativeAudioTracks();
        this.onReady({});
      }, { once: true });
    } else {
      this.onError(new Error('HLS playback is not supported in this browser.'));
    }
  }

  getAudioTracks() {
    if (this.hls) {
      return (this.hls.audioTracks || []).map((t, idx) => ({
        id: idx,
        name: t.name || t.lang || `Track ${idx + 1}`,
        lang: (t.lang || '').toLowerCase(),
        active: this.hls.audioTrack === idx,
        isDefault: Boolean(t.default),
      }));
    }
    return this.getNativeAudioTracks();
  }

  getNativeAudioTracks() {
    if (!this.video.audioTracks) return [];
    const list = [];
    for (let i = 0; i < this.video.audioTracks.length; i++) {
      const t = this.video.audioTracks[i];
      list.push({
        id: i,
        name: t.label || t.language || `Track ${i + 1}`,
        lang: (t.language || '').toLowerCase(),
        active: t.enabled,
        isDefault: false,
      });
    }
    return list;
  }

  emitAudioTracks() {
    const tracks = this.getAudioTracks();
    const active = tracks.find((t) => t.active) || tracks[0] || null;
    this.onAudioTracksChange({
      status: tracks.length ? 'supported' : 'unsupported',
      tracks,
      selectedTrackId: active ? active.id : null,
      selectedLanguage: active ? active.lang : null,
      canSelect: tracks.length > 1,
      hasHindi: tracks.some((t) => t.lang === 'hi' || t.name.toLowerCase().includes('hindi')),
      reason: tracks.length
        ? `Direct HLS engine active · ${tracks.length} audio rendition(s) detected.`
        : 'Direct stream contains no separated audio track manifest.',
    });
  }

  emitNativeAudioTracks() {
    const tracks = this.getNativeAudioTracks();
    const active = tracks.find((t) => t.active) || tracks[0] || null;
    this.onAudioTracksChange({
      status: tracks.length ? 'supported' : 'unsupported',
      tracks,
      selectedTrackId: active ? active.id : null,
      selectedLanguage: active ? active.lang : null,
      canSelect: tracks.length > 1,
      hasHindi: tracks.some((t) => t.lang === 'hi' || t.name.toLowerCase().includes('hindi')),
      reason: tracks.length
        ? `Native browser HLS active · ${tracks.length} audio track(s) detected.`
        : 'Native stream contains no track metadata.',
    });
  }

  setAudioTrack(trackId) {
    if (this.hls) {
      if (typeof trackId === 'number' && trackId >= 0 && trackId < (this.hls.audioTracks?.length || 0)) {
        this.hls.audioTrack = trackId;
        this.emitAudioTracks();
        return true;
      }
    } else if (this.video.audioTracks) {
      for (let i = 0; i < this.video.audioTracks.length; i++) {
        this.video.audioTracks[i].enabled = i === trackId;
      }
      this.emitNativeAudioTracks();
      return true;
    }
    return false;
  }

  getLevels() {
    if (!this.hls) return [];
    return (this.hls.levels || []).map((lvl, idx) => ({
      id: idx,
      height: lvl.height,
      width: lvl.width,
      bitrate: lvl.bitrate,
      name: lvl.height ? `${lvl.height}p` : `Level ${idx + 1}`,
      active: this.hls.currentLevel === idx,
    }));
  }

  emitLevels() {
    if (!this.hls) return;
    const levels = this.getLevels();
    const current = this.hls.currentLevel;
    this.onLevelsChange({
      status: levels.length ? 'supported' : 'unsupported',
      levels,
      selectedLevel: current, // -1 is Auto
      isAuto: current === -1,
      canSelect: levels.length > 1,
      supportsAuto: true,
      reason: levels.length
        ? `Direct HLS engine active · ${levels.length} video rendition(s) detected.`
        : 'Direct stream contains single rendition.',
    });
  }

  setLevel(levelId) {
    if (!this.hls) return false;
    // levelId: -1 for auto, or 0..levels.length-1
    if (levelId === -1 || (levelId >= 0 && levelId < this.hls.levels.length)) {
      this.hls.currentLevel = levelId;
      this.emitLevels();
      return true;
    }
    return false;
  }

  destroy() {
    this.destroyed = true;
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    if (this.video) {
      this.video.removeAttribute('src');
      this.video.load();
    }
  }
}
