// Markdown-resten uit AI-output halen, server-side.
//
// De vacaturegenerator krijgt de instructie dat alleen `body_markdown` markdown mag zijn,
// maar een taalmodel doet er alsnog **vet** of een #-kop tussen. Dat komt letterlijk in beeld
// bij de kandidaat (portaal, voorstel) en de opdrachtgever. Daarom strippen we het bij het
// opslaan, niet pas bij het tonen — dan is de opgeslagen tekst zelf al schoon.
//
// Deno-tegenhanger van src/lib/rich-text.ts (zelfde regels), net als bij profile-validation:
// frontend en edge houden hun eigen kopie omdat de bundlers verschillen.

const stripInline = (line: string): string =>
  line
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*\*(.+?)\*\*\*/g, "$1")
    .replace(/___(.+?)___/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/(^|[\s(])\*(?!\s)(.+?)(?<!\s)\*/g, "$1$2")
    .replace(/(^|[\s(])_(?!\s)(.+?)(?<!\s)_/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .trim();

const isHeading = (line: string) => /^#{1,6}\s+/.test(line);
const headingText = (line: string) => stripInline(line.replace(/^#{1,6}\s+/, "").replace(/\s*#+\s*$/, ""));
const isBullet = (line: string) => /^\s*([-*+•]|\d+[.)])\s+/.test(line);
const bulletText = (line: string) => stripInline(line.replace(/^\s*([-*+•]|\d+[.)])\s+/, ""));

/**
 * Haalt markdown-tekens uit een veld dat platte tekst hoort te zijn. Regelindeling blijft
 * staan; een kop wordt een gewone regel, een bullet krijgt "• ".
 */
export function stripMarkdownInline(input: unknown): string {
  const text = typeof input === "string" ? input.replace(/\r\n/g, "\n") : "";
  if (!text.trim()) return "";
  return text
    .split("\n")
    .map((line) => {
      if (isHeading(line)) return headingText(line);
      if (isBullet(line)) return `• ${bulletText(line)}`;
      return stripInline(line);
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
