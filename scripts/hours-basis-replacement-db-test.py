#!/usr/bin/env python3
"""Real PostgreSQL tests for the explicit replacement of a pinned matrix basis.

Runs the released hours migrations plus the new replacement migration in a
disposable container, then the full mail-intake/word-mail/scan/client-week/
workbook/pages/intake/module-gate/classification/foundation regressions on top,
so the widened basis contract is proven to leave the released behaviour intact.
No production writes, providers, network or host mounts.
Run: python3 scripts/hours-basis-replacement-db-test.py
Cleanup: python3 scripts/hours-basis-replacement-db-test.py --cleanup
HOURS_BASIS_QA_OUTPUT selects a durable output directory.
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
import threading
import time
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = Path(os.environ.get("HOURS_BASIS_QA_OUTPUT", ROOT / "test-results/hours-basis-replacement-db"))
# Import through the released mail-intake harness so every earlier case runs
# against this schema unchanged; only the expectations that genuinely moved are
# overridden below, and each override says why.
spec = importlib.util.spec_from_file_location("hours_mail_intake_qa", ROOT / "scripts/hours-mail-intake-db-test.py")
mailintake = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mailintake)
wordmail = mailintake.wordmail
scan = mailintake.scan
client = mailintake.client
workbook = mailintake.workbook
pages = mailintake.pages
intake = mailintake.intake
gate = mailintake.gate
classification = mailintake.classification
qa = mailintake.qa
qa.CONTAINER = "ja-works-hours-basis-replacement-test-20260917"
qa.LABEL = "ja-werkt-hours-basis-replacement-qa"
qa.LABEL_VALUE = "20260917"
sql, rpc, literal = qa.sql, qa.rpc, qa.literal
rpc_statement = qa.rpc_statement

# The port list grows by the replacement ledger and the release register that
# the block reads. Inheriting the released list unchanged would leave both out
# of every tenant-isolation and module-gate sweep.
BASIS_TABLES = mailintake.MAIL_TABLES + (
    "hours_day_matrix_basis_replacements", "hours_day_releases")
EXPECTED_SIGNATURES = mailintake.EXPECTED_SIGNATURES + (
    "hours_replace_day_matrix_basis(uuid,uuid,integer,uuid,text)",
    "hours_get_day_matrix_options(uuid)",
)
# Every hours table that could plausibly record a payroll release. The guard
# reads exactly one of them; a second one appearing here means T12 built its
# release somewhere the block cannot see it.
RELEASE_LIKE = ("%release%", "%vrijgave%", "%export%", "%batch%", "%payroll%")
REASON_MARKER = "SYNTHETISCHE-VERVANGREDEN-"
# None is a value the RPC must refuse, so it cannot double as "pick one for me".
GENERATE = object()


class BasisReplacementTests(mailintake.MailIntakeTests):
    """Replacing a pinned basis, on top of the released intake contract."""

    # --- helpers -----------------------------------------------------------

    latest = classification.ClassificationTests.latest
    prepared = classification.ClassificationTests.prepared
    save_source = classification.ClassificationTests.save_source
    context = classification.ClassificationTests.context
    final_args = classification.ClassificationTests.final_args
    finalize = classification.ClassificationTests.finalize
    create_matrix = classification.ClassificationTests.create_matrix
    bind = classification.ClassificationTests.bind
    first_day = qa.HoursWorkflowTests.first_day
    confirm = qa.HoursWorkflowTests.confirm
    review = qa.HoursWorkflowTests.review

    def version_of(self, matrix):
        return matrix["versions"][0]["id"]

    def pinned(self, factor="1", scope="client", source=None, minutes=480):
        """One classified day whose basis is pinned, plus that first matrix."""
        day = self.prepared(source=source, minutes=minutes)
        matrix = self.create_matrix(scope=scope, factor=factor)
        if scope == "cao":
            self.bind(matrix["id"])
        result = self.finalize(self.context(day))
        self.assertEqual(result["status"], "classified")
        return self.latest(day) | {"week_id": day["week_id"]}, matrix, result

    def basis(self, day):
        return self.latest(day)["matrix_basis"]

    def options(self, day, user=None):
        return rpc("hours_get_day_matrix_options", user=user or self.admin, p_day_id=day["id"])

    def reason(self, suffix=""):
        return f"{REASON_MARKER}{uuid.uuid4().hex[:8]}{suffix}"

    def replace(self, day, version_id, reason=GENERATE, expected_version=GENERATE,
                revision_id=None, user=None, role="authenticated", code=None):
        current = self.latest(day)
        params = dict(
            p_day_id=day["id"],
            p_expected_revision_id=revision_id or current["current_revision"]["id"],
            p_expected_basis_version=(current["matrix_basis"] or {}).get("basis_version", 0)
            if expected_version is GENERATE else expected_version,
            p_matrix_version_id=version_id,
            p_reason=self.reason() if reason is GENERATE else reason)
        if code is not None:
            return self.reject("hours_replace_day_matrix_basis", code=code, user=user or self.admin,
                               role=role, **params)
        return rpc("hours_replace_day_matrix_basis", user=user or self.admin, role=role, **params)

    def release(self, day, revision_id=None):
        """What T12 will write. The owner insert models its future definer RPC."""
        current = self.latest(day)
        sql(f"""INSERT INTO public.hours_day_releases(day_id,organization_id,revision_id,released_by)
          VALUES ({literal(day['id'])},{literal(self.org)},
            {literal(revision_id or current['current_revision']['id'])},{literal(self.admin)});""")

    def outside_rows(self):
        """Every table outside the hours module, so a stray write anywhere shows."""
        tables = json.loads(sql("""SELECT coalesce(jsonb_agg(tablename ORDER BY tablename),'[]'::jsonb)
          FROM pg_tables WHERE schemaname='public' AND tablename NOT LIKE 'hours!_%' ESCAPE '!';"""))
        return {table: sql(f"SELECT count(*) FROM public.{table};") for table in tables}

    def rows(self, table, day):
        """Whole rows, so an invisible edit to one column cannot pass as equal."""
        return json.loads(sql(f"SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.*::text),'[]'::jsonb) "
                              f"FROM public.{table} t WHERE t.day_id={literal(day['id'])};"))

    # --- contract ----------------------------------------------------------

    def test_permission_contract_covers_the_new_functions(self):
        """The released check, widened with this ticket's two RPCs."""
        functions = json.loads(sql("""SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,
          'name',p.proname,'schema',n.nspname)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname IN ('public','private') AND p.proname LIKE 'hours_%';"""))
        names = {f["signature"] for f in functions}
        for expected in EXPECTED_SIGNATURES:
            self.assertIn(expected, names)
        service_names = (classification.SERVICE_FUNCTIONS | client.CLIENT_SERVICE_FUNCTIONS
                         | {"hours_claim_source_reading", "hours_finish_source_reading"}
                         | mailintake.MAIL_SERVICE_FUNCTIONS)
        for function in functions:
            signature = function["signature"]
            self.assertEqual(sql(f"SELECT has_function_privilege('anon',{literal(signature)},'EXECUTE');"), "f",
                             f"{signature} must never be reachable without a session")
            service_only = function["schema"] == "public" and function["name"] in service_names
            self.assertEqual(sql(f"SELECT has_function_privilege('service_role',{literal(signature)},'EXECUTE');"),
                             "t" if service_only else "f", signature)
            if service_only or function["schema"] == "private":
                allowed = signature in intake.AUTHENTICATED_PRIVATE_HELPERS
                self.assertEqual(sql(f"SELECT has_function_privilege('authenticated',{literal(signature)},'EXECUTE');"),
                                 "t" if allowed else "f",
                                 f"{signature} must not be callable by a logged-in user")

    def test_rpc_and_private_helper_permissions_no_service_shortcut(self):
        """Re-pointed at this ticket's list."""
        BasisReplacementTests.test_permission_contract_covers_the_new_functions(self)

    # --- a replacement needs a basis, a reason and the authority -----------

    def test_without_a_pinned_basis_there_is_nothing_to_replace(self):
        day = self.prepared()
        matrix = self.create_matrix()
        self.assertIsNone(self.basis(day))
        self.replace(day, self.version_of(matrix), code="22023")
        self.assertEqual(self.rows("hours_day_matrix_basis_replacements", day), [])
        # Classifying once pins the basis, and only then is there one to replace.
        self.assertEqual(self.finalize(self.context(day))["status"], "classified")
        self.assertEqual(self.basis(day)["basis_version"], 0)

    def test_a_blocked_day_without_matrix_cannot_be_replaced(self):
        day = self.prepared()
        blocked = self.finalize(self.context(day))
        self.assertEqual(blocked["status"], "blocked")
        self.assertIsNone(blocked["matrix_version_id"])
        matrix = self.create_matrix()
        self.replace(day, self.version_of(matrix), code="22023")
        self.assertEqual(self.rows("hours_day_matrix_basis_replacements", day), [])

    def test_a_replacement_requires_an_explicit_reason(self):
        day, first, _ = self.pinned()
        second = self.create_matrix(factor="1.500", scope="cao")
        self.bind(second["id"])
        for empty in [None, "", " ", "\t", " ", "﻿", "\r\n\t "]:
            self.replace(day, self.version_of(second), reason=empty, code="22023")
        self.replace(day, self.version_of(second), reason="x" * 501, code="22023")
        self.assertEqual(self.rows("hours_day_matrix_basis_replacements", day), [])
        text = self.reason()
        self.replace(day, self.version_of(second), reason=f"\t{text} ")
        stored = self.rows("hours_day_matrix_basis_replacements", day)
        self.assertEqual([row["reason"] for row in stored], [text])

    def test_the_reason_lives_in_its_own_column_and_is_never_applied(self):
        """A reason explains a decision. It may never become an applied value,
        and it may not travel along inside a snapshot either."""
        day, first, _ = self.pinned()
        second = self.create_matrix(factor="1.500", scope="cao")
        self.bind(second["id"])
        text = self.reason()
        self.replace(day, self.version_of(second), reason=text)
        self.finalize(self.context(self.latest(day)))
        tables = json.loads(sql("""SELECT coalesce(jsonb_agg(tablename ORDER BY tablename),'[]'::jsonb)
          FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'hours!_%' ESCAPE '!';"""))
        self.assertIn("hours_day_matrix_basis_replacements", tables)
        for table in tables:
            with self.subTest(table=table):
                found = sql(f"SELECT count(*) FROM public.{table} t "
                            f"WHERE t::text LIKE {literal('%' + text + '%')};")
                self.assertEqual(found, "1" if table == "hours_day_matrix_basis_replacements" else "0",
                                 f"{table} must not repeat the replacement reason")
        stored = self.rows("hours_day_matrix_basis_replacements", day)
        self.assertEqual([row["reason"] for row in stored], [text])
        self.assertNotIn(text, json.dumps(stored[0]["selection_snapshot"]))

    def test_only_an_authorised_internal_user_may_replace(self):
        day, first, _ = self.pinned()
        second = self.create_matrix(factor="1.500", scope="cao")
        self.bind(second["id"])
        version = self.version_of(second)
        for actor in [self.worker, self.other_admin, self.other_worker]:
            self.replace(day, version, user=actor, code="42501")
        self.replace(day, version, user=None, role="anon", code="42501")
        self.replace(day, version, user=None, role="service_role", code="42501")
        sql(f"UPDATE public.profiles SET role='finance' WHERE id={literal(self.admin)};")
        sql(f"""UPDATE public.organizations SET settings='{{"role_permissions":{{"finance":{{"finance.manage":false}}}}}}'::jsonb
          WHERE id={literal(self.org)};""")
        try:
            self.replace(day, version, code="42501")
        finally:
            sql(f"UPDATE public.profiles SET role='admin' WHERE id={literal(self.admin)};")
            sql(f"UPDATE public.organizations SET settings='{{}}'::jsonb WHERE id={literal(self.org)};")
        self.assertEqual(self.rows("hours_day_matrix_basis_replacements", day), [])
        self.replace(day, version)
        self.assertEqual(self.basis(day)["matrix_version_id"], version)

    # --- the old basis and the old outcome survive -------------------------

    def test_the_old_basis_row_is_untouched_by_a_replacement(self):
        day, first, initial = self.pinned(factor="1.250")
        before = self.rows("hours_day_matrix_basis", day)
        self.assertEqual(len(before), 1)
        second = self.create_matrix(factor="2", scope="cao")
        self.bind(second["id"])
        self.replace(day, self.version_of(second))
        self.assertEqual(self.rows("hours_day_matrix_basis", day), before)
        recalculated = self.finalize(self.context(self.latest(day)))
        self.assertEqual(recalculated["allocations"][0]["factor"], "2")
        self.assertEqual(self.rows("hours_day_matrix_basis", day), before,
                         "The first pinned basis must survive both the replacement and the recalculation")

    def test_the_old_classification_is_never_rewritten(self):
        day, first, initial = self.pinned(factor="1.250")
        before = self.rows("hours_day_classifications", day)
        self.assertEqual(len(before), 1)
        second = self.create_matrix(factor="2", scope="cao")
        self.bind(second["id"])
        self.replace(day, self.version_of(second))
        self.assertEqual(self.rows("hours_day_classifications", day), before)
        recalculated = self.finalize(self.context(self.latest(day)))
        after = self.rows("hours_day_classifications", day)
        self.assertEqual(len(after), 2)
        self.assertIn(before[0], after)
        self.assertNotEqual(recalculated["id"], initial["id"])
        self.assertEqual(recalculated["revision_id"], initial["revision_id"])

    def test_both_outcomes_stay_visible_on_the_same_day_version(self):
        day, first, initial = self.pinned(factor="1.250")
        second = self.create_matrix(factor="2", scope="cao")
        self.bind(second["id"])
        self.replace(day, self.version_of(second))
        current = self.latest(day)
        self.assertEqual(current["classification"]["id"], initial["id"])
        self.assertEqual(current["previous_classifications"], [])
        recalculated = self.finalize(self.context(current))
        current = self.latest(day)
        self.assertEqual(current["classification"]["id"], recalculated["id"])
        self.assertEqual([entry["id"] for entry in current["previous_classifications"]], [initial["id"]])
        self.assertEqual(current["previous_classifications"][0]["allocations"][0]["factor"], "1.250")
        self.assertEqual(current["classification"]["allocations"][0]["factor"], "2")

    def test_the_chain_names_every_basis_it_has_had(self):
        day, first, initial = self.pinned(factor="1.250")
        second = self.create_matrix(factor="2", scope="cao")
        self.bind(second["id"])
        text = self.reason()
        self.replace(day, self.version_of(second), reason=text)
        basis = self.basis(day)
        self.assertEqual(basis["basis_version"], 1)
        self.assertEqual(basis["matrix_version_id"], self.version_of(second))
        self.assertEqual([entry["basis_version"] for entry in basis["entries"]], [0, 1])
        self.assertEqual(basis["entries"][0]["matrix_version_id"], self.version_of(first))
        self.assertIsNone(basis["entries"][0]["reason"])
        self.assertEqual(basis["entries"][1]["reason"], text)
        self.assertEqual(basis["entries"][1]["created_by"], self.admin)
        self.assertEqual(basis["entries"][0]["scope"], "client")
        self.assertEqual(basis["entries"][1]["scope"], "cao")

    def test_a_classification_records_the_basis_version_it_used(self):
        day, first, initial = self.pinned(factor="1.250")
        self.assertEqual(initial["basis_version"], 0)
        second = self.create_matrix(factor="2", scope="cao")
        self.bind(second["id"])
        self.replace(day, self.version_of(second))
        recalculated = self.finalize(self.context(self.latest(day)))
        self.assertEqual(recalculated["basis_version"], 1)

    def test_an_outcome_without_a_matrix_still_records_the_basis_that_governed_it(self):
        """basis_version says which basis built the context, not whether the
        outcome named a matrix. A no-hours day on a pinned basis was still
        calculated under that basis; only a day without any basis is null."""
        day, first, initial = self.pinned()
        self.assertEqual(initial["basis_version"], 0)
        self.save_source(self.latest(day), None, minutes=0, reason="Synthetische vrije dag")
        result = self.finalize(self.context(self.latest(day)))
        self.assertEqual(result["status"], "no_hours")
        self.assertEqual(result["basis_version"], 0)
        # Another day of the same week never had a basis: that one stays null.
        bare = self.view(day["week_id"])["members"][0]["days"][1] | {"week_id": day["week_id"]}
        self.save_source(bare, None, minutes=0, reason="Synthetische vrije dag zonder basis")
        self.assertIsNone(self.finalize(self.context(self.latest(bare)))["basis_version"])

    def test_an_outcome_from_before_basis_versions_reads_as_the_first_basis(self):
        """A classification that named a matrix always pinned basis 0 in the same
        transaction, and replacements did not exist yet: its null basis_version can
        only mean the first basis. The projection says so; only a matrix-less
        outcome without any basis stays null."""
        day, first, initial = self.pinned()
        # Model a row recorded before this migration: the owner lifts the
        # immutability trigger for exactly this synthetic edit.
        sql(f"""ALTER TABLE public.hours_day_classifications DISABLE TRIGGER hours_history_immutable;
          UPDATE public.hours_day_classifications SET basis_version=NULL WHERE id={literal(initial['id'])};
          ALTER TABLE public.hours_day_classifications ENABLE TRIGGER hours_history_immutable;""")
        self.assertEqual(sql(f"SELECT basis_version IS NULL FROM public.hours_day_classifications WHERE id={literal(initial['id'])};"), "t")
        self.assertEqual(self.latest(day)["classification"]["basis_version"], 0)
        second = self.create_matrix(factor="2", scope="cao")
        self.bind(second["id"])
        self.replace(day, self.version_of(second))
        self.finalize(self.context(self.latest(day)))
        current = self.latest(day)
        self.assertEqual([entry["basis_version"] for entry in current["previous_classifications"]], [0])
        self.assertEqual(current["classification"]["basis_version"], 1)

    def test_eligibility_does_not_depend_on_the_session_date_style(self):
        """The validity window is compared as dates. A session that renders
        dates as DD/MM/YYYY must offer and accept exactly the same versions."""
        day, first, _ = self.pinned()
        second = self.create_matrix(factor="2", scope="cao")
        self.bind(second["id"])
        current = self.latest(day)
        offered = json.loads(sql("SET DateStyle='SQL, DMY'; "
                                 + rpc_statement("hours_get_day_matrix_options", p_day_id=day["id"]),
                                 role="authenticated", user=self.admin))
        self.assertEqual({entry["matrix_version_id"] for entry in offered["options"]},
                         {self.version_of(first), self.version_of(second)})
        replaced = json.loads(sql("SET DateStyle='SQL, DMY'; " + rpc_statement(
            "hours_replace_day_matrix_basis", p_day_id=day["id"],
            p_expected_revision_id=current["current_revision"]["id"], p_expected_basis_version=0,
            p_matrix_version_id=self.version_of(second), p_reason=self.reason()),
            role="authenticated", user=self.admin))
        self.assertEqual(replaced["id"], day["week_id"])
        self.assertEqual(self.basis(day)["basis_version"], 1)

    def test_an_older_day_version_carries_its_last_outcome_only(self):
        """The current version shows its superseded outcomes next to the last one;
        an older version is a summary and does not repeat that list on every read."""
        day, first, initial = self.pinned(factor="1.250")
        second = self.create_matrix(factor="2", scope="cao")
        self.bind(second["id"])
        self.replace(day, self.version_of(second))
        self.finalize(self.context(self.latest(day)))
        self.save_source(self.latest(day), None, minutes=420)
        current = self.latest(day)
        older = next(entry for entry in current["history"] if entry["id"] == initial["revision_id"])
        self.assertNotIn("previous_classifications", older)
        self.assertEqual(older["classification"]["basis_version"], 1)
        self.assertEqual(current["previous_classifications"], [])

    # --- the replacement itself decides nothing ----------------------------

    def test_a_replacement_alone_does_not_recalculate(self):
        day, first, initial = self.pinned(factor="1.250")
        second = self.create_matrix(factor="2", scope="cao")
        self.bind(second["id"])
        self.replace(day, self.version_of(second))
        current = self.latest(day)
        self.assertEqual(current["classification"]["id"], initial["id"])
        self.assertEqual(current["classification"]["matrix_version_id"], self.version_of(first))
        self.assertEqual(len(self.rows("hours_day_classifications", day)), 1)
        self.assertIsNone(current["confirmation"])
        self.assertIsNone(current["review"])
        self.assertEqual(current["current_revision"]["id"], day["current_revision"]["id"])

    def test_a_replacement_writes_nothing_to_the_legacy_route(self):
        day, first, _ = self.pinned()
        second = self.create_matrix(factor="2", scope="cao")
        self.bind(second["id"])
        before = self.outside_rows()
        self.assertTrue(before, "The fixture must have tables outside the hours module")
        self.replace(day, self.version_of(second))
        self.finalize(self.context(self.latest(day)))
        self.assertEqual(self.outside_rows(), before)

    def test_the_replaced_basis_governs_every_later_correction(self):
        day, first, _ = self.pinned(factor="1.250")
        second = self.create_matrix(factor="2", scope="cao")
        self.bind(second["id"])
        self.replace(day, self.version_of(second))
        self.save_source(self.latest(day), None, minutes=420)
        context = self.context(self.latest(day))
        self.assertEqual(context["pinned_matrix"]["matrix_version_id"], self.version_of(second))
        result = self.finalize(context)
        self.assertEqual(result["allocations"][0]["factor"], "2")
        self.assertEqual(sum(entry["minutes"] for entry in result["allocations"]), 420)
        self.assertEqual(self.basis(day)["basis_version"], 1)

    # --- concurrency and staleness ----------------------------------------

    def test_a_replacement_needs_the_current_day_version(self):
        day, first, _ = self.pinned()
        second = self.create_matrix(factor="2", scope="cao")
        self.bind(second["id"])
        stale = day["current_revision"]["id"]
        self.save_source(self.latest(day), None, minutes=420)
        self.replace(day, self.version_of(second), revision_id=stale, code="PT409")
        self.assertEqual(self.rows("hours_day_matrix_basis_replacements", day), [])

    def test_a_replacement_needs_the_current_basis_version(self):
        day, first, _ = self.pinned()
        second = self.create_matrix(factor="2", scope="cao")
        third = self.create_matrix(factor="3", scope="cao")
        self.bind(second["id"])
        for wrong in [1, 2, -1]:
            self.replace(day, self.version_of(second), expected_version=wrong, code="PT409")
        # A missing value is invalid input, not a conflict a reload could resolve.
        self.replace(day, self.version_of(second), expected_version=None, code="22023")
        self.replace(day, self.version_of(second), expected_version=0)
        self.bind(third["id"])
        self.replace(day, self.version_of(third), expected_version=0, code="PT409")
        self.replace(day, self.version_of(third), expected_version=1)
        self.assertEqual(self.basis(day)["basis_version"], 2)

    def test_two_sessions_replacing_at_once_produce_exactly_one_replacement(self):
        day, first, _ = self.pinned()
        second = self.create_matrix(factor="2", scope="cao")
        self.bind(second["id"])
        params = dict(p_day_id=day["id"], p_expected_revision_id=day["current_revision"]["id"],
                      p_expected_basis_version=0, p_matrix_version_id=self.version_of(second),
                      p_reason=self.reason())
        barrier = threading.Barrier(2)

        def act(_):
            barrier.wait(timeout=5)
            try:
                return True, rpc("hours_replace_day_matrix_basis", user=self.admin, **params)
            except qa.SQLFailure as error:
                return False, str(error)

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(act, range(2)))
        self.assertEqual(sum(1 for ok, _ in results if ok), 1, results)
        self.assertIn("PT409", next(value for ok, value in results if not ok))
        self.assertEqual(len(self.rows("hours_day_matrix_basis_replacements", day)), 1)

    # --- which matrix a replacement may choose ------------------------------

    def test_a_replacement_cannot_choose_the_basis_it_already_has(self):
        day, first, _ = self.pinned()
        self.replace(day, self.version_of(first), code="22023")
        self.assertEqual(self.rows("hours_day_matrix_basis_replacements", day), [])

    def test_a_replacement_cannot_choose_an_unpublished_or_foreign_matrix(self):
        day, first, _ = self.pinned()
        draft_matrix = rpc("hours_create_matrix", user=self.admin, p_scope="cao", p_company_id=None,
                           p_name="Synthetic draft")
        draft = rpc("hours_create_matrix_draft", user=self.admin, p_matrix_id=draft_matrix["id"],
                    p_valid_from="2026-01-01", p_valid_until=None,
                    p_config=classification.matrix_config("2"))["versions"][0]
        self.bind(draft_matrix["id"])
        self.replace(day, draft["id"], code="22023")
        for version in [str(uuid.uuid4()), None]:
            self.replace(day, version, code="22023")
        self.assertEqual(self.rows("hours_day_matrix_basis_replacements", day), [])

    def test_a_replacement_cannot_choose_a_matrix_that_is_not_in_force(self):
        day, first, _ = self.pinned()
        later = rpc("hours_create_matrix", user=self.admin, p_scope="cao", p_company_id=None,
                    p_name="Synthetic later CAO")
        version = rpc("hours_create_matrix_draft", user=self.admin, p_matrix_id=later["id"],
                      p_valid_from="2026-12-01", p_valid_until=None,
                      p_config=classification.matrix_config("2"))["versions"][0]
        published = rpc("hours_publish_matrix_version", user=self.admin, p_version_id=version["id"],
                        p_expected_revision=version["revision"], p_confirmed=True)
        self.bind(later["id"])
        self.assertLess(day["work_date"], "2026-12-01")
        self.replace(day, published["versions"][0]["id"], code="22023")
        self.assertEqual(self.rows("hours_day_matrix_basis_replacements", day), [])

    def test_a_replacement_cannot_choose_an_unbound_cao_or_another_client(self):
        day, first, _ = self.pinned()
        unbound = self.create_matrix(scope="cao", factor="2")
        self.replace(day, self.version_of(unbound), code="22023")
        other_company = str(uuid.uuid4())
        sql(f"INSERT INTO public.companies(id,organization_id) VALUES({literal(other_company)},{literal(self.org)});")
        foreign_matrix = rpc("hours_create_matrix", user=self.admin, p_scope="client",
                             p_company_id=other_company, p_name="Synthetic other client")
        foreign = rpc("hours_create_matrix_draft", user=self.admin, p_matrix_id=foreign_matrix["id"],
                      p_valid_from="2026-01-01", p_valid_until=None,
                      p_config=classification.matrix_config("2"))["versions"][0]
        published = rpc("hours_publish_matrix_version", user=self.admin, p_version_id=foreign["id"],
                        p_expected_revision=foreign["revision"], p_confirmed=True)
        self.replace(day, published["versions"][0]["id"], code="22023")
        self.assertEqual(self.rows("hours_day_matrix_basis_replacements", day), [])

    def test_an_explicit_replacement_may_prefer_the_cao_over_the_client_matrix(self):
        """Automatic selection puts the client matrix first. Correcting that
        choice is the reason this procedure exists, so it must be reachable."""
        day, first, initial = self.pinned(factor="1.250")
        cao = self.create_matrix(scope="cao", factor="2")
        self.bind(cao["id"])
        self.replace(day, self.version_of(cao))
        result = self.finalize(self.context(self.latest(day)))
        self.assertEqual(result["status"], "classified")
        self.assertEqual(result["matrix_scope"], "cao")
        self.assertEqual(result["allocations"][0]["factor"], "2")

    def test_the_offered_options_are_exactly_what_the_server_accepts(self):
        day, first, _ = self.pinned()
        cao = self.create_matrix(scope="cao", factor="2")
        self.bind(cao["id"])
        unbound = self.create_matrix(scope="cao", factor="3")
        offered = self.options(day)
        self.assertEqual(offered["day_id"], day["id"])
        self.assertEqual(offered["work_date"], day["work_date"])
        self.assertFalse(offered["released"])
        self.assertEqual(offered["basis"]["matrix_version_id"], self.version_of(first))
        versions = {entry["matrix_version_id"]: entry for entry in offered["options"]}
        self.assertEqual(set(versions), {self.version_of(first), self.version_of(cao)})
        self.assertNotIn(self.version_of(unbound), versions)
        self.assertTrue(versions[self.version_of(first)]["is_current"])
        self.assertFalse(versions[self.version_of(cao)]["is_current"])
        self.replace(day, self.version_of(cao))
        self.assertEqual(self.basis(day)["matrix_version_id"], self.version_of(cao))

    def test_reading_the_options_requires_internal_finance_access(self):
        day, _, _ = self.pinned()
        for actor in [self.worker, self.other_admin]:
            self.reject("hours_get_day_matrix_options", user=actor, p_day_id=day["id"])
        self.reject("hours_get_day_matrix_options", role="anon", user=None, p_day_id=day["id"])
        self.reject("hours_get_day_matrix_options", role="service_role", user=None, p_day_id=day["id"])

    # --- release blocks a replacement until the correction route exists -----

    def test_a_released_day_cannot_be_replaced(self):
        day, first, _ = self.pinned()
        second = self.create_matrix(factor="2", scope="cao")
        self.bind(second["id"])
        self.release(day)
        self.replace(day, self.version_of(second), code="22023")
        self.assertEqual(self.rows("hours_day_matrix_basis_replacements", day), [])
        self.assertTrue(self.options(day)["released"])

    def test_a_release_on_an_older_version_still_blocks_the_day(self):
        """Release belongs to the day. A later correction does not unrelease it."""
        day, first, _ = self.pinned()
        second = self.create_matrix(factor="2", scope="cao")
        self.bind(second["id"])
        self.release(day, revision_id=day["current_revision"]["id"])
        self.save_source(self.latest(day), None, minutes=420)
        self.replace(day, self.version_of(second), code="22023")
        self.assertEqual(self.rows("hours_day_matrix_basis_replacements", day), [])

    def test_the_release_register_is_the_only_one_the_block_reads(self):
        """T12 must record its release where this block can see it. A second
        release-shaped table means the block was silently bypassed."""
        patterns = " OR ".join(f"tablename LIKE {literal(pattern)}" for pattern in RELEASE_LIKE)
        found = json.loads(sql(f"""SELECT coalesce(jsonb_agg(tablename ORDER BY tablename),'[]'::jsonb)
          FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'hours!_%' ESCAPE '!' AND ({patterns});"""))
        self.assertEqual(found, ["hours_day_releases"],
                         "A payroll release must be recorded in hours_day_releases, "
                         "or hours_replace_day_matrix_basis stops blocking released days")

    def test_the_release_register_has_no_client_write_route(self):
        for role in ("anon", "authenticated", "service_role"):
            for privilege in ("INSERT", "UPDATE", "DELETE", "TRUNCATE"):
                self.assertEqual(
                    sql(f"SELECT has_table_privilege({literal(role)},'public.hours_day_releases',{literal(privilege)});"),
                    "f", f"{role} must not be able to {privilege} a release")
        touching = json.loads(sql("""SELECT coalesce(jsonb_agg(DISTINCT p.proname),'[]'::jsonb)
          FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname IN ('public','private') AND p.prosrc LIKE '%hours_day_releases%';"""))
        self.assertEqual(sorted(touching), ["hours_day_released"],
                         "Only the release reader may name the register; everything else asks it")

    def test_a_release_row_cannot_be_edited_or_removed(self):
        day, _, _ = self.pinned()
        self.release(day)
        for mutation in [f"UPDATE public.hours_day_releases SET organization_id=organization_id WHERE day_id={literal(day['id'])};",
                         f"DELETE FROM public.hours_day_releases WHERE day_id={literal(day['id'])};"]:
            self.assertIn("42501", sql(mutation, expect_error=True))
        self.assertEqual(sql(f"SELECT count(*) FROM public.hours_day_releases WHERE day_id={literal(day['id'])};"), "1")

    # --- append-only, bounded, tenant scoped --------------------------------

    def test_the_replacement_ledger_is_append_only_even_for_the_owner(self):
        day, first, _ = self.pinned()
        second = self.create_matrix(factor="2", scope="cao")
        self.bind(second["id"])
        self.replace(day, self.version_of(second))
        for mutation in [f"UPDATE public.hours_day_matrix_basis_replacements SET reason='herschreven' WHERE day_id={literal(day['id'])};",
                         f"DELETE FROM public.hours_day_matrix_basis_replacements WHERE day_id={literal(day['id'])};"]:
            self.assertIn("42501", sql(mutation, expect_error=True))
            for role, user in [("authenticated", self.admin), ("service_role", None), ("anon", None)]:
                self.assertIn("42501", sql(mutation, role=role, user=user, expect_error=True))
        self.assertEqual(len(self.rows("hours_day_matrix_basis_replacements", day)), 1)

    def test_the_replacement_chain_is_bounded(self):
        day, first, _ = self.pinned()
        matrices = [self.create_matrix(factor=str(2 + index), scope="cao") for index in range(2)]
        for index in range(50):
            chosen = matrices[index % 2]
            self.bind(chosen["id"])
            self.replace(day, self.version_of(chosen), expected_version=index)
        self.assertEqual(self.basis(day)["basis_version"], 50)
        self.bind(matrices[0]["id"])
        self.replace(day, self.version_of(matrices[0]), expected_version=50, code="22023")

    def test_the_ledger_is_tenant_scoped_and_hidden_from_the_portal(self):
        day, first, _ = self.pinned()
        second = self.create_matrix(factor="2", scope="cao")
        self.bind(second["id"])
        text = self.reason()
        self.replace(day, self.version_of(second), reason=text)
        for table in ("hours_day_matrix_basis_replacements", "hours_day_releases"):
            self.assertEqual(sql(f"SELECT count(*) FROM public.{table} WHERE day_id={literal(day['id'])};",
                                 role="authenticated", user=self.worker), "0")
            self.assertEqual(sql(f"SELECT count(*) FROM public.{table} WHERE day_id={literal(day['id'])};",
                                 role="authenticated", user=self.other_admin), "0")
            self.assertIn("42501", sql(f"SELECT count(*) FROM public.{table};", role="anon", expect_error=True))
        self.assertEqual(sql(f"SELECT count(*) FROM public.hours_day_matrix_basis_replacements "
                             f"WHERE day_id={literal(day['id'])};", role="authenticated", user=self.admin), "1")
        own = rpc("hours_get_week", user=self.worker, p_week_id=day["week_id"])
        visible = own["members"][0]["days"][0]
        self.assertIsNone(visible["matrix_basis"])
        self.assertEqual(visible["previous_classifications"], [])
        self.assertNotIn(text, json.dumps(own))

    def test_a_replacement_rechecks_the_switch_after_taking_the_company_lock(self):
        """hours_lock_day reads the switch before the company row is locked. A
        settings change that commits in between must still stop the write, so the
        replacement has to look again once it holds the row — as the rekencontext
        already does."""
        day, first, _ = self.pinned()
        second = self.create_matrix(factor="2", scope="cao")
        self.bind(second["id"])
        current = self.latest(day)
        params = dict(p_day_id=day["id"], p_expected_revision_id=current["current_revision"]["id"],
                      p_expected_basis_version=0, p_matrix_version_id=self.version_of(second),
                      p_reason=self.reason())
        holding = threading.Event()

        def switch_off_while_holding_the_company():
            # The owner holds the company row the replacement must take, and
            # flips the switch inside that same transaction before letting go.
            holding.set()
            sql(f"""BEGIN;
              SELECT 1 FROM public.companies WHERE id={literal(self.company)} FOR UPDATE;
              SELECT pg_sleep(3);
              UPDATE public.hours_company_settings SET enabled=false, version=version+1
                WHERE company_id={literal(self.company)};
              COMMIT;""")

        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            holder = executor.submit(switch_off_while_holding_the_company)
            holding.wait(timeout=5)
            time.sleep(1)
            error = sql(rpc_statement("hours_replace_day_matrix_basis", **params),
                        role="authenticated", user=self.admin, expect_error=True)
            holder.result(timeout=30)
        self.assertIn("22023", error)
        self.assertEqual(self.rows("hours_day_matrix_basis_replacements", day), [])

    def test_the_workflow_switch_blocks_a_replacement(self):
        day, first, _ = self.pinned()
        second = self.create_matrix(factor="2", scope="cao")
        self.bind(second["id"])
        self.settings(p_enabled=False)
        self.replace(day, self.version_of(second), code="22023")
        self.reject("hours_get_day_matrix_options", code="22023", user=self.admin, p_day_id=day["id"])
        self.assertEqual(self.rows("hours_day_matrix_basis_replacements", day), [])


class BasisFoundationRegression(mailintake.MailFoundationRegression):
    """The released foundation regressions; only the helper allowlist grows."""

    def test_rpc_and_private_helper_permissions_no_service_shortcut(self):
        BasisReplacementTests.test_permission_contract_covers_the_new_functions(self)


class BasisModuleGateTests(mailintake.MailModuleGateTests):
    """The released SaaS-gate contract, extended to this ticket's RPCs/tables."""

    def prepare_all(self):
        day, calls = mailintake.MailModuleGateTests.prepare_all(self)
        current = self.latest(day)
        replacement = self.create_matrix(scope="client")
        version = replacement["versions"][0]["id"]
        rpc("hours_replace_day_matrix_basis", user=self.admin, p_day_id=day["id"],
            p_expected_revision_id=current["current_revision"]["id"],
            p_expected_basis_version=current["matrix_basis"]["basis_version"],
            p_matrix_version_id=version, p_reason="Synthetische gate-vervanging")
        # The register T12 will write. Present here only so the gate sweep has a
        # sample to hide; a released day is exactly what must stay unreachable.
        sql(f"""INSERT INTO public.hours_day_releases(day_id,organization_id,revision_id,released_by)
          VALUES ({literal(day['id'])},{literal(self.org)},
            {literal(current['current_revision']['id'])},{literal(self.admin)});""")
        calls["hours_get_day_matrix_options"] = dict(p_day_id=day["id"])
        calls["hours_replace_day_matrix_basis"] = dict(
            p_day_id=day["id"], p_expected_revision_id=current["current_revision"]["id"],
            p_expected_basis_version=current["matrix_basis"]["basis_version"] + 1,
            p_matrix_version_id=version, p_reason="Synthetische gate-controle")
        return day, calls

    def data_snapshot(self):
        return {table: json.loads(sql(f"SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), '[]') "
                                      f"FROM public.{table} t WHERE organization_id={literal(self.org)};"))
                for table in BASIS_TABLES}

    def test_all_twenty_two_tables_hide_disabled_data_and_deny_direct_writes(self):
        raise unittest.SkipTest("Superseded by the twenty-four-table check that also covers the basis ledger")

    def test_all_twenty_four_tables_hide_disabled_data_and_deny_direct_writes(self):
        self.prepare_all()
        before = self.data_snapshot()
        self.assertEqual(len(before), 24)
        self.assertTrue(all(before.values()), "Every gated table must have a nonempty synthetic sample")
        gate.toggle(self.org, False)
        for table in BASIS_TABLES:
            with self.subTest(table=table):
                for actor in (self.admin, self.worker, self.other_admin):
                    self.assertEqual(sql(f"SELECT count(*) FROM public.{table} WHERE organization_id={literal(self.org)};",
                                         role="authenticated", user=actor), "0")
                for role, actor in (("anon", None), ("service_role", self.admin)):
                    self.assertIn("42501", sql(f"SELECT * FROM public.{table};", role=role, user=actor,
                                               expect_error=True))
                for role, actor in (("authenticated", self.admin), ("authenticated", self.worker),
                                    ("service_role", self.admin)):
                    for statement in (f"DELETE FROM public.{table};",
                                      f"UPDATE public.{table} SET organization_id=organization_id;",
                                      f"INSERT INTO public.{table} DEFAULT VALUES;"):
                        self.assertIn("42501", sql(statement, role=role, user=actor, expect_error=True))
        self.assertEqual(before, self.data_snapshot())


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
        "20260916090000_hours_mail_intake.sql",
        "20260916100000_hours_mail_intake_review_fixes.sql",
        "20260916120000_hours_mail_intake_revive.sql",
        "20260916130000_hours_mail_message_conversation.sql",
        "20260917090000_hours_matrix_basis_replacement.sql",
    )]
    fixtures = [ROOT / "tests/db/hours-workflow-fixture.sql", ROOT / "tests/db/hours-module-gate-fixture.sql",
                ROOT / "tests/db/hours-intake-fixture.sql", ROOT / "tests/db/hours-mail-intake-fixture.sql"]
    harnesses = [ROOT / "scripts" / name for name in (
        "hours-workflow-db-test.py", "hours-classification-db-test.py",
        "hours-module-gate-db-test.py", "hours-conflict-db-test.py", "hours-intake-db-test.py",
        "hours-pages-db-test.py", "hours-workbook-db-test.py", "hours-client-week-db-test.py",
        "hours-scan-db-test.py", "hours-word-mail-db-test.py", "hours-mail-intake-db-test.py",
        "hours-basis-replacement-db-test.py")]
    hashes = {path: hashlib.sha256(path.read_bytes()).hexdigest()
              for path in paths + fixtures + harnesses}
    wordmail.conflict.adapt_business_expectations()
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
    sql(f"INSERT INTO auth.users(id) VALUES({literal(gate.SA)}); "
        f"INSERT INTO public.superadmins(user_id) VALUES({literal(gate.SA)});")
    database = sql("SELECT version();")
    classes = [BasisReplacementTests] if args.new_only else [
        BasisFoundationRegression, gate.EnabledClassificationRegression,
        BasisModuleGateTests, BasisReplacementTests]
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
        "run_command": "python3 scripts/hours-basis-replacement-db-test.py" + (" --new-only" if args.new_only else ""),
        "output_directory": str(OUTPUT.resolve()),
    }
    OUTPUT.mkdir(parents=True, exist_ok=True)
    path = OUTPUT / "hours-basis-replacement-db-qa-result.json"
    path.write_text(json.dumps(report, indent=2) + "\n")
    print("Result JSON:", path, flush=True)
    return 0 if report["success"] else 1


if __name__ == "__main__":
    sys.exit(main())
