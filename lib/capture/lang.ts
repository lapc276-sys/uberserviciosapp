/**
 * Which language the walkthrough speaks.
 *
 * Two, fully: Spanish and English. "Fully" is the point — the bot says every
 * line in that language AND understands the answers in it, and a language is
 * only added here when both halves exist. A bot that talks Russian but hears
 * "да" as nothing is worse than one that is honest about speaking two.
 *
 * The phone says which languages its owner set, with no cookie and no
 * permission: `navigator.languages`. That is a guess about the person, not a
 * fact — plenty of people in the US run their phone in English and would
 * rather be spoken to in Spanish — so it only picks the default, and the
 * planning screen always shows the choice.
 */

export const LANGS = ['es', 'en'] as const;
export type Lang = (typeof LANGS)[number];

/** US variants: the voices and the recogniser are tuned to how customers here speak. */
export const SPEECH_TAG: Record<Lang, string> = { es: 'es-US', en: 'en-US' };

/** What each language calls itself, for the picker. */
export const LANG_NAMES: Record<Lang, string> = { es: 'Español', en: 'English' };

export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && (LANGS as readonly string[]).includes(value);
}

/**
 * The phone's preference, read from its language list.
 *
 * `lang` is the first of its languages we speak, or null. `primary` is its
 * very first language whatever it is ("ru"), so the screen can say "your
 * phone is in Russian; for now I speak Spanish and English" instead of
 * silently answering a Russian speaker in English.
 */
export function phoneLanguage(languages: readonly string[] | undefined): { lang: Lang | null; primary: string | null } {
  const codes = (languages ?? [])
    .map((tag) => String(tag ?? '').trim().toLowerCase().split(/[-_]/)[0])
    .filter(Boolean);
  return {
    lang: (codes.find((code) => isLang(code)) as Lang | undefined) ?? null,
    primary: codes[0] ?? null,
  };
}

/** The browser's list, or nothing on the server. */
export function browserLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  return navigator.languages?.length ? navigator.languages : navigator.language ? [navigator.language] : [];
}

/**
 * A language's name, in the language being spoken: "ruso" / "Russian".
 * Falls back to the code where the browser cannot name it.
 */
export function languageName(code: string, inLang: Lang): string {
  try {
    const name = new Intl.DisplayNames([inLang], { type: 'language' }).of(code);
    return name ?? code;
  } catch {
    return code;
  }
}

/** The starting language: the page's own if it has one, else the phone's, else Spanish. */
export function initialLang(pageLocale: string | undefined, languages: readonly string[]): Lang {
  if (isLang(pageLocale)) return pageLocale;
  return phoneLanguage(languages).lang ?? 'es';
}
