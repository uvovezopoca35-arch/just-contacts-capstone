import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getAdmin } from '@/lib/firebase-admin';

export const runtime = 'nodejs';

/**
 * Validates Telegram initData using HMAC-SHA256.
 * See: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
function validateInitData(initData: string, botToken: string): boolean {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return false;
    params.delete('hash');

    // Sort parameters alphabetically and join with \n
    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    // Create secret key: HMAC-SHA256("WebAppData", botToken)
    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(botToken)
      .digest();

    // Compute HMAC-SHA256 of the data check string
    const checkHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    return checkHash === hash;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    const { initData } = await request.json();
    
    if (!initData || typeof initData !== 'string') {
      return NextResponse.json({ error: 'Missing initData' }, { status: 400 });
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      console.error('TELEGRAM_BOT_TOKEN is not set');
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    // Validate the initData signature
    if (!validateInitData(initData, botToken)) {
      return NextResponse.json({ error: 'Invalid initData' }, { status: 403 });
    }

    // Parse user data
    const params = new URLSearchParams(initData);
    const userJson = params.get('user');
    const authDate = params.get('auth_date');

    if (!userJson) {
      return NextResponse.json({ error: 'No user data in initData' }, { status: 400 });
    }

    // Check auth_date freshness (5 minutes max for security)
    if (authDate) {
      const authTimestamp = parseInt(authDate, 10);
      const now = Math.floor(Date.now() / 1000);
      if (now - authTimestamp > 300) {
        return NextResponse.json({ error: 'initData expired' }, { status: 403 });
      }
    }

    const telegramUser = JSON.parse(userJson);
    const telegramId = telegramUser.id?.toString();

    if (!telegramId) {
      return NextResponse.json({ error: 'Invalid user ID' }, { status: 400 });
    }

    // Generate Firebase Custom Token with Telegram user ID as UID
    const fb = getAdmin();
    const uid = `tg_${telegramId}`;
    const customToken = await fb.auth().createCustomToken(uid, {
      telegramId: telegramUser.id,
      telegramUsername: telegramUser.username || '',
    });

    return NextResponse.json({
      customToken,
      user: {
        id: telegramUser.id,
        uid,
        firstName: telegramUser.first_name || '',
        lastName: telegramUser.last_name || '',
        username: telegramUser.username || '',
        photoUrl: telegramUser.photo_url || '',
        languageCode: telegramUser.language_code || 'ru',
      },
    });
  } catch (error: any) {
    console.error('Telegram auth error:', error);
    return NextResponse.json(
      { error: 'Authentication failed' },
      { status: 500 }
    );
  }
}
