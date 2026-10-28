/**
 * Movie playback is currently iframe-only. A registry language array, a TMDB
 * language, a URL query, or iframe load is not an observed audio track.
 * Do not enable an external selector until an authorized player adapter can
 * enumerate tracks, select a track ID and acknowledge the active track.
 */
export function iframeAudioState(source) {
  return {
    status: source?.ok ? 'unsupported' : 'unavailable',
    tracks: [],
    selectedTrackId: null,
    selectedLanguage: null,
    canSelect: false,
    reason: source?.ok
      ? 'This embedded player has no verified audio-track API connected to ZenithFlix. Current language and Hindi availability cannot be verified. If the player offers an Audio menu, select a listed track there; subtitle language is not audio language.'
      : 'Audio tracks cannot be checked because this playback source is unavailable.',
  };
}

/** Reject the old endpoint's heuristic `audio` array; it is not a manifest. */
export function iframeQualityState(source) {
  return {
    status: source?.ok ? 'unsupported' : 'unavailable',
    levels: [],
    selectedLevel: null,
    canSelect: false,
    supportsAuto: false,
    reason: source?.ok
      ? 'This iframe has no verified rendition-list or quality-selection API connected to ZenithFlix. A server advertising up to 1080p does not establish which resolutions this source provides.'
      : 'Video resolutions cannot be checked because the playback source is unavailable.',
  };
}

export function titleLanguageMetadata(data) {
  if (data?.kind !== 'title-language-metadata' || !Array.isArray(data.languages)) {
    return { kind: 'title-language-metadata', status: 'unavailable', languages: [], originalLanguage: null };
  }
  return {
    ...data,
    languages: data.languages.filter((row) => row && typeof row.code === 'string'),
  };
}
