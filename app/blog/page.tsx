import type { Metadata } from 'next';
import Link from 'next/link';
import { buildMetadata } from '@/lib/seo';

export const metadata: Metadata = buildMetadata({
  title: 'Blog — Cleaning Tips & Home Care | Homigo',
  description: 'Practical cleaning tips, checklists and home-care guides from the Homigo team.',
  path: '/blog',
});

// Seed posts. In Phase 2 these become MDX/CMS-driven for SEO content velocity.
const posts = [
  { slug: 'deep-cleaning-checklist', title: 'The Ultimate Deep Cleaning Checklist', excerpt: 'Room-by-room, everything the pros hit during a deep clean.', tag: 'Guides' },
  { slug: 'move-out-cleaning-deposit', title: 'How to Get Your Full Deposit Back', excerpt: 'The move-out cleaning steps landlords actually check.', tag: 'Moving' },
  { slug: 'airbnb-turnover-guide', title: 'The 5-Star Airbnb Turnover Playbook', excerpt: 'Fast, repeatable turnovers that protect your rating.', tag: 'Hosting' },
];

export default function BlogPage() {
  return (
    <section className="border-b">
      <div className="container py-16 sm:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <span className="eyebrow">Blog</span>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">Cleaning tips & home care</h1>
          <p className="mt-4 text-lg text-slate-600 dark:text-slate-300">Guides and checklists to keep your home effortless.</p>
        </div>
        <div className="mx-auto mt-14 grid max-w-5xl gap-6 md:grid-cols-3">
          {posts.map((p) => (
            <Link key={p.slug} href="/blog" className="group rounded-2xl border bg-white p-6 shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-lift dark:bg-white/[0.03]">
              <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-950 dark:text-brand-300">{p.tag}</span>
              <h2 className="mt-4 font-semibold group-hover:text-brand-600">{p.title}</h2>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{p.excerpt}</p>
            </Link>
          ))}
        </div>
        <p className="mt-10 text-center text-sm text-slate-400">More articles coming soon.</p>
      </div>
    </section>
  );
}
