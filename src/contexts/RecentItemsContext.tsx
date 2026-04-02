import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { useOrganizationId } from '@/hooks/useOrganizationId';

export type RecentItemType = 'kandidaat' | 'opdrachtgever' | 'medewerker' | 'vacature' | 'plaatsing';

export interface RecentItem {
  id: string;
  type: RecentItemType;
  label: string;
  sublabel?: string;
  path: string;
  visitedAt: string;
}

interface RecentItemsContextValue {
  items: RecentItem[];
  addItem: (item: Omit<RecentItem, 'visitedAt'>) => void;
  removeItem: (id: string, type: RecentItemType) => void;
  clearItems: () => void;
}

const MAX_ITEMS = 15;

const RecentItemsContext = createContext<RecentItemsContextValue | null>(null);

function getStorageKey(orgId: string) {
  return `recent-items-${orgId}`;
}

function loadItems(orgId: string): RecentItem[] {
  try {
    const raw = localStorage.getItem(getStorageKey(orgId));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveItems(orgId: string, items: RecentItem[]) {
  localStorage.setItem(getStorageKey(orgId), JSON.stringify(items));
}

export const RecentItemsProvider = ({ children }: { children: ReactNode }) => {
  const orgId = useOrganizationId();
  const [items, setItems] = useState<RecentItem[]>(() => loadItems(orgId));

  // Sync when orgId changes
  useEffect(() => {
    setItems(loadItems(orgId));
  }, [orgId]);

  const addItem = useCallback((item: Omit<RecentItem, 'visitedAt'>) => {
    setItems(prev => {
      const filtered = prev.filter(i => !(i.id === item.id && i.type === item.type));
      const next = [{ ...item, visitedAt: new Date().toISOString() }, ...filtered].slice(0, MAX_ITEMS);
      saveItems(orgId, next);
      return next;
    });
  }, [orgId]);

  const removeItem = useCallback((id: string, type: RecentItemType) => {
    setItems(prev => {
      const next = prev.filter(i => !(i.id === id && i.type === type));
      saveItems(orgId, next);
      return next;
    });
  }, [orgId]);

  const clearItems = useCallback(() => {
    setItems([]);
    saveItems(orgId, []);
  }, [orgId]);

  return (
    <RecentItemsContext.Provider value={{ items, addItem, removeItem, clearItems }}>
      {children}
    </RecentItemsContext.Provider>
  );
};

export const useRecentItems = () => {
  const ctx = useContext(RecentItemsContext);
  if (!ctx) throw new Error('useRecentItems must be used within RecentItemsProvider');
  return ctx;
};
