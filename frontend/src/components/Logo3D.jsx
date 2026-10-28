import { motion } from 'framer-motion';
import mark from '../assets/logo-mark.png';
import { spring } from '../lib/motion';

/* ─────────────────────────────────────────────────────────────
   SparkleStar — the Gemini-style four-point spark from the brand
   logo (it sits over the "i" in the original artwork). Twinkles
   on a slow keyframe loop wherever the wordmark appears.
   ───────────────────────────────────────────────────────────── */
export function SparkleStar({ size = 14, className = '' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden
      className={`sparkle-star pointer-events-none ${className}`}
      style={{ filter: 'drop-shadow(0 0 6px rgba(245,177,61,0.7))' }}
    >
      <defs>
        <linearGradient id="zf-spark" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffd479" />
          <stop offset="0.55" stopColor="#f5b13d" />
          <stop offset="1" stopColor="#ff8a3d" />
        </linearGradient>
      </defs>
      <path
        d="M12 0 C13.1 7.2 16.8 10.9 24 12 C16.8 13.1 13.1 16.8 12 24 C10.9 16.8 7.2 13.1 0 12 C7.2 10.9 10.9 7.2 12 0 Z"
        fill="url(#zf-spark)"
      />
    </svg>
  );
}

/* ─────────────────────────────────────────────────────────────
   Logo3D — the brand emblem (Z mark) + wordmark, with a 3D
   personality everywhere it appears:
   · idle: gentle float + slow sheen sweep
   · hover: full 3D barrel-flip of the emblem tile
   Purely presentational — click/route behaviour stays with the
   parent button/link that wraps it.
   ───────────────────────────────────────────────────────────── */
export function LogoMark({ size = 36, className = '' }) {
  return (
    <motion.span
      whileHover={{ rotateY: 360, scale: 1.08 }}
      transition={{ duration: 0.8, ease: [0.3, 1.2, 0.4, 1] }}
      style={{ transformPerspective: 500, width: size, height: size }}
      className={`relative inline-block flex-shrink-0 overflow-hidden rounded-[10px] border border-white/10 shadow-glow-sm ${className}`}
    >
      <img src={mark} alt="" draggable={false} className="h-full w-full object-cover" />
      {/* slow diagonal sheen sweeping across the emblem */}
      <span className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 -skew-x-12 bg-gradient-to-r from-transparent via-white/25 to-transparent [animation:sheen_3.4s_ease-in-out_infinite]" />
    </motion.span>
  );
}

export default function Logo3D({ compact = false, size = 'md' }) {
  const box = size === 'lg' ? 44 : size === 'sm' ? 28 : 34;
  const text = size === 'lg' ? 'text-[26px]' : size === 'sm' ? 'text-[16px]' : 'text-[19px]';
  return (
    <motion.div
      initial={{ opacity: 0, y: 8, filter: 'blur(6px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={spring.soft}
      className="flex items-center gap-2.5"
    >
      <LogoMark size={box} className="animate-float-idle" />
      <span
        className={`font-display ${text} font-extrabold tracking-tighter2 title-3d transition-colors duration-300 ${
          compact ? 'text-white' : 'text-gradient-primary'
        }`}
      >
        Zenith<span className="text-white/85">Flix</span>
      </span>
      <SparkleStar size={size === 'lg' ? 18 : size === 'sm' ? 11 : 14} className="-ml-1 -mt-3" />
    </motion.div>
  );
}
