"use client"

import { useState, useRef, useMemo, useEffect } from "react";
import { Image as ImageIcon, X, ArrowRight, PenLine } from "lucide-react";
import { BottomSheet } from "@/components/bottom-sheet";
import { useRouter } from "next/navigation";
import { parseContactDetails } from "@/ai/flows/ai-contact-parsing-flow";
import { useToast } from "@/hooks/use-toast";
import { resizeImage } from "@/lib/image-utils";
import { useUser, useFirestore, useContacts } from "@/firebase";
import { collection, serverTimestamp, addDoc, doc, increment, query } from "firebase/firestore";
import { addDocumentNonBlocking, updateDocumentNonBlocking } from "@/firebase/non-blocking-updates";
import { UserProfile, Contact } from "@/lib/types";
import { getTelegramWebApp, haptic } from "@/lib/telegram";
import { playSound } from "@/lib/sound";
import { useTypewriter } from "@/hooks/use-typewriter";
import { useT } from "@/lib/i18n";

export default function AddContact() {
  const router = useRouter();
  const { toast } = useToast();
  const t = useT();
  const TAG_PRESETS = t.add.tagPresets;
  const { user, isUserLoading } = useUser();
  const firestore = useFirestore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isPhotoLoading, setIsPhotoLoading] = useState(false);
  const [contactPhoto, setContactPhoto] = useState<string | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [showManual, setShowManual] = useState(false);
  const [showTags, setShowTags] = useState(false);
  const [customTagInput, setCustomTagInput] = useState("");
  const [manualFirstName, setManualFirstName] = useState("");
  const [manualLastName, setManualLastName] = useState("");
  const [manualPhone, setManualPhone] = useState("");
  const [manualCompany, setManualCompany] = useState("");
  const [manualEmail, setManualEmail] = useState("");
  const [manualBirthday, setManualBirthday] = useState("");

  // Existing contacts (shared, always warm) for duplicate detection
  const { contacts: existingContacts } = useContacts();

  // Telegram BackButton
  useEffect(() => {
    const tg = getTelegramWebApp();
    if (!tg) return;
    tg.BackButton.show();
    const goBack = () => router.back();
    tg.BackButton.onClick(goBack);
    return () => {
      tg.BackButton.offClick(goBack);
      tg.BackButton.hide();
    };
  }, [router]);

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsPhotoLoading(true);
    const reader = new FileReader();
    reader.onloadend = async () => {
      try {
        // 256px so the avatar can be stored inline as a data URL in Firestore
        const optimized = await resizeImage(reader.result as string, 256, 256);
        setContactPhoto(optimized);
      } catch { }
      setIsPhotoLoading(false);
    };
    reader.readAsDataURL(file);
  };

  const handleAiExtract = async () => {
    if (!user) return;
    const hasManual = manualFirstName.trim() || manualLastName.trim() || manualPhone.trim() || manualCompany.trim() || manualEmail.trim();
    if (!inputText.trim() && !hasManual) {
      toast({ title: t.add.enterInfo, description: t.add.enterInfoDesc, variant: "destructive" });
      return;
    }

    setIsLoading(true);
    haptic('medium');
    playSound('click');
    try {
      let result: any = { summary: "", facts: [], name: "", firstName: "", tags: [], phone: "", email: "", role: "" };
      if (inputText.trim()) {
        const idToken = await user.getIdToken();
        result = await parseContactDetails({ text: inputText }, idToken);
      }

      const overrideFirst = manualFirstName.trim();
      const overrideLast = manualLastName.trim();
      let finalFirst = result.firstName || result.name?.split(' ')[0] || t.add.noName;
      if (overrideFirst) finalFirst = overrideFirst;
      const combinedName = overrideLast
        ? `${finalFirst} ${overrideLast}`.trim()
        : (overrideFirst ? finalFirst : (result.name || t.add.noName));

      // Dossier ("who is this person") stored as plain text in the summary field
      const dossierText = result.summary || "";

      // Avatar is stored inline as a data URL in the contact doc (no Storage bucket).
      const finalAvatarUrl = contactPhoto || "";

      const finalPhone = manualPhone.trim() || result.phone || "";

      // Duplicate check by phone number
      if (finalPhone && existingContacts) {
        const duplicate = existingContacts.find(c => c.phone && c.phone === finalPhone);
        if (duplicate) {
          haptic('error');
          toast({
            title: t.add.duplicateTitle,
            description: t.add.duplicateDesc(duplicate.name, finalPhone),
            variant: "destructive"
          });
          setIsLoading(false);
          return;
        }
      }

      const contactData = {
        userId: user.uid,
        name: combinedName,
        firstName: finalFirst,
        tags: [...new Set([...selectedTags, ...(result.tags || [])])],
        summary: dossierText,
        lastInteraction: new Date().toISOString(),
        interactionScore: 50,
        createdAt: new Date().toISOString(),
        phone: finalPhone,
        email: manualEmail.trim() || result.email || "",
        birthday: manualBirthday || "",
        telegram: "", linkedin: "",
        role: manualCompany.trim() || result.role || "",
        isFavorite: false,
        avatarUrl: finalAvatarUrl,
      };

      const contactsRef = collection(firestore, "users", user.uid, "contacts");
      const contactDocRef = await addDoc(contactsRef, contactData);

      addDocumentNonBlocking(collection(firestore, "users", user.uid, "contacts", contactDocRef.id, "history"), {
        contactId: contactDocRef.id, date: new Date().toISOString(), type: "note",
        summary: t.add.historyPrefix(inputText), createdAt: serverTimestamp()
      });

      updateDocumentNonBlocking(doc(firestore, "users", user.uid), { totalContacts: increment(1) });

      haptic('success');
      playSound('success');
      toast({ title: t.add.saved, description: t.add.savedDesc(contactData.firstName) });
      router.push("/");
    } catch (e: any) {
      console.error('Contact creation error:', e);
      haptic('error');
      playSound('error');
      const msg = e.message || '';
      const isRateLimit = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED');
      const isAiError = msg.includes('AI failed') || msg.includes('generate');
      toast({
        title: t.common.error,
        description: isRateLimit
          ? t.add.rateLimitErr
          : isAiError
          ? t.add.aiError
          : t.add.genericError,
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  const toggleTag = (tag: string) => {
    haptic('selection');
    setSelectedTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
  };

  const { displayed: typedTitle, isDone: titleDone } = useTypewriter(t.add.title, 45);
  const titleSplitAt = t.add.titleFirstWord.length; // first word stays default color


  const manualFilled = [manualFirstName, manualLastName, manualPhone, manualCompany, manualEmail, manualBirthday].filter(v => v.trim()).length;

  if (isUserLoading || !user) return null;

  return (
    <div style={{ height: 'calc(var(--app-vh, 100vh) - 76px - env(safe-area-inset-bottom, 0px))', display: 'flex', flexDirection: 'column', overflow: 'hidden', backgroundColor: 'var(--neo-bg)', position: 'relative', isolation: 'isolate' }}>
      {/* Decorative corner accents */}
      <div aria-hidden style={{ position: 'absolute', top: 0, left: 0, width: '150px', height: '150px', backgroundColor: 'var(--neo-yellow)', clipPath: 'polygon(0 0, 100% 0, 0 100%)', borderRight: 'var(--neo-border-width) solid var(--neo-border)', zIndex: -1, pointerEvents: 'none' }} />
      <div aria-hidden style={{ position: 'absolute', bottom: 0, right: 0, width: '200px', height: '200px', backgroundColor: 'var(--neo-cyan)', clipPath: 'polygon(100% 0, 100% 100%, 0 100%)', zIndex: -1, pointerEvents: 'none' }} />

      {/* Header */}
      <div className="px-4 pt-6 pb-4 shrink-0">
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

      <div className="px-4 space-y-4 flex-1 overflow-y-auto" style={{ minHeight: 0, paddingBottom: '16px' }}>
        {/* AI text input */}
        <div className="neo-card p-4 space-y-3">
          <textarea
            ref={textareaRef}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={t.add.placeholder}
            className="neo-textarea"
            style={{ minHeight: '140px' }}
          />
          <div className="flex items-center gap-3">
            {contactPhoto ? (
              <div className="relative">
                <div className="w-12 h-12 overflow-hidden" style={{ border: 'var(--neo-border-width) solid var(--neo-border)' }}>
                  <img src={contactPhoto} alt="" className="w-full h-full object-cover" />
                </div>
                <button onClick={() => setContactPhoto(null)} className="absolute -top-2 -right-2 w-5 h-5 flex items-center justify-center" style={{ backgroundColor: 'var(--neo-red)', color: '#fff', border: '1.5px solid var(--neo-border)' }}>
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <button onClick={() => fileInputRef.current?.click()} className="w-12 h-12 flex items-center justify-center" style={{ border: 'var(--neo-border-width) solid var(--neo-border)', backgroundColor: 'var(--neo-surface)' }}>
                {isPhotoLoading ? <div className="w-5 h-5 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--neo-accent)', borderTopColor: 'transparent' }} /> : <ImageIcon className="w-5 h-5" style={{ color: 'var(--neo-hint)' }} />}
              </button>
            )}
            <input type="file" ref={fileInputRef} onChange={handlePhotoUpload} accept="image/*" className="hidden" />
          </div>
        </div>

        {/* Manual fields — opens as a bottom sheet */}
        <button
          onClick={() => { setShowManual(true); haptic('light'); }}
          className="neo-dashed flex items-center justify-center gap-2 w-full py-3 text-xs font-bold uppercase"
          style={{ color: 'var(--neo-text)' }}
        >
          <PenLine className="w-4 h-4" />
          {t.add.manualInput}{manualFilled > 0 ? ` (${manualFilled})` : ''}
        </button>

        {/* Tags — opens as a bottom sheet */}
        <button
          onClick={() => { setShowTags(true); haptic('light'); }}
          className="neo-dashed flex items-center justify-center gap-2 w-full py-3 text-xs font-bold uppercase"
          style={{ color: 'var(--neo-text)' }}
        >
          <span style={{ color: 'var(--neo-accent)' }}>#</span>
          {t.add.tags}{selectedTags.length > 0 ? ` (${selectedTags.length})` : ''}
        </button>

        {/* Submit */}
        <button onClick={handleAiExtract} disabled={isLoading} className="neo-button mt-2">
          {isLoading ? (
            <div className="w-5 h-5 border-2 rounded-full animate-spin" style={{ borderColor: 'currentColor', borderTopColor: 'transparent' }} />
          ) : (
            <>{t.add.submit} <ArrowRight className="w-5 h-5" /></>
          )}
        </button>
      </div>

      {/* Manual input bottom sheet */}
      <BottomSheet open={showManual} onClose={() => setShowManual(false)} title={t.add.manualInput}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <input type="text" placeholder={t.add.firstName} value={manualFirstName} onChange={e => setManualFirstName(e.target.value)} className="neo-input" />
            <input type="text" placeholder={t.add.lastName} value={manualLastName} onChange={e => setManualLastName(e.target.value)} className="neo-input" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input type="text" inputMode="tel" placeholder={t.add.phone} value={manualPhone} onChange={e => setManualPhone(e.target.value)} className="neo-input" />
            <input type="text" placeholder={t.add.company} value={manualCompany} onChange={e => setManualCompany(e.target.value)} className="neo-input" />
          </div>
          <input type="text" inputMode="email" placeholder={t.add.email} value={manualEmail} onChange={e => setManualEmail(e.target.value)} className="neo-input" />
          <div>
            <label className="text-[11px] font-bold uppercase block mb-1.5" style={{ color: 'var(--neo-hint)' }}>{t.add.birthday}</label>
            <input type="date" value={manualBirthday} onChange={e => setManualBirthday(e.target.value)} className="neo-input" />
          </div>
          <button onClick={() => { setShowManual(false); haptic('light'); }} className="neo-button-accent">{t.add.done}</button>
        </div>
      </BottomSheet>

      {/* Tags bottom sheet */}
      <BottomSheet open={showTags} onClose={() => setShowTags(false)} title={t.add.tags}>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {TAG_PRESETS.map(tag => {
              const active = selectedTags.includes(tag);
              return (
                <button key={tag} onClick={() => toggleTag(tag)} className={`neo-chip ${active ? 'neo-chip-active' : ''}`} style={{ padding: '6px 12px', fontSize: '12px' }}>#{tag}</button>
              );
            })}
            {selectedTags.filter(tg => !TAG_PRESETS.includes(tg)).map(tag => (
              <button key={tag} onClick={() => toggleTag(tag)} className="neo-chip neo-chip-active" style={{ padding: '6px 12px', fontSize: '12px' }}>#{tag} ✕</button>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder={t.add.customTag}
              value={customTagInput}
              onChange={e => setCustomTagInput(e.target.value.toUpperCase())}
              onKeyDown={e => {
                if (e.key === 'Enter' && customTagInput.trim()) {
                  e.preventDefault();
                  const tag = customTagInput.trim();
                  if (!selectedTags.includes(tag)) setSelectedTags(prev => [...prev, tag]);
                  setCustomTagInput("");
                  haptic('selection');
                }
              }}
              className="neo-input flex-1"
              style={{ height: '40px', fontSize: '13px' }}
            />
            <button
              onClick={() => {
                if (customTagInput.trim()) {
                  const tag = customTagInput.trim();
                  if (!selectedTags.includes(tag)) setSelectedTags(prev => [...prev, tag]);
                  setCustomTagInput("");
                  haptic('selection');
                }
              }}
              className="neo-button-secondary px-4"
              style={{ height: '40px', fontSize: '12px' }}
            >
              +
            </button>
          </div>
          <button onClick={() => { setShowTags(false); haptic('light'); }} className="neo-button-accent">{t.add.done}</button>
        </div>
      </BottomSheet>
    </div>
  );
}
