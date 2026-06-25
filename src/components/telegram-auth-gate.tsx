'use client';

import React, { useEffect, useState, ReactNode } from 'react';
import { signInWithCustomToken } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { useAuth, useFirestore } from '@/firebase';
import { useUser } from '@/firebase';
import { getTelegramWebApp, isTelegramMiniApp, getTelegramUser } from '@/lib/telegram';
import { useT } from '@/lib/i18n';

interface Props {
  children: ReactNode;
}

/**
 * Gate component that handles Telegram → Firebase authentication.
 * Shows a loading spinner while authenticating.
 * If not in Telegram, allows pass-through (for dev mode with Google Auth).
 */
export function TelegramAuthGate({ children }: Props) {
  const auth = useAuth();
  const firestore = useFirestore();
  const { user, isUserLoading } = useUser();
  const t = useT();
  const [authState, setAuthState] = useState<'checking' | 'authenticating' | 'done' | 'error'>('checking');
  const [error, setError] = useState('');

  useEffect(() => {
    // If user is already signed in (e.g. persisted session), skip auth
    if (user) {
      setAuthState('done');
      return;
    }

    // If still loading Firebase auth state, wait
    if (isUserLoading) return;

    // If not in Telegram, allow pass-through for development
    if (!isTelegramMiniApp()) {
      setAuthState('done');
      return;
    }

    // Authenticate via Telegram initData
    const authenticate = async () => {
      setAuthState('authenticating');
      try {
        const tg = getTelegramWebApp();
        if (!tg || !tg.initData) {
          setAuthState('done');
          return;
        }

        const response = await fetch('/api/auth/telegram', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ initData: tg.initData }),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || `Auth failed: ${response.status}`);
        }

        const { customToken, user: tgUser } = await response.json();

        // Sign in to Firebase with custom token
        const userCredential = await signInWithCustomToken(auth, customToken);

        // Create/update user profile in Firestore
        const userDocRef = doc(firestore, 'users', userCredential.user.uid);
        await setDoc(userDocRef, {
          id: userCredential.user.uid,
          name: [tgUser.firstName, tgUser.lastName].filter(Boolean).join(' ') || t.auth.userFallback,
          avatarUrl: tgUser.photoUrl || '',
          lastActive: new Date().toISOString(),
          language: tgUser.languageCode || 'ru',
          telegramId: tgUser.id,
          telegramUsername: tgUser.username || '',
        }, { merge: true });

        setAuthState('done');
      } catch (err: any) {
        console.error('Telegram auth failed:', err);
        setError(err.message || t.auth.authError);
        setAuthState('error');
      }
    };

    authenticate();
  }, [user, isUserLoading, auth, firestore]);

  if (authState === 'checking' || authState === 'authenticating' || isUserLoading) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-8" style={{ backgroundColor: 'var(--neo-bg)', overflow: 'hidden' }}>
        {/* Brand corner accents */}
        <div aria-hidden style={{ position: 'absolute', top: 0, left: 0, width: '160px', height: '160px', backgroundColor: 'var(--neo-yellow)', clipPath: 'polygon(0 0, 100% 0, 0 100%)', borderRight: 'var(--neo-border-width) solid var(--neo-border)' }} />
        <div aria-hidden style={{ position: 'absolute', bottom: 0, right: 0, width: '210px', height: '210px', backgroundColor: 'var(--neo-cyan)', clipPath: 'polygon(100% 0, 100% 100%, 0 100%)' }} />

        <h1 className="text-center" style={{ position: 'relative', zIndex: 1, lineHeight: 1.05 }}>
          <span className="block font-black" style={{ fontSize: '52px', color: 'var(--neo-text)', letterSpacing: '-1.5px' }}>JUST</span>
          <span className="block font-black italic" style={{ fontSize: '52px', color: 'var(--neo-accent)', letterSpacing: '-1.5px' }}>CONTACTS</span>
        </h1>

        {/* Bouncing brand dots */}
        <div className="flex gap-2.5" style={{ position: 'relative', zIndex: 1 }}>
          {[
            { c: 'var(--neo-pink)', d: '0ms' },
            { c: 'var(--neo-yellow)', d: '140ms' },
            { c: 'var(--neo-accent)', d: '280ms' },
          ].map((dot, i) => (
            <span key={i} className="w-3.5 h-3.5 animate-bounce" style={{ backgroundColor: dot.c, border: '2px solid var(--neo-border)', animationDelay: dot.d }} />
          ))}
        </div>
      </div>
    );
  }

  if (authState === 'error') {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center" style={{ backgroundColor: 'var(--neo-bg)' }}>
        <div className="text-4xl">😕</div>
        <p className="text-base font-black uppercase" style={{ color: 'var(--neo-text)' }}>
          {t.auth.failedTitle}
        </p>
        <p className="text-sm font-medium" style={{ color: 'var(--neo-hint)' }}>
          {error}
        </p>
        <button
          onClick={() => window.location.reload()}
          className="neo-button-accent mt-4 w-auto px-8"
        >
          {t.auth.retry}
        </button>
      </div>
    );
  }

  return <>{children}</>;
}
