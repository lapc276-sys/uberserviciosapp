import type { ReactNode } from 'react';

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <section className="border-b">
      <div className="container py-16 sm:py-20">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-4xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-2 text-sm text-slate-400">Last updated: {updated}</p>
          <div className="prose-legal mt-8 space-y-6 text-sm leading-relaxed text-slate-600 dark:text-slate-300 [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-slate-900 dark:[&_h2]:text-white">
            {children}
          </div>
        </div>
      </div>
    </section>
  );
}
