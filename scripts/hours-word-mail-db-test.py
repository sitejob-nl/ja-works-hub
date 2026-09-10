#!/usr/bin/env python3
"""Real PostgreSQL tests for Word and e-mail sources and the receipt that ties them.

Runs the released hours migrations plus the new Word/mail migration in a
disposable container, then the full scan/client-week/workbook/pages/intake/
module-gate/classification/foundation regressions on top, so the widened source
contract is proven to leave the released behaviour intact.
No production writes, providers, network or host mounts.
Run: python3 scripts/hours-word-mail-db-test.py
Cleanup: python3 scripts/hours-word-mail-db-test.py --cleanup
HOURS_WORD_MAIL_QA_OUTPUT selects a durable output directory.
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
OUTPUT = Path(os.environ.get("HOURS_WORD_MAIL_QA_OUTPUT", ROOT / "test-results/hours-word-mail-db"))
# Import through the released scan harness so every earlier case runs against
# this schema unchanged; only the expectations that genuinely moved are overridden.
spec = importlib.util.spec_from_file_location("hours_scan_qa", ROOT / "scripts/hours-scan-db-test.py")
scan = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scan)
client = scan.client
workbook = client.workbook
pages = workbook.pages
intake = pages.intake
conflict = intake.conflict
gate = intake.gate
classification = gate.classification
qa = gate.qa
qa.CONTAINER = "ja-works-hours-word-mail-test-20260915"
qa.LABEL = "ja-werkt-hours-word-mail-qa"
qa.LABEL_VALUE = "20260915"
sql, rpc, literal = qa.sql, qa.rpc, qa.literal

PDF = intake.PDF
XLSX = workbook.XLSX
XLS = workbook.XLS
DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
DOC = "application/msword"
EML = "message/rfc822"
digest = intake.digest
# The five-parameter source signature is gone: a call that names those five
# parameters must resolve to the one function that also carries the receipt.
EXPECTED_SIGNATURES = tuple(
    "hours_add_week_source(uuid,text,text,text,integer,uuid)"
    if signature == "hours_add_week_source(uuid,text,text,text,integer)" else signature
    for signature in scan.EXPECTED_SIGNATURES)


class WordMailTests(scan.ScanTests):
    """Word and e-mail as delivered sources, on top of the released scan contract."""

    def add_mail(self, name="uren week 37.eml", pages_count=None):
        return self.add_source(name=name, mimetype=EML, extension="eml", pages=pages_count)

    def add_attachment(self, receipt_id, name="urenbriefje.xlsx", mimetype=XLSX, extension="xlsx",
                       pages_count=1, code=None, user=None, week=None):
        content_hash = digest(str(uuid.uuid4()))
        self.store(content_hash, extension=extension, mimetype=mimetype, week=week)
        params = dict(p_week_id=week or self.week_id, p_content_hash=content_hash, p_file_name=name,
                      p_content_type=mimetype, p_page_count=pages_count, p_received_with=receipt_id)
        if code is not None:
            return self.reject("hours_add_week_source", code=code, user=user or self.admin, **params)
        return rpc("hours_add_week_source", user=user or self.admin, **params), content_hash

    def source_named(self, projection, name):
        return next(source for source in projection["sources"] if source["file_name"] == name)

    def test_permission_contract_covers_the_new_functions(self):
        """The released check, with the source signature that now carries the receipt."""
        functions = json.loads(sql("""SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,
          'name',p.proname,'schema',n.nspname)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname IN ('public','private') AND p.proname LIKE 'hours_%';"""))
        names = {f["signature"] for f in functions}
        for expected in EXPECTED_SIGNATURES:
            self.assertIn(expected, names)
        self.assertEqual(sorted(name for name in names if name.startswith("hours_add_week_source")),
                         ["hours_add_week_source(uuid,text,text,text,integer,uuid)"],
                         "Exactly one source signature may stay callable, or a five-argument call is ambiguous")
        service_names = (classification.SERVICE_FUNCTIONS | client.CLIENT_SERVICE_FUNCTIONS
                         | {"hours_claim_source_reading", "hours_finish_source_reading"})
        for function in functions:
            signature = function["signature"]
            self.assertEqual(sql(f"SELECT has_function_privilege('anon',{literal(signature)},'EXECUTE');"), "f",
                             f"{signature} must never be reachable without a session")
            service_only = function["schema"] == "public" and function["name"] in service_names
            self.assertEqual(sql(f"SELECT has_function_privilege('service_role',{literal(signature)},'EXECUTE');"),
                             "t" if service_only else "f")
            if service_only or function["schema"] == "private":
                allowed = signature in intake.AUTHENTICATED_PRIVATE_HELPERS
                self.assertEqual(sql(f"SELECT has_function_privilege('authenticated',{literal(signature)},'EXECUTE');"),
                                 "t" if allowed else "f",
                                 f"{signature} must not be callable by a logged-in user")

    def test_the_bucket_stays_private_with_server_side_limits(self):
        """The released check, with the Word and mail types Storage now accepts."""
        self.test_the_bucket_stays_private_with_the_word_and_mail_types()

    def test_the_bucket_stays_private_with_the_word_and_mail_types(self):
        row = json.loads(sql("""SELECT jsonb_build_object('public',public,'limit',file_size_limit,
          'types',to_jsonb(allowed_mime_types)) FROM storage.buckets WHERE id='hours-sources';"""))
        self.assertFalse(row["public"])
        self.assertEqual(row["limit"], 26214400)
        self.assertEqual(sorted(row["types"]),
                         sorted(["application/pdf", "image/jpeg", "image/png", XLSX, XLS, DOCX, DOC, EML]))

    # --- what may be delivered ---------------------------------------------

    def test_word_and_mail_are_accepted_as_sources(self):
        self.open_week()
        word, _ = self.add_source(name="uren week 37.docx", mimetype=DOCX, extension="docx", pages=2)
        stored = self.source_named(word, "uren week 37.docx")
        self.assertEqual(stored["content_type"], DOCX)
        self.assertEqual(stored["page_count"], 2, "A table is this format's page")
        legacy, _ = self.add_source(name="oud.doc", mimetype=DOC, extension="doc", pages=None)
        self.assertIsNone(self.source_named(legacy, "oud.doc")["page_count"],
                          "An unreadable count stays honestly unknown")

    def test_a_message_is_always_one_page_whatever_the_browser_claims(self):
        self.open_week()
        added, _ = self.add_mail(pages_count=9)
        self.assertEqual(self.source_named(added, "uren week 37.eml")["page_count"], 1,
                         "The body of one message is one page; the browser does not get to say otherwise")

    def test_an_unsupported_file_type_is_still_refused(self):
        self.open_week()
        content_hash = digest(str(uuid.uuid4()))
        self.store(content_hash, extension="csv", mimetype="text/csv")
        self.reject("hours_add_week_source", code="22023", user=self.admin, p_week_id=self.week_id,
                    p_content_hash=content_hash, p_file_name="uren.csv", p_content_type="text/csv",
                    p_page_count=1)

    def test_the_client_endpoint_does_not_gain_word_or_mail(self):
        """A client week page delivers timesheets, not the office's mailbox."""
        for content_type in (DOCX, DOC, EML):
            self.assertIsNone(sql(f"SELECT private.hours_source_extension({literal(content_type)});") or None,
                              f"{content_type} must stay outside the client delivery path")

    # --- one receipt --------------------------------------------------------

    def test_an_attachment_names_the_message_it_arrived_with(self):
        self.open_week()
        mail, _ = self.add_mail()
        receipt = self.source_named(mail, "uren week 37.eml")
        after, _ = self.add_attachment(receipt["id"])
        attachment = self.source_named(after, "urenbriefje.xlsx")
        self.assertEqual(attachment["received_with_source_id"], receipt["id"])
        self.assertIsNone(self.source_named(after, "uren week 37.eml")["received_with_source_id"],
                          "The message itself arrived on its own")

    def test_only_a_message_can_carry_attachments(self):
        self.open_week()
        sheet, _ = self.add_source(name="uren.xlsx", mimetype=XLSX, extension="xlsx", pages=1)
        self.add_attachment(self.source_named(sheet, "uren.xlsx")["id"], name="tweede.xlsx", code="22023")

    def test_a_receipt_is_one_level_deep(self):
        self.open_week()
        mail, _ = self.add_mail()
        receipt = self.source_named(mail, "uren week 37.eml")
        after, _ = self.add_attachment(receipt["id"])
        attachment = self.source_named(after, "urenbriefje.xlsx")
        self.add_attachment(attachment["id"], name="derde.xlsx", code="22023")

    def test_an_attachment_cannot_point_at_a_message_of_another_week(self):
        self.open_week()
        mail, _ = self.add_mail()
        receipt = self.source_named(mail, "uren week 37.eml")
        self.add_placement(start="2026-09-14", end="2026-09-20")
        second = self.week(week_start="2026-09-14")
        self.week_id = second["id"]
        self.add_attachment(receipt["id"], name="andere-week.xlsx", code="22023", week=second["id"])
        self.assertEqual(sql(f"""SELECT count(*) FROM public.hours_week_sources
          WHERE week_id={literal(second["id"])};"""), "0",
                         "A refused receipt writes no source at all")

    def test_the_receipt_is_tied_to_the_same_week_by_the_schema(self):
        """Not a rule a later caller can forget: the key carries the week and the organisation."""
        definition = sql("""SELECT pg_get_constraintdef(oid) FROM pg_constraint
          WHERE conrelid='public.hours_week_sources'::regclass AND conname='hours_week_sources_receipt_fkey';""")
        self.assertIn("(received_with_source_id, week_id, organization_id)", definition)
        self.assertIn("hours_week_sources(id, week_id, organization_id)", definition)

    def test_an_unknown_receipt_is_refused_rather_than_ignored(self):
        self.open_week()
        self.add_attachment(str(uuid.uuid4()), code="22023")

    def test_a_source_cannot_be_its_own_receipt(self):
        """The check is on the table, so no later caller can talk its way past it."""
        self.open_week()
        mail, _ = self.add_mail()
        receipt = self.source_named(mail, "uren week 37.eml")["id"]
        sql(f"""UPDATE public.hours_week_sources SET received_with_source_id=id
          WHERE id={literal(receipt)};""", expect_error=True)

    # --- rollout order ------------------------------------------------------

    def test_the_previous_five_parameter_call_still_resolves(self):
        """The migration goes live before the frontend; the running version must keep working."""
        self.open_week()
        content_hash = digest(str(uuid.uuid4()))
        self.store(content_hash, extension="pdf", mimetype=PDF)
        added = rpc("hours_add_week_source", user=self.admin, p_week_id=self.week_id,
                    p_content_hash=content_hash, p_file_name="oude-aanroep.pdf", p_content_type=PDF,
                    p_page_count=2)
        stored = self.source_named(added, "oude-aanroep.pdf")
        self.assertEqual(stored["page_count"], 2)
        self.assertIsNone(stored["received_with_source_id"],
                          "A call without the receipt parameter delivers a file that arrived on its own")

    def test_the_portal_still_sees_no_source_at_all(self):
        """The widened intake changes nothing about what an employee may read."""
        self.open_week()
        mail, _ = self.add_mail()
        self.add_attachment(self.source_named(mail, "uren week 37.eml")["id"])
        self.assertEqual(sql("SELECT count(*) FROM public.hours_week_sources;",
                             role="authenticated", user=self.worker), "0")
        self.reject("hours_get_week_sources", code="42501", user=self.worker, p_week_id=self.week_id)


class WordMailFoundationRegression(scan.ScanFoundationRegression):
    """The released foundation contract, unchanged on the Word/mail schema."""

    def test_rpc_and_private_helper_permissions_no_service_shortcut(self):
        """Re-pointed at this ticket's list: the five-parameter source signature is gone."""
        WordMailTests.test_permission_contract_covers_the_new_functions(self)


class WordMailModuleGateTests(scan.ScanModuleGateTests):
    """The released SaaS module gate, with the reading RPCs it did not yet cover."""

    def prepare_all(self):
        """The released preparation, plus the four reading functions of the scan release.

        Those arrived without a gate case of their own, so a switched-off module
        was never proven to close them. They are internal or service-role, but
        the whole point of the gate is that no route stays open behind it.
        """
        day, calls = scan.ScanModuleGateTests.prepare_all(self)
        week_id = day["week_id"]
        marker = digest(f"gate-scan-{week_id}")
        sql(f"""INSERT INTO storage.objects(bucket_id,name,metadata) VALUES ('hours-sources',
          {literal(f"{self.org}/{week_id}/{marker}.jpg")},
          jsonb_build_object('size',4096,'mimetype',{literal("image/jpeg")}));""")
        source = rpc("hours_add_week_source", user=self.admin, p_week_id=week_id, p_content_hash=marker,
                     p_file_name="gate-scan.jpg", p_content_type="image/jpeg")["source_id"]
        proposal = rpc("hours_create_source_proposal", user=self.admin, p_source_id=source,
                       p_day_id=day["id"], p_minutes=240, p_no_hours_reason=None, p_note=None,
                       p_source_input=None, p_page_label="regel 1", p_page_number=1)
        proposal_id = next(entry for group in proposal["sources"] for entry in group["proposals"]
                           if group["id"] == source)["id"]
        calls.update({
            "hours_get_source_reading_context": dict(p_source_id=source),
            "hours_confirm_proposal_values": dict(p_proposal_id=proposal_id, p_note=None),
            "hours_claim_source_reading": dict(p_source_id=source, p_actor_id=self.admin),
            "hours_finish_source_reading": dict(p_reading_id=str(uuid.uuid4()), p_status="failed",
                                                p_request_id=None, p_cost_cents=None, p_lines=None,
                                                p_error_code="GATE"),
        })
        return day, calls


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cleanup", action="store_true")
    parser.add_argument("--new-only", action="store_true",
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
        "20260912090000_hours_client_week_links.sql",
        "20260913090000_hours_scan_reading.sql",
        "20260914090000_hours_scan_reading_log.sql",
        "20260915090000_hours_word_and_mail_sources.sql",
    )]
    fixtures = [ROOT / "tests/db/hours-workflow-fixture.sql", ROOT / "tests/db/hours-module-gate-fixture.sql",
                ROOT / "tests/db/hours-intake-fixture.sql"]
    harnesses = [ROOT / "scripts" / name for name in (
        "hours-workflow-db-test.py", "hours-classification-db-test.py",
        "hours-module-gate-db-test.py", "hours-conflict-db-test.py",
        "hours-intake-db-test.py", "hours-pages-db-test.py", "hours-workbook-db-test.py",
        "hours-client-week-db-test.py", "hours-scan-db-test.py", "hours-word-mail-db-test.py")]
    engines = [ROOT / "supabase/functions/_shared/hours-calculation.ts",
               ROOT / "supabase/functions/_shared/hours-classification.ts",
               ROOT / "supabase/functions/_shared/hours-scan.ts"]
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
    classes = [WordMailTests] if args.new_only else [
        WordMailFoundationRegression, gate.EnabledClassificationRegression,
        WordMailModuleGateTests, WordMailTests]
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
        "released_regressions_included": not args.new_only,
        "elapsed_seconds": round(time.monotonic() - started, 3),
        "migrations": [{"path": str(path.relative_to(ROOT)), "sha256": hashes[path]} for path in paths],
        "migration_applications_each": 2, "inputs_unchanged_during_run": unchanged,
        "fixtures": [{"path": str(path.relative_to(ROOT)), "sha256": hashes[path]} for path in fixtures],
        "harnesses": [{"path": str(path.relative_to(ROOT)), "sha256": hashes[path]} for path in harnesses],
        "failures": [{"test": test.id(), "traceback": trace} for test, trace in result.failures],
        "errors": [{"test": test.id(), "traceback": trace} for test, trace in result.errors],
        "production_writes": 0, "real_provider_calls": 0, "communications_sent": 0,
        "verified_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "run_command": "python3 scripts/hours-word-mail-db-test.py" + (" --new-only" if args.new_only else ""),
        "output_directory": str(OUTPUT.resolve()),
    }
    OUTPUT.mkdir(parents=True, exist_ok=True)
    path = OUTPUT / "hours-word-mail-db-qa-result.json"
    path.write_text(json.dumps(report, indent=2) + "\n")
    print("Result JSON:", path, flush=True)
    return 0 if report["success"] else 1


if __name__ == "__main__":
    sys.exit(main())
