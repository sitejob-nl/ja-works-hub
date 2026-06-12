interface CvSections {
  summary: string;
  experience: string;
  skills: string;
  education: string;
  languages: string;
  certifications: string;
}

interface CvTemplateProps {
  candidate: any;
  sections: CvSections;
  anonymous: boolean;
  language: string;
  orgLogo?: string | null;
  orgName: string;
  visibleSections: Record<string, boolean>;
}

const sectionLabels: Record<string, Record<string, string>> = {
  nl: { summary: 'Profiel', experience: 'Werkervaring', skills: 'Vaardigheden', education: 'Opleiding', languages: 'Talen', certifications: 'Certificaten' },
  en: { summary: 'Profile', experience: 'Experience', skills: 'Skills', education: 'Education', languages: 'Languages', certifications: 'Certifications' },
  pl: { summary: 'Profil', experience: 'Doświadczenie', skills: 'Umiejętności', education: 'Wykształcenie', languages: 'Języki', certifications: 'Certyfikaty' },
};

const CvTemplate = ({ candidate, sections, anonymous, language, orgLogo, orgName, visibleSections }: CvTemplateProps) => {
  const labels = sectionLabels[language] || sectionLabels.nl;
  const displayName = anonymous
    ? `Kandidaat ${candidate.id?.substring(0, 6)?.toUpperCase() || 'REF'}`
    : `${candidate.first_name} ${candidate.last_name}`;

  const renderSection = (key: keyof CvSections, label: string) => {
    if (!visibleSections[key] || !sections[key]) return null;
    return (
      <div key={key} className="mb-6">
        <h2 className="text-base font-semibold text-stat-blue border-b border-primary/20 pb-1 mb-2 uppercase tracking-wide">{label}</h2>
        <div className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{sections[key]}</div>
      </div>
    );
  };

  return (
    <div className="cv-template bg-card border border-border rounded-lg shadow-sm p-8 max-w-[210mm] mx-auto print:shadow-none print:border-0 print:rounded-none print:p-0">
      {/* Header */}
      <div className="flex items-start justify-between mb-8 pb-4 border-b-2 border-primary">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{displayName}</h1>
          {!anonymous && (
            <div className="text-sm text-muted-foreground mt-1 space-y-0.5">
              {candidate.email && <p>{candidate.email}</p>}
              {candidate.phone && <p>{candidate.phone}</p>}
              {candidate.address_city && <p>{candidate.address_city}{candidate.nationality ? ` • ${candidate.nationality}` : ''}</p>}
            </div>
          )}
          {anonymous && candidate.nationality && (
            <p className="text-sm text-muted-foreground mt-1">{candidate.nationality}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          {orgLogo ? (
            <img src={orgLogo} alt={orgName} className="h-10 object-contain" />
          ) : (
            <span className="text-sm font-semibold text-stat-blue">{orgName}</span>
          )}
        </div>
      </div>

      {/* Sections */}
      {renderSection('summary', labels.summary)}
      {renderSection('experience', labels.experience)}
      {renderSection('skills', labels.skills)}
      {renderSection('education', labels.education)}
      {renderSection('languages', labels.languages)}
      {renderSection('certifications', labels.certifications)}

      {/* Footer */}
      <div className="mt-8 pt-4 border-t border-border text-xs text-muted-foreground text-center print:mt-auto">
        {anonymous ? 'Vertrouwelijk document' : ''} • Gegenereerd door {orgName}
      </div>
    </div>
  );
};

export default CvTemplate;
