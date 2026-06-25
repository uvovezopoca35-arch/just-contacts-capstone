/**
 * Telegram WebApp utility layer.
 * Wraps window.Telegram.WebApp with safe accessors and TypeScript helpers.
 */

/* ---------- Types ---------- */
export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  photo_url?: string;
}

export interface ThemeParams {
  bg_color?: string;
  text_color?: string;
  hint_color?: string;
  link_color?: string;
  button_color?: string;
  button_text_color?: string;
  secondary_bg_color?: string;
  header_bg_color?: string;
  accent_text_color?: string;
  section_bg_color?: string;
  section_header_text_color?: string;
  subtitle_text_color?: string;
  destructive_text_color?: string;
  section_separator_color?: string;
  bottom_bar_bg_color?: string;
}

export interface WebApp {
  initData: string;
  initDataUnsafe: {
    query_id?: string;
    user?: TelegramUser;
    auth_date?: number;
    hash?: string;
  };
  version: string;
  platform: string;
  colorScheme: 'light' | 'dark';
  themeParams: ThemeParams;
  isExpanded: boolean;
  viewportHeight: number;
  viewportStableHeight: number;
  isClosingConfirmationEnabled: boolean;
  headerColor: string;
  backgroundColor: string;
  bottomBarColor: string;
  BackButton: {
    isVisible: boolean;
    show: () => void;
    hide: () => void;
    onClick: (cb: () => void) => void;
    offClick: (cb: () => void) => void;
  };
  MainButton: {
    text: string;
    color: string;
    textColor: string;
    isVisible: boolean;
    isActive: boolean;
    isProgressVisible: boolean;
    setText: (text: string) => void;
    onClick: (cb: () => void) => void;
    offClick: (cb: () => void) => void;
    show: () => void;
    hide: () => void;
    enable: () => void;
    disable: () => void;
    showProgress: (leaveActive?: boolean) => void;
    hideProgress: () => void;
    setParams: (params: Record<string, any>) => void;
  };
  HapticFeedback: {
    impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
    notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
    selectionChanged: () => void;
  };
  safeAreaInset: { top: number; bottom: number; left: number; right: number };
  contentSafeAreaInset: { top: number; bottom: number; left: number; right: number };
  ready: () => void;
  expand: () => void;
  close: () => void;
  enableClosingConfirmation: () => void;
  disableClosingConfirmation: () => void;
  setHeaderColor: (color: string) => void;
  setBackgroundColor: (color: string) => void;
  setBottomBarColor: (color: string) => void;
  showPopup: (params: { title?: string; message: string; buttons?: any[] }, cb?: (id: string) => void) => void;
  showAlert: (message: string, cb?: () => void) => void;
  showConfirm: (message: string, cb?: (ok: boolean) => void) => void;
  openLink: (url: string, options?: { try_instant_view?: boolean }) => void;
  openTelegramLink: (url: string) => void;
  disableVerticalSwipes: () => void;
  enableVerticalSwipes: () => void;
  isVersionAtLeast: (version: string) => boolean;
  onEvent: (event: string, cb: (...args: any[]) => void) => void;
  offEvent: (event: string, cb: (...args: any[]) => void) => void;
}

declare global {
  interface Window {
    Telegram?: { WebApp: WebApp };
  }
}

/* ---------- Helpers ---------- */

/** Returns the Telegram WebApp object, or null outside Telegram */
export function getTelegramWebApp(): WebApp | null {
  if (typeof window === 'undefined') return null;
  return window.Telegram?.WebApp ?? null;
}

/** Check if running inside Telegram Mini App */
export function isTelegramMiniApp(): boolean {
  const tg = getTelegramWebApp();
  return !!(tg && tg.initData && tg.initData.length > 0);
}

/** Get the current Telegram user (from unsigned init data — use for display only) */
export function getTelegramUser(): TelegramUser | null {
  return getTelegramWebApp()?.initDataUnsafe?.user ?? null;
}

/** Haptic feedback shortcut (respects the user's haptics setting) */
export function haptic(type: 'light' | 'medium' | 'heavy' | 'success' | 'error' | 'warning' | 'selection') {
  try { if (localStorage.getItem('jc_haptics') === '0') return; } catch { /* ignore */ }

  const tg = getTelegramWebApp();
  // Telegram's HapticFeedback API only exists on Bot API 6.1+. On older clients
  // (e.g. 6.0) it silently no-ops, so we fall back to the Web Vibration API.
  let usedTelegram = false;
  if (tg && tg.HapticFeedback) {
    const supported = !tg.isVersionAtLeast || tg.isVersionAtLeast('6.1');
    if (supported) {
      try {
        if (type === 'selection') {
          tg.HapticFeedback.selectionChanged();
        } else if (type === 'success' || type === 'error' || type === 'warning') {
          tg.HapticFeedback.notificationOccurred(type);
        } else {
          tg.HapticFeedback.impactOccurred(type as 'light' | 'medium' | 'heavy');
        }
        usedTelegram = true;
      } catch { /* fall through to Web Vibration */ }
    }
  }

  if (!usedTelegram) {
    try {
      const patterns: Record<string, number | number[]> = {
        light: 10, medium: 18, heavy: 28, selection: 8,
        success: [12, 40, 12], warning: [20, 50, 20], error: [30, 50, 30],
      };
      navigator.vibrate?.(patterns[type] ?? 12);
    } catch { /* no vibration support (e.g. iOS Safari) */ }
  }
}

/** Apply Telegram colorScheme as data-theme on <html> and set native Telegram chrome colors */
export function applyTelegramTheme() {
  const tg = getTelegramWebApp();
  if (!tg) return;
  const root = document.documentElement;

  // Set data-theme for CSS neobrutalism tokens
  const isDark = tg.colorScheme === 'dark';
  root.setAttribute('data-theme', isDark ? 'dark' : 'light');

  // Match Telegram chrome to our neobrutalism palette
  try {
    tg.setBackgroundColor(isDark ? '#121212' : '#FFFFFF');
    tg.setHeaderColor(isDark ? '#121212' : '#FFFFFF');
    if (typeof tg.setBottomBarColor === 'function') {
      tg.setBottomBarColor(isDark ? '#161616' : '#FFFFFF');
    }
  } catch { /* not supported on all platforms */ }
}

/** Apply theme for dev mode (outside Telegram) */
export function applyDevTheme() {
  if (typeof window === 'undefined') return;
  const root = document.documentElement;
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');

  // Listen for OS-level theme changes
  const handler = (e: MediaQueryListEvent) => {
    root.setAttribute('data-theme', e.matches ? 'dark' : 'light');
  };
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', handler);
}
