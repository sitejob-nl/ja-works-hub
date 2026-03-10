

## Plan: Config.toml, ContractSign fix, BSN/IBAN & WhatsApp encryptie

### 1. Config.toml vervangen
Vervang `supabase/config.toml` met het geüploade bestand. Dit verwijdert `candidate-profile`, `portal-activate` en `contract-sign` als publieke endpoints — ze vallen terug op `verify_jwt = true` (default).

### 2. ContractSign + CandidateProfile + PortalActivate fixen
Met `verify_jwt = true` (default) moeten alle requests een geldige JWT meesturen. De **anon key IS een geldige JWT**, dus de fix is simpel: stuur de anon key mee als `Authorization: Bearer` header in alle fetch-calls op deze drie publieke pagina's.

**ContractSign.tsx** — De GET-request stuurt nu geen auth headers. Fix: voeg `apikey` en `Authorization` headers toe met de anon key.

**CandidateProfile.tsx** — Zelfde fix voor de GET-request naar `candidate-profile`.

**PortalActivate.tsx** — Zelfde fix voor de POST-request naar `portal-activate`.

### 3. BSN/IBAN encryptie
Gebruik `pgcrypto` + een database-functie met `SECURITY DEFINER` om BSN en IBAN te versleutelen/ontsleutelen met een symmetric key opgeslagen als Supabase secret.

**Database migratie:**
- Enable `pgcrypto` extensie
- Maak `encrypt_sensitive()` en `decrypt_sensitive()` functies (SECURITY DEFINER) die `pgp_sym_encrypt`/`pgp_sym_decrypt` gebruiken met een secret uit `current_setting('app.encryption_key')`
- Maak een trigger op `candidates` INSERT/UPDATE die `bsn` en `iban` automatisch versleutelt
- Maak een view `candidates_decrypted` die ontsleutelde waarden toont (alleen voor authenticated users)

**Secret toevoegen:** `ENCRYPTION_KEY` als Supabase secret.

**Frontend:** Aanpassen van read-queries om de decrypt-functie te gebruiken via een RPC call, of de view te gebruiken.

### 4. WhatsApp token encryptie
Zelfde aanpak als BSN/IBAN: `access_token` en `webhook_secret` in `whatsapp_config` versleutelen via trigger, ontsleutelen in edge functions via de decrypt-functie.

### Technisch overzicht

```text
config.toml (uploaded)     →  direct replace
ContractSign.tsx           →  add anon key headers to GET fetch
CandidateProfile.tsx       →  add anon key headers to GET fetch  
PortalActivate.tsx         →  add anon key headers to POST fetch
DB migration               →  pgcrypto + encrypt/decrypt functions + triggers
Supabase secret            →  ENCRYPTION_KEY (symmetric key)
candidates table           →  bsn/iban auto-encrypted on write
whatsapp_config table      →  access_token/webhook_secret auto-encrypted
Edge functions             →  use decrypt function when reading tokens
```

### Volgorde van uitvoering
1. Config.toml vervangen
2. Frontend auth headers fixen (3 bestanden)
3. Encryption secret aanmaken
4. Database migratie voor pgcrypto + functies + triggers
5. Frontend aanpassen voor encrypted reads
6. WhatsApp edge functions aanpassen

