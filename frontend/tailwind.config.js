/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // cinematic ink scale — deep enough that HDR-ish posters stay the loudest thing
        background: '#07070b',
        surface: '#0d0d14',
        surfaceHigh: '#14141d',
        surfaceLift: '#1b1b26',
        hairline: '#24242f',

        primary: '#ff2e55',
        primaryLight: '#ff6b85',
        primaryDeep: '#c81038',
        secondary: '#7c5cff',
        accent: '#22d3ee',
        gold: '#f5b13d',
        lime: '#7cf03d',

        textMain: '#f4f5f7',
        textSub: '#b6bac9',
        textMuted: '#8b8fa3',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Sora', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      letterSpacing: {
        tightest: '-0.045em',
        tighter2: '-0.06em',
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '0.875rem' }],
      },
      backgroundImage: {
        'ember-gradient': 'linear-gradient(100deg, #ff2e55 0%, #b5179e 55%, #7c5cff 100%)',
        'ink-fade': 'linear-gradient(to top, #07070b 0%, rgba(7,7,11,0.7) 35%, transparent 100%)',
        'left-fade': 'linear-gradient(to right, #07070b 0%, transparent 12%)',
        'scrim-x': 'linear-gradient(90deg, rgba(7,7,11,0.95) 0%, rgba(7,7,11,0.55) 32%, transparent 62%)',
        'scrim-both':
          'linear-gradient(180deg, rgba(7,7,11,0.86) 0%, rgba(7,7,11,0.2) 28%, rgba(7,7,11,0.35) 62%, #07070b 100%)',
      },
      transitionTimingFunction: {
        cinema: 'cubic-bezier(0.16, 1, 0.3, 1)',
        snap: 'cubic-bezier(0.2, 0.9, 0.2, 1)',
      },
      animation: {
        'grain-drift': 'grainDrift 7s steps(6) infinite',
        'shimmer': 'shimmer 1.6s linear infinite',
        'pulse-glow': 'pulseGlow 3.4s ease-in-out infinite',
        'ken-burns': 'kenBurns 26s ease-out forwards',
        'marquee': 'marquee 22s linear infinite',
        'rise-in': 'riseIn 0.5s cubic-bezier(0.16,1,0.3,1) both',
        'sheen': 'sheen 2.6s ease-in-out infinite',
        'focus-pull': 'focusPull 1.6s ease-in-out infinite',
        'eq': 'eq 1.1s ease-in-out infinite',
        'nudge-glow': 'nudgeGlow 1.8s ease-in-out infinite',
      },
      keyframes: {
        grainDrift: {
          '0%': { transform: 'translate(0,0)' },
          '25%': { transform: 'translate(-4%,3%)' },
          '50%': { transform: 'translate(3%,-4%)' },
          '75%': { transform: 'translate(-3%,-2%)' },
          '100%': { transform: 'translate(0,0)' },
        },
        shimmer: { '0%': { backgroundPosition: '-180% 0' }, '100%': { backgroundPosition: '180% 0' } },
        pulseGlow: { '0%,100%': { opacity: '0.35' }, '50%': { opacity: '0.75' } },
        kenBurns: {
          '0%': { transform: 'scale(1.04) translate3d(0,0,0)' },
          '100%': { transform: 'scale(1.14) translate3d(-1.5%,-1%,0)' },
        },
        marquee: { '0%': { transform: 'translateX(0)' }, '100%': { transform: 'translateX(-50%)' } },
        riseIn: { '0%': { opacity: '0', transform: 'translateY(14px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        sheen: {
          '0%,100%': { transform: 'translateX(-120%)' },
          '55%': { transform: 'translateX(160%)' },
        },
        focusPull: {
          '0%,100%': { opacity: '0.25', transform: 'scale(0.9)' },
          '50%': { opacity: '1', transform: 'scale(1)' },
        },
        eq: {
          '0%,100%': { transform: 'scaleY(0.35)' },
          '50%': { transform: 'scaleY(1)' },
        },
        nudgeGlow: {
          '0%,100%': { boxShadow: '0 0 0 0 rgba(229,9,20,0.0)' },
          '50%': { boxShadow: '0 0 22px 2px rgba(229,9,20,0.55)' },
        },
      },
      boxShadow: {
        'glow-sm': '0 0 18px rgba(255,46,85,0.28)',
        'glow-md': '0 0 34px rgba(255,46,85,0.38)',
        'glow-lg': '0 0 70px rgba(255,46,85,0.30)',
        'lift': '0 22px 60px -18px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.07)',
        'card': '0 6px 22px -8px rgba(0,0,0,0.7)',
        'cinema': '0 40px 120px -30px rgba(0,0,0,0.95)',
      },
      backdropBlur: { xs: '2px' },
    },
  },
  plugins: [],
};
