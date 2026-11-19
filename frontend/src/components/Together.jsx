/**
 * The "watch this with a friend" surface.
 *
 * Two pieces: the panel that builds the invitation, and the bar that stays over
 * the player while a session is live. Both read the same session object, which
 * Watch.jsx owns — the URL is the only thing travelling between the two phones,
 * so the state cannot live anywhere else.
 */
import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Copy, Link2, RefreshCw, Users, X } from 'lucide-react';
import { LEAD_CHOICES, countdown, humanTime } from '../lib/together';
import { copyText } from '../lib/invite';
import { spring, scrim } from '../lib/motion';
import { toast } from './ui';

/** One timer for the whole component tree, re-rendered only while a session lives. */
function useNow(active, interval = 250) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(id);
  }, [active, interval]);
  return now;
}

const leadLabel = (seconds) => LEAD_CHOICES.find((l) => l.seconds === seconds)?.label || `${seconds} sec`;

export function TogetherPanel({ open, onClose, label, type, season, episode, serverLabel, session, link, onStart, onLeave }) {
  const [lead, setLead] = useState(60);
  const [copied, setCopied] = useState(false);
  const now = useNow(Boolean(session) && session.startAt > Date.now());
  const state = session ? countdown(session.startAt, now) : null;

  useEffect(() => {
    if (!open) setCopied(false);
  }, [open]);

  const share = async () => {
    if (!link) return;
    try {
      await copyText(link);
      setCopied(true);
      toast('Link copied — send it to your friend');
    } catch (error) {
      toast(error.message || 'Select the link and copy it manually', { tone: 'warn', ttl: 6000 });
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div key="scrim" variants={scrim} initial="hidden" animate="show" exit="hide" onClick={onClose} className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-[3px]" />
          <motion.div
            key="panel"
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={spring.sheet}
            role="dialog"
            aria-label="Watch together"
            className="fixed left-1/2 top-1/2 z-[90] w-[calc(100vw-24px)] max-w-[460px] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-surface p-4 shadow-cinema sm:p-5"
          >
            <div className="mb-3 flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-secondary/20 text-secondary">
                <Users className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-display text-[15px] font-bold text-white">Watch together</p>
                <p className="truncate text-[11.5px] text-textMuted">
                  {label}
                  {type === 'tv' ? ` · S${season}E${episode}` : ''}
                  {serverLabel ? ` · ${serverLabel}` : ''}
                </p>
              </div>
              <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/12 text-textSub hover:border-white/30 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>

            <ol className="space-y-3.5">
              <li>
                <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-textMuted">1 · When do you both start?</p>
                <div className="flex flex-wrap gap-1.5">
                  {LEAD_CHOICES.map((l) => (
                    <button
                      key={l.seconds}
                      onClick={() => setLead(l.seconds)}
                      aria-pressed={lead === l.seconds}
                      className={`rounded-xl border px-3 py-1.5 text-[12px] font-bold transition-colors ${lead === l.seconds ? 'border-primary/55 bg-primary/[0.16] text-white' : 'border-white/10 text-textSub hover:border-white/25 hover:text-white'}`}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
              </li>

              <li>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-textMuted">{session ? '2 · Countdown' : '2 · Make the link'}</p>
                  {session && <span className="rounded-md bg-white/8 px-2 py-0.5 font-mono text-[11px] font-bold tracking-[0.18em] text-primaryLight">{session.code}</span>}
                </div>

                {session ? (
                  <div className="mt-2 rounded-xl border border-white/10 bg-white/[0.04] p-3">
                    <p className="font-display text-[22px] font-extrabold tabular text-white">
                      {state.phase === 'waiting' && `Starts in ${humanTime(state.seconds)}`}
                      {state.phase === 'go' && 'Press play now'}
                      {state.phase === 'after' && 'Already rolling'}
                    </p>
                    <p className="mt-1 text-[11.5px] leading-relaxed text-textSub">
                      {state.phase === 'waiting'
                        ? 'Keep this open. When it hits zero, both of you press play in the player.'
                        : state.phase === 'go'
                          ? 'Go — hit play on your phone and tell them to hit play too.'
                          : 'That moment passed. Start a new countdown, or just press play whenever you are ready.'}
                    </p>
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      <button onClick={() => onStart(lead, { keepCode: true })} className="flex items-center gap-1.5 rounded-xl border border-white/12 bg-white/[0.05] px-3 py-1.5 text-[11.5px] font-bold text-textSub hover:text-white">
                        <RefreshCw className="h-3 w-3" /> New countdown ({leadLabel(lead)})
                      </button>
                      <button onClick={share} className="flex items-center gap-1.5 rounded-xl border border-primary/50 bg-primary/[0.12] px-3 py-1.5 text-[11.5px] font-bold text-white hover:bg-primary/[0.2]">
                        {copied ? <Check className="h-3 w-3 text-lime" /> : <Copy className="h-3 w-3" />} {copied ? 'Copied' : 'Copy link again'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => onStart(lead)}
                    className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-[13px] font-bold text-white hover:bg-primaryLight"
                  >
                    <Link2 className="h-4 w-4" /> Make the link ({leadLabel(lead)})
                  </button>
                )}
              </li>

              {session && (
                <li>
                  <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-textMuted">3 · Send this</p>
                  <div className="flex gap-1.5">
                    <input
                      readOnly
                      value={link}
                      onFocus={(e) => e.target.select()}
                      className="min-w-0 flex-1 truncate rounded-xl border border-white/10 bg-black/30 px-2.5 py-2 text-[11.5px] text-textSub outline-none focus:border-primary/40"
                    />
                    <button onClick={share} className="shrink-0 rounded-xl border border-primary/50 bg-primary/[0.12] px-3 text-[11.5px] font-bold text-white hover:bg-primary/[0.2]">
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <p className="mt-1.5 text-[11.5px] leading-relaxed text-textSub">
                    Paste it into WhatsApp. They tap it, the same episode and server open on their phone, and this countdown is already on their screen.
                  </p>
                </li>
              )}
            </ol>

            <p className="mt-3.5 rounded-xl border border-white/[0.07] bg-white/[0.02] p-2.5 text-[11px] leading-relaxed text-textMuted">
              This syncs the moment you start, not the pause button — nobody can reach inside another player to stop it. If you drift apart, hit “New countdown” and start the scene again together.
            </p>

            {onLeave && session && (
              <button onClick={onLeave} className="mt-2 w-full rounded-xl border border-white/10 py-2 text-[11.5px] font-bold text-textMuted hover:text-white">
                Leave this session
              </button>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/**
 * The strip that stays above the player while a session is live, so neither
 * phone has to reopen the panel to know what time they were aiming for.
 */
export function TogetherBar({ session, isHost, label, type, season, episode, onNewCountdown, onOpen, onLeave }) {
  const future = session.startAt > Date.now();
  const now = useNow(future);
  const state = useMemo(() => countdown(session.startAt, now), [session.startAt, now]);
  const text =
    state.phase === 'waiting'
      ? `Starts in ${humanTime(state.seconds)}`
      : state.phase === 'go'
        ? 'Press play now'
        : `Started ${humanTime(state.seconds)} ago`;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={spring.soft}
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-secondary/30 bg-secondary/[0.08] px-3 py-2.5"
    >
      <Users className="h-4 w-4 shrink-0 text-secondary" />
      <span className="font-mono text-[11.5px] font-bold tracking-[0.18em] text-secondaryLight">{session.code}</span>
      <span className="text-[12.5px] font-bold tabular text-white">{text}</span>
      <span className="truncate text-[11.5px] text-textSub">
        {isHost ? 'Your invitation' : 'Joining a friend'} · {label}
        {type === 'tv' ? ` · S${season}E${episode}` : ''}
      </span>
      <div className="ml-auto flex items-center gap-1.5">
        <button onClick={onNewCountdown} className="flex items-center gap-1.5 rounded-lg border border-white/12 bg-white/[0.05] px-2.5 py-1.5 text-[11.5px] font-bold text-textSub hover:text-white">
          <RefreshCw className="h-3 w-3" /> New countdown
        </button>
        <button onClick={onOpen} className="rounded-lg border border-primary/50 bg-primary/[0.12] px-2.5 py-1.5 text-[11.5px] font-bold text-white hover:bg-primary/[0.2]">
          Link
        </button>
        <button onClick={onLeave} aria-label="Leave this session" className="grid h-7 w-7 place-items-center rounded-lg border border-white/12 text-textSub hover:text-white">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </motion.div>
  );
}
