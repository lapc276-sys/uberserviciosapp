import { Button } from '@/components/ui/Button';

export default function NotFound() {
  return (
    <section className="border-b">
      <div className="container flex min-h-[60vh] flex-col items-center justify-center py-20 text-center">
        <p className="text-sm font-semibold text-brand-600">404</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">Page not found</h1>
        <p className="mt-3 max-w-md text-slate-600 dark:text-slate-300">
          The page you’re looking for doesn’t exist or moved. Let’s get you back on track.
        </p>
        <div className="mt-8 flex gap-3">
          <Button href="/">Go home</Button>
          <Button href="/book" variant="ghost">Book a cleaning</Button>
        </div>
      </div>
    </section>
  );
}
