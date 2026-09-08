#!/usr/bin/env python3
"""Synthetic PostgreSQL regression and integration tests for exact-day classification.

Uses the existing reduced fixture and production auth helper definitions; never
connects to production or invokes providers. Docker has no network/ports/mounts.
Run: python3 scripts/hours-classification-db-test.py
Cleanup: python3 scripts/hours-classification-db-test.py --cleanup
HOURS_CLASSIFICATION_QA_OUTPUT selects a persistent output directory.
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
OUTPUT = Path(os.environ.get("HOURS_CLASSIFICATION_QA_OUTPUT", ROOT / "test-results/hours-classification-db"))
spec = importlib.util.spec_from_file_location("hours_foundation_qa", ROOT / "scripts/hours-workflow-db-test.py")
qa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qa)
qa.CONTAINER = "ja-works-hours-classification-test-20260908"
qa.LABEL = "ja-werkt-hours-classification-qa"
qa.LABEL_VALUE = "20260908"
sql, rpc, literal, rpc_statement = qa.sql, qa.rpc, qa.literal, qa.rpc_statement
SOURCE_RESULTS = []
SERVICE_FUNCTIONS = {"hours_finalize_day_classification"}


def matrix_config(factor="1", mode="flat"):
    return {
        "schemaVersion": 1, "timeBasis": "wall_clock",
        "categories": [{"code": "normal", "factor": factor}],
        "categoryMappings": [{"id": "map-regular", "sourceCode": "regular", "categoryCode": "normal"}],
        "automaticRules": {"kind": "flat", "rule": {"id": "default", "categoryCode": "normal"}}
        if mode == "flat" else {"kind": "explicit_only"},
    }


def source_input():
    return {"schemaVersion": 1, "shifts": [{"start": "08:00", "end": "16:30", "endDayOffset": 0,
                        "breaks": [{"start": "12:00", "end": "12:30"}]}],
            "categories": [{"sourceCode": "regular", "minutes": 480}]}


def source_cases():
    """Structural failures differ from valid source facts requiring calculation review."""
    cases = []

    def change(name, update, accepted=False):
        body = source_input()
        update(body)
        cases.append((name, body, accepted))

    cases.append(("empty-explicit-source", {"schemaVersion": 1}, True))
    cases.append(("legacy-null-source", None, True))
    cases.append(("complete-source", source_input(), True))
    change("shifts-only", lambda c: c.pop("categories"), True)
    change("categories-only", lambda c: c.pop("shifts"), True)
    for name, value in [("missing-schema", {}), ("scalar", 1), ("array", []), ("text", "source")]:
        cases.append((name, value, False))
    for value in [None, 2, "1", True]:
        change("schema-" + repr(value), lambda c, value=value: c.update(schemaVersion=value))
    for key, value in [("workDate", "2026-09-07"), ("totalMinutes", 480), ("confirmed", True), ("provider", "claimed-ocr")]:
        change("unknown-" + key, lambda c, key=key, value=value: c.update({key: value}))
    for field in ["shifts", "categories"]:
        for value in [None, {}, [], 1, "supplied"]:
            change(field + "-type-" + repr(value), lambda c, field=field, value=value: c.update({field: value}), value == [])
    for field in ["start", "end", "endDayOffset", "breaks"]:
        change("shift-missing-" + field, lambda c, field=field: c["shifts"][0].pop(field))
    change("shift-unknown", lambda c: c["shifts"][0].update(guessedPause=30))
    for value in [-1, 2, 0.5, "0", None, True]:
        change("day-offset-" + repr(value), lambda c, value=value: c["shifts"][0].update(endDayOffset=value))
    for field in ["start", "end"]:
        for value in [None, 8, "8:00", "24:00", "08:60", "08:00:00"]:
            change("shift-" + field + "-" + repr(value), lambda c, field=field, value=value: c["shifts"][0].update({field: value}))
    for value in [None, {}, "none", [None]]:
        change("break-type-" + repr(value), lambda c, value=value: c["shifts"][0].update(breaks=value))
    change("explicit-no-breaks", lambda c: c["shifts"][0].update(end="16:00", breaks=[]), True)
    for field in ["start", "end"]:
        change("break-missing-" + field, lambda c, field=field: c["shifts"][0]["breaks"][0].pop(field))
    for field in ["startDayOffset", "endDayOffset"]:
        for value in [-1, 2, 0.5, "0", None, True]:
            change("break-offset-" + field + "-" + repr(value), lambda c, field=field, value=value: c["shifts"][0]["breaks"][0].update({field: value}))
    change("break-unknown", lambda c: c["shifts"][0]["breaks"][0].update(inferred=True))
    for value in [None, 1, "", " ", "\t", "\u00a0", "\ufeff"]:
        change("source-code-" + repr(value), lambda c, value=value: c["categories"][0].update(sourceCode=value))
    for value in [-1, 1441, 0.5, "480", None, True]:
        change("category-minutes-" + repr(value), lambda c, value=value: c["categories"][0].update(minutes=value))
    change("category-unknown", lambda c: c["categories"][0].update(factor="2"))
    change("category-duplicate", lambda c: c["categories"].append(copy.deepcopy(c["categories"][0])), True)
    # The following are structurally valid original facts, not permission to export.
    change("category-total-mismatch", lambda c: c["categories"][0].update(minutes=420), True)
    change("unknown-source-category", lambda c: c["categories"][0].update(sourceCode="unmapped"), True)
    change("shift-total-mismatch", lambda c: c["shifts"][0].update(end="15:30"), True)
    change("shift-overlap", lambda c: c["shifts"].append(copy.deepcopy(c["shifts"][0])), True)
    change("shift-negative-range", lambda c: c["shifts"][0].update(end="07:00"), True)
    change("break-outside-shift", lambda c: c["shifts"][0]["breaks"][0].update(start="06:00", end="06:30"), True)
    return cases


def calculate(context):
    """Roundtrip actual database JSON through the same helper as the Edge Function."""
    program = """
import { classifyStoredHoursDay, HOURS_CLASSIFICATION_ENGINE_VERSION } from './supabase/functions/_shared/hours-classification.ts';
const context = JSON.parse(await new Response(Deno.stdin.readable).text());
console.log(JSON.stringify({engine_version:HOURS_CLASSIFICATION_ENGINE_VERSION,result:classifyStoredHoursDay(context)}));
"""
    result = subprocess.run(["deno", "eval", "--no-config", program], cwd=ROOT, input=json.dumps(context),
                            text=True, capture_output=True, timeout=30, check=True)
    return json.loads(result.stdout)


class FoundationRegression(qa.HoursWorkflowTests):
    def test_rpc_and_private_helper_permissions_no_service_shortcut(self):
        functions = json.loads(sql("""SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,
          'name',p.proname,'schema',n.nspname)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname IN ('public','private') AND p.proname LIKE 'hours_%';"""))
        self.assertGreaterEqual(len(functions), 12)
        for function in functions:
            signature = function["signature"]
            self.assertEqual(sql(f"SELECT has_function_privilege('anon',{literal(signature)},'EXECUTE');"), "f")
            service_only = function["schema"] == "public" and function["name"] in SERVICE_FUNCTIONS
            self.assertEqual(sql(f"SELECT has_function_privilege('service_role',{literal(signature)},'EXECUTE');"), "t" if service_only else "f")
            if service_only or function["schema"] == "private":
                self.assertEqual(sql(f"SELECT has_function_privilege('authenticated',{literal(signature)},'EXECUTE');"), "f")


class ClassificationTests(unittest.TestCase):
    setUp = qa.HoursWorkflowTests.setUp
    add_placement = qa.HoursWorkflowTests.add_placement
    settings = qa.HoursWorkflowTests.settings
    week = qa.HoursWorkflowTests.week
    view = qa.HoursWorkflowTests.view
    first_day = qa.HoursWorkflowTests.first_day
    save = qa.HoursWorkflowTests.save
    confirm = qa.HoursWorkflowTests.confirm
    review = qa.HoursWorkflowTests.review
    reject = qa.HoursWorkflowTests.reject

    def latest(self, day):
        return next(d for member in self.view(day["week_id"])["members"] for d in member["days"] if d["id"] == day["id"])

    def prepared(self, source=None, minutes=480, reason=None, future=False):
        if future:
            today = datetime.date.fromisoformat(sql("SELECT (now() AT TIME ZONE 'Europe/Amsterdam')::date;"))
            start = today + datetime.timedelta(days=7 - today.weekday())
            self.add_placement(start=str(start), end=str(start + datetime.timedelta(days=6)))
            week = self.week(str(start))
        else:
            week = self.week()
        day = self.first_day(week)
        day["week_id"] = week["id"]
        self.save_source(day, source, minutes=minutes, reason=reason)
        result = self.latest(day)
        result["week_id"] = week["id"]
        return result

    def save_source(self, day, source, minutes=480, reason=None, note=None, user=None):
        revision = day.get("current_revision")
        return rpc("hours_save_day_source", user=user or self.admin, p_day_id=day["id"],
                   p_expected_revision_id=revision["id"] if revision else None, p_minutes=minutes,
                   p_no_hours_reason=reason, p_note=note, p_source_input=source)

    def context(self, day, user=None):
        return rpc("hours_get_day_classification_context", user=user or self.admin,
                   p_day_id=day["id"], p_expected_revision_id=day["current_revision"]["id"])

    def final_args(self, context, result=None, actor=None):
        computed = calculate(context)
        return dict(p_actor_id=actor or self.admin, p_day_id=context["day_id"],
                    p_expected_revision_id=context["revision_id"], p_expected_context_hash=context["context_hash"],
                    p_engine_version=computed["engine_version"], p_result=computed["result"] if result is None else result)

    def finalize(self, context, result=None, actor=None):
        return rpc("hours_finalize_day_classification", role="service_role", **self.final_args(context, result, actor))

    def create_matrix(self, scope="client", factor="1", mode="flat", user=None, config_override=None):
        actor = user or self.admin
        matrix = rpc("hours_create_matrix", user=actor, p_scope=scope,
                     p_company_id=self.company if scope == "client" else None, p_name="Synthetic classification matrix")
        definition = matrix_config(factor, mode) if config_override is None else config_override
        versions = rpc("hours_create_matrix_draft", user=actor, p_matrix_id=matrix["id"], p_valid_from="2026-01-01", p_valid_until=None, p_config=definition)
        version = versions["versions"][0]
        return rpc("hours_publish_matrix_version", user=actor, p_version_id=version["id"], p_expected_revision=version["revision"], p_confirmed=True)

    def bind(self, matrix_id):
        binding = rpc("hours_get_company_matrix_binding", user=self.admin, p_company_id=self.company)
        return rpc("hours_set_company_matrix_binding", user=self.admin, p_company_id=self.company,
                   p_expected_version=binding["version"], p_cao_matrix_id=matrix_id)

    def test_source_structure_bounds_and_semantic_facts_are_distinct(self):
        day = self.prepared()
        self.create_matrix()
        for name, body, accepted in source_cases():
            with self.subTest(case=name):
                current = self.latest(day)
                value = "NULL::jsonb" if body is None else literal(json.dumps(body)) + "::jsonb"
                statement = ("SELECT public.hours_save_day_source("
                             f"{literal(day['id'])}::uuid, {literal(current['current_revision']['id'])}::uuid, "
                             f"480, NULL::text, NULL::text, {value});")
                if accepted:
                    sql(statement, role="authenticated", user=self.admin)
                    saved = self.latest(day)
                    self.assertEqual(saved["current_revision"]["source_input"], body)
                    context = self.context(saved)
                    computed = calculate(context)["result"]
                    classified = name in {"empty-explicit-source", "legacy-null-source", "complete-source",
                                          "shifts-only", "categories-only", "explicit-no-breaks"}
                    self.assertEqual(computed["status"], "classified" if classified else "blocked", name)
                    SOURCE_RESULTS.append({"case": name, "accepted": True, "classification": computed})
                else:
                    self.assertIn("22023", sql(statement, role="authenticated", user=self.admin, expect_error=True))
                    self.assertEqual(self.latest(day)["current_revision"]["id"], current["current_revision"]["id"])
                    SOURCE_RESULTS.append({"case": name, "accepted": False})

    def test_legacy_context_to_real_kernel_to_finalize(self):
        day = self.prepared()
        self.create_matrix(factor="1.250")
        context = self.context(day)
        self.assertIsNone(context["source_input"])
        computed = calculate(context)["result"]
        self.assertEqual(computed["status"], "classified")
        stored = self.finalize(context)
        self.assertEqual(stored["allocations"], computed["allocations"])
        self.assertEqual(stored["allocations"][0]["factor"], "1.250")
        self.assertEqual(stored["revision_id"], day["current_revision"]["id"])
        current = self.latest(day)
        self.assertEqual(current["classification"]["id"], stored["id"])
        self.assertIsNone(current["confirmation"])
        self.assertIsNone(current["review"])
        self.assertFalse(self.view(day["week_id"])["release_available"])

    def test_rich_overnight_breaks_roundtrip_keeps_original_sources(self):
        source = {"schemaVersion": 1, "shifts": [{"start": "22:00", "end": "06:00", "endDayOffset": 1,
                  "breaks": [{"start": "01:00", "end": "01:30", "startDayOffset": 1, "endDayOffset": 1}]}]}
        day = self.prepared(source, minutes=450)
        self.create_matrix()
        context = self.context(day)
        self.assertEqual(context["source_input"], source)
        result = self.finalize(context)
        self.assertEqual(result["status"], "classified")
        self.assertEqual(sum(a["minutes"] for a in result["allocations"]), 450)

    def test_ov1_to_5_categorized_roundtrip_and_total_mismatch(self):
        definition = matrix_config()
        definition["categories"] = [{"code": f"premium{i}", "factor": f"1.{i}0"} for i in range(1, 6)]
        definition["categoryMappings"] = [{"id": f"map{i}", "sourceCode": f"OV{i}", "categoryCode": f"premium{i}"} for i in range(1, 6)]
        definition["automaticRules"] = {"kind": "explicit_only"}
        self.create_matrix(config_override=definition)
        source = {"schemaVersion": 1, "categories": [{"sourceCode": f"OV{i}", "minutes": i * 30} for i in range(1, 6)]}
        day = self.prepared(source, minutes=450)
        result = self.finalize(self.context(day))
        self.assertEqual(result["status"], "classified")
        self.assertEqual([a["sourceCategory"] for a in result["allocations"]], [f"OV{i}" for i in range(1, 6)])
        self.save_source(day, source, minutes=480)
        corrected = self.latest(day)
        blocked = self.finalize(self.context(corrected))
        self.assertEqual(blocked["status"], "blocked")
        self.assertEqual(blocked["allocations"], [])
        self.assertIn("TOTAL_MISMATCH", [issue["code"] for issue in blocked["issues"]])

    def test_source_edit_new_revision_invalidates_prior_confirmation_and_review(self):
        day = self.prepared(source_input())
        self.confirm(day)
        self.review(day)
        changed = source_input()
        changed["shifts"][0]["breaks"][0].update(start="12:15", end="12:45")
        self.save_source(day, changed)
        current = self.latest(day)
        self.assertNotEqual(current["current_revision"]["id"], day["current_revision"]["id"])
        self.assertIsNone(current["confirmation"])
        self.assertIsNone(current["review"])
        self.assertEqual(len(current["history"]), 2)

    def test_identical_source_save_is_noop_preserving_reactions(self):
        day = self.prepared(source_input())
        self.confirm(day)
        before = self.latest(day)
        self.save_source(day, source_input())
        self.assertEqual(self.latest(day)["current_revision"], before["current_revision"])
        self.assertEqual(self.latest(day)["confirmation"], before["confirmation"])

    def test_legacy_save_cannot_silently_erase_rich_source(self):
        day = self.prepared(source_input())
        self.reject("hours_save_day", user=self.admin, code="22023", p_day_id=day["id"],
                    p_expected_revision_id=day["current_revision"]["id"], p_minutes=480, p_no_hours_reason=None, p_note=None)
        self.assertEqual(self.latest(day)["current_revision"]["source_input"], source_input())
        self.save_source(day, None)
        current = self.latest(day)
        self.assertIsNone(current["current_revision"]["source_input"])
        self.assertNotEqual(current["current_revision"]["id"], day["current_revision"]["id"])

    def test_source_compare_and_swap_and_portal_writes_denied(self):
        day = self.prepared()
        self.save_source(day, source_input())
        for actor, code in [(self.admin, "40001"), (self.worker, "42501"), (self.other_admin, "42501")]:
            self.reject("hours_save_day_source", user=actor, code=code, p_day_id=day["id"],
                        p_expected_revision_id=day["current_revision"]["id"], p_minutes=480, p_no_hours_reason=None, p_note=None, p_source_input=None)

    def test_portal_reads_own_sources_but_not_internal_classification(self):
        day = self.prepared(source_input())
        self.create_matrix()
        stored = self.finalize(self.context(day))
        own = self.view(day["week_id"], self.worker)
        visible = self.first_day(own)
        self.assertEqual(visible["current_revision"]["source_input"], source_input())
        self.assertIsNone(visible["classification"])
        self.assertEqual(visible["history"], [])
        self.assertNotIn(stored["id"], json.dumps(own))

    def test_context_requires_internal_manage_and_own_current_day(self):
        day = self.prepared()
        for actor in [self.worker, self.other_admin]:
            self.reject("hours_get_day_classification_context", user=actor, p_day_id=day["id"], p_expected_revision_id=day["current_revision"]["id"])
        self.save_source(day, source_input())
        self.reject("hours_get_day_classification_context", user=self.admin, code="40001", p_day_id=day["id"], p_expected_revision_id=day["current_revision"]["id"])

    def test_finalize_is_service_only_and_revalidates_actor(self):
        day = self.prepared()
        self.create_matrix()
        args = self.final_args(self.context(day))
        for role, actor in [("anon", None), ("authenticated", self.admin), ("authenticated", self.worker)]:
            self.reject("hours_finalize_day_classification", role=role, user=actor, **args)
        for actor in [None, str(uuid.uuid4()), self.worker, self.other_admin]:
            self.reject("hours_finalize_day_classification", role="service_role", code="22023" if actor is None else "42501", **{**args, "p_actor_id": actor})

    def test_actor_rechecks_activity_role_org_and_role_permission_after_context(self):
        day = self.prepared()
        self.create_matrix()
        args = self.final_args(self.context(day))
        mutations = ["is_active=false", "role='medewerker'", f"organization_id={literal(self.other_org)}", "role='finance'"]
        for mutation in mutations:
            sql(f"UPDATE public.profiles SET {mutation} WHERE id={literal(self.admin)};")
            if mutation == "role='finance'":
                sql(f"UPDATE public.organizations SET settings='{{\"role_permissions\":{{\"finance\":{{\"finance.manage\":false}}}}}}'::jsonb WHERE id={literal(self.org)};")
            try:
                self.reject("hours_finalize_day_classification", role="service_role", **args)
            finally:
                sql(f"UPDATE public.profiles SET is_active=true,role='admin',organization_id={literal(self.org)} WHERE id={literal(self.admin)};")
                sql(f"UPDATE public.organizations SET settings='{{}}' WHERE id={literal(self.org)};")

    def test_actor_permission_override_and_disabled_workflow_rechecked(self):
        day = self.prepared()
        self.create_matrix()
        sql(f"UPDATE public.profiles SET role='finance' WHERE id={literal(self.admin)};")
        args = self.final_args(self.context(day))
        sql(f"INSERT INTO public.user_permission_overrides VALUES({literal(self.org)},{literal(self.admin)},'finance.manage',false);")
        self.reject("hours_finalize_day_classification", role="service_role", **args)
        sql(f"DELETE FROM public.user_permission_overrides WHERE user_id={literal(self.admin)};")
        self.settings(p_enabled=False)
        self.reject("hours_finalize_day_classification", role="service_role", code="22023", **args)

    def test_day_revision_changed_between_read_and_finalize_rejected(self):
        day = self.prepared()
        self.create_matrix()
        args = self.final_args(self.context(day))
        self.save_source(day, source_input())
        self.reject("hours_finalize_day_classification", role="service_role", code="40001", **args)
        self.assertIsNone(self.latest(day)["classification"])

    def test_missing_matrix_context_stale_after_first_matrix_created(self):
        day = self.prepared()
        context = self.context(day)
        args = self.final_args(context)
        self.assertEqual(args["p_result"]["status"], "blocked")
        self.create_matrix()
        self.reject("hours_finalize_day_classification", role="service_role", code="40001", **args)
        self.assertIsNone(self.latest(day)["classification"])

    def test_cao_binding_change_between_context_and_finalize_rejected(self):
        day = self.prepared()
        first = self.create_matrix(scope="cao")
        second = self.create_matrix(scope="cao", factor="2")
        self.bind(first["id"])
        args = self.final_args(self.context(day))
        self.bind(second["id"])
        self.reject("hours_finalize_day_classification", role="service_role", code="40001", **args)

    def test_new_effective_matrix_publication_makes_unpinned_context_stale(self):
        day = self.prepared(future=True)
        matrix = self.create_matrix()
        args = self.final_args(self.context(day))
        draft = rpc("hours_create_matrix_draft", user=self.admin, p_matrix_id=matrix["id"], p_valid_from=day["work_date"], p_valid_until=None, p_config=matrix_config("2"))["versions"][0]
        rpc("hours_publish_matrix_version", user=self.admin, p_version_id=draft["id"], p_expected_revision=draft["revision"], p_confirmed=True)
        self.reject("hours_finalize_day_classification", role="service_role", code="40001", **args)

    def test_matrix_basis_pinned_across_correction_and_later_binding(self):
        day = self.prepared(source_input())
        first = self.create_matrix(scope="cao", factor="1.250")
        second = self.create_matrix(scope="cao", factor="2")
        self.bind(first["id"])
        initial = self.finalize(self.context(day))
        self.bind(second["id"])
        self.save_source(day, None, minutes=420)
        current = self.latest(day)
        context = self.context(current)
        self.assertEqual(context["pinned_matrix"]["matrix_version_id"], initial["matrix_version_id"])
        corrected = self.finalize(context)
        self.assertEqual(corrected["matrix_version_id"], initial["matrix_version_id"])
        self.assertEqual(corrected["allocations"][0]["factor"], "1.250")
        self.assertEqual(sum(a["minutes"] for a in corrected["allocations"]), 420)

    def test_missing_matrix_does_not_pin_and_later_configuration_can_succeed(self):
        day = self.prepared()
        blocked = self.finalize(self.context(day))
        self.assertEqual(blocked["status"], "blocked")
        self.assertIsNone(blocked["matrix_version_id"])
        self.assertIsNone(self.context(day)["pinned_matrix"])
        self.create_matrix()
        classified = self.finalize(self.context(day))
        self.assertEqual(classified["status"], "classified")
        self.assertNotEqual(classified["id"], blocked["id"])

    def test_selected_matrix_pinned_even_when_source_data_blocks(self):
        day = self.prepared()
        matrix = self.create_matrix(mode="explicit_only")
        blocked = self.finalize(self.context(day))
        self.assertEqual(blocked["status"], "blocked")
        self.assertIsNotNone(blocked["matrix_version_id"])
        context = self.context(day)
        self.assertEqual(context["pinned_matrix"]["matrix_version_id"], blocked["matrix_version_id"])
        self.save_source(day, {"schemaVersion": 1, "categories": [{"sourceCode": "regular", "minutes": 480}]})
        classified = self.finalize(self.context(self.latest(day)))
        self.assertEqual(classified["status"], "classified")
        self.assertEqual(classified["matrix_version_id"], matrix["versions"][0]["id"])

    def test_no_hours_has_no_matrix_or_allocation_and_rich_zero_blocks(self):
        day = self.prepared(minutes=0, reason="Synthetic free day")
        result = self.finalize(self.context(day))
        self.assertEqual(result["status"], "no_hours")
        self.assertIsNone(result["matrix_version_id"])
        self.assertEqual(result["allocations"], [])
        self.assertIsNone(self.context(day)["pinned_matrix"])
        self.save_source(day, source_input(), minutes=0, reason="Synthetic conflicting source")
        context = self.context(self.latest(day))
        blocked = self.finalize(context)
        self.assertEqual(blocked["status"], "blocked")
        self.assertIn("INVALID_ZERO_SOURCE", [issue["code"] for issue in blocked["issues"]])

    def test_whitespace_only_zero_reason_rejected_and_note_trim_matches_kernel(self):
        day = self.prepared()
        for reason in ["", " ", "\t", "\u00a0", "\ufeff", "\r\n\t\u00a0"]:
            for name in ["hours_save_day", "hours_save_day_source"]:
                params = dict(p_day_id=day["id"], p_expected_revision_id=day["current_revision"]["id"],
                              p_minutes=0, p_no_hours_reason=reason, p_note=None)
                if name == "hours_save_day_source":
                    params["p_source_input"] = None
                self.reject(name, user=self.admin, code="22023", **params)
        self.save_source(day, None, note="\t\u00a0\ufeff")
        self.assertEqual(self.latest(day)["current_revision"]["id"], day["current_revision"]["id"])
        self.save_source(day, None, minutes=0, reason="\tSynthetic free day\u00a0")
        current = self.latest(day)
        self.assertEqual(current["current_revision"]["no_hours_reason"], "Synthetic free day")
        self.assertEqual(self.finalize(self.context(current))["status"], "no_hours")

    def test_finalize_result_shapes_sums_factors_and_rule_references_enforced(self):
        day = self.prepared()
        self.create_matrix()
        context = self.context(day)
        actual = calculate(context)["result"]
        invalid = []
        for value in [0, 479, 481, 0.5, "480"]:
            result = copy.deepcopy(actual)
            result["allocations"][0]["minutes"] = value
            invalid.append(result)
        for key, value in [("factor", "2"), ("categoryCode", "foreign"), ("ruleId", "foreign")]:
            result = copy.deepcopy(actual)
            result["allocations"][0][key] = value
            invalid.append(result)
        invalid += [{**actual, "unknown": True}, {**actual, "status": "no_hours"},
                    {**actual, "status": "blocked", "issues": []},
                    {**actual, "issues": [{"code": "BAD", "message": "Synthetic"}]},
                    {**actual, "matrix_version_id": str(uuid.uuid4())}]
        args = self.final_args(context)
        for result in invalid:
            self.reject("hours_finalize_day_classification", role="service_role", code="22023", **{**args, "p_result": result})
        self.reject("hours_finalize_day_classification", role="service_role", code="22023", **{**args, "p_engine_version": "untrusted-v2"})
        self.assertIsNone(self.latest(day)["classification"])

    def test_two_complete_roundtrips_are_idempotent_before_and_after_first_pin(self):
        day = self.prepared()
        self.create_matrix()
        initial_context = self.context(day)
        first = self.finalize(initial_context)
        pinned_context = self.context(day)
        self.assertIsNotNone(pinned_context["pinned_matrix"])
        self.assertEqual(pinned_context["context_hash"], initial_context["context_hash"])
        second = self.finalize(pinned_context)
        self.assertEqual(first, second)
        self.assertEqual(sql(f"SELECT count(*) FROM public.hours_day_classifications WHERE day_id={literal(day['id'])};"), "1")
        self.assertEqual(sql(f"SELECT count(*) FROM public.hours_day_matrix_basis WHERE day_id={literal(day['id'])};"), "1")

    def test_blocked_selected_matrix_roundtrips_do_not_append_duplicate_attempt(self):
        day = self.prepared()
        self.create_matrix(mode="explicit_only")
        first_context = self.context(day)
        first = self.finalize(first_context)
        next_context = self.context(day)
        self.assertEqual(next_context["context_hash"], first_context["context_hash"])
        second = self.finalize(next_context)
        self.assertEqual(first["status"], "blocked")
        self.assertEqual(first, second)
        self.assertEqual(sql(f"SELECT count(*) FROM public.hours_day_classifications WHERE day_id={literal(day['id'])};"), "1")

    def test_classifications_and_matrix_basis_append_only_and_tenant_scoped(self):
        day = self.prepared()
        self.create_matrix()
        self.finalize(self.context(day))
        for table in ["hours_day_classifications", "hours_day_matrix_basis"]:
            for mutation in [f"UPDATE public.{table} SET organization_id=organization_id WHERE day_id={literal(day['id'])};",
                             f"DELETE FROM public.{table} WHERE day_id={literal(day['id'])};"]:
                self.assertIn("42501", sql(mutation, expect_error=True))
                for role, user in [("authenticated", self.admin), ("service_role", None), ("anon", None)]:
                    self.assertIn("42501", sql(mutation, role=role, user=user, expect_error=True))
            self.assertEqual(sql(f"SELECT count(*) FROM public.{table} WHERE day_id={literal(day['id'])};", role="authenticated", user=self.admin), "1")
            for user in [self.worker, self.other_admin]:
                self.assertEqual(sql(f"SELECT count(*) FROM public.{table} WHERE day_id={literal(day['id'])};", role="authenticated", user=user), "0")

    def test_service_actor_claims_restore_after_success_and_caught_error(self):
        day = self.prepared()
        self.create_matrix()
        args = self.final_args(self.context(day))
        valid_call = rpc_statement("hours_finalize_day_classification", **args).removeprefix("SELECT ").removesuffix(";")
        invalid_call = rpc_statement("hours_finalize_day_classification", **{**args, "p_expected_context_hash": "0" * 64}).removeprefix("SELECT ").removesuffix(";")
        marker = str(uuid.uuid4())
        statement = f"""DO $$ DECLARE original_claims text; original_sub text; original_role text; BEGIN
          original_claims := current_setting('request.jwt.claims',true);
          original_sub := current_setting('request.jwt.claim.sub',true);
          original_role := current_setting('request.jwt.claim.role',true);
          PERFORM {valid_call};
          IF current_setting('request.jwt.claims',true) IS DISTINCT FROM original_claims
             OR current_setting('request.jwt.claim.sub',true) IS DISTINCT FROM original_sub
             OR current_setting('request.jwt.claim.role',true) IS DISTINCT FROM original_role THEN
            RAISE EXCEPTION 'Actor claims leaked after successful finalize';
          END IF;
          BEGIN
            PERFORM {invalid_call};
            RAISE EXCEPTION 'Unexpected successful stale finalize';
          EXCEPTION WHEN SQLSTATE '40001' THEN NULL;
          END;
          IF current_setting('request.jwt.claims',true) IS DISTINCT FROM original_claims
             OR current_setting('request.jwt.claim.sub',true) IS DISTINCT FROM original_sub
             OR current_setting('request.jwt.claim.role',true) IS DISTINCT FROM original_role THEN
            RAISE EXCEPTION 'Actor claims leaked after rejected finalize';
          END IF;
        END $$;"""
        sql(statement, role="service_role", user=marker)

    def test_concurrent_finalize_has_one_attempt_and_one_basis(self):
        day = self.prepared()
        self.create_matrix()
        args = self.final_args(self.context(day))
        barrier = threading.Barrier(2)

        def finalize(_):
            barrier.wait(timeout=5)
            return rpc("hours_finalize_day_classification", role="service_role", **args)

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(finalize, range(2)))
        self.assertEqual(results[0], results[1])
        for table in ["hours_day_classifications", "hours_day_matrix_basis"]:
            self.assertEqual(sql(f"SELECT count(*) FROM public.{table} WHERE day_id={literal(day['id'])};"), "1")

    def test_finalize_racing_day_correction_cannot_classify_new_revision(self):
        day = self.prepared()
        self.create_matrix()
        args = self.final_args(self.context(day))
        barrier = threading.Barrier(2)

        def act(action):
            barrier.wait(timeout=5)
            try:
                return True, (rpc("hours_finalize_day_classification", role="service_role", **args)
                              if action == "finalize" else self.save_source(day, None, minutes=420))
            except qa.SQLFailure as error:
                return False, str(error)

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(act, ["finalize", "correct"]))
        self.assertTrue(results[1][0], results)
        if not results[0][0]:
            self.assertIn("40001", results[0][1])
        current = self.latest(day)
        self.assertEqual(current["current_revision"]["minutes"], 420)
        self.assertIsNone(current["classification"])
        self.assertEqual(sql(f"SELECT count(*) FROM public.hours_day_classifications WHERE revision_id={literal(current['current_revision']['id'])};"), "0")

    def test_blocked_day_counts_current_attempt_once_and_ignores_history(self):
        day = self.prepared()
        self.finalize(self.context(day))

        def count(user=None):
            weeks = rpc("hours_list_weeks", user=user or self.admin, p_week_start=None)["weeks"]
            return next(w["blocked_day_count"] for w in weeks if w["id"] == day["week_id"])

        self.assertEqual(count(), 1)
        self.review(day, "blocked", "Synthetic review")
        self.confirm(day, "disputed", "Synthetic dispute")
        self.assertEqual(count(), 1)
        self.review(day, "checked")
        self.confirm(day, "confirmed")
        self.create_matrix()
        self.finalize(self.context(day))
        self.assertEqual(count(), 0)
        self.save_source(day, None, minutes=420)
        self.assertEqual(count(), 0)

    def test_source_list_payload_and_text_limits_fail_without_partial_revision(self):
        day = self.prepared()
        invalid = []
        body = source_input()
        body["shifts"] *= 33
        invalid.append(body)
        body = source_input()
        body["shifts"][0]["breaks"] *= 33
        invalid.append(body)
        body = source_input()
        body["categories"] *= 257
        invalid.append(body)
        body = source_input()
        body["categories"][0]["sourceCode"] = "x" * 201
        invalid.append(body)
        for body in invalid:
            self.reject("hours_save_day_source", user=self.admin, code="22023", p_day_id=day["id"],
                        p_expected_revision_id=day["current_revision"]["id"], p_minutes=480, p_no_hours_reason=None, p_note=None, p_source_input=body)
        self.assertEqual(self.latest(day)["current_revision"]["id"], day["current_revision"]["id"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cleanup", action="store_true")
    parser.add_argument("--classification-only", action="store_true", help="Development-only targeted rerun; final QA must include foundation regressions")
    args = parser.parse_args()
    if args.cleanup:
        qa.owned_container()
        subprocess.run(["docker", "rm", "-f", "-v", qa.CONTAINER], check=True)
        return 0
    paths = [ROOT / "supabase/migrations" / name for name in [
        "20260908090000_hours_workflow_foundation.sql",
        "20260908120000_hours_matrix_versions.sql",
        "20260908140000_hours_day_sources_and_classification.sql",
    ]]
    fixture = ROOT / "tests/db/hours-workflow-fixture.sql"
    engine = ROOT / "supabase/functions/_shared/hours-calculation.ts"
    hashes = {path: hashlib.sha256(path.read_bytes()).hexdigest() for path in paths + [fixture, engine]}
    qa.ensure_container()
    qa.initialize(paths)
    database = sql("SELECT version();")
    print("Database:", database, flush=True)
    classes = [ClassificationTests] if args.classification_only else [FoundationRegression, ClassificationTests]
    suite = unittest.TestSuite(unittest.defaultTestLoader.loadTestsFromTestCase(cls) for cls in classes)
    identifiers = [test.id() for group in suite for test in group]
    start = time.monotonic()
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    unchanged = all(hashlib.sha256(path.read_bytes()).hexdigest() == digest for path, digest in hashes.items())
    report = {
        "success": result.wasSuccessful() and unchanged, "tests_run": result.testsRun,
        "foundation_regressions_included": not args.classification_only,
        "tests": identifiers, "database": database, "image": qa.IMAGE,
        "container": qa.CONTAINER, "network": "none", "host_ports": [], "host_mounts": [],
        "elapsed_seconds": round(time.monotonic() - start, 3),
        "migrations": [{"path": str(path.relative_to(ROOT)), "sha256": hashes[path]} for path in paths],
        "migration_applications_each": 2, "inputs_unchanged_during_run": unchanged,
        "fixture_sha256": hashes[fixture], "pure_engine_sha256": hashes[engine],
        "source_validation": SOURCE_RESULTS,
        "failures": [{"test": test.id(), "traceback": trace} for test, trace in result.failures],
        "errors": [{"test": test.id(), "traceback": trace} for test, trace in result.errors],
        "production_writes": 0, "real_provider_calls": 0, "communications_sent": 0,
        "verified_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "run_command": "python3 scripts/hours-classification-db-test.py" + (" --classification-only" if args.classification_only else ""),
        "output_directory": str(OUTPUT.resolve()),
    }
    OUTPUT.mkdir(parents=True, exist_ok=True)
    path = OUTPUT / "hours-classification-db-qa-result.json"
    path.write_text(json.dumps(report, indent=2) + "\n")
    print("Result JSON:", path, flush=True)
    return 0 if report["success"] else 1


if __name__ == "__main__":
    sys.exit(main())
