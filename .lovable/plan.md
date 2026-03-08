

## Plan: Verbeterd zoekformulier voor Kandidaten Zoeken

Het huidige formulier is een enkel tekstveld met wat losse opties. We maken er een gestructureerd formulier van met aparte velden die automatisch worden samengevoegd tot een slimme Exa-query.

### Nieuw formulier ontwerp

Vervanging van het huidige "Zoekquery (natural language)" tekstveld door gestructureerde invoervelden:

| Veld | Type | Voorbeeld |
|------|------|-----------|
| Functietitel | Input | "Lasser", "Software engineer" |
| Vaardigheden | TagInput | MIG, TIG, React, Python |
| Certificeringen | TagInput | VCA, AWS, ISO |
| Stad / Regio | Input | "Rotterdam", "Noord-Holland" |
| Branche | Select (optioneel) | Technology, Manufacturing, etc. |
| Ervaring (min jaren) | Input number (optioneel) | 5 |

Plus bestaande opties: Land (select), Max resultaten (select), Profieltekst (switch).

Een "Geavanceerd" toggle toont het samengevoegde natural language veld (textarea) zodat power users de query handmatig kunnen aanpassen voordat deze wordt verstuurd.

### Query-opbouw

De velden worden automatisch samengevoegd:
```text
"{functietitel}" +
" met {vaardigheden} ervaring" +
" in {stad}" +
" {branche}" +
" met {certificeringen} certificering" +
" minimaal {jaren} jaar ervaring"
```

### Wijzigingen

**`src/pages/KandidatenZoeken.tsx`**
- Vervang het enkele `query` state-veld door: `jobTitle`, `skills[]`, `certifications[]`, `city`, `industry`, `experienceYears`
- Voeg `buildQuery()` functie toe die de velden samenvoegt
- Voeg een "Toon query" toggle toe met een textarea die de samengestelde query toont en bewerkbaar maakt
- Gebruik `TagInput` component voor vaardigheden en certificeringen
- Bij URL-params (vanuit vacature): parse de query terug naar de losse velden waar mogelijk, of vul de handmatige query textarea
- Layout: 2-kolom grid voor de velden, compacte weergave

### Bestaande functionaliteit blijft intact
- Exa edge function hoeft niet te wijzigen (ontvangt gewoon een `query` string)
- Kandidaat-conversie dialog blijft ongewijzigd
- URL-param auto-search blijft werken (vult dan de "handmatige query" textarea)

