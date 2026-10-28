export const validRoomId = (id) => typeof id === 'string' && /^[a-f0-9]{32}$/.test(id);

function localHost(host) {
  const name = host.toLowerCase();
  return name === 'localhost' || name === '[::1]' || name === '::1'
    || name.endsWith('.localhost') || name.endsWith('.local') || name.endsWith('.test') || name.endsWith('.internal')
    || !name.includes('.') || /^(127|10|0)\./.test(name)
    || /^192\.168\./.test(name) || /^172\.(1[6-9]|2\d|3[01])\./.test(name)
    || /^169\.254\./.test(name) || /^\[f[cd]/i.test(name);
}

/** No source/title query or private host/resume token belongs in an invitation. */
export function partyInvite(roomId, actualOrigin, configuredOrigin = '') {
  if (!validRoomId(roomId)) return { url: '', isPublic: false, reason: 'Invalid or expired invitation format.' };
  try {
    const origin = new URL(configuredOrigin || actualOrigin);
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password
      || origin.search || origin.hash || origin.pathname !== '/') throw new Error('Invalid origin');
    const isPublic = origin.protocol === 'https:' && !localHost(origin.hostname);
    return {
      url: `${origin.origin}/room/${roomId}`,
      isPublic,
      reason: isPublic ? '' : 'Local development link only. Your friend on another network needs the deployed HTTPS website and a publicly reachable backend.',
    };
  } catch {
    return { url: '', isPublic: false, reason: 'Configure VITE_PUBLIC_WEB_ORIGIN with the deployed HTTPS origin, without a path or credentials.' };
  }
}

/** Called from a user click; legacy fallback covers clipboard-restricted browsers. */
export async function copyText(text) {
  if (!text) throw new Error('No invitation URL is available.');
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Try the browser's legacy user-gesture clipboard route below.
  }
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.append(field);
  field.select();
  let copied = false;
  try { copied = document.execCommand('copy'); } catch { /* Clipboard can be blocked. */ }
  finally { field.remove(); }
  if (!copied) throw new Error('Clipboard unavailable. Select and copy the displayed invitation URL.');
}
