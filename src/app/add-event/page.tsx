"use client"

import { useState, useEffect, useMemo, useRef } from "react";
import {
  Check,
  Coffee,
  Phone,
  UtensilsCrossed,
  Star,
  Heart,
  Zap,
  Music,
  Flag,
  Smile,
  Trophy,
  Rocket,
  Camera,
  Gamepad2,
  Wine,
  Pizza,
  Car,
  Plane,
  Book,
  Briefcase,
  Code,
  Dumbbell,
  Mic,
  Theater,
  Users,
  ShoppingBag,
  Gift,
  Sun,
  Moon,
  User as UserIcon,
  Search,
  ArrowRight,
  Settings,
  Wrench,
  Home,
  Leaf,
  Flame,
  Bike,
  Mountain,
  Globe,
  Lightbulb,
  Headphones,
  Monitor,
  Palette,
  Scissors,
  Waves,
  Gem,
  Crown,
  Flower2,
  Beer,
  Sword,
  Brain,
  Handshake,
  MapPin,
  Pencil,
  LucideIcon
} from "lucide-react";
import { useRouter } from "next/navigation";
import { Contact, UserProfile } from "@/lib/types";
import { processEventNotes } from "@/ai/flows/process-event-flow";
import { useToast } from "@/hooks/use-toast";
import { useUser, useFirestore, useContacts } from "@/firebase";
import { collection, serverTimestamp, doc, deleteField } from "firebase/firestore";
import { addDocumentNonBlocking, updateDocumentNonBlocking } from "@/firebase/non-blocking-updates";
import { updateDossier } from "@/ai/flows/update-dossier-flow";
import { getTelegramWebApp, haptic } from "@/lib/telegram";
import { playSound } from "@/lib/sound";
import { useTypewriter } from "@/hooks/use-typewriter";
import { useT } from "@/lib/i18n";
import { BottomSheet } from "@/components/bottom-sheet";

type CustomEventType = { id: string; label: string; iconName: string; };

// Flatten a contact's dossier to plain text (handles the legacy JSON summary format).
function dossierText(summary?: string): string {
  if (!summary) return '';
  try {
    const p = JSON.parse(summary);
    const facts = Array.isArray(p.facts) ? p.facts.map((f: any) => `${f.label}: ${f.value}`).join('. ') : '';
    return [p.recentSummary, facts].filter(Boolean).join('. ');
  } catch {
    return summary;
  }
}

const ICON_MAP: Record<string, LucideIcon> = {
  Coffee, Phone, UtensilsCrossed, Star, Heart, Zap, Music, Flag, Smile, Trophy, Rocket, Camera,
  Gamepad2, Wine, Pizza, Car, Plane, Book, Briefcase, Code, Dumbbell, Mic, Theater, Users,
  ShoppingBag, Gift, Sun, Moon, Settings, Wrench, Home, Leaf, Flame, Bike, Mountain, Globe,
  Lightbulb, Headphones, Monitor, Palette, Scissors, Waves, Gem, Crown, Flower2, Beer,
  Brain, Handshake, MapPin, Pencil,
};

const DEFAULT_EVENT_TYPE_META = [
  { id: "meeting", iconName: "Coffee" },
  { id: "call", iconName: "Phone" },
  { id: "dinner", iconName: "UtensilsCrossed" },
];

// All available icons for the picker (in display order)
const ICON_PICKER_LIST: { name: string; icon: LucideIcon }[] = [
  { name: 'Coffee', icon: Coffee },
  { name: 'Phone', icon: Phone },
  { name: 'UtensilsCrossed', icon: UtensilsCrossed },
  { name: 'Handshake', icon: Handshake },
  { name: 'Dumbbell', icon: Dumbbell },
  { name: 'Bike', icon: Bike },
  { name: 'Mountain', icon: Mountain },
  { name: 'Waves', icon: Waves },
  { name: 'Music', icon: Music },
  { name: 'Mic', icon: Mic },
  { name: 'Headphones', icon: Headphones },
  { name: 'Theater', icon: Theater },
  { name: 'Camera', icon: Camera },
  { name: 'Gamepad2', icon: Gamepad2 },
  { name: 'Brain', icon: Brain },
  { name: 'Lightbulb', icon: Lightbulb },
  { name: 'Code', icon: Code },
  { name: 'Monitor', icon: Monitor },
  { name: 'Palette', icon: Palette },
  { name: 'Pencil', icon: Pencil },
  { name: 'Briefcase', icon: Briefcase },
  { name: 'Settings', icon: Settings },
  { name: 'Wrench', icon: Wrench },
  { name: 'Scissors', icon: Scissors },
  { name: 'ShoppingBag', icon: ShoppingBag },
  { name: 'Home', icon: Home },
  { name: 'MapPin', icon: MapPin },
  { name: 'Globe', icon: Globe },
  { name: 'Car', icon: Car },
  { name: 'Plane', icon: Plane },
  { name: 'Book', icon: Book },
  { name: 'Pizza', icon: Pizza },
  { name: 'Wine', icon: Wine },
  { name: 'Beer', icon: Beer },
  { name: 'Gift', icon: Gift },
  { name: 'Trophy', icon: Trophy },
  { name: 'Crown', icon: Crown },
  { name: 'Gem', icon: Gem },
  { name: 'Star', icon: Star },
  { name: 'Heart', icon: Heart },
  { name: 'Smile', icon: Smile },
  { name: 'Rocket', icon: Rocket },
  { name: 'Zap', icon: Zap },
  { name: 'Flame', icon: Flame },
  { name: 'Sun', icon: Sun },
  { name: 'Moon', icon: Moon },
  { name: 'Leaf', icon: Leaf },
  { name: 'Flower2', icon: Flower2 },
  { name: 'Flag', icon: Flag },
  { name: 'Users', icon: Users },
];

export default function AddEventPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { user } = useUser();
  const firestore = useFirestore();
  const t = useT();
  const DEFAULT_EVENT_TYPES = useMemo(
    () => DEFAULT_EVENT_TYPE_META.map(m => ({ ...m, label: t.event.defaultTypes[m.id] })),
    [t]
  );

  const [selectedContacts, setSelectedContacts] = useState<Contact[]>([]);
  const [eventType, setEventType] = useState("meeting");
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [customEventTypes, setCustomEventTypes] = useState<CustomEventType[]>([]);
  const [eventTypeUsage, setEventTypeUsage] = useState<Record<string, number>>({});
  const [contactSearchQuery, setContactSearchQuery] = useState("");
  const [showContactPicker, setShowContactPicker] = useState(false);
  const [showEventTypeDropdown, setShowEventTypeDropdown] = useState(false);
  const [customTypeInput, setCustomTypeInput] = useState("");
  const [newTypeIconName, setNewTypeIconName] = useState("Star");
  const [showIconPicker, setShowIconPicker] = useState(false);

  const { displayed: typedTitle, isDone: titleDone } = useTypewriter(t.event.title, 45);
  const titleSplitAt = t.event.titleFirstWord.length;

  // Telegram BackButton
  useEffect(() => {
    const tg = getTelegramWebApp();
    if (!tg) return;
    tg.BackButton.show();
    const goBack = () => router.back();
    tg.BackButton.onClick(goBack);
    return () => { tg.BackButton.offClick(goBack); tg.BackButton.hide(); };
  }, [router]);

  const { contacts: allContacts, contactsLoading } = useContacts();

  // Pre-select a contact passed via ?contact=<id> (e.g. from the contact card).
  // Wait until contacts have actually loaded so we don't mark it done on the
  // initial empty array.
  const prefilledRef = useRef(false);
  useEffect(() => {
    if (prefilledRef.current || contactsLoading) return;
    const id = new URLSearchParams(window.location.search).get('contact');
    prefilledRef.current = true;
    if (!id) return;
    const c = allContacts.find(x => x.id === id);
    if (c) setSelectedContacts(prev => prev.some(p => p.id === c.id) ? prev : [...prev, c]);
  }, [allContacts, contactsLoading]);

  const filteredContacts = useMemo(() => {
    if (!allContacts) return [];
    const q = contactSearchQuery.toLowerCase().replace(/ё/g, 'е').trim();
    if (!q) return allContacts;
    return allContacts.filter(c =>
      c.name.toLowerCase().replace(/ё/g, 'е').includes(q) ||
      (c.role && c.role.toLowerCase().replace(/ё/g, 'е').includes(q))
    );
  }, [allContacts, contactSearchQuery]);

  useEffect(() => {
    const saved = localStorage.getItem('custom_event_types');
    if (saved) { try { setCustomEventTypes(JSON.parse(saved)); } catch {} }
    const usage = localStorage.getItem('event_type_usage');
    if (usage) { try { setEventTypeUsage(JSON.parse(usage)); } catch {} }
  }, []);

  const allEventTypes = useMemo(() => {
    const all = [...DEFAULT_EVENT_TYPES, ...customEventTypes];
    return all.sort((a, b) => (eventTypeUsage[b.id] || 0) - (eventTypeUsage[a.id] || 0));
  }, [DEFAULT_EVENT_TYPES, customEventTypes, eventTypeUsage]);

  const currentType = allEventTypes.find(t => t.id === eventType);
  const CurrentIcon = currentType ? (ICON_MAP[currentType.iconName] || Coffee) : Coffee;

  const toggleContact = (contact: Contact) => {
    haptic('selection');
    setSelectedContacts(prev => prev.some(c => c.id === contact.id)
      ? prev.filter(c => c.id !== contact.id)
      : [...prev, contact]);
  };

  const addCustomEventType = () => {
    const label = customTypeInput.trim();
    if (!label) return;
    const id = `custom-${label.toLowerCase().replace(/\s+/g, '-')}`;
    if (allEventTypes.find(t => t.id === id)) {
      setEventType(id);
    } else {
      const newType = { id, label, iconName: newTypeIconName };
      const updated = [...customEventTypes, newType];
      setCustomEventTypes(updated);
      localStorage.setItem('custom_event_types', JSON.stringify(updated));
      setEventType(id);
    }
    setCustomTypeInput("");
    setNewTypeIconName("Star");
    setShowIconPicker(false);
    setShowEventTypeDropdown(false);
    haptic('selection');
  };

  const trackUsage = (typeId: string) => {
    const updated = { ...eventTypeUsage, [typeId]: (eventTypeUsage[typeId] || 0) + 1 };
    setEventTypeUsage(updated);
    localStorage.setItem('event_type_usage', JSON.stringify(updated));
  };

  const handleSubmit = async () => {
    if (!user) return;
    if (selectedContacts.length === 0 || !notes.trim()) {
      toast({ title: t.common.error, description: t.event.errorContactNote, variant: "destructive" });
      haptic('error');
      return;
    }

    setIsSubmitting(true);
    haptic('medium');
    try {
      trackUsage(eventType);

      const idToken = await user.getIdToken();
      let result;
      try {
        result = await processEventNotes({ type: currentType?.label || eventType, rawNotes: notes, date: new Date().toISOString() }, idToken);
      } catch {
        result = { structuredSummary: notes };
      }

      selectedContacts.forEach(contact => {
        const historyRef = collection(firestore, "users", user.uid, "contacts", contact.id, "history");
        addDocumentNonBlocking(historyRef, {
          contactId: contact.id, date: new Date().toISOString(),
          type: (eventType.startsWith('custom-') ? 'note' : eventType),
          summary: result.structuredSummary, createdAt: serverTimestamp()
        });
      });

      // Incrementally refresh each participant's dossier in the background:
      // compares only (current dossier + this new event), never the full history.
      selectedContacts.forEach(async (contact) => {
        try {
          const current = dossierText(contact.summary);
          const { dossier } = await updateDossier({
            currentDossier: current,
            contactName: contact.name || '',
            role: contact.role || '',
            newInfo: result.structuredSummary,
          }, idToken);
          if (dossier && dossier.trim() && dossier.trim() !== current.trim()) {
            updateDocumentNonBlocking(doc(firestore, "users", user.uid, "contacts", contact.id), { summary: dossier, vecs: deleteField(), embeddingVersion: deleteField(), embedding: deleteField() });
          }
        } catch { /* dossier update is best-effort */ }
      });

      haptic('success');
      playSound('success');
      toast({ title: t.event.eventAdded, description: t.event.eventAddedDesc });
      router.push("/");
    } catch {
      haptic('error');
      playSound('error');
      toast({ title: t.common.error, description: t.event.processError, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const PickedIcon = ICON_MAP[newTypeIconName] || Star;

  return (
    <div style={{ height: 'calc(var(--app-vh, 100vh) - 76px - env(safe-area-inset-bottom, 0px))', display: 'flex', flexDirection: 'column', overflow: 'hidden', backgroundColor: 'var(--neo-bg)', position: 'relative', isolation: 'isolate' }}>
      {/* Decorative corner accents */}
      <div aria-hidden style={{ position: 'absolute', top: 0, left: 0, width: '150px', height: '150px', backgroundColor: 'var(--neo-yellow)', clipPath: 'polygon(0 0, 100% 0, 0 100%)', borderRight: 'var(--neo-border-width) solid var(--neo-border)', zIndex: -1, pointerEvents: 'none' }} />
      <div aria-hidden style={{ position: 'absolute', bottom: 0, right: 0, width: '200px', height: '200px', backgroundColor: 'var(--neo-cyan)', clipPath: 'polygon(100% 0, 100% 100%, 0 100%)', zIndex: -1, pointerEvents: 'none' }} />

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
        {/* Participants — opens as a bottom sheet (like event type) */}
        <button
          onClick={() => { setShowContactPicker(true); haptic('light'); }}
          className="neo-card p-4 flex items-center justify-between w-full gap-3"
        >
          <div className="flex items-center gap-3 min-w-0">
            <Users className="w-5 h-5 shrink-0" style={{ color: 'var(--neo-accent)' }} />
            <span className="text-sm font-bold truncate" style={{ color: selectedContacts.length ? 'var(--neo-text)' : 'var(--neo-hint)' }}>
              {selectedContacts.length
                ? selectedContacts.map(c => c.firstName || c.name.split(' ')[0]).join(', ')
                : t.event.choosePeople}
            </span>
          </div>
          <span className="text-[10px] font-bold uppercase shrink-0" style={{ color: 'var(--neo-hint)' }}>{t.event.participants}</span>
        </button>

        {/* Event type — opens as a bottom sheet */}
        <button
          onClick={() => { setShowEventTypeDropdown(true); haptic('light'); }}
          className="neo-card p-4 flex items-center justify-between w-full"
        >
          <div className="flex items-center gap-3">
            <CurrentIcon className="w-5 h-5" style={{ color: 'var(--neo-accent)' }} />
            <span className="text-sm font-bold" style={{ color: 'var(--neo-text)' }}>
              {currentType?.label || t.event.defaultTypes.meeting}
            </span>
          </div>
          <span className="text-[10px] font-bold uppercase" style={{ color: 'var(--neo-hint)' }}>{t.event.eventType}</span>
        </button>

        {/* Notes */}
        <div className="neo-card p-4 space-y-3">
          <span className="neo-section-header">{t.event.notes}</span>
          <textarea
            placeholder=""
            value={notes}
            onChange={e => setNotes(e.target.value)}
            className="neo-textarea"
            style={{ backgroundColor: 'var(--neo-yellow)', color: '#000', borderColor: 'var(--neo-border)' }}
          />
        </div>

        <button onClick={handleSubmit} disabled={isSubmitting} className="neo-button mt-2">
          {isSubmitting
            ? <div className="w-5 h-5 border-2 rounded-full animate-spin" style={{ borderColor: 'currentColor', borderTopColor: 'transparent' }} />
            : <>{t.event.submit} <ArrowRight className="w-5 h-5" /></>
          }
        </button>
      </div>

      {/* Participants picker bottom sheet */}
      <BottomSheet open={showContactPicker} onClose={() => { setShowContactPicker(false); setContactSearchQuery(""); }} title={t.event.participants}>
        <div className="relative mb-3">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--neo-hint)' }} />
          <input type="text" placeholder={t.event.searchContact} value={contactSearchQuery} onChange={e => setContactSearchQuery(e.target.value)} className="neo-input pl-10" />
        </div>
        <div className="overflow-y-auto" style={{ maxHeight: '50vh', border: 'var(--neo-border-width) solid var(--neo-border)' }}>
          {filteredContacts.map((c, idx) => (
            <button key={c.id} onClick={() => toggleContact(c)} className="neo-cell w-full text-left"
              style={{
                ...(idx > 0 ? { borderTop: `var(--neo-border-width) solid var(--neo-separator)` } : {}),
                backgroundColor: selectedContacts.some(s => s.id === c.id) ? 'var(--neo-chip-bg)' : 'transparent',
              }}>
              <div className="neo-avatar w-8 h-8">
                {c.avatarUrl ? <img src={c.avatarUrl} alt="" /> : <span className="text-xs font-bold" style={{ color: 'var(--neo-hint)' }}>{c.name[0]}</span>}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold truncate" style={{ color: 'var(--neo-text)' }}>{c.name}</div>
                {c.role && <div className="text-xs truncate" style={{ color: 'var(--neo-hint)' }}>{c.role}</div>}
              </div>
              {selectedContacts.some(s => s.id === c.id) && (
                <Check className="w-5 h-5 shrink-0" style={{ color: 'var(--neo-accent)' }} />
              )}
            </button>
          ))}
          {filteredContacts.length === 0 && (
            <p className="text-center text-xs font-medium py-8" style={{ color: 'var(--neo-hint)' }}>{contactSearchQuery ? t.event.notFound : t.event.noContacts}</p>
          )}
        </div>
      </BottomSheet>

      {/* Event type bottom sheet */}
      <BottomSheet open={showEventTypeDropdown} onClose={() => { setShowEventTypeDropdown(false); setShowIconPicker(false); }} title={t.event.eventType}>
        <div className="space-y-3">
          <div style={{ border: 'var(--neo-border-width) solid var(--neo-border)' }}>
            {allEventTypes.map((type, idx) => {
              const Icon = ICON_MAP[type.iconName] || Coffee;
              const active = eventType === type.id;
              const usage = eventTypeUsage[type.id] || 0;
              return (
                <button key={type.id}
                  onClick={() => { setEventType(type.id); setShowEventTypeDropdown(false); haptic('selection'); }}
                  className="flex items-center gap-3 w-full px-4 py-3 text-left"
                  style={{ backgroundColor: active ? 'var(--neo-accent)' : 'transparent', color: active ? '#fff' : 'var(--neo-text)', borderTop: idx > 0 ? `1px solid var(--neo-separator)` : 'none' }}>
                  <Icon className="w-4 h-4" />
                  <span className="text-sm font-bold flex-1">{type.label}</span>
                  {usage > 0 && <span className="text-[10px] font-medium" style={{ opacity: 0.5 }}>{usage}×</span>}
                </button>
              );
            })}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => { setShowIconPicker(!showIconPicker); haptic('light'); }}
              className="w-10 h-10 flex items-center justify-center shrink-0"
              style={{ border: 'var(--neo-border-width) solid var(--neo-border)', backgroundColor: showIconPicker ? 'var(--neo-accent)' : 'var(--neo-chip-bg)', color: showIconPicker ? '#fff' : 'var(--neo-text)' }}
              title={t.event.chooseIcon}
            >
              <PickedIcon className="w-4 h-4" />
            </button>
            <input
              type="text"
              placeholder={t.event.customType}
              value={customTypeInput}
              onChange={e => setCustomTypeInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomEventType(); } }}
              className="neo-input flex-1"
              style={{ height: '40px', fontSize: '13px' }}
            />
            <button onClick={addCustomEventType} className="neo-button-secondary px-4" style={{ height: '40px', fontSize: '12px' }}>+</button>
          </div>
          {showIconPicker && (
            <div className="grid gap-1 p-2 overflow-y-auto" style={{ gridTemplateColumns: 'repeat(8, 1fr)', maxHeight: '180px', border: 'var(--neo-border-width) solid var(--neo-border)', backgroundColor: 'var(--neo-bg)' }}>
              {ICON_PICKER_LIST.map(({ name, icon: Icon }) => {
                const isSelected = newTypeIconName === name;
                return (
                  <button key={name} onClick={() => { setNewTypeIconName(name); haptic('selection'); }} title={name}
                    className="w-8 h-8 flex items-center justify-center transition-all"
                    style={{ backgroundColor: isSelected ? 'var(--neo-accent)' : 'transparent', color: isSelected ? '#fff' : 'var(--neo-text)', border: isSelected ? 'none' : '1px solid transparent' }}>
                    <Icon className="w-4 h-4" />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </BottomSheet>
    </div>
  );
}
