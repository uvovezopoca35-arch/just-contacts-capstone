'use client';

import { useState, useEffect } from 'react';

/**
 * Typewriter hook — prints text char by char.
 * Returns the visible portion and whether it's still typing.
 */
export function useTypewriter(text: string, speed = 50) {
  const [displayed, setDisplayed] = useState('');
  const [isDone, setIsDone] = useState(false);

  useEffect(() => {
    if (!text) { setDisplayed(''); setIsDone(false); return; }
    setDisplayed('');
    setIsDone(false);
    let i = 0;
    const id = setInterval(() => {
      i++;
      setDisplayed(text.slice(0, i));
      if (i >= text.length) { clearInterval(id); setIsDone(true); }
    }, speed);
    return () => clearInterval(id);
  }, [text, speed]);

  return { displayed, isDone };
}
