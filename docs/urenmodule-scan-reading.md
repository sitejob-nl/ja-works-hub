# Urenmodule: scans en foto's uitlezen tot invoervoorstellen (T4)

**Status: in aanbouw.** Dit document legt eerst het hostbesluit vast; het contract volgt
zodra de bouw af is.

## Welke host het uitleeswerk doet — geverifieerd besluit

De ticketlijst noemt bij T4 "de JA Werkt-VPS" als host. Dat is achterhaald. Het uitlezen
draait op **Google Gemini**, aangeroepen via `_shared/ai-accounting.ts`. Er is geen
VPS-stap en geen aparte documentvoorbewerkingshost.

Wat er op 9 september 2026 daadwerkelijk is nagegaan:

| Bevinding | Hoe vastgesteld |
| --- | --- |
| Elke betaalde aanroep van de afgelopen zestig dagen liep via Gemini | `ai_usage_log` in productie: `gemini-3.5-flash` (vacature-skills, CV-analyse, veldextractie), `gemini-3.1-flash-lite` (match-herrangschikking). Eén historische `claude-sonnet-5` voor vacatureteksten. Geen enkele VPS-regel. |
| De centrale transportlaag kent de VPS niet | `AiProvider` in `_shared/ai-accounting.ts` is `gemini \| anthropic \| lovable \| exa`, en `validateRequest` vergelijkt de doel-URL letterlijk. Een VPS-aanroep zou per definitie buiten het grootboek vallen — precies het tweede pad dat dit ticket verbiedt. |
| Beeld mag alleen via Gemini | Diezelfde validatie weigert beeldinvoer op elke andere provider (`unsupported_ai_media`, "Gebruik voor beeldinvoer de gecontroleerde Gemini-route") en laat op Gemini uitsluitend JPEG, PNG, WebP, HEIC, HEIF en PDF toe. |
| Het lokale Qwen-pad is uitgefaseerd | `analyze-cv-batch` antwoordt `410` met code `vps_provider_retired`; `analyze-cv` kent alleen nog `provider = "gemini"`. |
| De VPS is niet bereikbaar | `http://204.168.221.107:11434/api/tags` en `:8000/health` geven allebei een verbindingstime-out (12 s). De secrets `OLLAMA_BASE_URL` en `OLLAMA_API_KEY` bestaan nog, maar alleen `analyze-cv-callback` gebruikt de sleutel — als inkomende authenticatie voor een worker die niets meer verstuurt. |
| Qwen3-14B kan dit werk niet | Het is een tekstmodel op CPU; een gescand urenbriefje is beeld. |

`docs/ai-accounting.md` schrijft dit ook met zoveel woorden voor: "Nieuwe functies, waaronder
urenfotoherkenning, moeten dezelfde transportlaag gebruiken."

### Documentvoorbewerking

Er is er geen, en dat is de bedoeling. Gemini leest een PDF en een foto rechtstreeks als
`inlineData`; een PDF hoeft dus niet eerst naar afbeeldingen te worden omgezet. De enige
voorbewerking die deze module kent, gebeurt al bij het uploaden en staat in de browser:
paginatelling met pdf.js, controle van de eerste bytes, en de SHA-256 die het opslagpad
bepaalt. Dat blijft ongewijzigd (T1 tot en met T3).

Wat wél op de server gebeurt en niet in de browser kan: het origineel terughalen uit de
privébucket, en de betaalde aanroep doen met een gereserveerd budget. Daarvoor is de edge
function `hours-read-scan` er.
