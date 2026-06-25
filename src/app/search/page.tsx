"use client"

import { useState, useMemo, useRef, useDeferredValue } from "react";
import { Search, Sparkles, X, ChevronRight, ArrowUp } from "lucide-react";
import { aiSemanticContactSearch } from "@/ai/flows/ai-semantic-contact-search-flow";
import { embedTexts } from "@/ai/flows/embed-flow";
import { extractSearchFilters } from "@/ai/flows/extract-search-filters-flow";
import { useToast } from "@/hooks/use-toast";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { ru, enUS } from "date-fns/locale";
import { useT, useLang } from "@/lib/i18n";
import { useUser, useFirestore, useContacts } from "@/firebase";
import { updateDocumentNonBlocking } from "@/firebase/non-blocking-updates";
import { doc, deleteField } from "firebase/firestore";
import {
  selectSearchCandidates, buildContactVectors, applySearchFilters,
  cosineSimilarity, EMBEDDING_VERSION, type SearchFilters,
} from "@/lib/vector";
import { Contact } from "@/lib/types";
import { haptic } from "@/lib/telegram";
import { playSound } from "@/lib/sound";
import { useTypewriter } from "@/hooks/use-typewriter";

const normalize = (s: string) => s.toLowerCase().replace(/ё/g, 'е').trim();

// Canonicalise phone numbers so RU "8XXX", "+7XXX" and "7XXX" all match:
// keep digits only and treat a leading 8 as the 7 country code.
const canonPhone = (s: string) => {
  const d = s.replace(/\D/g, '');
  return d.startsWith('8') ? '7' + d.slice(1) : d;
};

const TAG_COLORS = [
  'var(--neo-yellow)',
  'var(--neo-pink)',
  'var(--neo-cyan)',
];

// The embed server action caps each call at 100 texts; per-fact embedding can
// exceed that across many contacts, so chunk and concatenate.
async function embedTextsChunked(
  texts: string[], idToken: string, taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY'
): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 100) {
    out.push(...await embedTexts(texts.slice(i, i + 100), idToken, taskType));
  }
  return out;
}

// In-session semantic cache: a new query close enough to a recent one reuses its
// result, skipping the (expensive) relevance LLM call entirely.
type CacheEntry = { vec: number[]; ids: string[] };
const SEMANTIC_CACHE_THRESHOLD = 0.97;
const SEMANTIC_CACHE_MAX = 25;

export default function SearchPage() {
  const { toast } = useToast();
  const { user } = useUser();
  const firestore = useFirestore();
  const t = useT();
  const { lang } = useLang();
  const inputRef = useRef<HTMLInputElement>(null);
  const listScrollRef = useRef<HTMLDivElement>(null);
  const semanticCacheRef = useRef<CacheEntry[]>([]);
  const [showScrollTop, setShowScrollTop] = useState(false);

  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [isLoading, setIsLoading] = useState(false);
  const [aiResults, setAiResults] = useState<string[] | null>(null);
  const [aiSearchSummary, setAiSearchSummary] = useState<string | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [smartQuery, setSmartQuery] = useState("");
  const [showSmartSearch, setShowSmartSearch] = useState(false);

  const { displayed: typedTitle, isDone: titleDone } = useTypewriter(t.search.title, 45);
  const titleSplitAt = t.search.titleFirstWord.length;

  // Callback ref — focuses textarea immediately when it mounts into DOM
  // This preserves the user-gesture chain required by Android for keyboard
  const smartSearchRefCallback = (node: HTMLTextAreaElement | null) => {
    if (node) node.focus();
  };

  const { contacts, contactsLoading: isContactsLoading } = useContacts();

  const dynamicCategories = useMemo(() => {
    if (!contacts) return [];
    const tagCounts: Record<string, number> = {};
    contacts.forEach(c => { c.tags?.forEach(tag => { tagCounts[tag] = (tagCounts[tag] || 0) + 1; }); });
    return Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([tag, count], idx) => ({ id: tag, label: tag, count, color: TAG_COLORS[idx % TAG_COLORS.length] }));
  }, [contacts]);

  const handleAiSearch = async (textQuery: string) => {
    if (!textQuery.trim() || !contacts || !user) return;
    setIsLoading(true);
    haptic('medium');
    playSound('click');
    try {
      const idToken = await user.getIdToken();

      // 1. Self-query: split the request into a semantic part + hard logical
      //    filters (exclusions, birthday month) embeddings can't express.
      let filters: SearchFilters = { excludeTerms: [] };
      let semanticQuery = textQuery;
      try {
        const extracted = await extractSearchFilters({ query: textQuery }, idToken);
        semanticQuery = extracted.semanticQuery || textQuery;
        filters = { excludeTerms: extracted.excludeTerms, birthdayMonth: extracted.birthdayMonth };
      } catch { /* best-effort: fall back to plain semantic search */ }

      // 2. Backfill packed multi-vectors for contacts lacking a current-version
      //    set (lazy, persisted). Legacy single `embedding` is dropped on rewrite.
      const packedById = new Map<string, string[]>();
      contacts.forEach(c => {
        if (c.vecs?.length && c.embeddingVersion === EMBEDDING_VERSION) packedById.set(c.id, c.vecs);
      });
      const missing = contacts.filter(c => !packedById.has(c.id));
      if (missing.length > 0) {
        const built = await buildContactVectors(missing, texts => embedTextsChunked(texts, idToken, 'RETRIEVAL_DOCUMENT'));
        missing.forEach(c => {
          const v = built.get(c.id);
          if (v?.length) {
            packedById.set(c.id, v);
            updateDocumentNonBlocking(
              doc(firestore, "users", user.uid, "contacts", c.id),
              { vecs: v, embeddingVersion: EMBEDDING_VERSION, embedding: deleteField() },
            );
          }
        });
      }

      // 3. Embed the query (query-optimised task type).
      const [queryVec] = await embedTexts([semanticQuery], idToken, 'RETRIEVAL_QUERY');

      // 3a. Semantic cache: reuse a recent near-identical query's result.
      const cached = queryVec?.length
        ? semanticCacheRef.current.find(e => cosineSimilarity(queryVec, e.vec) >= SEMANTIC_CACHE_THRESHOLD)
        : undefined;
      let relevantIds: string[];
      if (cached) {
        relevantIds = cached.ids;
      } else {
        // 4. Apply logical filters, build the candidate set (adaptive semantic
        //    top-k ∪ keyword), then let the LLM make the final relevance call.
        const withVecs = applySearchFilters(
          contacts.map(c => ({ ...c, vecs: packedById.get(c.id) })),
          filters,
        );
        const candidates = selectSearchCandidates(semanticQuery, queryVec, withVecs);
        const response = await aiSemanticContactSearch({
          query: semanticQuery,
          contacts: candidates.map(c => ({ id: c.id, name: c.name, role: c.role, tags: c.tags || [], summary: c.summary || '' }))
        }, idToken);
        relevantIds = response.relevantContactIds;
        if (queryVec?.length) {
          semanticCacheRef.current.unshift({ vec: queryVec, ids: relevantIds });
          semanticCacheRef.current = semanticCacheRef.current.slice(0, SEMANTIC_CACHE_MAX);
        }
      }

      setAiResults(relevantIds);
      setAiSearchSummary(textQuery);
      setActiveTag(null);
      setQuery("");
      setShowSmartSearch(false);
      haptic('success');
      playSound('success');
    } catch {
      haptic('error');
      playSound('error');
      toast({ title: t.search.searchError, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const filteredContacts = useMemo(() => {
    if (!contacts) return [];
    let list = [...contacts];
    if (aiResults) {
      list = list.filter(c => aiResults.includes(c.id));
    } else if (deferredQuery) {
      const q = normalize(deferredQuery);
      const phoneQ = canonPhone(q);
      list = list.filter(c =>
        normalize(c.name).includes(q) ||
        (c.role && normalize(c.role).includes(q)) ||
        (c.phone && phoneQ.length > 0 && canonPhone(c.phone).includes(phoneQ)) ||
        c.tags?.some(t => normalize(t).includes(q))
      );
    }
    if (activeTag) list = list.filter(c => c.tags?.includes(activeTag));
    // Sort alphabetically by name, except when showing AI results (keep relevance order)
    if (!aiResults) list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    return list;
  }, [contacts, aiResults, deferredQuery, activeTag]);

  const clearAll = () => {
    setQuery(""); setAiResults(null); setAiSearchSummary(null); setActiveTag(null);
    haptic('light');
  };

  const onListScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setShowScrollTop(e.currentTarget.scrollTop > 300);
  };
  const scrollListTop = () => {
    listScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    haptic('light');
  };

  return (
    <div style={{ height: 'calc(var(--app-vh, 100vh) - 76px - env(safe-area-inset-bottom, 0px))', display: 'flex', flexDirection: 'column', overflow: 'hidden', backgroundColor: 'var(--neo-bg)', position: 'relative', isolation: 'isolate' }}>
      {/* Decorative corner accents */}
      <div aria-hidden style={{ position: 'absolute', top: 0, left: 0, width: '150px', height: '150px', backgroundColor: 'var(--neo-yellow)', clipPath: 'polygon(0 0, 100% 0, 0 100%)', borderRight: 'var(--neo-border-width) solid var(--neo-border)', zIndex: -1, pointerEvents: 'none' }} />
      <div aria-hidden style={{ position: 'absolute', bottom: 0, right: 0, width: '200px', height: '200px', backgroundColor: 'var(--neo-cyan)', clipPath: 'polygon(100% 0, 100% 100%, 0 100%)', zIndex: -1, pointerEvents: 'none' }} />

      {/* Typewriter title */}
      <div className="px-4 pt-6 pb-2 shrink-0">
        <h1 className="neo-title">
          {typedTitle.length <= titleSplitAt ? (
            typedTitle
          ) : (
            <>{typedTitle.slice(0, titleSplitAt)}<span className="neo-title-accent">{typedTitle.slice(titleSplitAt)}</span></>
          )}
          {!titleDone && (
            <span
              className="inline-block w-[3px] h-[28px] ml-1 animate-pulse"
              style={{ backgroundColor: 'var(--neo-accent)', verticalAlign: 'bottom' }}
            />
          )}
        </h1>
      </div>

      {/* Search bar — not sticky/opaque so the corner accent isn't clipped */}
      <div className="px-4 pb-2 shrink-0">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5" style={{ color: 'var(--neo-hint)' }} />
          <input
            ref={inputRef}
            type="text"
            placeholder={t.search.placeholder}
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="neo-input pl-12 pr-10"
            style={{ height: '52px', fontSize: '16px', fontWeight: 600 }}
          />
          {(query || aiResults) && (
            <button onClick={clearAll} className="absolute right-4 top-1/2 -translate-y-1/2">
              <X className="w-5 h-5" style={{ color: 'var(--neo-text)' }} />
            </button>
          )}
        </div>
      </div>

      <div className="px-4 space-y-3 pt-2 shrink-0">
        {/* Category tags */}
        <div className="flex gap-2 overflow-x-auto py-1 scrollbar-hide -mx-1 px-1">
          {dynamicCategories.map((cat, idx) => {
            const active = activeTag === cat.id;
            return (
              <button key={cat.id}
                onClick={() => { haptic('selection'); setActiveTag(active ? null : cat.id); setAiResults(null); setAiSearchSummary(null); }}
                className="flex items-center gap-2 px-4 py-3 shrink-0 text-xs font-bold uppercase transition-all"
                style={{
                  backgroundColor: active ? cat.color : cat.color,
                  opacity: active ? 1 : 0.85,
                  border: 'var(--neo-border-width) solid var(--neo-border)',
                  boxShadow: active ? 'var(--neo-shadow)' : 'none',
                  color: '#000',
                }}
              >
                <span className="neo-badge text-[10px]" style={{ backgroundColor: 'var(--neo-surface)', color: 'var(--neo-text)', borderColor: 'var(--neo-border)' }}>{cat.count}</span>
                {cat.label}
                <span className="opacity-40 font-black">{String(idx + 1).padStart(2, '0')}</span>
              </button>
            );
          })}
          {/* Smart search button — animated gradient border */}
          <button
            onClick={() => { haptic('light'); setShowSmartSearch(!showSmartSearch); }}
            className="flex items-center gap-2 px-4 py-3 shrink-0 text-xs font-bold uppercase neo-smart-search-btn"
            style={{ color: 'var(--neo-text)', position: 'relative' }}
          >
            <Sparkles className="w-4 h-4" />
            {t.search.smartSearch}
          </button>
        </div>

        {/* Smart search panel */}
        {showSmartSearch && (
          <div className="neo-card p-4 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="w-4 h-4" style={{ color: 'var(--neo-accent)' }} />
              <span className="neo-section-header">{t.search.smartSearch}</span>
            </div>
            <textarea
              ref={smartSearchRefCallback}
              className="neo-textarea"
              placeholder={t.search.smartPlaceholder}
              value={smartQuery}
              onChange={e => setSmartQuery(e.target.value)}
              style={{ minHeight: '80px' }}
            />
            <button
              onClick={() => handleAiSearch(smartQuery)}
              disabled={isLoading || !smartQuery.trim()}
              className="neo-button-accent"
            >
              {isLoading ? <div className="w-5 h-5 border-2 rounded-full animate-spin" style={{ borderColor: '#fff', borderTopColor: 'transparent' }} /> : t.search.find}
            </button>
          </div>
        )}

        {/* AI search label */}
        {aiSearchSummary && (
          <div className="flex items-center gap-2 px-1">
            <Sparkles className="w-3.5 h-3.5" style={{ color: 'var(--neo-accent)' }} />
            <span className="text-xs font-bold" style={{ color: 'var(--neo-accent)' }}>«{aiSearchSummary}»</span>
          </div>
        )}

        {/* Results count */}
        <div className="flex items-center justify-between px-1">
          <span className="text-xs font-bold uppercase" style={{ color: 'var(--neo-hint)' }}>
            {aiResults ? t.search.aiResults : activeTag ? `#${activeTag}` : t.search.allContacts}
          </span>
          <span className="neo-badge text-[10px]">{filteredContacts.length}</span>
        </div>
      </div>

      {/* Scrollable contact list (only this scrolls, not the page) */}
      <div ref={listScrollRef} onScroll={onListScroll} className="px-4 pt-3 pb-4 flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
        {/* Contact list */}
        <div className="neo-card">
          {isContactsLoading ? (
            <div>
              {[0, 1, 2, 3, 4].map(i => (
                <div key={i} className="neo-cell animate-pulse" style={i > 0 ? { borderTop: `var(--neo-border-width) solid var(--neo-separator)` } : {}}>
                  <div className="w-10 h-10 shrink-0" style={{ backgroundColor: 'var(--neo-chip-bg)', border: 'var(--neo-border-width) solid var(--neo-border)' }} />
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="h-3 w-1/2" style={{ backgroundColor: 'var(--neo-chip-bg)' }} />
                    <div className="h-2.5 w-1/3" style={{ backgroundColor: 'var(--neo-chip-bg)' }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (contacts && contacts.length === 0) ? (
            <div className="p-10 text-center flex flex-col items-center gap-3">
              <p className="text-sm font-medium" style={{ color: 'var(--neo-hint)' }}>{t.search.noContactsYet}</p>
              <Link href="/add" onClick={() => haptic('light')} className="neo-button-accent w-auto px-6" style={{ minHeight: '44px' }}>
                {t.search.addFirst}
              </Link>
            </div>
          ) : filteredContacts.length > 0 ? filteredContacts.map((contact, idx) => (
            <Link
              key={contact.id}
              href={`/contact/${contact.id}`}
              onClick={() => haptic('light')}
              className="neo-cell"
              style={idx > 0 ? { borderTop: `var(--neo-border-width) solid var(--neo-separator)` } : {}}
            >
              <div className="neo-avatar w-10 h-10">
                {contact.avatarUrl ? (
                  <img src={contact.avatarUrl} alt="" loading="lazy" />
                ) : (
                  <span className="text-sm font-bold" style={{ color: 'var(--neo-hint)' }}>{contact.name[0]}</span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold truncate" style={{ color: 'var(--neo-text)' }}>{contact.name}</div>
                <div className="text-xs truncate" style={{ color: 'var(--neo-hint)' }}>
                  {contact.role || (contact.lastInteraction ? formatDistanceToNow(new Date(contact.lastInteraction), { addSuffix: true, locale: lang === 'ru' ? ru : enUS }) : t.search.contactWord)}
                </div>
              </div>
              <div className="flex gap-1 shrink-0">
                {contact.tags?.slice(0, 1).map(tag => (
                  <span key={tag} className="neo-chip text-[10px]">#{tag}</span>
                ))}
              </div>
            </Link>
          )) : (
            <div className="p-12 text-center">
              <p className="text-sm font-medium" style={{ color: 'var(--neo-hint)' }}>{t.search.nobody}</p>
            </div>
          )}
        </div>
      </div>

      {/* Scroll-to-top arrow — appears when the list is scrolled down */}
      {showScrollTop && (
        <button
          onClick={scrollListTop}
          aria-label="Scroll to top"
          className="absolute flex items-center justify-center"
          style={{
            left: '16px', bottom: '16px', width: '44px', height: '44px',
            backgroundColor: 'var(--neo-accent)', color: '#fff',
            border: 'var(--neo-border-width) solid var(--neo-border)',
            boxShadow: 'var(--neo-shadow)', zIndex: 20,
          }}
        >
          <ArrowUp className="w-5 h-5" />
        </button>
      )}
    </div>
  );
}
