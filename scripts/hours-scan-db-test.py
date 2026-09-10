#!/usr/bin/env python3
"""Real PostgreSQL tests for reading a scan or photo into reviewable proposals.

Runs the released hours migrations plus the new scan migration in a disposable
container, then the full client-week/workbook/pages/intake/module-gate/
classification/foundation regressions on top, so the added doubt is proven to
leave every released behaviour intact.

The boundary under test: a reading may record what it was unsure of, and while
that doubt stands the proposal cannot be applied. Only
hours_apply_source_proposal writes a day revision, and it still takes the
proposal literally.
No production writes, providers, network or host mounts.
Run: python3 scripts/hours-scan-db-test.py
Cleanup: python3 scripts/hours-scan-db-test.py --cleanup
HOURS_SCAN_QA_OUTPUT selects a durable output directory.
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
OUTPUT = Path(os.environ.get("HOURS_SCAN_QA_OUTPUT", ROOT / "test-results/hours-scan-db"))
# Import through the released client-week harness so its cases run against this
# schema unchanged; only the expectations that genuinely moved are overridden.
spec = importlib.util.spec_from_file_location("hours_client_week_qa", ROOT / "scripts/hours-client-week-db-test.py")
client = importlib.util.module_from_spec(spec)
spec.loader.exec_module(client)
workbook = client.workbook
pages = workbook.pages
intake = pages.intake
conflict = intake.conflict
gate = intake.gate
classification = gate.classification
qa = gate.qa
qa.CONTAINER = "ja-works-hours-scan-test-20260913"
qa.LABEL = "ja-werkt-hours-scan-qa"
qa.LABEL_VALUE = "20260913"
sql, rpc, literal, rpc_statement = qa.sql, qa.rpc, qa.literal, qa.rpc_statement

PDF = intake.PDF
XLSX = workbook.XLSX
JPEG = "image/jpeg"
digest = intake.digest
SCAN_TABLES = client.CLIENT_TABLES + ("hours_source_readings",)
EXPECTED_SIGNATURES = client.EXPECTED_SIGNATURES + (
    "hours_get_source_reading_context(uuid)",
    "hours_confirm_proposal_values(uuid,text)",
    "hours_claim_source_reading(uuid,uuid)",
    "hours_finish_source_reading(uuid,text,text,integer,integer,text)",
)


class ScanTests(client.ClientWeekTests):
    """Reading a scan into proposals, on top of the released client-week contract."""

    def read_into_proposals(self, source_id, entries, user=None, code=None):
        payload = json.dumps(entries)
        if code is not None:
            return self.reject("hours_create_source_proposals", code=code, user=user or self.admin,
                               p_source_id=source_id, p_entries=payload)
        return rpc("hours_create_source_proposals", user=user or self.admin,
                   p_source_id=source_id, p_entries=payload)

    def scan_source(self, name="urenbriefje.jpg", mimetype=JPEG, extension="jpg", pages_count=1):
        return self.add_source(name=name, mimetype=mimetype, extension=extension, pages=pages_count)

    def uncertain_proposal(self, fields=("total",), minutes=480, page=1):
        """One reading that recorded doubt, ready to be judged."""
        week = self.open_week()
        source, _ = self.scan_source()
        day = self.day_of(week)
        self.read_into_proposals(source["source_id"], [{
            "day_id": day["id"], "minutes": minutes, "page_number": page,
            "page_label": "regel 3", "uncertain_fields": list(fields),
        }])
        sources = rpc("hours_get_week_sources", user=self.admin, p_week_id=week["id"])
        return week, day, self.only_proposal(sources)

    def test_permission_contract_covers_the_new_functions(self):
        """The released check, with the reading-context and value-confirmation signatures added."""
        functions = json.loads(sql("""SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,
          'name',p.proname,'schema',n.nspname)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname IN ('public','private') AND p.proname LIKE 'hours_%';"""))
        names = {f["signature"] for f in functions}
        for expected in EXPECTED_SIGNATURES:
            self.assertIn(expected, names)
        self.assertNotIn("hours_add_week_source(uuid,text,text,text)", names,
                         "The superseded signature must not stay callable next to the new one")
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

    # --- what a reader may see ---------------------------------------------

    def test_reading_context_names_the_file_and_the_week_the_reader_may_recognise(self):
        week = self.open_week()
        source, content_hash = self.scan_source(name="week37.jpg")
        context = rpc("hours_get_source_reading_context", user=self.admin, p_source_id=source["source_id"])
        self.assertEqual(context["source_id"], source["source_id"])
        self.assertEqual(context["week_id"], week["id"])
        self.assertEqual(context["file_name"], "week37.jpg")
        self.assertEqual(context["content_type"], JPEG)
        self.assertEqual(context["page_count"], 1)
        self.assertEqual(context["storage_path"], f"{self.org}/{week['id']}/{content_hash}.jpg")
        self.assertEqual({member["id"] for member in context["members"]},
                         {member["id"] for member in week["members"]})
        self.assertEqual(len(context["days"]), sum(len(member["days"]) for member in week["members"]))

    def test_reading_context_offers_no_paid_route_for_a_workbook(self):
        """A spreadsheet has its own deterministic reader; a legacy .xls has none."""
        self.open_week()
        book, _ = self.add_source(name="uren.xlsx", mimetype=XLSX, extension="xlsx", pages=2)
        self.reject("hours_get_source_reading_context", code="22023", user=self.admin,
                    p_source_id=book["source_id"])

    def test_reading_context_refuses_a_source_of_another_organization(self):
        self.open_week()
        source, _ = self.scan_source()
        self.reject("hours_get_source_reading_context", code="42501", user=self.other_admin,
                    p_source_id=source["source_id"])

    def test_reading_context_needs_the_write_permission(self):
        """Reading leads to proposals, so a read-only finance role is not enough."""
        self.open_week()
        source, _ = self.scan_source()
        sql(f"UPDATE public.profiles SET role='backoffice' WHERE id={literal(self.admin)};")
        self.reject("hours_get_source_reading_context", code="42501", user=self.admin,
                    p_source_id=source["source_id"])

    def test_reading_context_is_closed_for_a_portal_user(self):
        self.open_week()
        source, _ = self.scan_source()
        self.reject("hours_get_source_reading_context", code="42501", user=self.worker,
                    p_source_id=source["source_id"])

    def test_every_stable_hours_rpc_survives_a_read_only_transaction(self):
        """PostgREST runs a STABLE function in a read-only transaction.

        A function that takes the write gate locks a row, which a read-only
        transaction refuses with 25006 — over HTTP that surfaces as a bare 405
        and the whole route is dead. The unit tests cannot see this: they call
        the function directly. So the rule is checked here, for every public
        hours function at once, rather than for the one that happened to break.
        """
        functions = json.loads(sql("""SELECT jsonb_agg(jsonb_build_object(
          'name', p.proname, 'args', pg_get_function_identity_arguments(p.oid)))
          FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname='public' AND p.proname LIKE 'hours_%' AND p.provolatile IN ('s','i');"""))
        self.assertTrue(functions, "there should be stable hours functions to check")
        week = self.open_week()
        source, _ = self.scan_source()
        known = {"p_week_id": week["id"], "p_source_id": source["source_id"],
                 "p_day_id": self.day_of(week)["id"], "p_company_id": self.company,
                 "p_proposal_id": "00000000-0000-4000-8000-000000000000",
                 "p_matrix_id": "00000000-0000-4000-8000-000000000000",
                 "p_version_id": "00000000-0000-4000-8000-000000000000",
                 "p_expected_revision_id": "00000000-0000-4000-8000-000000000000",
                 "p_week_start": "2026-09-07", "p_link_id": "00000000-0000-4000-8000-000000000000"}
        for function in functions:
            arguments = [part.strip().split(" ")[0] for part in function["args"].split(",") if part.strip()]
            call = ", ".join(f"{name} => {literal(known.get(name))}" for name in arguments)
            statement = (f"BEGIN; SET TRANSACTION READ ONLY; "
                         f"SELECT public.{function['name']}({call}); COMMIT;")
            # Succeeding and refusing are both fine here — a made-up identifier
            # is meant to be refused. Only 25006 says the transaction itself was
            # the problem, and that is the failure this guards against.
            try:
                outcome = sql(statement, role="authenticated", user=self.admin)
            except qa.SQLFailure as refusal:
                outcome = str(refusal)
            self.assertNotIn("25006", outcome,
                             f"{function['name']} cannot run in the read-only transaction PostgREST uses")

    def test_a_reading_is_claimed_before_it_is_paid_for(self):
        """One reading per source at a time, and a record of what was sent.

        Without a claim the only thing between two clicks and two charges is
        browser state, and nothing anywhere says which document went to the
        provider — which the AVG accountability duty needs and a processor
        incident cannot be scoped without.
        """
        week = self.open_week()
        source, _ = self.scan_source()
        first = rpc("hours_claim_source_reading", user=None, role="service_role",
                    p_source_id=source["source_id"], p_actor_id=self.admin)
        self.assertTrue(first["ok"])
        self.assertEqual(first["source_id"], source["source_id"])
        self.assertEqual(first["week_id"], week["id"])
        # A second claim while the first is open is refused, not charged.
        self.assertIn("22023", sql(rpc_statement("hours_claim_source_reading",
                      p_source_id=source["source_id"], p_actor_id=self.admin),
                      role="service_role", expect_error=True))
        rpc("hours_finish_source_reading", user=None, role="service_role",
            p_reading_id=first["reading_id"], p_status="succeeded",
            p_request_id=first["reading_id"], p_cost_cents=1, p_lines=3)
        again = rpc("hours_claim_source_reading", user=None, role="service_role",
                    p_source_id=source["source_id"], p_actor_id=self.admin)
        self.assertTrue(again["ok"])
        rows = sql(f"SELECT count(*) FROM public.hours_source_readings "
                   f"WHERE source_id={literal(source['source_id'])};")
        self.assertEqual(rows, "2", "every paid reading leaves a record")

    def test_a_claim_that_was_never_closed_does_not_lock_the_source_forever(self):
        """An edge instance can die between claiming and finishing.

        Without a way out the partial unique index would refuse every later
        claim and the source could never be read again — and neither the finish
        RPC (service-role) nor a delete (the guard refuses it) is reachable from
        the app.
        """
        self.open_week()
        source, _ = self.scan_source()
        stuck = rpc("hours_claim_source_reading", user=None, role="service_role",
                    p_source_id=source["source_id"], p_actor_id=self.admin)
        # Ageing the row is the one thing the immutability guard rightly refuses,
        # so the test steps around the trigger rather than around the rule.
        sql("ALTER TABLE public.hours_source_readings DISABLE TRIGGER hours_reading_guard;"
            f"UPDATE public.hours_source_readings SET started_at = now() - interval '30 minutes' "
            f"WHERE id={literal(stuck['reading_id'])};"
            "ALTER TABLE public.hours_source_readings ENABLE TRIGGER hours_reading_guard;")
        fresh = rpc("hours_claim_source_reading", user=None, role="service_role",
                    p_source_id=source["source_id"], p_actor_id=self.admin)
        self.assertTrue(fresh["ok"])
        self.assertNotEqual(fresh["reading_id"], stuck["reading_id"])
        abandoned = sql(f"SELECT status || '/' || coalesce(error_code,'') FROM public.hours_source_readings "
                        f"WHERE id={literal(stuck['reading_id'])};")
        self.assertEqual(abandoned, "failed/abandoned", "the stuck claim is closed, and says so")

    def test_a_claim_that_is_still_young_still_blocks(self):
        self.open_week()
        source, _ = self.scan_source()
        rpc("hours_claim_source_reading", user=None, role="service_role",
            p_source_id=source["source_id"], p_actor_id=self.admin)
        self.assertIn("22023", sql(rpc_statement("hours_claim_source_reading",
                      p_source_id=source["source_id"], p_actor_id=self.admin),
                      role="service_role", expect_error=True))

    def test_the_reading_log_is_service_role_only_and_internal_to_read(self):
        week = self.open_week()
        source, _ = self.scan_source()
        rpc("hours_claim_source_reading", user=None, role="service_role",
            p_source_id=source["source_id"], p_actor_id=self.admin)
        self.reject("hours_claim_source_reading", code="42501", user=self.admin,
                    p_source_id=source["source_id"], p_actor_id=self.admin)
        # An internal finance reader sees its own organization's log; a portal
        # user and another tenant see nothing.
        self.assertEqual(sql("SELECT count(*) FROM public.hours_source_readings;",
                             role="authenticated", user=self.admin), "1")
        for actor in (self.worker, self.other_admin):
            self.assertEqual(sql("SELECT count(*) FROM public.hours_source_readings;",
                                 role="authenticated", user=actor), "0")
        # anon has no grant at all, so it cannot even ask.
        self.assertIn("42501", sql("SELECT count(*) FROM public.hours_source_readings;",
                                   role="anon", expect_error=True))
        _ = week

    def test_the_database_accepts_exactly_the_labels_the_reader_can_emit(self):
        """The TypeScript lists and their SQL twins are hand-written copies.

        Nothing else bridges the two languages: a sixth label added on one side
        makes a paid reading fail all-or-nothing on the other. This reads the
        kernel's own list and checks the database against it.
        """
        kernel = (ROOT / "supabase/functions/_shared/hours-scan.ts").read_text()
        labels = json.loads("[" + kernel.split("SCAN_UNCERTAIN_FIELDS = [")[1]
                            .split("]")[0].replace("'", '"') + "]")
        self.assertEqual(len(labels), 5, labels)
        week = self.open_week()
        source, _ = self.scan_source()
        days = [day["id"] for member in week["members"] for day in member["days"]][:len(labels)]
        self.read_into_proposals(source["source_id"], [
            {"day_id": day, "minutes": 480, "page_number": 1, "uncertain_fields": [label]}
            for day, label in zip(days, labels)])
        stored = sql(f"SELECT count(*) FROM public.hours_source_proposals "
                     f"WHERE week_id={literal(week['id'])} AND uncertain_fields IS NOT NULL;")
        self.assertEqual(stored, str(len(labels)), "every label the reader can emit must be storable")
        types = json.loads("[" + kernel.split("HOURS_READABLE_SCAN_TYPES = [")[1]
                           .split("]")[0].replace("'", '"') + "]")
        body = sql("""SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname='public' AND p.proname='hours_get_source_reading_context';""")
        for media in types:
            self.assertIn(media, body, f"the database must also accept {media}")

    # --- recorded doubt -----------------------------------------------------

    def test_a_reading_may_record_the_fields_it_was_unsure_of(self):
        _, _, proposal = self.uncertain_proposal(("total", "break"))
        self.assertEqual(proposal["uncertain_fields"], ["total", "break"])
        self.assertIsNone(proposal["values_confirmed_at"])

    def test_recorded_doubt_is_stored_in_one_canonical_form(self):
        _, _, proposal = self.uncertain_proposal(("break", "total", "break"))
        self.assertEqual(proposal["uncertain_fields"], ["total", "break"])

    def test_an_unknown_uncertainty_is_refused_rather_than_dropped(self):
        week = self.open_week()
        source, _ = self.scan_source()
        for value in (["handwriting"], ["total", "handwriting"], [None], "total", 7):
            self.read_into_proposals(source["source_id"], [{
                "day_id": self.day_of(week)["id"], "minutes": 480, "page_number": 1,
                "uncertain_fields": value,
            }], code="22023")
        self.assertEqual(sql(f"SELECT count(*) FROM public.hours_source_proposals "
                             f"WHERE week_id={literal(week['id'])};"), "0")

    def test_a_reading_without_doubt_records_none(self):
        week = self.open_week()
        source, _ = self.scan_source()
        self.read_into_proposals(source["source_id"], [
            {"day_id": self.day_of(week)["id"], "minutes": 480, "page_number": 1},
        ])
        sources = rpc("hours_get_week_sources", user=self.admin, p_week_id=week["id"])
        self.assertIsNone(self.only_proposal(sources)["uncertain_fields"])
        self.assertEqual(sources["uncertain_values"], 0)

    def test_an_empty_doubt_list_is_no_doubt(self):
        week = self.open_week()
        source, _ = self.scan_source()
        self.read_into_proposals(source["source_id"], [
            {"day_id": self.day_of(week)["id"], "minutes": 480, "page_number": 1, "uncertain_fields": []},
        ])
        sources = rpc("hours_get_week_sources", user=self.admin, p_week_id=week["id"])
        self.assertIsNone(self.only_proposal(sources)["uncertain_fields"])

    def test_uncertain_values_count_the_whole_week(self):
        week, _, _ = self.uncertain_proposal()
        sources = rpc("hours_get_week_sources", user=self.admin, p_week_id=week["id"])
        self.assertEqual(sources["uncertain_values"], 1)
        self.assertEqual(sources["open_proposals"], 1)

    def test_the_uncertainty_check_does_not_depend_on_a_changeable_function(self):
        """A CHECK is re-evaluated on every UPDATE, on an append-only table.

        If the constraint calls a project function holding the closed list, then
        narrowing that list later makes existing rows violate it — and this
        table has no DELETE path, so those proposals could never be applied,
        discarded or confirmed again. The week would be stuck forever. The
        constraint therefore has to be self-contained.
        """
        depends = sql("""SELECT count(*) FROM pg_constraint c
          JOIN pg_depend d ON d.objid = c.oid AND d.classid = 'pg_constraint'::regclass
          JOIN pg_proc p ON p.oid = d.refobjid AND d.refclassid = 'pg_proc'::regclass
          WHERE c.conrelid = 'public.hours_source_proposals'::regclass;""")
        self.assertEqual(depends, "0", "no CHECK on this table may depend on a project function")

    def test_the_database_refuses_doubt_that_is_not_in_canonical_form(self):
        """The RPC canonicalises; the trigger makes that a database fact."""
        week = self.open_week()
        source, _ = self.scan_source()
        self.read_into_proposals(source["source_id"], [
            {"day_id": self.day_of(week)["id"], "minutes": 480, "page_number": 1},
        ])
        proposal = self.only_proposal(rpc("hours_get_week_sources", user=self.admin, p_week_id=week["id"]))
        for value in ("ARRAY['shift','total']", "ARRAY['total','total']", "ARRAY['handschrift']"):
            outcome = sql(f"INSERT INTO public.hours_source_proposals(organization_id,week_id,source_id,"
                          f"day_id,minutes,uncertain_fields,created_by) SELECT organization_id,week_id,"
                          f"source_id,day_id,480,{value},created_by FROM public.hours_source_proposals "
                          f"WHERE id={literal(proposal['id'])};", expect_error=True)
            self.assertRegex(outcome, "22023|23514", value)

    def test_recorded_doubt_is_bounded_like_every_other_field(self):
        week = self.open_week()
        source, _ = self.scan_source()
        # Every other field in this RPC is capped; an unbounded array would be
        # expanded and scanned inside a transaction that already holds locks.
        self.read_into_proposals(source["source_id"], [{
            "day_id": self.day_of(week)["id"], "minutes": 480, "page_number": 1,
            "uncertain_fields": ["total"] * 200,
        }], code="22023")

    def test_the_reading_context_scopes_its_members_to_the_organization(self):
        """Defence in depth: the days subquery filters on the tenant; so must the members."""
        body = sql("""SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname='public' AND p.proname='hours_get_source_reading_context';""")
        members = body[body.index("'members'"):body.index("'days'")]
        self.assertIn("organization_id", members,
                      "the members subquery must name the tenant, like the days subquery does")

    # --- what recorded doubt blocks -----------------------------------------

    def test_an_uncertain_reading_cannot_be_applied_before_it_is_confirmed(self):
        week, day, proposal = self.uncertain_proposal()
        self.reject("hours_apply_source_proposal", code="22023", user=self.admin,
                    p_proposal_id=proposal["id"], p_expected_revision_id=None)
        self.assertIsNone(self.revision_of(week["id"], day["id"]))
        self.assertEqual(sql(f"SELECT status FROM public.hours_source_proposals "
                             f"WHERE id={literal(proposal['id'])};"), "open")

    def test_confirming_the_values_opens_the_way_and_changes_nothing_else(self):
        week, day, proposal = self.uncertain_proposal()
        after = rpc("hours_confirm_proposal_values", user=self.admin,
                    p_proposal_id=proposal["id"], p_note="Origineel ernaast gelegd")
        confirmed = self.only_proposal(after)
        self.assertEqual(confirmed["status"], "open")
        self.assertEqual(confirmed["minutes"], proposal["minutes"])
        self.assertEqual(confirmed["uncertain_fields"], ["total"])
        self.assertIsNotNone(confirmed["values_confirmed_at"])
        self.assertEqual(confirmed["values_note"], "Origineel ernaast gelegd")
        self.assertEqual(after["uncertain_values"], 0)
        rpc("hours_apply_source_proposal", user=self.admin,
            p_proposal_id=proposal["id"], p_expected_revision_id=None)
        self.assertEqual(self.revision_of(week["id"], day["id"])["minutes"], 480)

    def test_the_confirmation_note_never_becomes_the_applied_note(self):
        week, day, proposal = self.uncertain_proposal()
        rpc("hours_confirm_proposal_values", user=self.admin,
            p_proposal_id=proposal["id"], p_note="Telefonisch nagevraagd")
        rpc("hours_apply_source_proposal", user=self.admin,
            p_proposal_id=proposal["id"], p_expected_revision_id=None)
        self.assertIsNone(self.revision_of(week["id"], day["id"])["note"])

    def test_values_can_be_confirmed_only_once(self):
        _, _, proposal = self.uncertain_proposal()
        rpc("hours_confirm_proposal_values", user=self.admin, p_proposal_id=proposal["id"], p_note=None)
        self.reject("hours_confirm_proposal_values", code="22023", user=self.admin,
                    p_proposal_id=proposal["id"], p_note="nogmaals")

    def test_confirming_values_on_a_certain_reading_is_refused(self):
        week = self.open_week()
        source, _ = self.scan_source()
        self.read_into_proposals(source["source_id"], [
            {"day_id": self.day_of(week)["id"], "minutes": 480, "page_number": 1},
        ])
        sources = rpc("hours_get_week_sources", user=self.admin, p_week_id=week["id"])
        self.reject("hours_confirm_proposal_values", code="22023", user=self.admin,
                    p_proposal_id=self.only_proposal(sources)["id"], p_note=None)

    def test_confirming_values_needs_the_write_permission(self):
        _, _, proposal = self.uncertain_proposal()
        self.reject("hours_confirm_proposal_values", code="42501", user=self.other_admin,
                    p_proposal_id=proposal["id"], p_note=None)
        self.reject("hours_confirm_proposal_values", code="42501", user=self.worker,
                    p_proposal_id=proposal["id"], p_note=None)
        sql(f"UPDATE public.profiles SET role='backoffice' WHERE id={literal(self.admin)};")
        self.reject("hours_confirm_proposal_values", code="42501", user=self.admin,
                    p_proposal_id=proposal["id"], p_note=None)

    def test_both_doubts_have_to_be_settled_before_applying(self):
        week = self.open_week()
        source, _ = self.scan_source()
        day = self.day_of(week)
        self.read_into_proposals(source["source_id"], [{
            "day_id": day["id"], "minutes": 480, "page_number": 1,
            "assignment_uncertain": True, "uncertain_fields": ["total"],
        }])
        sources = rpc("hours_get_week_sources", user=self.admin, p_week_id=week["id"])
        proposal = self.only_proposal(sources)
        self.assertEqual(sources["undecided_assignments"], 1)
        self.assertEqual(sources["uncertain_values"], 1)
        self.reject("hours_apply_source_proposal", code="22023", user=self.admin,
                    p_proposal_id=proposal["id"], p_expected_revision_id=None)
        rpc("hours_confirm_proposal_values", user=self.admin, p_proposal_id=proposal["id"], p_note=None)
        self.reject("hours_apply_source_proposal", code="22023", user=self.admin,
                    p_proposal_id=proposal["id"], p_expected_revision_id=None)
        rpc("hours_confirm_proposal_assignment", user=self.admin, p_proposal_id=proposal["id"], p_note=None)
        rpc("hours_apply_source_proposal", user=self.admin,
            p_proposal_id=proposal["id"], p_expected_revision_id=None)
        self.assertEqual(self.revision_of(week["id"], day["id"])["minutes"], 480)

    # --- the recorded doubt is history --------------------------------------

    def test_recorded_doubt_cannot_be_rewritten_afterwards(self):
        _, _, proposal = self.uncertain_proposal()
        for statement in (
            f"UPDATE public.hours_source_proposals SET uncertain_fields=NULL WHERE id={literal(proposal['id'])};",
            f"UPDATE public.hours_source_proposals SET uncertain_fields=ARRAY['shift'] WHERE id={literal(proposal['id'])};",
            f"UPDATE public.hours_source_proposals SET minutes=60 WHERE id={literal(proposal['id'])};",
            f"DELETE FROM public.hours_source_proposals WHERE id={literal(proposal['id'])};",
        ):
            self.assertIn("42501", sql(statement, expect_error=True))

    def test_two_doubts_may_not_be_settled_in_one_write(self):
        _, _, proposal = self.uncertain_proposal()
        sql(f"UPDATE public.hours_source_proposals SET assignment_uncertain=true "
            f"WHERE id={literal(proposal['id'])};", expect_error=True)
        self.assertIn("42501", sql(
            f"UPDATE public.hours_source_proposals SET values_confirmed_by={literal(self.admin)},"
            f"values_confirmed_at=now(),assignment_confirmed_by={literal(self.admin)},"
            f"assignment_confirmed_at=now() WHERE id={literal(proposal['id'])};", expect_error=True))

    def test_a_resolved_proposal_keeps_its_recorded_doubt(self):
        _, _, proposal = self.uncertain_proposal()
        rpc("hours_confirm_proposal_values", user=self.admin, p_proposal_id=proposal["id"], p_note=None)
        rpc("hours_discard_source_proposal", user=self.admin, p_proposal_id=proposal["id"], p_note="niet nodig")
        self.assertIn("42501", sql(
            f"UPDATE public.hours_source_proposals SET values_note='alsnog' "
            f"WHERE id={literal(proposal['id'])};", expect_error=True))
        self.assertEqual(sql(f"SELECT uncertain_fields::text FROM public.hours_source_proposals "
                             f"WHERE id={literal(proposal['id'])};"), "{total}")

    def test_the_database_refuses_a_confirmation_without_recorded_doubt(self):
        week = self.open_week()
        source, _ = self.scan_source()
        self.read_into_proposals(source["source_id"], [
            {"day_id": self.day_of(week)["id"], "minutes": 480, "page_number": 1},
        ])
        sources = rpc("hours_get_week_sources", user=self.admin, p_week_id=week["id"])
        self.assertIn("23514", sql(
            f"UPDATE public.hours_source_proposals SET values_confirmed_by={literal(self.admin)},"
            f"values_confirmed_at=now() WHERE id={literal(self.only_proposal(sources)['id'])};",
            expect_error=True))

    # --- the portal boundary is unchanged -----------------------------------

    def test_the_portal_still_sees_no_reading_at_all(self):
        week, _, _ = self.uncertain_proposal()
        self.reject("hours_get_week_sources", code="42501", user=self.worker, p_week_id=week["id"])
        self.assertEqual(sql("SELECT count(*) FROM public.hours_source_proposals;",
                             role="authenticated", user=self.worker), "0")


class ScanFoundationRegression(client.ClientWeekFoundationRegression):
    """The released foundation contract, unchanged on the scan schema."""


class ScanModuleGateTests(client.ClientWeekModuleGateTests):
    """The released SaaS module gate, unchanged on the scan schema."""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cleanup", action="store_true")
    parser.add_argument("--scan-only", action="store_true",
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
    )]
    fixtures = [ROOT / "tests/db/hours-workflow-fixture.sql", ROOT / "tests/db/hours-module-gate-fixture.sql",
                ROOT / "tests/db/hours-intake-fixture.sql"]
    harnesses = [ROOT / "scripts" / name for name in (
        "hours-workflow-db-test.py", "hours-classification-db-test.py",
        "hours-module-gate-db-test.py", "hours-conflict-db-test.py",
        "hours-intake-db-test.py", "hours-pages-db-test.py", "hours-workbook-db-test.py",
        "hours-client-week-db-test.py", "hours-scan-db-test.py")]
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
    classes = [ScanTests] if args.scan_only else [
        ScanFoundationRegression, gate.EnabledClassificationRegression,
        ScanModuleGateTests, ScanTests]
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
        "released_regressions_included": not args.scan_only,
        "elapsed_seconds": round(time.monotonic() - started, 3),
        "migrations": [{"path": str(path.relative_to(ROOT)), "sha256": hashes[path]} for path in paths],
        "migration_applications_each": 2, "inputs_unchanged_during_run": unchanged,
        "fixtures": [{"path": str(path.relative_to(ROOT)), "sha256": hashes[path]} for path in fixtures],
        "harnesses": [{"path": str(path.relative_to(ROOT)), "sha256": hashes[path]} for path in harnesses],
        "failures": [{"test": test.id(), "traceback": trace} for test, trace in result.failures],
        "errors": [{"test": test.id(), "traceback": trace} for test, trace in result.errors],
        "production_writes": 0, "real_provider_calls": 0, "communications_sent": 0,
        "verified_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "run_command": "python3 scripts/hours-scan-db-test.py" + (" --scan-only" if args.scan_only else ""),
        "output_directory": str(OUTPUT.resolve()),
    }
    OUTPUT.mkdir(parents=True, exist_ok=True)
    path = OUTPUT / "hours-scan-db-qa-result.json"
    path.write_text(json.dumps(report, indent=2) + "\n")
    print("Result JSON:", path, flush=True)
    return 0 if report["success"] else 1


if __name__ == "__main__":
    sys.exit(main())
