export type ContractTemplateVariable = {
  key: string;
  label: string;
  sample: string;
};

export const CONTRACT_TEMPLATE_VARIABLES = [
  { key: 'first_name', label: 'Voornaam', sample: 'Jan' },
  { key: 'last_name', label: 'Achternaam', sample: 'Jansen' },
  { key: 'employee_name', label: 'Medewerkernaam', sample: 'Jan Jansen' },
  { key: 'employee_number', label: 'Medewerkernummer', sample: 'JA-1024' },
  { key: 'candidate_phone', label: 'Telefoon medewerker', sample: '+31 6 12345678' },
  { key: 'candidate_email', label: 'E-mail medewerker', sample: 'jan.jansen@example.com' },
  { key: 'start_date', label: 'Startdatum', sample: '06-07-2026' },
  { key: 'end_date', label: 'Einddatum', sample: '31-12-2026' },
  { key: 'expected_end_date', label: 'Verwachte einddatum', sample: '31-12-2026' },
  { key: 'function_name', label: 'Functie', sample: 'Productiemedewerker' },
  { key: 'hourly_rate', label: 'Uurtarief medewerker', sample: '€ 15,50' },
  { key: 'client_hourly_rate', label: 'Factuurtarief klant', sample: '€ 23,00' },
  { key: 'overtime_rate', label: 'Overwerktarief', sample: '€ 19,50' },
  { key: 'contract_hours', label: 'Contracturen', sample: '40' },
  { key: 'contract_type', label: 'Contracttype', sample: 'Fase A' },
  { key: 'company_name', label: 'Opdrachtgever', sample: 'Voorbeeld BV' },
  { key: 'company_phone', label: 'Telefoon opdrachtgever', sample: '+31 40 1234567' },
  { key: 'company_email', label: 'E-mail opdrachtgever', sample: 'planning@example.com' },
  { key: 'contact_name', label: 'Contactpersoon opdrachtgever', sample: 'Piet de Vries' },
  { key: 'contact_person_name', label: 'Contactpersoon werkplek', sample: 'Piet de Vries' },
  { key: 'contact_person_phone', label: 'Telefoon contactpersoon', sample: '+31 6 87654321' },
  { key: 'contact_person_email', label: 'E-mail contactpersoon', sample: 'piet@example.com' },
  { key: 'work_location', label: 'Werklocatie', sample: 'Eindhoven' },
  { key: 'work_days', label: 'Werkdagen', sample: 'ma, di, wo, do, vr' },
  { key: 'organization_name', label: 'Organisatie', sample: 'JA Werkt' },
  { key: 'today', label: 'Vandaag', sample: '06-07-2026' },
] as const satisfies readonly ContractTemplateVariable[];

export type ContractTemplateVariableKey = typeof CONTRACT_TEMPLATE_VARIABLES[number]['key'];

export type ContractTemplateRenderValues = Partial<Record<ContractTemplateVariableKey, string | number | null | undefined>>;

const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
const PLACEHOLDER_PATTERNS = [
  /\b(todo|tbd|placeholder|lorem ipsum)\b/i,
  /\[(?:invullen|aanvullen|todo|tbd)[^\]]*\]/i,
];

const VARIABLE_KEYS: ReadonlySet<string> = new Set(CONTRACT_TEMPLATE_VARIABLES.map((variable) => variable.key));
const VARIABLE_LABELS: ReadonlyMap<string, string> = new Map(CONTRACT_TEMPLATE_VARIABLES.map((variable) => [variable.key, variable.label]));

const unique = (values: string[]) => Array.from(new Set(values));

export const contractTemplateVariableToken = (key: string) => `{{${key}}}`;

export const contractTemplateVariableLabel = (key: string) => VARIABLE_LABELS.get(key) ?? key;

export const extractContractTemplateVariables = (content: string | null | undefined) => {
  const matches = Array.from((content ?? '').matchAll(VARIABLE_PATTERN), (match) => match[1]);
  return unique(matches);
};

export const getUnknownContractTemplateVariables = (content: string | null | undefined) =>
  extractContractTemplateVariables(content).filter((key) => !VARIABLE_KEYS.has(key));

export const hasPlaceholderContractTemplateContent = (content: string | null | undefined) =>
  PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(content ?? ''));

export const validateContractTemplateDefinition = (content: string | null | undefined) => {
  const unknownVariables = getUnknownContractTemplateVariables(content);
  const hasPlaceholderContent = hasPlaceholderContractTemplateContent(content);

  return {
    unknownVariables,
    hasPlaceholderContent,
    canActivate: unknownVariables.length === 0 && !hasPlaceholderContent && Boolean((content ?? '').trim()),
  };
};

export const CONTRACT_TEMPLATE_SAMPLE_VALUES = Object.fromEntries(
  CONTRACT_TEMPLATE_VARIABLES.map((variable) => [variable.key, variable.sample]),
) as Record<ContractTemplateVariableKey, string>;

export function renderContractTemplate(content: string, values: ContractTemplateRenderValues) {
  const missingVariables: string[] = [];
  const unknownVariables: string[] = [];

  const rendered = content.replace(VARIABLE_PATTERN, (token, key: string) => {
    if (!VARIABLE_KEYS.has(key)) {
      unknownVariables.push(key);
      return token;
    }

    const value = values[key as ContractTemplateVariableKey];
    const text = value == null ? '' : String(value).trim();
    if (!text) {
      missingVariables.push(key);
      return `[ontbreekt: ${contractTemplateVariableLabel(key)}]`;
    }
    return text;
  });

  return {
    content: rendered,
    missingVariables: unique(missingVariables),
    unknownVariables: unique(unknownVariables),
  };
}
