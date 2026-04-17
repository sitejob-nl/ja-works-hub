# E2E tests

Three spec files, geordend naar auth-behoefte:

| Spec | Auth nodig | Wat |
|------|-----------|-----|
| `e2e-api-contracts.spec.ts` | Geen | Edge function auth gates, CORS preflight |
| `e2e-public-pages.spec.ts` | Geen | Portal login, activatie met bogus token, onboarding link, registratie |
| `e2e-critical-flows.spec.ts` | Ja (admin) | Kandidaat/matches/uren/ziekmelding UI render |

## Dev server vereist

Tests verwachten `http://localhost:8081` (of override via `E2E_BASE_URL`). Start eerst:

```bash
npm run dev
```

## Runnen

```bash
# Alle tests
npm run test:e2e

# Alleen de tests die geen login vereisen (snelste CI-check)
npm run test:e2e:api

# Alleen de admin-flow tests (skip zonder credentials)
TEST_EMAIL=qa@sitejob.nl TEST_PASSWORD='...' npm run test:e2e:flows
```

## Credentials

`e2e-critical-flows.spec.ts` doet programmatic login via Supabase REST. Als
`TEST_EMAIL` of `TEST_PASSWORD` niet gezet is, wordt elke auth-afhankelijke
test geskipt. Zet deze **niet** in de repo — gebruik een lokaal `.env.test`
bestand of je shell profile.

Na eerste succesvolle login wordt `scripts/.auth-state.json` bewaard zodat
volgende runs geen nieuwe auth-call doen. Dat bestand staat in `.gitignore`.

## Headed modus

Default runnen tests headless. Voor debugging:

```bash
HEADED=1 npm run test:e2e
```

Screenshots en traces bij failure komen in `test-results/`.

## CI

Voor een CI-run die geen account/wachtwoord nodig heeft:

```bash
npm run test:e2e:api
```

24 tests, ~30s, geen afhankelijkheid van test user.
