import { NextRequest, NextResponse } from 'next/server';
import { getAdmin } from '@/lib/firebase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
// Vercel Cron automatically sends `Authorization: Bearer <CRON_SECRET>` when a
// CRON_SECRET env var is configured. We require it so the endpoint can't be
// triggered by random visitors (it sends Telegram messages).
const CRON_SECRET = process.env.CRON_SECRET;

const STALE_DAYS = 60;          // consider a favorite "stale" after this long with no interaction
const RENUDGE_DAYS = 30;        // don't nudge about the same contact more often than this
const MAX_STALE_PER_USER = 2;   // cap stale nudges per user per run to avoid spam
const DAY_MS = 24 * 60 * 60 * 1000;

async function tgSend(chatId: number | string, text: string) {
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
  } catch (e) {
    console.warn('Reminder send failed:', e);
  }
}

const isRu = (lang?: string) => (lang || 'ru').toLowerCase().startsWith('ru');

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const shortName = (c: any, fallback: string) =>
  c.firstName || (c.name ? String(c.name).split(' ')[0] : '') || fallback;

export async function GET(request: NextRequest) {
  if (!CRON_SECRET) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 });
  }
  if (request.headers.get('authorization') !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getAdmin().firestore();
  const now = new Date();
  const todayM = now.getUTCMonth();
  const todayD = now.getUTCDate();
  let usersProcessed = 0, birthdayMsgs = 0, staleMsgs = 0;

  const usersSnap = await db.collection('users').get();
  for (const userDoc of usersSnap.docs) {
    const u = userDoc.data();
    const chatId = u.telegramId;
    if (!chatId) continue;
    usersProcessed++;
    const ru = isRu(u.language);
    const birthdayOn = u.birthdayReminders !== false;
    const staleOn = u.staleReminders !== false;
    if (!birthdayOn && !staleOn) continue;

    const contactsSnap = await db.collection(`users/${userDoc.id}/contacts`).get();
    const contacts = contactsSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));

    // --- Birthdays today ---
    if (birthdayOn) for (const c of contacts) {
      if (!c.birthday) continue;
      const b = new Date(c.birthday);
      if (isNaN(b.getTime())) continue;
      if (b.getUTCMonth() === todayM && b.getUTCDate() === todayD) {
        const name = escapeHtml(shortName(c, ru ? 'контакта' : 'a contact'));
        await tgSend(chatId, ru
          ? `🎂 Сегодня день рождения у <b>${name}</b>! Не забудь поздравить 🎉`
          : `🎂 It's <b>${name}</b>'s birthday today! Don't forget to wish them well 🎉`);
        birthdayMsgs++;
      }
    }

    // --- Stale favorites (haven't been in touch for a while) ---
    const stale = !staleOn ? [] : contacts
      .filter(c => c.isFavorite && c.lastInteraction)
      .map(c => ({ c, last: new Date(c.lastInteraction).getTime() }))
      .filter(x => !isNaN(x.last) && now.getTime() - x.last > STALE_DAYS * DAY_MS)
      .filter(x => !x.c.reminderSentAt || now.getTime() - new Date(x.c.reminderSentAt).getTime() > RENUDGE_DAYS * DAY_MS)
      .sort((a, b) => a.last - b.last)
      .slice(0, MAX_STALE_PER_USER);

    for (const { c, last } of stale) {
      const name = escapeHtml(shortName(c, ru ? 'этим контактом' : 'this contact'));
      const months = Math.max(1, Math.floor((now.getTime() - last) / (30 * DAY_MS)));
      await tgSend(chatId, ru
        ? `👋 Вы давно не общались с <b>${name}</b> (около ${months} мес.). Может, самое время написать?`
        : `👋 You haven't been in touch with <b>${name}</b> for about ${months} month(s). Maybe it's time to reach out?`);
      await db.doc(`users/${userDoc.id}/contacts/${c.id}`).set({ reminderSentAt: now.toISOString() }, { merge: true });
      staleMsgs++;
    }
  }

  return NextResponse.json({ ok: true, usersProcessed, birthdayMsgs, staleMsgs });
}
