import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { LogoMark, SparkleStar } from './Logo3D';
import { splitLetters, letter } from '../lib/motion';

/* ─────────────────────────────────────────────────────────────
   IntroSplash — compact ~2s entry moment shown once per browser
   session: the brand pill pops in on a 3D plane over a dark
   cinema backdrop, the tagline types through, then the curtain
   lifts and the site begins. Click anywhere to skip instantly.
   ───────────────────────────────────────────────────────────── */
const SEEN_KEY = 'zenithflix-intro-seen';

const ENTER_MS = 550;   // pill swing-in
const HOLD_MS = 950;    // sit + glow
const EXIT_MS = 500;    // curtain fade

export default function IntroSplash() {
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState(() => {
    try {
      return sessionStorage.getItem(SEEN_KEY) ? 'gone' : 'enter';
    } catch {
      return 'enter';
    }
  });

  useEffect(() => {
    if (phase !== 'enter') return undefined;
    const t1 = setTimeout(() => setPhase('exit'), reduce ? 400 : ENTER_MS + HOLD_MS);
    const t2 = setTimeout(() => setPhase('gone'), reduce ? 650 : ENTER_MS + HOLD_MS + EXIT_MS);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [phase, reduce]);

  /* lock scroll while the curtain is up */
  useEffect(() => {
    if (phase === 'enter' || phase === 'exit') {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
    return undefined;
  }, [phase]);

  if (phase === 'gone') return null;

  const letters = splitLetters('ZenithFlix');

  return (
    <motion.div
      initial={{ opacity: 1 }}
      animate={{ opacity: phase === 'exit' ? 0 : 1 }}
      transition={{ duration: reduce ? 0.15 : EXIT_MS / 1000, ease: 'easeInOut' }}
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center overflow-hidden bg-[#05060d]"
      onClick={() => setPhase('exit')}
      role="presentation"
    >
      {/* cinema backdrop */}
      <div className="absolute inset-0 bg-[radial-gradient(110%_85%_at_50%_45%,rgba(24,49,94,0.5),rgba(5,6,13,1)_70%)]" />
      <div className="cinema-grid absolute inset-0 opacity-50" />

      {/* glow bloom under the pill */}
      <motion.span
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: [0.5, 1.2, 1], opacity: [0, 0.7, 0.5] }}
        transition={{ duration: reduce ? 0.3 : 1.3, ease: 'easeOut' }}
        className="absolute h-56 w-96 rounded-full bg-primary/25 blur-[100px]"
      />

      {/* the brand pill */}
      <motion.div
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 26, rotateX: -50, scale: 0.85, filter: 'blur(10px)' }}
        animate={phase === 'enter' ? { opacity: 1, y: 0, rotateX: 0, scale: 1, filter: 'blur(0px)' } : {}}
        transition={reduce ? { duration: 0.25 } : { type: 'spring', stiffness: 260, damping: 20, delay: 0.1 }}
        style={{ transformPerspective: 800 }}
        className="relative z-10 flex items-center gap-3 rounded-full border border-primary/40 bg-black/65 py-3 pl-3 pr-6 shadow-[0_0_0_1px_rgba(255,46,85,0.15),0_18px_50px_-12px_rgba(255,46,85,0.45)] backdrop-blur-xl"
      >
        <LogoMark size={38} />
        <span className="font-display text-[22px] font-extrabold tracking-tighter2 [perspective:600px]">
          {letters.map(({ ch, i }) => (
            <motion.span
              key={`${i}-${ch}`}
              custom={i}
              initial={reduce ? false : 'hidden'}
              animate="show"
              variants={letter}
              className={`inline-block [transform-style:preserve-3d] ${i < 6 ? 'text-white' : 'text-gradient-primary'}`}
            >
              {ch}
            </motion.span>
          ))}
        </span>
        <SparkleStar size={16} className="-mr-1 -mt-4" />
      </motion.div>

      {/* tagline */}
      <motion.p
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: reduce ? 0.2 : 0.75, duration: 0.4 }}
        className="relative z-10 mt-4 text-[10px] font-bold uppercase tracking-[0.45em] text-white/40"
      >
        Streaming Revolution
      </motion.p>
    </motion.div>
  );
}
