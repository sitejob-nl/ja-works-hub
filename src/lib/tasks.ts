import { AlertTriangle, ArrowUpCircle, CircleDot, Clock } from 'lucide-react';

export const priorityConfig: Record<string, { label: string; color: string; icon: typeof AlertTriangle; order: number }> = {
  critical: { label: 'Kritiek', color: 'bg-destructive/10 text-destructive border-destructive/20', icon: AlertTriangle, order: 0 },
  high: { label: 'Hoog', color: 'bg-orange-100 text-orange-700 border-orange-200', icon: ArrowUpCircle, order: 1 },
  medium: { label: 'Medium', color: 'bg-yellow-100 text-yellow-700 border-yellow-200', icon: CircleDot, order: 2 },
  low: { label: 'Laag', color: 'bg-muted text-muted-foreground border-border', icon: Clock, order: 3 },
};

export const entityLinks: Record<string, (id: string) => string> = {
  candidate: (id) => `/kandidaten/${id}`,
  kandidaat: (id) => `/kandidaten/${id}`,
  employee: (id) => `/kandidaten/${id}`,
  opdrachtgever: (id) => `/opdrachtgevers/${id}`,
  vacancy: (id) => `/vacatures/${id}`,
  vacature: (id) => `/vacatures/${id}`,
  plaatsing: (id) => `/plaatsingen/${id}`,
};

export const entityTypeLabels: Record<string, string> = {
  kandidaat: 'Kandidaat',
  opdrachtgever: 'Opdrachtgever',
  vacature: 'Vacature',
  plaatsing: 'Plaatsing',
  candidate: 'Kandidaat',
  employee: 'Medewerker',
  vacancy: 'Vacature',
};
