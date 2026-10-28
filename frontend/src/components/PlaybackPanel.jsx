import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, HardDrive, Languages, Server, Shield, Subtitles, TriangleAlert, X } from 'lucide-react';
import { scrim, spring } from '../lib/motion';
import { languageName } from '../lib/providers';

// This ranks servers by their advertised ceiling. It is NOT video track selection.
const SERVER_PREFERENCES = [
  { id: 'auto', label: 'Any server', tier: 0 },
  { id: '1080', label: 'Prefer HD servers', tier: 2 },
  { id: '4k', label: 'Prefer 4K servers', tier: 3 },
];

function Row({ selected, onSelect, title, sub, badge, disabled }) {
  return (
    <button type="button" onClick={() => !disabled && onSelect()} disabled={disabled}
      className={`group flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${selected ? 'border-primary/50 bg-primary/[0.12]' : 'border-white/[0.07] bg-white/[0.02] hover:border-white/20'} ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-bold text-white">{title}</span>
        {sub && <span className="mt-0.5 block text-[11px] leading-snug text-textMuted">{sub}</span>}
      </span>
      {badge}
      <span className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border ${selected ? 'border-primary bg-primary text-white' : 'border-white/25 text-transparent'}`}>
        <Check className="h-2.5 w-2.5" strokeWidth={3} />
      </span>
    </button>
  );
}

function Section({ icon: Icon, label, note, children }) {
  return (
    <section className="mb-5">
      <header className="mb-2 flex items-center gap-2 px-1">
        <Icon className="h-3.5 w-3.5 text-primary" />
        <h3 className="font-display text-[12.5px] font-bold uppercase tracking-[0.09em] text-textSub">{label}</h3>
      </header>
      {note && <p className="mb-2 px-1 text-[11px] leading-relaxed text-textMuted">{note}</p>}
      <div className="flex flex-col gap-1.5">{children}</div>
    </section>
  );
}

export default function PlaybackPanel({
  open, onClose, providers, health, server, onServer, audioState, qualityState,
  quality, onQuality, subsOnly, onSubsOnly, blockPopups, onBlockPopups, dubs, title = '',
  onSelectAudioTrack, onSelectLevel,
}) {
  const embeds = useMemo(() => providers.filter((p) => p.kind === 'embed' || p.kind === 'proxy' || p.kind === 'hls'), [providers]);
  const preference = SERVER_PREFERENCES.find((p) => p.id === quality);
  const answered = embeds.filter((p) => health?.servers?.[p.id]?.ok === true).length;
  const unknown = embeds.filter((p) => !health?.servers?.[p.id]).length;
  const metadata = dubs?.kind === 'title-language-metadata' ? dubs : null;
  const cageNote = (p) => {
    if (p.kind === 'proxy') return 'AdShield sanitizer · ';
    if (!blockPopups) return 'Pop-ups allowed · ';
    return p.sandboxOk ? 'Sandbox enabled when compatible · ' : 'No sandbox compatibility · ';
  };

  return (
    <AnimatePresence>
      {open && <>
        <motion.div key="scrim" variants={scrim} initial="hidden" animate="show" exit="hide" onClick={onClose} className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-[3px]" />
        <motion.aside key="panel" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={spring.sheet}
          className="fixed right-0 top-0 z-[90] flex h-full w-full max-w-[400px] flex-col border-l border-white/10 bg-[#0a0a12]/95 shadow-cinema backdrop-blur-2xl" role="dialog" aria-label="Playback settings">
          <header className="flex items-start justify-between gap-3 border-b border-white/[0.07] px-4 py-3.5">
            <div className="min-w-0">
              <p className="font-display text-[15px] font-bold text-white">Playback</p>
              <p className="truncate text-[11.5px] text-textMuted">{title || 'Server and playback capabilities'}</p>
            </div>
            <button onClick={onClose} aria-label="Close playback settings" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/12 text-textSub hover:border-white/30 hover:text-white"><X className="h-4 w-4" /></button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
            <Section icon={Languages} label="Audio language" note={audioState?.reason}>
              {audioState?.status === 'supported' && audioState.tracks?.length ? (
                <div className="flex flex-col gap-1.5">
                  <div className="rounded-xl border border-lime/30 bg-lime/[0.08] px-3 py-2 text-[12px] text-lime">
                    Direct HLS stream active: {audioState.tracks.length} verified track(s) detected.
                    {audioState.hasHindi ? ' (Hindi track is confirmed available)' : ' (Hindi track is NOT in this manifest)'}
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                    {audioState.tracks.map((t) => {
                      const isSelected = t.id === audioState.selectedTrackId;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => onSelectAudioTrack?.(t.id)}
                          className={`flex items-center justify-between rounded-xl border px-3 py-2 text-left text-[12px] font-bold transition-colors ${
                            isSelected
                              ? 'border-primary/60 bg-primary/20 text-white'
                              : 'border-white/10 bg-white/[0.03] text-textSub hover:border-white/25 hover:text-white'
                          }`}
                        >
                          <span className="truncate">{t.name || t.lang?.toUpperCase() || `Track ${t.id + 1}`}</span>
                          {isSelected && <Check className="h-3.5 w-3.5 text-primary" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <>
                  <p role="status" className="rounded-xl border border-gold/20 bg-gold/[0.06] px-3 py-2.5 text-[12px] leading-relaxed text-gold">
                    Current audio: unverified. Hindi availability: unknown, not confirmed missing. External language selection is not supported for this source.
                  </p>
                  <p className="px-1 text-[11px] leading-relaxed text-textMuted">
                    A Hindi track must appear in the embedded player’s Audio menu to be selected there. Changing subtitles or adding a language to the URL does not create or select a dub.
                  </p>
                </>
              )}
              <div className="rounded-xl border border-white/[0.07] px-3 py-2.5 text-[11px] leading-relaxed text-textMuted">
                <p className="font-bold text-textSub">Title languages — TMDB metadata only</p>
                {!metadata ? <p>Loading title metadata…</p>
                  : metadata.status !== 'loaded' ? <p>Title-language metadata is unavailable. Stream audio is still unknown.</p>
                    : !metadata.languages?.length ? <p>No language metadata was supplied.</p>
                      : <p>{metadata.languages.map((r) => `${languageName(r.code)}${r.original ? ' (original title language)' : ' (spoken in title)'}`).join(' · ')}</p>}
                <p className="mt-1">These records are not the available tracks in this video source.</p>
              </div>
            </Section>
            <Section icon={HardDrive} label="Video quality" note={qualityState.reason}>
              {qualityState?.status === 'supported' && qualityState.levels?.length ? (
                <div className="flex flex-col gap-1.5">
                  <div className="rounded-xl border border-lime/30 bg-lime/[0.08] px-3 py-2 text-[12px] text-lime">
                    Direct HLS renditions detected: {qualityState.levels.length} level(s) available.
                  </div>
                  <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
                    <button
                      type="button"
                      onClick={() => onSelectLevel?.(-1)}
                      className={`rounded-xl border px-2.5 py-1.5 text-[11px] font-bold ${
                        qualityState.selectedLevel === -1
                          ? 'border-primary/60 bg-primary/20 text-white'
                          : 'border-white/10 text-textSub hover:border-white/25'
                      }`}
                    >
                      Auto
                    </button>
                    {qualityState.levels.map((lvl) => {
                      const isSelected = lvl.id === qualityState.selectedLevel;
                      return (
                        <button
                          key={lvl.id}
                          type="button"
                          onClick={() => onSelectLevel?.(lvl.id)}
                          className={`rounded-xl border px-2.5 py-1.5 text-[11px] font-bold ${
                            isSelected
                              ? 'border-primary/60 bg-primary/20 text-white'
                              : 'border-white/10 text-textSub hover:border-white/25'
                          }`}
                        >
                          {lvl.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <>
                  <p role="status" className="rounded-xl border border-gold/20 bg-gold/[0.06] px-3 py-2.5 text-[12px] leading-relaxed text-gold">
                    Current resolution: unverified. No 480p / 720p / 1080p / Auto rendition selector is available from this iframe.
                  </p>
                  <p className="px-1 text-[11px] leading-relaxed text-textMuted">Use the embedded player’s Quality menu, if it provides one. We cannot confirm its resolutions or preserve its position through an external quality change.</p>
                </>
              )}
            </Section>
            <Section icon={Server} label="Server" note={`${answered} of ${embeds.length} hosts answered the reachability probe; ${unknown} unchecked. A successful host response does not confirm this title, audio tracks or video resolutions.`}>
              {embeds.map((p) => {
                const verdict = health?.servers?.[p.id];
                const dead = verdict?.ok === false;
                const allowed = !subsOnly || p.subs;
                return <Row key={p.id} selected={p.id === server} onSelect={() => { onServer(p.id); onClose(); }} title={p.label}
                  sub={dead ? `Offline — ${verdict.reason}` : !allowed ? 'No advertised subtitle support' : `${cageNote(p)}${p.blurb}`}
                  disabled={!allowed} badge={<span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dead ? 'bg-gold' : verdict?.ok ? 'bg-lime' : 'bg-white/25'}`} />} />;
              })}
            </Section>
            <Section icon={HardDrive} label="Server preference" note="Ranks servers using their advertised ceiling, not the current stream. This does not change playback resolution or enable adaptive bitrate. Changes apply on the next server switch.">
              <div className="grid grid-cols-3 gap-1.5">
                {SERVER_PREFERENCES.map((p) => <button key={p.id} onClick={() => onQuality(p.id)} aria-pressed={preference?.id === p.id}
                  className={`rounded-xl border px-2 py-2 text-[11px] font-bold ${quality === p.id ? 'border-primary/55 bg-primary/[0.14] text-white' : 'border-white/[0.08] text-textSub hover:border-white/25'}`}>{p.label}</button>)}
              </div>
            </Section>
            <Section icon={Shield} label="Ad guard" note="A sandbox without pop-up permission blocks new tabs, but some hosts refuse to play inside it. Compatibility is provider-specific, not guaranteed. A frame that does not load may be retried without the sandbox; the player badge shows the actual guard state.">
              <Row selected={blockPopups} onSelect={() => onBlockPopups(true)} title="Prefer blocking ad tabs" sub="Sandbox compatible hosts; other hosts may still open tabs" />
              <Row selected={!blockPopups} onSelect={() => onBlockPopups(false)} title="Allow pop-ups from the player" sub="Only if needed; browser ad protection is separate" />
              <p className="px-1 text-[10.5px] leading-relaxed text-textMuted"><TriangleAlert className="mr-1 inline h-3 w-3" />AdShield removes recognized scripts but does not guarantee playback or complete ad blocking.</p>
            </Section>
            <Section icon={Subtitles} label="Subtitles" note="Subtitle support below is advertised by the host, not confirmed for this title. Selection and rendering happen inside its player.">
              <Row selected={!subsOnly} onSelect={() => onSubsOnly(false)} title="Any server" sub="Do not filter by advertised subtitle support" />
              <Row selected={subsOnly} onSelect={() => onSubsOnly(true)} title="Prefer servers advertising subtitles" sub={`${embeds.filter((p) => p.subs).length} of ${embeds.length} advertise support`} />
            </Section>
          </div>
        </motion.aside>
      </>}
    </AnimatePresence>
  );
}
