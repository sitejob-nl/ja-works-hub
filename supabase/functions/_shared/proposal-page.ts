export const PROPOSAL_PAGE_SECTION_KEYS = [
  "summary",
  "skills",
  "certifications",
  "languages",
  "targetFunctions",
  "availability",
  "positiveSignals",
  "riskFactors",
  "history",
  "cv",
  "contact",
] as const;

export type ProposalPageSectionKey = typeof PROPOSAL_PAGE_SECTION_KEYS[number];

export type ProposalPageConfig = {
  title: string;
  intro: string;
  sections: Record<ProposalPageSectionKey, boolean>;
  content: Record<ProposalPageSectionKey, { title: string; body: string }>;
};

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

// De matcher-reasoning (matching-core) begint altijd met "N% match" en is intern
// jargon ("Blokkers: …") dat nooit op de klantpagina of in de voorstelmail hoort.
export function isInternalMatchReasoning(value: unknown): boolean {
  return typeof value === "string" && /^\s*\d{1,3}%\s+match\b/i.test(value);
}

export function clientSafeSummary(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || isInternalMatchReasoning(trimmed)) return null;
  return trimmed;
}

function joinDutch(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} en ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} en ${items[items.length - 1]}`;
}

function stringList(value: unknown, max: number): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, max)
    : [];
}

/**
 * Neutrale, klantvriendelijke kandidaat-intro op basis van profielvelden.
 * Spiegel van buildSummary in src/pages/MatchResponse.tsx.
 */
export function buildClientSummary(candidate: Record<string, any>, candidateName: string): string {
  const firstName = candidateName.split(/\s+/)[0] || "Deze kandidaat";
  const sentences: string[] = [];
  const role = candidate.most_recent_role || candidate.ai_function_group || candidate.ai_classification;
  const skills = stringList(candidate.skills, 4);
  const certs = stringList(candidate.certifications, 3);
  const languages = stringList(candidate.languages, 3);

  if (role && skills.length > 0) {
    sentences.push(`${firstName} is een ${role}-profiel met ervaring in ${joinDutch(skills)}.`);
  } else if (role) {
    sentences.push(`${firstName} past binnen het profiel ${role}.`);
  } else if (skills.length > 0) {
    sentences.push(`${firstName} heeft relevante ervaring met ${joinDutch(skills)}.`);
  }

  if (certs.length > 0) sentences.push(`Bekende certificaten: ${joinDutch(certs)}.`);
  if (languages.length > 0) sentences.push(`Talen: ${joinDutch(languages)}.`);
  const location = [
    candidate.address_city ? `regio ${candidate.address_city}` : null,
    candidate.has_drivers_license ? "rijbewijs aanwezig" : null,
  ].filter(Boolean).join("; ");
  if (location) sentences.push(`${location.charAt(0).toUpperCase()}${location.slice(1)}.`);

  return sentences.join(" ");
}

export function resolvePublicProposalPage(snapshotValue: unknown): {
  proposalPage: Record<string, unknown>;
  sections: Record<string, unknown>;
  sectionEnabled: (key: ProposalPageSectionKey) => boolean;
} {
  const snapshot = asRecord(snapshotValue);
  const rawProposalPage = asRecord(snapshot.proposal_page);
  const hasConfiguredPage = Object.keys(rawProposalPage).length > 0;
  const legacySections = asRecord(snapshot.sections);
  const configuredSections = asRecord(rawProposalPage.sections);
  const sections = Object.keys(configuredSections).length > 0 ? configuredSections : legacySections;
  const sectionEnabled = (key: ProposalPageSectionKey) =>
    (hasConfiguredPage ? sections[key] === true : sections[key] !== false) && legacySections.hideReport !== true;
  const rawContent = asRecord(rawProposalPage.content);

  const proposalPage = hasConfiguredPage
    ? {
      title: typeof rawProposalPage.title === "string" ? rawProposalPage.title : "Kandidaatvoorstel",
      intro: typeof rawProposalPage.intro === "string" ? rawProposalPage.intro : "",
      sections,
      content: Object.fromEntries(
        PROPOSAL_PAGE_SECTION_KEYS
          .filter((key) => sectionEnabled(key))
          .map((key) => [key, asRecord(rawContent[key])]),
      ),
    }
    : {};

  return { proposalPage, sections, sectionEnabled };
}
