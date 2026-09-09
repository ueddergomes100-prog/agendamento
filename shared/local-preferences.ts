/** Device-local preferences. Never used as authorization or booking availability. */
export function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw) as T;
  } catch { return fallback; }
}

export function writeLocal(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Keep this session usable when storage is unavailable. */ }
}

export function preferenceKey(salonId: string, userId: string | undefined, name: string) {
  return `bella.preference.${salonId}.${userId || 'guest'}.${name}`;
}
