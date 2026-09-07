#!/usr/bin/env python3
"""Independent ledger regression suite against real Supabase PostgreSQL + pg_cron.

Only the fixed, explicitly labelled, no-network disposable container below is used.
There is no connection-string option and no production/provider credentials.
Run: python3 scripts/ai-accounting-db-test.py
Use --cleanup after inspecting a completed run; it removes only this container.

The application fixture deliberately substitutes JWT/profile helpers. PostgreSQL
transactions, row locks, RLS, role grants, and pg_cron are the actual database code.
"""

import argparse
import concurrent.futures
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import threading
import time
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[1]
CONTAINER = "ja-works-ai-monthly-budget-test-20260907"
LABEL = "ja-werkt-ai-ledger-qa"
LABEL_VALUE = "20260907"
IMAGE = "public.ecr.aws/supabase/postgres:17.6.1.127"
spec = importlib.util.spec_from_file_location(
    "ledger_fixture", ROOT / "supabase/tests/ai_accounting_test.py"
)
db = importlib.util.module_from_spec(spec)
spec.loader.exec_module(db)
db.CONTAINER = CONTAINER
rpc = db.rpc
literal = db.literal


def sql(statement, role=None, user=None, expect_error=False):
    prefix = ""
    if role:
        if role not in {"anon", "authenticated", "service_role"}:
            raise ValueError("Unexpected database role")
        claims = {"role": role}
        if user:
            claims["sub"] = user
        prefix = f"SET request.jwt.claims={literal(json.dumps(claims))}; SET ROLE {role};\n"
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
        raise AssertionError(f"SQL failed: {statement}\n{result.stderr}")
    return result.stdout.strip()


db.sql = sql


def owned_container():
    result = subprocess.run(
        ["docker", "inspect", CONTAINER], capture_output=True, text=True, check=True
    )
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
    existing = subprocess.run(
        ["docker", "inspect", CONTAINER], capture_output=True, text=True
    )
    if existing.returncode:
        subprocess.run([
            "docker", "run", "-d", "--name", CONTAINER,
            "--label", f"{LABEL}={LABEL_VALUE}", "--network", "none",
            "--tmpfs", "/var/lib/postgresql/data:rw",
            "-e", "POSTGRES_PASSWORD=isolated-qa-only", "-e", "POSTGRES_DB=postgres",
            IMAGE, "-c", "shared_preload_libraries=pg_cron",
            "-c", "cron.database_name=postgres",
        ], check=True, stdout=subprocess.DEVNULL)
    owned_container()
    for _ in range(60):
        ready = subprocess.run(
            ["docker", "exec", CONTAINER, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        if ready.returncode == 0:
            return
        time.sleep(0.25)
    raise RuntimeError("Disposable PostgreSQL did not start")


def initialize(migrations):
    # Only initialize pristine owned containers. Never reset an existing test DB.
    if sql("SELECT to_regclass('public.organization_credits') IS NOT NULL;") == "t":
        raise RuntimeError("QA data already exists; inspect results then use --cleanup")
    fixture = (ROOT / "supabase/tests/ai_accounting_fixture.sql").read_text()
    # Supabase ships roles and an unused auth schema. Replace that schema only in
    # our isolated labelled container; the plain PostgreSQL fixture owns the rest.
    fixture = "\n".join(line for line in fixture.splitlines()
                        if not line.startswith("CREATE ROLE "))
    sql("DROP SCHEMA auth CASCADE;\n" + fixture)
    sql("CREATE EXTENSION IF NOT EXISTS pg_cron;")
    sql((ROOT / "supabase/migrations/20260430120000_ai_credits_and_usage.sql").read_text())
    sql((ROOT / "supabase/migrations/20260601140000_ai_usage_log_gemini_provider.sql").read_text())
    sql(f"""
      INSERT INTO public.organizations(id, name, slug)
      VALUES ({literal(db.BASELINE_ORG)}, 'Synthetic historical account', 'test-historical');
      UPDATE public.organization_credits SET balance_cents=1721,
        lifetime_topped_up_cents=5000 WHERE organization_id={literal(db.BASELINE_ORG)};
      INSERT INTO public.ai_usage_log(organization_id, feature, provider, cost_cents)
      VALUES ({literal(db.BASELINE_ORG)}, 'legacy-test', 'gemini', 3257);
      GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
    """)
    db.apply_accounting_migrations(migrations)


class DatabaseEdgeCases(db.AIAccountingTests):
    """Independent cases supplement the primary transaction suite."""

    def prepare_monthly_before_synthetic_clock(self, first_month):
        # The public setter resets immediately using the real clock. Directly
        # prepare synthetic settings here so past timezone boundaries can be
        # tested without changing PostgreSQL/the host clock or production SQL.
        sql(f"""UPDATE public.organization_credits SET credit_mode='monthly',
          monthly_allowance_cents=5000, budget_limit_cents=5000,
          monthly_start_month={literal(first_month)}, budget_month=NULL
          WHERE organization_id={literal(self.org)};""")

    def test_actual_pg_cron_installed(self):
        self.assertEqual(sql("SELECT count(*) FROM pg_extension WHERE extname='pg_cron';"), "1")
        job = json.loads(sql("""SELECT row_to_json(j) FROM (
          SELECT count(*) AS count, min(schedule) AS schedule, min(command) AS command,
            bool_and(active) AS active FROM cron.job WHERE jobname='ai-monthly-credit-grants'
        ) j;"""))
        self.assertEqual(job, {"count": 1, "schedule": "5 * * * *",
                              "command": "SELECT public.grant_monthly_ai_credits();", "active": True})
        # Execute exactly the command the real pg_cron job will invoke, as its DB
        # login role, without service JWT claims. This verifies its cron auth path.
        result = json.loads(sql(job["command"]))
        self.assertIn("grants_created", result)

    def test_real_cron_background_job_grants_once_without_jwt(self):
        month = sql("SELECT date_trunc('month', now() AT TIME ZONE 'Europe/Amsterdam')::date;")
        self.prepare_monthly_before_synthetic_clock(month)
        jobname = "qa-monthly-" + self.org
        command = f"SELECT public.grant_monthly_ai_credits(now(), {literal(self.org)});"
        job_id = sql(f"SELECT cron.schedule({literal(jobname)}, '1 second', {literal(command)});")
        try:
            deadline = time.monotonic() + 12
            while time.monotonic() < deadline:
                completed = int(sql("SELECT count(*) FROM cron.job_run_details "
                                    f"WHERE jobid={int(job_id)} AND status='succeeded';"))
                if completed >= 2:
                    break
                time.sleep(0.25)
            else:
                details = sql("SELECT coalesce(json_agg(row_to_json(r)), '[]') "
                              f"FROM cron.job_run_details r WHERE jobid={int(job_id)};")
                self.fail(f"Expected two successful real cron executions, received {details}")
            self.assertEqual(self.account()["balance_cents"], 5000)
            self.assertEqual(sql("SELECT count(*) FROM public.ai_credit_ledger WHERE "
                                 f"organization_id={literal(self.org)} AND kind='monthly_reset';"), "1")
        finally:
            sql(f"SELECT cron.unschedule({int(job_id)});")

    def test_monthly_service_only_and_future_grant_rejected(self):
        for role in ("anon", "authenticated"):
            with self.subTest(role=role):
                self.assertIn("permission denied", sql("SELECT public.grant_monthly_ai_credits();",
                                                        role=role, user=self.user, expect_error=True))
        self.assertIn("future", sql("SELECT public.grant_monthly_ai_credits(now() + interval '1 month');",
                                    role="service_role", expect_error=True))

    def test_summary_authorization_rejects_missing_jwt_and_null_org(self):
        self.assertIn("No access", sql(f"SELECT public.get_ai_credit_summary({literal(self.org)});",
                                      role="authenticated", expect_error=True))
        self.assertIn("No access", sql("SELECT public.get_ai_credit_summary(NULL);",
                                      role="authenticated", user=self.user, expect_error=True))
        self.assertIn("permission denied", sql(f"SELECT public.get_ai_credit_summary({literal(self.org)});",
                                              role="anon", expect_error=True))

    def test_non_finite_provider_cost_rejected_without_settlement(self):
        request = self.reserve(amount=100)["request_id"]
        before = self.account()
        sql(f"SELECT public.finalize_ai_usage({literal(request)}, 'succeeded', "
            "100, 50, 20, 'NaN'::numeric, 60);", role="service_role", expect_error=True)
        self.assertEqual(self.account(), before)

    def test_table_rls_hides_foreign_org_portal_and_inactive_user(self):
        self.reserve()
        for table in ("ai_credit_ledger", "ai_requests"):
            with self.subTest(table=table):
                self.assertEqual(sql(f"SELECT count(*) FROM public.{table} WHERE organization_id={literal(self.org)};",
                                     role="authenticated", user=self.user), "1")
                self.assertEqual(sql(f"SELECT count(*) FROM public.{table} WHERE organization_id={literal(db.BASELINE_ORG)};",
                                     role="authenticated", user=self.user), "0")
                sql(f"UPDATE public.profiles SET role='medewerker' WHERE id={literal(self.user)};")
                self.assertEqual(sql(f"SELECT count(*) FROM public.{table};",
                                     role="authenticated", user=self.user), "0")
                sql(f"UPDATE public.profiles SET role='admin', is_active=false WHERE id={literal(self.user)};")
                self.assertEqual(sql(f"SELECT count(*) FROM public.{table};",
                                     role="authenticated", user=self.user), "0")
                sql(f"UPDATE public.profiles SET is_active=true WHERE id={literal(self.user)};")

    def test_monthly_december_january_amsterdam_boundary_without_rollover(self):
        self.prepare_monthly_before_synthetic_clock("2025-11-01")
        december = rpc("grant_monthly_ai_credits", p_org_id=self.org,
                       p_as_of="2025-12-31T22:59:59Z")
        self.assertEqual(december["grants_created"], 1)
        self.assertEqual(december["through_month"], "2025-12-01")
        self.assertEqual(self.account()["balance_cents"], 5000)
        january = rpc("grant_monthly_ai_credits", p_org_id=self.org,
                      p_as_of="2025-12-31T23:00:00Z")
        self.assertEqual(january["grants_created"], 1)
        self.assertEqual(january["through_month"], "2026-01-01")
        again = rpc("grant_monthly_ai_credits", p_org_id=self.org,
                    p_as_of="2026-01-31T22:59:59Z")
        self.assertEqual(again["grants_created"], 0)
        self.assertEqual(self.account()["balance_cents"], 5000)

    def test_monthly_summer_time_boundary_concurrent_retry(self):
        self.prepare_monthly_before_synthetic_clock("2026-03-01")
        first = rpc("grant_monthly_ai_credits", p_org_id=self.org,
                    p_as_of="2026-03-31T21:59:59Z")
        self.assertEqual(first["grants_created"], 1)
        statements = [f"SELECT public.grant_monthly_ai_credits('2026-03-31T22:00:00Z',"
                      f"{literal(self.org)});" for _ in range(8)]
        results = [json.loads(value) for value in db.parallel(statements)]
        self.assertEqual(sum(result["grants_created"] for result in results), 1)
        self.assertEqual(self.account()["balance_cents"], 5000)
        self.assertEqual(sql("SELECT count(*) FROM public.ai_credit_ledger WHERE "
                             f"organization_id={literal(self.org)} AND kind='monthly_reset';"), "2")

    def test_reservation_transaction_rollback_has_no_orphan_or_balance_change(self):
        request = str(uuid.uuid4())
        before = self.account()
        sql(f"""BEGIN;
          SELECT public.reserve_ai_usage({literal(request)}, {literal(self.org)},
            {literal(self.user)}, 'rollback-test', 'gemini', 'synthetic-model', 4999);
          ROLLBACK;""", role="service_role")
        self.assertEqual(self.account(), before)
        self.assertEqual(sql(f"SELECT count(*) FROM public.ai_requests WHERE id={literal(request)};"), "0")

    def test_failed_audit_insert_rolls_back_entire_finalization(self):
        request = self.reserve(amount=100)["request_id"]
        before = self.account()
        sql(f"""CREATE FUNCTION public.qa_fail_usage_insert() RETURNS trigger
          LANGUAGE plpgsql AS $$ BEGIN
            IF NEW.request_id = {literal(request)}::uuid THEN
              RAISE EXCEPTION 'Synthetic failure after balance change';
            END IF;
            RETURN NEW;
          END $$;
          CREATE TRIGGER qa_fail_usage_insert BEFORE INSERT ON public.ai_usage_log
            FOR EACH ROW EXECUTE FUNCTION public.qa_fail_usage_insert();""")
        try:
            with self.assertRaisesRegex(AssertionError, "Synthetic failure after balance change"):
                self.finish(request, charge=60)
            self.assertEqual(self.account(), before)
            self.assertEqual(sql(f"SELECT status FROM public.ai_requests WHERE id={literal(request)};"), "reserved")
            self.assertEqual(sql(f"SELECT count(*) FROM public.ai_credit_ledger WHERE request_id={literal(request)};"), "0")
        finally:
            sql("DROP TRIGGER qa_fail_usage_insert ON public.ai_usage_log; DROP FUNCTION public.qa_fail_usage_insert();")
        self.finish(request, charge=60)
        self.assertEqual(self.account()["balance_cents"], 4940)
        self.assertEqual(self.account()["reserved_cents"], 0)

    def test_negative_correction_racing_reservation_cannot_take_reserved_money(self):
        sql(f"INSERT INTO public.superadmins(user_id) VALUES ({literal(self.user)});")
        request = str(uuid.uuid4())
        topup = str(uuid.uuid4())
        barrier = threading.Barrier(2)

        def reserve():
            barrier.wait(timeout=10)
            return self.reserve(amount=4000, request_id=request)

        def correction():
            barrier.wait(timeout=10)
            try:
                return rpc("topup_ai_credits_once", role="authenticated", user=self.user,
                           p_org_id=self.org, p_amount_cents=-2000, p_note="Synthetic correction",
                           p_request_id=topup)
            except AssertionError as error:
                self.assertIn("reserved credits", str(error))
                return "blocked"

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            reserve_future = pool.submit(reserve)
            correction_future = pool.submit(correction)
            reservation, adjustment = reserve_future.result(), correction_future.result()
        account = self.account()
        self.assertGreaterEqual(account["balance_cents"] - account["reserved_cents"], 0)
        if reservation["ok"]:
            self.assertEqual(adjustment, "blocked")
            self.assertEqual((account["balance_cents"], account["reserved_cents"]), (5000, 4000))
        else:
            self.assertEqual(adjustment, 3000)
            self.assertEqual((account["balance_cents"], account["reserved_cents"]), (3000, 0))
        summary = rpc("get_ai_credit_summary", p_org_id=self.org)
        self.assertEqual(summary["ledger_difference_cents"], 0)
        self.assertEqual(summary["reservation_difference_cents"], 0)

    def test_journal_immutable_and_service_cannot_directly_modify_balance(self):
        self.assertIn("immutable", sql(f"DELETE FROM public.ai_credit_ledger WHERE organization_id={literal(self.org)};", expect_error=True))
        self.assertIn("immutable", sql(f"UPDATE public.ai_credit_ledger SET amount_cents=0 WHERE organization_id={literal(self.org)};", expect_error=True))
        self.assertIn("permission denied", sql(f"UPDATE public.organization_credits SET balance_cents=99999 WHERE organization_id={literal(self.org)};",
                                              role="service_role", expect_error=True))
        self.assertEqual(self.account()["balance_cents"], 5000)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cleanup", action="store_true")
    parser.add_argument("--reuse", action="store_true",
                        help="Run tests on an already initialized owned QA container")
    args = parser.parse_args()
    if args.cleanup:
        owned_container()
        subprocess.run(["docker", "rm", "-f", "-v", CONTAINER], check=True)
        return 0
    ensure_container()
    migrations = db.accounting_migrations()
    if not args.reuse:
        initialize(migrations)
    else:
        # A reused fixture may predate a corrected function body. Apply only the
        # latest forward migration before any test; never replay an old release.
        sql(migrations[-1].read_text())
    version = sql('SELECT version();')
    print(f"Database: {version}", flush=True)
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(DatabaseEdgeCases)
    test_ids = [test.id() for test in suite]
    started = time.monotonic()
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    report = {
        "success": result.wasSuccessful(), "database": version, "image": IMAGE,
        "container": CONTAINER, "network": "none", "host_ports": [],
        "tests_run": result.testsRun, "tests": test_ids,
        "failures": [{"test": test.id(), "traceback": trace} for test, trace in result.failures],
        "errors": [{"test": test.id(), "traceback": trace} for test, trace in result.errors],
        "elapsed_seconds": round(time.monotonic() - started, 3),
        "migration": str(migrations[-1].relative_to(ROOT)),
        "migration_sha256": hashlib.sha256(migrations[-1].read_bytes()).hexdigest(),
        "migrations": [{"path": str(migration.relative_to(ROOT)),
                        "sha256": hashlib.sha256(migration.read_bytes()).hexdigest()}
                       for migration in migrations],
        "pg_cron_version": sql("SELECT extversion FROM pg_extension WHERE extname='pg_cron';"),
        "real_provider_calls": 0, "production_connections": 0,
        "auth_fixture": "Synthetic auth.users/profiles and JWT-claim helpers; real PostgreSQL roles, RLS and locks",
        "run_command": "PYTHONDONTWRITEBYTECODE=1 python3 scripts/ai-accounting-db-test.py" + (" --reuse" if args.reuse else ""),
        "cleanup_command": "python3 scripts/ai-accounting-db-test.py --cleanup",
    }
    report_path = Path("/tmp/ai-monthly-budget-db-qa-result.json")
    report_path.write_text(json.dumps(report, indent=2) + "\n")
    print(f"Result JSON: {report_path}", flush=True)
    print(f"Container retained for inspection: {CONTAINER}", flush=True)
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    sys.exit(main())
