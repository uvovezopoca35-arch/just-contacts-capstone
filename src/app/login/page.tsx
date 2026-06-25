"use client"

import { useT } from "@/lib/i18n";

export default function LoginPage() {
  const t = useT();
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-6 text-center" style={{ backgroundColor: 'var(--neo-bg)' }}>
      <div className="neo-card p-8 max-w-sm w-full">
        <h1 className="neo-title text-center mb-2">
          <span className="block">JUST</span>
          <span className="block neo-title-accent">CONTACTS</span>
        </h1>
        <p className="text-sm leading-relaxed font-medium mt-4" style={{ color: 'var(--neo-hint)' }}>
          {t.login.info}
        </p>
      </div>
    </div>
  );
}
