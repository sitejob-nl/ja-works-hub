# Backup JA Werkt — installatie op srv1

Dagelijkse backup van de Supabase-database én de Storage-buckets naar de Hetzner
Storage Box, via `srv1.sitejob.nl`. Herstellen: zie
[docs/runbook-herstel-jawerkt.md](../../docs/runbook-herstel-jawerkt.md).

## Waarom dit bestaat

Supabase' eigen dagelijkse backups (Pro-plan, 7 dagen) dekken **alleen de database**.
De bestanden in Storage — CV's, identiteitsbewijzen, contracten — zitten daar
expliciet **niet** in. Zonder deze backup is dat materiaal onherstelbaar. Er is ook
geen PITR op dit project, dus het herstelpunt is de laatste nacht.

srv1 is niet de eindbestemming: de server dumpt en spiegelt, en duwt alles door naar
de Storage Box waar al een versleutelde borg-repo van srv1 zelf staat.

## Stand van zaken

Al gedaan op srv1 (11-08-2026):

- Leesrol `backup_ro` in productie: alleen `pg_read_all_data`, geen superuser, max 3
  verbindingen. Het wachtwoord is op srv1 gegenereerd en heeft de server nooit verlaten;
  in Postgres staat alleen de SCRAM-verifier.
- `/var/lib/jawerkt-backup` (mode 700, root) met `.pgpass` (mode 600). Bewust **niet**
  onder `/home` of `/etc`: die paden worden al door `backup-srv1.sh` gearchiveerd, wat
  dubbele opslag zou geven én de databasecredential in de srv1-repo zou laten belanden.
- `postgresql-client-17` via de PGDG-repo (`pg_dump` 17.10 — versie 16 weigert tegen een
  17-server). De verbinding vanaf srv1 naar Supabase over IPv6 is getest en werkt.

Nog te doen: stap 1 t/m 6 hieronder.

## Installatie

### 1. Borg-passphrase aanmaken

```bash
sudo sh -c 'openssl rand -base64 32 > /var/lib/jawerkt-backup/.borg-passphrase'
sudo chmod 600 /var/lib/jawerkt-backup/.borg-passphrase
```

> Bewaar deze passphrase óók buiten srv1 (wachtwoordmanager). Zonder de passphrase is
> de repo onleesbaar — ook voor jezelf.

### 2. Configuratie plaatsen

Kopieer `backup.env.example` naar `/var/lib/jawerkt-backup/backup.env`, vul de echte
waarden in en zet de rechten strak:

```bash
sudo chmod 600 /var/lib/jawerkt-backup/backup.env
```

### 3. Borg-repo aanmaken

```bash
sudo env BORG_PASSCOMMAND='cat /var/lib/jawerkt-backup/.borg-passphrase' \
         BORG_RSH='ssh -i /root/.ssh/id_ed25519_storagebox -o BatchMode=yes' \
    borg init --encryption=repokey-blake2 \
    ssh://<user>@<user>.your-storagebox.de:23/./backups/jawerkt
```

### 4. Script en timer installeren

```bash
sudo install -m 750 scripts/backup/jawerkt-backup.sh /usr/local/bin/jawerkt-backup.sh
sudo install -m 644 scripts/backup/backup-jawerkt.service /etc/systemd/system/
sudo install -m 644 scripts/backup/backup-jawerkt.timer   /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now backup-jawerkt.timer
systemctl list-timers backup-jawerkt.timer
```

### 5. Storage-buckets aanzetten (aparte stap)

Zolang stap 5 niet gedaan is, draait de database-backup gewoon en meldt de
storage-fase zichzelf als `niet_geconfigureerd` in `status.json` — bewust zonder
nachtelijk alarm, zodat het geen ruis wordt.

1. Supabase → Project Settings → Storage → **S3 access keys** → nieuwe sleutel.
2. `STORAGE_S3_ACCESS_KEY` en `STORAGE_S3_SECRET_KEY` invullen in `backup.env`.
3. rclone installeren: `sudo -v && curl https://rclone.org/install.sh | sudo bash`

Omvang: 4.274 objecten / 1,25 GB, vrijwel statisch — dedupliceert dus bijna perfect
over opeenvolgende dagen.

### 6. Eerste run en controle

```bash
sudo systemctl start backup-jawerkt.service
sudo journalctl -u backup-jawerkt.service -n 50 --no-pager
sudo cat /var/lib/jawerkt-backup/status.json
```

Verwacht: database `ok` met ±40-60 MB, en een archief `jawerkt-<datum>` in
`borg list`. Controleer daarna of de dump echt bruikbaar is:

```bash
sudo pg_restore --list /var/lib/jawerkt-backup/db/jawerkt-*.dump | head -30
```

## Gezondheid controleren

| Wat | Commando |
|---|---|
| Draait de timer nog? | `systemctl list-timers backup-jawerkt.timer` |
| Laatste run | `sudo cat /var/lib/jawerkt-backup/status.json` |
| Archieven op de Storage Box | `sudo -E borg list` (met de env uit `backup.env`) |
| Logboek | `sudo tail -50 /var/log/jawerkt-backup.log` |

Als `SENTRY_DSN_EDGE` gezet is, meldt de backup zich als cron-monitor
`jawerkt-backup`. Blijft die melding uit, dan maakt Sentry daar vanzelf een issue van
— dat is de bedoeling: een backup die niet draait moet net zo hard opvallen als een
backup die faalt.

## Bewust gemaakte keuzes

- **Eén script, twee fasen.** De database is klein en kritiek, de buckets zijn groot en
  traag. Toch één run, één monitor en één repo: minder bewegende delen om te bewaken.
  De storage-fase kan falen zonder de database-backup mee te trekken.
- **Ongecomprimeerde dump in borg.** Borg comprimeert en dedupliceert zelf; een vooraf
  gecomprimeerde dump ziet er elke dag totaal anders uit en zou niet dedupliceren.
- **Verwijderde bestanden 30 dagen bewaren.** `rclone sync` is een spiegel: zonder
  `--backup-dir` zou een per ongeluk gewiste CV de volgende nacht ook uit de backup
  verdwijnen.
- **Gedeelde SSH-sleutel naar de Storage Box.** Deze backup gebruikt dezelfde sleutel
  als `backup-srv1.sh` en kan daarmee technisch ook bij de srv1-repo. Een Hetzner
  Storage Box **sub-account** zou dat isoleren (eigen sleutel, eigen quota); dat vergt
  toegang tot de Hetzner-console en is een aanbevolen verbetering, geen blokkade.
