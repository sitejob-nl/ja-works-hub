#!/usr/bin/env python3
"""Run module-gate and all 74 classification regressions in isolated PostgreSQL.

No production writes, external providers, network or host mounts. Existing test
cases are imported with an explicit extension for the new read-only RLS helper;
synthetic organizations opt in through the real SaaS-admin RPC before each case.
HOURS_MODULE_GATE_QA_OUTPUT selects a durable output directory.
"""

import argparse
import concurrent.futures
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
OUTPUT = Path(os.environ.get("HOURS_MODULE_GATE_QA_OUTPUT", ROOT / "test-results/hours-module-gate-db"))
spec = importlib.util.spec_from_file_location("hours_classification_qa", ROOT / "scripts/hours-classification-db-test.py")
classification = importlib.util.module_from_spec(spec)
spec.loader.exec_module(classification)
qa = classification.qa
qa.CONTAINER = "ja-works-hours-module-gate-test-20260908"
qa.LABEL = "ja-werkt-hours-module-gate-qa"
qa.LABEL_VALUE = "20260908"
sql, rpc, literal, rpc_statement = qa.sql, qa.rpc, qa.literal, qa.rpc_statement
SA = "a8aa0000-0000-4000-8000-000000000001"
NULL_FLAG_ORG = "a8aa0000-0000-4000-8000-000000000002"
NULL_FLAG_ADMIN = "a8aa0000-0000-4000-8000-000000000003"
TABLES = (
    "hours_company_settings", "hours_weeks", "hours_week_members", "hours_days",
    "hours_day_revisions", "hours_day_confirmations", "hours_day_reviews",
    "hours_matrices", "hours_matrix_versions", "hours_company_cao_bindings",
    "hours_company_cao_binding_history", "hours_day_matrix_basis", "hours_day_classifications",
)


def toggle(org, enabled, user=SA):
    return rpc("sa_set_hours_workflow_enabled", user=user, p_organization_id=org, p_enabled=enabled)


def enabled_setup(self):
    qa.HoursWorkflowTests.setUp(self)
    toggle(self.org, True)
    toggle(self.other_org, True)


class EnabledFoundationRegression(classification.FoundationRegression):
    setUp = enabled_setup

    def test_rpc_and_private_helper_permissions_no_service_shortcut(self):
        # The new zero-argument, own-profile boolean is intentionally executable
        # by authenticated RLS. All previous helper/service invariants stay exact.
        functions = json.loads(sql("""SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,
          'name',p.proname,'schema',n.nspname)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname IN ('public','private') AND p.proname LIKE 'hours_%';"""))
        self.assertGreaterEqual(len(functions), 12)
        for function in functions:
            signature = function["signature"]
            self.assertEqual(sql(f"SELECT has_function_privilege('anon',{literal(signature)},'EXECUTE');"), "f")
            service_only = function["schema"] == "public" and function["name"] in classification.SERVICE_FUNCTIONS
            self.assertEqual(sql(f"SELECT has_function_privilege('service_role',{literal(signature)},'EXECUTE');"), "t" if service_only else "f")
            if service_only or function["schema"] == "private":
                allowed = signature == "private.hours_module_enabled()"
                self.assertEqual(sql(f"SELECT has_function_privilege('authenticated',{literal(signature)},'EXECUTE');"), "t" if allowed else "f")


class EnabledClassificationRegression(classification.ClassificationTests):
    setUp = enabled_setup


class ModuleGateTests(unittest.TestCase):
    """Every test starts with missing (disabled) tenant flags."""
    setUp = qa.HoursWorkflowTests.setUp
    reject = qa.HoursWorkflowTests.reject
    add_placement = qa.HoursWorkflowTests.add_placement
    settings = qa.HoursWorkflowTests.settings
    week = qa.HoursWorkflowTests.week
    view = qa.HoursWorkflowTests.view
    first_day = qa.HoursWorkflowTests.first_day
    save = qa.HoursWorkflowTests.save
    confirm = qa.HoursWorkflowTests.confirm
    review = qa.HoursWorkflowTests.review
    latest = classification.ClassificationTests.latest
    prepared = classification.ClassificationTests.prepared
    save_source = classification.ClassificationTests.save_source
    context = classification.ClassificationTests.context
    final_args = classification.ClassificationTests.final_args
    finalize = classification.ClassificationTests.finalize
    create_matrix = classification.ClassificationTests.create_matrix
    bind = classification.ClassificationTests.bind

    def access(self, user=None):
        return rpc("hours_get_module_access", user=user or self.admin)

    def prepare_all(self):
        toggle(self.org, True)
        day = self.prepared(source=classification.source_input())
        published = self.create_matrix(scope="cao")
        self.bind(published["id"])
        context = self.context(day)
        args = self.final_args(context)
        self.finalize(context)
        self.confirm(day)
        self.review(day)
        draft_matrix = rpc("hours_create_matrix", user=self.admin, p_scope="cao", p_company_id=None, p_name="Synthetic draft")
        draft_matrix = rpc("hours_create_matrix_draft", user=self.admin, p_matrix_id=draft_matrix["id"],
                           p_valid_from="2026-01-01", p_valid_until=None, p_config=classification.matrix_config())
        draft = draft_matrix["versions"][0]
        binding = rpc("hours_get_company_matrix_binding", user=self.admin, p_company_id=self.company)
        settings = rpc("hours_get_company_settings", user=self.admin, p_company_id=self.company)
        revision = day["current_revision"]["id"]
        calls = {
            "hours_get_company_settings": dict(p_company_id=self.company),
            "hours_set_company_settings": dict(p_company_id=self.company, p_expected_version=settings["version"], p_enabled=True,
                                               p_submission_day_offset=7, p_submission_time="10:00", p_confirmation_day_offset=8, p_confirmation_time="12:00"),
            "hours_get_week": dict(p_week_id=day["week_id"]),
            "hours_list_weeks": {},
            "hours_create_week": dict(p_company_id=self.company, p_week_start="2026-09-07"),
            "hours_save_day": dict(p_day_id=day["id"], p_expected_revision_id=revision, p_minutes=420, p_no_hours_reason=None, p_note=None),
            "hours_save_day_source": dict(p_day_id=day["id"], p_expected_revision_id=revision, p_minutes=420, p_no_hours_reason=None, p_note=None, p_source_input=None),
            "hours_confirm_day": dict(p_day_id=day["id"], p_expected_revision_id=revision, p_decision="confirmed", p_note=None),
            "hours_confirm_days": dict(p_week_id=day["week_id"], p_revisions=[{"day_id": day["id"], "revision_id": revision}], p_note=None),
            "hours_review_day": dict(p_day_id=day["id"], p_expected_revision_id=revision, p_status="checked", p_note=None),
            "hours_list_matrices": {},
            "hours_get_matrix": dict(p_matrix_id=published["id"]),
            "hours_create_matrix": dict(p_scope="cao", p_company_id=None, p_name="Blocked synthetic matrix"),
            "hours_create_matrix_draft": dict(p_matrix_id=published["id"], p_valid_from="2030-01-01", p_valid_until=None, p_config=classification.matrix_config()),
            "hours_save_matrix_draft": dict(p_version_id=draft["id"], p_expected_revision=draft["revision"], p_valid_from="2026-01-01", p_valid_until=None, p_config=classification.matrix_config()),
            "hours_publish_matrix_version": dict(p_version_id=draft["id"], p_expected_revision=draft["revision"], p_confirmed=True),
            "hours_get_company_matrix_binding": dict(p_company_id=self.company),
            "hours_set_company_matrix_binding": dict(p_company_id=self.company, p_expected_version=binding["version"], p_cao_matrix_id=published["id"]),
            "hours_get_day_classification_context": dict(p_day_id=day["id"], p_expected_revision_id=revision),
            "hours_finalize_day_classification": args,
        }
        return day, calls

    def data_snapshot(self):
        return {table: json.loads(sql(f"SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), '[]') FROM public.{table} t WHERE organization_id={literal(self.org)};")) for table in TABLES}

    def wait_session(self, name, event_type=None, event=None):
        deadline = time.monotonic() + 8
        predicate = f"application_name={literal(name)}"
        if event_type:
            predicate += f" AND wait_event_type={literal(event_type)}"
        if event:
            predicate += f" AND wait_event={literal(event)}"
        while time.monotonic() < deadline:
            if sql(f"SELECT exists(SELECT 1 FROM pg_stat_activity WHERE {predicate});") == "t":
                return
            time.sleep(0.025)
        raise AssertionError(f"Database session did not reach expected state: {name}, {event_type}, {event}")

    def race_held_transaction(self, first_statement, first_user, second_statement, second_user,
                              second_error=False, first_role="authenticated", second_role="authenticated"):
        first_name, second_name = "gate-first-" + uuid.uuid4().hex, "gate-second-" + uuid.uuid4().hex
        first_sql = f"SET application_name={literal(first_name)}; BEGIN; {first_statement} SELECT pg_sleep(1.2); COMMIT;"
        second_sql = f"SET application_name={literal(second_name)}; {second_statement}"
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            first = executor.submit(sql, first_sql, role=first_role, user=first_user)
            self.wait_session(first_name, event="PgSleep")
            second = executor.submit(sql, second_sql, role=second_role, user=second_user, expect_error=second_error)
            self.wait_session(second_name, event_type="Lock")
            first.result(timeout=10)
            result = second.result(timeout=10)
        if second_error:
            self.assertIn("42501", result)
        return result

    def test_missing_flag_fails_closed_for_internal_and_portal(self):
        for actor in (self.admin, self.worker):
            self.assertEqual(self.access(actor), {"organization_id": self.org, "enabled": False})
            self.reject("hours_list_weeks", user=actor)
        self.reject("hours_list_matrices", user=self.admin)
        self.reject("hours_get_company_settings", user=self.admin, p_company_id=self.company)
        self.assertEqual(sql(f"SELECT count(*) FROM public.organization_modules WHERE organization_id={literal(self.org)};"), "0")

    def test_plan_or_role_settings_cannot_enable_missing_flag(self):
        plan = str(uuid.uuid4())
        sql(f"INSERT INTO public.subscription_plans(id,name,modules) VALUES({literal(plan)},'Synthetic paid plan',ARRAY['uren','uren-workflow']); UPDATE public.organizations SET plan_id={literal(plan)} WHERE id={literal(self.org)};")
        sql(f"UPDATE public.organizations SET settings='{{\"modules\":[\"uren-workflow\"],\"role_permissions\":{{\"medewerker\":{{\"finance.manage\":true}}}}}}' WHERE id={literal(self.org)};")
        sql(f"INSERT INTO public.user_permission_overrides VALUES({literal(self.org)},{literal(self.worker)},'finance.manage',true);")
        self.assertFalse(self.access()["enabled"])
        self.assertFalse(self.access(self.worker)["enabled"])
        for actor in (self.admin, self.worker):
            self.reject("sa_set_hours_workflow_enabled", user=actor, p_organization_id=self.org, p_enabled=True)
            self.assertIn("42501", sql(f"INSERT INTO public.organization_modules(organization_id,module_name,enabled) VALUES({literal(self.org)},'uren-workflow',true);", role="authenticated", user=actor, expect_error=True))

    def test_accessor_has_no_target_argument_and_never_reads_foreign_org(self):
        toggle(self.other_org, True)
        self.assertEqual(self.access(), {"organization_id": self.org, "enabled": False})
        self.assertEqual(self.access(self.other_admin), {"organization_id": self.other_org, "enabled": True})
        count = sql("SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='hours_get_module_access' AND p.pronargs=0;")
        self.assertEqual(count, "1")
        error = sql(rpc_statement("hours_get_module_access", p_organization_id=self.other_org), role="authenticated", user=self.admin, expect_error=True)
        self.assertIn("42883", error)

    def test_preexisting_nullable_flag_is_disabled_and_new_null_is_rejected(self):
        # This row was created before the gate migration, exactly as an old
        # nullable organization_modules row may exist during a rollout.
        self.assertEqual(self.access(NULL_FLAG_ADMIN), {"organization_id": NULL_FLAG_ORG, "enabled": False})
        self.reject("hours_list_weeks", user=NULL_FLAG_ADMIN)
        self.assertTrue(toggle(NULL_FLAG_ORG, True)["enabled"])
        self.assertIn("22023", sql(f"UPDATE public.organization_modules SET enabled=NULL WHERE organization_id={literal(NULL_FLAG_ORG)} AND module_name='uren-workflow';", role="authenticated", user=SA, expect_error=True))
        self.assertTrue(self.access(NULL_FLAG_ADMIN)["enabled"])

    def test_setter_is_not_executable_by_anon_or_service_even_with_saas_subject(self):
        for role in ("anon", "service_role"):
            self.reject("sa_set_hours_workflow_enabled", role=role, user=SA, p_organization_id=self.org, p_enabled=True)
        self.assertFalse(self.access()["enabled"])

    def test_accessor_rejects_inactive_missing_and_anonymous_identity(self):
        toggle(self.org, True)
        sql(f"UPDATE public.profiles SET is_active=false WHERE id={literal(self.admin)};")
        for actor in (self.admin, str(uuid.uuid4()), None, SA):
            self.reject("hours_get_module_access", user=actor)
        self.reject("hours_get_module_access", role="anon")
        self.reject("hours_get_module_access", role="service_role", user=self.admin)

    def test_active_profile_without_org_gets_disabled_without_target(self):
        sql(f"UPDATE public.profiles SET organization_id=NULL WHERE id={literal(self.admin)};")
        self.assertEqual(self.access(), {"organization_id": None, "enabled": False})

    def test_rls_boolean_helper_is_readonly_own_identity_and_false_for_inactive(self):
        toggle(self.other_org, True)
        self.assertEqual(sql("SELECT private.hours_module_enabled();", role="authenticated", user=self.admin), "f")
        self.assertEqual(sql("SELECT private.hours_module_enabled();", role="authenticated", user=self.other_admin), "t")
        sql(f"UPDATE public.profiles SET is_active=false WHERE id={literal(self.other_admin)};")
        self.assertEqual(sql("SELECT private.hours_module_enabled();", role="authenticated", user=self.other_admin), "f")
        for role in ("anon", "service_role"):
            self.assertIn("42501", sql("SELECT private.hours_module_enabled();", role=role, user=self.admin, expect_error=True))

    def test_only_active_saas_admin_can_toggle_and_existing_user_restrictions_still_apply(self):
        sa_with_profile = str(uuid.uuid4())
        sql(f"INSERT INTO auth.users(id) VALUES({literal(sa_with_profile)}); INSERT INTO public.profiles(id,organization_id,role) VALUES({literal(sa_with_profile)},{literal(self.org)},'admin'); INSERT INTO public.superadmins(user_id) VALUES({literal(sa_with_profile)});")
        self.assertTrue(toggle(self.org, True, user=sa_with_profile)["enabled"])
        sql(f"UPDATE public.profiles SET is_active=false WHERE id={literal(sa_with_profile)};")
        self.reject("sa_set_hours_workflow_enabled", user=sa_with_profile, p_organization_id=self.org, p_enabled=False)
        # A legacy direct update is also filtered by the live restrictive policy.
        changed = sql(f"WITH changed AS (UPDATE public.organization_modules SET enabled=false WHERE organization_id={literal(self.org)} AND module_name='uren-workflow' RETURNING id) SELECT count(*) FROM changed;", role="authenticated", user=sa_with_profile)
        self.assertEqual(changed, "0")
        self.assertTrue(self.access()["enabled"])
        self.assertFalse(toggle(self.org, False)["enabled"])

    def test_invalid_toggle_has_no_flag_or_audit_effect(self):
        for target, enabled in ((self.org, None), (str(uuid.uuid4()), True), (None, True)):
            self.reject("sa_set_hours_workflow_enabled", user=SA, code="22023", p_organization_id=target, p_enabled=enabled)
        self.assertEqual(sql(f"SELECT count(*) FROM public.organization_modules WHERE organization_id={literal(self.org)};"), "0")
        self.assertEqual(sql(f"SELECT count(*) FROM public.audit_log WHERE organization_id={literal(self.org)};"), "0")

    def test_every_workflow_rpc_rejects_both_disabled_and_missing_flag(self):
        day, calls = self.prepare_all()
        actual = set(json.loads(sql("SELECT jsonb_agg(proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND proname LIKE 'hours_%' AND proname <> 'hours_get_module_access';")))
        self.assertEqual(set(calls), actual, "New workflow RPCs need an explicit gate test")
        before = self.data_snapshot()
        for state in ("disabled", "missing"):
            if state == "disabled":
                toggle(self.org, False)
            else:
                sql(f"DELETE FROM public.organization_modules WHERE organization_id={literal(self.org)} AND module_name='uren-workflow';", role="authenticated", user=SA)
            for name, params in calls.items():
                with self.subTest(state=state, rpc=name):
                    is_service = name == "hours_finalize_day_classification"
                    actor = self.worker if name in {"hours_confirm_day", "hours_confirm_days"} else self.admin
                    self.reject(name, role="service_role" if is_service else "authenticated", user=None if is_service else actor, **params)
            for name in ("hours_get_week", "hours_list_weeks"):
                self.reject(name, user=self.worker, **calls[name])
            self.assertEqual(before, self.data_snapshot())

    def test_all_thirteen_tables_hide_disabled_data_and_deny_direct_writes(self):
        self.prepare_all()
        before = self.data_snapshot()
        self.assertEqual(len(before), 13)
        self.assertTrue(all(before.values()), "Every gated table must have a nonempty synthetic sample")
        toggle(self.org, False)
        for table in TABLES:
            with self.subTest(table=table):
                for actor in (self.admin, self.worker, self.other_admin):
                    self.assertEqual(sql(f"SELECT count(*) FROM public.{table} WHERE organization_id={literal(self.org)};", role="authenticated", user=actor), "0")
                for role, actor in (("anon", None), ("service_role", self.admin)):
                    self.assertIn("42501", sql(f"SELECT * FROM public.{table};", role=role, user=actor, expect_error=True))
                for role, actor in (("authenticated", self.admin), ("authenticated", self.worker), ("service_role", self.admin)):
                    for statement in (f"DELETE FROM public.{table};", f"UPDATE public.{table} SET organization_id=organization_id;", f"INSERT INTO public.{table} DEFAULT VALUES;"):
                        self.assertIn("42501", sql(statement, role=role, user=actor, expect_error=True))
        self.assertEqual(before, self.data_snapshot())

    def test_off_then_on_restores_exact_history_confirmations_and_matrix_basis(self):
        day, _ = self.prepare_all()
        before = self.view(day["week_id"])
        rows = self.data_snapshot()
        toggle(self.org, False)
        self.reject("hours_get_week", user=self.admin, p_week_id=day["week_id"])
        toggle(self.org, True)
        self.assertEqual(before, self.view(day["week_id"]))
        self.assertEqual(rows, self.data_snapshot())
        self.assertTrue(self.view(day["week_id"], self.worker)["can_confirm"])

    def test_module_flag_read_respects_tenant_and_inactive_rls(self):
        toggle(self.org, True)
        toggle(self.other_org, True)
        statement = "SELECT jsonb_agg(organization_id) FROM public.organization_modules WHERE module_name='uren-workflow';"
        for actor in (self.admin, self.worker):
            self.assertEqual(json.loads(sql(statement, role="authenticated", user=actor)), [self.org])
        sql(f"UPDATE public.profiles SET is_active=false WHERE id={literal(self.admin)};")
        self.assertEqual(sql("SELECT count(*) FROM public.organization_modules;", role="authenticated", user=self.admin), "0")

    def test_direct_flag_write_requires_active_saas_actor_even_service_role(self):
        toggle(self.org, True)
        statement = f"UPDATE public.organization_modules SET enabled=false WHERE organization_id={literal(self.org)} AND module_name='uren-workflow';"
        for role, actor in (("service_role", None), ("service_role", self.admin)):
            self.assertIn("42501", sql(statement, role=role, user=actor, expect_error=True))
        sql(statement, role="authenticated", user=SA)
        self.assertFalse(self.access()["enabled"])
        sql(f"DELETE FROM public.organization_modules WHERE organization_id={literal(self.org)} AND module_name='uren-workflow';", role="authenticated", user=SA)
        self.assertFalse(self.access()["enabled"])

    def test_workflow_flag_identity_cannot_be_rewritten_or_converted(self):
        toggle(self.org, True)
        statements = (
            f"UPDATE public.organization_modules SET module_name='other' WHERE organization_id={literal(self.org)} AND module_name='uren-workflow';",
            f"UPDATE public.organization_modules SET organization_id={literal(self.other_org)} WHERE organization_id={literal(self.org)} AND module_name='uren-workflow';",
            f"UPDATE public.organization_modules SET id=gen_random_uuid() WHERE organization_id={literal(self.org)} AND module_name='uren-workflow';",
        )
        for statement in statements:
            self.assertIn("22023", sql(statement, role="authenticated", user=SA, expect_error=True))
        sql(f"INSERT INTO public.organization_modules(organization_id,module_name,enabled) VALUES({literal(self.org)},'legacy-hours',true);", role="authenticated", user=SA)
        sql(f"DELETE FROM public.organization_modules WHERE organization_id={literal(self.org)} AND module_name='uren-workflow';", role="authenticated", user=SA)
        self.assertIn("22023", sql(f"UPDATE public.organization_modules SET module_name='uren-workflow' WHERE organization_id={literal(self.org)} AND module_name='legacy-hours';", role="authenticated", user=SA, expect_error=True))

    def test_legacy_module_updates_are_unchanged(self):
        sql(f"INSERT INTO public.organization_modules(organization_id,module_name,enabled) VALUES({literal(self.org)},'uren',true);", role="authenticated", user=SA)
        sql(f"UPDATE public.organization_modules SET enabled=NULL WHERE organization_id={literal(self.org)} AND module_name='uren';", role="authenticated", user=SA)
        self.assertEqual(sql(f"SELECT count(*) FROM public.organization_modules WHERE organization_id={literal(self.org)} AND module_name='uren' AND enabled IS NULL;"), "1")
        self.assertFalse(self.access()["enabled"])
        self.assertEqual(sql(f"SELECT count(*) FROM public.audit_log WHERE organization_id={literal(self.org)};"), "0")

    def test_toggle_audit_retains_actor_without_profile_and_skips_noop(self):
        toggle(self.org, True)
        toggle(self.org, True)
        toggle(self.org, False)
        rows = json.loads(sql(f"SELECT jsonb_agg(to_jsonb(a) ORDER BY created_at,id) FROM public.audit_log a WHERE organization_id={literal(self.org)};"))
        self.assertEqual([row["action"] for row in rows], ["create", "update"])
        self.assertTrue(all(row["user_id"] is None for row in rows))
        self.assertTrue(all(row["new_values"]["actor_id"] == SA for row in rows))
        self.assertTrue(rows[0]["new_values"]["enabled"])
        self.assertTrue(rows[1]["old_values"]["enabled"])
        self.assertFalse(rows[1]["new_values"]["enabled"])

    def test_inflight_save_commits_before_disable_without_deadlock(self):
        toggle(self.org, True)
        day = self.prepared()
        save = rpc_statement("hours_save_day", p_day_id=day["id"], p_expected_revision_id=day["current_revision"]["id"], p_minutes=420, p_no_hours_reason=None, p_note=None)
        disable = rpc_statement("sa_set_hours_workflow_enabled", p_organization_id=self.org, p_enabled=False)
        self.race_held_transaction(save, self.admin, disable, SA)
        self.assertFalse(self.access()["enabled"])
        self.assertEqual(sql(f"SELECT minutes FROM public.hours_day_revisions r JOIN public.hours_days d ON d.current_revision_id=r.id WHERE d.id={literal(day['id'])};"), "420")

    def test_save_waiting_on_disable_rechecks_flag_and_writes_nothing(self):
        toggle(self.org, True)
        day = self.prepared()
        before = self.data_snapshot()
        save = rpc_statement("hours_save_day", p_day_id=day["id"], p_expected_revision_id=day["current_revision"]["id"], p_minutes=420, p_no_hours_reason=None, p_note=None)
        disable = rpc_statement("sa_set_hours_workflow_enabled", p_organization_id=self.org, p_enabled=False)
        self.race_held_transaction(disable, SA, save, self.admin, second_error=True)
        self.assertEqual(before, self.data_snapshot())

    def test_bulk_portal_confirmation_waiting_on_disable_is_atomic(self):
        toggle(self.org, True)
        day = self.prepared()
        before = self.data_snapshot()
        confirm = rpc_statement("hours_confirm_days", p_week_id=day["week_id"], p_revisions=[{"day_id":day["id"],"revision_id":day["current_revision"]["id"]}], p_note=None)
        disable = rpc_statement("sa_set_hours_workflow_enabled", p_organization_id=self.org, p_enabled=False)
        self.race_held_transaction(disable, SA, confirm, self.worker, second_error=True)
        self.assertEqual(before, self.data_snapshot())

    def test_missing_flag_enabling_transaction_serializes_before_waiting_write(self):
        toggle(self.org, True)
        day = self.prepared()
        sql(f"DELETE FROM public.organization_modules WHERE organization_id={literal(self.org)} AND module_name='uren-workflow';", role="authenticated", user=SA)
        self.assertFalse(self.access()["enabled"])
        enable = rpc_statement("sa_set_hours_workflow_enabled", p_organization_id=self.org, p_enabled=True)
        save = rpc_statement("hours_save_day", p_day_id=day["id"], p_expected_revision_id=day["current_revision"]["id"], p_minutes=420, p_no_hours_reason=None, p_note=None)
        self.race_held_transaction(enable, SA, save, self.admin)
        self.assertEqual(self.latest(day)["current_revision"]["minutes"], 420)

    def test_service_finalize_waiting_on_disable_rechecks_actor_org_flag(self):
        toggle(self.org, True)
        day = self.prepared()
        self.create_matrix()
        args = self.final_args(self.context(day))
        before = self.data_snapshot()
        disable = rpc_statement("sa_set_hours_workflow_enabled", p_organization_id=self.org, p_enabled=False)
        finalize = rpc_statement("hours_finalize_day_classification", **args)
        self.race_held_transaction(disable, SA, finalize, None, second_error=True, second_role="service_role")
        self.assertEqual(before, self.data_snapshot())

    def test_direct_update_and_rpc_upsert_use_consistent_lock_order(self):
        toggle(self.org, True)
        # A direct update acquires the existing module tuple before its trigger.
        # Simulate that exact interleaving while the RPC enters ON CONFLICT. The
        # former BEFORE INSERT organization lock creates a reproducible deadlock.
        direct = (f"SELECT id FROM public.organization_modules WHERE organization_id={literal(self.org)} AND module_name='uren-workflow' FOR UPDATE; "
                  "SELECT pg_sleep(1.2); "
                  f"UPDATE public.organization_modules SET enabled=false WHERE organization_id={literal(self.org)} AND module_name='uren-workflow';")
        upsert = rpc_statement("sa_set_hours_workflow_enabled", p_organization_id=self.org, p_enabled=True)
        self.race_held_transaction(direct, SA, upsert, SA)
        self.assertTrue(self.access()["enabled"])

    def test_higher_isolation_rejects_writes_without_using_a_stale_snapshot(self):
        toggle(self.org, True)
        day = self.prepared()
        before = self.data_snapshot()
        save = rpc_statement("hours_save_day", p_day_id=day["id"], p_expected_revision_id=day["current_revision"]["id"], p_minutes=420, p_no_hours_reason=None, p_note=None)
        for isolation in ("REPEATABLE READ", "SERIALIZABLE"):
            with self.subTest(isolation=isolation):
                error = sql(f"BEGIN ISOLATION LEVEL {isolation}; SELECT public.hours_get_module_access(); {save} COMMIT;", role="authenticated", user=self.admin, expect_error=True)
                self.assertIn("25001", error)
        self.assertEqual(before, self.data_snapshot())

    def test_repeatable_read_snapshot_from_before_toggle_cannot_authorize_later_save(self):
        toggle(self.org, True)
        day = self.prepared()
        before = self.data_snapshot()
        save = rpc_statement("hours_save_day", p_day_id=day["id"], p_expected_revision_id=day["current_revision"]["id"], p_minutes=420, p_no_hours_reason=None, p_note=None)
        name = "gate-snapshot-" + uuid.uuid4().hex
        statement = f"SET application_name={literal(name)}; BEGIN ISOLATION LEVEL REPEATABLE READ; SELECT public.hours_get_module_access(); SELECT pg_sleep(1.2); {save} COMMIT;"
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            old_snapshot = executor.submit(sql, statement, role="authenticated", user=self.admin, expect_error=True)
            self.wait_session(name, event="PgSleep")
            toggle(self.org, False)
            self.assertIn("25001", old_snapshot.result(timeout=10))
        self.assertEqual(before, self.data_snapshot())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cleanup", action="store_true")
    parser.add_argument("--gate-only", action="store_true", help="Development rerun; final run includes all 74 unchanged regressions")
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
    )]
    fixtures = [ROOT / "tests/db/hours-workflow-fixture.sql", ROOT / "tests/db/hours-module-gate-fixture.sql"]
    harnesses = [ROOT / "scripts/hours-workflow-db-test.py", ROOT / "scripts/hours-classification-db-test.py", Path(__file__).resolve()]
    engines = [ROOT / "supabase/functions/_shared/hours-calculation.ts", ROOT / "supabase/functions/_shared/hours-classification.ts"]
    sources = paths + fixtures + harnesses + engines
    hashes = {path: hashlib.sha256(path.read_bytes()).hexdigest() for path in sources}
    qa.ensure_container()
    if sql("SELECT to_regclass('public.organizations') IS NOT NULL;") == "t":
        raise RuntimeError("QA database already exists; inspect results and use --cleanup")
    for fixture in fixtures:
        sql(fixture.read_text())
    sql(f"INSERT INTO public.organizations(id,name) VALUES({literal(NULL_FLAG_ORG)},'Synthetic pre-gate nullable organization'); INSERT INTO auth.users(id) VALUES({literal(NULL_FLAG_ADMIN)}); INSERT INTO public.profiles(id,organization_id,role) VALUES({literal(NULL_FLAG_ADMIN)},{literal(NULL_FLAG_ORG)},'admin'); INSERT INTO public.organization_modules(organization_id,module_name,enabled) VALUES({literal(NULL_FLAG_ORG)},'uren-workflow',NULL);")
    for path in paths:
        sql(path.read_text())
        sql(path.read_text())
    sql(f"INSERT INTO auth.users(id) VALUES({literal(SA)}); INSERT INTO public.superadmins(user_id) VALUES({literal(SA)});")
    database = sql("SELECT version();")
    classes = [ModuleGateTests] if args.gate_only else [EnabledFoundationRegression, EnabledClassificationRegression, ModuleGateTests]
    suite = unittest.TestSuite(unittest.defaultTestLoader.loadTestsFromTestCase(cls) for cls in classes)
    identifiers = [test.id() for group in suite for test in group]
    started = time.monotonic()
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    unchanged = all(hashlib.sha256(path.read_bytes()).hexdigest() == digest for path, digest in hashes.items())
    report = {
        "success": result.wasSuccessful() and unchanged, "tests_run": result.testsRun,
        "classification_and_foundation_regressions": 0 if args.gate_only else 74,
        "permission_contract_extension": "Only private.hours_module_enabled() gets authenticated EXECUTE for RLS; separately verified own-identity/active-only boolean",
        "regression_opt_in": "Explicit real SaaS-admin RPC call per synthetic organization; no test logic bypass",
        "tests": identifiers, "database": database, "image": qa.IMAGE,
        "container": qa.CONTAINER, "network": "none", "host_ports": [], "host_mounts": [],
        "elapsed_seconds": round(time.monotonic() - started, 3),
        "migrations": [{"path": str(path.relative_to(ROOT)), "sha256": hashes[path]} for path in paths],
        "migration_applications_each": 2, "inputs_unchanged_during_run": unchanged,
        "fixtures": [{"path": str(path.relative_to(ROOT)), "sha256": hashes[path]} for path in fixtures],
        "harnesses": [{"path": str(path.relative_to(ROOT)), "sha256": hashes[path]} for path in harnesses],
        "engines": [{"path": str(path.relative_to(ROOT)), "sha256": hashes[path]} for path in engines],
        "source_validation": classification.SOURCE_RESULTS,
        "failures": [{"test": test.id(), "traceback": trace} for test, trace in result.failures],
        "errors": [{"test": test.id(), "traceback": trace} for test, trace in result.errors],
        "production_writes": 0, "real_provider_calls": 0, "communications_sent": 0,
        "verified_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "run_command": "python3 scripts/hours-module-gate-db-test.py" + (" --gate-only" if args.gate_only else ""),
        "output_directory": str(OUTPUT.resolve()),
    }
    OUTPUT.mkdir(parents=True, exist_ok=True)
    path = OUTPUT / "hours-module-gate-db-qa-result.json"
    path.write_text(json.dumps(report, indent=2) + "\n")
    print("Result JSON:", path, flush=True)
    return 0 if report["success"] else 1


if __name__ == "__main__":
    sys.exit(main())
