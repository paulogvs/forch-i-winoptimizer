import { useState, useEffect, useCallback } from 'react';
import es from './es.json';
import en from './en.json';

export type Language = 'es' | 'en';
export type TranslationKeys = typeof es;

const translations: Record<Language, TranslationKeys> = { es, en };

export function useI18n() {
  const [language, setLanguage] = useState<Language>(() => {
    const saved = localStorage.getItem('language');
    if (saved === 'es' || saved === 'en') return saved;
    // Auto-detect from system
    const systemLang = navigator.language.toLowerCase();
    return systemLang.startsWith('es') ? 'es' : 'en';
  });

  useEffect(() => {
    localStorage.setItem('language', language);
    document.documentElement.lang = language;
  }, [language]);

  const t = useCallback(
    (path: string): string => {
      const keys = path.split('.');
      let result: unknown = translations[language];
      for (const key of keys) {
        if (result && typeof result === 'object') {
          result = (result as Record<string, unknown>)[key];
        } else {
          return path;
        }
      }
      return typeof result === 'string' ? result : path;
    },
    [language]
  );

  const changeLanguage = useCallback((lang: Language) => {
    setLanguage(lang);
  }, []);

  return { t, language, changeLanguage };
}
