import { Link } from 'wouter';
import { ArrowLeft, Compass } from 'lucide-react';

export default function NotFound() {
  return <div className="grid min-h-[60vh] place-items-center text-center">
    <div>
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-sidebar text-sidebar-primary"><Compass size={25} /></div>
      <div className="mt-6 font-mono-ui text-[10px] uppercase tracking-[.2em] text-primary">ARCC / 404</div>
      <h1 className="mt-2 text-3xl font-extrabold tracking-tight">Signal not found</h1>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">That workspace route does not exist. Return to the operational overview.</p>
      <Link href="/" data-testid="link-return-overview" className="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground"><ArrowLeft size={14} /> Return to overview</Link>
    </div>
  </div>;
}