import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  getLanguage,
  setLanguage as persistLanguage,
  getRegion,
  setRegion as persistRegion,
  myList,
  inList,
  toggleList,
  recent,
} from '../lib/config';

const PrefsContext = createContext(null);

/** Global list of "my list" listeners so every card re-renders on a toggle. */
function subscribeList(cb) {
  window.addEventListener('zf:list', cb);
  return () => window.removeEventListener('zf:list', cb);
}

export function PrefsProvider({ children }) {
  const [language, setLanguageState] = useState(getLanguage());
  const [region, setRegionState] = useState(getRegion());
  const [list, setList] = useState(() => myList());
  const [continueWatching, setContinueWatching] = useState(() => recent());

  // keep sibling tabs in sync
  useEffect(() => {
    const onStorage = (e) => {
      if (!e.key || e.key.startsWith('zf.')) {
        setList(myList());
        setContinueWatching(recent());
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setLanguage = useCallback((code) => {
    persistLanguage(code);
    setLanguageState(code);
  }, []);

  const setRegion = useCallback((code) => {
    persistRegion(code);
    setRegionState(code);
  }, []);

  const toggle = useCallback((title) => {
    const added = toggleList(title);
    setList(myList());
    window.dispatchEvent(new CustomEvent('zf:list'));
    return added;
  }, []);

  const refreshProgress = useCallback(() => setContinueWatching(recent()), []);

  const value = useMemo(
    () => ({
      language,
      region,
      setLanguage,
      setRegion,
      list,
      toggle,
      isInList: (id) => inList(id),
      continueWatching,
      refreshProgress,
      // bump to force every row to refetch after a locale change
      localeKey: `${language}|${region}`,
    }),
    [language, region, list, continueWatching, setLanguage, setRegion, toggle, refreshProgress]
  );

  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs() {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error('usePrefs must be used inside <PrefsProvider>');
  return ctx;
}

export { subscribeList };
