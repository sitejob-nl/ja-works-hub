

## Plan: "Zoek geschikte kandidaten" knop op vacature-detailpagina

### Wat
Een knop op de `VacancyDetail` pagina die automatisch een Exa-zoekquery samenstelt op basis van de vacature-gegevens (titel, locatie, vaardigheden, certificeringen, bedrijfsnaam) en navigeert naar `/kandidaten-zoeken` met die query als URL-parameter.

### Wijzigingen

**1. `src/pages/VacancyDetail.tsx`**
- Import `useNavigate` en `UserSearch` icon
- Voeg een "Zoek geschikte kandidaten" knop toe naast de bestaande knoppen
- Bouw een zoekquery-string op basis van vacature-velden:
  - `title` (functietitel)
  - `location` (locatie)
  - `required_skills` (vaardigheden array)
  - `required_certifications` (certificeringen array)
  - `company.name` (bedrijfsnaam)
- Voorbeeld output: `"Senior lasser met MIG/TIG ervaring in Rotterdam"`
- Navigeer naar `/kandidaten-zoeken?query=<encoded_query>&location=<location>`

**2. `src/pages/KandidatenZoeken.tsx`**
- Lees `query` en optioneel `location` uit URL search params (`useSearchParams`)
- Bij mount: als URL-params aanwezig zijn, vul het zoekformulier automatisch in en start de zoekopdracht direct

### Query-opbouw logica

```text
"{title}" +
(skills? " met {skills.join(', ')} ervaring") +
(location? " in {location}") +
(certifications? " met {certifications.join(', ')} certificering")
```

### Bestanden

| Bestand | Actie |
|---------|-------|
| `src/pages/VacancyDetail.tsx` | Knop + navigatie toevoegen |
| `src/pages/KandidatenZoeken.tsx` | URL params lezen, auto-fill + auto-search |

