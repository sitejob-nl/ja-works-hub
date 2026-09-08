#!/usr/bin/env python3
"""Real PostgreSQL tests for source pages and controlled assignment.

Runs the six released hours migrations plus the new page migration in a
disposable container, then the full intake/module-gate/classification/foundation
regressions on top, so the extended source and proposal contracts are proven to
leave the released behaviour intact.
No production writes, providers, network or host mounts.
Run: python3 scripts/hours-pages-db-test.py
Cleanup: python3 scripts/hours-pages-db-test.py --cleanup
HOURS_PAGES_QA_OUTPUT selects a durable output directory.
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
OUTPUT = Path(os.environ.get("HOURS_PAGES_QA_OUTPUT", ROOT / "test-results/hours-pages-db"))
# Import through the released intake harness so its cases run against this
# schema unchanged; only the expectations that genuinely moved are overridden.
spec = importlib.util.spec_from_file_location("hours_intake_qa", ROOT / "scripts/hours-intake-db-test.py")
intake = importlib.util.module_from_spec(spec)
spec.loader.exec_module(intake)
conflict = intake.conflict
gate = intake.gate
classification = gate.classification
qa = gate.qa
qa.CONTAINER = "ja-works-hours-pages-test-20260910"
qa.LABEL = "ja-werkt-hours-pages-qa"
qa.LABEL_VALUE = "20260910"
sql, rpc, literal, rpc_statement = qa.sql, qa.rpc, qa.literal, qa.rpc_statement

PDF = intake.PDF
digest = intake.digest
PAGE_TABLES = intake.INTAKE_TABLES + ("hours_source_pages",)
EXPECTED_SIGNATURES = (
    "hours_apply_source_proposal(uuid,uuid)",
    "hours_add_week_source(uuid,text,text,text,integer)",
    "hours_get_week_sources(uuid)",
    "hours_discard_source_proposal(uuid,text)",
    "hours_create_source_proposal(uuid,uuid,integer,text,text,jsonb,text,integer,boolean)",
    "hours_confirm_proposal_assignment(uuid,text)",
    "hours_set_source_page(uuid,integer,text,uuid,text)",
    "hours_create_page_proposals(uuid,integer,jsonb)",
)


class PageTests(intake.IntakeTests):
    """Pages and assignment on top of the released intake contract."""

    def add_source(self, content_hash=None, name="urenbriefje.pdf", mimetype=PDF, extension="pdf",
                   user=None, size=2048, pages=None):
        content_hash = content_hash or digest(str(uuid.uuid4()))
        self.store(content_hash, extension=extension, mimetype=mimetype, size=size)
        return rpc("hours_add_week_source", user=user or self.admin, p_week_id=self.week_id,
                   p_content_hash=content_hash, p_file_name=name, p_content_type=mimetype,
                   p_page_count=pages), content_hash

    def two_member_week(self):
        """One delivered file often covers a whole crew, not one person."""
        self.settings()
        self.add_placement(candidate=self.other_candidate)
        week = self.week()
        self.week_id = week["id"]
        self.assertEqual(len(week["members"]), 2)
        return week

    def propose(self, source_id, day_id, minutes=480, reason=None, note=None, source=None,
                page="pagina 1", user=None, page_number=None, uncertain=False):
        return rpc("hours_create_source_proposal", user=user or self.admin, p_source_id=source_id,
                   p_day_id=day_id, p_minutes=minutes, p_no_hours_reason=reason, p_note=note,
                   p_source_input=source, p_page_label=page, p_page_number=page_number,
                   p_assignment_uncertain=uncertain)

    def test_permission_contract_covers_the_new_functions(self):
        """The released check, with the signatures that genuinely moved."""
        functions = json.loads(sql("""SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,
          'name',p.proname,'schema',n.nspname)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname IN ('public','private') AND p.proname LIKE 'hours_%';"""))
        names = {f["signature"] for f in functions}
        for expected in EXPECTED_SIGNATURES:
            self.assertIn(expected, names)
        self.assertNotIn("hours_add_week_source(uuid,text,text,text)", names,
                         "The superseded signature must not stay callable next to the new one")
        for function in functions:
            signature = function["signature"]
            self.assertEqual(sql(f"SELECT has_function_privilege('anon',{literal(signature)},'EXECUTE');"), "f")
            service_only = function["schema"] == "public" and function["name"] in classification.SERVICE_FUNCTIONS
            self.assertEqual(sql(f"SELECT has_function_privilege('service_role',{literal(signature)},'EXECUTE');"),
                             "t" if service_only else "f")
            if service_only or function["schema"] == "private":
                allowed = signature in intake.AUTHENTICATED_PRIVATE_HELPERS
                self.assertEqual(sql(f"SELECT has_function_privilege('authenticated',{literal(signature)},'EXECUTE');"),
                                 "t" if allowed else "f")

    def test_one_source_carries_proposals_for_several_employees_and_days(self):
        week = self.two_member_week()
        first = week["members"][0]["days"][0]
        second = week["members"][1]["days"][1]
        source, _ = self.add_source(pages=2)
        self.propose(source["source_id"], first["id"], minutes=480, page_number=1)
        sources = self.propose(source["source_id"], second["id"], minutes=300, page_number=2)
        self.assertEqual(len(sources["sources"]), 1, "One file stays one source")
        proposals = sources["sources"][0]["proposals"]
        self.assertEqual([p["page_number"] for p in proposals], [1, 2])
        self.assertEqual({p["member_id"] for p in proposals},
                         {week["members"][0]["id"], week["members"][1]["id"]})
        rpc("hours_apply_source_proposal", user=self.admin, p_proposal_id=proposals[0]["id"],
            p_expected_revision_id=None)
        after = rpc("hours_get_week_sources", user=self.admin, p_week_id=week["id"])["sources"][0]["proposals"]
        self.assertEqual([p["status"] for p in after], ["applied", "open"],
                         "Applying one proposal leaves the other employee untouched")
        self.assertIsNotNone(self.revision_of(week["id"], first["id"]))
        self.assertIsNone(self.revision_of(week["id"], second["id"]))

    def test_an_uncertain_assignment_blocks_applying_until_someone_confirms_it(self):
        week = self.two_member_week()
        day = week["members"][0]["days"][0]
        source, _ = self.add_source(pages=1)
        proposal = self.only_proposal(self.propose(source["source_id"], day["id"], page_number=1, uncertain=True))
        self.assertTrue(proposal["assignment_uncertain"])
        self.assertIsNone(proposal["assignment_confirmed_at"])
        self.reject("hours_apply_source_proposal", code="22023", user=self.admin,
                    p_proposal_id=proposal["id"], p_expected_revision_id=None)
        self.assertIsNone(self.revision_of(week["id"], day["id"]), "A blocked application writes nothing")
        self.reject("hours_confirm_proposal_assignment", user=self.worker, p_proposal_id=proposal["id"], p_note=None)
        self.reject("hours_confirm_proposal_assignment", user=self.other_admin, p_proposal_id=proposal["id"], p_note=None)
        confirmed = self.only_proposal(rpc("hours_confirm_proposal_assignment", user=self.admin,
                                           p_proposal_id=proposal["id"],
                                           p_note="Naam vergeleken met de plaatsingslijst"))
        self.assertEqual(confirmed["status"], "open", "Confirming decides the doubt, it does not apply the proposal")
        self.assertIsNotNone(confirmed["assignment_confirmed_at"])
        self.assertIsNone(self.revision_of(week["id"], day["id"]))
        self.reject("hours_confirm_proposal_assignment", code="22023", user=self.admin,
                    p_proposal_id=proposal["id"], p_note=None)
        rpc("hours_apply_source_proposal", user=self.admin, p_proposal_id=proposal["id"],
            p_expected_revision_id=None)
        self.assertIsNotNone(self.revision_of(week["id"], day["id"]))

    def test_a_certain_assignment_has_nothing_to_confirm(self):
        week = self.two_member_week()
        day = week["members"][0]["days"][0]
        source, _ = self.add_source(pages=1)
        proposal = self.only_proposal(self.propose(source["source_id"], day["id"], page_number=1))
        self.assertFalse(proposal["assignment_uncertain"])
        self.reject("hours_confirm_proposal_assignment", code="22023", user=self.admin,
                    p_proposal_id=proposal["id"], p_note=None)
        rpc("hours_apply_source_proposal", user=self.admin, p_proposal_id=proposal["id"],
            p_expected_revision_id=None)
        self.assertIsNotNone(self.revision_of(week["id"], day["id"]))

    def set_page(self, source_id, page_number, assignment, member=None, note=None, user=None):
        return rpc("hours_set_source_page", user=user or self.admin, p_source_id=source_id,
                   p_page_number=page_number, p_assignment=assignment, p_member_id=member, p_note=note)

    def active_pages(self, sources, index=0):
        return sources["sources"][index]["pages"]

    def test_a_page_that_carries_one_employee_can_be_taken_over_at_once(self):
        week = self.two_member_week()
        member = week["members"][0]
        source, _ = self.add_source(pages=2)
        entries = [{"day_id": member["days"][0]["id"], "minutes": 480},
                   {"day_id": member["days"][1]["id"], "minutes": 0, "no_hours_reason": "Vrij"}]
        self.reject("hours_create_page_proposals", code="22023", user=self.admin,
                    p_source_id=source["source_id"], p_page_number=1, p_entries=json.dumps(entries))
        self.set_page(source["source_id"], 1, "single", member=member["id"], note="Eén briefje op deze pagina")
        sources = rpc("hours_create_page_proposals", user=self.admin, p_source_id=source["source_id"],
                      p_page_number=1, p_entries=json.dumps(entries))
        proposals = sources["sources"][0]["proposals"]
        self.assertEqual(len(proposals), 2)
        self.assertEqual({p["member_id"] for p in proposals}, {member["id"]})
        self.assertEqual({p["page_number"] for p in proposals}, {1})
        self.assertTrue(all(p["status"] == "open" for p in proposals), "A bulk take-over is still only proposals")
        self.assertEqual(self.count("hours_day_revisions"), "0")

    def test_a_page_with_two_employees_cannot_be_handed_to_one_of_them(self):
        week = self.two_member_week()
        first, second = week["members"][0], week["members"][1]
        source, _ = self.add_source(pages=1)
        self.propose(source["source_id"], first["days"][0]["id"], page_number=1)
        self.propose(source["source_id"], second["days"][0]["id"], page_number=1)
        self.reject("hours_set_source_page", code="22023", user=self.admin, p_source_id=source["source_id"],
                    p_page_number=1, p_assignment="single", p_member_id=first["id"], p_note=None)
        sources = self.set_page(source["source_id"], 1, "multiple")
        self.assertEqual(self.active_pages(sources)[0]["assignment"], "multiple")
        # And even with the page on one name, a bulk take-over may not reach another employee.
        other, _ = self.add_source(name="tweede.pdf", pages=1)
        self.set_page(other["source_id"], 1, "single", member=first["id"])
        self.reject("hours_create_page_proposals", code="22023", user=self.admin,
                    p_source_id=other["source_id"], p_page_number=1,
                    p_entries=json.dumps([{"day_id": second["days"][0]["id"], "minutes": 300}]))
        self.assertEqual(len(rpc("hours_get_week_sources", user=self.admin,
                                 p_week_id=week["id"])["sources"][1]["proposals"]), 0)

    def test_an_unclear_page_makes_every_proposal_on_it_undecided(self):
        week = self.two_member_week()
        member = week["members"][0]
        source, _ = self.add_source(pages=2)
        self.set_page(source["source_id"], 1, "unclear", note="Naam onleesbaar")
        undecided = self.only_proposal(self.propose(source["source_id"], member["days"][0]["id"], page_number=1))
        self.assertTrue(undecided["assignment_uncertain"],
                        "A page nobody could read may never quietly become certain")
        self.reject("hours_apply_source_proposal", code="22023", user=self.admin,
                    p_proposal_id=undecided["id"], p_expected_revision_id=None)
        certain = self.propose(source["source_id"], member["days"][1]["id"], page_number=2)
        self.assertFalse(certain["sources"][0]["proposals"][1]["assignment_uncertain"])
        replaced = self.set_page(source["source_id"], 1, "single", member=member["id"], note="Naam alsnog herkend")
        pages = self.active_pages(replaced)
        self.assertEqual([(page["page_number"], page["assignment"]) for page in pages], [(1, "single")])
        self.assertEqual(sql(f"SELECT count(*) FROM public.hours_source_pages "
                             f"WHERE organization_id={literal(self.org)} AND status='withdrawn';"), "1",
                         "The superseded decision stays visible as history")

    def test_an_undecided_assignment_stays_an_open_point_on_the_week(self):
        week = self.two_member_week()
        member = week["members"][0]
        source, _ = self.add_source(pages=1)
        empty = rpc("hours_get_week_sources", user=self.admin, p_week_id=week["id"])
        self.assertEqual((empty["open_proposals"], empty["undecided_assignments"]), (0, 0))
        sources = self.propose(source["source_id"], member["days"][0]["id"], page_number=1, uncertain=True)
        self.propose(source["source_id"], member["days"][1]["id"], page_number=1)
        stored = rpc("hours_get_week_sources", user=self.admin, p_week_id=week["id"])
        self.assertEqual((stored["open_proposals"], stored["undecided_assignments"]), (2, 1))
        proposal = self.only_proposal(sources)
        confirmed = rpc("hours_confirm_proposal_assignment", user=self.admin,
                        p_proposal_id=proposal["id"], p_note=None)
        self.assertEqual((confirmed["open_proposals"], confirmed["undecided_assignments"]), (2, 0),
                         "Confirming clears the open point without resolving the proposal")
        applied = rpc("hours_apply_source_proposal", user=self.admin, p_proposal_id=proposal["id"],
                      p_expected_revision_id=None)["sources"]
        self.assertEqual((applied["open_proposals"], applied["undecided_assignments"]), (1, 0))

    def test_page_decisions_stay_internal_and_write_only_through_the_backend(self):
        week = self.two_member_week()
        source, _ = self.add_source(pages=1)
        self.set_page(source["source_id"], 1, "single", member=week["members"][0]["id"])
        for role, user in (("anon", None), ("authenticated", self.admin), ("service_role", None)):
            for statement in ("INSERT INTO public.hours_source_pages DEFAULT VALUES;",
                              "DELETE FROM public.hours_source_pages;",
                              "UPDATE public.hours_source_pages SET assignment='multiple';"):
                self.assertIn("42501", sql(statement, role=role, user=user, expect_error=True))
        self.assertEqual(self.count("hours_source_pages"), "1")
        for actor in (self.worker, self.other_admin):
            self.assertEqual(sql("SELECT count(*) FROM public.hours_source_pages;",
                                 role="authenticated", user=actor), "0")
        self.reject("hours_set_source_page", user=self.worker, p_source_id=source["source_id"],
                    p_page_number=1, p_assignment="multiple", p_member_id=None, p_note=None)
        self.reject("hours_set_source_page", user=self.other_admin, p_source_id=source["source_id"],
                    p_page_number=1, p_assignment="multiple", p_member_id=None, p_note=None)
        self.reject("hours_create_page_proposals", user=self.worker, p_source_id=source["source_id"],
                    p_page_number=1, p_entries=json.dumps([{"day_id": week["members"][0]["days"][0]["id"],
                                                            "minutes": 480}]))
        self.assertEqual(sql("SELECT count(*) FROM public.hours_source_pages;",
                             role="authenticated", user=self.admin), "1")

    def test_the_frontend_that_is_still_live_keeps_working_after_this_migration(self):
        """The migration lands before the frontend does; the running app must not stall."""
        week = self.open_week()
        day = self.day_of(week)
        marker = digest("released-frontend-call")
        self.store(marker)
        added = rpc("hours_add_week_source", user=self.admin, p_week_id=self.week_id,
                    p_content_hash=marker, p_file_name="oude-client.pdf", p_content_type=PDF)
        self.assertIsNone(added["sources"][0]["page_count"], "An unknown page count stays honestly unknown")
        sources = rpc("hours_create_source_proposal", user=self.admin, p_source_id=added["source_id"],
                      p_day_id=day["id"], p_minutes=450, p_no_hours_reason=None, p_note=None,
                      p_source_input=None, p_page_label="pagina 1")
        proposal = self.only_proposal(sources)
        self.assertIsNone(proposal["page_number"])
        self.assertFalse(proposal["assignment_uncertain"])
        rpc("hours_apply_source_proposal", user=self.admin, p_proposal_id=proposal["id"],
            p_expected_revision_id=None)
        self.assertEqual(self.revision_of(week["id"], day["id"])["minutes"], 450)

    def test_a_source_records_how_many_pages_were_delivered(self):
        self.open_week()
        multi, _ = self.add_source(name="week36.pdf", pages=4)
        self.assertEqual(multi["sources"][0]["page_count"], 4)
        photo, _ = self.add_source(name="briefje.jpg", mimetype="image/jpeg", extension="jpg", pages=None)
        photo_row = next(s for s in photo["sources"] if s["file_name"] == "briefje.jpg")
        self.assertEqual(photo_row["page_count"], 1, "A photo is always exactly one page")

    def test_a_proposal_points_at_a_page_inside_the_delivered_source(self):
        week = self.open_week()
        day = self.day_of(week)
        source, _ = self.add_source(pages=3)
        sources = rpc("hours_create_source_proposal", user=self.admin, p_source_id=source["source_id"],
                      p_day_id=day["id"], p_minutes=480, p_no_hours_reason=None, p_note=None,
                      p_source_input=None, p_page_label="tabelregel 4", p_page_number=2)
        self.assertEqual(self.only_proposal(sources)["page_number"], 2)
        self.reject("hours_create_source_proposal", code="22023", user=self.admin,
                    p_source_id=source["source_id"], p_day_id=day["id"], p_minutes=480,
                    p_no_hours_reason=None, p_note=None, p_source_input=None, p_page_label=None,
                    p_page_number=4)


class PagesFoundationRegression(intake.IntakeFoundationRegression):
    """The released foundation regressions against the extended signatures."""

    def test_rpc_and_private_helper_permissions_no_service_shortcut(self):
        PageTests.test_permission_contract_covers_the_new_functions(self)


class PagesModuleGateTests(intake.IntakeModuleGateTests):
    """The released SaaS-gate contract, extended to pages and assignment."""

    def prepare_all(self):
        day, calls = intake.IntakeModuleGateTests.prepare_all(self)
        source = sql(f"SELECT id FROM public.hours_week_sources WHERE week_id={literal(day['week_id'])} LIMIT 1;")
        member = sql(f"SELECT member_id FROM public.hours_days WHERE id={literal(day['id'])};")
        rpc("hours_set_source_page", user=self.admin, p_source_id=source, p_page_number=1,
            p_assignment="single", p_member_id=member, p_note=None)
        uncertain = rpc("hours_create_source_proposal", user=self.admin, p_source_id=source,
                        p_day_id=day["id"], p_minutes=360, p_no_hours_reason=None, p_note=None,
                        p_source_input=None, p_page_label=None, p_page_number=1,
                        p_assignment_uncertain=True)["sources"][0]["proposals"][-1]["id"]
        calls.update({
            "hours_set_source_page": dict(p_source_id=source, p_page_number=1, p_assignment="multiple",
                                          p_member_id=None, p_note=None),
            "hours_create_page_proposals": dict(p_source_id=source, p_page_number=1,
                                                p_entries=json.dumps([{"day_id": day["id"], "minutes": 300}])),
            "hours_confirm_proposal_assignment": dict(p_proposal_id=uncertain, p_note=None),
        })
        return day, calls

    def data_snapshot(self):
        return {table: json.loads(sql(f"SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), '[]') "
                                      f"FROM public.{table} t WHERE organization_id={literal(self.org)};"))
                for table in PAGE_TABLES}

    def test_all_fifteen_tables_hide_disabled_data_and_deny_direct_writes(self):
        raise unittest.SkipTest("Superseded by the sixteen-table check that also covers source pages")

    def test_all_sixteen_tables_hide_disabled_data_and_deny_direct_writes(self):
        self.prepare_all()
        before = self.data_snapshot()
        self.assertEqual(len(before), 16)
        self.assertTrue(all(before.values()), "Every gated table must have a nonempty synthetic sample")
        gate.toggle(self.org, False)
        for table in PAGE_TABLES:
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
    parser.add_argument("--pages-only", action="store_true",
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
        "20260910090000_hours_source_pages_and_assignment.sql",
    )]
    fixtures = [ROOT / "tests/db/hours-workflow-fixture.sql", ROOT / "tests/db/hours-module-gate-fixture.sql",
                ROOT / "tests/db/hours-intake-fixture.sql"]
    harnesses = [ROOT / "scripts" / name for name in (
        "hours-workflow-db-test.py", "hours-classification-db-test.py",
        "hours-module-gate-db-test.py", "hours-conflict-db-test.py",
        "hours-intake-db-test.py", "hours-pages-db-test.py")]
    engines = [ROOT / "supabase/functions/_shared/hours-calculation.ts",
               ROOT / "supabase/functions/_shared/hours-classification.ts"]
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
    classes = [PageTests] if args.pages_only else [
        PagesFoundationRegression, gate.EnabledClassificationRegression, PagesModuleGateTests, PageTests]
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
        "released_regressions_included": not args.pages_only,
        "elapsed_seconds": round(time.monotonic() - started, 3),
        "migrations": [{"path": str(path.relative_to(ROOT)), "sha256": hashes[path]} for path in paths],
        "migration_applications_each": 2, "inputs_unchanged_during_run": unchanged,
        "fixtures": [{"path": str(path.relative_to(ROOT)), "sha256": hashes[path]} for path in fixtures],
        "harnesses": [{"path": str(path.relative_to(ROOT)), "sha256": hashes[path]} for path in harnesses],
        "failures": [{"test": test.id(), "traceback": trace} for test, trace in result.failures],
        "errors": [{"test": test.id(), "traceback": trace} for test, trace in result.errors],
        "production_writes": 0, "real_provider_calls": 0, "communications_sent": 0,
        "verified_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "run_command": "python3 scripts/hours-pages-db-test.py" + (" --pages-only" if args.pages_only else ""),
        "output_directory": str(OUTPUT.resolve()),
    }
    OUTPUT.mkdir(parents=True, exist_ok=True)
    path = OUTPUT / "hours-pages-db-qa-result.json"
    path.write_text(json.dumps(report, indent=2) + "\n")
    print("Result JSON:", path, flush=True)
    return 0 if report["success"] else 1


if __name__ == "__main__":
    sys.exit(main())
