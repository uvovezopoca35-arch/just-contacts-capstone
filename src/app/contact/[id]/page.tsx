"use client"

import { useState, useMemo, useRef, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Phone, Mail, Pencil, History, Coffee, Globe,
  User as UserIcon, MessageSquare, Star, UtensilsCrossed,
  Camera, Image as ImageIcon, Trash2, X, ArrowRight,
  ChevronDown, ChevronUp, Cake, HelpCircle, CalendarPlus
} from "lucide-react";
import { Contact, InteractionEvent } from "@/lib/types";
import { updateContactWithAi } from "@/ai/flows/update-contact-flow";
import { askAboutContact } from "@/ai/flows/ask-contact-flow";
import { updateDossier } from "@/ai/flows/update-dossier-flow";
import { useToast } from "@/hooks/use-toast";
import { resizeImage } from "@/lib/image-utils";
import Link from "next/link";
import { useUser, useFirestore, useDoc, useCollection, useMemoFirebase } from "@/firebase";
import { collection, doc, query, orderBy, serverTimestamp, increment, deleteField } from "firebase/firestore";
import { updateDocumentNonBlocking, deleteDocumentNonBlocking, addDocumentNonBlocking } from "@/firebase/non-blocking-updates";
import { getTelegramWebApp, haptic } from "@/lib/telegram";
import { playSound } from "@/lib/sound";
import { useT, useLang } from "@/lib/i18n";
import { BottomSheet } from "@/components/bottom-sheet";

const TAGS_COLLAPSE_LIMIT = 5;
const HISTORY_COLLAPSE_LIMIT = 1;

export default function ContactProfile() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const { user } = useUser();
  const firestore = useFirestore();
  const t = useT();
  const { lang } = useLang();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isUpdating, setIsUpdating] = useState(false);
  const [isPhotoLoading, setIsPhotoLoading] = useState(false);
  const [updateText, setUpdateText] = useState("");
  const [showEditPanel, setShowEditPanel] = useState(false);
  const [showAllTags, setShowAllTags] = useState(false);
  const [showHistorySheet, setShowHistorySheet] = useState(false);
  const [editTab, setEditTab] = useState<'fields' | 'ai'>('fields');
  const [mName, setMName] = useState("");
  const [mRole, setMRole] = useState("");
  const [mPhone, setMPhone] = useState("");
  const [mEmail, setMEmail] = useState("");
  const [mBirthday, setMBirthday] = useState("");
  const [askQuestion, setAskQuestion] = useState("");
  const [askAnswer, setAskAnswer] = useState<string | null>(null);
  const [isAsking, setIsAsking] = useState(false);
  const [showAsk, setShowAsk] = useState(false);

  const contactId = params.id as string;

  // Telegram BackButton
  useEffect(() => {
    const tg = getTelegramWebApp();
    if (!tg) return;
    tg.BackButton.show();
    const goBack = () => router.back();
    tg.BackButton.onClick(goBack);
    return () => { tg.BackButton.offClick(goBack); tg.BackButton.hide(); };
  }, [router]);

  // Close drawer on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowEditPanel(false);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  // Prevent body scroll when drawer is open
  useEffect(() => {
    if (showEditPanel) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [showEditPanel]);

  const contactRef = useMemoFirebase(() => {
    if (!firestore || !user || !contactId) return null;
    return doc(firestore, "users", user.uid, "contacts", contactId);
  }, [firestore, user, contactId]);

  const { data: contact, isLoading: isContactLoading } = useDoc<Contact>(contactRef);

  const historyQuery = useMemoFirebase(() => {
    if (!firestore || !user || !contactId) return null;
    return query(collection(firestore, "users", user.uid, "contacts", contactId, "history"), orderBy("date", "desc"));
  }, [firestore, user, contactId]);

  const { data: history } = useCollection<InteractionEvent>(historyQuery);

  const parsedSummary = useMemo(() => {
    if (!contact?.summary) return null;
    try {
      const parsed = JSON.parse(contact.summary);
      if (parsed.facts) {
        const uniqueFacts: Record<string, string> = {};
        parsed.facts.forEach((f: any) => {
          if (!f.label || !f.value) return;
          const label = f.label.toUpperCase().trim();
          if (uniqueFacts[label]) {
            if (!uniqueFacts[label].includes(f.value)) uniqueFacts[label] += `, ${f.value}`;
          } else {
            uniqueFacts[label] = f.value;
          }
        });
        parsed.facts = Object.entries(uniqueFacts).map(([label, value]) => ({ label, value }));
      }
      return parsed;
    } catch { return { recentSummary: contact.summary, facts: [] }; }
  }, [contact?.summary]);

  // Populate the manual edit form whenever the drawer opens
  useEffect(() => {
    if (showEditPanel && contact) {
      setMName(contact.name || "");
      setMRole(contact.role || "");
      setMPhone(contact.phone || "");
      setMEmail(contact.email || "");
      setMBirthday(contact.birthday ? contact.birthday.slice(0, 10) : "");
    }
  }, [showEditPanel, contact]);

  const handleManualSave = () => {
    if (!contact || !contactRef) return;
    const name = mName.trim();
    if (!name) { toast({ title: t.common.error, variant: "destructive" }); return; }
    haptic('medium');
    const updates: any = {
      name,
      firstName: name.split(' ')[0],
      role: mRole.trim(),
      phone: mPhone.trim(),
      email: mEmail.trim(),
      birthday: mBirthday || "",
    };
    // Searchable fields changed → invalidate stored vectors so search recomputes them
    if (name !== contact.name || updates.role !== (contact.role || "")) {
      updates.vecs = deleteField();
      updates.embeddingVersion = deleteField();
      updates.embedding = deleteField();
    }
    updateDocumentNonBlocking(contactRef, updates);
    haptic('success');
    toast({ title: t.contact.contactUpdated });
    setShowEditPanel(false);
  };

  const handleAsk = async () => {
    const question = askQuestion.trim();
    if (!contact || !user || !question || isAsking) return;
    setIsAsking(true);
    setAskAnswer(null);
    haptic('medium');
    playSound('click');
    try {
      const idToken = await user.getIdToken();
      const interactions = (history || []).map(h => ({ type: h.type || 'note', date: h.date || '', summary: h.summary || '' }));
      const res = await askAboutContact({
        question,
        contactName: contact.name || '',
        role: contact.role || '',
        dossier: parsedSummary?.recentSummary || '',
        interactions,
      }, idToken);
      setAskAnswer(res.answer || '');
      haptic('success');
      playSound('success');
    } catch (e: any) {
      haptic('error');
      playSound('error');
      const msg = e.message || '';
      const isRateLimit = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED');
      toast({ title: t.common.error, description: isRateLimit ? t.contact.rateLimitRetry : t.contact.summaryError, variant: "destructive" });
    } finally {
      setIsAsking(false);
    }
  };

  const toggleFavorite = () => {
    if (!contact || !contactRef) return;
    haptic('medium');
    updateDocumentNonBlocking(contactRef, { isFavorite: !contact.isFavorite });
    toast({ title: contact.isFavorite ? t.contact.removedFav : t.contact.addedFav });
  };

  const handleDeleteContact = () => {
    const tg = getTelegramWebApp();
    if (tg) {
      tg.showConfirm(t.contact.deleteConfirm, (ok: boolean) => {
        if (!ok || !contactRef || !user?.uid) return;
        haptic('warning');
        deleteDocumentNonBlocking(contactRef);
        updateDocumentNonBlocking(doc(firestore, "users", user.uid), { totalContacts: increment(-1) });
        playSound('delete');
        toast({ title: t.contact.deleted });
        router.push("/search");
      });
    } else {
      if (!confirm(t.contact.deleteConfirmShort) || !contactRef || !user?.uid) return;
      deleteDocumentNonBlocking(contactRef);
      updateDocumentNonBlocking(doc(firestore, "users", user.uid), { totalContacts: increment(-1) });
      playSound('delete');
      toast({ title: t.contact.deleted });
      router.push("/search");
    }
  };

  const handleAiUpdate = async () => {
    if (!contact || !updateText.trim() || !contactRef || !user) return;
    setIsUpdating(true);
    haptic('medium');
    try {
      const contactData = {
        name: contact.name || '',
        firstName: contact.firstName || '',
        role: contact.role || '',
        phone: contact.phone || '',
        email: contact.email || '',
        summary: contact.summary || '',
        birthday: contact.birthday || '',
      };
      const idToken = await user.getIdToken();
      const result = await updateContactWithAi({ currentContact: contactData, updateCommand: updateText }, idToken);
      const updates: any = {};
      if (result.name) updates.name = result.name;
      if (result.firstName) updates.firstName = result.firstName;
      if (result.role) updates.role = result.role;
      if (result.phone) updates.phone = result.phone;
      if (result.email) updates.email = result.email;
      if (result.summary) updates.summary = result.summary;
      if (result.tags) updates.tags = result.tags;
      if (result.birthday) updates.birthday = result.birthday;
      if (Object.keys(updates).length > 0) {
        // searchable fields changed → invalidate stored vectors
        if (updates.name || updates.role || updates.summary || updates.tags) {
          updates.vecs = deleteField();
          updates.embeddingVersion = deleteField();
          updates.embedding = deleteField();
        }
        updateDocumentNonBlocking(contactRef, updates);
        addDocumentNonBlocking(collection(firestore, "users", user.uid, "contacts", contactId, "history"), {
          contactId, date: new Date().toISOString(), type: "note",
          summary: t.contact.changeNote(updateText), createdAt: serverTimestamp()
        });
        haptic('success');
        toast({ title: t.contact.contactUpdated });
      } else {
        toast({ title: t.contact.noChanges });
      }
      setUpdateText("");
      setShowEditPanel(false);
    } catch (e: any) {
      console.error('AI update error:', e);
      haptic('error');
      const msg = e.message || '';
      const isRateLimit = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED');
      toast({ title: t.common.error, description: isRateLimit ? t.contact.rateLimitRetry : t.contact.updateError, variant: "destructive" });
    } finally { setIsUpdating(false); }
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setIsPhotoLoading(true);
    const reader = new FileReader();
    reader.onloadend = async () => {
      try {
        // Store the avatar inline as a data URL (256px) — no Storage bucket needed.
        const optimized = await resizeImage(reader.result as string, 256, 256);
        if (contactRef) {
          updateDocumentNonBlocking(contactRef, { avatarUrl: optimized });
          haptic('success');
          toast({ title: t.contact.photoUpdated });
        }
      } catch { toast({ title: t.contact.photoError, variant: "destructive" }); }
      finally { setIsPhotoLoading(false); }
    };
    reader.readAsDataURL(file);
  };

  if (isContactLoading) return (
    <div className="flex items-center justify-center min-h-screen" style={{ backgroundColor: 'var(--neo-bg)' }}>
      <div className="w-6 h-6 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--neo-accent)', borderTopColor: 'transparent' }} />
    </div>
  );
  if (!contact) return (
    <div className="flex items-center justify-center min-h-screen" style={{ backgroundColor: 'var(--neo-bg)' }}>
      <p className="text-sm font-bold" style={{ color: 'var(--neo-hint)' }}>{t.contact.notFound}</p>
    </div>
  );

  const getEventIcon = (type: string) => {
    if (type === 'meeting') return <Coffee className="w-4 h-4" style={{ color: 'var(--neo-accent)' }} />;
    if (type === 'call') return <Phone className="w-4 h-4" style={{ color: 'var(--neo-accent)' }} />;
    if (type === 'dinner') return <UtensilsCrossed className="w-4 h-4" style={{ color: 'var(--neo-accent)' }} />;
    return <Globe className="w-4 h-4" style={{ color: 'var(--neo-accent)' }} />;
  };
  const getEventLabel = (type: string) => t.contact.eventLabels[type] || t.contact.eventLabels.note;

  const renderEventRow = (event: InteractionEvent, idx: number) => (
    <div key={event.id} className="neo-cell" style={idx > 0 ? { borderTop: `var(--neo-border-width) solid var(--neo-separator)` } : {}}>
      <div className="w-8 h-8 flex items-center justify-center shrink-0" style={{ backgroundColor: 'var(--neo-chip-bg)', border: '1.5px solid var(--neo-border)' }}>
        {getEventIcon(event.type)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-sm font-bold" style={{ color: 'var(--neo-text)' }}>{getEventLabel(event.type)}</span>
          <span className="text-[10px] shrink-0 font-medium" style={{ color: 'var(--neo-hint)' }}>
            {event.date ? new Date(event.date).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'short' }) : '—'}
          </span>
        </div>
        <p className="text-xs" style={{ color: 'var(--neo-hint)' }}>{event.summary}</p>
      </div>
    </div>
  );

  const tags = contact.tags || [];
  const visibleTags = showAllTags ? tags : tags.slice(0, TAGS_COLLAPSE_LIMIT);
  const hasMoreTags = tags.length > TAGS_COLLAPSE_LIMIT;

  const allHistory = history || [];
  const visibleHistory = allHistory.slice(0, HISTORY_COLLAPSE_LIMIT);
  const hasMoreHistory = allHistory.length > HISTORY_COLLAPSE_LIMIT;

  return (
    <div style={{ height: 'calc(var(--app-vh, 100vh) - 76px - env(safe-area-inset-bottom, 0px))', display: 'flex', flexDirection: 'column', overflow: 'hidden', backgroundColor: 'var(--neo-bg)', position: 'relative', isolation: 'isolate' }}>
      {/* Decorative corner accents */}
      <div aria-hidden style={{ position: 'absolute', top: 0, left: 0, width: '150px', height: '150px', backgroundColor: 'var(--neo-yellow)', clipPath: 'polygon(0 0, 100% 0, 0 100%)', borderRight: 'var(--neo-border-width) solid var(--neo-border)', zIndex: -1, pointerEvents: 'none' }} />
      <div aria-hidden style={{ position: 'absolute', bottom: 0, right: 0, width: '200px', height: '200px', backgroundColor: 'var(--neo-cyan)', clipPath: 'polygon(100% 0, 100% 100%, 0 100%)', zIndex: -1, pointerEvents: 'none' }} />

      {/* Scrollable content (page itself stays fixed) */}
      <div className="flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
      {/* Profile card */}
      <div className="px-4 pt-6 pb-4">
        <div className="neo-card p-6 flex flex-col sm:flex-row items-center sm:items-start gap-4">
          {/* Avatar */}
          <div className="relative shrink-0">
            <div className="neo-avatar w-24 h-24" onClick={() => fileInputRef.current?.click()} style={{ cursor: 'pointer' }}>
              {contact.avatarUrl ? (
                <img src={contact.avatarUrl} alt={contact.name} />
              ) : (
                <span className="text-3xl font-black" style={{ color: 'var(--neo-hint)' }}>{contact.name[0]}</span>
              )}
            </div>
            <input type="file" ref={fileInputRef} onChange={handlePhotoUpload} accept="image/*" className="hidden" />
            <button onClick={toggleFavorite}
              className="absolute -bottom-2 -right-2 w-8 h-8 flex items-center justify-center"
              style={{
                backgroundColor: contact.isFavorite ? 'var(--neo-yellow)' : 'var(--neo-surface)',
                border: 'var(--neo-border-width) solid var(--neo-border)',
              }}>
              <Star className="w-4 h-4" style={{ fill: contact.isFavorite ? '#000' : 'transparent', color: contact.isFavorite ? '#000' : 'var(--neo-hint)' }} />
            </button>
          </div>
          {/* Info */}
          <div className="flex-1 text-center sm:text-left">
            <h1 className="text-2xl font-black uppercase" style={{ color: 'var(--neo-text)' }}>{contact.name}</h1>
            {contact.role && <p className="text-sm font-medium mt-1" style={{ color: 'var(--neo-hint)' }}>{contact.role}</p>}
            {(contact.phone || contact.birthday) && (
              <div className="flex flex-wrap items-center gap-2 mt-2 justify-center sm:justify-start">
                {contact.phone && (
                  <a href={`tel:${contact.phone}`} className="inline-flex items-center gap-1.5 px-3 py-1" style={{ border: '1.5px solid var(--neo-border)', color: 'var(--neo-text)', fontSize: '13px', fontWeight: 600 }}>
                    <Phone className="w-3.5 h-3.5" /> {contact.phone}
                  </a>
                )}
                {contact.birthday && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1" style={{ border: '1.5px solid var(--neo-border)', backgroundColor: 'var(--neo-yellow)', color: '#000', fontSize: '13px', fontWeight: 700 }}>
                    <Cake className="w-3.5 h-3.5" /> {new Date(contact.birthday).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'short' })}
                  </span>
                )}
              </div>
            )}
            {/* Action buttons */}
            <div className="flex gap-2 mt-3 justify-center sm:justify-start">
              <button
                onClick={() => { setShowEditPanel(true); haptic('light'); }}
                className="w-10 h-10 flex items-center justify-center"
                style={{ backgroundColor: 'var(--neo-accent)', color: '#fff', border: 'var(--neo-border-width) solid var(--neo-border)' }}>
                <Pencil className="w-4 h-4" />
              </button>
              <button onClick={handleDeleteContact}
                className="w-10 h-10 flex items-center justify-center"
                style={{ backgroundColor: 'var(--neo-red)', color: '#fff', border: 'var(--neo-border-width) solid var(--neo-border)' }}>
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 space-y-4">
        {/* Tags — collapsible */}
        {tags.length > 0 && (
          <div>
            <div className="flex flex-wrap gap-2">
              {visibleTags.map(tag => <span key={tag} className="neo-chip">#{tag}</span>)}
            </div>
            {hasMoreTags && (
              <button
                onClick={() => { setShowAllTags(!showAllTags); haptic('light'); }}
                className="mt-2 flex items-center gap-1 text-[11px] font-bold uppercase"
                style={{ color: 'var(--neo-accent)' }}
              >
                {showAllTags
                  ? <><ChevronUp className="w-3.5 h-3.5" /> {t.common.collapse}</>
                  : <><ChevronDown className="w-3.5 h-3.5" /> {t.contact.moreTags(tags.length - TAGS_COLLAPSE_LIMIT)}</>
                }
              </button>
            )}
          </div>
        )}

        {/* Dossier — "who is this person", auto-maintained */}
        <div className="neo-card-blue p-4">
          <p className="text-sm leading-relaxed font-medium">
            {parsedSummary?.recentSummary || t.contact.dossierEmpty}
          </p>
        </div>

        {/* Quick actions: Ask / Event */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => { setShowAsk(s => !s); haptic('light'); }}
            className="flex items-center justify-center gap-2 py-3 text-sm font-bold uppercase"
            style={{
              border: 'var(--neo-border-width) solid var(--neo-border)',
              boxShadow: 'var(--neo-shadow-sm)',
              backgroundColor: showAsk ? 'var(--neo-accent)' : 'var(--neo-cyan)',
              color: showAsk ? '#fff' : '#000',
            }}
          >
            <HelpCircle className="w-4 h-4" /> {t.contact.askShort}
          </button>
          <Link
            href={`/add-event?contact=${contactId}`}
            onClick={() => haptic('light')}
            className="flex items-center justify-center gap-2 py-3 text-sm font-bold uppercase"
            style={{ border: 'var(--neo-border-width) solid var(--neo-border)', boxShadow: 'var(--neo-shadow-sm)', backgroundColor: 'var(--neo-pink)', color: '#fff' }}
          >
            <CalendarPlus className="w-4 h-4" /> {t.contact.eventShort}
          </Link>
        </div>

        {/* Ask panel — revealed by the Ask button */}
        {showAsk && (
          <div className="neo-card p-4 space-y-3">
            <div className="flex gap-2">
              <input
                className="neo-input flex-1"
                placeholder=""
                autoFocus
                value={askQuestion}
                onChange={e => setAskQuestion(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAsk(); } }}
              />
              <button
                onClick={handleAsk}
                disabled={isAsking || !askQuestion.trim()}
                className="neo-button-accent"
                style={{ width: 'auto', minHeight: '48px', paddingLeft: '16px', paddingRight: '16px' }}
              >
                {isAsking
                  ? <div className="w-5 h-5 border-2 rounded-full animate-spin" style={{ borderColor: '#fff', borderTopColor: 'transparent' }} />
                  : <ArrowRight className="w-5 h-5" />}
              </button>
            </div>
            {askAnswer && (
              <div className="neo-card-yellow p-3">
                <p className="text-sm leading-relaxed font-medium">{askAnswer}</p>
              </div>
            )}
          </div>
        )}

        {/* Extra contact details */}
        {(contact.email || contact.telegram) && (
          <div className="neo-card">
            {contact.email && (
              <a href={`mailto:${contact.email}`} className="neo-cell">
                <Mail className="w-5 h-5" style={{ color: 'var(--neo-accent)' }} />
                <span className="text-sm font-medium" style={{ color: 'var(--neo-accent)' }}>{contact.email}</span>
              </a>
            )}
            {contact.telegram && (
              <div className="neo-cell">
                <MessageSquare className="w-5 h-5" style={{ color: 'var(--neo-accent)' }} />
                <span className="text-sm font-medium" style={{ color: 'var(--neo-accent)' }}>@{contact.telegram}</span>
              </div>
            )}
          </div>
        )}

        {/* History — latest shown; tap the triangle to open all */}
        <div className="space-y-1">
          <div className="flex items-center justify-between px-1 pt-2 pb-2">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4" style={{ color: 'var(--neo-text)' }} />
              <span className="neo-section-header">{t.contact.meetingHistory}</span>
            </div>
            {hasMoreHistory && (
              <button
                onClick={() => { setShowHistorySheet(true); haptic('light'); }}
                aria-label={t.contact.showAllEvents(allHistory.length)}
                className="w-7 h-7 flex items-center justify-center"
                style={{ border: '1.5px solid var(--neo-border)', color: 'var(--neo-accent)', backgroundColor: 'var(--neo-surface)' }}
              >
                <ChevronDown className="w-4 h-4" />
              </button>
            )}
          </div>
          <div className="neo-card">
            {allHistory.length > 0 ? visibleHistory.map(renderEventRow) : (
              <div className="p-8 text-center">
                <p className="text-sm font-medium" style={{ color: 'var(--neo-hint)' }}>{t.contact.historyEmpty}</p>
              </div>
            )}
          </div>
        </div>
      </div>
      </div>

      {/* ── Edit Drawer (slides up from bottom) ── */}
      {/* Backdrop */}
      <div
        onClick={() => setShowEditPanel(false)}
        style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0,0,0,0.45)',
          zIndex: 90,
          opacity: showEditPanel ? 1 : 0,
          pointerEvents: showEditPanel ? 'auto' : 'none',
          transition: 'opacity 0.25s ease',
        }}
      />

      {/* Drawer panel */}
      <div
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 100,
          transform: showEditPanel ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)',
          backgroundColor: 'var(--neo-surface)',
          borderTop: 'var(--neo-border-width) solid var(--neo-border)',
          boxShadow: '0 -4px 0px 0px var(--neo-border)',
          maxHeight: '70vh',
          overflowY: 'auto',
          paddingBottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
        }}
      >
        {/* Drawer header */}
        <div
          className="flex items-center justify-between px-4 py-4"
          style={{ borderBottom: '1.5px solid var(--neo-separator)', position: 'sticky', top: 0, backgroundColor: 'var(--neo-surface)', zIndex: 1 }}
        >
          <div className="flex items-center gap-2">
            <Pencil className="w-4 h-4" style={{ color: 'var(--neo-accent)' }} />
            <span className="text-sm font-black uppercase">{t.contact.editTitle}</span>
          </div>
          <button
            onClick={() => setShowEditPanel(false)}
            className="w-8 h-8 flex items-center justify-center"
            style={{ border: 'var(--neo-border-width) solid var(--neo-border)', backgroundColor: 'var(--neo-chip-bg)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs: manual fields / AI command */}
        <div className="flex gap-2 px-4 pt-3">
          {(['fields', 'ai'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => { setEditTab(tab); haptic('selection'); }}
              className="flex-1 py-2 text-xs font-bold uppercase"
              style={{
                border: 'var(--neo-border-width) solid var(--neo-border)',
                backgroundColor: editTab === tab ? 'var(--neo-accent)' : 'var(--neo-surface)',
                color: editTab === tab ? '#fff' : 'var(--neo-text)',
              }}
            >
              {tab === 'fields' ? t.contact.tabFields : t.contact.tabAi}
            </button>
          ))}
        </div>

        {/* Drawer content */}
        {editTab === 'fields' ? (
          <div className="p-4 space-y-3">
            <input className="neo-input" placeholder={t.contact.fieldName} value={mName} onChange={e => setMName(e.target.value)} />
            <input className="neo-input" placeholder={t.contact.fieldRole} value={mRole} onChange={e => setMRole(e.target.value)} />
            <input className="neo-input" placeholder={t.contact.fieldPhone} value={mPhone} onChange={e => setMPhone(e.target.value)} inputMode="tel" />
            <input className="neo-input" placeholder={t.contact.fieldEmail} value={mEmail} onChange={e => setMEmail(e.target.value)} inputMode="email" />
            <div>
              <label className="text-[11px] font-bold uppercase block mb-1.5" style={{ color: 'var(--neo-hint)' }}>{t.contact.fieldBirthday}</label>
              <input type="date" className="neo-input" value={mBirthday} onChange={e => setMBirthday(e.target.value)} />
            </div>
            <button onClick={handleManualSave} disabled={!mName.trim()} className="neo-button-accent">
              {t.contact.saveChanges}
            </button>
          </div>
        ) : (
          <div className="p-4 space-y-3">
            <textarea
              value={updateText}
              onChange={e => setUpdateText(e.target.value)}
              placeholder=""
              className="neo-textarea"
              autoFocus={showEditPanel && editTab === 'ai'}
              style={{ minHeight: '120px' }}
            />
            <button
              onClick={handleAiUpdate}
              disabled={isUpdating || !updateText.trim()}
              className="neo-button-accent"
            >
              {isUpdating
                ? <div className="w-5 h-5 border-2 rounded-full animate-spin" style={{ borderColor: '#fff', borderTopColor: 'transparent' }} />
                : <><ArrowRight className="w-4 h-4" /> {t.contact.applyChanges}</>
              }
            </button>
          </div>
        )}
      </div>

      {/* Full meeting history in a bottom sheet */}
      <BottomSheet open={showHistorySheet} onClose={() => setShowHistorySheet(false)} title={t.contact.meetingHistory}>
        <div style={{ border: 'var(--neo-border-width) solid var(--neo-border)' }}>
          {allHistory.map(renderEventRow)}
        </div>
      </BottomSheet>
    </div>
  );
}
