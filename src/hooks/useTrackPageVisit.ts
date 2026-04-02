import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useRecentItems, type RecentItemType } from '@/contexts/RecentItemsContext';

interface TrackPageVisitOptions {
  id: string | undefined;
  type: RecentItemType;
  label: string | undefined;
  sublabel?: string;
}

export const useTrackPageVisit = ({ id, type, label, sublabel }: TrackPageVisitOptions) => {
  const { pathname } = useLocation();
  const { addItem } = useRecentItems();

  useEffect(() => {
    if (id && label) {
      addItem({ id, type, label, sublabel, path: pathname });
    }
  }, [id, label]); // eslint-disable-line react-hooks/exhaustive-deps
};
