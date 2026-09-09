# Tickets: urenmodule — resterende bouw na de eerste release

Deze lijst vertaalt de resterende bouw uit de [klantspecificatie 1.1](urenmodule-bouw.md#volgende-bouwstappen)
en het implementatieplan naar uitvoerbare tickets. De gepubliceerde release (PR #264: weekcontrole,
matrices, servermatige dagindeling, SaaS-poort) is het startpunt; die staat live met **JA Werkt UIT en
Demo Uitzendbureau Showroom AAN**.

Elk ticket is een verticale plak: van opslag tot scherm, zelfstandig demonstreerbaar, en past in één
verse sessiecontext. Werk de **frontier**: elk ticket waarvan alle blokkades klaar zijn.

**Buiten de code-frontier** — deze klantinput blokkeert specifieke tickets en is geen bouwwerk:
bevestigde klant-/CAO-matrices inclusief pauze-, afrondings- en samenloopregels (T9, T12),
het exportvoorbeeld van de payroller met uurcodes en correctieprocedure (T12, T13),
ontvangers/verantwoordelijken per partij (T8), en de keuze van pilotklanten (T14).

Stand 09-09-2026: **T1, T2, T3 en T6 gebouwd en gedeployed** (migraties `20260909090000`,
`20260910090000`, `20260911090000` en `20260912090000`); T1, T2, T3 en T6 zijn ook met verbonden demo-QA
bewezen. T4, T5 en T7 t/m T14 nog niet gestart. T7 (duurzame mailinname) blijft geblokkeerd door T5.

---

## T1 · Interne bronupload bij een klantweek en toepassen als dagversie

**Wat te bouwen:** een interne gebruiker met `finance.manage` opent een klantweek, uploadt daar een
urenbriefje als PDF of foto, bewaart dat origineel privé, bekijkt het naast de dagen van de week, legt
op basis daarvan een **invoervoorstel** vast voor één medewerker en één werkdag, en past dat voorstel
daarna in een aparte, expliciete handeling toe als nieuwe dagrevisie. Vanaf dat moment gedraagt de dag
zich als iedere andere: het eerdere medewerkerakkoord vervalt, de uursoortencontrole kan opnieuw
draaien, en de bron blijft bij de uren terug te vinden.

Dit is de eerste helft van "uren ontvangen en uitlezen" met **handmatige beoordeling**. Automatische
uitlezers sluiten in T3–T5 op exact dezelfde bron-/voorstelgrens aan.

**Status:** gebouwd en gedeployed op 8 september 2026; zie het
[innamecontract](urenmodule-intake-contract.md) en de [bouwstand](urenmodule-bouw.md).

**Geblokkeerd door:** niets — kan direct starten.

- [x] Upload van PDF, JPG/JPEG en PNG bij een klantweek; andere typen en te grote bestanden worden
      geweigerd met een begrijpelijke melding
- [x] Het origineel staat in een privé-opslag die alleen bereikbaar is voor interne gebruikers van de
      eigen organisatie; de SaaS-modulepoort en `finance`-rechten gelden ook hier
- [x] Dezelfde bijlage tweemaal aanleveren binnen dezelfde week levert één bron op, geen tweede
      verwerking en geen tweede voorstel
- [x] Bron bekijken via een kortlopende link; het bestand is nergens publiek benaderbaar
- [x] Een voorstel legt medewerker, werkdag, minuten of expliciete nulreden, eventuele diensttijden en
      broncategorieën, en een vindplaats in de bron vast. Een voorstel is nog géén uur
- [x] Toepassen is een aparte handeling die letterlijk het voorstel overneemt; wijzigen betekent het
      voorstel verwerpen en een nieuw voorstel vastleggen
- [x] Een toegepast voorstel maakt precies één nieuwe dagrevisie, met de bron als herkomst in plaats van
      "handmatige invoer"; tweemaal toepassen levert geen tweede revisie
- [x] Een dagversie die ondertussen is gewijzigd, blokkeert het toepassen met een herstelbaar conflict
      (HTTP 409) zonder iets te schrijven
- [x] De bestaande uursoortencontrole en medewerkerreacties werken ongewijzigd op de nieuwe revisie
- [x] Een bron of voorstel schrijft niets naar `timesheets`, facturatie of communicatie

---

## T2 · Bronpagina's en gecontroleerde toewijzing bij meerdere medewerkers

**Wat te bouwen:** één aangeleverd bestand kan meerdere medewerkers en meerdere pagina's bevatten. Een
interne gebruiker ziet per pagina welk deel van de bron bij welk voorstel hoort, en een voorstel waarvan
de toewijzing niet eenduidig is blijft expliciet onbeslist. Een onbesliste toewijzing blokkeert de
betreffende dag; hij kan nooit stilzwijgend bij één persoon terechtkomen.

**Status:** gebouwd en gedeployed op 8 september 2026; zie het
[innamecontract](urenmodule-intake-contract.md#paginas-en-gecontroleerde-toewijzing-t2).

**Geblokkeerd door:** T1.

- [x] Een PDF toont paginanummer en -aantal; een voorstel verwijst naar de exacte pagina
- [x] Meerdere voorstellen uit dezelfde bron voor verschillende medewerkers en dagen
- [x] Een voorstel kan expliciet "toewijzing onzeker" zijn; toepassen is dan geblokkeerd tot een
      interne gebruiker de medewerker bevestigt
- [x] Een pagina met meerdere personen kan niet in één handeling aan één persoon worden toegewezen
- [x] Een onbesliste toewijzing telt mee als openstaand punt op de week

---

## T3 · Voorstellen uit Excel- en tabelbestanden

**Wat te bouwen:** een geüpload `.xlsx`/`.xls`-bestand wordt deterministisch gelezen en levert
voorstellen op dezelfde grens als T1: werkbladen, cellen, datum-/tijdduren, decimale uren en expliciete
categorieën (OV1–OV5) blijven behouden. Een meegeleverd totaal is een controlegetal, geen waarheid.
De interne gebruiker beoordeelt en past toe; er wordt niets automatisch geboekt.

**Status:** gebouwd en gedeployed op 8 september 2026; zie het
[innamecontract](urenmodule-intake-contract.md#excel--en-tabelbestanden-als-bron-t3).

**Geblokkeerd door:** T2.

- [x] Een werkblad met dagen per medewerker levert per medewerker/dag één voorstel op
- [x] Broncategorieën blijven letterlijk staan; ontbrekende tijden worden niet verzonnen
- [x] Een niet-sluitende optelling (4 + 5 = 8) wordt gesignaleerd en blokkeert toepassen niet stil,
      maar toont het verschil
- [x] Formules en macro's worden niet uitgevoerd; alleen bewaarde resultaten worden gelezen
- [x] Een niet-leesbaar of onverwacht ingedeeld bestand levert een begrijpelijke blokkade en géén
      halve voorstellen

---

## T4 · Uitlezen van scans en foto's via de JA Werkt-VPS met centrale AI-boekhouding

**Wat te bouwen:** een geüploade scan of foto wordt op de JA Werkt-VPS uitgelezen tot een voorstel met
vindplaats per waarde. Handgeschreven pauzes en correcties worden meegenomen; onduidelijke cijfers
worden expliciet onzeker gemeld en blokkeren toepassen. Iedere betaalde aanroep loopt via
`_shared/ai-accounting.ts` binnen het vaste maandbudget van € 50 per Nederlandse kalendermaand.

**Geblokkeerd door:** T2.

- [ ] Reserveren vóór de aanroep, één providercall, en aanvraag/verbruik/boeking atomair afrekenen
- [ ] Een uitgeput maandbudget blokkeert het uitlezen zichtbaar; handmatige invoer blijft werken
- [ ] Onzekere velden komen als onzeker in het voorstel en kunnen niet blind worden toegepast
- [ ] Een zekerheidsscore overrulet nooit een ontbrekend gegeven of een foutieve optelling
- [ ] Geen Qwen-terugval; documentvoorbewerking blijft op de gekozen host

---

## T5 · Word- en e-mailbestanden als bron

**Wat te bouwen:** `.docx`, oude binaire `.doc` en `.eml` worden als bron aanvaard en leveren
voorstellen. Bij e-mail wordt nieuwe tekst onderscheiden van geciteerde geschiedenis, headers en
doorgestuurde bijlagen; een later antwoord is niet automatisch een nieuwe urenweek maar kan een
correctie op een bestaande dag zijn.

**Geblokkeerd door:** T3.

- [ ] DOCX met tabelstructuur levert dezelfde voorstelvorm als Excel
- [ ] Oud binair DOC is een aantoonbare proef, geen heuristische tekstgok
- [ ] Een `.eml` met bijlagen levert bron + bijlagen als één ontvangst met behouden samenhang
- [ ] Geciteerde oude tekst levert geen tweede voorstel voor dezelfde dag
- [ ] Een correctie in mailtekst (zaterdag 9,5 → 4,75) komt als correctievoorstel op dezelfde dag

---

## T6 · Persoonlijke klantweekpagina zonder inloggen

**Wat te bouwen:** een opdrachtgever opent een persoonlijke link naar precies één klantweek, ziet de
verwachte medewerkers, vult per dag uren in of kiest "geen uren" met reden, uploadt een urenbriefje,
slaat gedeeltelijk op en kan aangeven later aan te leveren. De pagina vereist geen inlog, geeft nooit
toegang tot een andere klant of week, en gebruikt dezelfde bron-/voorstelgrens als T1.

**Status:** gebouwd en gedeployed op 9 september 2026; zie het
[innamecontract](urenmodule-intake-contract.md#persoonlijke-klantweekpagina-zonder-inloggen-t6).

**Geblokkeerd door:** T1.

- [x] Gehasht token met scope op één klantweek, geldigheidsduur en intrekbaarheid
- [x] Een verlopen of ingetrokken token faalt; een token van klant A opent klant B niet
- [x] Klantinvoer landt als voorstel, niet rechtstreeks als dagversie
- [x] 8,5 en 8:30 leiden tot dezelfde duur; een leeg veld blijft onbekend
- [x] Gedeeltelijke aanlevering blijft zichtbaar als onvolledig

---

## T7 · Duurzame mailinname vanuit de gekoppelde mailbox

**Wat te bouwen:** antwoorden op de urenmail worden zelfstandig opgehaald uit de gekoppelde
Outlook-mailbox en worden bron + voorstel, zonder dat iemand de inbox opent. Koppeling gebeurt op de
uitvraagreferentie plus klantweek; onbekende of tegenstrijdige toewijzing gaat naar een interne
controlebak in plaats van naar een gok.

**Geblokkeerd door:** T5, T6.

- [ ] Duurzame cursor per gevolgde map, hervatbaar na onderbreking of verlopen cursor
- [ ] Stabiele bericht-id's; hetzelfde bericht tweemaal ophalen levert geen tweede bron
- [ ] Verwijderde of verplaatste berichten laten geen halve verwerking achter
- [ ] Een wachtrij met claim, lease en beperkte hernieuwingen; geen verloren opdrachten
- [ ] Onbekende afzender of week landt zichtbaar in de controlebak

---

## T8 · Mailprofielen, deadlines en outbox met conceptgoedkeuring

**Wat te bouwen:** JA Werkt stelt per partij in welke berichten uitgaan, naar wie, op welke dag en
welk tijdstip of ten opzichte van welke deadline. Herinneringen gaan alleen naar partijen waar nog
iets ontbreekt. Correctie- en navraagmails blijven concept tot expliciete goedkeuring; een ingestelde
verzendtijd omzeilt die goedkeuring niet. De bestaande kill-switch voor uitgaande communicatie geldt.

**Geblokkeerd door:** T6.

- [ ] Twee opdrachtgevers met verschillende schema's krijgen hun berichten op de juiste momenten
- [ ] Een uitgeschakelde berichtsoort verstuurt niets
- [ ] Een concept wordt pas verzonden na expliciete goedkeuring; gewijzigde bronrevisie ongeldigt het
- [ ] Een herhaalde cron-run verstuurt niets dubbel; provider-5xx leidt niet tot ongecontroleerde retry
- [ ] Bij actieve outbound-pauze wordt als concept gelogd, niet stil weggegooid

---

## T9 · Weekoverwerk, samenloop en feestdagen in de rekenkern

**Wat te bouwen:** de gedeelde rekenkern kent dag- en weekoverwerkgrenzen, de afgesproken samenloop van
toeslagen, feestdagen en echte verstreken diensttijd tijdens een klokwisseling. Ontbrekende of
tegenstrijdige regels blijven blokkeren; er wordt geen CAO geraden en geen standaardfactor gekozen.

**Geblokkeerd door:** niets in code — wacht op bevestigde klantmatrices.

- [ ] Weekgrens over meerdere dagen en plaatsingen van dezelfde medewerker
- [ ] Expliciete samenloopregel bij overlappende toeslagen; geen dubbeltelling
- [ ] Feestdagen per matrixversie, met ingangsdatum
- [ ] Een klokwisseldag levert de werkelijk verstreken tijd, niet de wandkloktijd
- [ ] Een oude week verandert niet door een nieuwe matrixversie

---

## T10 · Expliciete vervanging van een vastgelegde matrixbasis

**Wat te bouwen:** een dag waarvan de matrixbasis onherroepelijk is vastgelegd kan met een aparte,
gecontroleerde procedure op een andere basis worden herberekend, met reden, actor en volledige historie.
Zonder die procedure blijft de vastgelegde basis leidend.

**Geblokkeerd door:** niets — kan direct starten.

- [ ] Vervanging vereist expliciete reden en bevoegdheid; de oude basis blijft zichtbaar
- [ ] De oude classificaties blijven bestaan en worden niet herschreven
- [ ] Een vervanging op een al vrijgegeven dag is geblokkeerd tot de correctieroute bestaat

---

## T11 · Intern weekoverzicht met acties, deadlines en verantwoordelijken

**Wat te bouwen:** één regel per opdrachtgever met ontvangen versus verwachte medewerkers, bron,
akkoorden, open punten, deadline, verantwoordelijke en status; doorklikken toont dagen en bronnen.
Filters op actie vereist, wachten op medewerker, klaar voor vrijgave en eigen dossiers. De aantallen
komen van de server, zodat selectie en vervolgacties de volledige bedoelde set dekken.

**Geblokkeerd door:** T2, T8.

- [ ] Server-side aantallen; geen telling over alleen de zichtbare pagina
- [ ] Een verstreken deadline maakt open punten rood en levert een taak bij de verantwoordelijke
- [ ] Een onopgelost punt is niet weg te filteren tot vrijgave

---

## T12 · Vrijgave en controleerbare export naar de payroller

**Wat te bouwen:** interne vrijgave van een volledige, gecontroleerde selectie, gevolgd door één
terugvindbare exportbatch in het met de payroller afgesproken formaat. Alleen dagen zonder open
blokkades en met de benodigde akkoorden kunnen mee. Tweemaal klikken levert geen tweede levering.

**Geblokkeerd door:** T9, T11 — en het exportvoorbeeld van de payroller.

- [ ] Vrijgave en export in dezelfde transactie op exact dezelfde revisies
- [ ] Alle uurcodes gemapt; een ontbrekende code blokkeert de hele batch
- [ ] Een identieke download is reproduceerbaar; de oude batch blijft onveranderlijk
- [ ] Gelijktijdig vrijgeven vanuit twee sessies levert één batch

---

## T13 · Correcties na export

**Wat te bouwen:** een wijziging op een al geëxporteerde week wordt als vervolgcorrectie behandeld: de
oude export blijft ongewijzigd en herkenbaar, de correctie krijgt een eigen batch, en de payroller kan
zien wat vervangt en wat aanvult.

**Geblokkeerd door:** T12.

- [ ] Een correctie op een geëxporteerde dag kan niet stilzwijgend de oude levering aanpassen
- [ ] Vervanging versus aanvulling volgt de met de payroller afgesproken route
- [ ] Bron en oorspronkelijke waarde blijven bij de correctie terug te vinden

---

## T14 · Praktijkacceptatie en gecontroleerde productieactivering

**Wat te bouwen:** de elf praktijkbestanden gaan afzonderlijk door de volledige stroom en worden met de
bron vergeleken; de elf acceptatiecriteria uit specificatie 1.1 worden met bewijs afgevinkt. Daarna één
volledige weekcyclus naast de bestaande werkwijze, en pas na acceptatie activering per opdrachtgever.

**Geblokkeerd door:** T13.

- [ ] Ieder aangeleverd formaat is verwerkt of heeft een begrijpelijke blokkade; niets verdwijnt stil
- [ ] Nul foutieve automatische vrijgaven op de acceptatieset
- [ ] Verwerkingstijd en modelkosten per bestand vastgelegd
- [ ] Geen dubbele werkelijke payrollaanlevering tijdens de vergelijkingsweek
- [ ] Activering per opdrachtgever pas na geslaagde controle
