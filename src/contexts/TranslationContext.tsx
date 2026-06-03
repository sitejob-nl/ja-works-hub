import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { TranslationContext, type PlatformLanguage } from '@/contexts/translation-context';

interface TranslationRecord {
  original: string;
  translated: string;
  targetLanguage: PlatformLanguage;
}

const STORAGE_KEY = 'jawerkt-platform-language';
const CACHE_KEY = 'jawerkt-platform-translation-cache-v1';
const SOURCE_LANGUAGE: PlatformLanguage = 'nl';
const TARGET_LANGUAGE: PlatformLanguage = 'en';
const MAX_BATCH_ITEMS = 80;
const MAX_TEXT_LENGTH = 900;
const TRANSLATABLE_ATTRIBUTES = ['placeholder', 'title', 'aria-label'] as const;

const nodeTranslations = new WeakMap<Text, TranslationRecord>();
const attributeTranslations = new WeakMap<Element, Map<string, TranslationRecord>>();

type TranslationTarget =
  | { type: 'text'; node: Text; original: string }
  | { type: 'attribute'; element: Element; attribute: string; original: string };

function normalizeLanguage(value: PlatformLanguage | null | undefined): PlatformLanguage {
  return value === TARGET_LANGUAGE ? TARGET_LANGUAGE : SOURCE_LANGUAGE;
}

function readInitialLanguage(): PlatformLanguage {
  if (typeof window === 'undefined') return SOURCE_LANGUAGE;
  return window.localStorage.getItem(STORAGE_KEY) === TARGET_LANGUAGE ? TARGET_LANGUAGE : SOURCE_LANGUAGE;
}

function readCache(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(window.localStorage.getItem(CACHE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function writeCache(cache: Record<string, string>) {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Cache is a performance hint; translation still works without storage.
  }
}

function shouldSkipElement(element: Element | null): boolean {
  if (!element) return true;
  const tag = element.tagName.toLowerCase();
  return (
    tag === 'script' ||
    tag === 'style' ||
    tag === 'noscript' ||
    tag === 'svg' ||
    tag === 'path' ||
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select' ||
    tag === 'option' ||
    tag === 'code' ||
    tag === 'pre' ||
    element.closest('[data-no-translate="true"], [contenteditable="true"]') !== null
  );
}

function shouldSkipAttributeElement(element: Element | null): boolean {
  if (!element) return true;
  const tag = element.tagName.toLowerCase();
  return (
    tag === 'script' ||
    tag === 'style' ||
    tag === 'noscript' ||
    tag === 'svg' ||
    tag === 'path' ||
    tag === 'code' ||
    tag === 'pre' ||
    element.closest('[data-no-translate="true"], [contenteditable="true"]') !== null
  );
}

function normalizedText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function withOriginalSpacing(originalValue: string, replacement: string): string {
  const leading = originalValue.match(/^\s*/)?.[0] ?? '';
  const trailing = originalValue.match(/\s*$/)?.[0] ?? '';
  return `${leading}${replacement}${trailing}`;
}

function isTranslatableText(value: string): boolean {
  const text = normalizedText(value);
  if (text.length < 2 || text.length > MAX_TEXT_LENGTH) return false;
  if (!/[A-Za-zÀ-ÿ]/.test(text)) return false;
  if (/^[\d\s.,:/\\|()[\]{}+\-–—%€$#@]+$/.test(text)) return false;
  return true;
}

function collectTextNodes(root: HTMLElement): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!(node instanceof Text)) return NodeFilter.FILTER_REJECT;
      if (shouldSkipElement(node.parentElement)) return NodeFilter.FILTER_REJECT;
      return isTranslatableText(node.nodeValue ?? '') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });

  const nodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    nodes.push(current as Text);
    current = walker.nextNode();
  }
  return nodes;
}

function cacheKey(text: string, targetLanguage: PlatformLanguage): string {
  return `${targetLanguage}:${text}`;
}

function getAttributeRecord(element: Element, attribute: string): TranslationRecord | undefined {
  return attributeTranslations.get(element)?.get(attribute);
}

function setAttributeRecord(element: Element, attribute: string, record: TranslationRecord) {
  const records = attributeTranslations.get(element) ?? new Map<string, TranslationRecord>();
  records.set(attribute, record);
  attributeTranslations.set(element, records);
}

function collectAttributeTargets(root: HTMLElement): TranslationTarget[] {
  const elements = [root, ...Array.from(root.querySelectorAll('*'))];
  const targets: TranslationTarget[] = [];

  elements.forEach((element) => {
    if (shouldSkipAttributeElement(element)) return;

    TRANSLATABLE_ATTRIBUTES.forEach((attribute) => {
      const current = element.getAttribute(attribute);
      if (!current) return;

      const previous = getAttributeRecord(element, attribute);
      if (previous?.targetLanguage === TARGET_LANGUAGE && current === previous.translated) return;

      const original = normalizedText(current);
      if (!isTranslatableText(original)) return;
      targets.push({ type: 'attribute', element, attribute, original });
    });
  });

  return targets;
}

function collectTranslationTargets(root: HTMLElement): TranslationTarget[] {
  const textTargets = collectTextNodes(root).flatMap<TranslationTarget>((node) => {
    const current = node.nodeValue ?? '';
    const previous = nodeTranslations.get(node);
    if (previous?.targetLanguage === TARGET_LANGUAGE && current === previous.translated) return [];

    const original = normalizedText(current);
    if (!isTranslatableText(original)) return [];
    return [{ type: 'text', node, original }];
  });

  return [...textTargets, ...collectAttributeTargets(root)];
}

function applyTranslation(target: TranslationTarget, translated: string) {
  if (target.type === 'text') {
    target.node.nodeValue = withOriginalSpacing(target.node.nodeValue ?? '', translated);
    nodeTranslations.set(target.node, {
      original: target.original,
      translated,
      targetLanguage: TARGET_LANGUAGE,
    });
    return;
  }

  target.element.setAttribute(target.attribute, translated);
  setAttributeRecord(target.element, target.attribute, {
    original: target.original,
    translated,
    targetLanguage: TARGET_LANGUAGE,
  });
}

interface TranslationProviderProps {
  children: ReactNode;
  initialLanguage?: PlatformLanguage | null;
  onLanguageChange?: (language: PlatformLanguage) => void;
  enableRuntimeTranslation?: boolean;
}

export function TranslationProvider({
  children,
  initialLanguage,
  onLanguageChange,
  enableRuntimeTranslation = true,
}: TranslationProviderProps) {
  const [language, setLanguageState] = useState<PlatformLanguage>(() => (
    initialLanguage ? normalizeLanguage(initialLanguage) : readInitialLanguage()
  ));
  const [isTranslating, setIsTranslating] = useState(false);
  const languageRef = useRef(language);
  const onLanguageChangeRef = useRef(onLanguageChange);
  const pendingTimerRef = useRef<number | undefined>();
  const mutationObserverRef = useRef<MutationObserver | null>(null);
  const cacheRef = useRef<Record<string, string>>(readCache());

  useEffect(() => {
    onLanguageChangeRef.current = onLanguageChange;
  }, [onLanguageChange]);

  useEffect(() => {
    if (!initialLanguage) return;
    setLanguageState(normalizeLanguage(initialLanguage));
  }, [initialLanguage]);

  useEffect(() => {
    languageRef.current = language;
    document.documentElement.lang = language;
    window.localStorage.setItem(STORAGE_KEY, language);
  }, [language]);

  const restoreDutch = useCallback(() => {
    const root = document.getElementById('root');
    if (!root) return;

    collectTextNodes(root).forEach((node) => {
      const record = nodeTranslations.get(node);
      if (record?.targetLanguage === TARGET_LANGUAGE && node.nodeValue === record.translated) {
        node.nodeValue = record.original;
      }
      nodeTranslations.delete(node);
    });

    [root, ...Array.from(root.querySelectorAll('*'))].forEach((element) => {
      const records = attributeTranslations.get(element);
      if (!records) return;

      TRANSLATABLE_ATTRIBUTES.forEach((attribute) => {
        const record = records.get(attribute);
        if (record?.targetLanguage === TARGET_LANGUAGE && element.getAttribute(attribute) === record.translated) {
          element.setAttribute(attribute, record.original);
        }
        records.delete(attribute);
      });
    });
  }, []);

  const translateNow = useCallback(async () => {
    if (!enableRuntimeTranslation || languageRef.current !== TARGET_LANGUAGE) {
      restoreDutch();
      return;
    }

    const root = document.getElementById('root');
    if (!root) return;

    const targets = collectTranslationTargets(root);
    const uncached = new Set<string>();

    targets.forEach(({ original }) => {
      if (!cacheRef.current[cacheKey(original, TARGET_LANGUAGE)]) {
        uncached.add(original);
      }
    });

    targets.forEach((target) => {
      const { original } = target;
      const translated = cacheRef.current[cacheKey(original, TARGET_LANGUAGE)];
      if (!translated) return;
      applyTranslation(target, translated);
    });

    const texts = Array.from(uncached).slice(0, MAX_BATCH_ITEMS);
    if (texts.length === 0) return;

    setIsTranslating(true);
    const { data, error } = await supabase.functions.invoke('translate-platform', {
      body: {
        source_lang: 'NL',
        target_lang: 'EN-US',
        texts,
      },
    });
    setIsTranslating(false);

    if (error || !Array.isArray(data?.translations)) return;

    data.translations.forEach((item: { source?: string; text?: string }) => {
      if (item.source && item.text) {
        cacheRef.current[cacheKey(item.source, TARGET_LANGUAGE)] = item.text;
      }
    });
    writeCache(cacheRef.current);

    targets.forEach((target) => {
      const { original } = target;
      const translated = cacheRef.current[cacheKey(original, TARGET_LANGUAGE)];
      if (!translated) return;
      applyTranslation(target, translated);
    });

    if (uncached.size > MAX_BATCH_ITEMS && languageRef.current === TARGET_LANGUAGE) {
      window.setTimeout(translateNow, 200);
    }
  }, [enableRuntimeTranslation, restoreDutch]);

  const scheduleTranslation = useCallback(() => {
    window.clearTimeout(pendingTimerRef.current);
    pendingTimerRef.current = window.setTimeout(translateNow, 120);
  }, [translateNow]);

  useEffect(() => {
    scheduleTranslation();
  }, [language, scheduleTranslation]);

  useEffect(() => {
    const root = document.getElementById('root');
    if (!root) return;

    mutationObserverRef.current = new MutationObserver(() => {
      if (languageRef.current === TARGET_LANGUAGE) scheduleTranslation();
    });
    mutationObserverRef.current.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => {
      mutationObserverRef.current?.disconnect();
      window.clearTimeout(pendingTimerRef.current);
    };
  }, [scheduleTranslation]);

  const setLanguage = useCallback((nextLanguage: PlatformLanguage) => {
    const normalized = normalizeLanguage(nextLanguage);
    setLanguageState(normalized);
    onLanguageChangeRef.current?.(normalized);
  }, []);

  const toggleLanguage = useCallback(() => {
    setLanguageState((current) => {
      const nextLanguage = current === TARGET_LANGUAGE ? SOURCE_LANGUAGE : TARGET_LANGUAGE;
      onLanguageChangeRef.current?.(nextLanguage);
      return nextLanguage;
    });
  }, []);

  const value = useMemo(
    () => ({ language, isTranslating, setLanguage, toggleLanguage }),
    [isTranslating, language, setLanguage, toggleLanguage],
  );

  return <TranslationContext.Provider value={value}>{children}</TranslationContext.Provider>;
}
