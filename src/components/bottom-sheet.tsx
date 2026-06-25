'use client';

import { ReactNode, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/**
 * Bottom-sheet overlay (slides up from the bottom). Rendered through a portal
 * to <body> so it sits above the fixed bottom navigation regardless of the
 * page's stacking context.
 */
export function BottomSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!mounted) return null;

  return createPortal(
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.45)', zIndex: 90,
          opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none', transition: 'opacity 0.25s ease',
        }}
      />
      <div
        style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 100,
          transform: open ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)',
          backgroundColor: 'var(--neo-surface)',
          borderTop: 'var(--neo-border-width) solid var(--neo-border)',
          boxShadow: '0 -4px 0px 0px var(--neo-border)',
          maxHeight: '85vh', overflowY: 'auto',
          paddingBottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
        }}
      >
        <div
          className="flex items-center justify-between px-4 py-4"
          style={{ borderBottom: '1.5px solid var(--neo-separator)', position: 'sticky', top: 0, backgroundColor: 'var(--neo-surface)', zIndex: 1 }}
        >
          <span className="text-sm font-black uppercase">{title}</span>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center"
            style={{ border: 'var(--neo-border-width) solid var(--neo-border)', backgroundColor: 'var(--neo-chip-bg)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </>,
    document.body,
  );
}
