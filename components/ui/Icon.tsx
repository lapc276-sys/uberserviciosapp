import { icons } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Renders a lucide icon by name (icon names live in config as strings). */
export function Icon({ name, className }: { name: string; className?: string }) {
  const LucideIcon = icons[name as keyof typeof icons] ?? icons.Sparkles;
  return <LucideIcon className={cn('h-5 w-5', className)} />;
}
