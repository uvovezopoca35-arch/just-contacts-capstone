"use client"

import { useState, useMemo, useEffect, useRef } from "react";
import { TrendingUp, Zap, Gem, Camera, Settings } from "lucide-react";
import { XAxis, YAxis, Tooltip, AreaChart, Area, BarChart, Bar } from "recharts";
import { ChartConfig, ChartContainer } from "@/components/ui/chart";
import { useToast } from "@/hooks/use-toast";
import { resizeImage } from "@/lib/image-utils";
import { useUser, useAuth, useFirestore, useMemoFirebase, useContacts } from "@/firebase";
import { doc, setDoc } from "firebase/firestore";
import { haptic } from "@/lib/telegram";
import { useTypewriter } from "@/hooks/use-typewriter";
import { useT, useLang } from "@/lib/i18n";
import { SettingsSheet } from "@/components/settings-sheet";

type TimeRange = 'W' | 'M' | 'Y';

export default function ProfilePage() {
  const { toast } = useToast();
  const auth = useAuth();
  const { user, isUserLoading } = useUser();
  const firestore = useFirestore();
  const t = useT();
  const { lang } = useLang();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isMounted, setIsMounted] = useState(false);
  const [timeRange, setTimeRange] = useState<TimeRange>('M');
  const [isSaving, setIsSaving] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const userRef = useMemoFirebase(() => {
    if (!firestore || !user) return null;
    return doc(firestore, "users", user.uid);
  }, [firestore, user]);

  const { contacts, profile } = useContacts();

  useEffect(() => { setIsMounted(true); }, []);

  const totalConnections = contacts?.length || 0;
  const activeConnectionsCount = useMemo(() => {
    if (!contacts) return 0;
    const oneMonthAgo = new Date(); oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    return contacts.filter(c => c.lastInteraction && new Date(c.lastInteraction) > oneMonthAgo).length;
  }, [contacts]);

  const { topSphere, topTags } = useMemo(() => {
    if (!contacts || contacts.length === 0) return { topSphere: "—", topTags: [] };
    const counts: Record<string, number> = {};
    contacts.forEach(c => { c.tags?.forEach(tag => { counts[tag] = (counts[tag] || 0) + 1; }); });
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    return { topSphere: sorted[0]?.[0] || "—", topTags: sorted.slice(1, 3).map(s => s[0]) };
  }, [contacts]);

  const chartData = useMemo(() => {
    if (!contacts) return [];
    const now = new Date();
    const data = [];

    if (timeRange === 'W') {
      // Last 10 weeks
      for (let i = 9; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i * 7);
        d.setHours(23, 59, 59, 999);
        const weekNum = Math.ceil((d.getDate() + new Date(d.getFullYear(), d.getMonth(), 1).getDay()) / 7);
        const label = `${lang === 'ru' ? 'н' : 'w'}${weekNum}`;
        const count = contacts.filter(c => c.createdAt && new Date(c.createdAt) <= d).length;
        data.push({ month: label, value: count });
      }
    } else if (timeRange === 'M') {
      // Last 12 months
      for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
        const comparisonDate = i === 0 ? now : d;
        const rawLabel = d.toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US', { month: 'short' });
        const label = rawLabel.charAt(0).toUpperCase() + rawLabel.slice(1);
        const count = contacts.filter(c => c.createdAt && new Date(c.createdAt) <= comparisonDate).length;
        data.push({ month: label, value: count });
      }
    } else {
      // Year — from earliest contact year to now
      const years = contacts
        .filter(c => c.createdAt)
        .map(c => new Date(c.createdAt).getFullYear());
      const minYear = years.length > 0 ? Math.min(...years) : now.getFullYear();
      for (let yr = minYear; yr <= now.getFullYear(); yr++) {
        const d = new Date(yr, 11, 31, 23, 59, 59);
        const comparisonDate = yr === now.getFullYear() ? now : d;
        const count = contacts.filter(c => c.createdAt && new Date(c.createdAt) <= comparisonDate).length;
        data.push({ month: String(yr), value: count });
      }
    }

    return data;
  }, [contacts, timeRange, lang]);

  const growthPercent = useMemo(() => {
    if (chartData.length < 2) return 0;
    const current = chartData[chartData.length - 1].value;
    const prev = chartData[chartData.length - 2].value;
    if (prev === 0) return current > 0 ? 100 : 0;
    return Math.round(((current - prev) / prev) * 100);
  }, [chartData]);

  const chartConfig = { value: { label: t.profile.connections, color: "var(--neo-accent)" } } satisfies ChartConfig;

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsSaving(true);
    const reader = new FileReader();
    reader.onloadend = async () => {
      try {
        // Store the avatar inline as a data URL in Firestore (Spark plan, no
        // Storage bucket / billing needed). 256px keeps the doc well under 1MB.
        const optimized = await resizeImage(reader.result as string, 256, 256);
        if (auth.currentUser && userRef) {
          await setDoc(userRef, { id: auth.currentUser.uid, avatarUrl: optimized, lastActive: new Date().toISOString() }, { merge: true });
          haptic('success');
          toast({ title: t.profile.photoUpdated });
        }
      } catch { toast({ title: t.common.error, variant: "destructive" }); }
      finally { setIsSaving(false); }
    };
    reader.readAsDataURL(file);
  };

  const displayName = (!isMounted || isUserLoading || !user)
    ? ""
    : (profile?.name || user.displayName || t.auth.userFallback);
  const avatarUrl = (!isMounted || isUserLoading || !user)
    ? null
    : (profile?.avatarUrl || user?.photoURL);
  const { displayed: typedName, isDone: nameDone } = useTypewriter(displayName, 45);

  if (!isMounted || isUserLoading || !user) return null;

  return (
    <div style={{ height: 'calc(var(--app-vh, 100vh) - 76px - env(safe-area-inset-bottom, 0px))', display: 'flex', flexDirection: 'column', overflow: 'hidden', backgroundColor: 'var(--neo-bg)', position: 'relative', isolation: 'isolate' }}>
      {/* Decorative corner accents */}
      <div aria-hidden style={{ position: 'absolute', top: 0, left: 0, width: '150px', height: '150px', backgroundColor: 'var(--neo-yellow)', clipPath: 'polygon(0 0, 100% 0, 0 100%)', borderRight: 'var(--neo-border-width) solid var(--neo-border)', zIndex: -1, pointerEvents: 'none' }} />
      <div aria-hidden style={{ position: 'absolute', bottom: 0, right: 0, width: '200px', height: '200px', backgroundColor: 'var(--neo-cyan)', clipPath: 'polygon(100% 0, 100% 100%, 0 100%)', zIndex: -1, pointerEvents: 'none' }} />

      {/* Header */}
      <div className="px-4 pt-6 pb-4 shrink-0">
        <div className="neo-card p-6 flex items-center gap-5">
          <div className="relative shrink-0">
            <div className="neo-avatar w-20 h-20" onClick={() => fileInputRef.current?.click()} style={{ cursor: 'pointer' }}>
              {avatarUrl ? <img src={avatarUrl} alt={displayName} /> :
                <span className="text-2xl font-black" style={{ color: 'var(--neo-hint)' }}>{displayName[0]}</span>}
            </div>
            <button onClick={() => fileInputRef.current?.click()} disabled={isSaving}
              className="absolute -bottom-1 -right-1 w-7 h-7 flex items-center justify-center"
              style={{ backgroundColor: 'var(--neo-accent)', color: '#fff', border: 'var(--neo-border-width) solid var(--neo-border)' }}>
              {isSaving ? <div className="w-3.5 h-3.5 border-2 rounded-full animate-spin" style={{ borderColor: '#fff', borderTopColor: 'transparent' }} /> :
                <Camera className="w-3.5 h-3.5" />}
            </button>
            <input type="file" ref={fileInputRef} onChange={handlePhotoUpload} accept="image/*" className="hidden" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-black uppercase" style={{ color: 'var(--neo-text)' }}>
              {typedName}
              {!nameDone && (
                <span
                  className="inline-block w-[2px] h-[20px] ml-1 animate-pulse"
                  style={{ backgroundColor: 'var(--neo-accent)', verticalAlign: 'bottom' }}
                />
              )}
            </h1>
          </div>
          <button
            onClick={() => { setShowSettings(true); haptic('light'); }}
            aria-label={t.settings.title}
            className="shrink-0 self-start w-10 h-10 flex items-center justify-center"
            style={{ border: 'var(--neo-border-width) solid var(--neo-border)', backgroundColor: 'var(--neo-surface)', color: 'var(--neo-text)' }}
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="px-4 space-y-4 flex-1 overflow-y-auto" style={{ minHeight: 0, paddingBottom: '16px' }}>
        {/* Stats cards */}
        <div className="grid grid-cols-3 gap-3">
          <div className="neo-card p-4 text-center">
            <TrendingUp className="w-5 h-5 mx-auto mb-2" style={{ color: 'var(--neo-green)' }} />
            <div className="text-2xl font-black" style={{ color: 'var(--neo-text)' }}>{totalConnections}</div>
            <div className="text-[10px] font-bold uppercase mt-1" style={{ color: 'var(--neo-hint)' }}>{t.profile.total}</div>
          </div>
          <div className="neo-card-pink p-4 text-center">
            <Zap className="w-5 h-5 mx-auto mb-2" />
            <div className="text-2xl font-black">{activeConnectionsCount}</div>
            <div className="text-[10px] font-bold uppercase mt-1 opacity-80">{t.profile.active}</div>
          </div>
          <div className="neo-card-blue p-4 text-center">
            <Gem className="w-5 h-5 mx-auto mb-2" />
            <div className="text-sm font-black truncate">{topSphere}</div>
            <div className="text-[10px] font-bold uppercase mt-1 opacity-80">{t.profile.topSphere}</div>
          </div>
        </div>

        {/* Chart */}
        <div className="neo-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="neo-section-header">{t.profile.networkGrowth}</span>
            <div className="flex overflow-hidden" style={{ border: 'var(--neo-border-width) solid var(--neo-border)' }}>
              {([
                { key: 'W', label: t.profile.week },
                { key: 'M', label: t.profile.month },
                { key: 'Y', label: t.profile.year },
              ] as { key: TimeRange; label: string }[]).map(({ key, label }, idx) => (
                <button key={key} onClick={() => { haptic('selection'); setTimeRange(key); }}
                  className="px-3 py-1.5 text-[11px] font-bold uppercase transition-all"
                  style={{
                    backgroundColor: timeRange === key ? 'var(--neo-text)' : 'var(--neo-surface)',
                    color: timeRange === key ? 'var(--neo-bg)' : 'var(--neo-hint)',
                    borderLeft: idx > 0 ? '1.5px solid var(--neo-border)' : 'none',
                  }}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="neo-badge text-[11px]">{growthPercent >= 0 ? `+${growthPercent}%` : `${growthPercent}%`}</span>
            <span className="text-xs font-medium" style={{ color: 'var(--neo-hint)' }}>{t.profile.lastPeriod}</span>
          </div>
          <div className="h-[130px] w-full">
            <ChartContainer config={chartConfig} className="h-full w-full">
              {chartData.length <= 2 ? (
                // Sparse data (e.g. a single year) looks empty as a line — use bars
                <BarChart data={chartData} margin={{ top: 10, right: 5, left: -25, bottom: 0 }}>
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: 'var(--neo-hint)' }} dy={8} />
                  <YAxis hide />
                  <Tooltip cursor={{ fill: 'var(--neo-chip-bg)' }} content={({ active, payload }) => active && payload && payload.length ? (
                    <div className="px-3 py-1.5 text-xs font-bold" style={{ backgroundColor: 'var(--neo-text)', color: 'var(--neo-bg)', border: '1.5px solid var(--neo-border)' }}>
                      {t.profile.contactsCount(payload[0].value as number)}
                    </div>
                  ) : null} />
                  <Bar dataKey="value" fill="var(--neo-accent)" stroke="var(--neo-border)" strokeWidth={2} maxBarSize={72} />
                </BarChart>
              ) : (
                <AreaChart data={chartData} margin={{ top: 10, right: 5, left: -25, bottom: 0 }}>
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: 'var(--neo-hint)' }} dy={8} />
                  <YAxis hide />
                  <Tooltip content={({ active, payload }) => active && payload && payload.length ? (
                    <div className="px-3 py-1.5 text-xs font-bold" style={{ backgroundColor: 'var(--neo-text)', color: 'var(--neo-bg)', border: '1.5px solid var(--neo-border)' }}>
                      {t.profile.contactsCount(payload[0].value as number)}
                    </div>
                  ) : null} />
                  <Area type="monotone" dataKey="value" stroke="var(--neo-accent)" strokeWidth={2.5} fill="var(--neo-accent)" fillOpacity={0.1}
                    dot={{ r: 3, fill: 'var(--neo-bg)', stroke: 'var(--neo-accent)', strokeWidth: 2.5 }}
                    activeDot={{ r: 5, fill: 'var(--neo-accent)', stroke: 'var(--neo-bg)', strokeWidth: 2.5 }} />
                </AreaChart>
              )}
            </ChartContainer>
          </div>
        </div>

        {/* Top tags */}
        {topTags.length > 0 && (
          <div className="neo-card p-4">
            <span className="neo-section-header block mb-3">{t.profile.topTags}</span>
            <div className="flex gap-2">
              {topTags.map(tag => <span key={tag} className="neo-chip">#{tag}</span>)}
            </div>
          </div>
        )}
      </div>

      <SettingsSheet open={showSettings} onClose={() => setShowSettings(false)} />
    </div>
  );
}
