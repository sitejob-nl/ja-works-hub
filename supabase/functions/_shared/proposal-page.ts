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
