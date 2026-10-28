import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Star, X } from 'lucide-react';
import { spring } from '../lib/motion';

/* ── small chrome pieces ───────────────────────────────────── */

export function Badge({ children, tone = 'muted', className = '', title }) {
  const tones = {
    muted: 'text-textSub border-white/[0.12] bg-white/[0.04]',
    ember: 'text-primaryLight border-primary/40 bg-primary/10',
    violet: 'text-secondary border-secondary/40 bg-secondary/10',
    gold: 'text-gold border-gold/40 bg-gold/10',
    live: 'text-lime border-lime/40 bg-lime/10',
    cyan: 'text-accent border-accent/40 bg-accent/10',
  };
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide tabular ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function RatingRing({ value, size = 40 }) {
  const v = typeof value === 'number' ? value : Number(value) || 0;
  const pct = Math.min(100, Math.max(0, (v / 10) * 100));
  const r = size / 2 - 3;
  const c = 2 * Math.PI * r;
  const hue = v >= 8 ? 145 : v >= 6.5 ? 90 : v >= 5 ? 40 : 355;
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }} title={`${v.toFixed(1)} / 10 on TMDB`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.12)" strokeWidth="3" fill="none" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={`hsl(${hue} 82% 60%)`}
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c - (pct / 100) * c }}
          transition={{ ...spring.soft, delay: 0.15 }}
        />
      </svg>
      <span className="absolute tabular font-bold text-white" style={{ fontSize: size * 0.28 }}>
        {v.toFixed(1)}
      </span>
    </div>
  );
}

export function Spinner({ size = 18, className = '' }) {
  return (
    <span
      className={`inline-block animate-spin rounded-full border-2 border-white/20 border-t-primary ${className}`}
      style={{ width: size, height: size }}
      aria-label="Loading"
    />
  );
}

export function PosterFallback({ label }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-surfaceHigh px-2 text-center">
      <Star className="h-5 w-5 text-white/12" />
      <span className="line-clamp-2 text-2xs leading-tight text-textMuted">{label || 'No artwork'}</span>
    </div>
  );
}

/** Image that swaps itself out for a graceful fallback when TMDB 404s a path. */
export function SmartImage({ src, alt, className = '', fallbackLabel, imgClassName = '', loading = 'lazy' }) {
  const [failed, setFailed] = useState(!src);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setFailed(!src);
    setLoaded(false);
  }, [src]);

  return (
    <div className={`relative overflow-hidden bg-surfaceHigh ${className}`}>
      {!failed && (
        <motion.img
          src={src}
          alt={alt}
          loading={loading}
          decoding="async"
          onError={() => setFailed(true)}
          onLoad={() => setLoaded(true)}
          initial={{ opacity: 0, scale: 1.06 }}
          animate={{ opacity: loaded ? 1 : 0, scale: loaded ? 1 : 1.06 }}
          transition={spring.soft}
          className={`h-full w-full object-cover ${imgClassName}`}
        />
      )}
      {!loaded && !failed && <div className="absolute inset-0 shimmer" />}
      {failed && <PosterFallback label={fallbackLabel || alt} />}
    </div>
  );
}

export function SectionHeading({ kicker, title, right, id }) {
  return (
    <div id={id} className="mb-3 flex items-end justify-between gap-4 px-[4vw]">
      <div>
        {kicker && <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-primary">{kicker}</div>}
        <h2 className="font-display text-lg font-bold text-white sm:text-xl">{title}</h2>
      </div>
      {right}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, hint, action }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 22, rotateX: -10, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, rotateX: 0, scale: 1 }}
      transition={{ ...spring.soft, transformPerspective: 900 }}
      className="mx-[4vw] grid place-items-center rounded-3xl border border-dashed border-white/10 bg-white/[0.02] px-6 py-14 text-center"
    >
      {Icon && <Icon className="icon-bob mb-3 h-7 w-7 text-white/20" />}
      <p className="font-display text-base font-semibold text-white">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-sm text-textMuted">{hint}</p>}
      {action && <div className="mt-5">{action}</div>}
    </motion.div>
  );
}

/** Sliding pill used by every segmented control (layoutId keeps it shared). */
export function SegmentedTabs({ options, value, onChange, layoutId = 'pill', size = 'md' }) {
  const pad = size === 'sm' ? 'px-2.5 py-1 text-[11px]' : 'px-3.5 py-1.5 text-xs';
  return (
    <div className="inline-flex items-center gap-0.5 rounded-xl border border-white/10 bg-black/45 p-1 backdrop-blur-md">
      {options.map((o) => {
        const active = o.id === value;
        return (
          <motion.button
            key={o.id}
            onClick={() => onChange(o.id)}
            title={o.hint}
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.93 }}
            transition={spring.snappy}
            className={`relative rounded-lg font-semibold transition-colors ${pad} ${active ? 'text-white' : 'text-textMuted hover:text-textSub'}`}
          >
            {active && (
              <motion.span
                layoutId={`${layoutId}-${o.group || 'default'}`}
                className="absolute inset-0 rounded-lg bg-ember-gradient shadow-glow-sm"
                transition={spring.pop}
              />
            )}
            <span className="relative z-10 flex items-center justify-center gap-1.5 whitespace-nowrap">
              {o.icon}
              {o.label}
              {o.off && <span className="h-1.5 w-1.5 animate-pulse-glow rounded-full bg-gold" title="server offline" />}
            </span>
          </motion.button>
        );
      })}
    </div>
  );
}

/* ── toasts ────────────────────────────────────────────────── */

let toastSeq = 0;
const listeners = new Set();
const queue = [];

export function toast(message, opts = {}) {
  const entry = { id: ++toastSeq, message, tone: opts.tone || 'default', icon: opts.icon, ttl: opts.ttl || 2600, ...opts };
  queue.push(entry);
  listeners.forEach((cb) => cb([...queue]));
  setTimeout(() => {
    const idx = queue.findIndex((t) => t.id === entry.id);
    if (idx > -1) {
      queue.splice(idx, 1);
      listeners.forEach((cb) => cb([...queue]));
    }
  }, entry.ttl);
}

export function ToastHost() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    listeners.add(setItems);
    setItems([...queue]);
    return () => listeners.delete(setItems);
  }, []);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[120] flex flex-col items-center gap-2 px-4">
      <AnimatePresence>
        {items.map((t) => {
          const Icon = t.icon || Check;
          return (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 24, rotateX: -35, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, rotateX: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, rotateX: 20, scale: 0.95 }}
              transition={{ ...spring.pop, transformPerspective: 700 }}
              className="pointer-events-auto flex items-center gap-2.5 rounded-full border border-white/12 bg-black/85 px-4 py-2.5 text-sm font-medium text-white shadow-lift backdrop-blur-xl"
            >
              <span className={`grid h-5 w-5 place-items-center rounded-full ${t.tone === 'warn' ? 'bg-gold/20 text-gold' : 'bg-primary/20 text-primaryLight'}`}>
                <Icon className="h-3 w-3" />
              </span>
              {t.message}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

export function CloseButton({ onClick, label = 'Close' }) {
  return (
    <motion.button
      onClick={onClick}
      aria-label={label}
      whileTap={{ scale: 0.88 }}
      whileHover={{ scale: 1.06, rotate: 90 }}
      transition={spring.snappy}
      className="grid h-9 w-9 place-items-center rounded-full border border-white/12 bg-black/55 text-white/80 backdrop-blur-md transition-colors hover:bg-black/75 hover:text-white"
    >
      <X className="h-4 w-4" />
    </motion.button>
  );
}
