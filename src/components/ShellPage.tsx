import { LucideIcon } from 'lucide-react';

interface ShellPageProps {
  title: string;
  subtitle: string;
  icon: LucideIcon;
}

const ShellPage = ({ title, subtitle, icon: Icon }: ShellPageProps) => (
  <div>
    <h1 className="text-2xl font-semibold mb-1">{title}</h1>
    <p className="text-sm text-muted-foreground mb-8">{subtitle}</p>
    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
      <Icon className="h-10 w-10 mb-3 opacity-30" />
      <p className="text-sm font-medium">Binnenkort beschikbaar</p>
    </div>
  </div>
);

export default ShellPage;
