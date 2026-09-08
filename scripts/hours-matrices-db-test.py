#!/usr/bin/env python3
"""Matrix-version integration QA against isolated, synthetic Supabase PostgreSQL.

No production credentials, real tenant data, network, host mounts or host ports.
Run: python3 scripts/hours-matrices-db-test.py
Cleanup: python3 scripts/hours-matrices-db-test.py --cleanup
HOURS_MATRICES_QA_OUTPUT overrides the durable report directory.
"""

import argparse
import concurrent.futures
import copy
import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = Path(os.environ.get("HOURS_MATRICES_QA_OUTPUT", ROOT / "test-results/hours-matrices-db"))
spec = importlib.util.spec_from_file_location("hours_foundation_qa", ROOT / "scripts/hours-workflow-db-test.py")
qa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qa)
qa.CONTAINER = "ja-works-hours-matrices-test-20260908"
qa.LABEL = "ja-werkt-hours-matrices-qa"
qa.LABEL_VALUE = "20260908"
sql, rpc, literal, rpc_statement = qa.sql, qa.rpc, qa.literal, qa.rpc_statement
PARITY_RESULTS = []


def config():
    return {
        "schemaVersion": 1, "timeBasis": "wall_clock",
        "categories": [{"code": "normal", "factor": "1"}, {"code": "premium", "factor": "1.250"}],
        "categoryMappings": [{"id": "source-normal", "sourceCode": "regular", "categoryCode": "normal"}],
        "automaticRules": {"kind": "flat", "rule": {"id": "default", "categoryCode": "normal"}},
    }


def config_cases():
    """Independent business-boundary vectors, also checked against the pure engine."""
    cases = []

    def change(name, update, valid=False):
        value = config()
        update(value)
        cases.append((name, value, valid))

    cases.extend((name, value, False) for name, value in [("null", None), ("array", []), ("number", 1), ("empty", {})])
    cases.append(("flat-valid", config(), True))
    change("explicit-only-valid", lambda c: c.update(automaticRules={"kind": "explicit_only"}), True)
    change("no-mappings-valid", lambda c: c.update(categoryMappings=[]), True)
    for key in list(config()):
        change("missing-" + key, lambda c, key=key: c.pop(key))
    for value in [2, "1", None, True]:
        change("schema-" + str(value), lambda c, value=value: c.update(schemaVersion=value))
    change("unknown-key", lambda c: c.update(guessOvertime=True))
    change("untrusted-confirmed", lambda c: c.update(confirmed=True))
    change("untrusted-version-id", lambda c: c.update(id="claimed-id"))
    change("elapsed-time", lambda c: c.update(timeBasis="elapsed"))
    for value in [[], None, {}, [None]]:
        change("invalid-categories-" + json.dumps(value), lambda c, value=value: c.update(categories=value))
    change("duplicate-category", lambda c: c["categories"].append(copy.deepcopy(c["categories"][0])))
    change("category-unknown-key", lambda c: c["categories"][0].update(multiplier=1))
    for value in ["", " ", "\t", "\u00a0", "\ufeff", None, 12]:
        change("category-code-" + repr(value), lambda c, value=value: c["categories"][0].update(code=value))
    for value in [0, 1.5, None, "", "0", "-1", ".5", "1.", "1,5", "1e3", "NaN", "Infinity", " 1", "1 ", "123456789012345678901"]:
        change("factor-invalid-" + repr(value), lambda c, value=value: c["categories"][0].update(factor=value))
    for value in ["01.50", "0.000000000000000001", "99999999999999999999"]:
        change("factor-preserved-" + value, lambda c, value=value: c["categories"][0].update(factor=value), True)
    change("mapping-unknown-key", lambda c: c["categoryMappings"][0].update(guess=True))
    change("mapping-unknown-category", lambda c: c["categoryMappings"][0].update(categoryCode="missing"))
    change("mapping-empty-id", lambda c: c["categoryMappings"][0].update(id=" "))
    change("mapping-empty-source", lambda c: c["categoryMappings"][0].update(sourceCode=" "))
    change("mapping-duplicate-source", lambda c: c["categoryMappings"].append({"id": "other", "sourceCode": "regular", "categoryCode": "premium"}))
    change("mapping-duplicate-id", lambda c: c["categoryMappings"].append({"id": "source-normal", "sourceCode": "other", "categoryCode": "premium"}))
    change("mapping-rule-duplicate-id", lambda c: c["automaticRules"]["rule"].update(id="source-normal"))
    for value in [None, [], {"kind": "overtime"}, {"kind": "explicit_only", "rules": []}, {"kind": "flat"}, {"kind": "time_windows", "rules": []}]:
        change("rules-invalid-" + json.dumps(value), lambda c, value=value: c.update(automaticRules=value))
    change("flat-unknown-key", lambda c: c["automaticRules"]["rule"].update(factor="2"))
    change("flat-unknown-category", lambda c: c["automaticRules"]["rule"].update(categoryCode="missing"))

    def windows(rules):
        return {"kind": "time_windows", "rules": rules}

    def window(identifier="night", days=None, start="22:00", end="06:00"):
        return {"id": identifier, "categoryCode": "premium", "daysOfWeek": days or [7], "start": start, "end": end}

    change("overnight-valid", lambda c: c.update(automaticRules=windows([window()])), True)
    change("whole-day-valid", lambda c: c.update(automaticRules=windows([window(start="00:00", end="24:00")])), True)
    change("adjacent-valid", lambda c: c.update(automaticRules=windows([window(), window("monday", [1], "06:00", "10:00")])), True)
    change("week-wrap-overlap", lambda c: c.update(automaticRules=windows([window(), window("monday", [1], "05:59", "10:00")])))
    change("same-day-overlap", lambda c: c.update(automaticRules=windows([window("a", [1], "08:00", "12:00"), window("b", [1], "11:59", "14:00")])))
    change("duplicate-window-id", lambda c: c.update(automaticRules=windows([window("x", [1]), window("x", [2])])))
    for start, end in [("24:00", "06:00"), ("00:00", "24:01"), ("22:00", "22:00"), ("6:00", "10:00"), ("06:60", "10:00")]:
        change("clock-invalid-" + start + "-" + end, lambda c, start=start, end=end: c.update(automaticRules=windows([window(start=start, end=end)])))
    for days in [[], [0], [8], [1, 1], [1.5], ["1"], [True], None]:
        rule = window()
        rule["daysOfWeek"] = days
        change("weekdays-invalid-" + json.dumps(days), lambda c, rule=rule: c.update(automaticRules=windows([rule])))
    return cases


def pure_engine_results(cases):
    """Use the production pure selector; do not reproduce its validation in Python."""
    program = """
import { selectEffectiveHoursMatrix } from './supabase/functions/_shared/hours-calculation.ts';
const cases = JSON.parse(await new Response(Deno.stdin.readable).text());
const result = cases.map(([name, config]) => {
  // Metadata is produced by the database, never trusted from an input config.
  const matrix = { ...config, schemaVersion: config?.schemaVersion, id: 'qa-version', scope: 'client',
    validFrom: '2026-01-01', validUntil: null, confirmed: true };
  const metadataInConfig = config && typeof config === 'object' && !Array.isArray(config)
    && Object.keys(config).some(key => !['schemaVersion','timeBasis','categories','categoryMappings','automaticRules'].includes(key));
  const output = selectEffectiveHoursMatrix({workDate:'2026-09-07',clientVersions:[matrix],caoVersions:[]});
  return [name, !metadataInConfig && output.ok, output.ok ? [] : output.issues.map(issue=>issue.code)];
});
console.log(JSON.stringify(result));
"""
    result = subprocess.run(["deno", "eval", "--no-config", program], cwd=ROOT,
                            input=json.dumps(cases), text=True, capture_output=True, timeout=30, check=True)
    return {name: {"accepted": accepted, "issues": issues} for name, accepted, issues in json.loads(result.stdout)}


class MatrixTests(unittest.TestCase):
    setUp = qa.HoursWorkflowTests.setUp
    add_placement = qa.HoursWorkflowTests.add_placement
    reject = qa.HoursWorkflowTests.reject

    def create(self, scope="client", company=None, user=None, name="Synthetic matrix"):
        return rpc("hours_create_matrix", user=user or self.admin, p_scope=scope,
                   p_company_id=(company or self.company) if scope == "client" else None, p_name=name)

    def view(self, matrix, user=None):
        return rpc("hours_get_matrix", user=user or self.admin, p_matrix_id=matrix["id"])

    def draft(self, matrix, start="2026-01-01", end=None, body=None, user=None):
        detail = rpc("hours_create_matrix_draft", user=user or self.admin, p_matrix_id=matrix["id"],
                     p_valid_from=start, p_valid_until=end, p_config=config() if body is None else body)
        return max(detail["versions"], key=lambda v: v["version_number"])

    def save(self, version, body=None, start=None, end=None, user=None):
        return rpc("hours_save_matrix_draft", user=user or self.admin, p_version_id=version["id"],
                   p_expected_revision=version["revision"], p_valid_from=start or version["valid_from"],
                   p_valid_until=end, p_config=config() if body is None else body)

    def publish(self, version, user=None, confirmed=True):
        return rpc("hours_publish_matrix_version", user=user or self.admin, p_version_id=version["id"],
                   p_expected_revision=version["revision"], p_confirmed=confirmed)

    def version_row(self, identifier):
        return json.loads(sql(f"SELECT row_to_json(v) FROM public.hours_matrix_versions v WHERE id={literal(identifier)};"))

    def test_draft_is_internal_only_and_published_still_not_portal_exposed(self):
        matrix = self.create()
        version = self.draft(matrix)
        for stage in ["draft", "published"]:
            if stage == "published":
                self.publish(version)
            for user in [self.worker, self.other_worker]:
                self.reject("hours_list_matrices", user=user, p_company_id=self.company)
                self.reject("hours_get_matrix", user=user, p_matrix_id=matrix["id"])
                for table in ["hours_matrices", "hours_matrix_versions"]:
                    self.assertEqual(sql(f"SELECT count(*) FROM public.{table};", role="authenticated", user=user), "0")

    def test_org_isolation_in_read_edit_publish_and_create(self):
        matrix = self.create()
        version = self.draft(matrix)
        self.reject("hours_get_matrix", user=self.other_admin, p_matrix_id=matrix["id"])
        self.reject("hours_create_matrix", user=self.admin, p_scope="client", p_company_id=self.other_company, p_name="Synthetic")
        self.reject("hours_create_matrix_draft", user=self.other_admin, p_matrix_id=matrix["id"], p_valid_from="2026-01-01", p_valid_until=None, p_config=config())
        self.reject("hours_save_matrix_draft", user=self.other_admin, p_version_id=version["id"], p_expected_revision=version["revision"], p_valid_from="2026-01-01", p_valid_until=None, p_config=config())
        self.reject("hours_publish_matrix_version", user=self.other_admin, p_version_id=version["id"], p_expected_revision=version["revision"], p_confirmed=True)
        self.assertEqual(sql(f"SELECT count(*) FROM public.hours_matrix_versions WHERE id={literal(version['id'])};", role="authenticated", user=self.other_admin), "0")

    def test_anonymous_service_and_missing_identity_cannot_use_rpcs(self):
        for role in ["anon", "service_role", "authenticated"]:
            self.reject("hours_list_matrices", role=role, user=None, p_company_id=None)
            self.reject("hours_create_matrix", role=role, user=None, p_scope="cao", p_company_id=None, p_name="Synthetic")

    def test_inactive_and_client_portal_profiles_denied(self):
        matrix = self.create()
        sql(f"UPDATE public.profiles SET is_active=false WHERE id={literal(self.admin)};")
        self.reject("hours_get_matrix", user=self.admin, p_matrix_id=matrix["id"])
        sql(f"UPDATE public.profiles SET role='opdrachtgever' WHERE id={literal(self.worker)};")
        self.reject("hours_get_matrix", user=self.worker, p_matrix_id=matrix["id"])

    def test_internal_read_permission_does_not_grant_mutations(self):
        matrix = self.create()
        sql(f"UPDATE public.profiles SET role='intercedent' WHERE id={literal(self.worker)}; "
            f"INSERT INTO public.user_permission_overrides VALUES ({literal(self.org)},{literal(self.worker)},'finance.view',true), "
            f"({literal(self.org)},{literal(self.worker)},'finance.manage',false);")
        self.assertFalse(self.view(matrix, self.worker)["can_manage"])
        self.reject("hours_create_matrix_draft", user=self.worker, p_matrix_id=matrix["id"], p_valid_from="2026-01-01", p_valid_until=None, p_config=config())

    def test_strict_json_validation_agrees_with_pure_engine(self):
        matrix = self.create(scope="cao")
        cases = config_cases()
        pure = pure_engine_results(cases)
        for name, body, expected in cases:
            with self.subTest(case=name):
                self.assertEqual(pure[name]["accepted"], expected, pure[name])
                statement = ("SELECT public.hours_create_matrix_draft("
                             f"{literal(matrix['id'])}::uuid, '2026-01-01'::date, NULL::date, "
                             f"{literal(json.dumps(body))}::jsonb);")
                if expected:
                    response = json.loads(sql(statement, role="authenticated", user=self.admin))
                    self.assertTrue(response["versions"])
                    accepted = True
                else:
                    error = sql(statement, role="authenticated", user=self.admin, expect_error=True)
                    self.assertIn("22023", error)
                    accepted = False
                PARITY_RESULTS.append({"case": name, "expected": expected, "pure_engine": pure[name], "database_accepted": accepted})

    def test_draft_revision_compare_and_swap(self):
        matrix = self.create()
        version = self.draft(matrix)
        updated = config()
        updated["categories"][0]["factor"] = "1.1250"
        detail = self.save(version, body=updated)
        new = next(v for v in detail["versions"] if v["id"] == version["id"])
        self.assertGreater(new["revision"], version["revision"])
        self.reject("hours_save_matrix_draft", user=self.admin, code="40001", p_version_id=version["id"], p_expected_revision=version["revision"], p_valid_from="2026-01-01", p_valid_until=None, p_config=config())
        self.assertEqual(self.version_row(version["id"])["revision"], new["revision"])

    def test_publishing_requires_explicit_confirmation(self):
        version = self.draft(self.create())
        for confirmation in [False, None]:
            self.reject("hours_publish_matrix_version", user=self.admin, code="22023", p_version_id=version["id"], p_expected_revision=version["revision"], p_confirmed=confirmation)
        self.assertEqual(self.version_row(version["id"])["status"], "draft")

    def test_published_content_immutable_even_owner_sql_cannot_rewrite(self):
        matrix = self.create()
        version = self.draft(matrix)
        self.publish(version)
        before = self.version_row(version["id"])
        self.reject("hours_save_matrix_draft", user=self.admin, code="42501", p_version_id=version["id"], p_expected_revision=before["revision"], p_valid_from="2026-01-01", p_valid_until=None, p_config=config())
        for assignment in ["valid_from='2025-01-01'", "status='draft'", "config='{}'::jsonb"]:
            sql(f"UPDATE public.hours_matrix_versions SET {assignment} WHERE id={literal(version['id'])};", expect_error=True)
        sql(f"DELETE FROM public.hours_matrix_versions WHERE id={literal(version['id'])};", expect_error=True)
        self.assertEqual(self.version_row(version["id"]), before)

    def test_direct_app_writes_are_denied(self):
        matrix = self.create()
        version = self.draft(matrix)
        for role, user in [("anon", None), ("authenticated", self.admin), ("service_role", None)]:
            for statement in [f"UPDATE public.hours_matrices SET name='Changed' WHERE id={literal(matrix['id'])};", f"DELETE FROM public.hours_matrix_versions WHERE id={literal(version['id'])};", "TRUNCATE public.hours_matrix_versions CASCADE;"]:
                self.assertIn("42501", sql(statement, role=role, user=user, expect_error=True))

    def test_concurrent_draft_edits_cannot_overwrite_each_other(self):
        matrix = self.create()
        version = self.draft(matrix)
        barrier = threading.Barrier(2)

        def edit(factor):
            body = config()
            body["categories"][0]["factor"] = factor
            barrier.wait(timeout=5)
            try:
                return True, self.save(version, body=body)
            except qa.SQLFailure as error:
                return False, str(error)

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(edit, ["1.25", "1.5"]))
        self.assertEqual(sum(ok for ok, _ in results), 1)
        self.assertIn("40001", next(value for ok, value in results if not ok))

    def test_concurrent_save_and_publish_requires_reviewed_revision(self):
        matrix = self.create()
        version = self.draft(matrix)
        body = config()
        body["categories"][0]["factor"] = "1.5"
        barrier = threading.Barrier(2)

        def act(action):
            barrier.wait(timeout=5)
            try:
                return True, self.save(version, body=body) if action == "save" else self.publish(version)
            except qa.SQLFailure as error:
                return False, str(error)

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(act, ["save", "publish"]))
        self.assertEqual(sum(ok for ok, _ in results), 1)
        stored = self.version_row(version["id"])
        if stored["status"] == "published":
            self.assertEqual(stored["config"]["categories"][0]["factor"], "1")
        else:
            self.assertEqual(stored["status"], "draft")
        self.assertTrue(any(code in next(value for ok, value in results if not ok) for code in ["40001", "42501"]))

    def today(self):
        return datetime.date.fromisoformat(sql("SELECT (now() AT TIME ZONE 'Europe/Amsterdam')::date;"))

    def bind(self, matrix_id, expected=0, company=None, user=None):
        return rpc("hours_set_company_matrix_binding", user=user or self.admin,
                   p_company_id=company or self.company, p_expected_version=expected, p_cao_matrix_id=matrix_id)

    def test_unpublished_successor_does_not_shorten_published_validity(self):
        matrix = self.create()
        original = self.draft(matrix)
        self.publish(original)
        tomorrow = str(self.today() + datetime.timedelta(days=1))
        future = self.draft(matrix, start=tomorrow)
        versions = {v["id"]: v for v in self.view(matrix)["versions"]}
        self.assertIsNone(versions[original["id"]]["effective_valid_until"])
        self.assertIsNone(versions[original["id"]]["definition"]["validUntil"])
        self.assertFalse(versions[future["id"]]["definition"]["confirmed"])

    def test_open_ended_successor_effective_timeline_preserves_original_content(self):
        matrix = self.create()
        original = self.draft(matrix)
        published = self.publish(original)["versions"][0]
        snapshot = self.version_row(original["id"])
        boundary = str(self.today() + datetime.timedelta(days=7))
        future = self.draft(matrix, start=boundary)
        self.publish(future)
        versions = {v["id"]: v for v in self.view(matrix)["versions"]}
        old = versions[original["id"]]
        self.assertEqual(old["effective_valid_until"], boundary)
        self.assertEqual(old["definition"]["validUntil"], boundary)
        self.assertIsNone(old["valid_until"])
        self.assertEqual(old["published_definition"], published["published_definition"])
        self.assertEqual(self.version_row(original["id"]), snapshot)
        self.assertIsNone(versions[future["id"]]["effective_valid_until"])
        definitions = [v["definition"] for v in versions.values() if v["status"] == "published"]
        probes = [str(self.today()), boundary, str(self.today() + datetime.timedelta(days=30))]
        program = """
import { selectEffectiveHoursMatrix } from './supabase/functions/_shared/hours-calculation.ts';
const { definitions, probes } = JSON.parse(await new Response(Deno.stdin.readable).text());
console.log(JSON.stringify(probes.map(workDate => selectEffectiveHoursMatrix({workDate,clientVersions:definitions,caoVersions:[]}))));
"""
        result = subprocess.run(["deno", "eval", "--no-config", program], cwd=ROOT,
                                input=json.dumps({"definitions": definitions, "probes": probes}),
                                text=True, capture_output=True, timeout=30, check=True)
        selected = json.loads(result.stdout)
        self.assertTrue(all(r["ok"] for r in selected), selected)
        self.assertEqual([r["value"]["id"] for r in selected], [original["id"], future["id"], future["id"]])

    def test_explicit_end_date_retains_gap_before_future_successor(self):
        matrix = self.create()
        end = str(self.today() + datetime.timedelta(days=2))
        future_start = str(self.today() + datetime.timedelta(days=5))
        original = self.draft(matrix, end=end)
        self.publish(original)
        future = self.draft(matrix, start=future_start)
        self.publish(future)
        old = next(v for v in self.view(matrix)["versions"] if v["id"] == original["id"])
        self.assertEqual(old["effective_valid_until"], end)
        self.assertEqual(old["published_definition"]["validUntil"], end)
        for date in [end, str(self.today() + datetime.timedelta(days=4))]:
            active = [v for v in self.view(matrix)["versions"] if v["status"] == "published" and v["valid_from"] <= date and (not v["effective_valid_until"] or date < v["effective_valid_until"])]
            self.assertEqual(active, [])

    def test_successor_can_shorten_effective_end_without_rewriting_declared_end(self):
        matrix = self.create()
        end = str(self.today() + datetime.timedelta(days=90))
        boundary = str(self.today() + datetime.timedelta(days=30))
        first = self.draft(matrix, end=end)
        self.publish(first)
        successor = self.draft(matrix, start=boundary)
        self.publish(successor)
        old = next(v for v in self.view(matrix)["versions"] if v["id"] == first["id"])
        self.assertEqual(old["effective_valid_until"], boundary)
        self.assertEqual(old["valid_until"], end)
        self.assertEqual(old["published_definition"]["validUntil"], end)

    def test_no_backdated_equal_or_out_of_order_published_successors(self):
        matrix = self.create()
        first = self.draft(matrix)
        self.publish(first)
        for date in ["2026-01-01", str(self.today() - datetime.timedelta(days=1))]:
            version = self.draft(matrix, start=date)
            self.reject("hours_publish_matrix_version", user=self.admin, code="22023", p_version_id=version["id"], p_expected_revision=version["revision"], p_confirmed=True)
        future = self.draft(matrix, start=str(self.today() + datetime.timedelta(days=10)))
        self.publish(future)
        out_of_order = self.draft(matrix, start=str(self.today() + datetime.timedelta(days=5)))
        self.reject("hours_publish_matrix_version", user=self.admin, code="22023", p_version_id=out_of_order["id"], p_expected_revision=out_of_order["revision"], p_confirmed=True)
        self.assertEqual(self.view(matrix)["published_version_count"], 2)

    def test_concurrent_publications_same_start_have_one_winner(self):
        matrix = self.create()
        self.publish(self.draft(matrix))
        start = str(self.today() + datetime.timedelta(days=7))
        versions = [self.draft(matrix, start=start), self.draft(matrix, start=start)]
        barrier = threading.Barrier(2)

        def publish(version):
            barrier.wait(timeout=5)
            try:
                self.publish(version)
                return True, None
            except qa.SQLFailure as error:
                return False, str(error)

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(publish, versions))
        self.assertEqual(sum(ok for ok, _ in results), 1)
        self.assertIn("22023", next(value for ok, value in results if not ok))
        self.assertEqual(self.view(matrix)["published_version_count"], 2)

    def test_exact_publish_and_save_retries_do_not_change_audit(self):
        matrix = self.create()
        version = self.draft(matrix)
        original = self.version_row(version["id"])
        self.save(version)
        self.assertEqual(self.version_row(version["id"]), original)
        first = self.publish(version)
        second = self.publish(version)
        self.assertEqual(second, first)

    def test_stale_publish_after_save_rejected_without_publication(self):
        matrix = self.create()
        version = self.draft(matrix)
        updated = config()
        updated["categories"][0]["factor"] = "2"
        self.save(version, body=updated)
        self.reject("hours_publish_matrix_version", user=self.admin, code="40001", p_version_id=version["id"], p_expected_revision=version["revision"], p_confirmed=True)
        self.assertEqual(self.view(matrix)["published_version_count"], 0)

    def test_invalid_config_edit_is_atomic(self):
        matrix = self.create()
        version = self.draft(matrix)
        before = self.version_row(version["id"])
        invalid = config()
        invalid["categories"][0]["factor"] = "0"
        self.reject("hours_save_matrix_draft", user=self.admin, code="22023", p_version_id=version["id"], p_expected_revision=version["revision"], p_valid_from="2026-01-01", p_valid_until=None, p_config=invalid)
        self.assertEqual(self.version_row(version["id"]), before)

    def test_storage_bounds_reject_oversized_values_without_truncation(self):
        matrix = self.create()
        cases = []
        body = config()
        body["categories"][0]["code"] = "x" * 201
        cases.append(body)
        body = config()
        body["categories"].extend({"code": "extra-" + str(i), "factor": "1"} for i in range(127))
        cases.append(body)
        body = config()
        body["categoryMappings"] = [{"id": "map-" + str(i), "sourceCode": "source-" + str(i), "categoryCode": "normal"} for i in range(257)]
        cases.append(body)
        body = config()
        body["automaticRules"] = {"kind": "time_windows", "rules": [
            {"id": "window-" + str(i), "categoryCode": "normal", "daysOfWeek": [1],
             "start": f"{i // 60:02d}:{i % 60:02d}", "end": f"{(i + 1) // 60:02d}:{(i + 1) % 60:02d}"}
            for i in range(129)]}
        cases.append(body)
        for body in cases:
            self.reject("hours_create_matrix_draft", user=self.admin, code="22023", p_matrix_id=matrix["id"], p_valid_from="2026-01-01", p_valid_until=None, p_config=body)
        self.assertEqual(self.view(matrix)["versions"], [])

    def test_binding_tables_have_tenant_rls_and_no_direct_app_writes(self):
        cao = self.create(scope="cao")
        self.bind(cao["id"])
        for table in ["hours_company_cao_bindings", "hours_company_cao_binding_history"]:
            self.assertEqual(sql(f"SELECT count(*) FROM public.{table} WHERE company_id={literal(self.company)};", role="authenticated", user=self.admin), "1")
            for user in [self.worker, self.other_admin]:
                self.assertEqual(sql(f"SELECT count(*) FROM public.{table} WHERE company_id={literal(self.company)};", role="authenticated", user=user), "0")
            for role, user in [("anon", None), ("authenticated", self.admin), ("service_role", None)]:
                self.assertIn("42501", sql(f"DELETE FROM public.{table} WHERE company_id={literal(self.company)};", role=role, user=user, expect_error=True))

    def test_invalid_dates_and_scope_rejected_before_version_creation(self):
        matrix = self.create()
        for start, end in [(None, None), ("2026-01-01", "2026-01-01"), ("2026-01-02", "2026-01-01"), ("0001-01-01 BC", None)]:
            self.reject("hours_create_matrix_draft", user=self.admin, code="22023", p_matrix_id=matrix["id"], p_valid_from=start, p_valid_until=end, p_config=config())
        self.assertEqual(self.view(matrix)["versions"], [])
        for scope, company, name in [(None, None, "Name"), ("other", None, "Name"), ("client", None, "Name"), ("cao", self.company, "Name"), ("cao", None, " ")]:
            self.reject("hours_create_matrix", user=self.admin, code="22023", p_scope=scope, p_company_id=company, p_name=name)

    def test_company_matrix_is_unique_but_multiple_explicit_cao_sets_allowed(self):
        self.create()
        self.reject("hours_create_matrix", user=self.admin, code="22023", p_scope="client", p_company_id=self.company, p_name="Duplicate")
        a = self.create(scope="cao", name="Synthetic A")
        b = self.create(scope="cao", name="Synthetic B")
        self.assertNotEqual(a["id"], b["id"])
        self.assertEqual(rpc("hours_get_company_matrix_binding", user=self.admin, p_company_id=self.company)["cao_matrix_id"], None)

    def test_binding_requires_explicit_same_org_cao_and_keeps_history(self):
        a = self.create(scope="cao", name="Synthetic A")
        b = self.create(scope="cao", name="Synthetic B")
        initial = rpc("hours_get_company_matrix_binding", user=self.admin, p_company_id=self.company)
        self.assertEqual((initial["version"], initial["cao_matrix_id"]), (0, None))
        first = self.bind(a["id"])
        self.assertEqual(first["version"], 1)
        second = self.bind(b["id"], expected=1)
        self.assertEqual(second["version"], 2)
        cleared = self.bind(None, expected=2)
        self.assertEqual((cleared["version"], cleared["cao_matrix_id"]), (3, None))
        history = json.loads(sql(f"SELECT jsonb_agg(cao_matrix_id ORDER BY version) FROM public.hours_company_cao_binding_history WHERE company_id={literal(self.company)};"))
        self.assertEqual(history, [a["id"], b["id"], None])
        for statement in [f"UPDATE public.hours_company_cao_binding_history SET cao_matrix_id=NULL WHERE company_id={literal(self.company)};", f"DELETE FROM public.hours_company_cao_binding_history WHERE company_id={literal(self.company)};"]:
            self.assertIn("42501", sql(statement, expect_error=True))

    def test_binding_foreign_org_client_matrix_and_portal_denied(self):
        foreign = self.create(scope="cao", user=self.other_admin)
        client = self.create()
        for identifier in [foreign["id"], client["id"], str(uuid.uuid4())]:
            self.reject("hours_set_company_matrix_binding", user=self.admin, p_company_id=self.company, p_expected_version=0, p_cao_matrix_id=identifier)
        local = self.create(scope="cao")
        self.reject("hours_set_company_matrix_binding", user=self.admin, p_company_id=self.other_company, p_expected_version=0, p_cao_matrix_id=local["id"])
        for user in [self.worker, self.other_admin]:
            self.reject("hours_get_company_matrix_binding", user=user, p_company_id=self.company)
            self.reject("hours_set_company_matrix_binding", user=user, p_company_id=self.company, p_expected_version=0, p_cao_matrix_id=local["id"])

    def test_binding_cas_and_identical_retry_no_duplicate_history(self):
        a = self.create(scope="cao")
        b = self.create(scope="cao")
        first = self.bind(a["id"])
        self.assertEqual(self.bind(a["id"], expected=1), first)
        self.reject("hours_set_company_matrix_binding", user=self.admin, code="40001", p_company_id=self.company, p_expected_version=0, p_cao_matrix_id=b["id"])
        self.assertEqual(sql(f"SELECT count(*) FROM public.hours_company_cao_binding_history WHERE company_id={literal(self.company)};"), "1")

    def test_binding_concurrent_edits_preserve_one_history_entry(self):
        matrices = [self.create(scope="cao"), self.create(scope="cao")]
        barrier = threading.Barrier(2)

        def bind(matrix):
            barrier.wait(timeout=5)
            try:
                return True, self.bind(matrix["id"])
            except qa.SQLFailure as error:
                return False, str(error)

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(bind, matrices))
        self.assertEqual(sum(ok for ok, _ in results), 1)
        self.assertIn("40001", next(value for ok, value in results if not ok))
        self.assertEqual(sql(f"SELECT count(*) FROM public.hours_company_cao_binding_history WHERE company_id={literal(self.company)};"), "1")

    def test_all_private_helpers_and_public_mutations_have_no_anon_service_execute(self):
        signatures = json.loads(sql("""SELECT jsonb_agg(n.nspname||'.'||p.oid::regprocedure::text) FROM pg_proc p
          JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private')
          AND (p.proname LIKE 'hours_%matrix%' OR p.proname LIKE 'hours_%cao%');"""))
        self.assertGreaterEqual(len(signatures), 10)
        for signature in signatures:
            # regprocedure includes the namespace only outside the visible path.
            signature = signature.replace("private.private.", "private.")
            for role in ["anon", "service_role"]:
                self.assertEqual(sql(f"SELECT has_function_privilege({literal(role)}, {literal(signature)}, 'EXECUTE');"), "f")
            if signature.startswith("private."):
                self.assertEqual(sql(f"SELECT has_function_privilege('authenticated', {literal(signature)}, 'EXECUTE');"), "f")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cleanup", action="store_true")
    args = parser.parse_args()
    if args.cleanup:
        qa.owned_container()
        subprocess.run(["docker", "rm", "-f", "-v", qa.CONTAINER], check=True)
        return 0
    paths = [ROOT / "supabase/migrations/20260908090000_hours_workflow_foundation.sql",
             ROOT / "supabase/migrations/20260908120000_hours_matrix_versions.sql"]
    hashes = {path: hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}
    qa.ensure_container()
    qa.initialize(paths[:1])
    sql(paths[1].read_text())
    sql(paths[1].read_text())
    database = sql("SELECT version();")
    print("Database:", database, flush=True)
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(MatrixTests)
    identifiers = [test.id() for test in suite]
    start = time.monotonic()
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    unchanged = all(hashlib.sha256(path.read_bytes()).hexdigest() == hashes[path] for path in paths)
    report = {
        "success": result.wasSuccessful() and unchanged, "tests_run": result.testsRun,
        "tests": identifiers, "database": database, "image": qa.IMAGE,
        "container": qa.CONTAINER, "network": "none", "host_ports": [], "host_mounts": [],
        "elapsed_seconds": round(time.monotonic() - start, 3),
        "migrations": [{"path": str(path.relative_to(ROOT)), "sha256": hashes[path]} for path in paths],
        "migration_applications_each": 2, "migration_unchanged_during_run": unchanged,
        "fixture_sha256": hashlib.sha256((ROOT / "tests/db/hours-workflow-fixture.sql").read_bytes()).hexdigest(),
        "pure_engine_sha256": hashlib.sha256((ROOT / "supabase/functions/_shared/hours-calculation.ts").read_bytes()).hexdigest(),
        "validation_parity": PARITY_RESULTS,
        "failures": [{"test": test.id(), "traceback": trace} for test, trace in result.failures],
        "errors": [{"test": test.id(), "traceback": trace} for test, trace in result.errors],
        "production_writes": 0, "real_provider_calls": 0, "communications_sent": 0,
        "verified_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "run_command": "python3 scripts/hours-matrices-db-test.py",
        "output_directory": str(OUTPUT.resolve()),
    }
    OUTPUT.mkdir(parents=True, exist_ok=True)
    path = OUTPUT / "hours-matrices-db-qa-result.json"
    path.write_text(json.dumps(report, indent=2) + "\n")
    print("Result JSON:", path, flush=True)
    return 0 if report["success"] else 1


if __name__ == "__main__":
    sys.exit(main())
