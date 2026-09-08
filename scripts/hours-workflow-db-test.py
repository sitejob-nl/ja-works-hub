#!/usr/bin/env python3
"""Hours workflow integration tests against disposable Supabase PostgreSQL.

Uses only a labelled, no-network local Docker container, with no host ports,
credentials, real tenant writes, provider calls or mail. Public authorization
helpers in the fixture are exact live definitions retrieved read-only.
Run: python3 scripts/hours-workflow-db-test.py
Then: python3 scripts/hours-workflow-db-test.py --cleanup
Set HOURS_WORKFLOW_QA_OUTPUT to retain the report outside this worktree.
"""

import argparse
import concurrent.futures
import hashlib
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
CONTAINER = "ja-works-hours-workflow-test-20260908"
LABEL = "ja-werkt-hours-workflow-qa"
LABEL_VALUE = "20260908"
IMAGE = "public.ecr.aws/supabase/postgres:17.6.1.127"
OUTPUT = Path(os.environ.get("HOURS_WORKFLOW_QA_OUTPUT", ROOT / "test-results/hours-workflow-db"))


def literal(value):
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, (dict, list)):
        return "'" + json.dumps(value).replace("'", "''") + "'::jsonb"
    return "'" + str(value).replace("'", "''") + "'"


class SQLFailure(AssertionError):
    pass


def sql(statement, role=None, user=None, expect_error=False):
    prefix = "\\set VERBOSITY verbose\n"
    if role:
        if role not in {"anon", "authenticated", "service_role"}:
            raise ValueError("Unexpected database role")
        claims = {"role": role}
        if user:
            claims["sub"] = user
        # The cached image's auth.uid reads the individual claim GUC, while
        # current hosted Supabase also supports the aggregate PostgREST claims.
        prefix += (f"SET request.jwt.claims={literal(json.dumps(claims))}; "
                   f"SET request.jwt.claim.sub={literal(user or '')}; "
                   f"SET request.jwt.claim.role={literal(role)}; SET ROLE {role};\n")
    result = subprocess.run(
        ["docker", "exec", "-i", CONTAINER, "psql", "-X", "-q", "-A", "-t",
         "-v", "ON_ERROR_STOP=1", "-U", "supabase_admin", "-d", "postgres"],
        input=prefix + statement, text=True, capture_output=True, timeout=30,
    )
    if expect_error:
        if result.returncode == 0:
            raise AssertionError(f"Expected SQL rejection: {statement}\n{result.stdout}")
        return result.stderr
    if result.returncode:
        raise SQLFailure(f"SQL failed: {statement}\n{result.stderr}")
    return result.stdout.strip()


def rpc_statement(name, **params):
    args = ", ".join(f"{key} => {literal(value)}" for key, value in params.items())
    return f"SELECT public.{name}({args});"


def rpc(name, user=None, role="authenticated", **params):
    return json.loads(sql(rpc_statement(name, **params), role=role, user=user))


def owned_container():
    result = subprocess.run(["docker", "inspect", CONTAINER], capture_output=True,
                            text=True, check=True)
    state = json.loads(result.stdout)[0]
    if state["Config"]["Labels"].get(LABEL) != LABEL_VALUE:
        raise RuntimeError("Refusing to operate on a container without our QA label")
    if state["HostConfig"]["NetworkMode"] != "none":
        raise RuntimeError("The QA container must have network disabled")
    if state["HostConfig"].get("PortBindings"):
        raise RuntimeError("The QA container must not publish host ports")
    if any(mount.get("Type") == "bind" for mount in state.get("Mounts", [])):
        raise RuntimeError("The QA container must not mount host files")
    return state


def ensure_container():
    existing = subprocess.run(["docker", "inspect", CONTAINER], capture_output=True, text=True)
    if existing.returncode:
        subprocess.run([
            "docker", "run", "-d", "--name", CONTAINER,
            "--label", f"{LABEL}={LABEL_VALUE}", "--network", "none",
            "--tmpfs", "/var/lib/postgresql/data:rw",
            "-e", "POSTGRES_PASSWORD=isolated-hours-qa-only", "-e", "POSTGRES_DB=postgres",
            IMAGE,
        ], check=True, stdout=subprocess.DEVNULL)
    owned_container()
    for _ in range(80):
        ready = subprocess.run(
            ["docker", "exec", CONTAINER, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        if ready.returncode == 0:
            return
        time.sleep(0.25)
    raise RuntimeError("Disposable PostgreSQL did not start")


def migrations():
    found = sorted((ROOT / "supabase/migrations").glob("*hours_workflow_foundation.sql"))
    if len(found) != 1:
        raise RuntimeError("Expected exactly one hours workflow foundation migration")
    return found


def initialize(paths):
    if sql("SELECT to_regclass('public.organizations') IS NOT NULL;") == "t":
        raise RuntimeError("QA data already exists; inspect results then use --cleanup")
    sql((ROOT / "tests/db/hours-workflow-fixture.sql").read_text())
    for path in paths:
        sql(path.read_text())
        sql(path.read_text())  # DDL must be safe on a second application.


class HoursWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.org, self.other_org, self.company, self.other_company = [str(uuid.uuid4()) for _ in range(4)]
        self.admin, self.other_admin, self.worker, self.other_worker = [str(uuid.uuid4()) for _ in range(4)]
        self.candidate, self.other_candidate = [str(uuid.uuid4()) for _ in range(2)]
        sql(f"""
          INSERT INTO public.organizations(id,name) VALUES
            ({literal(self.org)},'Synthetic organization A'),({literal(self.other_org)},'Synthetic organization B');
          INSERT INTO auth.users(id) VALUES ({literal(self.admin)}),({literal(self.other_admin)}),
            ({literal(self.worker)}),({literal(self.other_worker)});
          INSERT INTO public.profiles(id,organization_id,role) VALUES
            ({literal(self.admin)},{literal(self.org)},'admin'),
            ({literal(self.other_admin)},{literal(self.other_org)},'admin'),
            ({literal(self.worker)},{literal(self.org)},'medewerker'),
            ({literal(self.other_worker)},{literal(self.org)},'medewerker');
          INSERT INTO public.companies(id,organization_id) VALUES
            ({literal(self.company)},{literal(self.org)}),({literal(self.other_company)},{literal(self.other_org)});
          INSERT INTO public.candidates(id,organization_id,auth_user_id) VALUES
            ({literal(self.candidate)},{literal(self.org)},{literal(self.worker)}),
            ({literal(self.other_candidate)},{literal(self.org)},{literal(self.other_worker)});
        """)
        self.placement = self.add_placement()

    def add_placement(self, start="2026-09-07", end="2026-09-13", candidate=None,
                      company=None, org=None, status="actief"):
        identifier = str(uuid.uuid4())
        sql(f"""INSERT INTO public.placements(id,organization_id,candidate_id,company_id,start_date,end_date,status)
          VALUES ({literal(identifier)},{literal(org or self.org)},{literal(candidate or self.candidate)},
            {literal(company or self.company)},{literal(start)},{literal(end)},{literal(status)});""")
        return identifier

    def settings(self, **changes):
        current = rpc("hours_get_company_settings", user=self.admin, p_company_id=self.company)
        params = dict(p_company_id=self.company, p_expected_version=current["version"], p_enabled=True,
                      p_submission_day_offset=7, p_submission_time="10:00", p_confirmation_day_offset=8,
                      p_confirmation_time="12:00")
        params.update(changes)
        return rpc("hours_set_company_settings", user=self.admin, **params)

    def week(self, week_start="2026-09-07", enable=True):
        if enable:
            self.settings()
        rpc("hours_create_week", user=self.admin, p_company_id=self.company, p_week_start=week_start)
        identifier = sql(f"SELECT id FROM public.hours_weeks WHERE company_id={literal(self.company)} "
                         f"AND week_start={literal(week_start)};")
        return self.view(identifier)

    def view(self, identifier, user=None):
        return rpc("hours_get_week", user=user or self.admin, p_week_id=identifier)

    def first_day(self, week=None):
        return (week or self.week())["members"][0]["days"][0]

    def save(self, day, minutes=480, reason=None, note=None, user=None):
        current = day.get("current_revision")
        return rpc("hours_save_day", user=user or self.admin, p_day_id=day["id"],
                   p_expected_revision_id=current["id"] if current else None,
                   p_minutes=minutes, p_no_hours_reason=reason, p_note=note)

    def reject(self, name, code="42501", user=None, role="authenticated", **params):
        error = sql(rpc_statement(name, **params), role=role, user=user, expect_error=True)
        self.assertIn(code, error)
        return error

    def confirm(self, day, decision="confirmed", note=None, user=None):
        return rpc("hours_confirm_day", user=user or self.worker, p_day_id=day["id"],
                   p_expected_revision_id=day["current_revision"]["id"], p_decision=decision, p_note=note)

    def review(self, day, status="checked", note=None):
        return rpc("hours_review_day", user=self.admin, p_day_id=day["id"],
                   p_expected_revision_id=day["current_revision"]["id"], p_status=status, p_note=note)

    def test_default_disabled_no_implicit_activation(self):
        settings = rpc("hours_get_company_settings", user=self.admin, p_company_id=self.company)
        self.assertFalse(settings["enabled"])
        self.reject("hours_create_week", code="22023", user=self.admin,
                    p_company_id=self.company, p_week_start="2026-09-07")
        self.assertEqual(sql(f"SELECT count(*) FROM public.hours_weeks WHERE company_id={literal(self.company)};"), "0")

    def test_create_week_has_seven_blank_days_and_no_release(self):
        week = self.week()
        self.assertEqual(len(week["members"]), 1)
        self.assertEqual(len(week["members"][0]["days"]), 7)
        self.assertEqual([d["work_date"] for d in week["members"][0]["days"]],
                         [f"2026-09-{day:02}" for day in range(7, 14)])
        self.assertTrue(all(d["current_revision"] is None for d in week["members"][0]["days"]))
        self.assertFalse(week["release_available"])

    def test_create_duplicate_week_idempotent(self):
        first = self.week()
        second = self.week(enable=False)
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(sql(f"SELECT count(*) FROM public.hours_week_members WHERE week_id={literal(first['id'])};"), "1")

    def test_monday_validation_and_invalid_week_null(self):
        self.settings()
        for start in ("2026-09-08", "2026-09-13", None):
            with self.subTest(start=start):
                self.reject("hours_create_week", code="22023", user=self.admin,
                            p_company_id=self.company, p_week_start=start)

    def test_placement_date_overlap_limits_member_days(self):
        sql(f"DELETE FROM public.placements WHERE id={literal(self.placement)};")
        self.add_placement("2026-09-09", "2026-09-11")
        self.add_placement("2026-09-14", None)
        self.add_placement("2026-08-01", "2026-09-06")
        week = self.week()
        self.assertEqual(len(week["members"]), 1)
        self.assertEqual([d["work_date"] for d in week["members"][0]["days"]],
                         ["2026-09-09", "2026-09-10", "2026-09-11"])

    def test_two_placements_same_worker_remain_separate(self):
        second = self.add_placement("2026-09-10", None)
        week = self.week()
        self.assertEqual({m["placement_id"] for m in week["members"]}, {self.placement, second})
        self.assertEqual(sorted(len(m["days"]) for m in week["members"]), [4, 7])

    def test_placement_foreign_company_not_included_wrong_candidate_blocks_creation(self):
        self.add_placement(company=self.other_company)
        self.assertEqual([m["placement_id"] for m in self.week()["members"]], [self.placement])
        foreign = str(uuid.uuid4())
        sql(f"INSERT INTO public.candidates(id,organization_id) VALUES ({literal(foreign)},{literal(self.other_org)});")
        self.add_placement(candidate=foreign, start="2026-09-14", end="2026-09-20")
        self.reject("hours_create_week", code="22023", user=self.admin,
                    p_company_id=self.company, p_week_start="2026-09-14")

    def test_org_isolation_read_create_and_config(self):
        week = self.week()
        self.reject("hours_get_week", user=self.other_admin, p_week_id=week["id"])
        self.reject("hours_create_week", user=self.other_admin, p_company_id=self.company, p_week_start="2026-09-07")
        self.reject("hours_get_company_settings", user=self.other_admin, p_company_id=self.company)
        listed = rpc("hours_list_weeks", user=self.other_admin)
        self.assertNotIn(week["id"], [w["id"] for w in listed["weeks"]])

    def test_portal_week_and_list_only_own_candidate(self):
        self.add_placement(candidate=self.other_candidate)
        week = self.week()
        own = self.view(week["id"], self.worker)
        self.assertEqual([m["candidate_id"] for m in own["members"]], [self.candidate])
        self.assertTrue(own["can_confirm"])
        self.assertFalse(own["can_manage"])
        other = self.view(week["id"], self.other_worker)
        self.assertEqual([m["candidate_id"] for m in other["members"]], [self.other_candidate])
        listed = rpc("hours_list_weeks", user=self.worker)
        own_summary = next(w for w in listed["weeks"] if w["id"] == week["id"])
        self.assertEqual(own_summary["member_count"], 1)
        self.assertEqual(own_summary["day_count"], 7)

    def test_portal_no_membership_denied_and_list_empty(self):
        week = self.week()
        self.reject("hours_get_week", user=self.other_worker, p_week_id=week["id"])
        self.assertEqual(rpc("hours_list_weeks", user=self.other_worker)["weeks"], [])

    def test_inactive_and_missing_identity_denied(self):
        week = self.week()
        sql(f"UPDATE public.profiles SET is_active=false WHERE id={literal(self.admin)};")
        self.reject("hours_get_week", user=self.admin, p_week_id=week["id"])
        self.reject("hours_list_weeks", user=self.admin)
        self.reject("hours_get_week", p_week_id=week["id"])
        self.reject("hours_list_weeks")

    def test_portal_role_or_org_mismatch_denied(self):
        week = self.week()
        sql(f"UPDATE public.profiles SET organization_id={literal(self.other_org)} WHERE id={literal(self.worker)};")
        self.reject("hours_get_week", user=self.worker, p_week_id=week["id"])
        sql(f"UPDATE public.profiles SET organization_id={literal(self.org)},role='opdrachtgever' WHERE id={literal(self.worker)};")
        self.reject("hours_get_week", user=self.worker, p_week_id=week["id"])

    def test_anonymous_has_no_rpc_or_table_access(self):
        week = self.week()
        for fn, params in (
            ("hours_get_week", {"p_week_id": week["id"]}),
            ("hours_list_weeks", {}),
            ("hours_create_week", {"p_company_id": self.company, "p_week_start": "2026-09-07"}),
            ("hours_save_day", {"p_day_id": self.first_day(week)["id"], "p_expected_revision_id": None,
                                "p_minutes": 480, "p_no_hours_reason": None, "p_note": None}),
        ):
            self.reject(fn, role="anon", **params)
        self.assertIn("42501", sql("SELECT * FROM public.hours_weeks;", role="anon", expect_error=True))

    def test_direct_table_writes_denied_internal_and_portal(self):
        week = self.week()
        for role, user in (("authenticated", self.admin), ("authenticated", self.worker), ("service_role", None)):
            for table in ("hours_company_settings", "hours_weeks", "hours_week_members", "hours_days",
                          "hours_day_revisions", "hours_day_confirmations", "hours_day_reviews"):
                with self.subTest(role=role, user=user, table=table):
                    self.assertIn("42501", sql(f"DELETE FROM public.{table};", role=role, user=user, expect_error=True))

    def test_table_rls_internal_org_and_portal_rpc_only(self):
        self.add_placement(candidate=self.other_candidate)
        week = self.week()
        query = f"SELECT count(*) FROM public.hours_week_members WHERE week_id={literal(week['id'])};"
        self.assertEqual(sql(query, role="authenticated", user=self.admin), "2")
        self.assertEqual(sql(query, role="authenticated", user=self.worker), "0")
        self.assertEqual(sql(query, role="authenticated", user=self.other_admin), "0")

    def test_blank_is_not_zero_and_zero_requires_explicit_reason(self):
        week = self.week()
        day = self.first_day(week)
        self.assertIsNone(day["current_revision"])
        for minutes, reason in ((None, None), (0, None), (0, ""), (0, "   ")):
            self.reject("hours_save_day", code="22023", user=self.admin, p_day_id=day["id"],
                        p_expected_revision_id=None, p_minutes=minutes, p_no_hours_reason=reason, p_note=None)
        self.assertIsNone(self.first_day(self.view(week["id"]))["current_revision"])
        self.save(day, minutes=0, reason="Geen werk ingepland")
        saved = self.first_day(self.view(week["id"]))["current_revision"]
        self.assertEqual(saved["minutes"], 0)
        self.assertEqual(saved["no_hours_reason"], "Geen werk ingepland")

    def test_minutes_bounds_and_reason_on_positive_minutes(self):
        day = self.first_day()
        for minutes, reason in ((-1, None), (1441, None), (480, "Niet gewerkt")):
            self.reject("hours_save_day", code="22023", user=self.admin, p_day_id=day["id"],
                        p_expected_revision_id=None, p_minutes=minutes, p_no_hours_reason=reason, p_note=None)

    def test_revision_history_append_and_stale_update_rejected(self):
        week = self.week()
        original = self.first_day(week)
        self.save(original, minutes=480)
        first = self.first_day(self.view(week["id"]))
        self.save(first, minutes=420)
        second = self.first_day(self.view(week["id"]))
        self.assertEqual(second["current_revision"]["revision_number"], 2)
        self.assertEqual(sorted(r["minutes"] for r in second["history"]), [420, 480])
        self.reject("hours_save_day", code="40001", user=self.admin, p_day_id=first["id"],
                    p_expected_revision_id=first["current_revision"]["id"], p_minutes=300,
                    p_no_hours_reason=None, p_note=None)
        self.assertEqual(self.first_day(self.view(week["id"]))["current_revision"]["id"], second["current_revision"]["id"])

    def test_concurrent_revision_compare_and_swap_exactly_one_winner(self):
        week = self.week()
        day = self.first_day(week)
        barrier = threading.Barrier(6)
        def update(minutes):
            barrier.wait(timeout=10)
            try:
                self.save(day, minutes=minutes)
                return "saved"
            except SQLFailure as error:
                self.assertIn("40001", str(error))
                return "conflict"
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            results = list(pool.map(update, range(100, 106)))
        self.assertEqual(results.count("saved"), 1)
        self.assertEqual(results.count("conflict"), 5)
        current = self.first_day(self.view(week["id"]))
        self.assertEqual(len(current["history"]), 1)
        self.assertEqual(current["current_revision"]["revision_number"], 1)

    def test_confirmation_exact_revision_and_update_invalidates_it(self):
        week = self.week()
        self.save(self.first_day(week))
        first = self.first_day(self.view(week["id"]))
        self.confirm(first)
        confirmed = self.first_day(self.view(week["id"]))
        self.assertEqual(confirmed["confirmation"]["revision_id"], first["current_revision"]["id"])
        self.save(first, minutes=420)
        updated = self.first_day(self.view(week["id"]))
        self.assertIsNone(updated["confirmation"])
        self.reject("hours_confirm_day", code="40001", user=self.worker, p_day_id=first["id"],
                    p_expected_revision_id=first["current_revision"]["id"], p_decision="confirmed", p_note=None)
        self.assertEqual(sql(f"SELECT count(*) FROM public.hours_day_confirmations WHERE day_id={literal(first['id'])};"), "1")

    def test_review_exact_revision_and_update_invalidates_it(self):
        week = self.week()
        self.save(self.first_day(week))
        first = self.first_day(self.view(week["id"]))
        self.review(first)
        checked = self.first_day(self.view(week["id"]))
        self.assertEqual(checked["review"]["revision_id"], first["current_revision"]["id"])
        self.save(first, minutes=420)
        self.assertIsNone(self.first_day(self.view(week["id"]))["review"])
        self.reject("hours_review_day", code="40001", user=self.admin, p_day_id=first["id"],
                    p_expected_revision_id=first["current_revision"]["id"], p_status="checked", p_note=None)

    def test_portal_cannot_write_review_create_or_config(self):
        week = self.week()
        self.save(self.first_day(week))
        day = self.first_day(self.view(week["id"]))
        self.reject("hours_save_day", user=self.worker, p_day_id=day["id"],
                    p_expected_revision_id=day["current_revision"]["id"], p_minutes=480,
                    p_no_hours_reason=None, p_note=None)
        self.reject("hours_review_day", user=self.worker, p_day_id=day["id"],
                    p_expected_revision_id=day["current_revision"]["id"], p_status="checked", p_note=None)
        self.reject("hours_create_week", user=self.worker, p_company_id=self.company, p_week_start="2026-09-14")
        self.reject("hours_get_company_settings", user=self.worker, p_company_id=self.company)

    def test_cannot_confirm_another_worker_or_confirm_as_internal(self):
        week = self.week()
        self.save(self.first_day(week))
        day = self.first_day(self.view(week["id"]))
        for user in (self.other_worker, self.admin, self.other_admin):
            self.reject("hours_confirm_day", user=user, p_day_id=day["id"],
                        p_expected_revision_id=day["current_revision"]["id"], p_decision="confirmed", p_note=None)

    def test_empty_day_cannot_confirm_or_review(self):
        day = self.first_day()
        for fn, user, extra in (("hours_confirm_day", self.worker, {"p_decision": "confirmed"}),
                                ("hours_review_day", self.admin, {"p_status": "checked"})):
            self.reject(fn, code="40001", user=user, p_day_id=day["id"], p_expected_revision_id=None, p_note=None, **extra)

    def test_dispute_and_block_require_explanation(self):
        week = self.week()
        self.save(self.first_day(week))
        day = self.first_day(self.view(week["id"]))
        self.reject("hours_confirm_day", code="22023", user=self.worker, p_day_id=day["id"],
                    p_expected_revision_id=day["current_revision"]["id"], p_decision="disputed", p_note=None)
        self.reject("hours_review_day", code="22023", user=self.admin, p_day_id=day["id"],
                    p_expected_revision_id=day["current_revision"]["id"], p_status="blocked", p_note=None)
        self.confirm(day, "disputed", "Deze uren wijken af")
        self.review(day, "blocked", "Navraag nodig")
        result = self.first_day(self.view(week["id"]))
        self.assertEqual(result["confirmation"]["decision"], "disputed")
        self.assertEqual(result["review"]["status"], "blocked")

    def test_finance_permission_not_internal_role_alone(self):
        week = self.week()
        sql(f"UPDATE public.profiles SET role='intercedent' WHERE id={literal(self.admin)};")
        self.reject("hours_get_week", user=self.admin, p_week_id=week["id"])
        sql(f"UPDATE public.profiles SET role='backoffice' WHERE id={literal(self.admin)};")
        self.assertFalse(self.view(week["id"])["can_manage"])
        day = self.first_day(week)
        self.reject("hours_save_day", user=self.admin, p_day_id=day["id"], p_expected_revision_id=None,
                    p_minutes=480, p_no_hours_reason=None, p_note=None)
        sql(f"UPDATE public.profiles SET role='finance' WHERE id={literal(self.admin)};")
        self.save(day)
        sql(f"INSERT INTO public.user_permission_overrides(organization_id,user_id,permission_key,allowed) "
            f"VALUES ({literal(self.org)},{literal(self.admin)},'finance.manage',false);")
        self.reject("hours_save_day", user=self.admin, p_day_id=day["id"], p_expected_revision_id=None,
                    p_minutes=480, p_no_hours_reason=None, p_note=None)

    def test_settings_version_conflict_and_snapshot_unchanged(self):
        week = self.week()
        first = rpc("hours_get_company_settings", user=self.admin, p_company_id=self.company)
        self.settings(p_submission_time="11:00")
        self.reject("hours_set_company_settings", code="40001", user=self.admin,
                    p_company_id=self.company, p_expected_version=first["version"], p_enabled=True,
                    p_submission_day_offset=7, p_submission_time="13:00", p_confirmation_day_offset=8,
                    p_confirmation_time="12:00")
        self.assertEqual(self.view(week["id"])["submission_deadline_at"], week["submission_deadline_at"])

    def test_deadline_order_and_day_bounds_validation(self):
        current = rpc("hours_get_company_settings", user=self.admin, p_company_id=self.company)
        base = dict(p_company_id=self.company, p_expected_version=current["version"], p_enabled=True,
                    p_submission_day_offset=7, p_submission_time="10:00", p_confirmation_day_offset=8,
                    p_confirmation_time="12:00")
        for changes in ({"p_submission_day_offset": -1}, {"p_confirmation_day_offset": 40},
                        {"p_confirmation_day_offset": 7, "p_confirmation_time": "09:00"},
                        {"p_confirmation_day_offset": 7, "p_confirmation_time": "10:00"}):
            self.reject("hours_set_company_settings", code="22023", user=self.admin, **{**base, **changes})

    def test_disabled_config_blocks_new_week_after_optout(self):
        week = self.week()
        self.save(self.first_day(week))
        day = self.first_day(self.view(week["id"]))
        self.settings(p_enabled=False)
        self.reject("hours_create_week", code="22023", user=self.admin,
                    p_company_id=self.company, p_week_start="2026-09-14")
        self.reject("hours_save_day", code="22023", user=self.admin, p_day_id=day["id"],
                    p_expected_revision_id=day["current_revision"]["id"], p_minutes=420, p_no_hours_reason=None, p_note=None)
        self.reject("hours_confirm_day", code="22023", user=self.worker, p_day_id=day["id"],
                    p_expected_revision_id=day["current_revision"]["id"], p_decision="confirmed", p_note=None)
        self.assertFalse(self.view(week["id"])["can_manage"])
        self.assertFalse(self.view(week["id"], self.worker)["can_confirm"])

    def test_portal_cannot_select_snapshots_history_or_internal_notes(self):
        week = self.week()
        self.save(self.first_day(week))
        day = self.first_day(self.view(week["id"]))
        self.review(day, "blocked", "Synthetic internal review note")
        own = self.view(week["id"], self.worker)
        self.assertEqual(own["settings_snapshot"], {})
        self.assertEqual(self.first_day(own)["history"], [])
        self.assertIsNone(self.first_day(own)["review"]["note"])
        self.assertNotIn("Synthetic internal review note", json.dumps(own))
        for table, column in (("hours_weeks", "settings_snapshot"),
                              ("hours_week_members", "placement_snapshot"),
                              ("hours_day_reviews", "note"),
                              ("hours_day_revisions", "created_by")):
            self.assertEqual(sql(f"SELECT {column} FROM public.{table};", role="authenticated", user=self.worker), "")

    def test_history_immutable_even_for_database_owner(self):
        week = self.week()
        self.save(self.first_day(week))
        day = self.first_day(self.view(week["id"]))
        self.confirm(day)
        self.review(day)
        for table in ("hours_weeks", "hours_week_members", "hours_day_revisions", "hours_day_confirmations", "hours_day_reviews"):
            for mutation in (f"DELETE FROM public.{table} WHERE organization_id={literal(self.org)};",
                             f"UPDATE public.{table} SET organization_id=organization_id WHERE organization_id={literal(self.org)};"):
                self.assertIn("42501", sql(mutation, expect_error=True))

    def batch_fixture(self):
        week = self.week()
        for day in week["members"][0]["days"][:3]:
            self.save(day)
        week = self.view(week["id"])
        pairs = [{"day_id": d["id"], "revision_id": d["current_revision"]["id"]}
                 for d in week["members"][0]["days"][:3]]
        return week, pairs

    def test_batch_confirm_explicit_selection_only_and_retry_idempotent(self):
        week, pairs = self.batch_fixture()
        for _ in range(2):
            rpc("hours_confirm_days", user=self.worker, p_week_id=week["id"], p_revisions=pairs[:2], p_note=None)
        days = self.view(week["id"])["members"][0]["days"]
        self.assertEqual(sum(d["confirmation"] is not None for d in days), 2)
        self.assertIsNone(days[2]["confirmation"])
        self.assertEqual(sql(f"SELECT count(*) FROM public.hours_day_confirmations WHERE organization_id={literal(self.org)};"), "2")

    def test_batch_stale_revision_rolls_back_every_confirmation(self):
        week, pairs = self.batch_fixture()
        # Force the stale day to be last in the lock order so at least one
        # successful insert must be rolled back when that revision is reached.
        stale_pair = max(pairs, key=lambda p: p["day_id"])
        stale_day = next(d for d in week["members"][0]["days"] if d["id"] == stale_pair["day_id"])
        self.save(stale_day, minutes=420)
        self.reject("hours_confirm_days", code="40001", user=self.worker,
                    p_week_id=week["id"], p_revisions=pairs, p_note=None)
        self.assertEqual(sql(f"SELECT count(*) FROM public.hours_day_confirmations WHERE organization_id={literal(self.org)};"), "0")

    def test_batch_invalid_selections_rejected(self):
        week, pairs = self.batch_fixture()
        for selected in (None, [], {}, ["bad"], [{"day_id": "bad", "revision_id": pairs[0]["revision_id"]}],
                         [pairs[0], pairs[0]], [{"day_id": pairs[0]["day_id"]}],
                         [{"day_id": pairs[0]["day_id"], "revision_id": None}]):
            with self.subTest(selected=selected):
                self.reject("hours_confirm_days", code="22023", user=self.worker,
                            p_week_id=week["id"], p_revisions=selected, p_note=None)

    def test_batch_foreign_candidate_aborts_without_partial_writes(self):
        self.add_placement(candidate=self.other_candidate)
        week = self.week()
        for member in week["members"]:
            self.save(member["days"][0])
        week = self.view(week["id"])
        pairs = [{"day_id": m["days"][0]["id"], "revision_id": m["days"][0]["current_revision"]["id"]}
                 for m in week["members"]]
        self.reject("hours_confirm_days", user=self.worker, p_week_id=week["id"], p_revisions=pairs, p_note=None)
        self.assertEqual(sql(f"SELECT count(*) FROM public.hours_day_confirmations WHERE organization_id={literal(self.org)};"), "0")

    def test_batch_other_week_or_internal_actor_rejected(self):
        week, pairs = self.batch_fixture()
        self.add_placement(start="2026-09-14", end="2026-09-20")
        second = self.week(week_start="2026-09-14", enable=False)
        self.reject("hours_confirm_days", user=self.worker, p_week_id=second["id"], p_revisions=pairs, p_note=None)
        self.reject("hours_confirm_days", user=self.admin, p_week_id=week["id"], p_revisions=pairs, p_note=None)

    def test_batch_confirmation_concurrent_with_correction_cannot_confirm_new_revision(self):
        week, pairs = self.batch_fixture()
        first = self.first_day(week)
        barrier = threading.Barrier(2)
        def confirm():
            barrier.wait(timeout=10)
            try:
                rpc("hours_confirm_days", user=self.worker, p_week_id=week["id"], p_revisions=pairs, p_note=None)
                return "confirmed"
            except SQLFailure as error:
                self.assertIn("40001", str(error))
                return "stale"
        def correct():
            barrier.wait(timeout=10)
            self.save(first, minutes=420)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            confirmation = pool.submit(confirm)
            correction = pool.submit(correct)
            outcome = confirmation.result()
            correction.result()
        current = self.first_day(self.view(week["id"]))
        self.assertEqual(current["current_revision"]["minutes"], 420)
        self.assertIsNone(current["confirmation"])
        count = int(sql(f"SELECT count(*) FROM public.hours_day_confirmations WHERE organization_id={literal(self.org)};"))
        self.assertEqual(count, 3 if outcome == "confirmed" else 0)

    def test_concurrent_week_creation_single_immutable_snapshot(self):
        self.settings()
        barrier = threading.Barrier(5)
        def create(_):
            barrier.wait(timeout=10)
            return rpc("hours_create_week", user=self.admin, p_company_id=self.company, p_week_start="2026-09-07")
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
            weeks = list(pool.map(create, range(5)))
        self.assertEqual(len({week["id"] for week in weeks}), 1)
        self.assertEqual(sql(f"SELECT count(*) FROM public.hours_week_members WHERE organization_id={literal(self.org)};"), "1")
        self.assertEqual(sql(f"SELECT count(*) FROM public.hours_days WHERE organization_id={literal(self.org)};"), "7")

    def test_deadlines_use_amsterdam_timezone_in_summer_and_winter(self):
        self.add_placement(start="2026-01-01", end="2026-12-31")
        for start, expected in (("2026-01-05", "2026-01-12T09:00:00+00:00"),
                                ("2026-09-07", "2026-09-14T08:00:00+00:00")):
            week = self.week(week_start=start)
            self.assertEqual(week["submission_deadline_at"], expected)

    def test_deadline_dst_gap_and_fold_rejected_without_partial_week(self):
        self.add_placement(start="2026-01-01", end="2026-12-31")
        self.settings(p_submission_day_offset=6, p_submission_time="02:30",
                      p_confirmation_day_offset=7, p_confirmation_time="12:00")
        for start in ("2026-03-23", "2026-10-19"):
            self.reject("hours_create_week", code="22023", user=self.admin,
                        p_company_id=self.company, p_week_start=start)
        self.assertEqual(sql(f"SELECT count(*) FROM public.hours_weeks WHERE organization_id={literal(self.org)};"), "0")

    def test_rpc_and_private_helper_permissions_no_service_shortcut(self):
        funcs = json.loads(sql("""SELECT json_agg(p.oid::regprocedure::text) FROM pg_proc p
          JOIN pg_namespace n ON n.oid=p.pronamespace WHERE
          (n.nspname='public' AND p.proname LIKE 'hours_%') OR
          (n.nspname='private' AND p.proname LIKE 'hours_%');"""))
        self.assertGreaterEqual(len(funcs), 12)
        for signature in funcs:
            for role in ("anon", "service_role"):
                self.assertEqual(sql(f"SELECT has_function_privilege({literal(role)}, {literal(signature)}, 'EXECUTE');"), "f")
            if signature.startswith("private."):
                self.assertEqual(sql(f"SELECT has_function_privilege('authenticated', {literal(signature)}, 'EXECUTE');"), "f")

    def test_identical_save_confirm_review_retries_do_not_append_duplicates(self):
        week = self.week()
        self.save(self.first_day(week))
        day = self.first_day(self.view(week["id"]))
        self.save(day)
        for _ in range(2):
            self.confirm(day)
            self.review(day)
        for table in ("hours_day_revisions", "hours_day_confirmations", "hours_day_reviews"):
            self.assertEqual(sql(f"SELECT count(*) FROM public.{table} WHERE organization_id={literal(self.org)};"), "1")

    def test_placement_snapshot_not_reread_between_validation_and_week_insert(self):
        # A local synthetic trigger deterministically changes source data after
        # validation but before the week row insert. This exercises the same
        # interleaving as a concurrent placement correction and phantom insert,
        # without timing assumptions. The immutable week must use one snapshot.
        phantom = str(uuid.uuid4())
        sql(f"""CREATE FUNCTION public.qa_change_hours_placements() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN
            IF NEW.company_id={literal(self.company)}::uuid THEN
              UPDATE public.placements SET end_date='2026-09-06' WHERE id={literal(self.placement)};
              INSERT INTO public.placements(id,organization_id,candidate_id,company_id,start_date,end_date)
              VALUES ({literal(phantom)},{literal(self.org)},{literal(self.candidate)},
                {literal(self.company)},'2026-09-10','2026-09-13');
            END IF;
            RETURN NEW;
          END $$;
          CREATE TRIGGER qa_change_hours_placements BEFORE INSERT ON public.hours_weeks
            FOR EACH ROW EXECUTE FUNCTION public.qa_change_hours_placements();""")
        try:
            week = self.week()
            self.assertEqual([m["placement_id"] for m in week["members"]], [self.placement])
            self.assertEqual(len(week["members"][0]["days"]), 7)
            self.assertEqual(sql(f"SELECT end_date FROM public.placements WHERE id={literal(self.placement)};"), "2026-09-06")
        finally:
            sql("DROP TRIGGER qa_change_hours_placements ON public.hours_weeks; DROP FUNCTION public.qa_change_hours_placements();")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cleanup", action="store_true")
    parser.add_argument("--reuse", action="store_true", help="Reapply migration to owned synthetic DB")
    args = parser.parse_args()
    if args.cleanup:
        owned_container()
        subprocess.run(["docker", "rm", "-f", "-v", CONTAINER], check=True)
        return 0
    ensure_container()
    paths = migrations()
    applied_hashes = {path: hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}
    if args.reuse:
        for path in paths:
            sql(path.read_text())
            sql(path.read_text())
    else:
        initialize(paths)
    version = sql("SELECT version();")
    print(f"Database: {version}", flush=True)
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(HoursWorkflowTests)
    ids = [test.id() for test in suite]
    started = time.monotonic()
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    unchanged = all(hashlib.sha256(path.read_bytes()).hexdigest() == applied_hashes[path] for path in paths)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    report = {
        "success": result.wasSuccessful() and unchanged, "database": version, "image": IMAGE,
        "container": CONTAINER, "network": "none", "host_ports": [],
        "tests_run": result.testsRun, "tests": ids,
        "failures": [{"test": test.id(), "traceback": trace} for test, trace in result.failures],
        "errors": [{"test": test.id(), "traceback": trace} for test, trace in result.errors],
        "elapsed_seconds": round(time.monotonic() - started, 3),
        "migrations": [{"path": str(path.relative_to(ROOT)),
                        "sha256": applied_hashes[path]} for path in paths],
        "migration_unchanged_during_run": unchanged,
        "migration_applications": 2,
        "output_directory": str(OUTPUT.resolve()),
        "fixture_sha256": hashlib.sha256((ROOT / "tests/db/hours-workflow-fixture.sql").read_bytes()).hexdigest(),
        "production_writes": 0, "real_provider_calls": 0, "communications_sent": 0,
        "auth_fixture": "Synthetic profiles/tables, Supabase auth.uid()/roles, exact public authorization helper definitions from production metadata 2026-09-08",
        "run_command": "PYTHONDONTWRITEBYTECODE=1 python3 scripts/hours-workflow-db-test.py" + (" --reuse" if args.reuse else ""),
        "cleanup_command": "python3 scripts/hours-workflow-db-test.py --cleanup",
    }
    report_path = OUTPUT / "hours-workflow-db-qa-result.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n")
    print(f"Result JSON: {report_path}", flush=True)
    print(f"Container retained for inspection: {CONTAINER}", flush=True)
    if not unchanged:
        print("Migration changed during this run; rerun against the final exact file", file=sys.stderr)
    return 0 if result.wasSuccessful() and unchanged else 1


if __name__ == "__main__":
    sys.exit(main())
