/**
 * Seed demo contacts for the capstone demo / video.
 *
 * Standalone, one-off script — it is NOT part of the app and changes no product
 * behaviour. It writes a set of fictional contacts into Firestore under the
 * single demo user (MCP_USER_ID, e.g. "demo_user"), so the agent and the app
 * have something to search and reason about.
 *
 * Deliberately makes ZERO Gemini calls: contacts are written pre-structured
 * (the AI parsing step is skipped). Search vectors are left empty on purpose —
 * the search pipeline backfills them lazily on the first query, so seeding costs
 * no AI quota.
 *
 * Re-runnable: it wipes the demo user's existing contacts first, then re-seeds.
 *
 * Run:  npm run seed
 */
import 'dotenv/config';
import { getAdmin } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

const USER_ID = process.env.MCP_USER_ID;
if (!USER_ID) {
  console.error('MCP_USER_ID is not set in .env — refusing to seed without an explicit scope.');
  process.exit(1);
}

type Fact = { label: string; value: string };
type DemoContact = {
  name: string;
  firstName: string;
  role: string;
  tags: string[];
  phone?: string;
  email?: string;
  birthday?: string; // ISO date
  isFavorite?: boolean;
  recentSummary: string; // the "who is this" dossier line
  facts: Fact[];
  history?: { type: string; date: string; summary: string }[];
};

// A diverse, fictional set chosen so the demo queries land well, e.g.
// "who works in design?", "who fixes cars", "the designer I had lunch with".
const CONTACTS: DemoContact[] = [
  {
    name: 'Ivan Petrov', firstName: 'Ivan', role: 'Backend Developer at Yandex',
    tags: ['WORK', 'TECH'], phone: '+7 999 123 45 67', email: 'ivan.petrov@example.com',
    birthday: '1994-03-12',
    recentSummary: 'Backend developer at Yandex, met at the AI conference. Into snowboarding; works mostly with Go and distributed systems.',
    facts: [{ label: 'Company', value: 'Yandex' }, { label: 'Role', value: 'Backend Developer' }],
    history: [
      { type: 'meeting', date: '2026-05-18', summary: 'Met at the AI conference, talked about vector databases. Promised to send him a paper on HNSW indexes.' },
      { type: 'call', date: '2026-06-02', summary: 'Quick call — he is hiring a junior backend dev on his team.' },
    ],
  },
  {
    name: 'Maria Sokolova', firstName: 'Maria', role: 'Product Designer',
    tags: ['DESIGN', 'WORK'], email: 'maria.s@example.com', birthday: '1996-07-21',
    recentSummary: 'Product designer at a small studio. Loves mountains and hiking. We had lunch after a design meetup.',
    facts: [{ label: 'Role', value: 'Product Designer' }],
    history: [
      { type: 'meeting', date: '2026-04-30', summary: 'Lunch after the design meetup. She showed her Figma portfolio; interested in design-systems work.' },
    ],
  },
  {
    name: 'Alexei Smirnov', firstName: 'Alexei', role: 'Car Mechanic',
    tags: ['SERVICES', 'FRIEND'], phone: '+7 905 222 11 00',
    recentSummary: 'Friend who fixes cars — has his own garage. Owns a dacha outside the city and grills well.',
    facts: [{ label: 'Role', value: 'Car Mechanic' }],
  },
  {
    name: 'Elena Volkova', firstName: 'Elena', role: 'Marketing Lead at a fintech startup',
    tags: ['WORK', 'MARKETING'], email: 'elena.volkova@example.com',
    recentSummary: 'Marketing lead at a fintech startup, met at a founders event. Strong on growth and content.',
    facts: [{ label: 'Company', value: 'fintech startup' }, { label: 'Role', value: 'Marketing Lead' }],
  },
  {
    name: 'Dmitry Kozlov', firstName: 'Dmitry', role: 'Freelance Photographer',
    tags: ['CREATIVE', 'FREELANCE'], phone: '+7 911 777 33 22', birthday: '1990-11-05',
    recentSummary: 'Freelance photographer, travels a lot. Shoots events and portraits; based in St. Petersburg.',
    facts: [{ label: 'Role', value: 'Photographer' }],
  },
  {
    name: 'Olga Novikova', firstName: 'Olga', role: 'Data Scientist',
    tags: ['TECH', 'WORK'], email: 'olga.n@example.com',
    recentSummary: 'Data scientist with a PhD, works on recommendation systems. Into board games and chess.',
    facts: [{ label: 'Role', value: 'Data Scientist' }, { label: 'Education', value: 'PhD' }],
  },
  {
    name: 'Sergey Morozov', firstName: 'Sergey', role: 'Angel Investor',
    tags: ['FINANCE', 'NETWORK'], email: 'sergey.morozov@example.com', isFavorite: true,
    recentSummary: 'Angel investor, met at a demo day. Invests in early-stage AI startups; ex-founder.',
    facts: [{ label: 'Role', value: 'Angel Investor' }],
    history: [
      { type: 'meeting', date: '2026-06-10', summary: 'Demo day — liked the contacts agent idea. Asked for a one-pager.' },
    ],
  },
  {
    name: 'Anna Pavlova', firstName: 'Anna', role: 'UX Researcher',
    tags: ['DESIGN', 'RESEARCH'], email: 'anna.pavlova@example.com',
    recentSummary: 'UX researcher and former colleague. Great at user interviews and usability testing.',
    facts: [{ label: 'Role', value: 'UX Researcher' }],
  },
  {
    name: 'Pavel Orlov', firstName: 'Pavel', role: 'DevOps Engineer',
    tags: ['TECH'], phone: '+7 926 555 44 88',
    recentSummary: 'DevOps engineer, into climbing and the gym. Knows Kubernetes and CI/CD deeply.',
    facts: [{ label: 'Role', value: 'DevOps Engineer' }],
  },
  {
    name: 'Natalia Belova', firstName: 'Natalia', role: 'Cardiologist',
    tags: ['HEALTH', 'FRIEND'], birthday: '1988-01-29',
    recentSummary: 'Cardiologist, a long-time friend. Works at the city hospital; recommends great books.',
    facts: [{ label: 'Role', value: 'Cardiologist' }],
  },
];

async function main() {
  const db = getAdmin().firestore();
  const col = db.collection(`users/${USER_ID}/contacts`);

  // 1) Wipe existing demo contacts (+ their history) so re-runs stay clean.
  const existing = await col.get();
  if (!existing.empty) {
    console.log(`Clearing ${existing.size} existing contact(s) for "${USER_ID}"…`);
    for (const doc of existing.docs) {
      const hist = await doc.ref.collection('history').get();
      const batch = db.batch();
      hist.docs.forEach((h) => batch.delete(h.ref));
      batch.delete(doc.ref);
      await batch.commit();
    }
  }

  // 2) Write the fresh demo set (no AI calls; vectors backfilled lazily by search).
  console.log(`Seeding ${CONTACTS.length} demo contacts for "${USER_ID}"…`);
  for (const c of CONTACTS) {
    const summary = JSON.stringify({ recentSummary: c.recentSummary, facts: c.facts });
    const ref = await col.add({
      userId: USER_ID,
      name: c.name,
      firstName: c.firstName,
      role: c.role,
      tags: c.tags,
      summary,
      phone: c.phone || '',
      email: c.email || '',
      ...(c.birthday ? { birthday: c.birthday } : {}),
      isFavorite: c.isFavorite || false,
      avatarUrl: '',
      lastInteraction: new Date().toISOString(),
      interactionScore: 50,
      createdAt: new Date().toISOString(),
      // embeddingVersion intentionally omitted → search backfills vectors on first query.
    });

    for (const h of c.history || []) {
      await ref.collection('history').add({
        contactId: ref.id,
        type: h.type,
        date: h.date,
        summary: h.summary,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    console.log(`  + ${c.name}`);
  }

  await db.doc(`users/${USER_ID}`).set({ id: USER_ID, totalContacts: CONTACTS.length }, { merge: true });
  console.log('Done. Demo data seeded with zero Gemini calls.');
  process.exit(0);
}

main().catch((e) => {
  console.error('Seed failed:', e);
  process.exit(1);
});
