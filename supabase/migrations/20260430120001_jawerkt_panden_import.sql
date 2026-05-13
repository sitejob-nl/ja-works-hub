-- JA Werkt: panden-import vanuit overzicht_panden (1).xlsx
-- 14 panden / 52 units / 67 bedden (1 kamer 'geblokkeerd' = opslag op Engelseweg 21).
-- Verwijdert eerst alle bestaande demo-properties (incl. assignments) van de JA Werkt org.

BEGIN;

DO $$
DECLARE
  v_org uuid := 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
BEGIN
  -- 1) Demo-assignments weg (FK is RESTRICT, dus moet expliciet)
  DELETE FROM housing_assignments
  WHERE unit_id IN (
    SELECT u.id FROM units u
    JOIN properties p ON p.id = u.property_id
    WHERE p.organization_id = v_org
  );

  -- 2) Properties weg — cascades units, housing_inspections, key_registrations
  DELETE FROM properties WHERE organization_id = v_org;
END $$;

-- 3) 14 panden + 52 units inserten via één gezamenlijke CTE
WITH props (street, postal, city, capacity) AS (
  VALUES
    ('Gagelstraat 11',     '5531 CL', 'Bladel',   1),
    ('Azalealaan 33',      '5701 CJ', 'Helmond',  8),
    ('Engelseweg 21',      '5705 AB', 'Helmond',  6),
    ('Hikspoorstraat 18',  '5706 TC', 'Helmond',  6),
    ('Parkweg 18 F',       '5701 PS', 'Helmond',  5),
    ('Rijpelplein 22',     '5709 BT', 'Helmond',  5),
    ('Scheerderhof 58',    '5709 GM', 'Helmond',  4),
    ('Veluwehof 61',       '5709 KJ', 'Helmond',  5),
    ('Schuttersstraat 2',  '5715 BH', 'Lierop',   4),
    ('Stipdonk 46',        '5715 PD', 'Lierop',   1),
    ('Dorpstraat 2',       '5737 GC', 'Lieshout', 6),
    ('Heuvel 11',          '5737 BX', 'Lieshout', 5),
    ('Lungendonksebaan 4', '5731 PA', 'Mierlo',   4),
    ('Ronde Bleek 8',      '6029 PE', 'Sterksel', 7)
),
inserted_props AS (
  INSERT INTO properties (
    organization_id, address_street, address_postal, address_city,
    total_capacity, ownership_type, is_active
  )
  SELECT
    'a1b2c3d4-e5f6-7890-abcd-ef1234567890'::uuid,
    p.street, p.postal, p.city, p.capacity, 'huur', true
  FROM props p
  RETURNING id, address_street
),
units_data (street, name, capacity, floor, status, notes) AS (
  VALUES
    ('Gagelstraat 11',     '1.1',         1, 0,    'beschikbaar', NULL),

    ('Azalealaan 33',      '1.1',         1, 1,    'beschikbaar', NULL),
    ('Azalealaan 33',      '1.2',         1, 1,    'beschikbaar', NULL),
    ('Azalealaan 33',      '2.1',         2, 2,    'beschikbaar', NULL),
    ('Azalealaan 33',      '2.2',         1, 2,    'beschikbaar', NULL),
    ('Azalealaan 33',      '2.3',         1, 2,    'beschikbaar', NULL),
    ('Azalealaan 33',      '3.1 Studio',  2, 3,    'beschikbaar', NULL),

    ('Engelseweg 21',      '1.1',         1, 1,    'geblokkeerd', 'Deze kamer is niet beschikbaar dus staat op inactief. Het betreft een opslagkamer.'),
    ('Engelseweg 21',      '1.2',         2, 1,    'beschikbaar', NULL),
    ('Engelseweg 21',      '1.3',         1, 1,    'beschikbaar', NULL),
    ('Engelseweg 21',      '1.4',         2, 2,    'beschikbaar', NULL),

    ('Hikspoorstraat 18',  '1.1',         1, 0,    'beschikbaar', NULL),
    ('Hikspoorstraat 18',  '2.1',         1, 1,    'beschikbaar', NULL),
    ('Hikspoorstraat 18',  '2.2',         1, 1,    'beschikbaar', NULL),
    ('Hikspoorstraat 18',  '3.1',         1, 2,    'beschikbaar', NULL),
    ('Hikspoorstraat 18',  '3.2',         2, 2,    'beschikbaar', NULL),

    ('Parkweg 18 F',       '1.1',         1, 1,    'beschikbaar', NULL),
    ('Parkweg 18 F',       '1.2',         2, 1,    'beschikbaar', NULL),
    ('Parkweg 18 F',       '1.3',         1, 1,    'beschikbaar', NULL),
    ('Parkweg 18 F',       '1.4',         1, 1,    'beschikbaar', NULL),

    ('Rijpelplein 22',     '1.1',         1, 1,    'beschikbaar', NULL),
    ('Rijpelplein 22',     '1.2',         2, 1,    'beschikbaar', NULL),
    ('Rijpelplein 22',     '2.1',         2, 2,    'beschikbaar', NULL),

    ('Scheerderhof 58',    '1.1',         1, 1,    'beschikbaar', NULL),
    ('Scheerderhof 58',    '1.2',         1, 1,    'beschikbaar', NULL),
    ('Scheerderhof 58',    '1.3',         2, 1,    'beschikbaar', NULL),

    ('Veluwehof 61',       '1.1',         1, 0,    'beschikbaar', NULL),
    ('Veluwehof 61',       '2.1',         1, 1,    'beschikbaar', NULL),
    ('Veluwehof 61',       '2.2',         2, 1,    'beschikbaar', NULL),
    ('Veluwehof 61',       '3.1',         1, 2,    'beschikbaar', NULL),

    ('Schuttersstraat 2',  '1.1',         1, 1,    'beschikbaar', NULL),
    ('Schuttersstraat 2',  '1.2',         1, 1,    'beschikbaar', NULL),
    ('Schuttersstraat 2',  '1.3',         2, 1,    'beschikbaar', NULL),

    ('Stipdonk 46',        '1.2',         1, 0,    'beschikbaar', NULL),

    ('Dorpstraat 2',       '1.1',         1, 0,    'beschikbaar', NULL),
    ('Dorpstraat 2',       '2.1',         1, 1,    'beschikbaar', NULL),
    ('Dorpstraat 2',       '2.2',         2, 1,    'beschikbaar', NULL),
    ('Dorpstraat 2',       '2.3',         2, 1,    'beschikbaar', NULL),

    ('Heuvel 11',          '1.1',         1, 1,    'beschikbaar', NULL),
    ('Heuvel 11',          '1.2',         1, 1,    'beschikbaar', NULL),
    ('Heuvel 11',          '1.3',         1, 1,    'beschikbaar', NULL),
    ('Heuvel 11',          '2.1',         1, 2,    'beschikbaar', NULL),
    ('Heuvel 11',          '2.2',         1, 2,    'beschikbaar', NULL),

    ('Lungendonksebaan 4', '1.1',         2, 0,    'beschikbaar', NULL),
    ('Lungendonksebaan 4', '1.2',         2, 0,    'beschikbaar', NULL),

    ('Ronde Bleek 8',      '1.1',         1, 0,    'beschikbaar', NULL),
    ('Ronde Bleek 8',      '2.1',         1, 1,    'beschikbaar', NULL),
    ('Ronde Bleek 8',      '2.2',         1, 1,    'beschikbaar', NULL),
    ('Ronde Bleek 8',      '2.3',         2, 1,    'beschikbaar', NULL),
    ('Ronde Bleek 8',      '2.4',         1, 1,    'beschikbaar', NULL),
    ('Ronde Bleek 8',      '2.5',         1, 1,    'beschikbaar', NULL)
)
INSERT INTO units (organization_id, property_id, name, capacity, floor, status, notes)
SELECT
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890'::uuid,
  ip.id,
  ud.name,
  ud.capacity,
  ud.floor,
  ud.status::unit_status,
  ud.notes
FROM units_data ud
JOIN inserted_props ip ON ip.address_street = ud.street;

COMMIT;
