'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, UserPlus, CalendarPlus, Search, User as UserIcon } from 'lucide-react';
import { haptic } from '@/lib/telegram';
import { useT } from '@/lib/i18n';

export function BottomNav() {
  const pathname = usePathname();
  const t = useT();

  const TABS = [
    { href: '/', icon: Home, label: t.nav.home },
    { href: '/add', icon: UserPlus, label: t.nav.add },
    { href: '/add-event', icon: CalendarPlus, label: t.nav.event },
    { href: '/search', icon: Search, label: t.nav.search },
    { href: '/profile', icon: UserIcon, label: t.nav.profile },
  ] as const;

  const showOnPaths = ['/', '/add', '/add-event', '/search', '/profile', '/birthdays', '/favorites'];
  const visible = showOnPaths.includes(pathname) || pathname.startsWith('/contact/');
  if (!visible) return null;

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-center gap-4"
      style={{
        backgroundColor: 'var(--neo-nav-bg)',
        borderTop: 'var(--neo-border-width) solid var(--neo-border)',
        height: 'calc(76px + env(safe-area-inset-bottom, 0px))',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      {TABS.map(({ href, icon: Icon, label }) => {
        const isActive = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-label={label}
            onClick={() => haptic('light')}
            className="flex h-12 w-12 items-center justify-center rounded-xl transition-colors"
            style={{
              color: isActive ? 'var(--neo-accent)' : 'var(--neo-hint)',
              backgroundColor: isActive ? 'var(--neo-chip-bg)' : 'transparent',
            }}
          >
            <Icon style={{ width: '24px', height: '24px' }} strokeWidth={isActive ? 2.5 : 1.5} />
          </Link>
        );
      })}
    </nav>
  );
}
