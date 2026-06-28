import { Card, CardContent } from '@/components/ui/card';

export const KpiCard = ({ label, value, variant = 'default' }: { label: string; value: string; variant?: 'default' | 'danger' }) => (
  <Card className={variant === 'danger' ? 'border-destructive bg-destructive/5' : ''}>
    <CardContent className="pt-5 pb-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${variant === 'danger' ? 'text-destructive' : ''}`}>{value}</p>
    </CardContent>
  </Card>
);
