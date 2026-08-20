-- Borg op pandniveau: het bedrag dat JA Werkt aan de verhuurder heeft betaald voor
-- de woning als geheel. Stond tot nu toe nergens; het enige borgveld zat op
-- housing_assignments en gaat over wat een bewoner betaalt — een ander bedrag,
-- een andere tegenpartij en een ander moment.
--
-- Bewust op properties en niet op property_contracts: die tabel eist een geüpload
-- bestand (file_path NOT NULL), en de borg is ook bekend zonder pdf.
alter table public.properties
  add column if not exists deposit_amount numeric,
  add column if not exists deposit_paid_date date;

comment on column public.properties.deposit_amount is
  'Borg betaald aan de verhuurder voor het hele pand. Niet te verwarren met housing_assignments.deposit_amount (borg van een bewoner).';
comment on column public.properties.deposit_paid_date is
  'Datum waarop de pandborg is betaald.';
