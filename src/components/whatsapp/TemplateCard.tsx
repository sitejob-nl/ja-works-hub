import { Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

interface TemplateCardProps {
  template: {
    id: string;
    template_name: string;
    language: string;
    category: string;
    status: string;
    components: any[];
  };
  onDelete: (name: string, id: string) => void;
}

function extractBodyText(components: any[]): string {
  const body = components?.find((c: any) => c.type === 'BODY');
  return body?.text ?? '';
}

const LANGUAGE_LABELS: Record<string, string> = {
  nl: 'NL',
  en: 'EN',
  en_US: 'EN',
  pl: 'PL',
  ro: 'RO',
  de: 'DE',
  fr: 'FR',
  es: 'ES',
  pt: 'PT',
  pt_PT: 'PT',
  pt_BR: 'BR',
  uk: 'UK',
  ru: 'RU',
};

function getCategoryBadgeClass(category: string): string {
  switch (category?.toUpperCase()) {
    case 'MARKETING':
      return 'bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300';
    case 'UTILITY':
      return 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300';
    case 'AUTHENTICATION':
      return 'bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300';
    default:
      return '';
  }
}

function getStatusBadgeClass(status: string): string {
  switch (status?.toUpperCase()) {
    case 'APPROVED':
      return 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300';
    case 'PENDING':
      return 'bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-300';
    case 'REJECTED':
      return 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300';
    default:
      return '';
  }
}

function getStatusLabel(status: string): string {
  switch (status?.toUpperCase()) {
    case 'APPROVED':
      return 'Goedgekeurd';
    case 'PENDING':
      return 'In afwachting';
    case 'REJECTED':
      return 'Afgewezen';
    default:
      return status;
  }
}

function getCategoryLabel(category: string): string {
  switch (category?.toUpperCase()) {
    case 'MARKETING':
      return 'Marketing';
    case 'UTILITY':
      return 'Utility';
    case 'AUTHENTICATION':
      return 'Authenticatie';
    default:
      return category;
  }
}

export function TemplateCard({ template, onDelete }: TemplateCardProps) {
  const bodyText = extractBodyText(template.components);
  const langLabel = LANGUAGE_LABELS[template.language] ?? template.language?.toUpperCase();

  return (
    <Card className="relative group">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-start justify-between gap-2">
          <p className="font-semibold text-sm leading-tight break-all">{template.template_name}</p>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Template verwijderen?</AlertDialogTitle>
                <AlertDialogDescription>
                  Weet je zeker dat je template <strong>{template.template_name}</strong> wilt
                  verwijderen? Dit verwijdert de template ook bij Meta. Dit kan niet ongedaan worden
                  gemaakt.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Annuleren</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={() => onDelete(template.template_name, template.id)}
                >
                  Verwijderen
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        <div className="flex flex-wrap gap-1.5 mt-1">
          <Badge variant="outline" className="text-xs px-1.5 py-0">
            {langLabel}
          </Badge>
          <Badge
            variant="outline"
            className={`text-xs px-1.5 py-0 ${getCategoryBadgeClass(template.category)}`}
          >
            {getCategoryLabel(template.category)}
          </Badge>
          <Badge
            variant="outline"
            className={`text-xs px-1.5 py-0 ${getStatusBadgeClass(template.status)}`}
          >
            {getStatusLabel(template.status)}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="px-4 pb-4">
        {bodyText ? (
          <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">{bodyText}</p>
        ) : (
          <p className="text-sm text-muted-foreground italic">Geen bodytekst</p>
        )}
      </CardContent>
    </Card>
  );
}
