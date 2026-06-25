"use client"

import { useState, useEffect, useMemo } from "react";
import {
  Star,
  Cake,
  ChevronRight,
} from "lucide-react";
import Link from "next/link";
import { useUser, useFirestore, useAuth, useContacts } from "@/firebase";
import { doc, setDoc } from "firebase/firestore";
import { haptic } from "@/lib/telegram";
import { useTypewriter } from "@/hooks/use-typewriter";
import { useT, useLang } from "@/lib/i18n";

// Palette for contacts without avatars
const AVATAR_COLORS = [
  'var(--neo-accent)',
  'var(--neo-pink)',
  'var(--neo-green)',
  '#7C3AED',
  '#D97706',
  '#0891B2',
];

export default function Home() {
  const { user, isUserLoading } = useUser();
  const firestore = useFirestore();
  const auth = useAuth();
  const t = useT();
  const { lang } = useLang();
  const [greeting, setGreeting] = useState(t.home.greetDay);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const handleDevLogin = async () => {
    setIsLoggingIn(true);
    try {
      const { signInAnonymously } = await import('firebase/auth');
      const userCredential = await signInAnonymously(auth);
      const userDocRef = doc(firestore, 'users', userCredential.user.uid);
      await setDoc(userDocRef, {
        id: userCredential.user.uid,
        name: t.auth.devName,
        avatarUrl: '',
        totalContacts: 0,
        lastActive: new Date().toISOString(),
        language: 'ru',
        theme: 'light',
      }, { merge: true });
    } catch (err: any) {
      console.error(err);
      alert(t.auth.devLoginError(err.message));
    } finally {
      setIsLoggingIn(false);
    }
  };

  useEffect(() => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) setGreeting(t.home.greetMorning);
    else if (hour >= 12 && hour < 18) setGreeting(t.home.greetDay);
    else if (hour >= 18 && hour < 23) setGreeting(t.home.greetEvening);
    else setGreeting(t.home.greetNight);
  }, [t]);

  const { contacts, contactsLoading, profile, profileLoading } = useContacts();
  const isProfileLoading = profileLoading;

  const favoriteContacts = useMemo(() => contacts.filter(c => c.isFavorite), [contacts]);

  // Top 5 favorites by most recent interaction
  const topActiveFavorites = useMemo(() => {
    if (!favoriteContacts.length) return [];
    return [...favoriteContacts]
      .sort((a, b) => {
        const aTime = a.lastInteraction ? new Date(a.lastInteraction).getTime() : 0;
        const bTime = b.lastInteraction ? new Date(b.lastInteraction).getTime() : 0;
        return bTime - aTime;
      })
      .slice(0, 5);
  }, [favoriteContacts]);

  const contactsWithBirthdaysData = useMemo(() => contacts.filter(c => c.birthday), [contacts]);

  // Onboarding empty state / skeleton flags (derived from the shared contacts)
  const anyContactLoading = contactsLoading;
  const hasNoContacts = !contactsLoading && contacts.length === 0;

  const upcomingBirthdays = useMemo(() => {
    if (!contactsWithBirthdaysData) return [];
    const today = new Date();
    const currentYear = today.getFullYear();
    // Compare date-only: a birthday today must not be pushed to next year
    const startOfToday = new Date(currentYear, today.getMonth(), today.getDate());
    return contactsWithBirthdaysData
      .filter(c => c.birthday)
      .map(c => {
        const bday = new Date(c.birthday!);
        let nextBday = new Date(currentYear, bday.getMonth(), bday.getDate());
        if (nextBday < startOfToday) nextBday.setFullYear(currentYear + 1);
        return { ...c, nextBday, diff: nextBday.getTime() - startOfToday.getTime() };
      })
      .sort((a, b) => a.diff - b.diff)
      .slice(0, 4);
  }, [contactsWithBirthdaysData]);

  const firstName = useMemo(() => {
    const name = profile?.name || user?.displayName || "";
    return name.split(' ')[0];
  }, [user, profile]);

  const fullGreeting = useMemo(() => {
    if (isProfileLoading || !firstName) return "";
    return `${greeting}\n${firstName}`;
  }, [greeting, firstName, isProfileLoading]);

  const { displayed: typedText, isDone: typingDone } = useTypewriter(fullGreeting, 45);

  const typedLines = typedText.split('\n');
  const typedGreeting = typedLines[0] || "";
  const typedName = typedLines[1] || "";

  if (isUserLoading) return null;

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-6 text-center" style={{ backgroundColor: 'var(--neo-bg)' }}>
        <div className="neo-card p-8 max-w-sm w-full">
          <h1 className="neo-title text-center mb-2">
            <span className="block">JUST</span>
            <span className="block neo-title-accent">CONTACTS</span>
          </h1>
          <p className="neo-subtitle text-center mb-8">
            {t.auth.tagline}
          </p>
          <div style={{ borderTop: 'var(--neo-border-width) dashed var(--neo-border)', margin: '24px 0' }}></div>
          <p className="text-xs font-bold uppercase tracking-wider mb-4" style={{ color: 'var(--neo-hint)' }}>{t.auth.devMode}</p>
          <button onClick={handleDevLogin} disabled={isLoggingIn} className="neo-button-accent">
            {isLoggingIn ? (
              <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
            ) : (
              <>{t.auth.loginAsDev}</>
            )}
          </button>
        </div>
      </div>
    );
  }


  return (
    <div
      className="flex flex-col justify-center"
      style={{
        backgroundColor: 'var(--neo-bg)',
        minHeight: 'calc(var(--app-vh, 100vh) - 76px - env(safe-area-inset-bottom, 0px))',
        paddingBottom: '16px',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Decorative neobrutalist corner accents (behind content) */}
      <div
        aria-hidden
        style={{
          position: 'absolute', top: 0, left: 0, width: '150px', height: '150px',
          backgroundColor: 'var(--neo-yellow)',
          clipPath: 'polygon(0 0, 100% 0, 0 100%)',
          borderRight: 'var(--neo-border-width) solid var(--neo-border)',
          zIndex: 0, pointerEvents: 'none',
        }}
      />
      <div
        aria-hidden
        style={{
          position: 'absolute', bottom: 0, right: 0, width: '200px', height: '200px',
          backgroundColor: 'var(--neo-cyan)',
          clipPath: 'polygon(100% 0, 100% 100%, 0 100%)',
          zIndex: 0, pointerEvents: 'none',
        }}
      />

      {/* Greeting with typewriter */}
      <div className="px-4 pt-6 pb-4" style={{ position: 'relative', zIndex: 1 }}>
        <h1 className="neo-title" style={{ minHeight: '88px', fontSize: '38px', lineHeight: 1.1 }}>
          {typedGreeting}
          {typedGreeting && <br />}
          <span className="neo-title-accent">{typedName}</span>
          {!typingDone && (
            <span
              className="inline-block w-[3px] h-[34px] ml-1 animate-pulse"
              style={{ backgroundColor: 'var(--neo-accent)', verticalAlign: 'bottom' }}
            />
          )}
        </h1>
      </div>

      {/* Cards */}
      <div className="px-4 flex flex-col gap-3" style={{ position: 'relative', zIndex: 1 }}>

        {anyContactLoading ? (
          <>
            <div className="neo-card animate-pulse" style={{ height: '74px' }} />
            <div className="neo-card animate-pulse" style={{ height: '104px' }} />
          </>
        ) : hasNoContacts ? (
          <div className="neo-card p-6 flex flex-col items-center text-center gap-4">
            <div className="text-4xl">👋</div>
            <div>
              <p className="text-base font-black uppercase" style={{ color: 'var(--neo-text)' }}>{t.home.onboardTitle}</p>
              <p className="text-xs font-medium mt-2 leading-relaxed" style={{ color: 'var(--neo-hint)' }}>{t.home.onboardText}</p>
            </div>
            <Link href="/add" onClick={() => haptic('light')} className="neo-button-accent">
              {t.home.onboardCta}
            </Link>
          </div>
        ) : (
        <>
        {/* Birthdays card — compact */}
        <Link
          href="/birthdays"
          onClick={() => haptic('light')}
          className="neo-card-pink p-3 flex flex-col gap-2"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Cake className="w-4 h-4" />
              <span className="text-xs font-bold uppercase">{t.home.holidays}</span>
            </div>
            <ChevronRight className="w-4 h-4 opacity-70" />
          </div>

          {upcomingBirthdays.length > 0 ? (
            <div className="flex gap-3 justify-start">
              {upcomingBirthdays.map(c => {
                const dateLabel = new Date(c.birthday!).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'short' });
                const daysLeft = Math.ceil(c.diff / (1000 * 60 * 60 * 24));
                return (
                  <div key={c.id} className="flex flex-col items-center gap-1" style={{ width: '52px', flexShrink: 0 }}>
                    <div
                      className="w-full aspect-square flex items-center justify-center overflow-hidden"
                      style={{ border: '2px solid #fff', backgroundColor: c.avatarUrl ? 'transparent' : 'rgba(255,255,255,0.25)' }}
                    >
                      {c.avatarUrl ? (
                        <img src={c.avatarUrl} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-sm font-black text-white">{(c.firstName || c.name)[0].toUpperCase()}</span>
                      )}
                    </div>
                    <span className="text-[10px] font-bold text-center w-full truncate">{c.firstName || c.name.split(' ')[0]}</span>
                    <span className="text-[9px] font-medium opacity-80">{daysLeft === 0 ? t.home.today : dateLabel}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-[11px] font-medium opacity-60">{t.home.addBirthdays}</p>
          )}
        </Link>

        {/* Favorites card — header opens all, each avatar opens that contact */}
        <div className="neo-card p-3 flex flex-col gap-3">
          <Link href="/favorites" onClick={() => haptic('light')} className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Star className="w-4 h-4" style={{ color: 'var(--neo-yellow)' }} />
              <span className="text-xs font-bold uppercase" style={{ color: 'var(--neo-text)' }}>{t.home.favorites}</span>
            </div>
            <ChevronRight className="w-4 h-4" style={{ color: 'var(--neo-hint)' }} />
          </Link>

          {topActiveFavorites.length > 0 ? (
            <div className="flex gap-3 justify-start">
              {topActiveFavorites.map((c, idx) => (
                <Link key={c.id} href={`/contact/${c.id}`} onClick={() => haptic('light')} className="flex flex-col items-center gap-1" style={{ width: '52px', flexShrink: 0 }}>
                  <div
                    className="w-full aspect-square flex items-center justify-center overflow-hidden"
                    style={{
                      border: 'var(--neo-border-width) solid var(--neo-border)',
                      backgroundColor: c.avatarUrl ? 'transparent' : AVATAR_COLORS[idx % AVATAR_COLORS.length],
                    }}
                  >
                    {c.avatarUrl ? (
                      <img src={c.avatarUrl} alt={c.name} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-sm font-black text-white">
                        {(c.firstName || c.name)[0].toUpperCase()}
                      </span>
                    )}
                  </div>
                  <span
                    className="text-[10px] font-bold text-center w-full truncate"
                    style={{ color: 'var(--neo-text)' }}
                  >
                    {c.firstName || c.name.split(' ')[0]}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <Link href="/favorites" onClick={() => haptic('light')} className="text-[11px] font-medium" style={{ color: 'var(--neo-hint)' }}>
              {t.home.addFavorites}
            </Link>
          )}
        </div>
        </>
        )}

      </div>
    </div>
  );
}
