'use client';

import { useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { BottomSheet } from '@/components/bottom-sheet';
import { useT, useLang, Lang } from '@/lib/i18n';
import { useSettings } from '@/lib/settings';
import { ThemeMode } from '@/lib/theme';
import { useUser, useFirestore, useContacts } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { haptic, getTelegramWebApp } from '@/lib/telegram';
import { playSound } from '@/lib/sound';
import { Volume2, Vibrate, Cake, Clock } from 'lucide-react';

const APP_VERSION = '1.0';

function Switch({ checked, onChange }: { checked: boolean; onChange: (b: boolean) => void }) {
  return (
    <button
      onClick={() => { haptic('selection'); onChange(!checked); }}
      role="switch"
      aria-checked={checked}
      className="shrink-0"
      style={{
        width: '48px', height: '28px', position: 'relative',
        border: 'var(--neo-border-width) solid var(--neo-border)',
        backgroundColor: checked ? 'var(--neo-accent)' : 'var(--neo-chip-bg)',
        transition: 'background-color 0.15s',
      }}
    >
      <span
        style={{
          position: 'absolute', top: '2px', left: checked ? '22px' : '2px',
          width: '20px', height: '20px', backgroundColor: '#fff',
          border: '1.5px solid var(--neo-border)', transition: 'left 0.15s',
        }}
      />
    </button>
  );
}

function Segmented<T extends string>({ options, value, onChange }: {
  options: { v: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex overflow-hidden" style={{ border: 'var(--neo-border-width) solid var(--neo-border)' }}>
      {options.map((o, i) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className="flex-1 py-2 text-xs font-bold uppercase"
          style={{
            backgroundColor: value === o.v ? 'var(--neo-accent)' : 'var(--neo-surface)',
            color: value === o.v ? '#fff' : 'var(--neo-text)',
            borderLeft: i > 0 ? '1.5px solid var(--neo-border)' : 'none',
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const { lang, setLang } = useLang();
  const {
    themeMode, setThemeMode,
    soundEnabled, setSoundEnabled,
    soundVolume, setSoundVolume,
    hapticsEnabled, setHapticsEnabled,
  } = useSettings();
  const { user } = useUser();
  const firestore = useFirestore();
  const { profile } = useContacts();
  const { toast } = useToast();
  const [exporting, setExporting] = useState(false);

  const mirrorProfile = (data: Record<string, unknown>) => {
    if (user && firestore) {
      try { setDoc(doc(firestore, 'users', user.uid), data, { merge: true }); } catch { /* ignore */ }
    }
  };

  const changeLang = (l: Lang) => { setLang(l); mirrorProfile({ language: l }); haptic('selection'); };

  const birthdayOn = profile?.birthdayReminders !== false;
  const staleOn = profile?.staleReminders !== false;

  const handleExport = async () => {
    if (!user || exporting) return;
    setExporting(true);
    haptic('medium');
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'failed');
      }
      toast({ title: t.settings.exportSent });
      playSound('success');
      haptic('success');
    } catch (e: any) {
      const noContacts = (e?.message || '').includes('No contacts');
      toast({ title: noContacts ? t.settings.exportEmpty : t.settings.exportError, variant: 'destructive' });
      playSound('error');
      haptic('error');
    } finally {
      setExporting(false);
    }
  };

  return (
    <BottomSheet open={open} onClose={onClose} title={t.settings.title}>
      <div className="space-y-5">
        {/* Theme */}
        <div>
          <span className="neo-section-header block mb-2">{t.settings.theme}</span>
          <Segmented
            options={[
              { v: 'system', label: t.settings.themeSystem },
              { v: 'light', label: t.settings.themeLight },
              { v: 'dark', label: t.settings.themeDark },
            ]}
            value={themeMode}
            onChange={(v: ThemeMode) => { setThemeMode(v); haptic('selection'); }}
          />
        </div>

        {/* Language */}
        <div>
          <span className="neo-section-header block mb-2">{t.settings.language}</span>
          <Segmented
            options={[{ v: 'ru', label: 'RU' }, { v: 'en', label: 'EN' }]}
            value={lang}
            onChange={(v: Lang) => changeLang(v)}
          />
        </div>

        {/* Sound */}
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--neo-text)' }}><Volume2 className="w-4 h-4" /> {t.settings.sound}</span>
          <Switch checked={soundEnabled} onChange={setSoundEnabled} />
        </div>
        {soundEnabled && (
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-bold uppercase shrink-0" style={{ color: 'var(--neo-hint)' }}>{t.settings.soundVolume}</span>
            <input
              type="range" min={0} max={100} step={1}
              value={Math.round(soundVolume * 100)}
              onChange={e => setSoundVolume(parseInt(e.target.value, 10) / 100)}
              onPointerUp={() => playSound('success')}
              className="flex-1"
              style={{ accentColor: 'var(--neo-accent)' }}
            />
          </div>
        )}

        {/* Haptics */}
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--neo-text)' }}><Vibrate className="w-4 h-4" /> {t.settings.haptics}</span>
          <Switch checked={hapticsEnabled} onChange={setHapticsEnabled} />
        </div>

        {/* Reminders */}
        <div>
          <span className="neo-section-header block mb-2">{t.settings.reminders}</span>
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--neo-text)' }}><Cake className="w-4 h-4" /> {t.settings.birthdayReminders}</span>
              <Switch checked={birthdayOn} onChange={b => mirrorProfile({ birthdayReminders: b })} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--neo-text)' }}><Clock className="w-4 h-4" /> {t.settings.staleReminders}</span>
              <Switch checked={staleOn} onChange={b => mirrorProfile({ staleReminders: b })} />
            </div>
          </div>
        </div>

        {/* Data */}
        <div>
          <span className="neo-section-header block mb-2">{t.settings.data}</span>
          <button onClick={handleExport} disabled={exporting} className="neo-button-secondary w-full justify-center py-3">
            {exporting ? t.settings.exporting : t.settings.exportContacts}
          </button>
        </div>

        {/* About */}
        <div className="pt-3 flex items-center justify-between" style={{ borderTop: '1.5px solid var(--neo-separator)' }}>
          <button
            onClick={() => { haptic('light'); getTelegramWebApp()?.close(); }}
            className="text-xs font-bold uppercase"
            style={{ color: 'var(--neo-accent)' }}
          >
            {t.settings.openBot}
          </button>
          <span className="text-xs font-medium" style={{ color: 'var(--neo-hint)' }}>
            {t.settings.version} {APP_VERSION}
          </span>
        </div>
      </div>
    </BottomSheet>
  );
}
