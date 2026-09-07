#!/usr/bin/env python3
"""Real PostgreSQL transaction/RLS tests; only a disposable no-network Docker DB.

Run: python3 supabase/tests/ai_accounting_test.py
Requires Docker and its cached postgres:17-alpine image; no Python packages,
Supabase credentials, live data, host ports, or provider requests are used.
"""

import concurrent.futures
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[2]
CONTAINER = f"jawerkt-ai-accounting-test-{os.getpid()}"
BASELINE_ORG = "00000000-0000-4000-8000-000000000001"


def literal(value):
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, dict):
        return "'" + json.dumps(value).replace("'", "''") + "'::jsonb"
    return "'" + str(value).replace("'", "''") + "'"


def sql(statement, role=None, user=None, expect_error=False):
    prefix = ""
    if role:
        if role not in {"anon", "authenticated", "service_role"}:
            raise ValueError("Unexpected database role")
        claims = {"role": role}
        if user:
            claims["sub"] = user
        prefix = f"SET request.jwt.claims = {literal(json.dumps(claims))}; SET ROLE {role};\n"
    result = subprocess.run(
        ["docker", "exec", "-i", CONTAINER, "psql", "-X", "-q", "-A", "-t",
         "-v", "ON_ERROR_STOP=1", "-U", "postgres"],
        input=prefix + statement, text=True, capture_output=True, timeout=30,
    )
    if expect_error:
        if result.returncode == 0:
            raise AssertionError(f"Expected SQL rejection: {statement}\n{result.stdout}")
        return result.stderr
    if result.returncode:
        raise AssertionError(f"SQL failed: {statement}\n{result.stderr}")
    return result.stdout.strip()


def rpc(name, role="service_role", user=None, **params):
    args = ", ".join(f"{key} => {literal(value)}" for key, value in params.items())
    return json.loads(sql(f"SELECT public.{name}({args});", role=role, user=user))


def parallel(statements, role="service_role", user=None):
    barrier = threading.Barrier(len(statements))

    def run(statement):
        barrier.wait(timeout=10)
        return sql(statement, role=role, user=user)

    with concurrent.futures.ThreadPoolExecutor(max_workers=len(statements)) as pool:
        return list(pool.map(run, statements))


def setup_database(migration):
    subprocess.run(
        ["docker", "run", "--detach", "--name", CONTAINER, "--network", "none",
         "--env", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17-alpine"],
        check=True, stdout=subprocess.DEVNULL,
    )
    for _ in range(60):
        ready = subprocess.run(
            # The image starts a temporary socket-only bootstrap server first.
            # TCP readiness waits for the final server, avoiding its restart race.
            ["docker", "exec", CONTAINER, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        if ready.returncode == 0:
            break
        time.sleep(0.25)
    else:
        raise RuntimeError("Disposable PostgreSQL did not start")
    sql((ROOT / "supabase/tests/ai_accounting_fixture.sql").read_text())
    sql((ROOT / "supabase/migrations/20260430120000_ai_credits_and_usage.sql").read_text())
    sql((ROOT / "supabase/migrations/20260601140000_ai_usage_log_gemini_provider.sql").read_text())
    sql(f"""
      INSERT INTO public.organizations(id, name, slug)
      VALUES ({literal(BASELINE_ORG)}, 'Synthetic historical account', 'test-historical');
      UPDATE public.organization_credits SET balance_cents = 1721,
        lifetime_topped_up_cents = 5000 WHERE organization_id = {literal(BASELINE_ORG)};
      INSERT INTO public.ai_usage_log(organization_id, feature, provider, cost_cents)
      VALUES ({literal(BASELINE_ORG)}, 'legacy-test', 'gemini', 3257);
      GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
    """)
    sql(migration.read_text())


class AIAccountingTests(unittest.TestCase):
    """Assertions use persisted balances as well as RPC results."""

    def setUp(self):
        self.org = str(uuid.uuid4())
        self.user = str(uuid.uuid4())
        sql(f"""
          INSERT INTO public.organizations(id, name, slug)
          VALUES ({literal(self.org)}, 'Synthetic test organization', {literal(self.org)});
          INSERT INTO auth.users(id) VALUES ({literal(self.user)});
          INSERT INTO public.profiles(id, organization_id, role)
          VALUES ({literal(self.user)}, {literal(self.org)}, 'admin');
        """)

    def reserve(self, amount=100, request_id=None, **overrides):
        params = dict(p_request_id=request_id or str(uuid.uuid4()), p_org_id=self.org,
                      p_user_id=self.user, p_feature="regression-test", p_provider="gemini",
                      p_model="synthetic-model", p_reserved_cents=amount)
        params.update(overrides)
        return rpc("reserve_ai_usage", **params)

    def finish(self, request_id, status="succeeded", charge=60, **overrides):
        params = dict(p_request_id=request_id, p_status=status, p_input_tokens=100,
                      p_output_tokens=50, p_thinking_tokens=20,
                      p_provider_cost_usd=0.0123, p_charged_cents=charge,
                      p_provider_request_id="synthetic-provider-request", p_duration_ms=20)
        params.update(overrides)
        return rpc("finalize_ai_usage", **params)

    def account(self, org=None):
        return json.loads(sql(f"SELECT row_to_json(c) FROM public.organization_credits c "
                              f"WHERE organization_id={literal(org or self.org)};"))

    def test_reserve_then_finalize_debits_actual_once(self):
        before = self.account()
        reserved = self.reserve()
        self.assertTrue(reserved["ok"])
        self.assertEqual(self.account()["balance_cents"], before["balance_cents"])
        self.assertEqual(self.account()["reserved_cents"], 100)
        self.finish(reserved["request_id"])
        self.assertEqual(self.account()["balance_cents"], before["balance_cents"] - 60)
        self.assertEqual(self.account()["reserved_cents"], 0)
        self.finish(reserved["request_id"])
        self.assertEqual(self.account()["balance_cents"], before["balance_cents"] - 60)
        self.assertEqual(int(sql(f"SELECT count(*) FROM public.ai_usage_log WHERE "
                                 f"organization_id={literal(self.org)};")), 1)

    def test_competing_reservations_cannot_overspend(self):
        before = self.account()["balance_cents"]
        amount = before // 2 + 1
        statements = [f"SELECT public.reserve_ai_usage('{uuid.uuid4()}', '{self.org}', "
                      f"'{self.user}', 'race', 'gemini', 'synthetic-model', {amount});"
                      for _ in range(8)]
        replies = [json.loads(value) for value in parallel(statements)]
        self.assertEqual(sum(reply["ok"] is True for reply in replies), 1)
        self.assertEqual(self.account()["balance_cents"], before)
        self.assertEqual(self.account()["reserved_cents"], amount)

    def test_same_request_concurrency_reserves_only_once(self):
        request_id = str(uuid.uuid4())
        statement = (f"SELECT public.reserve_ai_usage('{request_id}', '{self.org}', "
                     f"'{self.user}', 'race', 'gemini', 'synthetic-model', 100);")
        replies = [json.loads(value) for value in parallel([statement] * 8)]
        self.assertEqual(sum(reply["ok"] is True for reply in replies), 1)
        self.assertTrue(all(reply["status"] == "reserved" for reply in replies))
        self.assertEqual(self.account()["reserved_cents"], 100)
        self.assertEqual(sum(not reply.get("already_exists", False) for reply in replies), 1)

    def test_concurrent_identical_finalization_debits_once(self):
        before = self.account()["balance_cents"]
        reserved = self.reserve()
        statement = (f"SELECT public.finalize_ai_usage('{reserved['request_id']}', "
                     "'succeeded', 100, 50, 20, 0.0123, 60);")
        parallel([statement] * 8)
        self.assertEqual(self.account()["balance_cents"], before - 60)
        self.assertEqual(self.account()["reserved_cents"], 0)
        self.assertEqual(int(sql(f"SELECT count(*) FROM public.ai_usage_log WHERE "
                                 f"organization_id={literal(self.org)};")), 1)

    def test_conflicting_terminal_result_is_rejected(self):
        reserved = self.reserve()
        self.finish(reserved["request_id"])
        before = self.account()
        sql(f"SELECT public.finalize_ai_usage('{reserved['request_id']}', 'succeeded', "
            "100, 50, 20, 0.0123, 70, 'synthetic-provider-request', NULL, 20);",
            role="service_role", expect_error=True)
        self.assertEqual(self.account(), before)

    def test_unknown_keeps_hold_until_resolved(self):
        before = self.account()["balance_cents"]
        reserved = self.reserve()
        self.finish(reserved["request_id"], status="unknown", charge=None,
                    p_provider_cost_usd=None, p_input_tokens=None,
                    p_output_tokens=None, p_thinking_tokens=None,
                    p_error_code="provider_timeout")
        self.assertEqual(self.account()["balance_cents"], before)
        self.assertEqual(self.account()["reserved_cents"], 100)
        self.finish(reserved["request_id"])
        self.assertEqual(self.account()["balance_cents"], before - 60)
        self.assertEqual(self.account()["reserved_cents"], 0)

    def test_charge_is_capped_at_authorized_reservation(self):
        before = self.account()["balance_cents"]
        reserved = self.reserve(amount=100)
        self.finish(reserved["request_id"], charge=140)
        self.assertEqual(self.account()["balance_cents"], before - 100)
        self.assertEqual(self.account()["reserved_cents"], 0)
        self.assertEqual(int(sql(f"SELECT cost_cents FROM public.ai_usage_log "
                                 f"WHERE organization_id={literal(self.org)};")), 100)
        request = json.loads(sql(f"SELECT row_to_json(r) FROM public.ai_requests r "
                                 f"WHERE id='{reserved['request_id']}';"))
        self.assertEqual(request["requested_charged_cents"], 140)
        self.assertEqual(request["reservation_overrun_cents"], 40)
        self.assertEqual(request["provider_cost_usd"], 0.0123)

    def test_legacy_consume_cannot_take_reserved_funds(self):
        before = self.account()["balance_cents"]
        self.reserve(amount=before - 100)
        denied = json.loads(sql(f"SELECT row_to_json(r) FROM public.consume_ai_credits("
                                f"'{self.org}', 101) r;", role="service_role"))
        self.assertFalse(denied["ok"])
        self.assertEqual(self.account()["balance_cents"], before)
        allowed = json.loads(sql(f"SELECT row_to_json(r) FROM public.consume_ai_credits("
                                 f"'{self.org}', 100) r;", role="service_role"))
        self.assertTrue(allowed["ok"])
        self.assertEqual(self.account()["balance_cents"], before - 100)
        self.assertEqual(self.account()["reserved_cents"], before - 100)

    def test_anon_and_internal_cannot_call_service_write_rpcs(self):
        for role in ("anon", "authenticated"):
            with self.subTest(role=role):
                sql(f"SELECT public.reserve_ai_usage('{uuid.uuid4()}', '{self.org}', "
                    f"'{self.user}', 'security', 'gemini', 'synthetic-model', 100);",
                    role=role, user=self.user, expect_error=True)
                sql(f"SELECT public.finalize_ai_usage('{uuid.uuid4()}', 'failed');",
                    role=role, user=self.user, expect_error=True)
        self.assertEqual(self.account()["reserved_cents"], 0)

    def test_cross_org_and_portal_summary_access_is_denied(self):
        own = rpc("get_ai_credit_summary", role="authenticated", user=self.user,
                  p_org_id=self.org)
        self.assertIsNotNone(own)
        sql(f"SELECT public.get_ai_credit_summary('{BASELINE_ORG}');",
            role="authenticated", user=self.user, expect_error=True)
        sql(f"UPDATE public.profiles SET role='medewerker' WHERE id='{self.user}';")
        sql(f"SELECT public.get_ai_credit_summary('{self.org}');",
            role="authenticated", user=self.user, expect_error=True)

    def test_historical_22_cent_gap_is_preserved_without_balance_rewrite(self):
        self.assertEqual(self.account(BASELINE_ORG)["balance_cents"], 1721)
        self.assertEqual(self.account(BASELINE_ORG)["lifetime_topped_up_cents"], 5000)
        self.assertEqual(int(sql(f"SELECT sum(cost_cents) FROM public.ai_usage_log "
                                 f"WHERE organization_id='{BASELINE_ORG}';")), 3257)
        summary = rpc("get_ai_credit_summary", p_org_id=BASELINE_ORG)
        self.assertEqual(summary["historical_unexplained_cents"], 22)
        self.assertEqual(summary["ledger_difference_cents"], 0)
        self.assertEqual(summary["reservation_difference_cents"], 0)

    def test_blocked_attempt_is_visible_but_never_debited(self):
        before = self.account()["balance_cents"]
        request_id = str(uuid.uuid4())
        denied = self.reserve(amount=before + 1, request_id=request_id)
        self.assertFalse(denied["ok"])
        self.assertEqual(denied["status"], "blocked")
        self.assertEqual(self.account()["balance_cents"], before)
        self.assertEqual(self.account()["reserved_cents"], 0)
        stored = json.loads(sql(f"SELECT row_to_json(r) FROM public.ai_requests r "
                                 f"WHERE id='{request_id}';"))
        self.assertEqual(stored["error_code"], "insufficient_credits")
        self.assertEqual(stored["charged_cents"], 0)
        repeated = self.reserve(amount=before + 1, request_id=request_id)
        self.assertFalse(repeated["ok"])
        self.assertTrue(repeated["already_exists"])

    def test_zero_cost_failure_releases_hold_and_records_outcome(self):
        before = self.account()["balance_cents"]
        reserved = self.reserve()
        self.finish(reserved["request_id"], status="failed", charge=0,
                    p_input_tokens=0, p_output_tokens=0, p_thinking_tokens=0,
                    p_provider_cost_usd=0, p_error_code="provider_rejected")
        self.assertEqual(self.account()["balance_cents"], before)
        self.assertEqual(self.account()["reserved_cents"], 0)
        outcome = json.loads(sql(f"SELECT row_to_json(u) FROM public.ai_usage_log u "
                                  f"WHERE request_id='{reserved['request_id']}';"))
        self.assertEqual(outcome["status"], "failed")
        self.assertEqual(outcome["cost_cents"], 0)
        self.assertEqual(int(sql(f"SELECT count(*) FROM public.ai_credit_ledger "
                                 f"WHERE request_id='{reserved['request_id']}';")), 1)

    def test_reservation_request_id_cannot_be_repurposed(self):
        reserved = self.reserve()
        for model, amount in [("another-model", 100), ("synthetic-model", 101)]:
            with self.subTest(model=model, amount=amount):
                sql(f"SELECT public.reserve_ai_usage('{reserved['request_id']}', "
                    f"'{self.org}', '{self.user}', 'regression-test', 'gemini', "
                    f"'{model}', {amount});", role="service_role", expect_error=True)
        self.assertEqual(self.account()["reserved_cents"], 100)

    def test_accounting_tables_cannot_bypass_rpc_as_service_role(self):
        for role in ("service_role", "authenticated"):
            with self.subTest(role=role):
                sql(f"UPDATE public.organization_credits SET balance_cents=999999 "
                    f"WHERE organization_id='{self.org}';", role=role,
                    user=self.user, expect_error=True)
                sql(f"INSERT INTO public.ai_credit_ledger(organization_id, kind, amount_cents, "
                    f"balance_after_cents, idempotency_key) VALUES('{self.org}', 'manual_topup', "
                    "9999, 9999, 'bypass');", role=role, user=self.user, expect_error=True)
        self.assertEqual(self.account()["balance_cents"], 5000)

    def test_summary_reconciles_hold_charge_and_provider_cost(self):
        a = self.reserve(amount=100)
        self.reserve(amount=200)
        self.finish(a["request_id"], charge=60)
        summary = rpc("get_ai_credit_summary", p_org_id=self.org)
        self.assertEqual(summary["balance_cents"], 4940)
        self.assertEqual(summary["reserved_cents"], 200)
        self.assertEqual(summary["available_cents"], 4740)
        self.assertEqual(summary["month_charged_cents"], 60)
        self.assertEqual(summary["month_provider_cost_usd"], 0.0123)
        self.assertEqual(summary["unresolved_requests"], 1)
        self.assertEqual(summary["ledger_difference_cents"], 0)
        self.assertEqual(summary["reservation_difference_cents"], 0)

    def test_migration_reapply_does_not_duplicate_historical_opening(self):
        before = self.account()
        before_count = int(sql("SELECT count(*) FROM public.ai_credit_ledger WHERE kind='opening';"))
        migration = next((ROOT / "supabase/migrations").glob("*ai_accounting*.sql"))
        sql(migration.read_text())
        self.assertEqual(self.account(), before)
        self.assertEqual(int(sql("SELECT count(*) FROM public.ai_credit_ledger WHERE kind='opening';")), before_count)

    def test_failed_registration_can_delete_new_org_but_preserves_opening_audit(self):
        newborn_org = str(uuid.uuid4())
        sql(f"INSERT INTO public.organizations(id, name, slug) VALUES('{newborn_org}', "
            f"'Synthetic failed registration', '{newborn_org}');")
        before = json.loads(sql(f"SELECT row_to_json(l) FROM public.ai_credit_ledger l "
                                f"WHERE organization_id='{newborn_org}';"))
        self.assertEqual(before["kind"], "opening")
        sql(f"DELETE FROM public.organizations WHERE id='{newborn_org}';", role="service_role")
        self.assertEqual(int(sql(f"SELECT count(*) FROM public.organizations "
                                 f"WHERE id='{newborn_org}';")), 0)
        self.assertEqual(int(sql(f"SELECT count(*) FROM public.organization_credits "
                                 f"WHERE organization_id='{newborn_org}';")), 0)
        after = json.loads(sql(f"SELECT row_to_json(l) FROM public.ai_credit_ledger l "
                               f"WHERE organization_id='{newborn_org}';"))
        self.assertEqual(after, before)
        self.assertEqual(int(sql(f"SELECT count(*) FROM public.ai_credit_ledger "
                                 f"WHERE organization_id='{newborn_org}';",
                                 role="authenticated", user=self.user)), 0)
        sql(f"INSERT INTO public.superadmins(user_id) VALUES('{self.user}');")
        self.assertEqual(int(sql(f"SELECT count(*) FROM public.ai_credit_ledger "
                                 f"WHERE organization_id='{newborn_org}';",
                                 role="authenticated", user=self.user)), 1)

    def test_inactive_superadmin_cannot_read_or_mutate_accounting(self):
        sql(f"INSERT INTO public.superadmins(user_id) VALUES('{self.user}'); "
            f"UPDATE public.profiles SET is_active=false WHERE id='{self.user}';")
        statements = [
            f"SELECT public.get_ai_credit_summary('{self.org}');",
            f"SELECT public.set_monthly_ai_allowance('{self.org}', 5000, '2026-09-01');",
            f"SELECT public.topup_ai_credits_once('{self.org}', 100, 'Synthetic denied topup', '{uuid.uuid4()}');",
        ]
        for statement in statements:
            with self.subTest(statement=statement):
                sql(statement, role="authenticated", user=self.user, expect_error=True)
        self.assertEqual(int(sql(f"SELECT count(*) FROM public.ai_credit_ledger "
                                 f"WHERE organization_id='{self.org}';",
                                 role="authenticated", user=self.user)), 0)
        self.assertEqual(self.account()["balance_cents"], 5000)
        self.assertEqual(self.account()["monthly_allowance_cents"], 0)

    def test_superadmin_without_org_profile_can_manage_accounting(self):
        sql(f"INSERT INTO public.superadmins(user_id) VALUES('{self.user}'); "
            f"DELETE FROM public.profiles WHERE id='{self.user}';")
        summary = rpc("get_ai_credit_summary", role="authenticated", user=self.user,
                      p_org_id=self.org)
        self.assertEqual(summary["balance_cents"], 5000)
        allowance = rpc("set_monthly_ai_allowance", role="authenticated", user=self.user,
                        p_org_id=self.org, p_amount_cents=5000, p_start_month="2026-09-01")
        self.assertEqual(allowance["monthly_allowance_cents"], 5000)
        balance = rpc("topup_ai_credits_once", role="authenticated", user=self.user,
                      p_org_id=self.org, p_amount_cents=100, p_note="Synthetic superadmin topup",
                      p_request_id=str(uuid.uuid4()))
        self.assertEqual(balance, 5100)
        self.assertEqual(self.account()["balance_cents"], 5100)
        self.assertEqual(int(sql(f"SELECT count(*) FROM public.ai_credit_ledger "
                                 f"WHERE organization_id='{self.org}';",
                                 role="authenticated", user=self.user)), 2)

    def test_manual_topup_retries_once_and_rejects_conflicting_details(self):
        sql(f"INSERT INTO public.superadmins(user_id) VALUES('{self.user}');")
        request_id = str(uuid.uuid4())
        params = dict(p_org_id=self.org, p_amount_cents=100, p_note="Synthetic retry test",
                      p_request_id=request_id)
        for _ in range(2):
            self.assertEqual(rpc("topup_ai_credits_once", role="authenticated",
                                 user=self.user, **params), 5100)
        for amount, note in [(101, "Synthetic retry test"), (100, "Changed note")]:
            with self.subTest(amount=amount, note=note):
                sql(f"SELECT public.topup_ai_credits_once('{self.org}', {amount}, "
                    f"{literal(note)}, '{request_id}');", role="authenticated",
                    user=self.user, expect_error=True)
        self.assertEqual(self.account()["balance_cents"], 5100)
        self.assertEqual(int(sql(f"SELECT count(*) FROM public.credit_topups "
                                 f"WHERE organization_id='{self.org}';")), 1)
        self.assertEqual(int(sql(f"SELECT count(*) FROM public.ai_credit_ledger "
                                 f"WHERE organization_id='{self.org}' AND kind='manual_topup';")), 1)

    def test_concurrent_manual_topup_retry_books_exactly_once(self):
        sql(f"INSERT INTO public.superadmins(user_id) VALUES('{self.user}');")
        request_id = str(uuid.uuid4())
        statement = (f"SELECT public.topup_ai_credits_once('{self.org}', 100, "
                     f"'Synthetic concurrent retry', '{request_id}');")
        balances = [int(value) for value in parallel([statement] * 8,
                                                    role="authenticated", user=self.user)]
        self.assertEqual(balances, [5100] * 8)
        self.assertEqual(self.account()["balance_cents"], 5100)
        self.assertEqual(self.account()["lifetime_topped_up_cents"], 5100)
        self.assertEqual(int(sql(f"SELECT count(*) FROM public.credit_topups "
                                 f"WHERE organization_id='{self.org}';")), 1)
        self.assertEqual(int(sql(f"SELECT count(*) FROM public.ai_credit_ledger "
                                 f"WHERE organization_id='{self.org}' AND kind='manual_topup';")), 1)


if __name__ == "__main__":
    migrations = sorted((ROOT / "supabase/migrations").glob("*ai_accounting*.sql"))
    if len(migrations) != 1:
        raise SystemExit("Expected exactly one *ai_accounting*.sql migration")
    try:
        setup_database(migrations[0])
        print(f"Database: {sql('SELECT version();')}", flush=True)
        result = unittest.TextTestRunner(verbosity=2).run(
            unittest.defaultTestLoader.loadTestsFromTestCase(AIAccountingTests)
        )
    finally:
        subprocess.run(["docker", "rm", "-f", "-v", CONTAINER],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    sys.exit(0 if result.wasSuccessful() else 1)
