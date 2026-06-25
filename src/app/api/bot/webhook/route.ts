import { NextRequest, NextResponse } from 'next/server';
import { getAdmin, telegramIdToUid } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

export const runtime = 'nodejs';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
// Shared secret used to verify that incoming webhook calls really come from Telegram,
// and to authorize the (re)registration endpoint. Set this in the deployment env and
// re-register the webhook (GET /api/bot/webhook?secret=...) after changing it.
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;

// ---------------------------------------------------------------------------
// User state — persisted in Firestore (survives restarts/scaling)
// ---------------------------------------------------------------------------
type UserMode = 'idle' | 'add' | 'search';

async function getUserMode(chatId: number): Promise<UserMode> {
  try {
    const fb = getAdmin();
    const doc = await fb.firestore().doc(`bot_state/${chatId}`).get();
    return (doc.data()?.mode as UserMode) || 'idle';
  } catch { return 'idle'; }
}

async function setUserMode(chatId: number, mode: UserMode): Promise<void> {
  try {
    const fb = getAdmin();
    await fb.firestore().doc(`bot_state/${chatId}`).set({ mode, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  } catch { /* non-critical */ }
}

// ---------------------------------------------------------------------------
// Per-user rate limiting — persisted in Firestore so it works on serverless
// (in-memory state does not survive between invocations on Vercel)
// ---------------------------------------------------------------------------
const RATE_LIMIT_MAX = 10; // max AI calls per window
const RATE_LIMIT_WINDOW = 60_000; // 1 minute

async function checkRateLimit(chatId: number): Promise<boolean> {
  try {
    const db = getAdmin().firestore();
    const ref = db.doc(`bot_state/${chatId}`);
    return await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const now = Date.now();
      let { rlCount = 0, rlResetAt = 0 } = (snap.data() || {}) as { rlCount?: number; rlResetAt?: number };
      if (now > rlResetAt) {
        rlCount = 0;
        rlResetAt = now + RATE_LIMIT_WINDOW;
      }
      if (rlCount >= RATE_LIMIT_MAX) return false;
      tx.set(ref, { rlCount: rlCount + 1, rlResetAt }, { merge: true });
      return true;
    });
  } catch (e) {
    console.warn('Rate limit check failed (allowing request):', e);
    return true;
  }
}

// ---------------------------------------------------------------------------
// Telegram Bot API helper
// ---------------------------------------------------------------------------
async function tgApi(method: string, body: Record<string, unknown>) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

/**
 * The persistent reply keyboard shown to the user.
 */
const PERSISTENT_KEYBOARD = {
  keyboard: [
    [{ text: '📝 Добавить контакт' }, { text: '🔍 Поиск контакта' }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};

/**
 * Derive the public base URL from the incoming request.
 */
function getBaseUrl(request: NextRequest): string {
  // Prefer an explicit, trusted base URL from the environment. The Host header is
  // attacker-controlled, so never use it to build the webhook URL we register with Telegram.
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  const host = request.headers.get('host') || 'localhost:9002';
  return `${proto}://${host}`;
}

/**
 * Fetch the Telegram profile photo of a user by their Telegram user_id.
 * Returns a base64 data URL of the photo, or null if unavailable.
 */
async function fetchTelegramUserAvatar(tgUserId: number): Promise<string | null> {
  try {
    const photosRes = await tgApi('getUserProfilePhotos', { user_id: tgUserId, limit: 1 });
    const photos = photosRes.result?.photos;
    if (!photos || photos.length === 0) return null;

    // Take the smallest size — it's stored inline in Firestore as a data URL,
    // so keep it lightweight (well under the 1MB document limit).
    const photoSizes = photos[0];
    const photo = photoSizes[0];
    if (!photo?.file_id) return null;

    const fileInfo = await tgApi('getFile', { file_id: photo.file_id });
    const filePath = fileInfo.result?.file_path;
    if (!filePath) return null;

    const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
    const res = await fetch(url);
    const buffer = await res.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');

    // Determine mime type by extension
    const ext = filePath.split('.').pop()?.toLowerCase() || 'jpg';
    const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
    return `data:${mime};base64,${base64}`;
  } catch (e) {
    console.warn('Could not fetch Telegram avatar:', e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Firestore helpers (server-side via Admin SDK)
// ---------------------------------------------------------------------------

/**
 * Check if a contact with the given phone number already exists.
 * Returns the existing contact data or null.
 */
async function findContactByPhone(
  telegramUserId: number,
  phone: string
): Promise<{ id: string; name: string } | null> {
  if (!phone) return null;
  const fb = getAdmin();
  const uid = telegramIdToUid(telegramUserId);
  const db = fb.firestore();

  const snapshot = await db
    .collection(`users/${uid}/contacts`)
    .where('phone', '==', phone)
    .limit(1)
    .get();

  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return { id: doc.id, name: doc.data().name as string };
}

async function addContactToFirestore(
  telegramUserId: number,
  contactData: {
    name: string;
    firstName: string;
    phone?: string;
    email?: string;
    role?: string;
    tags?: string[];
    summary?: string;
    avatarDataUrl?: string | null;
  }
) {
  const fb = getAdmin();
  const uid = telegramIdToUid(telegramUserId);
  const db = fb.firestore();

  // Compute the search vectors up-front (best-effort: the search path lazily
  // backfills missing vectors, so a failure here is non-fatal)
  let vecs: string[] | undefined;
  let embeddingVersionForCreate: number | undefined;
  try {
    const { embedTextsCore } = await import('@/ai/logic/embedding');
    const { buildContactVectors, EMBEDDING_VERSION } = await import('@/lib/vector');
    embeddingVersionForCreate = EMBEDDING_VERSION;
    const built = await buildContactVectors(
      [{ id: 'new', name: contactData.name, role: contactData.role || '', tags: contactData.tags || [], summary: contactData.summary || '' }],
      texts => embedTextsCore(texts, 'RETRIEVAL_DOCUMENT'),
    );
    vecs = built.get('new');
  } catch (e) {
    console.warn('Could not compute vectors at create time:', e);
  }

  // Create the contact document first (without avatar) to get the ID
  const contactRef = await db.collection(`users/${uid}/contacts`).add({
    userId: uid,
    name: contactData.name,
    firstName: contactData.firstName,
    tags: contactData.tags || [],
    summary: contactData.summary || '',
    ...(vecs ? { vecs, embeddingVersion: embeddingVersionForCreate } : {}),
    lastInteraction: new Date().toISOString(),
    interactionScore: 50,
    createdAt: new Date().toISOString(),
    phone: contactData.phone || '',
    email: contactData.email || '',
    telegram: '',
    linkedin: '',
    role: contactData.role || '',
    isFavorite: false,
    // Store the Telegram avatar inline as a data URL (no Storage bucket / billing needed)
    avatarUrl: contactData.avatarDataUrl || '',
  });

  // Add initial history entry
  await db.collection(`users/${uid}/contacts/${contactRef.id}/history`).add({
    contactId: contactRef.id,
    date: new Date().toISOString(),
    type: 'note',
    summary: `Добавлен через Telegram-бота`,
    createdAt: FieldValue.serverTimestamp(),
  });

  // Increment totalContacts
  await db.doc(`users/${uid}`).update({
    totalContacts: FieldValue.increment(1),
  });

  return contactRef.id;
}

async function searchContactsInFirestore(telegramUserId: number) {
  const fb = getAdmin();
  const uid = telegramIdToUid(telegramUserId);
  const db = fb.firestore();

  const snapshot = await db.collection(`users/${uid}/contacts`).limit(100).get();
  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
  })) as Array<{ id: string; name: string; role?: string; tags?: string[]; summary?: string; birthday?: string; vecs?: string[]; embeddingVersion?: number }>;
}

// ---------------------------------------------------------------------------
// Message handlers
// ---------------------------------------------------------------------------

async function handleStart(chatId: number, firstName: string, baseUrl: string) {
  // Set menu button for this user
  await tgApi('setChatMenuButton', {
    chat_id: chatId,
    menu_button: {
      type: 'web_app',
        text: 'Открыть',
      web_app: { url: baseUrl },
    },
  });

  await setUserMode(chatId, 'idle');

  // First message — intro with WebApp + Instruction buttons
  await tgApi('sendMessage', {
    chat_id: chatId,
    text:
      `Приветствую, ${firstName}! Рады знакомству.\n\n` +
      `Это ваша контактная книга с дополнительными функциями, которые сделают процесс создания, хранения и управления контактами эффективнее.\n\n` +
      `Как именно? Написали для вас инструкцию.\n\n` +
      `Желаем больше полезных знакомств и приятных встреч!\n\n` +
      `<i>От команды Just Contacts</i>`,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: '📱 Открыть Just Contacts', web_app: { url: baseUrl } }],
        [{ text: '📖 Инструкция', callback_data: 'instructions' }],
      ],
    },
  });

  // Second message — sets the persistent reply keyboard
  await tgApi('sendMessage', {
    chat_id: chatId,
    text: 'Кнопки ниже — для быстрого добавления и поиска контактов.',
    reply_markup: PERSISTENT_KEYBOARD,
  });
}

async function handleInstructions(chatId: number, baseUrl: string) {
  await tgApi('sendMessage', {
    chat_id: chatId,
    text:
      `<b>Инструкция Just Contacts</b>\n\n` +
      `<b>Добавить контакт</b>\n` +
      `Нажмите «Добавить контакт» и опишите человека своими словами. Например: «Иван, познакомились на конференции, работает в Яндексе, увлекается сноубордом». Приложение определит имя, компанию и телефон и соберёт карточку. Можно приложить фото или переслать контакт из телефонной книги.\n\n` +
      `<b>Найти контакт</b>\n` +
      `Нажмите «Поиск контакта» и введите имя, компанию, тег или номер. Для поиска по смыслу есть «Умный поиск»: спросите так, как помните — «дизайнер, с которым обедали» или «кто увлекается горами».\n\n` +
      `<b>События и история</b>\n` +
      `К контакту можно добавлять встречи, звонки и заметки. Они сохраняются в истории, а краткое досье человека обновляется автоматически.\n\n` +
      `<b>Досье и вопросы</b>\n` +
      `В карточке контакта есть досье — кто этот человек. Чтобы вспомнить детали, задайте вопрос прямо по контакту: приложение ответит по сохранённым данным.\n\n` +
      `<b>Напоминания</b>\n` +
      `Напомним о днях рождения и о тех, с кем вы давно не общались. Управление — в настройках.\n\n` +
      `<b>Настройки и экспорт</b>\n` +
      `В профиле: язык, тема, звук, вибрация, напоминания и выгрузка всех контактов файлом.`,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: '📱 Открыть Just Contacts', web_app: { url: baseUrl } }],
      ],
    },
  });
}

async function handleAddContactButton(chatId: number) {
  await setUserMode(chatId, 'add');
  await tgApi('sendMessage', {
    chat_id: chatId,
    text:
      '📝 <b>Режим добавления контакта</b>\n\n' +
      'Напишите всё, что помните о человеке — имя, телефон, компанию, откуда знаете.\n\n' +
      'AI автоматически разберёт информацию и создаст карточку контакта.',
    parse_mode: 'HTML',
    reply_markup: PERSISTENT_KEYBOARD,
  });
}

async function handleSearchButton(chatId: number) {
  await setUserMode(chatId, 'search');
  await tgApi('sendMessage', {
    chat_id: chatId,
    text:
      '🔍 <b>Режим поиска</b>\n\n' +
      'Напишите имя, компанию или описание — например:\n' +
      '• <i>Алексей из Яндекса</i>\n' +
      '• <i>кто любит сноуборд</i>\n' +
      '• <i>дизайнер, с которым обедали</i>',
    parse_mode: 'HTML',
    reply_markup: PERSISTENT_KEYBOARD,
  });
}

async function handleTextAddContact(chatId: number, telegramUserId: number, text: string) {
  // Rate limit check
  if (!(await checkRateLimit(chatId))) {
    await tgApi('sendMessage', {
      chat_id: chatId,
      text: '⚠️ Слишком много запросов. Подождите минуту.',
      reply_markup: PERSISTENT_KEYBOARD,
    });
    return;
  }

  await tgApi('sendMessage', {
    chat_id: chatId,
    text: '⏳ Обрабатываю информацию через AI...',
  });

  try {
    // Dynamic import to avoid loading AI on every request.
    // Core logic is used directly: this route is already authenticated via the webhook secret.
    const { aiContactParsingFlow } = await import('@/ai/logic/contact-parsing');
    const result = await aiContactParsingFlow({ text });

    // Check for duplicate by phone
    if (result.phone) {
      const existing = await findContactByPhone(telegramUserId, result.phone);
      if (existing) {
        await tgApi('sendMessage', {
          chat_id: chatId,
          text:
            `⚠️ <b>Контакт уже существует!</b>\n\n` +
            `👤 ${existing.name} уже сохранён с номером ${result.phone}.\n\n` +
            `Откройте приложение для просмотра.`,
          parse_mode: 'HTML',
          reply_markup: PERSISTENT_KEYBOARD,
        });
        await setUserMode(chatId, 'idle');
        return;
      }
    }

    const structuredSummary = JSON.stringify({
      recentSummary: result.summary || '',
      facts: result.facts || [],
    });

    await addContactToFirestore(telegramUserId, {
      name: result.name || 'Без имени',
      firstName: result.firstName || result.name?.split(' ')[0] || 'Без имени',
      phone: result.phone,
      email: result.email,
      role: result.role,
      tags: result.tags,
      summary: structuredSummary,
    });

    const tagStr = result.tags?.length ? `\n🏷 ${result.tags.join(', ')}` : '';
    const phoneStr = result.phone ? `\n📞 ${result.phone}` : '';
    const roleStr = result.role ? `\n💼 ${result.role}` : '';

    await tgApi('sendMessage', {
      chat_id: chatId,
      text:
        `✅ <b>Контакт сохранён!</b>\n\n` +
        `👤 ${result.name || 'Без имени'}` +
        roleStr + phoneStr + tagStr,
      parse_mode: 'HTML',
      reply_markup: PERSISTENT_KEYBOARD,
    });

    await setUserMode(chatId, 'idle');
  } catch (e: any) {
    console.error('AI contact parsing error:', e);
    await tgApi('sendMessage', {
      chat_id: chatId,
      text: '❌ Не удалось обработать данные. Попробуйте ещё раз или опишите контакт подробнее.',
      reply_markup: PERSISTENT_KEYBOARD,
    });
  }
}

async function handleTextSearch(chatId: number, telegramUserId: number, queryText: string) {
  // Rate limit check
  if (!(await checkRateLimit(chatId))) {
    await tgApi('sendMessage', {
      chat_id: chatId,
      text: '⚠️ Слишком много запросов. Подождите минуту.',
      reply_markup: PERSISTENT_KEYBOARD,
    });
    return;
  }

  await tgApi('sendMessage', {
    chat_id: chatId,
    text: '⏳ Ищу контакты через AI...',
  });

  try {
    const contacts = await searchContactsInFirestore(telegramUserId);

    if (contacts.length === 0) {
      await tgApi('sendMessage', {
        chat_id: chatId,
        text: '📭 У вас пока нет контактов. Добавьте первый контакт!',
        reply_markup: PERSISTENT_KEYBOARD,
      });
      await setUserMode(chatId, 'idle');
      return;
    }

    const { embedTextsCore } = await import('@/ai/logic/embedding');
    const { buildContactVectors, selectSearchCandidates, applySearchFilters, EMBEDDING_VERSION } = await import('@/lib/vector');
    const { extractSearchFiltersFlow } = await import('@/ai/logic/search-filters');

    // 1. Self-query: split into a semantic part + hard logical filters.
    const extracted = await extractSearchFiltersFlow({ query: queryText });
    const semanticQuery = extracted.semanticQuery || queryText;

    // 2. Backfill packed multi-vectors for contacts lacking a current-version set.
    const missing = contacts.filter(c => !c.vecs?.length || c.embeddingVersion !== EMBEDDING_VERSION);
    if (missing.length > 0) {
      try {
        const built = await buildContactVectors(missing, texts => embedTextsCore(texts, 'RETRIEVAL_DOCUMENT'));
        const db = getAdmin().firestore();
        const uid = telegramIdToUid(telegramUserId);
        const batch = db.batch();
        missing.forEach(c => {
          const v = built.get(c.id);
          if (v?.length) {
            c.vecs = v;
            c.embeddingVersion = EMBEDDING_VERSION;
            batch.update(db.doc(`users/${uid}/contacts/${c.id}`), { vecs: v, embeddingVersion: EMBEDDING_VERSION, embedding: FieldValue.delete() });
          }
        });
        await batch.commit();
      } catch (e) {
        console.warn('Vector backfill failed, continuing with what we have:', e);
      }
    }

    // 3. Embed the query, apply logical filters, build the candidate set
    //    (adaptive semantic top-k ∪ keyword), bounded for cost.
    const [queryVec] = await embedTextsCore([semanticQuery], 'RETRIEVAL_QUERY');
    const withVecs = applySearchFilters(
      contacts.map(c => ({ ...c, vecs: c.embeddingVersion === EMBEDDING_VERSION ? c.vecs : undefined })),
      { excludeTerms: extracted.excludeTerms, birthdayMonth: extracted.birthdayMonth },
    );
    const candidates = selectSearchCandidates(semanticQuery, queryVec, withVecs);

    // 4. LLM makes the final relevance call on the candidate set.
    //    Core logic is used directly: this route is authenticated via the webhook secret.
    const { aiSemanticContactSearchFlow } = await import('@/ai/logic/semantic-search');
    const result = await aiSemanticContactSearchFlow({
      query: semanticQuery,
      contacts: candidates.map(c => ({
        id: c.id,
        name: c.name,
        role: c.role || '',
        tags: c.tags || [],
        summary: c.summary || '',
      })),
    });

    if (result.relevantContactIds.length === 0) {
      await tgApi('sendMessage', {
        chat_id: chatId,
        text: '🤷 Не нашёл подходящих контактов. Попробуйте другой запрос.',
        reply_markup: PERSISTENT_KEYBOARD,
      });
    } else {
      const found = contacts.filter(c => result.relevantContactIds.includes(c.id));
      const lines = found.map((c, i) => {
        const role = c.role ? ` — ${c.role}` : '';
        const tags = c.tags?.length ? ` [${c.tags.join(', ')}]` : '';
        return `${i + 1}. <b>${c.name}</b>${role}${tags}`;
      });

      await tgApi('sendMessage', {
        chat_id: chatId,
        text:
          `🔍 <b>Результаты поиска «${queryText}»:</b>\n\n` +
          lines.join('\n') +
          '\n\n💡 Откройте приложение для подробной информации.',
        parse_mode: 'HTML',
        reply_markup: PERSISTENT_KEYBOARD,
      });
    }

    await setUserMode(chatId, 'idle');
  } catch (e: any) {
    console.error('AI search error:', e);
    await tgApi('sendMessage', {
      chat_id: chatId,
      text: '❌ Ошибка при поиске. Попробуйте ещё раз.',
      reply_markup: PERSISTENT_KEYBOARD,
    });
  }
}

async function handleForwardedContact(
  chatId: number,
  telegramUserId: number,
  contact: { phone_number?: string; first_name: string; last_name?: string; user_id?: number }
) {
  try {
    const fullName = [contact.first_name, contact.last_name].filter(Boolean).join(' ');
    const phone = contact.phone_number;

    // Check for duplicate by phone number
    if (phone) {
      const existing = await findContactByPhone(telegramUserId, phone);
      if (existing) {
        await tgApi('sendMessage', {
          chat_id: chatId,
          text:
            `⚠️ <b>Контакт уже существует!</b>\n\n` +
            `👤 <b>${existing.name}</b> уже сохранён с номером ${phone}.\n\n` +
            `Откройте приложение для просмотра.`,
          parse_mode: 'HTML',
          reply_markup: PERSISTENT_KEYBOARD,
        });
        return;
      }
    }

    // Try to fetch Telegram avatar if the contact has a Telegram user_id
    let avatarDataUrl: string | null = null;
    if (contact.user_id) {
      avatarDataUrl = await fetchTelegramUserAvatar(contact.user_id);
    }

    await addContactToFirestore(telegramUserId, {
      name: fullName,
      firstName: contact.first_name,
      phone,
      avatarDataUrl,
    });

    const phoneStr = phone ? `\n📞 ${phone}` : '';
    const photoStr = avatarDataUrl ? '\n🖼 Фото профиля сохранено' : '';

    await tgApi('sendMessage', {
      chat_id: chatId,
      text: `✅ <b>Контакт сохранён!</b>\n\n👤 ${fullName}${phoneStr}${photoStr}`,
      parse_mode: 'HTML',
      reply_markup: PERSISTENT_KEYBOARD,
    });
  } catch (e: any) {
    console.error('Contact import error:', e);
    await tgApi('sendMessage', {
      chat_id: chatId,
      text: '❌ Не удалось сохранить контакт. Попробуйте ещё раз.',
      reply_markup: PERSISTENT_KEYBOARD,
    });
  }
}

// ---------------------------------------------------------------------------
// POST — receives updates from Telegram
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  try {
    // Verify the request actually originates from Telegram. Telegram echoes the secret_token
    // configured at setWebhook time in this header. Forged requests are silently dropped.
    if (WEBHOOK_SECRET) {
      const provided = request.headers.get('x-telegram-bot-api-secret-token');
      if (provided !== WEBHOOK_SECRET) {
        return NextResponse.json({ ok: true });
      }
    } else {
      console.warn('TELEGRAM_WEBHOOK_SECRET is not set — webhook is unauthenticated.');
    }

    const update = await request.json();

    // Inline-button presses (e.g. the "Инструкция" button under the welcome message)
    const callbackQuery = update?.callback_query;
    if (callbackQuery) {
      const cbChatId = callbackQuery.message?.chat?.id;
      const data = callbackQuery.data;
      // Acknowledge so Telegram stops the button's loading spinner
      await tgApi('answerCallbackQuery', { callback_query_id: callbackQuery.id });
      if (cbChatId && data === 'instructions') {
        await handleInstructions(cbChatId, getBaseUrl(request));
      }
      return NextResponse.json({ ok: true });
    }

    const message = update?.message;
    if (!message) return NextResponse.json({ ok: true });

    const chatId = message.chat.id;
    const telegramUserId = message.from?.id;
    const firstName = message.from?.first_name || 'друг';
    const baseUrl = getBaseUrl(request);

    // 1. /start command
    if (message.text?.startsWith('/start')) {
      await handleStart(chatId, firstName, baseUrl);
      return NextResponse.json({ ok: true });
    }

    // 2. Forwarded contact from phone book
    if (message.contact) {
      await handleForwardedContact(chatId, telegramUserId, message.contact);
      return NextResponse.json({ ok: true });
    }

    // 3. Text messages
    if (message.text) {
      const text = message.text.trim();

      // Keyboard button: Add contact
      if (text === '📝 Добавить контакт') {
        await handleAddContactButton(chatId);
        return NextResponse.json({ ok: true });
      }

      // Keyboard button: Search contact
      if (text === '🔍 Поиск контакта') {
        await handleSearchButton(chatId);
        return NextResponse.json({ ok: true });
      }

      // Free text — route by current mode
      const mode = await getUserMode(chatId) || 'idle';

      if (mode === 'add') {
        await handleTextAddContact(chatId, telegramUserId, text);
      } else if (mode === 'search') {
        await handleTextSearch(chatId, telegramUserId, text);
      } else {
        // Idle mode — prompt user to choose action
        await tgApi('sendMessage', {
          chat_id: chatId,
          text: '👇 Выберите действие с помощью кнопок внизу, или перешлите контакт.',
          reply_markup: PERSISTENT_KEYBOARD,
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json({ ok: true });
  }
}

// ---------------------------------------------------------------------------
// GET — developer helper: registers the webhook with Telegram
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  try {
    if (!BOT_TOKEN) {
      return NextResponse.json(
        { error: 'TELEGRAM_BOT_TOKEN is not configured' },
        { status: 500 },
      );
    }

    // Authorize: only someone who knows the secret may (re)point the bot's webhook.
    const provided = new URL(request.url).searchParams.get('secret');
    if (!WEBHOOK_SECRET || provided !== WEBHOOK_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const baseUrl = getBaseUrl(request);
    const webhookUrl = `${baseUrl}/api/bot/webhook`;

    // Register the webhook — allow voice and contact messages.
    // secret_token makes Telegram echo it back on every update so POST can verify the source.
    const result = await tgApi('setWebhook', {
      url: webhookUrl,
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: true,
      secret_token: WEBHOOK_SECRET,
    });

    // Set the default Menu Button for all chats
    await tgApi('setChatMenuButton', {
      menu_button: {
        type: 'web_app',
          text: 'Открыть',
        web_app: { url: baseUrl },
      },
    });

    return NextResponse.json({
      success: true,
      webhookUrl,
      telegramResponse: result,
      note: 'Webhook registered! Now open the bot in Telegram and press /start.',
    });
  } catch (error: any) {
    console.error('Webhook registration error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to register webhook' },
      { status: 500 },
    );
  }
}
