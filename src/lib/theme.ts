/**
 * Theme mode handling. Three modes:
 *  - 'system' — follow Telegram colorScheme (or OS preference in dev)
 *  - 'light' / 'dark' — explicit override
 * The chosen mode is persisted in localStorage and applied as data-theme on
 * <html>, plus the native Telegram chrome colors are matched.
 */
import { getTelegramWebApp } from '@/lib/telegram';

export type ThemeMode = 'system' | 'light' | 'dark';

const KEY = 'jc_theme';

export function getThemeMode(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch { /* ignore */ }
  return 'system';
}

export function setStoredThemeMode(mode: ThemeMode) {
  try { localStorage.setItem(KEY, mode); } catch { /* ignore */ }
}

/** Resolve whether the effective theme should be dark for a given mode. */
export function resolveDark(mode: ThemeMode): boolean {
  if (mode === 'dark') return true;
  if (mode === 'light') return false;
  const tg = getTelegramWebApp();
  if (tg && tg.colorScheme) return tg.colorScheme === 'dark';
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  return false;
}

/** Apply the given (or stored) theme mode to the document + Telegram chrome. */
export function applyTheme(mode: ThemeMode = getThemeMode()) {
  if (typeof document === 'undefined') return;
  const isDark = resolveDark(mode);
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');

  const tg = getTelegramWebApp();
  if (tg) {
    try {
      tg.setBackgroundColor(isDark ? '#121212' : '#FFFFFF');
      tg.setHeaderColor(isDark ? '#121212' : '#FFFFFF');
      if (typeof tg.setBottomBarColor === 'function') {
        tg.setBottomBarColor(isDark ? '#161616' : '#FFFFFF');
      }
    } catch { /* not supported on all platforms */ }
  }
}
