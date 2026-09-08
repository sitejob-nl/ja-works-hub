"""Build the first hours release as one transaction, including its opt-in gate.

Run once through Supabase apply_migration, never db push each foundation stage
separately on an exposed database. Existing migration versions are not overwritten.
"""
import hashlib
import json
from pathlib import Path
import re
import sys

root = Path(__file__).resolve().parent.parent
output = Path(sys.argv[1]).resolve()
files = [
    "20260908090000_hours_workflow_foundation.sql",
    "20260908120000_hours_matrix_versions.sql",
    "20260908140000_hours_day_sources_and_classification.sql",
    "20260908160000_hours_workflow_organization_gate.sql",
]
manifest = []
parts = ["begin;"]
for filename in files:
    source = (root / "supabase/migrations" / filename).read_text()
    version, name = filename.removesuffix(".sql").split("_", 1)
    digest = hashlib.sha256(source.encode()).hexdigest()
    manifest.append({"file": filename, "version": version, "name": name, "sha256": digest})
    if filename == files[-1]:
        parts.append("""
-- Initial rollout authorized by Kas: demo ON, JA Werkt OFF. All three other
-- organizations retain their existing flags and default OFF for this new key.
-- This precedes gate/audit trigger installation inside the same transaction;
-- the migration receipt is the audit record for these two bootstrap settings.
do $$ begin
  if not exists (select 1 from public.organizations where id='6dedabe4-f62c-479e-b5fc-ebfcb824d76f' and slug='demo-uitzendbureau-showroom')
    or not exists (select 1 from public.organizations where id='a1b2c3d4-e5f6-7890-abcd-ef1234567890' and slug='ja-werkt') then
    raise exception 'Verified rollout organizations do not match';
  end if;
end $$;
insert into public.organization_modules(organization_id,module_name,enabled)
values ('a1b2c3d4-e5f6-7890-abcd-ef1234567890','uren-workflow',false),
       ('6dedabe4-f62c-479e-b5fc-ebfcb824d76f','uren-workflow',true)
on conflict (organization_id,module_name) do update set enabled=excluded.enabled;
""")
    parts.append(f"-- Source: {filename}; SHA256 {digest}\n" + re.sub(r"(?m)^(?:begin|commit);\s*$", "", source))
for item in manifest:
    # The apply_migration receipt stores the complete SQL bundle. Keep each source
    # version recorded too, so a later CLI push never replays an ungated stage.
    parts.append(
        "insert into supabase_migrations.schema_migrations(version,name,statements) values "
        f"('{item['version']}','{item['name']}',ARRAY['-- Applied atomically in hours_workflow_guarded_initial_release; source SHA256 {item['sha256']}']);"
    )
parts.append("commit;")
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text("\n\n".join(parts) + "\n")
receipt = {"migrations": manifest, "bootstrap": {"JA Werkt": False, "Demo Uitzendbureau Showroom": True}, "sha256": hashlib.sha256(output.read_bytes()).hexdigest()}
output.with_suffix(".manifest.json").write_text(json.dumps(receipt, indent=2) + "\n")
print(json.dumps(receipt, indent=2))
