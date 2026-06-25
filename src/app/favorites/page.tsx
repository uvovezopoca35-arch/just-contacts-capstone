"use client"

import { useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Star, ChevronRight } from "lucide-react";
import { useContacts } from "@/firebase";
import { getTelegramWebApp, haptic } from "@/lib/telegram";
import { useT } from "@/lib/i18n";

export default function FavoritesPage() {
  const router = useRouter();
  const { contacts, contactsLoading } = useContacts();
  const t = useT();

  useEffect(() => {
    const tg = getTelegramWebApp();
    if (!tg) return;
    tg.BackButton.show();
    const goBack = () => router.back();
    tg.BackButton.onClick(goBack);
    return () => { tg.BackButton.offClick(goBack); tg.BackButton.hide(); };
  }, [router]);

  const favorites = useMemo(() => {
    return contacts.filter(c => c.isFavorite);
  }, [contacts]);

  return (
    <div style={{ height: 'calc(var(--app-vh, 100vh) - 76px - env(safe-area-inset-bottom, 0px))', display: 'flex', flexDirection: 'column', overflow: 'hidden', backgroundColor: 'var(--neo-bg)', position: 'relative', isolation: 'isolate' }}>
      {/* Decorative corner accents */}
      <div aria-hidden style={{ position: 'absolute', top: 0, left: 0, width: '150px', height: '150px', backgroundColor: 'var(--neo-yellow)', clipPath: 'polygon(0 0, 100% 0, 0 100%)', borderRight: 'var(--neo-border-width) solid var(--neo-border)', zIndex: -1, pointerEvents: 'none' }} />
      <div aria-hidden style={{ position: 'absolute', bottom: 0, right: 0, width: '200px', height: '200px', backgroundColor: 'var(--neo-cyan)', clipPath: 'polygon(100% 0, 100% 100%, 0 100%)', zIndex: -1, pointerEvents: 'none' }} />

      <div className="px-4 pt-6 pb-4 shrink-0">
        <div className="flex items-center gap-3">
          <Star className="w-6 h-6" style={{ color: 'var(--neo-yellow)', fill: 'var(--neo-yellow)' }} />
          <h1 className="neo-title">{t.favorites.title}</h1>
        </div>
      </div>

      <div className="px-4 flex-1 overflow-y-auto" style={{ minHeight: 0, paddingBottom: '16px' }}>
        {contactsLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--neo-accent)', borderTopColor: 'transparent' }} />
          </div>
        ) : favorites.length > 0 ? (
          <div className="neo-card">
            {favorites.map((contact, idx) => (
              <Link key={contact.id} href={`/contact/${contact.id}`} onClick={() => haptic('light')}
                className="neo-cell" style={idx > 0 ? { borderTop: `var(--neo-border-width) solid var(--neo-separator)` } : {}}>
                <div className="neo-avatar w-12 h-12">
                  {contact.avatarUrl ? <img src={contact.avatarUrl} alt="" loading="lazy" /> :
                    <span className="text-lg font-bold" style={{ color: 'var(--neo-hint)' }}>{contact.name[0]}</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold truncate" style={{ color: 'var(--neo-text)' }}>{contact.name}</div>
                  {contact.role && <div className="text-xs truncate" style={{ color: 'var(--neo-hint)' }}>{contact.role}</div>}
                  <div className="flex gap-1.5 mt-1">
                    {contact.tags?.slice(0, 2).map(tag => <span key={tag} className="neo-chip text-[10px]">#{tag}</span>)}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="text-center py-16">
            <Star className="w-12 h-12 mx-auto mb-3 opacity-20" style={{ color: 'var(--neo-hint)' }} />
            <p className="text-sm font-medium" style={{ color: 'var(--neo-hint)' }}>{t.favorites.empty}</p>
          </div>
        )}
      </div>
    </div>
  );
}
