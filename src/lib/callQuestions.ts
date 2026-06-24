import type { MatchBreakdown } from '@/lib/matching';

// Zet de (server-side berekende) match-gaten om in concrete vakinhoudelijke belvragen.
// Puur + deterministisch — geen AI, geen kosten. Dit is de gratis basislaag van de hybride
// belscreening; de AI-knop voegt daar rijkere, geformuleerde vragen aan toe.
//
// Bron: match_breakdown.missing (door scoreMatch gevuld met o.a. "Ontbrekende vaardigheden: ..",
// "Ontbrekende certificaten: ..", "Rijbewijs gevraagd ..", "Afstand nog controleren ..",
// "Beschikbaarheid ..") + hardBlocks. Zie supabase/functions/_shared/matching-core.ts.

function valueAfterColon(message: string): string {
  const idx = message.indexOf(':');
  return idx >= 0 ? message.slice(idx + 1).trim() : '';
}

export function deriveCallQuestions(breakdown: MatchBreakdown | null | undefined): string[] {
  if (!breakdown) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (q: string) => {
    const key = q.toLowerCase();
    if (q && !seen.has(key)) {
      seen.add(key);
      out.push(q);
    }
  };

  for (const gap of breakdown.missing ?? []) {
    const lower = gap.toLowerCase();
    if (lower.startsWith('ontbrekende vaardigheden')) {
      const skills = valueAfterColon(gap);
      if (skills) push(`Het CV bevestigt niet: ${skills}. Vraag naar concrete ervaring (waar, hoe lang, welke taken).`);
    } else if (lower.startsWith('ontbrekende certificaten')) {
      const certs = valueAfterColon(gap);
      if (certs) push(`Vereist certificaat ontbreekt: ${certs}. Vraag of de kandidaat dit geldig heeft.`);
    } else if (lower.includes('rijbewijs')) {
      push('Rijbewijs/eigen vervoer is vereist maar niet geregistreerd — vraag welk rijbewijs en of er vervoer is.');
    } else if (lower.includes('afstand')) {
      push('Reisafstand is onbekend — vraag woonplaats/postcode en of reizen naar de werklocatie lukt.');
    } else if (lower.includes('beschikbaar')) {
      push('Beschikbaarheid is onduidelijk — vraag vanaf wanneer en hoeveel uur de kandidaat kan werken.');
    } else {
      // Onbekend gat — toch tonen zodat de recruiter het verifieert.
      push(`Te verifiëren: ${gap}`);
    }
  }

  for (const block of breakdown.hardBlocks ?? []) {
    push(`Aandachtspunt (harde eis): ${block} — bespreek of dit echt een blokker is.`);
  }

  return out;
}
