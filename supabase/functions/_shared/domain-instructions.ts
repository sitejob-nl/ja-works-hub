/**
 * DNS-instructies voor een organisatiedomein: welke records (of nameservers) moeten
 * worden gezet, en de platte-tekstvariant daarvan.
 *
 * Apart van `domain-management/index.ts` zodat deze logica unit-getest kan worden. Een
 * fout hier is stil: de instructies gaan per mail naar een externe DNS-beheerder, en een
 * verkeerd record levert geen foutmelding op — alleen een domein dat nooit gaat werken.
 */

export type DomainType = "exact" | "wildcard";

export type DnsRecord = {
  type?: string;
  name?: string;
  value?: string;
  purpose?: string;
};

export type DomainInstructions = {
  kind: DomainType;
  records: DnsRecord[];
  nameservers?: string[];
  verification: unknown[];
  warning?: string;
};

type VercelProjectDomain = { verification?: unknown[] } & Record<string, unknown>;

/** Fallback wanneer Vercel geen `intendedNameservers` meegeeft (gedocumenteerde standaard). */
export const DEFAULT_VERCEL_NAMESERVERS = ["ns1.vercel-dns.com", "ns2.vercel-dns.com"];

export function dnsInstructions(
  domain: string,
  domainType: DomainType,
  primaryHostname: string,
  projectDomain: VercelProjectDomain | null,
  dnsConfig?: Record<string, unknown> | null,
) {
  const verification = Array.isArray(projectDomain?.verification) ? projectDomain?.verification : [];
  const base = domain.replace(/^\*\./, "");

  // Een wildcard-certificaat kan alléén via de nameserver-methode: Vercel moet DNS-controle
  // over de zone hebben. CNAME-records volstaan hier niet — met alleen een CNAME komt er
  // nooit een certificaat en blijft het domein onbereikbaar. Daarom geen zone-records maar
  // nameservers, die bij de registrar worden gewijzigd en niet in de zone zelf.
  if (domainType === "wildcard") {
    const intended = Array.isArray(dnsConfig?.intendedNameservers) ? dnsConfig?.intendedNameservers : null;
    const nameservers = (intended?.length ? intended : DEFAULT_VERCEL_NAMESERVERS).map(String);

    return {
      kind: "wildcard",
      records: [],
      nameservers,
      verification,
      warning:
        "Een wildcard vereist dat de nameservers van het domein naar Vercel wijzen; met losse " +
        "CNAME-records wordt er nooit een wildcard-certificaat uitgegeven. Let op: bij een " +
        "nameserver-wijziging vervalt de huidige DNS-zone volledig. Alle bestaande records " +
        "(MX en SPF/DKIM/DMARC voor e-mail, bestaande subdomeinen, verificatie-records) moeten " +
        "eerst in Vercel DNS worden aangemaakt, anders valt e-mail uit zodra de wijziging " +
        "doorwerkt. Wil je alleen één app-adres, kies dan een exact (sub)domein — dat vraagt " +
        "één CNAME en laat de rest van de zone ongemoeid.",
    };
  }

  const isSubdomain = domain.split(".").length > 2;
  return {
    kind: "exact",
    records: isSubdomain
      ? [{ type: "CNAME", name: domain, value: "cname.vercel-dns.com", purpose: "Route dit subdomein naar Vercel" }]
      : [{ type: "A", name: "@", value: "76.76.21.21", purpose: "Route apex-domein naar Vercel" }],
    verification,
  };
}


/**
 * Platte-tekstversie van dezelfde instructies. Bedoeld om te kopiëren naar een ticket,
 * WhatsApp of Teams — kanalen waar de HTML-mail niet past maar de developer wél zit.
 */
export function buildInstructionText(row: any, orgName: string): string {
  const instructions = row.dns_config?.instructions ?? {};
  const records: DnsRecord[] = Array.isArray(instructions.records) ? instructions.records : [];
  const verification: DnsRecord[] = Array.isArray(instructions.verification) ? instructions.verification : [];
  const nameservers: string[] = Array.isArray(instructions.nameservers) ? instructions.nameservers : [];
  const isWildcard = row.domain_type === "wildcard";
  const zone = row.apex_domain || row.domain;

  const lines: string[] = [
    `DNS-instelling voor ${row.domain}`,
    "",
    `${orgName} gaat de software gebruiken op ${row.primary_hostname}.`,
  ];

  if (isWildcard) {
    lines.push(
      `Omdat het om een wildcard gaat, moeten de nameservers van ${zone} naar Vercel wijzen.`,
      "Dat is de enige manier waarop een wildcard-certificaat kan worden uitgegeven.",
      "",
      "Nameservers (te wijzigen bij de registrar, niet in de zone zelf):",
      "",
    );
    nameservers.forEach((ns) => lines.push(`   ${ns}`));
    lines.push(
      "",
      "BELANGRIJK: bij een nameserver-wijziging vervalt de huidige DNS-zone volledig.",
      "Alle bestaande records moeten eerst in Vercel DNS staan — MX plus SPF, DKIM en",
      "DMARC voor e-mail, bestaande subdomeinen en verificatie-records. Ontbreken die",
      "op het moment dat de wijziging doorwerkt, dan valt e-mail op dit domein uit.",
      "",
      "Een bevestiging is genoeg — daarna controleren wij de koppeling.",
    );
    if (instructions.warning) lines.push("", `Let op: ${instructions.warning}`);
    return lines.join("\n");
  }

  lines.push(
    `Daarvoor moet in de DNS-zone van ${zone} het volgende worden toegevoegd:`,
    "",
  );

  const renderRecords = (list: DnsRecord[]) => {
    list.forEach((record, index) => {
      lines.push(`${list.length > 1 ? `${index + 1}. ` : ""}${record.type ?? "RECORD"}-record`);
      lines.push(`   Naam:   ${record.name ?? ""}`);
      lines.push(`   Waarde: ${record.value ?? ""}`);
      lines.push(`   TTL:    standaard (of 3600)`);
      if (record.purpose) lines.push(`   Doel:   ${record.purpose}`);
      lines.push("");
    });
  };

  renderRecords(records);

  if (verification.length) {
    lines.push("Extra verificatie-record(s) om het eigendom van het domein te bevestigen:", "");
    renderRecords(verification);
  }

  lines.push(
    "Let op: staat het domein achter een proxy of CDN (bij Cloudflare de oranje wolk),",
    "zet die dan uit voor deze hostname — het verkeer moet rechtstreeks doorgezet worden.",
    "",
    "Bestaande records voor de website en e-mail van dit domein blijven ongewijzigd.",
    "Het TLS-certificaat wordt automatisch aangevraagd zodra de records actief zijn;",
    "er hoeft niets geïnstalleerd of geconfigureerd te worden op een server.",
    "",
    "Een bevestiging dat de records staan is genoeg — daarna controleren wij de koppeling.",
  );

  if (instructions.warning) lines.push("", `Let op: ${instructions.warning}`);

  return lines.join("\n");
}

