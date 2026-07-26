import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { TranslationContext, type PlatformLanguage } from '@/contexts/translation-context';
import { SOURCE_LANGUAGE, normalizeLanguage } from '@/lib/platform-languages';
import { UI_DICTIONARY_EN } from '@/lib/ui-dictionary';

interface TranslationRecord {
  original: string;
  translated: string;
  targetLanguage: PlatformLanguage;
}

const STORAGE_KEY = 'jawerkt-platform-language';
const MAX_TEXT_LENGTH = 900;
const TRANSLATABLE_ATTRIBUTES = ['placeholder', 'title', 'aria-label'] as const;

/** Per doeltaal één woordenboek. Nederlands is de bron en heeft er dus geen. */
const DICTIONARIES: Record<Exclude<PlatformLanguage, 'nl'>, Record<string, string>> = {
  en: UI_DICTIONARY_EN,
};

const nodeTranslations = new WeakMap<Text, TranslationRecord>();
const attributeTranslations = new WeakMap<Element, Map<string, TranslationRecord>>();

type TranslationTarget =
  | { type: 'text'; node: Text; original: string }
  | { type: 'attribute'; element: Element; attribute: string; original: string };

function readInitialLanguage(): PlatformLanguage {
  if (typeof window === 'undefined') return SOURCE_LANGUAGE;
  return normalizeLanguage(window.localStorage.getItem(STORAGE_KEY));
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

function getAttributeRecord(element: Element, attribute: string): TranslationRecord | undefined {
  return attributeTranslations.get(element)?.get(attribute);
}

function setAttributeRecord(element: Element, attribute: string, record: TranslationRecord) {
  const records = attributeTranslations.get(element) ?? new Map<string, TranslationRecord>();
  records.set(attribute, record);
  attributeTranslations.set(element, records);
}

/**
 * De brontekst voor een knoop die mogelijk al vertaald is. Staat de vertaling van een
 * andere taal in de DOM, dan is het Nederlandse origineel de bron — niet wat er nu staat.
 */
function sourceTextFor(current: string, previous: TranslationRecord | undefined): string {
  if (previous && normalizedText(current) === normalizedText(previous.translated)) return previous.original;
  return normalizedText(current);
}

function collectAttributeTargets(root: HTMLElement, targetLanguage: PlatformLanguage): TranslationTarget[] {
  const elements = [root, ...Array.from(root.querySelectorAll('*'))];
  const targets: TranslationTarget[] = [];

  elements.forEach((element) => {
    if (shouldSkipAttributeElement(element)) return;

    TRANSLATABLE_ATTRIBUTES.forEach((attribute) => {
      const current = element.getAttribute(attribute);
      if (!current) return;

      const previous = getAttributeRecord(element, attribute);
      if (previous?.targetLanguage === targetLanguage && current === previous.translated) return;

      const original = sourceTextFor(current, previous);
      if (!isTranslatableText(original)) return;
      targets.push({ type: 'attribute', element, attribute, original });
    });
  });

  return targets;
}

function collectTranslationTargets(root: HTMLElement, targetLanguage: PlatformLanguage): TranslationTarget[] {
  const textTargets = collectTextNodes(root).flatMap<TranslationTarget>((node) => {
    const current = node.nodeValue ?? '';
    const previous = nodeTranslations.get(node);
    if (previous?.targetLanguage === targetLanguage && current === previous.translated) return [];

    const original = sourceTextFor(current, previous);
    if (!isTranslatableText(original)) return [];
    return [{ type: 'text', node, original }];
  });

  return [...textTargets, ...collectAttributeTargets(root, targetLanguage)];
}

function applyTranslation(target: TranslationTarget, translated: string, targetLanguage: PlatformLanguage) {
  if (target.type === 'text') {
    target.node.nodeValue = withOriginalSpacing(target.node.nodeValue ?? '', translated);
    nodeTranslations.set(target.node, { original: target.original, translated, targetLanguage });
    return;
  }

  target.element.setAttribute(target.attribute, translated);
  setAttributeRecord(target.element, target.attribute, {
    original: target.original,
    translated,
    targetLanguage,
  });
}

interface TranslationProviderProps {
  children: ReactNode;
  initialLanguage?: PlatformLanguage | null;
  onLanguageChange?: (language: PlatformLanguage) => void;
  enableRuntimeTranslation?: boolean;
  /**
   * Waar er vertaald mag worden, als CSS-selectors. Standaard de hele app.
   *
   * De portalen tonen bijna uitsluitend eigen gegevens van de ingelogde medewerker en
   * zijn scherm voor scherm nagelopen, dus daar kan de hele boom mee. De recruiter-
   * omgeving staat vol kandidaatnamen, notities en vrije tekst in tabellen; daar wijzen
   * we per gebied aan wat vertaald mag worden, zodat klantdata niet per ongeluk door het
   * woordenboek loopt.
   */
  roots?: string[];
}

const DEFAULT_ROOTS = ['#root'];

function resolveRoots(selectors: string[]): HTMLElement[] {
  return selectors.flatMap((selector) => Array.from(document.querySelectorAll<HTMLElement>(selector)));
}

/**
 * Vertaalt de vaste UI-teksten van het portaal door de DOM langs te lopen en elke
 * tekstknoop op te zoeken in een meegebouwd woordenboek ([[portal-dictionary]]).
 *
 * Bewust een opzoektabel en geen vertaaldienst: wat niet in het woordenboek staat —
 * bedrijfsnamen, vacatureteksten, ingevulde gegevens — blijft onaangeraakt. Er is geen
 * netwerkaanroep, dus ook geen wachttijd, kosten of quotum dat op kan raken.
 */
export function TranslationProvider({
  children,
  initialLanguage,
  onLanguageChange,
  enableRuntimeTranslation = true,
  roots = DEFAULT_ROOTS,
}: TranslationProviderProps) {
  const [language, setLanguageState] = useState<PlatformLanguage>(() => (
    initialLanguage ? normalizeLanguage(initialLanguage) : readInitialLanguage()
  ));
  const languageRef = useRef(language);
  const onLanguageChangeRef = useRef(onLanguageChange);
  const pendingTimerRef = useRef<number | undefined>();
  const mutationObserverRef = useRef<MutationObserver | null>(null);
  // Als ref zodat translateNow niet opnieuw hoeft te worden opgebouwd bij elke render.
  const rootsRef = useRef(roots);
  rootsRef.current = roots;

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

  /** Zet alle vertaalde knopen terug naar het Nederlandse origineel. */
  const restoreSource = useCallback(() => {
    resolveRoots(rootsRef.current).forEach((root) => {
    collectTextNodes(root).forEach((node) => {
      const record = nodeTranslations.get(node);
      if (record && node.nodeValue === record.translated) {
        node.nodeValue = record.original;
      }
      nodeTranslations.delete(node);
    });

    [root, ...Array.from(root.querySelectorAll('*'))].forEach((element) => {
      const records = attributeTranslations.get(element);
      if (!records) return;

      TRANSLATABLE_ATTRIBUTES.forEach((attribute) => {
        const record = records.get(attribute);
        if (record && element.getAttribute(attribute) === record.translated) {
          element.setAttribute(attribute, record.original);
        }
        records.delete(attribute);
      });
    });
    });
  }, []);

  const translateNow = useCallback(() => {
    const targetLanguage = languageRef.current;
    if (!enableRuntimeTranslation || targetLanguage === SOURCE_LANGUAGE) {
      restoreSource();
      return;
    }

    const dictionary = DICTIONARIES[targetLanguage as Exclude<PlatformLanguage, 'nl'>];
    if (!dictionary) return;

    resolveRoots(rootsRef.current).forEach((root) => {
      collectTranslationTargets(root, targetLanguage).forEach((target) => {
        const translated = dictionary[target.original];
        if (!translated) return;
        applyTranslation(target, translated, targetLanguage);
      });
    });
  }, [enableRuntimeTranslation, restoreSource]);

  const scheduleTranslation = useCallback(() => {
    window.clearTimeout(pendingTimerRef.current);
    pendingTimerRef.current = window.setTimeout(translateNow, 60);
  }, [translateNow]);

  useEffect(() => {
    scheduleTranslation();
  }, [language, scheduleTranslation]);

  useEffect(() => {
    // Radix/Shadcn rendert dialogs, menu's, select-lijsten en tooltips als portals
    // direct onder <body>. Observeer daarom de body; rootsRef bepaalt nog steeds
    // strikt welke delen daadwerkelijk vertaald mogen worden.
    const observerRoot = document.body ?? document.getElementById('root');
    if (!observerRoot) return;

    mutationObserverRef.current = new MutationObserver(() => {
      if (languageRef.current !== SOURCE_LANGUAGE) scheduleTranslation();
    });
    mutationObserverRef.current.observe(observerRoot, {
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

  const value = useMemo(() => ({ language, setLanguage }), [language, setLanguage]);

  return <TranslationContext.Provider value={value}>{children}</TranslationContext.Provider>;
}
