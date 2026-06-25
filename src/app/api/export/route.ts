import { NextRequest, NextResponse } from 'next/server';
import { getAdmin } from '@/lib/firebase-admin';
import { requireAuth } from '@/lib/server-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;

// vCard escaping: backslash, comma, semicolon and newlines.
const esc = (s: string) =>
  String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');

function summaryToNote(summary?: string): string {
  if (!summary) return '';
  try {
    const p = JSON.parse(summary);
    const parts: string[] = [];
    if (p.recentSummary) parts.push(p.recentSummary);
    if (Array.isArray(p.facts)) parts.push(...p.facts.filter((f: any) => f?.label && f?.value).map((f: any) => `${f.label}: ${f.value}`));
    return parts.join('. ');
  } catch {
    return summary;
  }
}

function toVCard(c: any): string {
  const first = c.firstName || (c.name ? String(c.name).split(' ')[0] : '');
  const last = c.name && c.firstName && c.name.startsWith(c.firstName)
    ? c.name.slice(c.firstName.length).trim()
    : '';
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${esc(c.name || first || 'Contact')}`,
    `N:${esc(last)};${esc(first)};;;`,
  ];
  if (c.phone) lines.push(`TEL;TYPE=CELL:${esc(c.phone)}`);
  if (c.email) lines.push(`EMAIL:${esc(c.email)}`);
  if (c.role) lines.push(`ORG:${esc(c.role)}`);
  if (c.birthday) {
    const b = String(c.birthday).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(b)) lines.push(`BDAY:${b}`);
  }
  if (Array.isArray(c.tags) && c.tags.length) lines.push(`CATEGORIES:${c.tags.map(esc).join(',')}`);
  const note = summaryToNote(c.summary);
  if (note) lines.push(`NOTE:${esc(note)}`);
  lines.push('END:VCARD');
  return lines.join('\r\n');
}

export async function POST(request: NextRequest) {
  try {
    const { idToken } = await request.json();
    const uid = await requireAuth(idToken);

    const db = getAdmin().firestore();
    const [userSnap, contactsSnap] = await Promise.all([
      db.doc(`users/${uid}`).get(),
      db.collection(`users/${uid}/contacts`).get(),
    ]);

    const telegramId = userSnap.data()?.telegramId;
    if (!telegramId) {
      return NextResponse.json({ error: 'No linked Telegram chat' }, { status: 400 });
    }
    if (contactsSnap.empty) {
      return NextResponse.json({ error: 'No contacts' }, { status: 400 });
    }

    const vcf = contactsSnap.docs.map(d => toVCard(d.data())).join('\r\n');

    const form = new FormData();
    form.append('chat_id', String(telegramId));
    form.append('caption', `📇 Just Contacts — ${contactsSnap.size} contacts`);
    form.append('document', new Blob([vcf], { type: 'text/vcard' }), 'just-contacts.vcf');

    const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, {
      method: 'POST',
      body: form,
    });
    const tgJson = await tgRes.json();
    if (!tgJson.ok) {
      console.error('sendDocument failed:', tgJson);
      return NextResponse.json({ error: 'Failed to send' }, { status: 502 });
    }

    return NextResponse.json({ ok: true, count: contactsSnap.size });
  } catch (e: any) {
    console.error('Export error:', e);
    return NextResponse.json({ error: e?.message || 'Export failed' }, { status: 500 });
  }
}
