/**
 * 极简 i18n：Provider + useI18n + 币种格式化（RSD + EUR 双显）
 */
import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { MESSAGES, LANGS, type Lang } from './messages';

interface I18nCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  /** 双币显示：如 "990 RSD (≈8.40 €)" */
  money: (rsd: number, eur: number) => string;
  langs: typeof LANGS;
}

const Ctx = createContext<I18nCtx | null>(null);

const STORE_KEY = 'aigg_lang';

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(STORE_KEY) : null;
    return (saved as Lang) || 'zh';
  });

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(STORE_KEY, l);
    } catch {
      /* ignore */
    }
    if (typeof document !== 'undefined') document.documentElement.lang = l;
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const dict = MESSAGES[lang] ?? MESSAGES.zh;
      let s = dict[key] ?? MESSAGES.zh[key] ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
        }
      }
      return s;
    },
    [lang]
  );

  const money = useCallback(
    (rsd: number, eur: number) => {
      const r = Math.round(rsd).toLocaleString(lang === 'sr' || lang === 'en' ? 'en-US' : 'zh-CN');
      const e = eur.toFixed(2);
      return `${r} RSD (≈ ${e} €)`;
    },
    [lang]
  );

  return <Ctx.Provider value={{ lang, setLang, t, money, langs: LANGS }}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
