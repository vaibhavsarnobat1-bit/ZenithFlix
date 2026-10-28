import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLocation, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { ArrowLeft, Eye, EyeOff, User, Mail, Lock, Sparkles, AlertCircle } from 'lucide-react';
import { API } from '../lib/config';
import { spring } from '../lib/motion';
import Logo3D from '../components/Logo3D';

const Orb = ({ className, delay = 0 }) => (
  <motion.div
    className={`absolute rounded-full pointer-events-none blur-[100px] ${className}`}
    animate={{ opacity: [0.3, 0.6, 0.3], scale: [1, 1.1, 1] }}
    transition={{ duration: 6, repeat: Infinity, delay, ease: 'easeInOut' }}
  />
);

export default function Auth() {
  const [isLogin, setIsLogin] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState({ username: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');
  const navigate = useNavigate();
  const location = useLocation();
  const backTo = location.state?.from || '/';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const endpoint = isLogin ? '/auth/login' : '/auth/register';
      const payload = isLogin
        ? { email: formData.email, password: formData.password }
        : formData;

      const res = await axios.post(`${API}${endpoint}`, payload);
      localStorage.setItem('token', res.data.token);
      localStorage.setItem('user', JSON.stringify(res.data.user));

      setSuccess(isLogin ? 'Welcome back! Redirecting...' : 'Account created! Redirecting...');
      setTimeout(() => navigate(backTo, { replace: true }), 900);
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong. Try again.');
    } finally {
      setLoading(false);
    }
  };

  const set = (field) => (e) => {
    setFormData(prev => ({ ...prev, [field]: e.target.value }));
    setError('');
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center relative overflow-hidden p-4">
      {/* Background */}
      <Orb className="top-[-20%] right-[-10%] w-[600px] h-[600px] bg-primary/25" delay={0} />
      <Orb className="bottom-[-20%] left-[-15%] w-[700px] h-[700px] bg-secondary/20" delay={2} />
      <div className="absolute inset-0 cinema-grid opacity-100 pointer-events-none" />

      {/* Back button */}
      <motion.button
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        onClick={() => navigate('/')}
        className="absolute top-6 left-6 flex items-center gap-2 text-textMuted hover:text-white transition-colors text-sm font-medium"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Home
      </motion.button>

      {/* Card */}
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
        className="w-full max-w-md glass rounded-3xl shadow-cinema overflow-hidden"
        style={{ transformStyle: 'preserve-3d' }}
      >
        {/* Card top accent */}
        <div className="h-1 bg-gradient-to-r from-primary via-secondary to-accent" />

        <div className="p-8">
          {/* Logo */}
          <div className="mb-8 flex items-center justify-center">
            <Logo3D size="lg" />
          </div>

          {/* Tab switcher */}
          <div className="mb-8 flex rounded-2xl border border-white/[0.07] bg-black/35 p-1">
            {['Sign In', 'Sign Up'].map((tab, i) => {
              const active = isLogin ? i === 0 : i === 1;
              return (
                <button
                  key={tab}
                  onClick={() => { setIsLogin(i === 0); setError(''); setSuccess(''); }}
                  className={`relative flex-1 rounded-xl py-2.5 text-[13px] font-bold transition-colors ${active ? 'text-white' : 'text-textMuted hover:text-textSub'}`}
                >
                  {active && <motion.span layoutId="auth-tab" className="absolute inset-0 rounded-xl bg-ember-gradient" transition={spring.pop} />}
                  <span className="relative">{tab}</span>
                </button>
              );
            })}
          </div>

          {/* Success message */}
          <AnimatePresence>
            {success && (
              <motion.div
                initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                animate={{ opacity: 1, height: 'auto', marginBottom: 16 }}
                exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                className="flex items-center gap-2 p-3 bg-emerald-500/15 border border-emerald-500/30 rounded-xl text-emerald-400 text-sm"
              >
                <Sparkles className="w-4 h-4 flex-shrink-0" />
                {success}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Error message */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                animate={{ opacity: 1, height: 'auto', marginBottom: 16 }}
                exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                className="flex items-center gap-2 p-3 bg-red-500/15 border border-red-500/30 rounded-xl text-red-400 text-sm"
              >
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {error}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Form */}
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {/* Username (signup only) */}
            <AnimatePresence>
              {!isLogin && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  style={{ overflow: 'hidden' }}
                >
                  <div className="relative">
                    <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-textMuted" />
                    <input
                      type="text"
                      placeholder="Username"
                      value={formData.username}
                      onChange={set('username')}
                      required={!isLogin}
                      className="w-full glass-sm border border-white/8 focus:border-primary/60 rounded-xl pl-11 pr-4 py-3.5 text-white placeholder:text-textMuted/60 text-sm transition-all outline-none"
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Email */}
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-textMuted" />
              <input
                type="email"
                placeholder="Email Address"
                value={formData.email}
                onChange={set('email')}
                required
                className="w-full glass-sm border border-white/8 focus:border-primary/60 rounded-xl pl-11 pr-4 py-3.5 text-white placeholder:text-textMuted/60 text-sm transition-all outline-none"
              />
            </div>

            {/* Password */}
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-textMuted" />
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Password"
                value={formData.password}
                onChange={set('password')}
                required
                className="w-full glass-sm border border-white/8 focus:border-primary/60 rounded-xl pl-11 pr-12 py-3.5 text-white placeholder:text-textMuted/60 text-sm transition-all outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-textMuted hover:text-white transition-colors"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            {/* Submit */}
            <motion.button
              type="submit"
              disabled={loading}
              whileHover={{ scale: loading ? 1 : 1.015 }}
              whileTap={{ scale: loading ? 1 : 0.985 }}
              transition={spring.snappy}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-ember-gradient py-4 font-display text-[15px] font-extrabold text-white shadow-glow-md transition-shadow hover:shadow-glow-lg disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? (
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                <>
                  {isLogin ? 'Sign in' : 'Create a free account'}
                  <Sparkles className="h-4 w-4" />
                </>
              )}
            </motion.button>
          </form>

          {/* Divider */}
          <div className="my-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-white/[0.08]" />
            <span className="text-[11px] uppercase tracking-[0.16em] text-textMuted">no account needed</span>
            <div className="h-px flex-1 bg-white/[0.08]" />
          </div>

          {/* Guest mode */}
          <button
            onClick={() => navigate(backTo, { replace: true })}
            className="w-full rounded-2xl border border-white/10 bg-white/[0.03] py-3 text-[13px] font-semibold text-textSub transition-colors hover:border-primary/35 hover:text-white"
          >
            Skip — browse ZenithFlix as a guest
          </button>

          {/* Switch mode */}
          <p className="text-center mt-5 text-textMuted text-sm">
            {isLogin ? "Don't have an account? " : 'Already have an account? '}
            <button
              onClick={() => { setIsLogin(!isLogin); setError(''); setSuccess(''); }}
              className="text-primary hover:text-primaryLight font-semibold transition-colors"
            >
              {isLogin ? 'Sign Up Free' : 'Sign In'}
            </button>
          </p>
        </div>
      </motion.div>
    </div>
  );
}
