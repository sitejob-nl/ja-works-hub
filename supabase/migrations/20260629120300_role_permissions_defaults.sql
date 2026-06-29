-- 29-06 fine-tuning vervolg: configureerbare rolrechten.
-- De applicatie heeft code-defaults; deze seed maakt de huidige matrix zichtbaar
-- en aanpasbaar via organizations.settings.role_permissions.

UPDATE public.organizations
SET settings = jsonb_set(
  COALESCE(settings, '{}'::jsonb),
  '{role_permissions}',
  '{
    "admin": {
      "candidates.view": true,
      "candidates.edit": true,
      "candidates.screening.manage": true,
      "vacancies.view": true,
      "vacancies.edit": true,
      "matching.pipeline.view": true,
      "matching.status.update": true,
      "matching.status.bulk_update": true,
      "matching.drag_drop": true,
      "matching.feedback.write": true,
      "matching.notify_candidates": true,
      "matching.proposal.send": true,
      "matching.interview.confirm": true,
      "placements.view": true,
      "placements.edit": true,
      "finance.view": true,
      "finance.manage": true,
      "settings.manage": true,
      "settings.permissions.manage": true
    },
    "intercedent": {
      "candidates.view": true,
      "candidates.edit": true,
      "candidates.screening.manage": true,
      "vacancies.view": true,
      "vacancies.edit": true,
      "matching.pipeline.view": true,
      "matching.status.update": true,
      "matching.status.bulk_update": true,
      "matching.drag_drop": true,
      "matching.feedback.write": true,
      "matching.notify_candidates": true,
      "matching.proposal.send": true,
      "matching.interview.confirm": true,
      "placements.view": true,
      "placements.edit": true,
      "finance.view": false,
      "finance.manage": false,
      "settings.manage": false,
      "settings.permissions.manage": false
    },
    "backoffice": {
      "candidates.view": true,
      "candidates.edit": true,
      "candidates.screening.manage": true,
      "vacancies.view": true,
      "vacancies.edit": false,
      "matching.pipeline.view": true,
      "matching.status.update": true,
      "matching.status.bulk_update": true,
      "matching.drag_drop": true,
      "matching.feedback.write": true,
      "matching.notify_candidates": true,
      "matching.proposal.send": false,
      "matching.interview.confirm": true,
      "placements.view": true,
      "placements.edit": true,
      "finance.view": true,
      "finance.manage": false,
      "settings.manage": false,
      "settings.permissions.manage": false
    },
    "finance": {
      "candidates.view": true,
      "candidates.edit": false,
      "candidates.screening.manage": false,
      "vacancies.view": true,
      "vacancies.edit": false,
      "matching.pipeline.view": true,
      "matching.status.update": false,
      "matching.status.bulk_update": false,
      "matching.drag_drop": false,
      "matching.feedback.write": false,
      "matching.notify_candidates": false,
      "matching.proposal.send": false,
      "matching.interview.confirm": false,
      "placements.view": true,
      "placements.edit": false,
      "finance.view": true,
      "finance.manage": true,
      "settings.manage": false,
      "settings.permissions.manage": false
    },
    "medewerker": {},
    "opdrachtgever": {}
  }'::jsonb,
  true
)
WHERE settings->'role_permissions' IS NULL;
