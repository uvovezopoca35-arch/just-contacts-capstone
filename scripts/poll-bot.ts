/**
 * Local dev bot polling script.
 * Polls Telegram getUpdates and processes /start commands.
 * Usage: npx tsx scripts/poll-bot.ts
 */

import 'dotenv/config';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const BASE_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;

// The public URL for the Mini App — set to your deployed URL later.
// For now we use a placeholder so the bot at least responds.
const MINI_APP_URL = process.env.MINI_APP_URL || '';

let offset = 0;

async function tgApi(method: string, body?: Record<string, unknown>) {
  const res = await fetch(`${BASE_URL}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json() as Promise<any>;
}

async function handleUpdate(update: any) {
  const message = update?.message;
  if (!message?.text) return;

  const chatId = message.chat.id;
  const text = message.text;
  const firstName = message.from?.first_name || 'друг';

  if (text.startsWith('/start')) {
    console.log(`📩 /start from ${firstName} (chat ${chatId})`);

    const replyMarkup: any = {};
    
    if (MINI_APP_URL) {
      replyMarkup.inline_keyboard = [
        [{ text: '🚀 Открыть Just Contacts', web_app: { url: MINI_APP_URL } }],
      ];
    }

    const result = await tgApi('sendMessage', {
      chat_id: chatId,
      text:
        `👋 Привет, ${firstName}!\n\n` +
        `Добро пожаловать в <b>Just Contacts</b> — твой AI-помощник для управления контактами.\n\n` +
        `🎤 Добавляй контакты голосом\n` +
        `🔍 Ищи людей по смыслу\n` +
        `🎂 Никогда не забывай дни рождения\n\n` +
        (MINI_APP_URL
          ? `Нажми кнопку ниже, чтобы открыть приложение 👇`
          : `⚙️ Приложение пока запущено локально. Деплой для открытия Mini App.`),
      parse_mode: 'HTML',
      ...(Object.keys(replyMarkup).length > 0 ? { reply_markup: replyMarkup } : {}),
    });

    if (result.ok) {
      console.log(`✅ Reply sent to ${firstName}`);
    } else {
      console.error(`❌ Failed to reply:`, result);
    }
  } else {
    console.log(`💬 Message from ${firstName}: "${text}"`);
  }
}

async function poll() {
  console.log('🤖 Bot polling started. Waiting for messages...');
  console.log(`   MINI_APP_URL: ${MINI_APP_URL || '(not set — bot will reply without web_app button)'}`);
  console.log('   Press Ctrl+C to stop.\n');

  while (true) {
    try {
      const data = await tgApi('getUpdates', {
        offset,
        timeout: 30,
        allowed_updates: ['message'],
      });

      if (data.ok && data.result?.length > 0) {
        for (const update of data.result) {
          offset = update.update_id + 1;
          await handleUpdate(update);
        }
      }
    } catch (err) {
      console.error('Polling error:', err);
      // Wait a bit before retrying on error
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

poll();
