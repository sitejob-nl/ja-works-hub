/** Chart/HSL colors for termination type categories */
export const TYPE_COLORS: Record<string, string> = {
  opdrachtgever: 'hsl(25, 95%, 53%)',
  medewerker: 'hsl(197, 100%, 60%)',
  uitzendbureau: 'hsl(262, 83%, 58%)',
};

/** Dutch labels for termination type categories */
export const TYPE_LABELS: Record<string, string> = {
  opdrachtgever: 'Opdrachtgever',
  medewerker: 'Medewerker',
  uitzendbureau: 'Uitzendbureau',
};

/** Tailwind badge colors for termination type categories */
export const TYPE_BADGE_COLORS: Record<string, string> = {
  opdrachtgever: 'bg-stat-orange/10 text-stat-orange',
  medewerker: 'bg-stat-blue/10 text-stat-blue',
  uitzendbureau: 'bg-stat-purple/10 text-stat-purple',
};
