#!/usr/bin/env python3
"""Five-migration regression QA for explicit HTTP 409 business conflicts.

Runs the existing 100 gate/regression cases against the final schema. Only the
listed business-conflict expectations are changed in memory; previous stage
files and actual database errors are never modified or translated.
Uses an owned no-network Docker container, synthetic data and no production API.
HOURS_CONFLICT_QA_OUTPUT selects a persistent output directory.
"""

import argparse
import ast
import concurrent.futures
import datetime
import hashlib
import importlib.util
import inspect
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import textwrap
import time
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = Path(os.environ.get("HOURS_CONFLICT_QA_OUTPUT", ROOT / "test-results/hours-conflict-db"))
spec = importlib.util.spec_from_file_location("hours_gate_qa", ROOT / "scripts/hours-module-gate-db-test.py")
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)
qa, classification = gate.qa, gate.classification
qa.CONTAINER = "ja-works-hours-conflict-test-20260908"
qa.LABEL = "ja-werkt-hours-conflict-qa"
qa.LABEL_VALUE = "20260908"
sql, rpc, literal, rpc_statement = qa.sql, qa.rpc, qa.literal, qa.rpc_statement
CATALOG_BEFORE, CATALOG_AFTER = {}, {}
EXPECTATION_UPDATES = []

EXPECTED_BUSINESS_TESTS = {
    qa.HoursWorkflowTests: {
        "test_revision_history_append_and_stale_update_rejected",
        "test_concurrent_revision_compare_and_swap_exactly_one_winner",
        "test_confirmation_exact_revision_and_update_invalidates_it",
        "test_review_exact_revision_and_update_invalidates_it",
        "test_empty_day_cannot_confirm_or_review",
        "test_settings_version_conflict_and_snapshot_unchanged",
        "test_batch_stale_revision_rolls_back_every_confirmation",
        "test_batch_confirmation_concurrent_with_correction_cannot_confirm_new_revision",
    },
    classification.ClassificationTests: {
        "test_source_compare_and_swap_and_portal_writes_denied",
        "test_context_requires_internal_manage_and_own_current_day",
        "test_day_revision_changed_between_read_and_finalize_rejected",
        "test_missing_matrix_context_stale_after_first_matrix_created",
        "test_cao_binding_change_between_context_and_finalize_rejected",
        "test_new_effective_matrix_publication_makes_unpinned_context_stale",
        "test_service_actor_claims_restore_after_success_and_caught_error",
        "test_finalize_racing_day_correction_cannot_classify_new_revision",
    },
}


def adapt_business_expectations():
    """Update exact expected literals, never SQL outputs or exception handling."""
    class Expectations(ast.NodeTransformer):
        def __init__(self):
            self.count = 0

        def visit_Constant(self, node):
            if node.value == "40001":
                node.value = "PT409"
                self.count += 1
            elif isinstance(node.value, str) and "EXCEPTION WHEN SQLSTATE '40001' THEN NULL;" in node.value:
                node.value = node.value.replace("EXCEPTION WHEN SQLSTATE '40001' THEN NULL;", "EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;")
                self.count += 1
            return node

    for cls, expected in EXPECTED_BUSINESS_TESTS.items():
        found = {name for name, method in vars(cls).items() if name.startswith("test_") and "40001" in inspect.getsource(method)}
        if found != expected:
            raise RuntimeError(f"Business conflict expectation inventory changed: {cls.__name__}: {found ^ expected}")
        for name in sorted(expected):
            original = getattr(cls, name)
            tree = ast.parse(textwrap.dedent(inspect.getsource(original)))
            transform = Expectations()
            tree = transform.visit(tree)
            ast.fix_missing_locations(tree)
            if transform.count != 1:
                raise RuntimeError(f"Expected exactly one explicit conflict expectation in {name}")
            namespace = dict(original.__globals__)
            exec(compile(tree, f"<HTTP409 expectation: {cls.__name__}.{name}>", "exec"), namespace)
            setattr(cls, name, namespace[name])
            EXPECTATION_UPDATES.append({"class": cls.__name__, "test": name, "expected_before": "40001", "expected_after": "PT409"})


def catalog():
    rows = json.loads(sql("""SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,
      'definition',pg_get_functiondef(p.oid),'acl',p.proacl::text,'owner',p.proowner::regrole::text))
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname IN ('public','private') AND (p.proname LIKE 'hours_%' OR p.proname='sa_set_hours_workflow_enabled');"""))
    return {row["signature"]: row for row in rows}


class HTTPConflictTests(gate.ModuleGateTests):
    """Only methods defined here are selected, avoiding inherited duplicate QA."""
    setUp = gate.enabled_setup

    def test_catalog_changes_only_thirteen_business_errcodes_and_preserves_all_acls(self):
        self.assertEqual(CATALOG_BEFORE.keys(), CATALOG_AFTER.keys())
        changed, raises = [], 0
        for signature, before in CATALOG_BEFORE.items():
            after = CATALOG_AFTER[signature]
            self.assertEqual(before["acl"], after["acl"], signature)
            self.assertEqual(before["owner"], after["owner"], signature)
            expected, count = re.subn(r"errcode\s*=\s*'40001'", "errcode = 'PT409'", before["definition"])
            self.assertEqual(expected, after["definition"], signature)
            if count:
                changed.append(signature)
                raises += count
        self.assertEqual(len(changed), 12)
        self.assertEqual(raises, 13)

    def test_stale_day_save_portal_bulk_context_and_finalize_return_pt409_without_writes(self):
        day = self.prepared()
        self.create_matrix()
        final_args = self.final_args(self.context(day))
        old = day["current_revision"]["id"]
        self.save_source(day, None, minutes=420)
        before = self.data_snapshot()
        calls = {
            "hours_save_day": dict(p_day_id=day["id"], p_expected_revision_id=old, p_minutes=300, p_no_hours_reason=None, p_note=None),
            "hours_save_day_source": dict(p_day_id=day["id"], p_expected_revision_id=old, p_minutes=300, p_no_hours_reason=None, p_note=None, p_source_input=None),
            "hours_confirm_day": dict(p_day_id=day["id"], p_expected_revision_id=old, p_decision="confirmed", p_note=None),
            "hours_confirm_days": dict(p_week_id=day["week_id"], p_revisions=[{"day_id":day["id"],"revision_id":old}], p_note=None),
            "hours_review_day": dict(p_day_id=day["id"], p_expected_revision_id=old, p_status="checked", p_note=None),
            "hours_get_day_classification_context": dict(p_day_id=day["id"], p_expected_revision_id=old),
            "hours_finalize_day_classification": final_args,
        }
        for name, params in calls.items():
            with self.subTest(rpc=name):
                service = name == "hours_finalize_day_classification"
                actor = self.worker if name.startswith("hours_confirm") else self.admin
                error = self.reject(name, code="PT409", role="service_role" if service else "authenticated", user=None if service else actor, **params)
                self.assertNotIn("40001", error)
                self.assertEqual(before, self.data_snapshot())

    def test_stale_settings_matrix_draft_publish_and_binding_return_pt409_without_history(self):
        settings = self.settings()
        self.settings(p_submission_time="11:00")
        stale_settings = dict(p_company_id=self.company, p_expected_version=settings["version"], p_enabled=True,
                              p_submission_day_offset=7, p_submission_time="10:00", p_confirmation_day_offset=8, p_confirmation_time="12:00")
        matrix = rpc("hours_create_matrix", user=self.admin, p_scope="cao", p_company_id=None, p_name="Synthetic stale matrix")
        matrix = rpc("hours_create_matrix_draft", user=self.admin, p_matrix_id=matrix["id"], p_valid_from="2026-01-01", p_valid_until=None, p_config=classification.matrix_config())
        draft = matrix["versions"][0]
        stale_draft = dict(p_version_id=draft["id"], p_expected_revision=draft["revision"], p_valid_from="2026-01-01", p_valid_until=None, p_config=classification.matrix_config())
        rpc("hours_save_matrix_draft", user=self.admin, **{**stale_draft, "p_config": classification.matrix_config("1.5")})
        self.bind(matrix["id"])
        before = self.data_snapshot()
        calls = {
            "hours_set_company_settings": stale_settings,
            "hours_save_matrix_draft": stale_draft,
            "hours_publish_matrix_version": dict(p_version_id=draft["id"], p_expected_revision=draft["revision"], p_confirmed=True),
            "hours_set_company_matrix_binding": dict(p_company_id=self.company, p_expected_version=0, p_cao_matrix_id=None),
        }
        for name, params in calls.items():
            with self.subTest(rpc=name):
                error = self.reject(name, code="PT409", user=self.admin, **params)
                self.assertNotIn("40001", error)
                self.assertEqual(before, self.data_snapshot())

    def test_incomplete_week_snapshot_returns_pt409_and_rolls_back_week(self):
        self.settings()
        function = "qa_skip_member_" + uuid.uuid4().hex
        sql(f"CREATE FUNCTION public.{function}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.organization_id={literal(self.org)}::uuid THEN RETURN NULL; END IF; RETURN NEW; END $$; CREATE TRIGGER {function} BEFORE INSERT ON public.hours_week_members FOR EACH ROW EXECUTE FUNCTION public.{function}();")
        try:
            error = self.reject("hours_create_week", user=self.admin, code="PT409", p_company_id=self.company, p_week_start="2026-09-07")
            self.assertNotIn("40001", error)
            self.assertEqual(sql(f"SELECT count(*) FROM public.hours_weeks WHERE organization_id={literal(self.org)};"), "0")
        finally:
            sql(f"DROP TRIGGER {function} ON public.hours_week_members; DROP FUNCTION public.{function}();")

    def test_native_postgres_serialization_stays_40001(self):
        name = "http-conflict-native-" + uuid.uuid4().hex
        statement = (f"SET application_name={literal(name)}; BEGIN ISOLATION LEVEL SERIALIZABLE; "
                     f"SELECT settings FROM public.organizations WHERE id={literal(self.org)}; SELECT pg_sleep(1.2); "
                     f"UPDATE public.organizations SET settings='{{\"synthetic\":\"old snapshot\"}}' WHERE id={literal(self.org)}; COMMIT;")
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            native = executor.submit(sql, statement, expect_error=True)
            self.wait_session(name, event="PgSleep")
            sql(f"UPDATE public.organizations SET settings='{{\"synthetic\":\"concurrent transaction\"}}' WHERE id={literal(self.org)};")
            error = native.result(timeout=10)
        self.assertIn("40001", error)
        self.assertIn("could not serialize", error)
        self.assertNotIn("PT409", error)

    def test_service_finalize_exception_handler_preserves_native_failure_code(self):
        day = self.prepared()
        self.create_matrix()
        args = self.final_args(self.context(day))
        before = self.data_snapshot()
        function = "qa_native_failure_" + uuid.uuid4().hex
        # Deliberately inject a database serialization condition to exercise the
        # finalize exception handler. The independent test above also provokes a
        # real engine serialization failure, without mocked SQL output.
        sql(f"CREATE FUNCTION public.{function}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.organization_id={literal(self.org)}::uuid THEN RAISE serialization_failure USING MESSAGE='Synthetic native serialization condition'; END IF; RETURN NEW; END $$; CREATE TRIGGER {function} BEFORE INSERT ON public.hours_day_classifications FOR EACH ROW EXECUTE FUNCTION public.{function}();")
        try:
            error = self.reject("hours_finalize_day_classification", role="service_role", code="40001", **args)
            self.assertNotIn("PT409", error)
            self.assertEqual(before, self.data_snapshot())
        finally:
            sql(f"DROP TRIGGER {function} ON public.hours_day_classifications; DROP FUNCTION public.{function}();")


def main():
    global CATALOG_BEFORE, CATALOG_AFTER
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cleanup", action="store_true")
    args = parser.parse_args()
    if args.cleanup:
        qa.owned_container()
        subprocess.run(["docker", "rm", "-f", "-v", qa.CONTAINER], check=True)
        return 0
    paths = [ROOT / "supabase/migrations" / name for name in (
        "20260908090000_hours_workflow_foundation.sql", "20260908120000_hours_matrix_versions.sql",
        "20260908140000_hours_day_sources_and_classification.sql", "20260908160000_hours_workflow_organization_gate.sql",
        "20260908180000_hours_conflict_http_status.sql",
    )]
    fixtures = [ROOT / "tests/db/hours-workflow-fixture.sql", ROOT / "tests/db/hours-module-gate-fixture.sql"]
    harnesses = [ROOT / "scripts" / name for name in ("hours-workflow-db-test.py", "hours-classification-db-test.py", "hours-module-gate-db-test.py", "hours-conflict-db-test.py")]
    engines = [ROOT / "supabase/functions/_shared/hours-calculation.ts", ROOT / "supabase/functions/_shared/hours-classification.ts"]
    sources = paths + fixtures + harnesses + engines
    hashes = {path: hashlib.sha256(path.read_bytes()).hexdigest() for path in sources}
    adapt_business_expectations()
    qa.ensure_container()
    if sql("SELECT to_regclass('public.organizations') IS NOT NULL;") == "t":
        raise RuntimeError("QA database already exists; inspect results and use --cleanup")
    for fixture in fixtures:
        sql(fixture.read_text())
    sql(f"INSERT INTO public.organizations(id,name) VALUES({literal(gate.NULL_FLAG_ORG)},'Synthetic pre-gate nullable organization'); INSERT INTO auth.users(id) VALUES({literal(gate.NULL_FLAG_ADMIN)}); INSERT INTO public.profiles(id,organization_id,role) VALUES({literal(gate.NULL_FLAG_ADMIN)},{literal(gate.NULL_FLAG_ORG)},'admin'); INSERT INTO public.organization_modules(organization_id,module_name,enabled) VALUES({literal(gate.NULL_FLAG_ORG)},'uren-workflow',NULL);")
    for path in paths:
        if path == paths[-1]:
            CATALOG_BEFORE = catalog()
        sql(path.read_text())
        sql(path.read_text())
    CATALOG_AFTER = catalog()
    sql(f"INSERT INTO auth.users(id) VALUES({literal(gate.SA)}); INSERT INTO public.superadmins(user_id) VALUES({literal(gate.SA)});")
    database = sql("SELECT version();")
    base = [gate.EnabledFoundationRegression, gate.EnabledClassificationRegression, gate.ModuleGateTests]
    suite = unittest.TestSuite([unittest.TestSuite(HTTPConflictTests(name) for name in sorted(vars(HTTPConflictTests)) if name.startswith("test_"))])
    for cls in base:
        suite.addTest(unittest.defaultTestLoader.loadTestsFromTestCase(cls))
    identifiers = [test.id() for group in suite for test in group]
    started = time.monotonic()
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    unchanged = all(hashlib.sha256(path.read_bytes()).hexdigest() == digest for path, digest in hashes.items())
    report = {
        "success": result.wasSuccessful() and unchanged, "tests_run": result.testsRun, "prior_gate_regressions": 100,
        "business_conflict_expectation_updates": EXPECTATION_UPDATES,
        "actual_database_errors_translated": False,
        "tests": identifiers, "database": database, "image": qa.IMAGE, "container": qa.CONTAINER,
        "network": "none", "host_ports": [], "host_mounts": [], "elapsed_seconds": round(time.monotonic() - started, 3),
        "migration_applications_each": 2, "inputs_unchanged_during_run": unchanged,
        "source_validation": classification.SOURCE_RESULTS,
        "catalog_before": CATALOG_BEFORE, "catalog_after": CATALOG_AFTER,
        "failures": [{"test": test.id(), "traceback": trace} for test, trace in result.failures],
        "errors": [{"test": test.id(), "traceback": trace} for test, trace in result.errors],
        "production_writes": 0, "real_provider_calls": 0, "communications_sent": 0,
        "verified_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "run_command": "python3 -B scripts/hours-conflict-db-test.py", "output_directory": str(OUTPUT.resolve()),
    }
    for label, files in (("migrations", paths), ("fixtures", fixtures), ("harnesses", harnesses), ("engines", engines)):
        report[label] = [{"path": str(path.relative_to(ROOT)), "sha256": hashes[path]} for path in files]
    OUTPUT.mkdir(parents=True, exist_ok=True)
    path = OUTPUT / "hours-conflict-db-qa-result.json"
    path.write_text(json.dumps(report, indent=2) + "\n")
    print("Result JSON:", path, flush=True)
    return 0 if report["success"] else 1


if __name__ == "__main__":
    sys.exit(main())
