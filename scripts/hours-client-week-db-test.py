#!/usr/bin/env python3
"""Real PostgreSQL tests for the personal client week page without a login.

Runs the released hours migrations plus the new client-link migration in a
disposable container, then the full workbook/pages/intake/module-gate/
classification/foundation regressions on top, so the public page is proven to
leave every released behaviour intact.

The boundary under test: a hashed token scoped to exactly one client week, and
client input that lands as a proposal. Only hours_apply_source_proposal writes a
day revision, and it still needs a named internal user.
No production writes, providers, network or host mounts.
Run: python3 scripts/hours-client-week-db-test.py
Cleanup: python3 scripts/hours-client-week-db-test.py --cleanup
HOURS_CLIENT_WEEK_QA_OUTPUT selects a durable output directory.
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
OUTPUT = Path(os.environ.get("HOURS_CLIENT_WEEK_QA_OUTPUT", ROOT / "test-results/hours-client-week-db"))
# Import through the released workbook harness so its cases run against this
# schema unchanged; only the expectations that genuinely moved are overridden.
spec = importlib.util.spec_from_file_location("hours_workbook_qa", ROOT / "scripts/hours-workbook-db-test.py")
workbook = importlib.util.module_from_spec(spec)
spec.loader.exec_module(workbook)
pages = workbook.pages
intake = pages.intake
conflict = intake.conflict
gate = intake.gate
classification = gate.classification
qa = gate.qa
qa.CONTAINER = "ja-works-hours-client-week-test-20260912"
qa.LABEL = "ja-werkt-hours-client-week-qa"
qa.LABEL_VALUE = "20260912"
sql, rpc, literal = qa.sql, qa.rpc, qa.literal

PDF = intake.PDF
XLSX = workbook.XLSX
digest = intake.digest
CLIENT_TABLES = workbook.WORKBOOK_TABLES + ("hours_client_week_links", "hours_client_week_reports")
EXPECTED_SIGNATURES = workbook.EXPECTED_SIGNATURES + (
    "hours_issue_client_week_link(uuid,text,integer)",
    "hours_revoke_client_week_link(uuid,text)",
    "hours_client_week_view(text)",
    "hours_client_week_save(text,jsonb)",
    "hours_client_week_add_source(text,text,text,text,integer)",
    "hours_client_week_upload_path(text,text,text)",
    "hours_client_week_stored_paths(text)",
    "hours_client_week_report(text,text,text)",
)
# The five public functions are reached only by the trusted edge function, which
# is the single holder of the service-role key.
CLIENT_SERVICE_FUNCTIONS = {"hours_client_week_view", "hours_client_week_save",
                            "hours_client_week_add_source", "hours_client_week_upload_path",
                            "hours_client_week_stored_paths", "hours_client_week_report"}


def token_hash(secret):
    """The database stores only this; the secret itself lives in the link."""
    return hashlib.sha256(secret.encode()).hexdigest()


class ClientWeekTests(workbook.WorkbookTests):
    """The public client week page, on top of the released source contract."""

    # --- helpers -----------------------------------------------------------

    def issue(self, week_id=None, label="Planning Acme", days=14, user=None, code=None):
        params = dict(p_week_id=week_id or self.week_id, p_label=label, p_valid_days=days)
        if code is not None:
            return self.reject("hours_issue_client_week_link", code=code, user=user or self.admin, **params)
        return rpc("hours_issue_client_week_link", user=user or self.admin, **params)

    def store_client(self, content_hash, link_id, extension="pdf", mimetype=PDF, size=2048, week=None):
        """The Storage row a client upload leaves behind, in its own subtree."""
        path = f"{self.org}/{week or self.week_id}/client/{link_id}/{content_hash}.{extension}"
        sql(f"""INSERT INTO storage.objects(bucket_id,name,metadata) VALUES ('hours-sources',{literal(path)},
          jsonb_build_object('size',{size},'mimetype',{literal(mimetype)}))
          ON CONFLICT (bucket_id,name) DO UPDATE SET metadata=EXCLUDED.metadata;""")
        return path

    def client(self, name, secret, code=None, **params):
        """Every public call arrives through the service-role edge function."""
        params["p_token_hash"] = token_hash(secret)
        if code is not None:
            return self.reject(name, code=code, user=None, role="service_role", **params)
        return rpc(name, user=None, role="service_role", **params)

    def client_view(self, secret, code=None):
        return self.client("hours_client_week_view", secret, code=code)

    def deliver(self, secret, entries, code=None):
        return self.client("hours_client_week_save", secret, code=code, p_entries=json.dumps(entries))

    def client_report(self, secret, kind="later", note=None, code=None):
        return self.client("hours_client_week_report", secret, code=code, p_kind=kind, p_note=note)

    def second_client_week(self, week_start="2026-09-07"):
        """A second client inside the same tenant: the real confusion risk."""
        company = str(uuid.uuid4())
        sql(f"INSERT INTO public.companies(id,organization_id) "
            f"VALUES ({literal(company)},{literal(self.org)});")
        current = rpc("hours_get_company_settings", user=self.admin, p_company_id=company)
        rpc("hours_set_company_settings", user=self.admin, p_company_id=company,
            p_expected_version=current["version"], p_enabled=True, p_submission_day_offset=7,
            p_submission_time="10:00", p_confirmation_day_offset=8, p_confirmation_time="12:00")
        self.add_placement(company=company)
        rpc("hours_create_week", user=self.admin, p_company_id=company, p_week_start=week_start)
        identifier = sql(f"SELECT id FROM public.hours_weeks WHERE company_id={literal(company)} "
                         f"AND week_start={literal(week_start)};")
        return rpc("hours_get_week", user=self.admin, p_week_id=identifier)

    def open_link(self, label="Planning Acme", days=14):
        """A week with two employees and one personal link to it."""
        week = self.two_member_week()
        issued = self.issue(week["id"], label=label, days=days)
        return week, issued

    def links_of(self, week_id, user=None):
        return rpc("hours_get_week_sources", user=user or self.admin, p_week_id=week_id)["client_links"]

    def client_proposals(self, week_id):
        links = self.links_of(week_id)
        return [proposal for link in links for proposal in link["proposals"]]

    # --- the token ---------------------------------------------------------

    def test_permission_contract_covers_the_new_functions(self):
        """The released check, with the client-link signatures added."""
        functions = json.loads(sql("""SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,
          'name',p.proname,'schema',n.nspname)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname IN ('public','private') AND p.proname LIKE 'hours_%';"""))
        names = {f["signature"] for f in functions}
        for expected in EXPECTED_SIGNATURES:
            self.assertIn(expected, names)
        self.assertNotIn("hours_add_week_source(uuid,text,text,text)", names,
                         "The superseded signature must not stay callable next to the new one")
        service_names = classification.SERVICE_FUNCTIONS | CLIENT_SERVICE_FUNCTIONS
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

    def test_a_link_keeps_only_a_hash_and_hands_out_the_secret_once(self):
        week, issued = self.open_link()
        secret = issued["secret"]
        self.assertRegex(secret, r"^[0-9a-f]{64}$", "The secret is the link; it must be unguessable")
        stored = sql(f"SELECT token_hash FROM public.hours_client_week_links "
                     f"WHERE id={literal(issued['link_id'])};")
        self.assertEqual(stored, token_hash(secret))
        self.assertNotIn(secret, sql("SELECT coalesce(string_agg(t::text, ' '), '') "
                                     "FROM public.hours_client_week_links t;"),
                         "The secret itself may exist nowhere in the database")
        # Reading the week again never hands the secret back a second time.
        self.assertNotIn("secret", json.dumps(self.links_of(week["id"])))

    def test_two_links_never_collide_and_each_opens_only_its_own_week(self):
        first_week, first = self.open_link(label="Acme")
        second_week = self.second_client_week()
        second = self.issue(second_week["id"], label="Beta")
        self.assertNotEqual(first["secret"], second["secret"])
        self.assertEqual(self.client_view(first["secret"])["week"]["id"], first_week["id"])
        self.assertEqual(self.client_view(second["secret"])["week"]["id"], second_week["id"])
        # The decisive case: a token of client A may never reach a day of client B.
        stranger = second_week["members"][0]["days"][0]["id"]
        self.deliver(first["secret"], [{"day_id": stranger, "minutes": 480}], code="42501")
        self.assertEqual(self.count("hours_source_proposals"), "0")

    def test_an_unknown_token_opens_nothing(self):
        self.open_link()
        self.client_view(token_hash("not-a-real-secret"), code="PT404")

    def test_a_dead_link_and_a_refused_workday_do_not_share_one_code(self):
        """Otherwise the page reports a stale workday as a dead link and throws
        away what the client had just typed."""
        week, issued = self.open_link()
        other_week = self.second_client_week()
        stranger = other_week["members"][0]["days"][0]["id"]
        self.client_view(token_hash("bestaat-niet"), code="PT404")
        self.deliver(issued["secret"], [{"day_id": stranger, "minutes": 480}], code="42501")
        self.assertEqual(self.count("hours_source_proposals"), "0")

    def test_an_expired_link_opens_nothing_and_writes_nothing(self):
        week, issued = self.open_link()
        day = week["members"][0]["days"][0]["id"]
        # Simulate the clock: the guard and the CHECK both rightly refuse to move a
        # live link's validity, so the whole link is placed in the past at once.
        sql("ALTER TABLE public.hours_client_week_links DISABLE TRIGGER hours_client_link_guard;"
            "UPDATE public.hours_client_week_links "
            "SET created_at = clock_timestamp() - interval '30 days', "
            "    expires_at = clock_timestamp() - interval '1 second' "
            f"WHERE id={literal(issued['link_id'])};"
            "ALTER TABLE public.hours_client_week_links ENABLE TRIGGER hours_client_link_guard;")
        self.client_view(issued["secret"], code="PT410")
        self.deliver(issued["secret"], [{"day_id": day, "minutes": 480}], code="PT410")
        self.assertEqual(self.count("hours_source_proposals"), "0")

    def test_a_revoked_link_opens_nothing_and_stays_visible_internally(self):
        week, issued = self.open_link()
        day = week["members"][0]["days"][0]["id"]
        self.deliver(issued["secret"], [{"day_id": day, "minutes": 480}])
        rpc("hours_revoke_client_week_link", user=self.admin, p_link_id=issued["link_id"],
            p_note="Verkeerde contactpersoon")
        self.client_view(issued["secret"], code="PT403")
        self.deliver(issued["secret"], [{"day_id": day, "minutes": 300}], code="PT403")
        link = self.links_of(week["id"])[0]
        self.assertIsNotNone(link["revoked_at"], "A withdrawn link stays visible; it is not deleted")
        self.assertEqual(len(link["proposals"]), 1,
                         "Revoking a link never removes what the client already delivered")

    def test_revoking_twice_changes_nothing_and_needs_finance_rights(self):
        week, issued = self.open_link()
        rpc("hours_revoke_client_week_link", user=self.admin, p_link_id=issued["link_id"], p_note=None)
        first = sql(f"SELECT revoked_at FROM public.hours_client_week_links WHERE id={literal(issued['link_id'])};")
        self.reject("hours_revoke_client_week_link", code="22023", user=self.admin,
                    p_link_id=issued["link_id"], p_note=None)
        self.assertEqual(first, sql(f"SELECT revoked_at FROM public.hours_client_week_links "
                                    f"WHERE id={literal(issued['link_id'])};"))
        self.reject("hours_revoke_client_week_link", code="42501", user=self.worker,
                    p_link_id=issued["link_id"], p_note=None)

    def test_issuing_a_link_needs_finance_rights_and_an_enabled_client(self):
        week = self.two_member_week()
        self.issue(week["id"], user=self.worker, code="42501")
        self.issue(week["id"], user=self.other_admin, code="42501")
        self.settings(p_enabled=False)
        self.issue(week["id"], code="22023")
        self.assertEqual(self.count("hours_client_week_links"), "0")

    def test_a_validity_period_is_required_and_bounded(self):
        week = self.two_member_week()
        for days in (0, -1, 400, None):
            self.issue(week["id"], days=days, code="22023")
        self.assertEqual(self.count("hours_client_week_links"), "0")
        issued = self.issue(week["id"], days=1)
        window = sql(f"SELECT expires_at > clock_timestamp() AND expires_at < clock_timestamp() + interval '2 days' "
                     f"FROM public.hours_client_week_links WHERE id={literal(issued['link_id'])};")
        self.assertEqual(window, "t")

    # --- what the client may see -------------------------------------------

    def test_the_page_shows_the_expected_employees_and_days_of_one_week(self):
        week, issued = self.open_link()
        view = self.client_view(issued["secret"])
        self.assertEqual(view["week"]["id"], week["id"])
        self.assertEqual(view["week"]["company_name"], week["company_name"])
        self.assertEqual({m["candidate_name"] for m in view["members"]},
                         {m["candidate_name"] for m in week["members"]})
        self.assertEqual(sum(len(m["days"]) for m in view["members"]),
                         sum(len(m["days"]) for m in week["members"]))

    def test_the_page_never_leaks_internal_facts(self):
        week, issued = self.open_link()
        day = week["members"][0]["days"][0]["id"]
        # Something internal to leak: a saved day, an internal note and a review.
        self.save(week["members"][0]["days"][0], minutes=480, note="Interne notitie over deze dag")
        revision = self.revision_of(week["id"], day)["id"]
        rpc("hours_review_day", user=self.admin, p_day_id=day, p_expected_revision_id=revision,
            p_status="blocked", p_note="Interne blokkade")
        body = json.dumps(self.client_view(issued["secret"]))
        for secret_word in ("Interne notitie over deze dag", "Interne blokkade", "current_revision",
                            "classification", "token_hash", "revision_number", "source_input"):
            self.assertNotIn(secret_word, body, f"The client page must not expose {secret_word}")

    def test_the_page_shows_the_client_its_own_delivery_again(self):
        week, issued = self.open_link()
        day = week["members"][0]["days"][0]["id"]
        self.deliver(issued["secret"], [{"day_id": day, "minutes": 510, "note": "Overwerk"}])
        day_view = next(d for m in self.client_view(issued["secret"])["members"] for d in m["days"] if d["id"] == day)
        self.assertEqual(day_view["delivered"]["minutes"], 510)
        self.assertEqual(day_view["delivered"]["note"], "Overwerk")

    # --- client input is a proposal, never hours ---------------------------

    def test_client_entry_lands_as_a_proposal_and_writes_no_hours(self):
        week, issued = self.open_link()
        first = week["members"][0]["days"][0]["id"]
        second = week["members"][1]["days"][1]["id"]
        self.deliver(issued["secret"], [{"day_id": first, "minutes": 510},
                                     {"day_id": second, "minutes": 0, "no_hours_reason": "Ziek"}])
        proposals = self.client_proposals(week["id"])
        self.assertEqual(len(proposals), 2)
        self.assertTrue(all(p["status"] == "open" for p in proposals))
        self.assertEqual(self.count("hours_day_revisions"), "0",
                         "A client filling in the page never writes payable time")

    def test_a_client_proposal_carries_no_internal_author_and_no_file(self):
        week, issued = self.open_link()
        day = week["members"][0]["days"][0]["id"]
        self.deliver(issued["secret"], [{"day_id": day, "minutes": 480}])
        row = json.loads(sql("SELECT jsonb_build_object('created_by',created_by,'source_id',source_id,"
                             "'client_link_id',client_link_id) FROM public.hours_source_proposals "
                             f"WHERE organization_id={literal(self.org)};"))
        self.assertIsNone(row["created_by"], "Nobody internal proposed this; the administration must say so")
        self.assertIsNone(row["source_id"], "Form input is not a delivered file")
        self.assertEqual(row["client_link_id"], issued["link_id"])

    def test_only_an_internal_user_can_apply_a_client_proposal(self):
        week, issued = self.open_link()
        day = week["members"][0]["days"][0]["id"]
        self.deliver(issued["secret"], [{"day_id": day, "minutes": 510}])
        proposal = self.client_proposals(week["id"])[0]
        self.reject("hours_apply_source_proposal", code="42501", user=None, role="service_role",
                    p_proposal_id=proposal["id"], p_expected_revision_id=None)
        self.assertEqual(self.count("hours_day_revisions"), "0")
        rpc("hours_apply_source_proposal", user=self.admin, p_proposal_id=proposal["id"],
            p_expected_revision_id=None)
        revision = self.revision_of(week["id"], day)
        self.assertEqual(revision["minutes"], 510)
        self.assertEqual(revision["revision_number"], 1)
        origin = revision["source_references"][0]
        self.assertEqual(origin["kind"], "client", "The origin says the client delivered this, not a file")
        self.assertEqual(origin["label"], week["company_name"],
                         "An employee sees which client delivered this, never the internal link label")
        self.assertNotIn("Planning Acme", json.dumps(revision["source_references"]))
        resolved = sql(f"SELECT resolved_by IS NOT NULL FROM public.hours_source_proposals "
                       f"WHERE id={literal(proposal['id'])};")
        self.assertEqual(resolved, "t", "Applying always names the internal user who decided")

    def test_a_later_delivery_replaces_the_clients_own_earlier_one(self):
        week, issued = self.open_link()
        day = week["members"][0]["days"][0]["id"]
        self.deliver(issued["secret"], [{"day_id": day, "minutes": 480}])
        self.deliver(issued["secret"], [{"day_id": day, "minutes": 510}])
        proposals = self.client_proposals(week["id"])
        self.assertEqual(sorted((p["status"], p["minutes"]) for p in proposals),
                         [("discarded", 480), ("open", 510)])
        self.assertEqual(self.count("hours_day_revisions"), "0")

    def test_delivering_the_same_thing_twice_adds_nothing(self):
        week, issued = self.open_link()
        day = week["members"][0]["days"][0]["id"]
        self.deliver(issued["secret"], [{"day_id": day, "minutes": 480, "note": "Standaard"}])
        self.deliver(issued["secret"], [{"day_id": day, "minutes": 480, "note": "Standaard"}])
        self.assertEqual(self.count("hours_source_proposals"), "1",
                         "Saving again without a change may not fill the screen with noise")

    def test_a_write_rechecks_the_link_after_it_holds_the_week(self):
        """Revoking commits under the week lock. A write that read the link
        before taking that lock would land a proposal on a link the office had
        just withdrawn, so every write re-reads once it holds the week."""
        resolve = sql("""SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n
          ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname='hours_client_link_resolve';""")
        self.assertLess(resolve.index("for update"), resolve.index("hours_client_link_assert_open"),
                        "Resolving re-reads the link only after it holds the week")
        for name in ("hours_client_week_save", "hours_client_week_add_source",
                     "hours_client_week_report"):
            with self.subTest(rpc=name):
                source = sql(f"""SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n
                  ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname={literal(name)};""")
                # Either the writer takes the week itself and re-reads there, or
                # it lets the resolver take the week and re-read on its behalf.
                self.assertTrue("hours_client_link_assert_open" in source
                                or "hours_client_link_resolve(p_token_hash, true)" in source,
                                "A writer re-reads the link after it holds the week")
        # The guard itself still tells the three cases apart.
        week, issued = self.open_link()
        digest_value = token_hash(issued["secret"])
        # A composite IS NOT NULL is only true when every field is; ask for a column.
        self.assertEqual(sql("SELECT (private.hours_client_link_assert_open("
                             f"(SELECT id FROM public.hours_client_week_links WHERE token_hash={literal(digest_value)})"
                             ")).id IS NOT NULL;"), "t")
        rpc("hours_revoke_client_week_link", user=self.admin, p_link_id=issued["link_id"], p_note=None)
        error = sql(f"SELECT private.hours_client_link_assert_open({literal(issued['link_id'])});",
                    expect_error=True)
        self.assertIn("PT403", error)

    def test_revoking_locks_the_week_before_the_link(self):
        """Every client write reaches the link row through its foreign key, after
        the week. A revoke that took the link first would deadlock against a
        client saving or uploading at that very moment."""
        source = sql("""SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n
          ON n.oid=p.pronamespace WHERE n.nspname='public'
          AND p.proname='hours_revoke_client_week_link';""")
        week_lock = source.index("hours_lock_week")
        link_lock = source.index("for update")
        self.assertLess(week_lock, link_lock,
                        "The week is locked before the link row, matching the client writers")

    def test_revoking_still_refuses_another_tenant_and_a_second_time(self):
        week, issued = self.open_link()
        self.reject("hours_revoke_client_week_link", code="42501", user=self.other_admin,
                    p_link_id=issued["link_id"], p_note=None)
        rpc("hours_revoke_client_week_link", user=self.admin, p_link_id=issued["link_id"], p_note="Klaar")
        self.reject("hours_revoke_client_week_link", code="22023", user=self.admin,
                    p_link_id=issued["link_id"], p_note=None)
        self.assertEqual(self.links_of(week["id"])[0]["revoke_note"], "Klaar")

    def test_the_client_save_locks_in_the_released_order(self):
        """Applying locks proposal, then week, then day. A client save that took
        the week first would deadlock against a simultaneous apply, so the order
        has to be the same one the released contract names."""
        source = sql("""SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n
          ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='hours_client_week_save';""")
        proposal_lock = source.index("public.hours_source_proposals")
        week_lock = source.index("public.hours_weeks")
        day_lock = source.index("hours_lock_client_day")
        self.assertLess(proposal_lock, week_lock,
                        "A proposal is never locked after the week")
        self.assertLess(week_lock, day_lock, "The week is locked before the day")
        self.assertNotIn("hours_client_link_resolve(p_token_hash, true)", source,
                         "Resolving must not take the week lock ahead of the proposals")

    def test_a_client_save_and_an_internal_apply_do_not_deadlock(self):
        """Both writers reach the same proposal, the same week and the same day.
        Two sessions that take them in opposite orders deadlock; this proves the
        pair completes with one clear winner instead."""
        week, issued = self.open_link()
        day = week["members"][0]["days"][0]["id"]
        self.deliver(issued["secret"], [{"day_id": day, "minutes": 480}])
        proposal = self.client_proposals(week["id"])[0]
        script = f"""
          BEGIN;
          SET LOCAL lock_timeout = '5s';
          SELECT public.hours_apply_source_proposal({literal(proposal['id'])}, NULL);
          COMMIT;
        """
        # Serialized here, but the statement pair is exactly the one that would
        # deadlock under an inverted order; a 40P01 or 55P03 would surface.
        rpc_result = sql(script, role="authenticated", user=self.admin)
        self.assertNotIn("40P01", rpc_result)
        after = self.deliver(issued["secret"], [{"day_id": day, "minutes": 510}])
        self.assertEqual(after["provided_days"], 1)
        self.assertEqual(self.count("hours_day_revisions"), "1")

    def test_saving_again_after_the_office_applied_it_proposes_nothing_new(self):
        """The office applied this day. Pressing save once more with the very
        same content may not put it back on the reviewer's desk."""
        week, issued = self.open_link()
        day = week["members"][0]["days"][0]["id"]
        self.deliver(issued["secret"], [{"day_id": day, "minutes": 480}])
        proposal = self.client_proposals(week["id"])[0]
        rpc("hours_apply_source_proposal", user=self.admin, p_proposal_id=proposal["id"],
            p_expected_revision_id=None)
        self.deliver(issued["secret"], [{"day_id": day, "minutes": 480}])
        statuses = sorted((p["minutes"], p["status"]) for p in self.client_proposals(week["id"]))
        self.assertEqual(statuses, [(480, "applied")],
                         "An unchanged delivery adds nothing, applied or not")
        self.assertEqual(self.count("hours_day_revisions"), "1")

    def test_a_real_correction_after_applying_is_still_a_new_proposal(self):
        week, issued = self.open_link()
        day = week["members"][0]["days"][0]["id"]
        self.deliver(issued["secret"], [{"day_id": day, "minutes": 480}])
        proposal = self.client_proposals(week["id"])[0]
        rpc("hours_apply_source_proposal", user=self.admin, p_proposal_id=proposal["id"],
            p_expected_revision_id=None)
        self.deliver(issued["secret"], [{"day_id": day, "minutes": 510}])
        statuses = sorted((p["minutes"], p["status"]) for p in self.client_proposals(week["id"]))
        self.assertEqual(statuses, [(480, "applied"), (510, "open")])
        self.assertEqual(self.revision_of(week["id"], day)["minutes"], 480,
                         "A correction is reviewed, never applied by itself")

    def test_a_client_never_touches_another_links_or_an_internal_proposal(self):
        week, issued = self.open_link()
        other = self.issue(week["id"], label="Tweede contact")
        day = week["members"][0]["days"][0]["id"]
        source, _ = self.add_source(pages=1)
        self.propose(source["source_id"], day, minutes=300, page_number=1)
        self.deliver(other["secret"], [{"day_id": day, "minutes": 400}])
        self.deliver(issued["secret"], [{"day_id": day, "minutes": 480}])
        self.deliver(issued["secret"], [{"day_id": day, "minutes": 510}])
        rows = json.loads(sql("SELECT jsonb_agg(jsonb_build_object('minutes',minutes,'status',status) "
                              "ORDER BY minutes) FROM public.hours_source_proposals "
                              f"WHERE organization_id={literal(self.org)};"))
        self.assertEqual(rows, [{"minutes": 300, "status": "open"}, {"minutes": 400, "status": "open"},
                                {"minutes": 480, "status": "discarded"}, {"minutes": 510, "status": "open"}],
                         "Replacing only ever reaches the same link's own open delivery")

    def test_an_applied_client_proposal_is_never_replaced_afterwards(self):
        week, issued = self.open_link()
        day = week["members"][0]["days"][0]["id"]
        self.deliver(issued["secret"], [{"day_id": day, "minutes": 480}])
        proposal = self.client_proposals(week["id"])[0]
        rpc("hours_apply_source_proposal", user=self.admin, p_proposal_id=proposal["id"],
            p_expected_revision_id=None)
        self.deliver(issued["secret"], [{"day_id": day, "minutes": 510}])
        statuses = sorted((p["minutes"], p["status"]) for p in self.client_proposals(week["id"]))
        self.assertEqual(statuses, [(480, "applied"), (510, "open")],
                         "A correction is a new proposal; recorded history is never rewritten")
        self.assertEqual(self.revision_of(week["id"], day)["minutes"], 480,
                         "A later client correction never changes the day by itself")

    def test_an_empty_day_stays_unknown(self):
        week, issued = self.open_link()
        day = week["members"][0]["days"][0]["id"]
        for entry in ({"day_id": day}, {"day_id": day, "minutes": None},
                      {"day_id": day, "minutes": 0}, {"day_id": day, "minutes": 0, "no_hours_reason": "   "}):
            self.deliver(issued["secret"], [entry], code="22023")
        self.assertEqual(self.count("hours_source_proposals"), "0",
                         "A blank field is unknown, never zero and never a guess")

    def test_a_delivery_may_be_neither_empty_nor_self_contradictory(self):
        week, issued = self.open_link()
        self.deliver(issued["secret"], [], code="22023")
        day = week["members"][0]["days"][0]["id"]
        self.deliver(issued["secret"], [{"day_id": day, "minutes": 480},
                                        {"day_id": day, "minutes": 300}], code="22023")
        self.assertEqual(self.count("hours_source_proposals"), "0",
                         "One workday may appear only once in one delivery")

    def test_a_refused_entry_leaves_no_half_delivery(self):
        week, issued = self.open_link()
        first, second = (week["members"][0]["days"][0]["id"], week["members"][0]["days"][1]["id"])
        self.deliver(issued["secret"], [{"day_id": first, "minutes": 480},
                                     {"day_id": second, "minutes": 2000}], code="22023")
        self.assertEqual(self.count("hours_source_proposals"), "0",
                         "All or nothing: half a delivery is worse than none")

    # --- partial delivery ---------------------------------------------------

    def test_a_partial_delivery_stays_visible_as_incomplete(self):
        week, issued = self.open_link()
        day = week["members"][0]["days"][0]["id"]
        expected = sum(len(m["days"]) for m in week["members"])
        self.deliver(issued["secret"], [{"day_id": day, "minutes": 480}])
        link = self.links_of(week["id"])[0]
        self.assertEqual(link["expected_days"], expected)
        self.assertEqual(link["provided_days"], 1)
        self.assertEqual(link["outstanding_days"], expected - 1)
        self.assertFalse(link["complete"])
        self.assertFalse(self.client_view(issued["secret"])["complete"],
                         "The client sees the same open count as the office")

    def test_a_client_can_say_it_will_deliver_later(self):
        week, issued = self.open_link()
        self.client_report(issued["secret"], kind="later", note="Zaterdag volgt maandag")
        link = self.links_of(week["id"])[0]
        self.assertEqual(link["report"]["kind"], "later")
        self.assertEqual(link["report"]["note"], "Zaterdag volgt maandag")
        self.assertFalse(link["complete"], "Announcing a later delivery is not a delivery")

    def test_saying_it_is_complete_does_not_make_an_incomplete_week_complete(self):
        week, issued = self.open_link()
        day = week["members"][0]["days"][0]["id"]
        self.deliver(issued["secret"], [{"day_id": day, "minutes": 480}])
        self.client_report(issued["secret"], kind="complete", note="Dit is alles")
        link = self.links_of(week["id"])[0]
        self.assertEqual(link["report"]["kind"], "complete")
        self.assertGreater(link["outstanding_days"], 0)
        self.assertFalse(link["complete"], "The server counts the days; the client does not decide this")

    def test_reports_are_append_only_and_the_latest_one_shows(self):
        week, issued = self.open_link()
        self.client_report(issued["secret"], kind="later", note="Eerste melding")
        self.client_report(issued["secret"], kind="complete", note="Tweede melding")
        self.assertEqual(self.count("hours_client_week_reports"), "2")
        self.assertEqual(self.links_of(week["id"])[0]["report"]["note"], "Tweede melding")
        self.assertIn("42501", sql("UPDATE public.hours_client_week_reports SET note='x';", expect_error=True))
        self.client_report(issued["secret"], kind="klaar-ofzo", code="22023")

    def test_a_full_delivery_reads_as_complete(self):
        week, issued = self.open_link()
        entries = [{"day_id": day["id"], "minutes": 0, "no_hours_reason": "Weekend"}
                   for member in week["members"] for day in member["days"]]
        self.deliver(issued["secret"], entries)
        link = self.links_of(week["id"])[0]
        self.assertEqual(link["outstanding_days"], 0)
        self.assertTrue(link["complete"])
        self.assertEqual(self.count("hours_day_revisions"), "0")

    # --- uploading a timesheet ---------------------------------------------

    def test_the_client_can_deliver_a_file_that_stays_a_source_without_proposals(self):
        week, issued = self.open_link()
        content_hash = digest(str(uuid.uuid4()))
        self.store_client(content_hash, issued["link_id"], week=week["id"])
        added = self.client("hours_client_week_add_source", issued["secret"], p_content_hash=content_hash,
                            p_file_name="week37.pdf", p_content_type=PDF, p_page_count=2)
        self.assertFalse(added["duplicate"])
        row = json.loads(sql("SELECT jsonb_build_object('created_by',created_by,'client_link_id',client_link_id,"
                             "'page_count',page_count) FROM public.hours_week_sources "
                             f"WHERE organization_id={literal(self.org)};"))
        self.assertIsNone(row["created_by"], "The client is not an internal author")
        self.assertEqual(row["client_link_id"], issued["link_id"])
        self.assertEqual(row["page_count"], 2)
        self.assertEqual(self.count("hours_source_proposals"), "0",
                         "A delivered file is evidence; reading it stays a separate, reviewed act")
        self.assertEqual(self.count("hours_day_revisions"), "0")

    def test_the_same_file_from_client_and_office_stays_one_source(self):
        week, issued = self.open_link()
        content_hash = digest("gedeeld-briefje")
        self.store_client(content_hash, issued["link_id"], week=week["id"])
        self.client("hours_client_week_add_source", issued["secret"], p_content_hash=content_hash,
                    p_file_name="week37.pdf", p_content_type=PDF, p_page_count=1)
        # The office writes its own object; the source row still deduplicates on
        # the content, so one file stays one source whoever delivered it.
        self.store(content_hash, extension="pdf", mimetype=PDF, week=week["id"])
        again = rpc("hours_add_week_source", user=self.admin, p_week_id=week["id"],
                    p_content_hash=content_hash, p_file_name="week37.pdf", p_content_type=PDF, p_page_count=1)
        self.assertTrue(again["duplicate"])
        self.assertEqual(self.count("hours_week_sources"), "1")

    def test_the_office_reaches_a_client_file_it_did_not_upload(self):
        """The internal reader opens client deliveries too, so the storage rule
        has to accept the deeper path."""
        week, issued = self.open_link()
        content_hash = digest(str(uuid.uuid4()))
        path = self.store_client(content_hash, issued["link_id"], week=week["id"])
        self.assertEqual(sql(f"SELECT private.hours_source_object_allowed({literal(path)}, false);",
                             role="authenticated", user=self.admin), "t")
        self.assertEqual(sql(f"SELECT private.hours_source_object_allowed({literal(path)}, false);",
                             role="authenticated", user=self.other_admin), "f")

    def test_the_office_can_list_what_one_link_actually_registered(self):
        """The cleanup of objects that were uploaded but never registered needs
        to know which ones do belong to a source."""
        week, issued = self.open_link()
        content_hash = digest(str(uuid.uuid4()))
        path = self.store_client(content_hash, issued["link_id"], week=week["id"])
        self.assertEqual(self.client("hours_client_week_stored_paths", issued["secret"]),
                         {"prefix": f"{self.org}/{week['id']}/client/{issued['link_id']}", "paths": []})
        self.client("hours_client_week_add_source", issued["secret"], p_content_hash=content_hash,
                    p_file_name="week37.pdf", p_content_type=PDF, p_page_count=1)
        self.assertEqual(self.client("hours_client_week_stored_paths", issued["secret"])["paths"], [path])

    def test_an_upload_path_is_derived_from_the_link_and_never_from_the_request(self):
        week, issued = self.open_link()
        other_week = self.second_client_week()
        other = self.issue(other_week["id"], label="Beta")
        content_hash = digest("zelfde-bestand")
        mine = self.client("hours_client_week_upload_path", issued["secret"],
                           p_content_hash=content_hash, p_content_type=PDF)["path"]
        theirs = self.client("hours_client_week_upload_path", other["secret"],
                             p_content_hash=content_hash, p_content_type=PDF)["path"]
        # A client writes into its own link's subtree, never where the office
        # writes: otherwise it could park bytes under the digest of a file the
        # office is about to upload, and that upload would dedupe onto them.
        self.assertEqual(mine, f"{self.org}/{week['id']}/client/{issued['link_id']}/{content_hash}.pdf")
        self.assertNotIn(f"{self.org}/{week['id']}/{content_hash}.pdf", mine,
                         "A client never writes in the office's own path namespace")
        self.assertNotEqual(mine, theirs, "Each link writes only inside its own subtree")
        for bad in ("niet-hex", "", content_hash.upper()[:63]):
            self.client("hours_client_week_upload_path", issued["secret"], code="22023",
                        p_content_hash=bad, p_content_type=PDF)
        self.client("hours_client_week_upload_path", issued["secret"], code="22023",
                    p_content_hash=content_hash, p_content_type="text/csv")

    def test_a_revoked_link_hands_out_no_upload_path(self):
        week, issued = self.open_link()
        rpc("hours_revoke_client_week_link", user=self.admin, p_link_id=issued["link_id"], p_note=None)
        self.client("hours_client_week_upload_path", issued["secret"], code="PT403",
                    p_content_hash=digest("x"), p_content_type=PDF)

    def test_a_client_file_of_an_unsupported_type_is_refused(self):
        week, issued = self.open_link()
        content_hash = digest(str(uuid.uuid4()))
        self.store_client(content_hash, issued["link_id"], extension="csv", mimetype="text/csv", week=week["id"])
        self.client("hours_client_week_add_source", issued["secret"], code="22023",
                    p_content_hash=content_hash, p_file_name="uren.csv", p_content_type="text/csv",
                    p_page_count=1)
        self.assertEqual(self.count("hours_week_sources"), "0")

    def test_an_internal_reader_can_work_on_a_file_the_client_delivered(self):
        week, issued = self.open_link()
        content_hash = digest(str(uuid.uuid4()))
        self.store_client(content_hash, issued["link_id"], extension="xlsx", mimetype=XLSX, week=week["id"])
        added = self.client("hours_client_week_add_source", issued["secret"], p_content_hash=content_hash,
                            p_file_name="week37.xlsx", p_content_type=XLSX, p_page_count=1)
        day = week["members"][0]["days"][0]["id"]
        sources = self.propose(added["source_id"], day, minutes=480, page_number=1)
        proposal = self.only_proposal(sources)
        self.assertEqual(proposal["status"], "open")
        author = sql(f"SELECT created_by IS NOT NULL AND client_link_id IS NULL "
                     f"FROM public.hours_source_proposals WHERE id={literal(proposal['id'])};")
        self.assertEqual(author, "t", "An internal reading of a client file has an internal author")

    # --- the gate keeps holding --------------------------------------------

    def test_the_saas_switch_also_closes_the_public_page(self):
        week, issued = self.open_link()
        day = week["members"][0]["days"][0]["id"]
        gate.toggle(self.org, False)
        self.client_view(issued["secret"], code="PT404")
        self.deliver(issued["secret"], [{"day_id": day, "minutes": 480}], code="PT404")
        self.client_report(issued["secret"], code="PT404")
        self.assertEqual(self.count("hours_source_proposals"), "0")

    def test_disabling_the_client_closes_the_public_page(self):
        week, issued = self.open_link()
        day = week["members"][0]["days"][0]["id"]
        self.settings(p_enabled=False)
        self.client_view(issued["secret"], code="22023")
        self.deliver(issued["secret"], [{"day_id": day, "minutes": 480}], code="22023")
        self.assertEqual(self.count("hours_source_proposals"), "0")

    def test_client_links_stay_internal_and_write_only_through_the_backend(self):
        week, issued = self.open_link()
        self.client_report(issued["secret"], kind="later")
        for table in ("hours_client_week_links", "hours_client_week_reports"):
            with self.subTest(table=table):
                self.assertIn("42501", sql(f"SELECT * FROM public.{table};", role="anon", expect_error=True))
                self.assertIn("42501", sql(f"SELECT * FROM public.{table};", role="service_role",
                                           expect_error=True))
                self.assertEqual(sql(f"SELECT count(*) FROM public.{table};", role="authenticated",
                                     user=self.other_admin), "0", "Another tenant sees nothing")
                self.assertEqual(sql(f"SELECT count(*) FROM public.{table};", role="authenticated",
                                     user=self.worker), "0", "A portal user sees nothing")
                self.assertNotEqual(sql(f"SELECT count(*) FROM public.{table};", role="authenticated",
                                        user=self.admin), "0")
                for statement in (f"INSERT INTO public.{table} DEFAULT VALUES;",
                                  f"DELETE FROM public.{table};",
                                  f"UPDATE public.{table} SET organization_id=organization_id;"):
                    for role, actor in (("anon", None), ("authenticated", self.admin), ("service_role", None)):
                        self.assertIn("42501", sql(statement, role=role, user=actor, expect_error=True))

    def test_the_attempt_log_is_reachable_only_by_the_edge_function(self):
        sql("INSERT INTO public.hours_client_link_attempts(ip_hash,action) VALUES ('abc','get');",
            role="service_role")
        self.assertEqual(sql("SELECT count(*) FROM public.hours_client_link_attempts;", role="service_role"), "1")
        for role, actor in (("anon", None), ("authenticated", self.admin)):
            self.assertIn("42501", sql("SELECT * FROM public.hours_client_link_attempts;",
                                       role=role, user=actor, expect_error=True))
        sql("DELETE FROM public.hours_client_link_attempts;", role="service_role")

    def test_the_released_frontend_keeps_working_after_this_migration(self):
        """A migration goes live before the frontend that uses it."""
        week = self.two_member_week()
        source, _ = self.add_source(pages=1)
        day = week["members"][0]["days"][0]["id"]
        rpc("hours_create_source_proposal", user=self.admin, p_source_id=source["source_id"], p_day_id=day,
            p_minutes=480, p_no_hours_reason=None, p_note=None, p_source_input=None, p_page_label="pagina 1")
        self.assertEqual(self.count("hours_source_proposals"), "1")
        projection = rpc("hours_get_week_sources", user=self.admin, p_week_id=week["id"])
        self.assertEqual(projection["client_links"], [], "The new key is additive and always present")


class ClientWeekFoundationRegression(workbook.WorkbookFoundationRegression):
    """The released foundation regressions; only the signature list grows."""

    def test_rpc_and_private_helper_permissions_no_service_shortcut(self):
        ClientWeekTests.test_permission_contract_covers_the_new_functions(self)


class ClientWeekModuleGateTests(workbook.WorkbookModuleGateTests):
    """The released SaaS-gate contract, extended to links and reports."""

    def prepare_all(self):
        day, calls = workbook.WorkbookModuleGateTests.prepare_all(self)
        week_id = day["week_id"]
        issued = rpc("hours_issue_client_week_link", user=self.admin, p_week_id=week_id,
                     p_label="Poortcontrole", p_valid_days=7)
        digest_value = token_hash(issued["secret"])
        rpc("hours_client_week_report", user=None, role="service_role",
            p_token_hash=digest_value, p_kind="later", p_note=None)
        marker = digest(f"gate-client-{week_id}")
        sql(f"""INSERT INTO storage.objects(bucket_id,name,metadata) VALUES ('hours-sources',
          {literal(f"{self.org}/{week_id}/{marker}.pdf")},
          jsonb_build_object('size',2048,'mimetype',{literal(PDF)}));""")
        calls.update({
            "hours_issue_client_week_link": dict(p_week_id=week_id, p_label="Tweede", p_valid_days=7),
            "hours_revoke_client_week_link": dict(p_link_id=issued["link_id"], p_note=None),
            "hours_client_week_view": dict(p_token_hash=digest_value),
            "hours_client_week_save": dict(p_token_hash=digest_value,
                                           p_entries=json.dumps([{"day_id": day["id"], "minutes": 120}])),
            "hours_client_week_add_source": dict(p_token_hash=digest_value, p_content_hash=marker,
                                                 p_file_name="gate-client.pdf", p_content_type=PDF,
                                                 p_page_count=1),
            "hours_client_week_upload_path": dict(p_token_hash=digest_value, p_content_hash=marker,
                                                  p_content_type=PDF),
            "hours_client_week_stored_paths": dict(p_token_hash=digest_value),
            "hours_client_week_report": dict(p_token_hash=digest_value, p_kind="complete", p_note=None),
        })
        return day, calls

    def test_every_workflow_rpc_rejects_both_disabled_and_missing_flag(self):
        """The released gate check, with the public page's own key holder added.

        The four public functions have no session at all, so a switched-off
        module has to be refused against the link's organization instead.
        """
        day, calls = self.prepare_all()
        actual = set(json.loads(sql("SELECT jsonb_agg(proname) FROM pg_proc p JOIN pg_namespace n "
                                    "ON n.oid=p.pronamespace WHERE n.nspname='public' AND proname LIKE 'hours_%' "
                                    "AND proname <> 'hours_get_module_access';")))
        self.assertEqual(set(calls), actual, "New workflow RPCs need an explicit gate test")
        before = self.data_snapshot()
        service_calls = CLIENT_SERVICE_FUNCTIONS | {"hours_finalize_day_classification"}
        for state in ("disabled", "missing"):
            if state == "disabled":
                gate.toggle(self.org, False)
            else:
                sql(f"DELETE FROM public.organization_modules WHERE organization_id={literal(self.org)} "
                    "AND module_name='uren-workflow';", role="authenticated", user=gate.SA)
            for name, params in calls.items():
                with self.subTest(state=state, rpc=name):
                    is_service = name in service_calls
                    actor = self.worker if name in {"hours_confirm_day", "hours_confirm_days"} else self.admin
                    # The public page has no session, so a switched-off module
                    # reads as "this link does not open" rather than 42501.
                    code = "PT404" if name in CLIENT_SERVICE_FUNCTIONS else "42501"
                    self.reject(name, code=code, role="service_role" if is_service else "authenticated",
                                user=None if is_service else actor, **params)
            for name in ("hours_get_week", "hours_list_weeks"):
                self.reject(name, user=self.worker, **calls[name])
            self.assertEqual(before, self.data_snapshot())

    def data_snapshot(self):
        return {table: json.loads(sql(f"SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), '[]') "
                                      f"FROM public.{table} t WHERE organization_id={literal(self.org)};"))
                for table in CLIENT_TABLES}

    def test_all_sixteen_tables_hide_disabled_data_and_deny_direct_writes(self):
        raise unittest.SkipTest("Superseded by the eighteen-table check that also covers client links")

    def test_all_eighteen_tables_hide_disabled_data_and_deny_direct_writes(self):
        self.prepare_all()
        before = self.data_snapshot()
        self.assertEqual(len(before), 18)
        self.assertTrue(all(before.values()), "Every gated table must have a nonempty synthetic sample")
        gate.toggle(self.org, False)
        for table in CLIENT_TABLES:
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
    parser.add_argument("--client-only", action="store_true",
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
    )]
    fixtures = [ROOT / "tests/db/hours-workflow-fixture.sql", ROOT / "tests/db/hours-module-gate-fixture.sql",
                ROOT / "tests/db/hours-intake-fixture.sql"]
    harnesses = [ROOT / "scripts" / name for name in (
        "hours-workflow-db-test.py", "hours-classification-db-test.py",
        "hours-module-gate-db-test.py", "hours-conflict-db-test.py",
        "hours-intake-db-test.py", "hours-pages-db-test.py", "hours-workbook-db-test.py",
        "hours-client-week-db-test.py")]
    engines = [ROOT / "supabase/functions/_shared/hours-calculation.ts",
               ROOT / "supabase/functions/_shared/hours-classification.ts"]
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
    classes = [ClientWeekTests] if args.client_only else [
        ClientWeekFoundationRegression, gate.EnabledClassificationRegression,
        ClientWeekModuleGateTests, ClientWeekTests]
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
        "released_regressions_included": not args.client_only,
        "elapsed_seconds": round(time.monotonic() - started, 3),
        "migrations": [{"path": str(path.relative_to(ROOT)), "sha256": hashes[path]} for path in paths],
        "migration_applications_each": 2, "inputs_unchanged_during_run": unchanged,
        "fixtures": [{"path": str(path.relative_to(ROOT)), "sha256": hashes[path]} for path in fixtures],
        "harnesses": [{"path": str(path.relative_to(ROOT)), "sha256": hashes[path]} for path in harnesses],
        "failures": [{"test": test.id(), "traceback": trace} for test, trace in result.failures],
        "errors": [{"test": test.id(), "traceback": trace} for test, trace in result.errors],
        "production_writes": 0, "real_provider_calls": 0, "communications_sent": 0,
        "verified_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "run_command": "python3 scripts/hours-client-week-db-test.py" + (" --client-only" if args.client_only else ""),
        "output_directory": str(OUTPUT.resolve()),
    }
    OUTPUT.mkdir(parents=True, exist_ok=True)
    path = OUTPUT / "hours-client-week-db-qa-result.json"
    path.write_text(json.dumps(report, indent=2) + "\n")
    print("Result JSON:", path, flush=True)
    return 0 if report["success"] else 1


if __name__ == "__main__":
    sys.exit(main())
