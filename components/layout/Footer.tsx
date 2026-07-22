import Link from 'next/link';
import { site } from '@/lib/config/site';
import { services } from '@/lib/config/services';
import { cities } from '@/lib/config/cities';
import { verticals } from '@/lib/config/verticals';

const company = [
  { label: 'About', href: '/about' },
  { label: 'Careers', href: '/careers' },
  { label: 'Contact', href: '/contact' },
  { label: 'Blog', href: '/blog' },
  { label: 'FAQ', href: '/faq' },
];

const legal = [
  { label: 'Privacy', href: '/privacy' },
  { label: 'Terms', href: '/terms' },
];

export function Footer() {
  return (
    <footer className="border-t bg-slate-50 dark:bg-white/[0.02]">
      <div className="container grid gap-10 py-14 md:grid-cols-5">
        <div className="md:col-span-2">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-white">H</span>
            {site.name}
          </Link>
          <p className="mt-4 max-w-xs text-sm text-slate-500 dark:text-slate-400">
            {site.description}
          </p>
          <div className="mt-4 text-sm text-slate-500 dark:text-slate-400">
            <a href={site.phoneHref} className="link-underline">{site.phone}</a>
            <br />
            <a href={`mailto:${site.email}`} className="link-underline">{site.email}</a>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {verticals.map((v) => (
              <span
                key={v.slug}
                className="rounded-full border px-2.5 py-1 text-xs text-slate-500 dark:text-slate-400"
              >
                {v.name}{v.status === 'soon' ? ' · soon' : ''}
              </span>
            ))}
          </div>
        </div>

        <FooterCol title="Services" links={services.slice(0, 6).map((s) => ({ label: s.name, href: `/services/${s.slug}` }))} />
        <FooterCol title="Areas" links={cities.map((c) => ({ label: `${c.name}, ${c.region}`, href: `/areas/${c.slug}` }))} />
        <FooterCol title="Company" links={[...company, ...legal]} />
      </div>

      <div className="border-t">
        <div className="container flex flex-col items-center justify-between gap-2 py-6 text-xs text-slate-500 sm:flex-row dark:text-slate-400">
          <p>© {new Date().getFullYear()} {site.legalName}. All rights reserved.</p>
          <p>Licensed & insured · Satisfaction guaranteed</p>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: { label: string; href: string }[] }) {
  return (
    <div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <ul className="mt-4 space-y-2.5">
        {links.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="text-sm text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
