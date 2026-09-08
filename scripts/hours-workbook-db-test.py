#!/usr/bin/env python3
"""Real PostgreSQL tests for spreadsheet sources and a whole reading recorded at once.

Runs the released hours migrations plus the page migrations and the new
spreadsheet migration in a disposable container, then the full
pages/intake/module-gate/classification/foundation regressions on top, so the
extended source contract is proven to leave the released behaviour intact.
No production writes, providers, network or host mounts.
Run: python3 scripts/hours-workbook-db-test.py
Cleanup: python3 scripts/hours-workbook-db-test.py --cleanup
HOURS_WORKBOOK_QA_OUTPUT selects a durable output directory.
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
OUTPUT = Path(os.environ.get("HOURS_WORKBOOK_QA_OUTPUT", ROOT / "test-results/hours-workbook-db"))
# Import through the released page harness so its cases run against this schema
# unchanged; only the expectations that genuinely moved are overridden.
spec = importlib.util.spec_from_file_location("hours_pages_qa", ROOT / "scripts/hours-pages-db-test.py")
pages = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pages)
intake = pages.intake
conflict = intake.conflict
gate = intake.gate
classification = gate.classification
qa = gate.qa
qa.CONTAINER = "ja-works-hours-workbook-test-20260911"
qa.LABEL = "ja-werkt-hours-workbook-qa"
qa.LABEL_VALUE = "20260911"
sql, rpc, literal = qa.sql, qa.rpc, qa.literal

PDF = intake.PDF
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
XLS = "application/vnd.ms-excel"
digest = intake.digest
WORKBOOK_TABLES = pages.PAGE_TABLES
EXPECTED_SIGNATURES = pages.EXPECTED_SIGNATURES + ("hours_create_source_proposals(uuid,jsonb)",)


class WorkbookTests(pages.PageTests):
    """Spreadsheet sources and bulk proposal recording, on top of the page contract."""

    def add_workbook(self, name="uren-week37.xlsx", sheets=2, mimetype=XLSX, extension="xlsx"):
        return self.add_source(name=name, mimetype=mimetype, extension=extension, pages=sheets)

    def read_into_proposals(self, source_id, entries, user=None, code=None):
        payload = json.dumps(entries)
        if code is not None:
            return self.reject("hours_create_source_proposals", code=code, user=user or self.admin,
                               p_source_id=source_id, p_entries=payload)
        return rpc("hours_create_source_proposals", user=user or self.admin,
                   p_source_id=source_id, p_entries=payload)

    def test_permission_contract_covers_the_new_functions(self):
        """The released check, with the bulk reader signature added."""
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

    def test_the_bucket_stays_private_with_server_side_limits(self):
        """The released check, with the spreadsheet types Storage now accepts."""
        row = json.loads(sql("""SELECT jsonb_build_object('public',public,'limit',file_size_limit,
          'types',to_jsonb(allowed_mime_types)) FROM storage.buckets WHERE id='hours-sources';"""))
        self.assertFalse(row["public"])
        self.assertEqual(row["limit"], 26214400)
        self.assertEqual(sorted(row["types"]),
                         ["application/pdf", XLS, XLSX, "image/jpeg", "image/png"])

    def test_a_workbook_is_accepted_and_keeps_its_worksheet_count(self):
        self.open_week()
        added, _ = self.add_workbook(sheets=3)
        row = added["sources"][0]
        self.assertEqual(row["content_type"], XLSX)
        self.assertEqual(row["page_count"], 3, "A worksheet is this format's page")
        legacy, _ = self.add_workbook(name="oud.xls", mimetype=XLS, extension="xls", sheets=None)
        stored = next(s for s in legacy["sources"] if s["file_name"] == "oud.xls")
        self.assertIsNone(stored["page_count"], "An unreadable count stays honestly unknown")

    def test_an_unsupported_file_type_is_still_refused(self):
        self.open_week()
        content_hash = digest(str(uuid.uuid4()))
        self.store(content_hash, extension="csv", mimetype="text/csv")
        self.reject("hours_add_week_source", code="22023", user=self.admin, p_week_id=self.week_id,
                    p_content_hash=content_hash, p_file_name="uren.csv", p_content_type="text/csv",
                    p_page_count=1)

    def test_a_whole_reading_lands_as_proposals_in_one_handling(self):
        week = self.two_member_week()
        first, second = week["members"][0], week["members"][1]
        source, _ = self.add_workbook(sheets=1)
        sources = self.read_into_proposals(source["source_id"], [
            {"day_id": first["days"][0]["id"], "minutes": 510, "page_number": 1,
             "page_label": "blad Week 37 · rij 3"},
            {"day_id": second["days"][1]["id"], "minutes": 0, "no_hours_reason": "Vrij",
             "page_number": 1, "page_label": "blad Week 37 · rij 4"},
        ])
        proposals = sources["sources"][0]["proposals"]
        self.assertEqual(len(proposals), 2)
        self.assertTrue(all(p["status"] == "open" for p in proposals), "A reading is still only proposals")
        self.assertEqual({p["member_id"] for p in proposals}, {first["id"], second["id"]})
        self.assertEqual(self.count("hours_day_revisions"), "0", "Reading a file writes no hours")

    def test_a_refused_entry_leaves_no_half_set_of_proposals(self):
        week = self.two_member_week()
        member = week["members"][0]
        source, _ = self.add_workbook(sheets=1)
        self.read_into_proposals(source["source_id"], [
            {"day_id": member["days"][0]["id"], "minutes": 480, "page_number": 1},
            {"day_id": member["days"][1]["id"], "minutes": 0},
        ], code="22023")
        self.assertEqual(self.count("hours_source_proposals"), "0",
                         "All or nothing: half a reading is worse than none")

    def test_the_same_workday_may_appear_only_once_in_one_reading(self):
        week = self.two_member_week()
        day = week["members"][0]["days"][0]
        source, _ = self.add_workbook(sheets=1)
        self.read_into_proposals(source["source_id"], [
            {"day_id": day["id"], "minutes": 480, "page_number": 1},
            {"day_id": day["id"], "minutes": 300, "page_number": 1},
        ], code="22023")
        self.assertEqual(self.count("hours_source_proposals"), "0")

    def test_a_reading_may_not_reach_a_day_outside_this_week(self):
        week = self.two_member_week()
        source, _ = self.add_workbook(sheets=1)
        self.add_placement(start="2026-09-14", end="2026-09-20")
        stranger = self.week(week_start="2026-09-14")["members"][0]["days"][0]["id"]
        self.week_id = week["id"]
        self.read_into_proposals(source["source_id"],
                                 [{"day_id": stranger, "minutes": 480, "page_number": 1}], code="42501")
        self.assertEqual(self.count("hours_source_proposals"), "0")

    def test_a_reading_of_a_judged_source_has_to_name_its_worksheet(self):
        week = self.two_member_week()
        member = week["members"][0]
        source, _ = self.add_workbook(sheets=2)
        self.set_page(source["source_id"], 1, "single", member=member["id"])
        self.read_into_proposals(source["source_id"],
                                 [{"day_id": member["days"][0]["id"], "minutes": 480}], code="22023")
        self.assertEqual(self.count("hours_source_proposals"), "0")
        self.read_into_proposals(source["source_id"], [
            {"day_id": member["days"][0]["id"], "minutes": 480, "page_number": 1}])
        self.assertEqual(self.count("hours_source_proposals"), "1")

    def test_a_worksheet_that_names_someone_else_forces_an_uncertain_assignment(self):
        week = self.two_member_week()
        first, second = week["members"][0], week["members"][1]
        source, _ = self.add_workbook(sheets=1)
        self.set_page(source["source_id"], 1, "single", member=first["id"])
        sources = self.read_into_proposals(source["source_id"], [
            {"day_id": second["days"][0]["id"], "minutes": 480, "page_number": 1,
             "assignment_uncertain": False}])
        proposal = self.only_proposal(sources)
        self.assertTrue(proposal["assignment_uncertain"],
                        "The server decides this, not the reader that sent it")
        self.reject("hours_apply_source_proposal", code="22023", user=self.admin,
                    p_proposal_id=proposal["id"], p_expected_revision_id=None)
        self.assertEqual(self.count("hours_day_revisions"), "0")

    def test_a_reader_may_report_its_own_doubt(self):
        week = self.two_member_week()
        member = week["members"][0]
        source, _ = self.add_workbook(sheets=1)
        sources = self.read_into_proposals(source["source_id"], [
            {"day_id": member["days"][0]["id"], "minutes": 480, "page_number": 1,
             "assignment_uncertain": True, "page_label": "blad Week 37 · rij 3"}])
        proposal = self.only_proposal(sources)
        self.assertTrue(proposal["assignment_uncertain"])
        self.assertEqual(rpc("hours_get_week_sources", user=self.admin,
                             p_week_id=week["id"])["undecided_assignments"], 1)

    def test_applying_a_read_proposal_takes_it_literally_with_the_worksheet_as_origin(self):
        week = self.two_member_week()
        member = week["members"][0]
        day = member["days"][0]
        source, _ = self.add_workbook(name="uren-week37.xlsx", sheets=1)
        sources = self.read_into_proposals(source["source_id"], [
            {"day_id": day["id"], "minutes": 465, "page_number": 1, "page_label": "blad Week 37 · rij 3",
             "source_input": {"schemaVersion": 1, "categories": [{"sourceCode": "OV1", "minutes": 465}]}}])
        proposal = self.only_proposal(sources)
        rpc("hours_apply_source_proposal", user=self.admin, p_proposal_id=proposal["id"],
            p_expected_revision_id=None)
        revision = self.revision_of(week["id"], day["id"])
        self.assertEqual(revision["minutes"], 465)
        self.assertEqual(revision["source_input"]["categories"], [{"sourceCode": "OV1", "minutes": 465}])
        self.assertEqual(revision["source_references"], [
            {"kind": "upload", "label": "uren-week37.xlsx", "reference": "pagina 1 · blad Week 37 · rij 3"}])
        self.assertEqual(self.count("hours_day_revisions"), "1")

    def test_a_portal_user_cannot_record_a_reading(self):
        week = self.two_member_week()
        source, _ = self.add_workbook(sheets=1)
        self.read_into_proposals(source["source_id"],
                                 [{"day_id": week["members"][0]["days"][0]["id"], "minutes": 480,
                                   "page_number": 1}], user=self.worker, code="42501")
        self.read_into_proposals(source["source_id"],
                                 [{"day_id": week["members"][0]["days"][0]["id"], "minutes": 480,
                                   "page_number": 1}], user=self.other_admin, code="42501")
        self.assertEqual(self.count("hours_source_proposals"), "0")


class WorkbookFoundationRegression(pages.PagesFoundationRegression):
    """The released foundation regressions against the extended signatures."""

    def test_rpc_and_private_helper_permissions_no_service_shortcut(self):
        WorkbookTests.test_permission_contract_covers_the_new_functions(self)


class WorkbookModuleGateTests(pages.PagesModuleGateTests):
    """The released SaaS-gate contract, extended to the bulk reader."""

    def prepare_all(self):
        day, calls = pages.PagesModuleGateTests.prepare_all(self)
        week_id = day["week_id"]
        marker = digest(f"gate-workbook-{week_id}")
        sql(f"""INSERT INTO storage.objects(bucket_id,name,metadata) VALUES ('hours-sources',
          {literal(f"{self.org}/{week_id}/{marker}.xlsx")},
          jsonb_build_object('size',4096,'mimetype',{literal(XLSX)}));""")
        source = rpc("hours_add_week_source", user=self.admin, p_week_id=week_id, p_content_hash=marker,
                     p_file_name="gate-workbook.xlsx", p_content_type=XLSX, p_page_count=1)["source_id"]
        calls["hours_create_source_proposals"] = dict(
            p_source_id=source, p_entries=json.dumps([{"day_id": day["id"], "minutes": 240, "page_number": 1}]))
        return day, calls


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cleanup", action="store_true")
    parser.add_argument("--workbook-only", action="store_true",
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
        "20260910100000_hours_page_decision_contradiction.sql",
        "20260910110000_hours_page_assignment_hardening.sql",
        "20260910120000_hours_pageless_proposals_and_take_over.sql",
        "20260911090000_hours_spreadsheet_sources.sql",
    )]
    fixtures = [ROOT / "tests/db/hours-workflow-fixture.sql", ROOT / "tests/db/hours-module-gate-fixture.sql",
                ROOT / "tests/db/hours-intake-fixture.sql"]
    harnesses = [ROOT / "scripts" / name for name in (
        "hours-workflow-db-test.py", "hours-classification-db-test.py",
        "hours-module-gate-db-test.py", "hours-conflict-db-test.py",
        "hours-intake-db-test.py", "hours-pages-db-test.py", "hours-workbook-db-test.py")]
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
    classes = [WorkbookTests] if args.workbook_only else [
        WorkbookFoundationRegression, gate.EnabledClassificationRegression, WorkbookModuleGateTests, WorkbookTests]
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
        "released_regressions_included": not args.workbook_only,
        "elapsed_seconds": round(time.monotonic() - started, 3),
        "migrations": [{"path": str(path.relative_to(ROOT)), "sha256": hashes[path]} for path in paths],
        "migration_applications_each": 2, "inputs_unchanged_during_run": unchanged,
        "fixtures": [{"path": str(path.relative_to(ROOT)), "sha256": hashes[path]} for path in fixtures],
        "harnesses": [{"path": str(path.relative_to(ROOT)), "sha256": hashes[path]} for path in harnesses],
        "failures": [{"test": test.id(), "traceback": trace} for test, trace in result.failures],
        "errors": [{"test": test.id(), "traceback": trace} for test, trace in result.errors],
        "production_writes": 0, "real_provider_calls": 0, "communications_sent": 0,
        "verified_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "run_command": "python3 scripts/hours-workbook-db-test.py" + (" --workbook-only" if args.workbook_only else ""),
        "output_directory": str(OUTPUT.resolve()),
    }
    OUTPUT.mkdir(parents=True, exist_ok=True)
    path = OUTPUT / "hours-workbook-db-qa-result.json"
    path.write_text(json.dumps(report, indent=2) + "\n")
    print("Result JSON:", path, flush=True)
    return 0 if report["success"] else 1


if __name__ == "__main__":
    sys.exit(main())
