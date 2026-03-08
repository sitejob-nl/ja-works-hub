import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sparkles, Download, Eye, EyeOff } from 'lucide-react';

interface CvSettingsPanelProps {
  language: string;
  onLanguageChange: (lang: string) => void;
  anonymous: boolean;
  onAnonymousChange: (val: boolean) => void;
  visibleSections: Record<string, boolean>;
  onToggleSection: (key: string) => void;
  onRewrite: () => void;
  onDownload: () => void;
  isRewriting: boolean;
  hasSections: boolean;
}

const sectionNames: Record<string, string> = {
  summary: 'Profiel / Samenvatting',
  experience: 'Werkervaring',
  skills: 'Vaardigheden',
  education: 'Opleiding',
  languages: 'Talen',
  certifications: 'Certificaten',
};

const CvSettingsPanel = ({
  language, onLanguageChange,
  anonymous, onAnonymousChange,
  visibleSections, onToggleSection,
  onRewrite, onDownload,
  isRewriting, hasSections,
}: CvSettingsPanelProps) => {
  return (
    <div className="space-y-6">
      {/* Language */}
      <div>
        <Label className="text-xs text-muted-foreground uppercase tracking-wide">Taal</Label>
        <Select value={language} onValueChange={onLanguageChange}>
          <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="nl">Nederlands</SelectItem>
            <SelectItem value="en">English</SelectItem>
            <SelectItem value="pl">Polski</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Anonymous */}
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm">Anoniem CV</Label>
          <p className="text-xs text-muted-foreground">Verberg naam en contactgegevens</p>
        </div>
        <Switch checked={anonymous} onCheckedChange={onAnonymousChange} />
      </div>

      {/* AI Rewrite */}
      <Button onClick={onRewrite} disabled={isRewriting} className="w-full gap-2">
        <Sparkles className="h-4 w-4" />
        {isRewriting ? 'AI herschrijft...' : 'AI Herschrijven'}
      </Button>

      {/* Section visibility */}
      {hasSections && (
        <div>
          <Label className="text-xs text-muted-foreground uppercase tracking-wide mb-2 block">Secties</Label>
          <div className="space-y-2">
            {Object.entries(sectionNames).map(([key, label]) => (
              <button
                key={key}
                onClick={() => onToggleSection(key)}
                className="flex items-center justify-between w-full text-sm px-3 py-2 rounded-md hover:bg-muted transition-colors"
              >
                <span>{label}</span>
                {visibleSections[key] ? (
                  <Eye className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <EyeOff className="h-4 w-4 text-muted-foreground/40" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Download */}
      {hasSections && (
        <Button variant="outline" onClick={onDownload} className="w-full gap-2">
          <Download className="h-4 w-4" /> Download PDF
        </Button>
      )}
    </div>
  );
};

export default CvSettingsPanel;
