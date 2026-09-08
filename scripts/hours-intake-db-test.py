#!/usr/bin/env python3
"""Real PostgreSQL tests for internal hours intake: private sources and proposals.

Runs the five released hours migrations plus the new intake migration in a
disposable container, then the full module-gate/classification/foundation
regressions on top, so the refactored revision writer is proven unchanged.
No production writes, providers, network or host mounts.
Run: python3 scripts/hours-intake-db-test.py
Cleanup: python3 scripts/hours-intake-db-test.py --cleanup
HOURS_INTAKE_QA_OUTPUT selects a durable output directory.
"""

import argparse
import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = Path(os.environ.get("HOURS_INTAKE_QA_OUTPUT", ROOT / "test-results/hours-intake-db"))
# Import through the released conflict harness so its in-memory PT409 expectation
# updates apply to the very same test classes this run executes.
spec = importlib.util.spec_from_file_location("hours_conflict_qa", ROOT / "scripts/hours-conflict-db-test.py")
conflict = importlib.util.module_from_spec(spec)
spec.loader.exec_module(conflict)
gate = conflict.gate
classification = gate.classification
qa = gate.qa
qa.CONTAINER = "ja-works-hours-intake-test-20260909"
qa.LABEL = "ja-werkt-hours-intake-qa"
qa.LABEL_VALUE = "20260909"
sql, rpc, literal, rpc_statement = qa.sql, qa.rpc, qa.literal, qa.rpc_statement

PDF = "application/pdf"
INTAKE_TABLES = gate.TABLES + ("hours_week_sources", "hours_source_proposals")
AUTHENTICATED_PRIVATE_HELPERS = {"private.hours_module_enabled()",
                                 "private.hours_source_object_allowed(text,boolean)"}


def digest(marker):
    return hashlib.sha256(marker.encode()).hexdigest()


class IntakeTests(unittest.TestCase):
    """Every case builds its own tenant, week and synthetic evidence object."""

    setUp = gate.enabled_setup

    # --- helpers -----------------------------------------------------------

    def open_week(self):
        week = self.week()
        self.week_id = week["id"]
        return week

    def store(self, content_hash, extension="pdf", mimetype=PDF, size=2048, org=None, week=None):
        """Write the Storage row Supabase creates after a successful upload."""
        path = f"{org or self.org}/{week or self.week_id}/{content_hash}.{extension}"
        sql(f"""INSERT INTO storage.objects(bucket_id,name,metadata) VALUES ('hours-sources',{literal(path)},
          jsonb_build_object('size',{size},'mimetype',{literal(mimetype)}))
          ON CONFLICT (bucket_id,name) DO UPDATE SET metadata=EXCLUDED.metadata;""")
        return path

    def add_source(self, content_hash=None, name="urenbriefje.pdf", mimetype=PDF, extension="pdf",
                   user=None, size=2048):
        content_hash = content_hash or digest(str(uuid.uuid4()))
        self.store(content_hash, extension=extension, mimetype=mimetype, size=size)
        return rpc("hours_add_week_source", user=user or self.admin, p_week_id=self.week_id,
                   p_content_hash=content_hash, p_file_name=name, p_content_type=mimetype), content_hash

    def propose(self, source_id, day_id, minutes=480, reason=None, note=None, source=None,
                page="pagina 1", user=None):
        return rpc("hours_create_source_proposal", user=user or self.admin, p_source_id=source_id,
                   p_day_id=day_id, p_minutes=minutes, p_no_hours_reason=reason, p_note=note,
                   p_source_input=source, p_page_label=page)

    def only_proposal(self, sources, index=0, source_index=0):
        return sources["sources"][source_index]["proposals"][index]

    def day_of(self, week):
        return week["members"][0]["days"][0]

    def revision_of(self, week_id, day_id):
        week = rpc("hours_get_week", user=self.admin, p_week_id=week_id)
        for member in week["members"]:
            for day in member["days"]:
                if day["id"] == day_id:
                    return day["current_revision"]
        raise AssertionError("day not found")

    # --- sources -----------------------------------------------------------

    def test_upload_registers_a_private_source_once(self):
        week = self.open_week()
        marker = digest("same-attachment")
        first, _ = self.add_source(marker, name="week36.pdf")
        self.assertFalse(first["duplicate"])
        self.assertEqual(len(first["sources"]), 1)
        self.assertEqual(first["sources"][0]["file_name"], "week36.pdf")
        self.assertEqual(first["sources"][0]["byte_size"], 2048)
        self.assertEqual(first["sources"][0]["storage_path"],
                         f"{self.org}/{week['id']}/{marker}.pdf")
        second, _ = self.add_source(marker, name="week36-doorgestuurd.pdf")
        self.assertTrue(second["duplicate"])
        self.assertEqual(len(second["sources"]), 1)
        self.assertEqual(second["source_id"], first["source_id"])
        self.assertEqual(sql(f"SELECT count(*) FROM public.hours_week_sources WHERE week_id={literal(week['id'])};"), "1")

    def test_source_requires_a_real_matching_object(self):
        self.open_week()
        marker = digest("never-uploaded")
        self.reject("hours_add_week_source", code="22023", user=self.admin, p_week_id=self.week_id,
                    p_content_hash=marker, p_file_name="ontbreekt.pdf", p_content_type=PDF)
        self.store(marker, mimetype="image/png", extension="pdf")
        self.reject("hours_add_week_source", code="22023", user=self.admin, p_week_id=self.week_id,
                    p_content_hash=marker, p_file_name="mismatch.pdf", p_content_type=PDF)
        self.store(marker, size=26214401)
        self.reject("hours_add_week_source", code="22023", user=self.admin, p_week_id=self.week_id,
                    p_content_hash=marker, p_file_name="tegroot.pdf", p_content_type=PDF)
        self.assertEqual(self.count("hours_week_sources"), "0")

    def test_only_supported_media_types_and_clean_names(self):
        self.open_week()
        marker = digest("unsupported")
        self.store(marker, extension="xlsx", mimetype="application/vnd.ms-excel")
        self.reject("hours_add_week_source", code="22023", user=self.admin, p_week_id=self.week_id,
                    p_content_hash=marker, p_file_name="uren.xlsx",
                    p_content_type="application/vnd.ms-excel")
        clean = digest("path-injection")
        self.store(clean)
        self.reject("hours_add_week_source", code="22023", user=self.admin, p_week_id=self.week_id,
                    p_content_hash=clean, p_file_name="../../etc/passwd", p_content_type=PDF)
        self.reject("hours_add_week_source", code="22023", user=self.admin, p_week_id=self.week_id,
                    p_content_hash="NOT-A-DIGEST", p_file_name="uren.pdf", p_content_type=PDF)

    def test_images_are_accepted_as_sources(self):
        self.open_week()
        photo, _ = self.add_source(name="urenbriefje.jpg", mimetype="image/jpeg", extension="jpg")
        self.assertEqual(photo["sources"][0]["content_type"], "image/jpeg")

    def test_sources_need_finance_rights_and_the_right_tenant(self):
        week = self.open_week()
        marker = digest("tenant-scope")
        self.store(marker)
        self.reject("hours_add_week_source", user=self.worker, p_week_id=self.week_id,
                    p_content_hash=marker, p_file_name="uren.pdf", p_content_type=PDF)
        self.reject("hours_add_week_source", user=self.other_admin, p_week_id=self.week_id,
                    p_content_hash=marker, p_file_name="uren.pdf", p_content_type=PDF)
        self.reject("hours_get_week_sources", user=self.worker, p_week_id=week["id"])
        self.reject("hours_get_week_sources", user=self.other_admin, p_week_id=week["id"])
        self.reject("hours_get_week_sources", role="anon", p_week_id=week["id"])

    def test_a_disabled_company_blocks_new_sources(self):
        self.open_week()
        marker = digest("disabled-company")
        self.store(marker)
        self.settings(p_enabled=False)
        self.reject("hours_add_week_source", code="22023", user=self.admin, p_week_id=self.week_id,
                    p_content_hash=marker, p_file_name="uren.pdf", p_content_type=PDF)

    def test_a_disabled_saas_module_blocks_sources_and_reads(self):
        week = self.open_week()
        source, _ = self.add_source()
        gate.toggle(self.org, False)
        self.reject("hours_get_week_sources", user=self.admin, p_week_id=week["id"])
        marker = digest("module-off")
        self.reject("hours_add_week_source", user=self.admin, p_week_id=self.week_id,
                    p_content_hash=marker, p_file_name="uren.pdf", p_content_type=PDF)
        self.assertEqual(sql("SELECT count(*) FROM public.hours_week_sources;",
                             role="authenticated", user=self.admin), "0")
        gate.toggle(self.org, True)
        restored = rpc("hours_get_week_sources", user=self.admin, p_week_id=week["id"])
        self.assertEqual(restored["sources"][0]["id"], source["source_id"])

    # --- storage policies --------------------------------------------------

    def test_storage_policies_scope_evidence_to_the_owning_tenant(self):
        week = self.open_week()
        allowed = f"{self.org}/{week['id']}/{digest('policy-ok')}.pdf"
        insert = (f"INSERT INTO storage.objects(bucket_id,name,metadata) VALUES "
                  f"('hours-sources',{{path}},jsonb_build_object('size',10,'mimetype',{literal(PDF)}));")
        sql(insert.format(path=literal(allowed)), role="authenticated", user=self.admin)
        self.assertEqual(sql(f"SELECT count(*) FROM storage.objects WHERE name={literal(allowed)};",
                             role="authenticated", user=self.admin), "1")
        for actor in (self.other_admin, self.worker):
            self.assertEqual(sql(f"SELECT count(*) FROM storage.objects WHERE name={literal(allowed)};",
                                 role="authenticated", user=actor), "0")
        foreign = f"{self.other_org}/{week['id']}/{digest('policy-foreign')}.pdf"
        self.assertIn("42501", sql(insert.format(path=literal(foreign)), role="authenticated",
                                   user=self.admin, expect_error=True))
        stranger = f"{self.org}/{uuid.uuid4()}/{digest('policy-week')}.pdf"
        self.assertIn("42501", sql(insert.format(path=literal(stranger)), role="authenticated",
                                   user=self.admin, expect_error=True))
        self.assertIn("42501", sql(insert.format(path=literal(allowed)), role="authenticated",
                                   user=self.worker, expect_error=True))
        gate.toggle(self.org, False)
        self.assertEqual(sql(f"SELECT count(*) FROM storage.objects WHERE name={literal(allowed)};",
                             role="authenticated", user=self.admin), "0")
        gate.toggle(self.org, True)

    def test_evidence_objects_cannot_be_replaced_or_removed(self):
        week = self.open_week()
        path = f"{self.org}/{week['id']}/{digest('immutable-object')}.pdf"
        sql(f"""INSERT INTO storage.objects(bucket_id,name,metadata) VALUES ('hours-sources',{literal(path)},
          jsonb_build_object('size',10,'mimetype',{literal(PDF)}));""", role="authenticated", user=self.admin)
        for statement in (f"UPDATE storage.objects SET name={literal(path + '-x')} WHERE name={literal(path)};",
                          f"DELETE FROM storage.objects WHERE name={literal(path)};"):
            self.assertIn("42501", sql(statement, role="authenticated", user=self.admin, expect_error=True))
        self.assertEqual(sql(f"SELECT count(*) FROM storage.objects WHERE name={literal(path)};"), "1")

    def test_the_bucket_stays_private_with_server_side_limits(self):
        row = json.loads(sql("""SELECT jsonb_build_object('public',public,'limit',file_size_limit,
          'types',to_jsonb(allowed_mime_types)) FROM storage.buckets WHERE id='hours-sources';"""))
        self.assertFalse(row["public"])
        self.assertEqual(row["limit"], 26214400)
        self.assertEqual(sorted(row["types"]), ["application/pdf", "image/jpeg", "image/png"])

    # --- proposals ---------------------------------------------------------

    def test_a_proposal_is_not_yet_an_hour(self):
        week = self.open_week()
        day = self.day_of(week)
        source, _ = self.add_source()
        sources = self.propose(source["source_id"], day["id"], minutes=465)
        proposal = self.only_proposal(sources)
        self.assertEqual(proposal["status"], "open")
        self.assertEqual(proposal["minutes"], 465)
        self.assertEqual(proposal["page_label"], "pagina 1")
        self.assertIsNone(proposal["applied_revision_id"])
        self.assertIsNone(self.revision_of(week["id"], day["id"]))
        self.assertEqual(self.count("hours_day_revisions"), "0")

    def test_a_proposal_must_belong_to_the_same_week_as_the_day(self):
        week = self.open_week()
        source, _ = self.add_source()
        self.add_placement(start="2026-09-14", end="2026-09-20")
        other = self.week(week_start="2026-09-14", enable=False)
        foreign_day = self.day_of(other)
        self.reject("hours_create_source_proposal", user=self.admin, p_source_id=source["source_id"],
                    p_day_id=foreign_day["id"], p_minutes=480, p_no_hours_reason=None, p_note=None,
                    p_source_input=None, p_page_label=None)

    def test_proposal_content_follows_the_same_input_rules(self):
        week = self.open_week()
        day = self.day_of(week)
        source, _ = self.add_source()
        base = dict(p_source_id=source["source_id"], p_day_id=day["id"], p_note=None,
                    p_source_input=None, p_page_label=None)
        self.reject("hours_create_source_proposal", code="22023", user=self.admin,
                    **{**base, "p_minutes": 0, "p_no_hours_reason": None})
        self.reject("hours_create_source_proposal", code="22023", user=self.admin,
                    **{**base, "p_minutes": 480, "p_no_hours_reason": "vrij"})
        self.reject("hours_create_source_proposal", code="22023", user=self.admin,
                    **{**base, "p_minutes": 1441, "p_no_hours_reason": None})
        self.reject("hours_create_source_proposal", code="22023", user=self.admin,
                    **{**base, "p_minutes": 480, "p_no_hours_reason": None,
                       "p_source_input": {"schemaVersion": 1, "unknown": []}})
        self.assertEqual(self.count("hours_source_proposals"), "0")

    def test_proposals_are_immutable_and_resolve_once(self):
        week = self.open_week()
        day = self.day_of(week)
        source, _ = self.add_source()
        sources = self.propose(source["source_id"], day["id"])
        proposal = self.only_proposal(sources)
        for statement in (f"UPDATE public.hours_source_proposals SET minutes=1 WHERE id={literal(proposal['id'])};",
                          f"UPDATE public.hours_source_proposals SET page_label='x' WHERE id={literal(proposal['id'])};",
                          f"DELETE FROM public.hours_source_proposals WHERE id={literal(proposal['id'])};"):
            self.assertIn("42501", sql(statement, expect_error=True))
        # A resolution without its actor and outcome is rejected by the table itself.
        self.assertIn("23514", sql(f"UPDATE public.hours_source_proposals SET status='applied' "
                                   f"WHERE id={literal(proposal['id'])};", expect_error=True))
        rpc("hours_discard_source_proposal", user=self.admin, p_proposal_id=proposal["id"],
            p_note="Onleesbare pauzeregel")
        self.assertIn("42501", sql(f"UPDATE public.hours_source_proposals SET status='open',resolved_at=NULL,"
                                   f"resolved_by=NULL WHERE id={literal(proposal['id'])};", expect_error=True))
        self.reject("hours_discard_source_proposal", code="22023", user=self.admin,
                    p_proposal_id=proposal["id"], p_note=None)
        self.reject("hours_apply_source_proposal", code="22023", user=self.admin,
                    p_proposal_id=proposal["id"], p_expected_revision_id=None)
        after = self.only_proposal(rpc("hours_get_week_sources", user=self.admin, p_week_id=week["id"]))
        self.assertEqual(after["status"], "discarded")
        self.assertEqual(after["resolution_note"], "Onleesbare pauzeregel")

    # --- applying ----------------------------------------------------------

    def test_applying_writes_exactly_one_revision_with_the_source_as_origin(self):
        week = self.open_week()
        day = self.day_of(week)
        source, _ = self.add_source(name="week36.pdf")
        shift = {"schemaVersion": 1, "shifts": [{"start": "08:00", "end": "16:30", "endDayOffset": 0,
                                                 "breaks": [{"start": "12:00", "end": "12:30"}]}]}
        sources = self.propose(source["source_id"], day["id"], minutes=480, source=shift, page="pagina 2")
        proposal = self.only_proposal(sources)
        applied = rpc("hours_apply_source_proposal", user=self.admin, p_proposal_id=proposal["id"],
                      p_expected_revision_id=None)
        self.assertTrue(applied["applied_created_revision"])
        revision = self.revision_of(week["id"], day["id"])
        self.assertEqual(revision["minutes"], 480)
        self.assertEqual(revision["revision_number"], 1)
        self.assertEqual(revision["source_input"], shift)
        self.assertEqual(revision["source_references"],
                         [{"kind": "upload", "label": "week36.pdf", "reference": "pagina 2"}])
        stored = self.only_proposal(applied["sources"])
        self.assertEqual(stored["status"], "applied")
        self.assertEqual(stored["applied_revision_id"], revision["id"])
        self.assertTrue(stored["applied_created_revision"])
        self.assertEqual(sql(f"SELECT count(*) FROM public.hours_day_revisions WHERE day_id={literal(day['id'])};"), "1")

    def test_applying_twice_never_writes_a_second_revision(self):
        week = self.open_week()
        day = self.day_of(week)
        source, _ = self.add_source()
        proposal = self.only_proposal(self.propose(source["source_id"], day["id"]))
        rpc("hours_apply_source_proposal", user=self.admin, p_proposal_id=proposal["id"],
            p_expected_revision_id=None)
        revision = self.revision_of(week["id"], day["id"])
        self.reject("hours_apply_source_proposal", code="22023", user=self.admin,
                    p_proposal_id=proposal["id"], p_expected_revision_id=revision["id"])
        self.assertEqual(sql(f"SELECT count(*) FROM public.hours_day_revisions WHERE day_id={literal(day['id'])};"), "1")

    def test_a_stale_day_version_conflicts_without_writing(self):
        week = self.open_week()
        day = self.day_of(week)
        source, _ = self.add_source()
        proposal = self.only_proposal(self.propose(source["source_id"], day["id"], minutes=300))
        self.save(day, minutes=420)
        current = self.revision_of(week["id"], day["id"])
        self.reject("hours_apply_source_proposal", code="PT409", user=self.admin,
                    p_proposal_id=proposal["id"], p_expected_revision_id=None)
        unchanged = self.revision_of(week["id"], day["id"])
        self.assertEqual(unchanged["id"], current["id"])
        self.assertEqual(unchanged["minutes"], 420)
        self.assertEqual(self.only_proposal(rpc("hours_get_week_sources", user=self.admin,
                                                p_week_id=week["id"]))["status"], "open")
        applied = rpc("hours_apply_source_proposal", user=self.admin, p_proposal_id=proposal["id"],
                      p_expected_revision_id=current["id"])
        self.assertTrue(applied["applied_created_revision"])
        self.assertEqual(self.revision_of(week["id"], day["id"])["minutes"], 300)

    def test_an_identical_proposal_resolves_without_a_new_version(self):
        week = self.open_week()
        day = self.day_of(week)
        source, _ = self.add_source()
        self.save(day, minutes=480)
        current = self.revision_of(week["id"], day["id"])
        rpc("hours_confirm_day", user=self.worker, p_day_id=day["id"],
            p_expected_revision_id=current["id"], p_decision="confirmed", p_note=None)
        proposal = self.only_proposal(self.propose(source["source_id"], day["id"], minutes=480))
        applied = rpc("hours_apply_source_proposal", user=self.admin, p_proposal_id=proposal["id"],
                      p_expected_revision_id=current["id"])
        self.assertFalse(applied["applied_created_revision"])
        after = self.revision_of(week["id"], day["id"])
        self.assertEqual(after["id"], current["id"])
        self.assertEqual(after["source_references"], [{"kind": "manual", "label": "Handmatige invoer"}])
        stored = self.only_proposal(applied["sources"])
        self.assertEqual(stored["status"], "applied")
        self.assertFalse(stored["applied_created_revision"])
        day_view = self.day_of(rpc("hours_get_week", user=self.admin, p_week_id=week["id"]))
        self.assertEqual(day_view["confirmation"]["decision"], "confirmed")

    def test_applying_a_correction_invalidates_the_earlier_agreement(self):
        week = self.open_week()
        day = self.day_of(week)
        source, _ = self.add_source(name="correctie-zaterdag.pdf")
        self.save(day, minutes=570)
        first = self.revision_of(week["id"], day["id"])
        rpc("hours_confirm_day", user=self.worker, p_day_id=day["id"],
            p_expected_revision_id=first["id"], p_decision="confirmed", p_note=None)
        proposal = self.only_proposal(self.propose(source["source_id"], day["id"], minutes=285))
        rpc("hours_apply_source_proposal", user=self.admin, p_proposal_id=proposal["id"],
            p_expected_revision_id=first["id"])
        internal = self.day_of(rpc("hours_get_week", user=self.admin, p_week_id=week["id"]))
        self.assertEqual(internal["current_revision"]["minutes"], 285)
        self.assertEqual(internal["current_revision"]["revision_number"], 2)
        self.assertIsNone(internal["confirmation"])
        self.assertEqual(len(internal["history"]), 2)
        portal = self.day_of(rpc("hours_get_week", user=self.worker, p_week_id=week["id"]))
        self.assertEqual(portal["current_revision"]["source_references"],
                         [{"kind": "upload", "label": "correctie-zaterdag.pdf", "reference": "pagina 1"}])
        self.assertEqual(portal["history"], [])

    def test_a_zero_hours_proposal_keeps_its_explicit_reason(self):
        week = self.open_week()
        day = self.day_of(week)
        source, _ = self.add_source()
        proposal = self.only_proposal(self.propose(source["source_id"], day["id"], minutes=0,
                                                   reason="Geen werk aangeleverd"))
        rpc("hours_apply_source_proposal", user=self.admin, p_proposal_id=proposal["id"],
            p_expected_revision_id=None)
        revision = self.revision_of(week["id"], day["id"])
        self.assertEqual(revision["minutes"], 0)
        self.assertEqual(revision["no_hours_reason"], "Geen werk aangeleverd")

    def test_applying_needs_manage_rights_and_the_owning_tenant(self):
        week = self.open_week()
        day = self.day_of(week)
        source, _ = self.add_source()
        proposal = self.only_proposal(self.propose(source["source_id"], day["id"]))
        for actor in (self.worker, self.other_admin):
            self.reject("hours_apply_source_proposal", user=actor, p_proposal_id=proposal["id"],
                        p_expected_revision_id=None)
            self.reject("hours_discard_source_proposal", user=actor, p_proposal_id=proposal["id"], p_note=None)
        sql(f"UPDATE public.profiles SET role='finance' WHERE id={literal(self.admin)};")
        sql(f"INSERT INTO public.user_permission_overrides(organization_id,user_id,permission_key,allowed) "
            f"VALUES ({literal(self.org)},{literal(self.admin)},'finance.manage',false);")
        self.reject("hours_apply_source_proposal", user=self.admin, p_proposal_id=proposal["id"],
                    p_expected_revision_id=None)
        self.assertEqual(self.count("hours_day_revisions"), "0")

    def test_the_portal_never_sees_sources_or_proposals(self):
        week = self.open_week()
        day = self.day_of(week)
        source, _ = self.add_source()
        proposal = self.only_proposal(self.propose(source["source_id"], day["id"]))
        rpc("hours_apply_source_proposal", user=self.admin, p_proposal_id=proposal["id"],
            p_expected_revision_id=None)
        for table in ("hours_week_sources", "hours_source_proposals"):
            self.assertEqual(sql(f"SELECT count(*) FROM public.{table};", role="authenticated",
                                 user=self.worker), "0")
            self.assertIn("42501", sql(f"SELECT count(*) FROM public.{table};", role="anon",
                                       expect_error=True))
        self.reject("hours_get_week_sources", user=self.worker, p_week_id=week["id"])

    def test_intake_writes_nothing_outside_the_hours_tables(self):
        week = self.open_week()
        day = self.day_of(week)
        source, _ = self.add_source()
        proposal = self.only_proposal(self.propose(source["source_id"], day["id"]))
        rpc("hours_apply_source_proposal", user=self.admin, p_proposal_id=proposal["id"],
            p_expected_revision_id=None)
        self.assertEqual(sql("SELECT to_regclass('public.timesheets') IS NULL;"), "t")
        self.assertEqual(self.count("hours_day_classifications"), "0")

    def test_permission_contract_covers_the_new_functions(self):
        functions = json.loads(sql("""SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,
          'name',p.proname,'schema',n.nspname)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname IN ('public','private') AND p.proname LIKE 'hours_%';"""))
        names = {f["signature"] for f in functions}
        for expected in ("hours_apply_source_proposal(uuid,uuid)", "hours_add_week_source(uuid,text,text,text)",
                         "hours_get_week_sources(uuid)", "hours_discard_source_proposal(uuid,text)",
                         "hours_create_source_proposal(uuid,uuid,integer,text,text,jsonb,text)"):
            self.assertIn(expected, names)
        for function in functions:
            signature = function["signature"]
            self.assertEqual(sql(f"SELECT has_function_privilege('anon',{literal(signature)},'EXECUTE');"), "f")
            service_only = function["schema"] == "public" and function["name"] in classification.SERVICE_FUNCTIONS
            self.assertEqual(sql(f"SELECT has_function_privilege('service_role',{literal(signature)},'EXECUTE');"),
                             "t" if service_only else "f")
            if service_only or function["schema"] == "private":
                allowed = signature in AUTHENTICATED_PRIVATE_HELPERS
                self.assertEqual(sql(f"SELECT has_function_privilege('authenticated',{literal(signature)},'EXECUTE');"),
                                 "t" if allowed else "f")

    def test_direct_table_writes_stay_impossible(self):
        week = self.open_week()
        source, _ = self.add_source()
        for table in ("hours_week_sources", "hours_source_proposals"):
            for role, user in (("anon", None), ("authenticated", self.admin), ("service_role", None)):
                for statement in (f"INSERT INTO public.{table} DEFAULT VALUES;",
                                  f"DELETE FROM public.{table};"):
                    self.assertIn("42501", sql(statement, role=role, user=user, expect_error=True))
        self.assertEqual(sql(f"SELECT count(*) FROM public.hours_week_sources WHERE week_id={literal(week['id'])};"), "1")

    def count(self, table):
        """Cases share one database; every count is scoped to the case tenant."""
        return sql(f"SELECT count(*) FROM public.{table} WHERE organization_id={literal(self.org)};")

    def reject(self, name, code="42501", user=None, role="authenticated", **params):
        return qa.HoursWorkflowTests.reject(self, name, code=code, user=user, role=role, **params)

    week = qa.HoursWorkflowTests.week
    settings = qa.HoursWorkflowTests.settings
    save = qa.HoursWorkflowTests.save
    add_placement = qa.HoursWorkflowTests.add_placement
    view = qa.HoursWorkflowTests.view


class IntakeFoundationRegression(gate.EnabledFoundationRegression):
    """The released foundation regressions; only the helper allowlist grows."""

    def test_rpc_and_private_helper_permissions_no_service_shortcut(self):
        IntakeTests.test_permission_contract_covers_the_new_functions(self)


class IntakeModuleGateTests(gate.ModuleGateTests):
    """The released SaaS-gate contract, extended to the intake RPCs and tables."""

    def prepare_all(self):
        day, calls = gate.ModuleGateTests.prepare_all(self)
        week_id = day["week_id"]
        marker = digest(f"gate-source-{week_id}")
        sql(f"""INSERT INTO storage.objects(bucket_id,name,metadata) VALUES ('hours-sources',
          {literal(f"{self.org}/{week_id}/{marker}.pdf")},
          jsonb_build_object('size',1024,'mimetype',{literal(PDF)}));""")
        added = rpc("hours_add_week_source", user=self.admin, p_week_id=week_id, p_content_hash=marker,
                    p_file_name="gate.pdf", p_content_type=PDF)
        stored = rpc("hours_create_source_proposal", user=self.admin, p_source_id=added["source_id"],
                     p_day_id=day["id"], p_minutes=420, p_no_hours_reason=None, p_note=None,
                     p_source_input=None, p_page_label="pagina 1")
        proposal = stored["sources"][0]["proposals"][0]["id"]
        calls.update({
            "hours_get_week_sources": dict(p_week_id=week_id),
            "hours_add_week_source": dict(p_week_id=week_id, p_content_hash=digest(f"gate-blocked-{week_id}"),
                                          p_file_name="geblokkeerd.pdf", p_content_type=PDF),
            "hours_create_source_proposal": dict(p_source_id=added["source_id"], p_day_id=day["id"], p_minutes=300,
                                                 p_no_hours_reason=None, p_note=None, p_source_input=None,
                                                 p_page_label=None),
            "hours_discard_source_proposal": dict(p_proposal_id=proposal, p_note=None),
            "hours_apply_source_proposal": dict(p_proposal_id=proposal,
                                                p_expected_revision_id=day["current_revision"]["id"]),
        })
        return day, calls

    def data_snapshot(self):
        return {table: json.loads(sql(f"SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), '[]') "
                                      f"FROM public.{table} t WHERE organization_id={literal(self.org)};"))
                for table in INTAKE_TABLES}

    def test_all_thirteen_tables_hide_disabled_data_and_deny_direct_writes(self):
        raise unittest.SkipTest("Superseded by the fifteen-table check that also covers sources and proposals")

    def test_all_fifteen_tables_hide_disabled_data_and_deny_direct_writes(self):
        self.prepare_all()
        before = self.data_snapshot()
        self.assertEqual(len(before), 15)
        self.assertTrue(all(before.values()), "Every gated table must have a nonempty synthetic sample")
        gate.toggle(self.org, False)
        for table in INTAKE_TABLES:
            with self.subTest(table=table):
                for actor in (self.admin, self.worker, self.other_admin):
                    self.assertEqual(sql(f"SELECT count(*) FROM public.{table} WHERE organization_id={literal(self.org)};",
                                         role="authenticated", user=actor), "0")
                for role, actor in (("anon", None), ("service_role", self.admin)):
                    self.assertIn("42501", sql(f"SELECT * FROM public.{table};", role=role, user=actor, expect_error=True))
                for role, actor in (("authenticated", self.admin), ("authenticated", self.worker), ("service_role", self.admin)):
                    for statement in (f"DELETE FROM public.{table};",
                                      f"UPDATE public.{table} SET organization_id=organization_id;",
                                      f"INSERT INTO public.{table} DEFAULT VALUES;"):
                        self.assertIn("42501", sql(statement, role=role, user=actor, expect_error=True))
        self.assertEqual(before, self.data_snapshot())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cleanup", action="store_true")
    parser.add_argument("--intake-only", action="store_true",
                        help="Development rerun; the final run also repeats the released regressions")
    args = parser.parse_args()
    if args.cleanup:
        qa.owned_container()
        subprocess.run(["docker", "rm", "-f", "-v", qa.CONTAINER], check=True)
        return 0
    paths = [ROOT / "supabase/migrations" / name for name in (
        "20260908090000_hours_workflow_foundation.sql",
        "20260908120000_hours_matrix_versions.sql",
        "20260908140000_hours_day_sources_and_classification.sql",
        "20260908160000_hours_workflow_organization_gate.sql",
        "20260908180000_hours_conflict_http_status.sql",
        "20260909090000_hours_week_sources_and_proposals.sql",
    )]
    fixtures = [ROOT / "tests/db/hours-workflow-fixture.sql", ROOT / "tests/db/hours-module-gate-fixture.sql",
                ROOT / "tests/db/hours-intake-fixture.sql"]
    harnesses = [ROOT / "scripts" / name for name in (
        "hours-workflow-db-test.py", "hours-classification-db-test.py",
        "hours-module-gate-db-test.py", "hours-intake-db-test.py")]
    engines = [ROOT / "supabase/functions/_shared/hours-calculation.ts",
               ROOT / "supabase/functions/_shared/hours-classification.ts"]
    harnesses.append(ROOT / "scripts/hours-conflict-db-test.py")
    sources = paths + fixtures + harnesses + engines
    hashes = {path: hashlib.sha256(path.read_bytes()).hexdigest() for path in sources}
    conflict.adapt_business_expectations()
    qa.ensure_container()
    if sql("SELECT to_regclass('public.organizations') IS NOT NULL;") == "t":
        raise RuntimeError("QA database already exists; inspect results and use --cleanup")
    for fixture in fixtures:
        sql(fixture.read_text())
    sql(f"INSERT INTO public.organizations(id,name) VALUES({literal(gate.NULL_FLAG_ORG)},'Synthetic pre-gate nullable organization'); "
        f"INSERT INTO auth.users(id) VALUES({literal(gate.NULL_FLAG_ADMIN)}); "
        f"INSERT INTO public.profiles(id,organization_id,role) VALUES({literal(gate.NULL_FLAG_ADMIN)},{literal(gate.NULL_FLAG_ORG)},'admin'); "
        f"INSERT INTO public.organization_modules(organization_id,module_name,enabled) VALUES({literal(gate.NULL_FLAG_ORG)},'uren-workflow',NULL);")
    for path in paths:
        sql(path.read_text())
        sql(path.read_text())  # DDL must be safe on a second application.
    sql(f"INSERT INTO auth.users(id) VALUES({literal(gate.SA)}); INSERT INTO public.superadmins(user_id) VALUES({literal(gate.SA)});")
    database = sql("SELECT version();")
    classes = [IntakeTests] if args.intake_only else [
        IntakeFoundationRegression, gate.EnabledClassificationRegression, IntakeModuleGateTests, IntakeTests]
    suite = unittest.TestSuite(unittest.defaultTestLoader.loadTestsFromTestCase(cls) for cls in classes)
    identifiers = [test.id() for group in suite for test in group]
    started = time.monotonic()
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    unchanged = all(hashlib.sha256(path.read_bytes()).hexdigest() == digest_value
                    for path, digest_value in hashes.items())
    report = {
        "success": result.wasSuccessful() and unchanged, "tests_run": result.testsRun,
        "tests": identifiers, "database": database, "image": qa.IMAGE,
        "container": qa.CONTAINER, "network": "none", "host_ports": [], "host_mounts": [],
        "released_regressions_included": not args.intake_only,
        "business_conflict_expectation_updates": conflict.EXPECTATION_UPDATES,
        "elapsed_seconds": round(time.monotonic() - started, 3),
        "migrations": [{"path": str(path.relative_to(ROOT)), "sha256": hashes[path]} for path in paths],
        "migration_applications_each": 2, "inputs_unchanged_during_run": unchanged,
        "fixtures": [{"path": str(path.relative_to(ROOT)), "sha256": hashes[path]} for path in fixtures],
        "harnesses": [{"path": str(path.relative_to(ROOT)), "sha256": hashes[path]} for path in harnesses],
        "failures": [{"test": test.id(), "traceback": trace} for test, trace in result.failures],
        "errors": [{"test": test.id(), "traceback": trace} for test, trace in result.errors],
        "production_writes": 0, "real_provider_calls": 0, "communications_sent": 0,
        "verified_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "run_command": "python3 scripts/hours-intake-db-test.py" + (" --intake-only" if args.intake_only else ""),
        "output_directory": str(OUTPUT.resolve()),
    }
    OUTPUT.mkdir(parents=True, exist_ok=True)
    path = OUTPUT / "hours-intake-db-qa-result.json"
    path.write_text(json.dumps(report, indent=2) + "\n")
    print("Result JSON:", path, flush=True)
    return 0 if report["success"] else 1


if __name__ == "__main__":
    sys.exit(main())
