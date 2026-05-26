import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

export const useTabSearchParam = (defaultTab: string) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || defaultTab;

  const setActiveTab = useCallback((tab: string) => {
    const next = new URLSearchParams(searchParams);
    if (tab === defaultTab) {
      next.delete('tab');
    } else {
      next.set('tab', tab);
    }
    setSearchParams(next, { replace: true });
  }, [defaultTab, searchParams, setSearchParams]);

  return [activeTab, setActiveTab] as const;
};
