"use client"

import { useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Cake } from "lucide-react";
import { useContacts } from "@/firebase";
import { getTelegramWebApp, haptic } from "@/lib/telegram";
import { useT, useLang } from "@/lib/i18n";

export default function BirthdayCalendar() {
  const router = useRouter();
  const { contacts } = useContacts();
  const t = useT();
  const { lang } = useLang();

  useEffect(() => {
    const tg = getTelegramWebApp();
    if (!tg) return;
    tg.BackButton.show();
    const goBack = () => router.back();
    tg.BackButton.onClick(goBack);
    return () => { tg.BackButton.offClick(goBack); tg.BackButton.hide(); };
  }, [router]);

  const groupedBirthdays = useMemo(() => {
    if (!contacts) return [];
    const today = new Date();
    const currentYear = today.getFullYear();
    // Compare date-only: a birthday today must not be pushed to next year
    const startOfToday = new Date(currentYear, today.getMonth(), today.getDate());
    const bdays = contacts
      .filter(c => c.birthday)
      .map(c => {
        const bday = new Date(c.birthday!);
        let nextDate = new Date(currentYear, bday.getMonth(), bday.getDate());
        if (nextDate < startOfToday) nextDate.setFullYear(currentYear + 1);
        return { ...c, nextDate };
      })
      .sort((a, b) => a.nextDate.getTime() - b.nextDate.getTime());

    const groups: { month: string; contacts: any[] }[] = [];
    bdays.forEach(contact => {
      const rawMonth = contact.nextDate.toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US', { month: 'long' });
      const monthLabel = rawMonth.charAt(0).toUpperCase() + rawMonth.slice(1);
      let group = groups.find(g => g.month === monthLabel);
      if (!group) { group = { month: monthLabel, contacts: [] }; groups.push(group); }
      group.contacts.push(contact);
    });
    return groups;
  }, [contacts, lang]);

  return (
    <div style={{ height: 'calc(var(--app-vh, 100vh) - 76px - env(safe-area-inset-bottom, 0px))', display: 'flex', flexDirection: 'column', overflow: 'hidden', backgroundColor: 'var(--neo-bg)', position: 'relative', isolation: 'isolate' }}>
      {/* Decorative corner accents */}
      <div aria-hidden style={{ position: 'absolute', top: 0, left: 0, width: '150px', height: '150px', backgroundColor: 'var(--neo-yellow)', clipPath: 'polygon(0 0, 100% 0, 0 100%)', borderRight: 'var(--neo-border-width) solid var(--neo-border)', zIndex: -1, pointerEvents: 'none' }} />
      <div aria-hidden style={{ position: 'absolute', bottom: 0, right: 0, width: '200px', height: '200px', backgroundColor: 'var(--neo-cyan)', clipPath: 'polygon(100% 0, 100% 100%, 0 100%)', zIndex: -1, pointerEvents: 'none' }} />

      <div className="px-4 pt-6 pb-4 shrink-0">
        <h1 className="neo-title flex items-center gap-3">
          <Cake className="w-8 h-8" style={{ color: 'var(--neo-accent)' }} />
          <span>{t.birthdays.title}</span>
        </h1>
      </div>

      <div className="px-4 space-y-4 flex-1 overflow-y-auto" style={{ minHeight: 0, paddingBottom: '16px' }}>
        {groupedBirthdays.length > 0 ? groupedBirthdays.map(group => (
          <div key={group.month}>
            <div className="neo-section-header px-1 mb-2">{group.month}</div>
            <div className="neo-card">
              {group.contacts.map((contact, idx) => {
                const dateLabel = new Date(contact.birthday!).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'short' });
                return (
                  <Link key={contact.id} href={`/contact/${contact.id}`} onClick={() => haptic('light')}
                    className="neo-cell" style={idx > 0 ? { borderTop: `var(--neo-border-width) solid var(--neo-separator)` } : {}}>
                    <div className="neo-avatar w-10 h-10">
                      {contact.avatarUrl ? <img src={contact.avatarUrl} alt="" loading="lazy" /> :
                        <span className="text-sm font-bold" style={{ color: 'var(--neo-hint)' }}>{contact.name[0]}</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-bold truncate block" style={{ color: 'var(--neo-text)' }}>{contact.name}</span>
                    </div>
                    <span className="neo-badge text-[10px]">{dateLabel}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        )) : (
          <div className="text-center py-16">
            <p className="text-sm font-medium" style={{ color: 'var(--neo-hint)' }}>{t.birthdays.empty}</p>
          </div>
        )}
      </div>
    </div>
  );
}
