'use client';

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { getTelegramWebApp, isTelegramMiniApp } from '@/lib/telegram';
import { applyTheme } from '@/lib/theme';

interface TelegramContextValue {
  isInTelegram: boolean;
  colorScheme: 'light' | 'dark';
  platform: string;
}

const TelegramContext = createContext<TelegramContextValue>({
  isInTelegram: false,
  colorScheme: 'light',
  platform: 'unknown',
});

export const useTelegram = () => useContext(TelegramContext);

export function TelegramProvider({ children }: { children: ReactNode }) {
  const [ctx, setCtx] = useState<TelegramContextValue>({
    isInTelegram: false,
    colorScheme: 'light',
    platform: 'unknown',
  });

  useEffect(() => {
    const tg = getTelegramWebApp();

    if (!tg || !tg.initData) {
      // Dev mode — honour the stored theme mode (system => OS preference)
      applyTheme();
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      setCtx({
        isInTelegram: false,
        colorScheme: prefersDark ? 'dark' : 'light',
        platform: 'dev',
      });
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const osHandler = () => applyTheme();
      mq.addEventListener('change', osHandler);
      return () => mq.removeEventListener('change', osHandler);
    }

    // Telegram mode
    tg.ready();
    tg.expand();
    try { tg.disableVerticalSwipes(); } catch {}

    // Expose Telegram's *stable* viewport height (excludes the keyboard) as a CSS
    // variable. Pages size their container off this instead of `100vh`, so the
    // layout — and the decorative background triangle pinned to it — does not
    // shrink/jump when the on-screen keyboard opens (Telegram resizes the webview
    // on Android, which makes raw `100vh` collapse).
    const applyViewport = () => {
      try {
        document.documentElement.style.setProperty('--app-vh', `${tg.viewportStableHeight}px`);
      } catch {}
    };
    applyViewport();
    tg.onEvent('viewportChanged', applyViewport);

    // Apply theme (stored mode; 'system' follows Telegram colorScheme)
    applyTheme();

    setCtx({
      isInTelegram: isTelegramMiniApp(),
      colorScheme: tg.colorScheme,
      platform: tg.platform,
    });

    // Re-apply when Telegram's theme changes (only affects 'system' mode)
    const handleThemeChange = () => {
      applyTheme();
      setCtx(prev => ({
        ...prev,
        colorScheme: tg.colorScheme,
      }));
    };
    tg.onEvent('themeChanged', handleThemeChange);

    return () => {
      tg.offEvent('themeChanged', handleThemeChange);
      tg.offEvent('viewportChanged', applyViewport);
    };
  }, []);

  return (
    <TelegramContext.Provider value={ctx}>
      {children}
    </TelegramContext.Provider>
  );
}
