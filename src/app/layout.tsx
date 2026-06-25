import type {Metadata, Viewport} from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Toaster } from "@/components/ui/toaster";
import Script from 'next/script';
import { FirebaseClientProvider } from '@/firebase/client-provider';
import { TelegramProvider } from '@/components/telegram-provider';
import { TelegramAuthGate } from '@/components/telegram-auth-gate';
import { BottomNav } from '@/components/tg-bottom-nav';
import { LanguageProvider } from '@/lib/i18n';
import { SettingsProvider } from '@/lib/settings';
import { AppDataProvider } from '@/firebase';

const inter = Inter({
  subsets: ['cyrillic', 'latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Just Contacts',
  description: 'AI CRM in Telegram',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <head>
        {/* Apply the stored theme before paint to avoid a flash of the wrong theme */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var m=localStorage.getItem('jc_theme')||'system';var d=m==='dark'||(m==='system'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.setAttribute('data-theme',d?'dark':'light');}catch(e){}`,
          }}
        />
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="beforeInteractive"
        />
      </head>
      <body className={inter.className}>
        <TelegramProvider>
          <LanguageProvider>
            <SettingsProvider>
            <FirebaseClientProvider>
              <TelegramAuthGate>
                <AppDataProvider>
                  {children}
                  <BottomNav />
                </AppDataProvider>
              </TelegramAuthGate>
              <Toaster />
            </FirebaseClientProvider>
            </SettingsProvider>
          </LanguageProvider>
        </TelegramProvider>
      </body>
    </html>
  );
}
