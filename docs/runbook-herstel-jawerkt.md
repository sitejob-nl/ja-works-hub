# Runbook — herstel JA Werkt

Voor de situatie waarin er data weg is. Genummerde stappen, exacte commando's, en per
stap wat je verwacht te zien. Lees eerst stap 0.

> **Nog niet geoefend.** De backuppijplijn is gebouwd en de onderdelen zijn los getest
> (verbinding, `pg_dump` 17, leesrol), maar er is nog **geen volledige oefen-restore**
> uitgevoerd. Doe die op een rustig moment vóór je hem in het echt nodig hebt — stap 5
> beschrijft precies hoe. Een backup die nooit is teruggezet is een aanname, geen backup.

---

## Stap 0 — kies eerst het juiste herstelpad

Niet elk incident vraagt om deze backup. Bepaal wat er stuk is:

| Situatie | Gebruik dit |
|---|---|
| Per ongeluk rijen verwijderd, project draait verder | **Supabase-dashboard → Database → Backups** (dagelijks, 7 dagen). Sneller en officieel ondersteund. |
| Een tabel of migratie is misgegaan, je weet welke | Herstel gericht uit onze dump (stap 4), niet het hele project. |
| Bestanden weg uit Storage (CV's, contracten) | Onze storage-spiegel (stap 6). Supabase' eigen backups bevatten deze **niet**. |
| Project onbereikbaar / verwijderd / account kwijt | Volledige rebuild uit onze backup (stap 3 t/m 6). |
| Meer dan 7 dagen terug nodig | Onze backup — die bewaart 14 dagelijks / 8 wekelijks / 12 maandelijks. |

**Er is geen PITR op dit project.** Het herstelpunt is dus altijd de laatste nachtelijke
run (04:20 UTC), plus wat Supabase zelf die dag heeft gemaakt.

## Stap 1 — bepaal wat je terugzet

Log in op srv1 en kijk wat er is:

```bash
ssh srv1.sitejob.nl
sudo cat /var/lib/jawerkt-backup/status.json      # laatste run, omvang, exitcode
sudo -E borg list                                  # alle archieven, nieuwste onderaan
```

Verwacht: één regel per dag, naam `jawerkt-<datum>_<tijd>`. Is de nieuwste ouder dan
gisteren, kijk dan eerst in `/var/log/jawerkt-backup.log` waarom de backup niet liep —
je wilt niet halverwege een herstel ontdekken dat je een week terug zit.

De borg-omgevingsvariabelen komen uit de configuratie:

```bash
set -a; sudo cat /var/lib/jawerkt-backup/backup.env > /tmp/be; . /tmp/be; set +a; rm /tmp/be
```

## Stap 2 — haal het archief op

```bash
sudo mkdir -p /var/tmp/herstel && cd /var/tmp/herstel
sudo -E borg extract --progress ::jawerkt-<datum>_<tijd>
```

Verwacht: `var/lib/jawerkt-backup/db/jawerkt-*.dump` (±40-60 MB) en, als de
storage-fase geconfigureerd was, `var/lib/jawerkt-backup/storage/` met de buckets.

Controleer dat de dump leesbaar is vóór je iets anders doet:

```bash
sudo pg_restore --list var/lib/jawerkt-backup/db/jawerkt-*.dump | head -30
```

Verwacht: een lijst met `TABLE DATA public candidates`, `SCHEMA auth`, enzovoort. Krijg
je hier een foutmelding, probeer dan een ouder archief — ga niet door.

## Stap 3 — doel klaarzetten

**Herstel nooit rechtstreeks over een draaiende productiedatabase heen.** Zet eerst een
lege omgeving neer: een nieuw Supabase-project, of lokaal een Postgres 17 om uit te
zoeken wat er precies in de dump zit.

Lokaal op srv1 (voor onderzoek en voor de oefening):

```bash
sudo apt-get install -y postgresql-17
sudo pg_createcluster 17 herstel --port 5433 -- --auth-local=peer
sudo pg_ctlcluster 17 herstel start
sudo -u postgres psql -p 5433 -c "create database jawerkt_herstel"
```

De cluster luistert alleen op localhost en raakt de Ploi-diensten (MySQL) niet.

## Stap 4 — terugzetten

```bash
sudo -u postgres pg_restore -p 5433 -d jawerkt_herstel \
    --no-owner --no-privileges --no-comments \
    -j 4 var/lib/jawerkt-backup/db/jawerkt-*.dump
```

`--no-owner --no-privileges` is nodig omdat de Supabase-rollen (`supabase_admin`,
`authenticator`, `anon`, `service_role`) buiten dat project niet bestaan.

**Fouten die normaal zijn en die je mag negeren:**

- `role "..." does not exist` — de Supabase-rollen; opgelost door `--no-owner`.
- `extension "..." is not available` / `schema "extensions" does not exist` — Supabase-
  extensies zoals `pgsodium`, `pg_graphql`, `supabase_vault`. Die worden bij een nieuw
  project automatisch aangemaakt.
- Fouten op `auth.*`-triggers of RLS-policies die naar ontbrekende rollen verwijzen.

Tel daarna na of de data er echt is:

```bash
sudo -u postgres psql -p 5433 -d jawerkt_herstel -c \
  "select 'kandidaten' as tabel, count(*) from candidates
   union all select 'bedrijven', count(*) from companies
   union all select 'vacatures', count(*) from vacancies
   union all select 'matches', count(*) from matches
   union all select 'plaatsingen', count(*) from placements
   union all select 'uren', count(*) from timesheets
   union all select 'documenten', count(*) from documents"
```

Vergelijk met productie (of met de laatste bekende aantallen). Wijken ze fors af, dan
heb je een ouder archief te pakken dan je dacht.

## Stap 5 — de oefening (doe dit vóórdat het nodig is)

Loop stap 1 t/m 4 één keer helemaal door op een rustig moment, en noteer:

- hoe lang het duurde (dat is de hersteltijd die je de klant kunt beloven);
- welke foutmeldingen langskwamen, zodat je ze in het echt herkent;
- of de aantallen kloppen.

Ruim daarna op:

```bash
sudo pg_ctlcluster 17 herstel stop && sudo pg_dropcluster 17 herstel
sudo rm -rf /var/tmp/herstel
```

## Stap 6 — bestanden terugzetten

De storage-spiegel is een gewone mappenstructuur per bucket. Terugzetten naar een
(nieuw) Supabase-project:

```bash
rclone copy var/lib/jawerkt-backup/storage/documents sb:documents --progress
```

Per ongeluk gewiste bestanden staan tot 30 dagen in
`/var/lib/jawerkt-backup/storage-verwijderd/<datum>/` — daar kun je één bestand
uithalen zonder een volledige restore te doen.

> De rijen in `storage.objects` (de metadata) komen uit de databasedump, de bytes uit
> deze spiegel. Zet ze **allebei** terug, anders wijst de applicatie naar bestanden die
> er niet zijn, of andersom.

## Wat je hiermee níét terugkrijgt

- **BSN en IBAN blijven onleesbaar.** Die kolommen zijn versleuteld met Supabase Vault.
  De sleutels leven in het `vault`-schema van het oorspronkelijke project en gaan
  bewust **niet** mee in de backup. Herstel je in hetzelfde project, dan werkt het;
  herstel je in een nieuw project, dan staat daar ciphertext die niemand kan
  ontsleutelen — die gegevens moeten dan opnieuw worden uitgevraagd.
  Dit is een expliciete afweging: sleutels meenemen zou betekenen dat één gelekte
  backup genoeg is om alle BSN's te ontsleutelen.
- **Edge functions, secrets en cron-jobs.** Die zitten niet in een databasedump.
  Functies staan in de repo (`supabase/functions/`) en worden opnieuw gedeployd; de
  cron-jobs staan in `supabase/migrations/`; de secrets moeten handmatig opnieuw gezet.
- **Auth-sessies.** Gebruikers moeten opnieuw inloggen. De accounts zelf zitten in het
  `auth`-schema en komen wel terug.
- **Alles van ná de laatste nachtelijke run.** Zonder PITR is dat maximaal 24 uur.

## Als de backup zelf het probleem is

- **Passphrase kwijt** → de borg-repo is onherstelbaar. Bewaar
  `/var/lib/jawerkt-backup/.borg-passphrase` óók in de wachtwoordmanager.
- **Storage Box onbereikbaar** → controleer de SSH-sleutel
  `/root/.ssh/id_ed25519_storagebox` en of het Hetzner-account nog actief is. De
  srv1-backup gebruikt dezelfde route; faalt die ook, dan is het de Storage Box.
- **`borg check`** verifieert de integriteit van de repo; draai die na een verdacht
  incident, maar niet routinematig (het leest alles).
