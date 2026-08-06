import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Link, Route, Switch, Router as WouterRouter, useLocation } from 'wouter';
import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import {
  Activity, AlertTriangle, ArrowUpRight, Check, ChevronRight, CircleDot, ClipboardList,
  Database, FileCog, Filter, Gauge, LayoutDashboard, Menu, Pause, Pencil, Plus, Radio,
  RefreshCw, Search, Settings2, ShieldCheck, SlidersHorizontal, Terminal, X, Zap
} from 'lucide-react';
import {
  getGetCallQueryKey, getGetDashboardActivityQueryKey, getGetDashboardSummaryQueryKey,
  getGetSettingsQueryKey, getGetCredentialsStatusQueryKey, getHealthCheckQueryKey, getListCallsQueryKey, getListChannelsQueryKey,
  getListLogsQueryKey, useCreateChannel, useGetCall, useGetDashboardActivity, useGetDashboardSummary,
  useGetSettings, useGetCredentialsStatus, useHealthCheck, useListCalls, useListChannels, useListLogs, useReviewCall,
  useUpdateChannel, useUpdateCredentials, useUpdateSettings
} from '@workspace/api-client-react';
import type { ActivityEvent, Channel, ChannelKind, CredentialsUpdate, LogEntry, RuntimeSettings, TokenCall, TokenCallRisk } from '@workspace/api-client-react';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();

const navItems = [
  { href: '/', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/calls', label: 'Call queue', icon: Radio },
  { href: '/channels', label: 'Channels', icon: SlidersHorizontal },
  { href: '/logs', label: 'Operational logs', icon: Terminal },
  { href: '/settings', label: 'Runtime settings', icon: FileCog },
];

function cn(...classes: Array<string | false | undefined>) { return classes.filter(Boolean).join(' '); }
function ago(date?: string | null) {
  if (!date) return '—';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
function num(value?: number | null, prefix = '') {
  if (value === null || value === undefined) return '—';
  if (value >= 1_000_000_000) return `${prefix}${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${prefix}${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${prefix}${(value / 1_000).toFixed(1)}K`;
  return `${prefix}${value.toLocaleString()}`;
}

function StatusPill({ value }: { value: string }) {
  const styles: Record<string, string> = {
    monitoring: 'bg-primary/10 text-primary', connected: 'bg-primary/10 text-primary',
    published: 'bg-primary/10 text-primary', approve: 'bg-primary/10 text-primary',
    pending: 'bg-accent/15 text-amber-700', duplicate: 'bg-violet-500/10 text-violet-700',
    rejected: 'bg-destructive/10 text-destructive', error: 'bg-destructive/10 text-destructive',
    paused: 'bg-muted text-muted-foreground', warn: 'bg-accent/15 text-amber-700',
    info: 'bg-sky-500/10 text-sky-700',
  };
  return <span data-testid={`status-${value}`} className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.13em]', styles[value] || 'bg-muted text-muted-foreground')}><span className="h-1.5 w-1.5 rounded-full bg-current" />{value.replace('_', ' ')}</span>;
}

function MetricCard({ label, value, note, icon: Icon, accent = 'teal', loading }: { label: string; value: string | number; note: string; icon: typeof Activity; accent?: string; loading?: boolean }) {
  return <div className="surface-line animate-rise-in data-sheen rounded-xl bg-card p-4" data-testid={`metric-${label.toLowerCase().replaceAll(' ', '-')}`}>
    <div className="flex items-start justify-between"><span className="text-[11px] font-bold uppercase tracking-[.13em] text-muted-foreground">{label}</span><span className={cn('rounded-lg p-2', accent === 'amber' ? 'bg-accent/15 text-amber-700' : accent === 'red' ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary')}><Icon size={16} /></span></div>
    {loading ? <div className="mt-4 h-8 w-20 animate-pulse rounded bg-muted" /> : <div className="mt-4 font-mono-ui text-[27px] font-medium tracking-tight text-card-foreground">{value}</div>}
    <div className="mt-1 text-xs text-muted-foreground">{note}</div>
  </div>;
}

function SkeletonRows({ count = 4 }: { count?: number }) {
  return <div className="space-y-2">{Array.from({ length: count }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-muted/70" />)}</div>;
}

function Failure({ label, onRetry }: { label: string; onRetry?: () => void }) {
  return <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-5 text-sm text-destructive" data-testid="state-error"><div className="flex items-center gap-2 font-semibold"><AlertTriangle size={16} /> {label} is unavailable</div>{onRetry && <button data-testid="button-retry" onClick={onRetry} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-destructive/20 px-3 py-1.5 text-xs font-bold hover:bg-destructive/10"><RefreshCw size={13} /> Retry</button>}</div>;
}

function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  return <div className="min-h-[100dvh] bg-background text-foreground">
    <aside className={cn('fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col border-r border-sidebar-border bg-sidebar px-4 py-5 text-sidebar-foreground transition-transform md:translate-x-0', mobileOpen ? 'translate-x-0' : '-translate-x-full')}>
      <div className="flex items-center gap-3 px-2">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground"><span className="font-mono-ui text-sm font-bold">A/</span></div>
        <div><div className="text-sm font-extrabold tracking-tight">ARCC</div><div className="font-mono-ui text-[9px] uppercase tracking-[.18em] text-sidebar-foreground/55">Signal Hub</div></div>
        <button aria-label="Close navigation" data-testid="button-close-nav" onClick={() => setMobileOpen(false)} className="ml-auto rounded-md p-1 text-sidebar-foreground/50 hover:bg-sidebar-accent md:hidden"><X size={16} /></button>
      </div>
      <div className="mt-10 px-2"><div className="mb-3 font-mono-ui text-[9px] uppercase tracking-[.2em] text-sidebar-foreground/40">Workspace</div>
        <nav className="space-y-1">{navItems.map(item => <Link key={item.href} href={item.href} data-testid={`link-${item.label.toLowerCase().replaceAll(' ', '-')}`} onClick={() => setMobileOpen(false)} className={cn('group flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-semibold transition-colors', (item.exact ? location === '/' : location.startsWith(item.href)) ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground/65 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground')}><item.icon size={16} strokeWidth={1.8} /><span>{item.label}</span>{item.href === '/calls' && <span className="ml-auto rounded-full bg-accent px-1.5 py-0.5 font-mono-ui text-[9px] font-bold text-accent-foreground">LIVE</span>}</Link>)}</nav>
      </div>
      <div className="mt-auto space-y-4 px-2">
        <div className="rounded-xl border border-sidebar-border bg-sidebar-accent/45 p-3"><div className="flex items-center gap-2 text-[11px] font-bold"><span className="h-2 w-2 animate-pulse rounded-full bg-sidebar-primary" />Monitor online</div><div className="mt-1 font-mono-ui text-[10px] text-sidebar-foreground/45">polling every 30 seconds</div></div>
        <div className="flex items-center gap-2 border-t border-sidebar-border pt-4"><div className="grid h-7 w-7 place-items-center rounded-full bg-sidebar-primary/15 font-mono-ui text-[10px] font-bold text-sidebar-primary">OP</div><div><div className="text-xs font-bold">Operator</div><div className="font-mono-ui text-[9px] text-sidebar-foreground/45">research desk</div></div><button data-testid="button-sidebar-settings" className="ml-auto text-sidebar-foreground/40 hover:text-sidebar-foreground"><Settings2 size={15} /></button></div>
      </div>
    </aside>
    {mobileOpen && <button aria-label="Close menu overlay" data-testid="button-menu-overlay" onClick={() => setMobileOpen(false)} className="fixed inset-0 z-30 bg-sidebar/30 md:hidden" />}
    <main className="md:pl-[248px]"><header className="sticky top-0 z-20 flex h-[68px] items-center justify-between border-b border-border bg-background/90 px-5 backdrop-blur md:px-9"><div className="flex items-center gap-3"><button aria-label="Open navigation" data-testid="button-open-nav" onClick={() => setMobileOpen(true)} className="rounded-lg p-2 hover:bg-muted md:hidden"><Menu size={19} /></button><div className="hidden font-mono-ui text-[10px] uppercase tracking-[.18em] text-muted-foreground sm:block">ARCC / <span className="text-foreground">{location === '/' ? 'overview' : location.slice(1)}</span></div></div><div className="flex items-center gap-3"><span className="hidden items-center gap-2 font-mono-ui text-[10px] text-muted-foreground sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-primary" /> UTC {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}</span><div className="h-5 w-px bg-border" /><div className="grid h-8 w-8 place-items-center rounded-full bg-secondary font-mono-ui text-[10px] font-bold">OP</div></div></header><div className="mx-auto max-w-[1440px] px-5 py-7 md:px-9">{children}</div></main>
  </div>;
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="mb-7 flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between"><div><div className="mb-2 font-mono-ui text-[10px] font-medium uppercase tracking-[.2em] text-primary">{eyebrow}</div><h1 className="text-[30px] font-extrabold tracking-[-.04em] text-foreground md:text-[36px]">{title}</h1><p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{description}</p></div>{action}</div>;
}

function ActivityList({ events, loading, error, onRetry }: { events?: ActivityEvent[]; loading?: boolean; error?: boolean; onRetry?: () => void }) {
  return <div>{loading ? <SkeletonRows /> : error ? <Failure label="Activity feed" onRetry={onRetry} /> : !events?.length ? <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground" data-testid="empty-activity">No processing events yet.</div> : <div className="space-y-1">{events.map(event => <div key={event.id} data-testid={`activity-event-${event.id}`} className="group flex gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-muted/60"><div className={cn('mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg', event.kind === 'error' ? 'bg-destructive/10 text-destructive' : event.kind === 'milestone' ? 'bg-accent/15 text-amber-700' : 'bg-primary/10 text-primary')}><Activity size={14} /></div><div className="min-w-0 flex-1"><div className="text-[13px] font-semibold leading-snug">{event.message}</div><div className="mt-1 font-mono-ui text-[10px] text-muted-foreground">{event.kind.toUpperCase()} · {ago(event.createdAt)}</div></div><ChevronRight size={14} className="mt-1 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5" /></div>)}</div>}</div>;
}

function Overview() {
  const summary = useGetDashboardSummary({ query: { queryKey: getGetDashboardSummaryQueryKey(), refetchInterval: 30000 } });
  const activity = useGetDashboardActivity({ limit: 8 }, { query: { queryKey: getGetDashboardActivityQueryKey({ limit: 8 }), refetchInterval: 30000 } });
  const health = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey(), refetchInterval: 30000 } });
  const s = summary.data;
  const points = s?.confidenceHistory || [];
  const chartMax = Math.max(...points.map(p => p.value), 1);
  return <><PageHeading eyebrow="Control room / live" title="Signal overview" description="One view of what the monitor is seeing, enriching, holding, and publishing right now." action={<button data-testid="button-refresh-overview" onClick={() => { summary.refetch(); activity.refetch(); health.refetch(); }} className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-bold shadow-sm hover:bg-muted"><RefreshCw size={14} /> Refresh</button>} />
    <div className="mb-7 grid grid-cols-2 gap-3 lg:grid-cols-4"><MetricCard label="Monitored" value={s?.monitoredChannels ?? 0} note={`${s?.activeChannels ?? 0} active channels`} icon={Radio} loading={summary.isLoading} /><MetricCard label="Detected calls" value={s?.detectedCalls ?? 0} note="all-time observed" icon={Zap} loading={summary.isLoading} accent="amber" /><MetricCard label="Pending review" value={s?.pendingReview ?? 0} note="needs an operator" icon={ClipboardList} loading={summary.isLoading} /><MetricCard label="Win rate" value={s ? `${s.winRate.toFixed(1)}%` : '—'} note={`${s?.publishedCalls ?? 0} published calls`} icon={Gauge} loading={summary.isLoading} /></div>
    <div className="grid gap-5 xl:grid-cols-[1.35fr_.9fr]">
      <section className="surface-line rounded-xl bg-card p-5" data-testid="panel-confidence"><div className="mb-5 flex items-start justify-between"><div><h2 className="text-sm font-extrabold">Confidence flow</h2><p className="mt-1 text-xs text-muted-foreground">Enrichment quality across recent detections</p></div><div className="flex items-center gap-1.5 font-mono-ui text-[10px] text-primary"><span className="h-1.5 w-1.5 rounded-full bg-primary" /> LIVE</div></div>{summary.isLoading ? <div className="h-[210px] animate-pulse rounded-lg bg-muted" /> : summary.isError ? <Failure label="Dashboard summary" onRetry={() => summary.refetch()} /> : !points.length ? <div className="grid h-[210px] place-items-center text-sm text-muted-foreground" data-testid="empty-confidence">Confidence history will appear after detections.</div> : <div className="relative h-[210px] pt-2"><div className="absolute inset-0 flex flex-col justify-between">{[100, 75, 50, 25, 0].map(v => <div key={v} className="flex items-center gap-3"><span className="w-7 text-right font-mono-ui text-[9px] text-muted-foreground">{v}</span><div className="h-px flex-1 bg-border/60" /></div>)}</div><div className="absolute inset-x-10 bottom-6 top-2 flex items-end gap-2 sm:gap-4">{points.map((p, i) => <div className="group flex h-full flex-1 items-end" key={`${p.label}-${i}`}><div data-testid={`bar-confidence-${i}`} className="relative w-full rounded-t-sm bg-primary/75 transition-all duration-500 hover:bg-primary" style={{ height: `${Math.max(4, (p.value / chartMax) * 100)}%` }}><div className="absolute -top-6 left-1/2 hidden -translate-x-1/2 rounded bg-sidebar px-1.5 py-1 font-mono-ui text-[9px] text-sidebar-foreground group-hover:block">{p.value.toFixed(0)}</div></div></div>)}</div><div className="absolute inset-x-10 bottom-0 flex justify-between font-mono-ui text-[9px] text-muted-foreground"><span>{points[0]?.label}</span><span>{points.at(-1)?.label}</span></div></div>}</section>
      <section className="surface-line rounded-xl bg-card p-5" data-testid="panel-system-health"><div className="mb-5"><h2 className="text-sm font-extrabold">System health</h2><p className="mt-1 text-xs text-muted-foreground">Dependencies powering the signal loop</p></div>{health.isLoading ? <SkeletonRows count={3} /> : health.isError ? <Failure label="Health service" onRetry={() => health.refetch()} /> : <div className="space-y-2">{[['Telegram', health.data?.telegram], ['Database', health.data?.database], ['Redis', health.data?.redis]].map(([label, status]) => <div key={label as string} className="flex items-center justify-between rounded-lg border border-border/70 bg-muted/30 px-3 py-3"><div className="flex items-center gap-2.5 text-sm font-semibold"><Database size={15} className="text-muted-foreground" />{label}</div><StatusPill value={String(status)} /></div>)}<div className="mt-4 flex items-center justify-between border-t border-border pt-4"><span className="text-xs text-muted-foreground">Service uptime</span><span className="font-mono-ui text-xs font-medium">{num(health.data?.uptimeSeconds)} sec</span></div></div>}</section>
    </div>
    <section className="surface-line mt-5 rounded-xl bg-card p-5" data-testid="panel-activity"><div className="mb-4 flex items-center justify-between"><div><h2 className="text-sm font-extrabold">Live activity</h2><p className="mt-1 text-xs text-muted-foreground">The latest decisions made by the pipeline</p></div><Link href="/logs" data-testid="link-view-logs" className="text-xs font-bold text-primary hover:underline">View logs <ArrowUpRight className="ml-1 inline" size={13} /></Link></div><ActivityList events={activity.data} loading={activity.isLoading} error={activity.isError} onRetry={() => activity.refetch()} /></section>
  </>;
}

function CallDetail({ callId, onClose, onReviewed }: { callId: number; onClose: () => void; onReviewed: () => void }) {
  const call = useGetCall(callId, { query: { queryKey: getGetCallQueryKey(callId) } });
  const review = useReviewCall();
  const c = call.data;
  const act = (action: 'approve' | 'reject') => review.mutate({ callId, data: { action } }, { onSuccess: () => { onReviewed(); onClose(); } });
  return <div className="fixed inset-0 z-50 flex justify-end bg-sidebar/35" data-testid="call-detail-drawer"><button aria-label="Close call detail" data-testid="button-close-call-detail" onClick={onClose} className="absolute inset-0 cursor-default" /><aside className="relative h-full w-full max-w-[540px] overflow-y-auto border-l border-border bg-card p-6 shadow-2xl"><div className="flex items-center justify-between"><div className="font-mono-ui text-[10px] uppercase tracking-[.18em] text-primary">Call / {callId}</div><button data-testid="button-dismiss-call" onClick={onClose} className="rounded-lg p-2 hover:bg-muted"><X size={18} /></button></div>{call.isLoading ? <div className="mt-8"><SkeletonRows count={6} /></div> : call.isError || !c ? <div className="mt-8"><Failure label="Call detail" onRetry={() => call.refetch()} /></div> : <div className="mt-8"><div className="flex items-start justify-between"><div><div className="font-mono-ui text-3xl font-medium">${c.ticker}</div><div className="mt-1 text-sm text-muted-foreground">{c.tokenName} · {c.chain}</div></div><StatusPill value={c.status} /></div><div className="mt-7 rounded-xl bg-sidebar p-4 text-sidebar-foreground"><div className="flex items-center justify-between"><span className="font-mono-ui text-[10px] uppercase tracking-widest text-sidebar-foreground/55">Confidence</span><span className="font-mono-ui text-2xl text-sidebar-primary">{c.confidence.toFixed(0)}%</span></div><div className="mt-3 h-1.5 rounded-full bg-sidebar-accent"><div className="h-full rounded-full bg-sidebar-primary" style={{ width: `${c.confidence}%` }} /></div></div><div className="mt-5 grid grid-cols-2 gap-2">{[['Market cap', num(c.market.marketCap, '$')], ['Liquidity', num(c.market.liquidity, '$')], ['24h volume', num(c.market.volume24h, '$')], ['Holders', num(c.market.holders)]].map(([label, value]) => <div className="rounded-lg border border-border p-3" key={label}><div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div><div className="mt-1 font-mono-ui text-sm">{value}</div></div>)}</div><div className="mt-6"><div className="mb-2 text-[10px] font-bold uppercase tracking-[.15em] text-muted-foreground">Narrative</div><p className="text-sm leading-relaxed">{c.narrative}</p></div><div className="mt-5"><div className="mb-2 text-[10px] font-bold uppercase tracking-[.15em] text-muted-foreground">Observations</div><ul className="space-y-2">{c.observations.map((o, i) => <li key={i} className="flex gap-2 text-sm text-muted-foreground"><Check size={14} className="mt-0.5 shrink-0 text-primary" />{o}</li>)}</ul></div>{c.status === 'pending' && <div className="mt-8 flex gap-2 border-t border-border pt-5"><button disabled={review.isPending} data-testid="button-reject-call" onClick={() => act('reject')} className="flex-1 rounded-lg border border-destructive/25 py-2.5 text-xs font-bold text-destructive hover:bg-destructive/10">Reject signal</button><button disabled={review.isPending} data-testid="button-approve-call" onClick={() => act('approve')} className="flex-[1.4] rounded-lg bg-primary py-2.5 text-xs font-bold text-primary-foreground hover:brightness-105">{review.isPending ? 'Saving…' : 'Approve & publish'}</button></div>}</div>}</aside></div>;
}

function Calls() {
  const [status, setStatus] = useState<'all' | 'pending' | 'published' | 'duplicate' | 'rejected'>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const params = useMemo(() => ({ status, search: search || undefined, limit: 50 }), [status, search]);
  const calls = useListCalls(params, { query: { queryKey: getListCallsQueryKey(params) } });
  const tabs = [['all', 'All signals'], ['pending', 'Pending review'], ['published', 'Published'], ['duplicate', 'Duplicates'], ['rejected', 'Rejected']] as const;
  return <><PageHeading eyebrow="Signal triage / queue" title="Detected calls" description="Inspect enriched signals, resolve duplicates, and publish only what earns its way through review." action={<div className="flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-xs font-bold text-primary"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" /> Queue live</div>} />
    <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div className="flex gap-1 overflow-x-auto border-b border-border lg:border-0">{tabs.map(([key, label]) => <button key={key} data-testid={`tab-calls-${key}`} onClick={() => setStatus(key)} className={cn('whitespace-nowrap border-b-2 px-3 py-2 text-xs font-bold transition-colors', status === key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>{label}</button>)}</div><label className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 lg:w-64"><Search size={15} className="text-muted-foreground" /><input data-testid="input-search-calls" value={search} onChange={e => setSearch(e.target.value)} className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground" placeholder="Search ticker or name" /></label></div>
    {calls.isLoading ? <SkeletonRows count={6} /> : calls.isError ? <Failure label="Call queue" onRetry={() => calls.refetch()} /> : !calls.data?.length ? <div className="surface-line rounded-xl bg-card p-14 text-center" data-testid="empty-calls"><div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-muted text-muted-foreground"><Radio size={22} /></div><h3 className="mt-4 text-sm font-extrabold">No signals in this lane</h3><p className="mt-1 text-xs text-muted-foreground">The monitor is quiet here. New detections will land automatically.</p></div> : <div className="surface-line overflow-hidden rounded-xl bg-card" data-testid="calls-table"><div className="hidden grid-cols-[1.35fr_.8fr_.8fr_.8fr_100px] gap-4 border-b border-border bg-muted/40 px-5 py-3 font-mono-ui text-[9px] uppercase tracking-[.15em] text-muted-foreground md:grid"><div>Signal</div><div>Confidence</div><div>Risk</div><div>Detected</div><div /></div>{calls.data.map(call => <CallRow key={call.id} call={call} onOpen={() => setSelected(call.id)} />)}</div>}{selected && <CallDetail callId={selected} onClose={() => setSelected(null)} onReviewed={() => calls.refetch()} />}</>;
}

function CallRow({ call, onOpen }: { call: TokenCall; onOpen: () => void }) {
  const riskColors: Record<TokenCallRisk, string> = { low: 'text-primary', medium: 'text-amber-700', high: 'text-orange-700', critical: 'text-destructive' };
  return <button data-testid={`button-call-row-${call.id}`} onClick={onOpen} className="grid w-full grid-cols-1 gap-3 border-b border-border px-5 py-4 text-left transition-colors last:border-0 hover:bg-muted/40 md:grid-cols-[1.35fr_.8fr_.8fr_.8fr_100px] md:items-center md:gap-4"><div className="flex items-center gap-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-sidebar font-mono-ui text-[10px] font-bold text-sidebar-primary">{call.ticker.slice(0, 2)}</div><div><div className="font-mono-ui text-sm font-medium">${call.ticker}</div><div className="max-w-[220px] truncate text-[11px] text-muted-foreground">{call.tokenName} · {call.chain}</div></div><div className="ml-auto md:hidden"><StatusPill value={call.status} /></div></div><div className="flex items-center justify-between md:block"><div className="mb-1 flex justify-between text-[10px] text-muted-foreground md:hidden"><span>Confidence</span><span className="font-mono-ui">{call.confidence.toFixed(0)}%</span></div><div className="h-1.5 w-full rounded-full bg-muted md:max-w-[110px]"><div className={cn('h-full rounded-full', call.confidence >= 75 ? 'bg-primary' : call.confidence >= 50 ? 'bg-accent' : 'bg-destructive')} style={{ width: `${call.confidence}%` }} /></div><span className="mt-1 hidden font-mono-ui text-[10px] text-muted-foreground md:block">{call.confidence.toFixed(0)} / 100</span></div><div className={cn('font-mono-ui text-[10px] font-medium uppercase tracking-wider', riskColors[call.risk])}>{call.risk} risk</div><div className="font-mono-ui text-[10px] text-muted-foreground">{ago(call.detectedAt)}</div><div className="hidden md:block"><StatusPill value={call.status} /></div></button>;
}

function Channels() {
  const channels = useListChannels({ query: { queryKey: getListChannelsQueryKey() } });
  const create = useCreateChannel();
  const update = useUpdateChannel();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Channel | null>(null);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const reset = () => { setOpen(false); setEditing(null); setUsername(''); setDisplayName(''); };
  const submit = (e: FormEvent) => { e.preventDefault(); if (editing) update.mutate({ channelId: editing.id, data: { displayName, status: editing.status } }, { onSuccess: () => { channels.refetch(); reset(); } }); else create.mutate({ data: { username, displayName } }, { onSuccess: () => { channels.refetch(); reset(); } }); };
  const toggle = (channel: Channel) => update.mutate({ channelId: channel.id, data: { status: channel.status === 'monitoring' ? 'paused' : 'monitoring' } }, { onSuccess: () => channels.refetch() });
  return <><PageHeading eyebrow="Routing / sources" title="Channels" description="Keep source coverage and the publishing destination legible. Paused channels stay configured but stop feeding the monitor." action={<button data-testid="button-add-channel" onClick={() => { reset(); setOpen(true); }} className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2.5 text-xs font-bold text-primary-foreground hover:brightness-105"><Plus size={15} /> Add channel</button>} />{channels.isLoading ? <SkeletonRows count={4} /> : channels.isError ? <Failure label="Channel registry" onRetry={() => channels.refetch()} /> : <div className="grid gap-5 lg:grid-cols-2">{(['source', 'destination'] as ChannelKind[]).map(kind => <section key={kind} className="surface-line rounded-xl bg-card p-5"><div className="mb-4 flex items-center justify-between"><div><h2 className="text-sm font-extrabold">{kind === 'source' ? 'Source channels' : 'Destination channels'}</h2><p className="mt-1 text-xs text-muted-foreground">{kind === 'source' ? 'Inputs to the detection pipeline' : 'Approved signal distribution'}</p></div><span className="font-mono-ui text-[10px] text-muted-foreground">{channels.data?.filter(c => c.kind === kind).length || 0} configured</span></div><div className="space-y-2">{channels.data?.filter(c => c.kind === kind).map(channel => <div key={channel.id} data-testid={`channel-card-${channel.id}`} className="rounded-lg border border-border bg-muted/20 p-3"><div className="flex items-start gap-3"><div className="grid h-8 w-8 place-items-center rounded-lg bg-sidebar text-sidebar-primary"><Radio size={14} /></div><div className="min-w-0 flex-1"><div className="truncate text-sm font-bold">{channel.displayName || channel.username}</div><div className="mt-0.5 font-mono-ui text-[10px] text-muted-foreground">{channel.username} · {channel.messagesToday} messages today</div></div><StatusPill value={channel.status} /></div>{channel.errorMessage && <div className="mt-3 rounded bg-destructive/5 px-2 py-1.5 text-[11px] text-destructive">{channel.errorMessage}</div>}<div className="mt-3 flex items-center justify-end gap-3 border-t border-border/70 pt-2"><span className="mr-auto font-mono-ui text-[9px] text-muted-foreground">SEEN {ago(channel.lastSeenAt)}</span><button data-testid={`button-toggle-channel-${channel.id}`} onClick={() => toggle(channel)} disabled={update.isPending} className="inline-flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground hover:text-foreground">{channel.status === 'monitoring' ? <Pause size={13} /> : <CircleDot size={13} />} {channel.status === 'monitoring' ? 'Pause' : 'Resume'}</button><button data-testid={`button-edit-channel-${channel.id}`} onClick={() => { setEditing(channel); setUsername(channel.username); setDisplayName(channel.displayName); setOpen(true); }} className="inline-flex items-center gap-1.5 text-[10px] font-bold text-primary hover:underline"><Pencil size={12} /> Edit</button></div></div>)}{!channels.data?.some(c => c.kind === kind) && <div className="rounded-lg border border-dashed border-border p-8 text-center text-xs text-muted-foreground">No {kind} channels configured.</div>}</div></section>)}</div>}{open && <div className="fixed inset-0 z-50 grid place-items-center bg-sidebar/35 p-4"><form onSubmit={submit} data-testid="form-channel" className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl"><div className="flex items-center justify-between"><h2 className="text-lg font-extrabold">{editing ? 'Edit channel' : 'Add source channel'}</h2><button type="button" data-testid="button-close-channel-form" onClick={reset} className="rounded-lg p-2 hover:bg-muted"><X size={18} /></button></div><p className="mt-1 text-xs text-muted-foreground">Channel identity is stored exactly as provided by the operator.</p><label className="mt-6 block text-xs font-bold">Username<input required minLength={2} data-testid="input-channel-username" disabled={!!editing} value={username} onChange={e => setUsername(e.target.value)} placeholder="@market-intel" className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring" /></label><label className="mt-4 block text-xs font-bold">Display name<input data-testid="input-channel-display-name" value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Desk / Primary feed" className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring" /></label><button disabled={create.isPending || update.isPending} data-testid="button-save-channel" className="mt-6 w-full rounded-lg bg-primary py-2.5 text-xs font-bold text-primary-foreground">{create.isPending || update.isPending ? 'Saving…' : editing ? 'Save changes' : 'Add channel'}</button></form></div>}</>;
}

function Settings() {
  const settings = useGetSettings({ query: { queryKey: getGetSettingsQueryKey() } });
  const credentials = useGetCredentialsStatus({ query: { queryKey: getGetCredentialsStatusQueryKey() } });
  const updateCredentials = useUpdateCredentials();
  const update = useUpdateSettings();
  const [form, setForm] = useState<Partial<RuntimeSettings>>({});
  const [credentialForm, setCredentialForm] = useState<CredentialsUpdate>({});

  useEffect(() => {
    if (settings.data) setForm(settings.data);
  }, [settings.data]);

  const save = (event: FormEvent) => {
    event.preventDefault();
    update.mutate({
      data: {
        ...form,
        minimumConfidence: Number(form.minimumConfidence),
        duplicateWindowHours: Number(form.duplicateWindowHours),
      },
    }, {
      onSuccess: result => {
        setForm(result);
        queryClient.setQueryData(getGetSettingsQueryKey(), result);
      },
    });
  };

  const saveCredentials = (event: FormEvent) => {
    event.preventDefault();
    const data = Object.fromEntries(
      Object.entries(credentialForm).filter(([, value]) => value?.trim()),
    ) as CredentialsUpdate;
    updateCredentials.mutate({ data }, {
      onSuccess: result => {
        queryClient.setQueryData(getGetCredentialsStatusQueryKey(), result);
        setCredentialForm({});
      },
    });
  };

  const credentialRows = credentials.data ? [
    ['Telegram API ID', credentials.data.telegramApiIdConfigured],
    ['Telegram API hash', credentials.data.telegramApiHashConfigured],
    ['Telethon session', credentials.data.telegramSessionConfigured],
    ['Telegram bot token', credentials.data.telegramBotTokenConfigured],
    ['Gemini API key', credentials.data.geminiApiKeyConfigured],
  ] as const : [];

  const fieldClass = 'mt-2 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring';

  return <>
    <PageHeading eyebrow="Runtime / configuration" title="Settings" description="Tune the live signal loop and securely connect the services that power it." />
    {settings.isLoading ? <SkeletonRows count={5} /> : settings.isError ? <Failure label="Runtime settings" onRetry={() => settings.refetch()} /> : (
      <div className="max-w-3xl space-y-5">
        <form onSubmit={save} className="space-y-5" data-testid="form-settings">
          <section className="surface-line rounded-xl bg-card p-5">
            <div className="mb-5 flex items-start gap-3">
              <div className="rounded-lg bg-primary/10 p-2 text-primary"><SlidersHorizontal size={17} /></div>
              <div><h2 className="text-sm font-extrabold">Processing posture</h2><p className="mt-1 text-xs text-muted-foreground">These values are persisted in PostgreSQL and read by the worker.</p></div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-xs font-bold">Destination channel
                <input required data-testid="input-destination-channel" value={form.destinationChannel || ''} onChange={event => setForm({ ...form, destinationChannel: event.target.value })} className={fieldClass} placeholder="@your-destination-channel" />
              </label>
              <label className="text-xs font-bold">Enrichment provider
                <select data-testid="select-llm-provider" value={form.llmProvider || 'gemini'} onChange={event => setForm({ ...form, llmProvider: event.target.value as RuntimeSettings['llmProvider'] })} className={fieldClass}>
                  <option value="gemini">Gemini</option><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="grok">Grok</option>
                </select>
              </label>
            </div>
          </section>
          <section className="surface-line rounded-xl bg-card p-5">
            <div className="mb-5 flex items-start gap-3">
              <div className="rounded-lg bg-accent/15 p-2 text-amber-700"><ShieldCheck size={17} /></div>
              <div><h2 className="text-sm font-extrabold">Review thresholds</h2><p className="mt-1 text-xs text-muted-foreground">Keep automatic publishing off until you have verified real detections and destination permissions.</p></div>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <label className="text-xs font-bold">Minimum confidence <span className="float-right font-mono-ui text-primary">{form.minimumConfidence ?? 0}</span>
                <input data-testid="input-minimum-confidence" type="range" min="0" max="100" value={form.minimumConfidence ?? 0} onChange={event => setForm({ ...form, minimumConfidence: Number(event.target.value) })} className="mt-4 w-full accent-[hsl(var(--primary))]" />
              </label>
              <label className="text-xs font-bold">Duplicate window <span className="float-right font-mono-ui text-primary">{form.duplicateWindowHours ?? 0}h</span>
                <input data-testid="input-duplicate-window" type="range" min="1" max="720" value={form.duplicateWindowHours ?? 1} onChange={event => setForm({ ...form, duplicateWindowHours: Number(event.target.value) })} className="mt-4 w-full accent-[hsl(var(--primary))]" />
              </label>
            </div>
          </section>
          <section className="surface-line divide-y divide-border rounded-xl bg-card">
            <Toggle label="Auto-publish approved signals" hint="Only sends a signal after analysis and the confidence threshold." value={!!form.autoPublish} onChange={value => setForm({ ...form, autoPublish: value })} testId="toggle-auto-publish" />
            <Toggle label="Repost media attachments" hint="Enable only when you have permission from the source." value={!!form.mediaRepost} onChange={value => setForm({ ...form, mediaRepost: value })} testId="toggle-media-repost" />
          </section>
          <div className="flex items-center justify-end gap-4">
            <span className="text-xs text-muted-foreground">{update.isSuccess ? 'Saved just now' : 'Review before saving'}</span>
            <button disabled={update.isPending} data-testid="button-save-settings" className="rounded-lg bg-primary px-5 py-2.5 text-xs font-bold text-primary-foreground hover:brightness-105">{update.isPending ? 'Saving…' : 'Save configuration'}</button>
          </div>
        </form>

        <section className="surface-line rounded-xl bg-card p-5" data-testid="panel-connections">
          <div className="flex items-start justify-between gap-4">
            <div><div className="font-mono-ui text-[10px] uppercase tracking-[.18em] text-primary">Secure connections</div><h2 className="mt-2 text-lg font-extrabold">Telegram + Gemini</h2><p className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground">Values are encrypted server-side and never returned to the browser after saving. Empty fields leave existing values unchanged.</p></div>
            <Database className="text-primary" size={20} />
          </div>
          {credentials.isLoading ? <div className="mt-5"><SkeletonRows count={3} /></div> : credentials.isError ? <div className="mt-5"><Failure label="Credential status" onRetry={() => credentials.refetch()} /></div> : (
            <>
              <div className="mt-5 grid gap-2 sm:grid-cols-2">
                {credentialRows.map(([label, configured]) => <div key={label} data-testid={`credential-status-${label.toLowerCase().replaceAll(' ', '-')}`} className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-xs"><span>{label}</span><StatusPill value={configured ? 'connected' : 'not_configured'} /></div>)}
              </div>
              <form onSubmit={saveCredentials} className="mt-5 grid gap-3 sm:grid-cols-2" data-testid="form-credentials">
                <label className="text-xs font-bold">Telegram API ID<input data-testid="input-telegram-api-id" inputMode="numeric" type="password" value={credentialForm.telegramApiId || ''} onChange={event => setCredentialForm({ ...credentialForm, telegramApiId: event.target.value })} className={fieldClass} /></label>
                <label className="text-xs font-bold">Telegram API hash<input data-testid="input-telegram-api-hash" type="password" value={credentialForm.telegramApiHash || ''} onChange={event => setCredentialForm({ ...credentialForm, telegramApiHash: event.target.value })} className={fieldClass} /></label>
                <label className="text-xs font-bold">Telethon session string<input data-testid="input-telegram-session" type="password" value={credentialForm.telegramSession || ''} onChange={event => setCredentialForm({ ...credentialForm, telegramSession: event.target.value })} className={fieldClass} /></label>
                <label className="text-xs font-bold">Telegram bot token <span className="font-normal text-muted-foreground">(optional)</span><input data-testid="input-telegram-bot-token" type="password" value={credentialForm.telegramBotToken || ''} onChange={event => setCredentialForm({ ...credentialForm, telegramBotToken: event.target.value })} className={fieldClass} /></label>
                <label className="text-xs font-bold sm:col-span-2">Gemini API key<input data-testid="input-gemini-api-key" type="password" value={credentialForm.geminiApiKey || ''} onChange={event => setCredentialForm({ ...credentialForm, geminiApiKey: event.target.value })} className={fieldClass} /></label>
                <div className="flex items-center justify-end gap-3 sm:col-span-2"><span className="text-xs text-muted-foreground">{updateCredentials.isSuccess ? 'Encrypted and saved' : 'Credentials are never shown again'}</span><button disabled={updateCredentials.isPending} data-testid="button-save-credentials" className="rounded-lg bg-sidebar px-5 py-2.5 text-xs font-bold text-sidebar-primary">{updateCredentials.isPending ? 'Encrypting…' : 'Save secure connections'}</button></div>
              </form>
            </>
          )}
        </section>
      </div>
    )}
  </>;
}
function Toggle({ label, hint, value, onChange, testId }: { label: string; hint: string; value: boolean; onChange: (value: boolean) => void; testId: string }) { return <label className="flex cursor-pointer items-center justify-between gap-4 p-4"><span><span className="block text-sm font-bold">{label}</span><span className="mt-1 block text-xs text-muted-foreground">{hint}</span></span><button type="button" role="switch" aria-checked={value} data-testid={testId} onClick={() => onChange(!value)} className={cn('relative h-6 w-11 rounded-full transition-colors', value ? 'bg-primary' : 'bg-muted')}><span className={cn('absolute top-1 h-4 w-4 rounded-full bg-card shadow-sm transition-transform', value ? 'translate-x-6' : 'translate-x-1')} /></button></label>; }

function Logs() {
  const logs = useListLogs({ limit: 80 }, { query: { queryKey: getListLogsQueryKey({ limit: 80 }) } });
  const [level, setLevel] = useState('all');
  const visible = logs.data?.filter(log => level === 'all' || log.level === level);
  return <><PageHeading eyebrow="Observability / trail" title="Operational logs" description="Structured events from the signal loop. Read the why behind a pause, rejection, or publish." action={<button data-testid="button-refresh-logs" onClick={() => logs.refetch()} className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-bold hover:bg-muted"><RefreshCw size={14} /> Refresh</button>} /><div className="mb-4 flex items-center gap-2"><Filter size={14} className="text-muted-foreground" />{['all', 'info', 'warn', 'error'].map(item => <button key={item} data-testid={`filter-log-${item}`} onClick={() => setLevel(item)} className={cn('rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider', level === item ? 'bg-sidebar text-sidebar-foreground' : 'bg-muted text-muted-foreground hover:text-foreground')}>{item}</button>)}</div>{logs.isLoading ? <SkeletonRows count={7} /> : logs.isError ? <Failure label="Operational logs" onRetry={() => logs.refetch()} /> : !visible?.length ? <div className="surface-line rounded-xl bg-card p-14 text-center text-sm text-muted-foreground" data-testid="empty-logs">No log entries match this filter.</div> : <div className="surface-line overflow-hidden rounded-xl bg-card" data-testid="logs-table">{visible.map(log => <LogRow key={log.id} log={log} />)}</div>}</>;
}
function LogRow({ log }: { log: LogEntry }) { return <div data-testid={`log-row-${log.id}`} className="grid gap-2 border-b border-border px-5 py-4 last:border-0 md:grid-cols-[80px_110px_1fr_110px] md:items-center md:gap-4"><StatusPill value={log.level} /><span className="font-mono-ui text-[10px] uppercase tracking-wider text-muted-foreground">{log.service}</span><span className="text-xs leading-relaxed">{log.message}</span><span className="font-mono-ui text-[10px] text-muted-foreground md:text-right">{ago(log.createdAt)}</span></div>; }

function Router() {
  return <Shell><Switch><Route path="/" component={Overview} /><Route path="/calls" component={Calls} /><Route path="/channels" component={Channels} /><Route path="/settings" component={Settings} /><Route path="/logs" component={Logs} /><Route component={NotFound} /></Switch></Shell>;
}
function Login({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    const response = await fetch('/api/auth/login', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
    if (!response.ok) { setError('Invalid dashboard password.'); return; }
    onSuccess();
  };
  return <div className="grid min-h-[100dvh] place-items-center bg-background p-5"><form onSubmit={submit} className="w-full max-w-sm rounded-3xl border border-border bg-card p-7 shadow-xl"><div className="grid h-11 w-11 place-items-center rounded-2xl bg-sidebar text-sidebar-primary font-mono-ui font-bold">A/</div><div className="mt-7 font-mono-ui text-[10px] uppercase tracking-[.2em] text-primary">Private operations</div><h1 className="mt-2 text-2xl font-extrabold tracking-tight">ARCC Signal Hub</h1><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Sign in to manage live Telegram ingestion, Gemini analysis, and publishing.</p><label className="mt-7 block text-xs font-bold">Dashboard password<input autoFocus required type="password" value={password} onChange={e => setPassword(e.target.value)} className="mt-2 w-full rounded-xl border border-input bg-background px-3.5 py-3 text-sm outline-none focus:ring-2 focus:ring-ring" /></label>{error && <div className="mt-3 text-xs text-destructive">{error}</div>}<button className="mt-5 w-full rounded-xl bg-sidebar py-3 text-xs font-bold text-sidebar-primary">Open control room</button></form></div>;
}
function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  useEffect(() => { fetch('/api/auth/session', { credentials: 'include' }).then(response => setAuthenticated(response.ok)).catch(() => setAuthenticated(false)); }, []);
  if (authenticated === null) return <div className="grid min-h-[100dvh] place-items-center bg-background text-sm text-muted-foreground">Checking secure session…</div>;
  return <QueryClientProvider client={queryClient}><TooltipProvider>{authenticated ? <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter> : <Login onSuccess={() => setAuthenticated(true)} />}<Toaster /></TooltipProvider></QueryClientProvider>;
}
export default App;