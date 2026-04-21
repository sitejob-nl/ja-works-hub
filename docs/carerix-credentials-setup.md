# Carerix API-credentials aanmaken — instructies voor Jeroen

Dit is een eenmalige setup die Jeroen (als Carerix admin) moet doen voordat JA Werkt data uit Carerix kan ophalen.

Resultaat: een `client_id` en `client_secret` + de Carerix instance-URL. Deze drie zet je in JA Werkt onder **Instellingen → Carerix Import → Verbinden**.

---

## Stap 1 — Inloggen op Carerix als admin

1. Ga naar jouw Carerix-omgeving (bv. `https://jawerkt.carerix.com`).
2. Log in met een account dat **admin-rechten** heeft op de Maintenance-module.

## Stap 2 — Identity Access openen

1. Klik linksonder op **Maintenance** (tandwiel-icoon, onderaan hoofdmenu).
2. In het Maintenance-menu: kies **Identity Access**.
3. Bovenaan zie je tabs: **Clients**, **Users**, etc. Klik op **Clients**.

## Stap 3 — Nieuwe client aanmaken

1. Klik op de knop **New** (rechtsboven in de clients-tabel).
2. Vul het formulier in:

| Veld | Waarde |
|------|--------|
| **Naam** | `JA Werkt Migratie` |
| **Code** | `urn:jawerkt/migration` |
| **Type** | `Confidential` (heel belangrijk — niet Public!) |
| **Grant type** | `client_credentials` |
| **Default scope** | `urn:cx/cx5Wrapper:data:manage` |
| **Active** | `YES` |

3. **Permissions-sectie:** zet voor elke entiteit (Persons, Companies, Contacts, Publications, Matches, Attachments, ToDos, WorkHistories) **minimaal `all` read access**. Als er een "read-only" preset beschikbaar is, gebruik die.

4. Klik op **Save**.

## Stap 4 — Credentials kopiëren

Na opslaan toont Carerix:

- **Client ID** — korte identifier (bv. `jawerkt-migration-abc123`)
- **Client Secret** — lang token (bv. `xyz_...`)

> **Let op:** de Client Secret wordt meestal **maar één keer** getoond. Kopieer hem direct en bewaar veilig (1Password of noteer ergens tijdelijk). Je kunt hem altijd opnieuw genereren, maar de oude vervalt dan.

Stuur via Signal/encrypted chat naar Kas (kas@sitejob.nl):
- Client ID
- Client Secret
- Je Carerix instance-URL (het domein waarop je inlogt, bv. `https://jawerkt.carerix.com`)

## Stap 5 — Test via Kas

Kas doet een curl-test om te verifiëren dat:
1. De OAuth2 token endpoint reageert
2. De scope klopt
3. De introspection-query het echte GraphQL schema oplevert (nodig om query-namen te verifiëren)

---

## Wat doet JA Werkt met deze credentials?

- **Encrypted opslag** in `carerix_config` tabel (via Supabase Vault — dezelfde beveiliging als BSN/IBAN).
- **Alleen JA Werkt admins** kunnen credentials zien/wijzigen (RLS + rol-check).
- **Alleen read** — we schrijven niets terug naar Carerix.
- **Zelf te ontkoppelen:** in JA Werkt → Instellingen → Carerix Import → Ontkoppelen. Na ontkoppeling zijn de credentials uit onze DB verwijderd.

Als je later op Carerix-kant de client wilt intrekken, kan dat altijd via dezelfde **Identity Access → Clients** pagina: client deactiveren of verwijderen.

---

## Troubleshooting

**Q: Ik zie geen "Identity Access" menu.**  
A: Dan heb je geen admin-rechten. Vraag of iemand met Maintenance-toegang dit voor je doet, of krijg tijdelijk admin-rol.

**Q: De Client Secret ben ik kwijt.**  
A: Ga terug naar **Identity Access → Clients → [JA Werkt Migratie] → Regenerate secret**. De oude wordt ongeldig, stuur de nieuwe direct door.

**Q: Kan ik testen of de credentials werken zonder JA Werkt te openen?**  
A: Ja, Kas doet dit met een curl-commando. Daarna is groen licht om in JA Werkt te verbinden.

**Q: Hoe weet ik zeker dat de scope `urn:cx/cx5Wrapper:data:manage` klopt voor mijn omgeving?**  
A: Standaard is dat de scope voor volledige data-toegang in Carerix 5. Als het bij je afwijkt (bv. `cx6Wrapper` voor Carerix 6) — geef dat door aan Kas, dan passen we het in de app aan.
