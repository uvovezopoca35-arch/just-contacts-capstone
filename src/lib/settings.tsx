'use client';

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { ThemeMode, getThemeMode, setStoredThemeMode, applyTheme } from '@/lib/theme';
import { unlockAudio, playSound } from '@/lib/sound';

const K_SOUND_EN = 'jc_sound_enabled';
const K_SOUND_VOL = 'jc_sound_volume';
const K_HAPTICS = 'jc_haptics';

interface SettingsValue {
  themeMode: ThemeMode;
  setThemeMode: (m: ThemeMode) => void;
  soundEnabled: boolean;
  setSoundEnabled: (b: boolean) => void;
  soundVolume: number;
  setSoundVolume: (v: number) => void;
  hapticsEnabled: boolean;
  setHapticsEnabled: (b: boolean) => void;
}

const SettingsContext = createContext<SettingsValue>({
  themeMode: 'system',
  setThemeMode: () => {},
  soundEnabled: true,
  setSoundEnabled: () => {},
  soundVolume: 0.5,
  setSoundVolume: () => {},
  hapticsEnabled: true,
  setHapticsEnabled: () => {},
});

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [themeMode, setThemeModeState] = useState<ThemeMode>('system');
  const [soundEnabled, setSoundEnabledState] = useState(true);
  const [soundVolume, setSoundVolumeState] = useState(0.5);
  const [hapticsEnabled, setHapticsEnabledState] = useState(true);

  useEffect(() => {
    setThemeModeState(getThemeMode());
    try { setSoundEnabledState(localStorage.getItem(K_SOUND_EN) !== '0'); } catch { /* ignore */ }
    try { const v = parseFloat(localStorage.getItem(K_SOUND_VOL) || '0.5'); if (!isNaN(v)) setSoundVolumeState(v); } catch { /* ignore */ }
    try { setHapticsEnabledState(localStorage.getItem(K_HAPTICS) !== '0'); } catch { /* ignore */ }

    // Unlock the Web Audio context on the first user gesture (iOS requirement)
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

  const setThemeMode = useCallback((m: ThemeMode) => {
    setThemeModeState(m);
    setStoredThemeMode(m);
    applyTheme(m);
  }, []);

  const setSoundEnabled = useCallback((b: boolean) => {
    setSoundEnabledState(b);
    try { localStorage.setItem(K_SOUND_EN, b ? '1' : '0'); } catch { /* ignore */ }
    if (b) playSound('success');
  }, []);

  const setSoundVolume = useCallback((v: number) => {
    setSoundVolumeState(v);
    try { localStorage.setItem(K_SOUND_VOL, String(v)); } catch { /* ignore */ }
  }, []);

  const setHapticsEnabled = useCallback((b: boolean) => {
    setHapticsEnabledState(b);
    try { localStorage.setItem(K_HAPTICS, b ? '1' : '0'); } catch { /* ignore */ }
  }, []);

  return (
    <SettingsContext.Provider
      value={{
        themeMode, setThemeMode,
        soundEnabled, setSoundEnabled,
        soundVolume, setSoundVolume,
        hapticsEnabled, setHapticsEnabled,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

export const useSettings = () => useContext(SettingsContext);
