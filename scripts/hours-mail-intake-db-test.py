#!/usr/bin/env python3
"""Real PostgreSQL tests for durable mail intake: request references, cursor, queue and control bin.

Runs the released hours migrations plus the new mail-intake migration in a
disposable container, then the full word-mail/scan/client-week/workbook/pages/
intake/module-gate/classification/foundation regressions on top, so the widened
source contract is proven to leave the released behaviour intact.
No production writes, providers, network or host mounts.
Run: python3 scripts/hours-mail-intake-db-test.py
Cleanup: python3 scripts/hours-mail-intake-db-test.py --cleanup
HOURS_MAIL_QA_OUTPUT selects a durable output directory.
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
OUTPUT = Path(os.environ.get("HOURS_MAIL_QA_OUTPUT", ROOT / "test-results/hours-mail-intake-db"))
# Import through the released Word/mail harness so every earlier case runs
# against this schema unchanged; only the expectations that genuinely moved are
# overridden, and each override says why.
spec = importlib.util.spec_from_file_location("hours_word_mail_qa", ROOT / "scripts/hours-word-mail-db-test.py")
wordmail = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wordmail)
scan = wordmail.scan
client = wordmail.client
workbook = wordmail.workbook
pages = wordmail.pages
intake = wordmail.intake
gate = wordmail.gate
classification = wordmail.classification
qa = wordmail.qa
qa.CONTAINER = "ja-works-hours-mail-intake-test-20260916"
qa.LABEL = "ja-werkt-hours-mail-intake-qa"
qa.LABEL_VALUE = "20260916"
sql, rpc = qa.sql, qa.rpc


class SqlText(str):
    """A parameter that is already SQL. Postgres text[] is not jsonb, and the
    released literal helper turns every Python list into jsonb."""


_released_literal = qa.literal


def literal(value):
    return str(value) if isinstance(value, SqlText) else _released_literal(value)


# rpc_statement reads this name from its own module at call time, so patching it
# here is what lets a text[] parameter reach the database as a text[].
qa.literal = literal


def text_array(values):
    if values is None:
        return SqlText("null::text[]")
    return SqlText("ARRAY[" + ",".join(_released_literal(value) for value in values) + "]::text[]")

PDF = intake.PDF
XLSX = workbook.XLSX
EML = wordmail.EML
digest = intake.digest

MAIL_TABLES = scan.SCAN_TABLES + (
    "hours_week_requests", "hours_mail_folders", "hours_mail_messages")
MAIL_SERVICE_FUNCTIONS = {
    "hours_mail_due_folders", "hours_mail_record_messages", "hours_mail_set_cursor",
    "hours_mail_clear_cursor", "hours_mail_claim_messages", "hours_mail_renew_lease",
    "hours_mail_match_message", "hours_mail_file_message", "hours_mail_fail_message",
    "hours_mail_release_message"}
EXPECTED_SIGNATURES = wordmail.EXPECTED_SIGNATURES + (
    "hours_issue_week_request(uuid,text,integer)",
    "hours_revoke_week_request(uuid,text)",
    "hours_mail_overview()",
    "hours_mail_set_folder(uuid,text,text,boolean)",
    "hours_mail_dismiss_message(uuid,text)",
    "hours_mail_assign_message(uuid,uuid,text)",
    "hours_mail_due_folders(integer,uuid)",
    "hours_mail_record_messages(uuid,jsonb,text[])",
    "hours_mail_set_cursor(uuid,text,boolean,text)",
    "hours_mail_clear_cursor(uuid)",
    "hours_mail_claim_messages(uuid,integer,integer)",
    "hours_mail_renew_lease(uuid,uuid,integer)",
    "hours_mail_match_message(uuid,uuid,text[],text[],text)",
    "hours_mail_file_message(uuid,uuid,jsonb,jsonb,jsonb)",
    "hours_mail_fail_message(uuid,uuid,text,text,text)",
    "hours_mail_release_message(uuid,uuid)",
)
GRAPH = "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=abc"


class MailIntakeTests(wordmail.WordMailTests):
    """Intake on top of the released Word/mail contract."""

    # --- helpers -----------------------------------------------------------

    def grant(self, account, user=None, read=True, org=None):
        sql(f"""INSERT INTO public.mail_account_user_access(organization_id,mail_account_id,user_id,
          can_read_mail) VALUES ({literal(org or self.org)},{literal(account)},
          {literal(user or self.admin)},{literal(read)})
          ON CONFLICT (mail_account_id,user_id) DO UPDATE SET can_read_mail=EXCLUDED.can_read_mail;""")

    def mailbox(self, org=None, read=True, scope="organization", owner=None, grant_to=None):
        identifier = str(uuid.uuid4())
        sql(f"""INSERT INTO public.mail_accounts(id,organization_id,provider,scope,mailbox_mode,
          display_name,from_email,mailbox_email,mail_read_enabled,status,owner_user_id)
          VALUES ({literal(identifier)},{literal(org or self.org)},'outlook',{literal(scope)},'user',
            'QA-postbus','qa@example.invalid','qa@example.invalid',{literal(read)},'connected',
            {literal(owner)});""")
        if grant_to is not False:
            self.grant(identifier, user=grant_to or self.admin, org=org)
        return identifier

    def follow(self, account=None, folder="AAMkTestFolder", label="Uren", enabled=True, user=None):
        account = account or getattr(self, "account", None) or self.mailbox()
        self.account = account
        return rpc("hours_mail_set_folder", user=user or self.admin, p_mail_account_id=account,
                   p_folder_id=folder, p_folder_label=label, p_enabled=enabled)

    def folder_id(self, projection=None, index=0):
        projection = projection or rpc("hours_mail_overview", user=self.admin)
        return projection["folders"][index]["id"]

    def request(self, week=None, label="Weekuitvraag", days=30):
        result = rpc("hours_issue_week_request", user=self.admin, p_week_id=week or self.week_id,
                     p_label=label, p_valid_days=days)
        return result["request_id"], result["code"]

    def contact(self, email, company=None, org=None):
        identifier = str(uuid.uuid4())
        sql(f"""INSERT INTO public.company_contacts(id,organization_id,company_id,email,first_name,last_name)
          VALUES ({literal(identifier)},{literal(org or self.org)},{literal(company or self.company)},
            {literal(email)},'QA','Contact');""")
        return identifier

    def observe(self, folder, key="<msg-1@example.invalid>", graph="AAMkGraph1",
                sender="planner@klant.invalid", subject="RE: uren", attachments=False, removed=None,
                conversation=None):
        return rpc("hours_mail_record_messages", role="service_role", p_folder_row_id=folder,
                   p_messages=[{"message_key": key, "graph_message_id": graph,
                                "internet_message_id": key, "subject": subject,
                                "from_address": sender, "from_name": "Planner",
                                "received_at": "2026-09-14T08:00:00Z",
                                "conversation_id": conversation,
                                "has_attachments": attachments}],
                   p_removed=text_array(removed))

    def claim(self, folder, limit=5, lease=300):
        return rpc("hours_mail_claim_messages", role="service_role", p_folder_row_id=folder,
                   p_limit=limit, p_lease_seconds=lease)

    def stored_file(self, extension="eml", mimetype=EML, name="antwoord.eml", pages_count=None,
                    week=None, marker=None):
        content_hash = digest(marker or str(uuid.uuid4()))
        self.store(content_hash, extension=extension, mimetype=mimetype, week=week or self.week_id)
        return {"content_hash": content_hash, "file_name": name, "content_type": mimetype,
                "page_count": pages_count}

    def prepare_claimed(self, sender="planner@klant.invalid", codes=None, contact=True):
        """A followed folder, an issued request, a known sender and one claimed message."""
        self.open_week()
        folder = self.folder_id(self.follow())
        request_id, code = self.request()
        if contact:
            self.contact(sender)
        self.observe(folder, sender=sender)
        claimed = self.claim(folder)
        return folder, request_id, code, claimed["claim_token"], claimed["messages"][0]["id"]

    # --- contract ----------------------------------------------------------

    def test_permission_contract_covers_the_new_functions(self):
        """The released check, widened with the intake's own service-role list."""
        functions = json.loads(sql("""SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,
          'name',p.proname,'schema',n.nspname)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname IN ('public','private') AND p.proname LIKE 'hours_%';"""))
        names = {f["signature"] for f in functions}
        for expected in EXPECTED_SIGNATURES:
            self.assertIn(expected, names)
        service_names = (classification.SERVICE_FUNCTIONS | client.CLIENT_SERVICE_FUNCTIONS
                         | {"hours_claim_source_reading", "hours_finish_source_reading"}
                         | MAIL_SERVICE_FUNCTIONS)
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
        MailIntakeTests.test_permission_contract_covers_the_new_functions(self)

    # --- the request reference ---------------------------------------------

    def test_a_request_is_scoped_to_one_week_with_a_readable_code(self):
        week = self.open_week()
        request_id, code = self.request()
        self.assertRegex(code, r"^UR-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$")
        self.assertNotRegex(code, r"[01OI]", "The alphabet leaves out what a human misreads")
        listed = rpc("hours_get_week_sources", user=self.admin, p_week_id=week["id"])["requests"]
        self.assertEqual([entry["code"] for entry in listed], [code])
        self.assertEqual(listed[0]["id"], request_id)
        self.assertEqual(listed[0]["received"], 0)
        self.assertEqual(sql(f"SELECT week_id FROM public.hours_week_requests WHERE id={literal(request_id)};"),
                         week["id"])

    def test_a_request_never_moves_to_another_week_or_code(self):
        self.open_week()
        request_id, _ = self.request()
        self.add_placement(start="2026-09-14", end="2026-09-20")
        other = self.week("2026-09-14")
        for column, value in (("week_id", other["id"]), ("code", "UR-2222-3333"),
                              ("company_id", self.other_company), ("expires_at", "2030-01-01")):
            self.assertIn("42501", sql(f"UPDATE public.hours_week_requests SET {column}={literal(value)} "
                                       f"WHERE id={literal(request_id)};", expect_error=True))
        self.assertIn("42501", sql(f"DELETE FROM public.hours_week_requests WHERE id={literal(request_id)};",
                                   expect_error=True))

    def test_withdrawing_a_request_happens_once(self):
        self.open_week()
        request_id, _ = self.request()
        rpc("hours_revoke_week_request", user=self.admin, p_request_id=request_id, p_note="Fout verstuurd")
        self.reject("hours_revoke_week_request", code="22023", user=self.admin,
                    p_request_id=request_id, p_note=None)

    def test_a_request_of_another_tenant_is_not_reachable(self):
        self.open_week()
        request_id, _ = self.request()
        self.reject("hours_revoke_week_request", code="42501", user=self.other_admin,
                    p_request_id=request_id, p_note=None)
        self.assertEqual(sql(f"SELECT count(*) FROM public.hours_week_requests "
                             f"WHERE id={literal(request_id)};", role="authenticated",
                             user=self.other_admin), "0")

    def test_the_sent_fields_are_written_once_and_then_stand(self):
        """T8 fills these after sending; nothing may re-point them afterwards."""
        self.open_week()
        request_id, _ = self.request()
        sql(f"""UPDATE public.hours_week_requests SET outbound_message_id='<out-1@ja.invalid>',
          conversation_id='conv-1', sent_at=now() WHERE id={literal(request_id)};""")
        self.assertIn("42501", sql(f"UPDATE public.hours_week_requests "
                                   f"SET outbound_message_id='<out-2@ja.invalid>' "
                                   f"WHERE id={literal(request_id)};", expect_error=True))

    # --- followed folders and the cursor -----------------------------------

    def test_following_a_folder_needs_a_readable_mailbox_of_this_tenant(self):
        self.open_week()
        foreign = self.mailbox(org=self.other_org)
        self.reject("hours_mail_set_folder", code="22023", user=self.admin, p_mail_account_id=foreign,
                    p_folder_id="inbox", p_folder_label="Postvak IN", p_enabled=True)
        unreadable = self.mailbox(read=False)
        self.reject("hours_mail_set_folder", code="22023", user=self.admin,
                    p_mail_account_id=unreadable, p_folder_id="inbox", p_folder_label="Postvak IN",
                    p_enabled=True)

    def test_following_the_same_folder_twice_is_one_folder(self):
        self.open_week()
        account = self.mailbox()
        first = self.follow(account, folder="inbox", label="Postvak IN")
        second = self.follow(account, folder="inbox", label="Uren", enabled=False)
        self.assertEqual(len(second["folders"]), 1)
        self.assertEqual(second["folders"][0]["folder_label"], "Uren")
        self.assertFalse(second["folders"][0]["enabled"])
        self.assertEqual(first["folders"][0]["id"], second["folders"][0]["id"])

    def test_the_cursor_survives_and_only_moves_on_a_finished_pass(self):
        self.open_week()
        folder = self.folder_id(self.follow())
        rpc("hours_mail_set_cursor", role="service_role", p_folder_row_id=folder,
            p_delta_link=GRAPH, p_resynced=False, p_error=None)
        overview = rpc("hours_mail_overview", user=self.admin)["folders"][0]
        self.assertTrue(overview["has_cursor"])
        # A pass that fell over reports the failure and leaves the cursor alone.
        rpc("hours_mail_set_cursor", role="service_role", p_folder_row_id=folder,
            p_delta_link=None, p_resynced=False, p_error="graph_503")
        self.assertEqual(sql(f"SELECT delta_link FROM public.hours_mail_folders "
                             f"WHERE id={literal(folder)};"), GRAPH)
        self.assertEqual(rpc("hours_mail_overview", user=self.admin)["folders"][0]["last_error"], "graph_503")

    def test_a_cursor_must_come_from_graph(self):
        self.open_week()
        folder = self.folder_id(self.follow())
        self.reject("hours_mail_set_cursor", code="22023", role="service_role", user=None,
                    p_folder_row_id=folder, p_delta_link="https://evil.invalid/delta",
                    p_resynced=False, p_error=None)

    def test_an_expired_cursor_resyncs_without_a_second_source(self):
        """410 throws the cursor away; a full pass yields the same rows, not new ones."""
        folder, _, code, _, _ = self.prepare_claimed()
        rpc("hours_mail_set_cursor", role="service_role", p_folder_row_id=folder,
            p_delta_link=GRAPH, p_resynced=False, p_error=None)
        rpc("hours_mail_clear_cursor", role="service_role", p_folder_row_id=folder)
        self.assertIsNone(json.loads(sql(f"SELECT coalesce(to_jsonb(delta_link),'null'::jsonb) "
                                         f"FROM public.hours_mail_folders WHERE id={literal(folder)};")))
        self.assertEqual(sql(f"SELECT resync_count FROM public.hours_mail_folders "
                             f"WHERE id={literal(folder)};"), "1")
        # The full pass re-observes exactly the same message.
        again = self.observe(folder)
        self.assertEqual(again["added"], 0)
        self.assertEqual(again["seen_again"], 1)
        self.assertEqual(sql(f"SELECT count(*) FROM public.hours_mail_messages WHERE organization_id={literal(self.org)};"), "1")

    # --- stable identity ---------------------------------------------------

    def test_the_same_message_twice_is_one_row_and_one_claim(self):
        self.open_week()
        folder = self.folder_id(self.follow())
        self.assertEqual(self.observe(folder)["added"], 1)
        self.assertEqual(self.observe(folder)["added"], 0)
        self.assertEqual(sql(f"SELECT count(*) FROM public.hours_mail_messages WHERE organization_id={literal(self.org)};"), "1")
        self.assertEqual(len(self.claim(folder)["messages"]), 1)
        self.assertEqual(self.claim(folder)["messages"], [], "A claimed message is not handed out twice")

    def test_a_moved_message_keeps_its_identity_and_updates_its_graph_id(self):
        """Graph renumbers a moved message; the RFC Message-ID does not move."""
        self.open_week()
        folder = self.folder_id(self.follow())
        self.observe(folder, graph="AAMkBeforeMove")
        moved = self.observe(folder, graph="AAMkAfterMove")
        self.assertEqual(moved["added"], 0)
        self.assertEqual(sql(f"SELECT count(*) FROM public.hours_mail_messages WHERE organization_id={literal(self.org)};"), "1")
        self.assertEqual(sql(f"SELECT graph_message_id FROM public.hours_mail_messages WHERE organization_id={literal(self.org)};"), "AAMkAfterMove")

    def test_a_message_without_identity_is_refused_rather_than_guessed(self):
        self.open_week()
        folder = self.folder_id(self.follow())
        self.reject("hours_mail_record_messages", code="22023", role="service_role", user=None,
                    p_folder_row_id=folder,
                    p_messages=[{"graph_message_id": "AAMk", "subject": "leeg"}], p_removed=text_array(None))
        self.assertEqual(sql(f"SELECT count(*) FROM public.hours_mail_messages WHERE organization_id={literal(self.org)};"), "0")

    def test_a_removed_message_stops_before_it_starts(self):
        self.open_week()
        folder = self.folder_id(self.follow())
        self.observe(folder, graph="AAMkGone")
        removed = self.observe(folder, key="<msg-2@example.invalid>", graph="AAMkOther",
                               removed=["AAMkGone"])
        self.assertEqual(removed["removed"], 1)
        self.assertEqual(sql(f"SELECT status || '/' || coalesce(reason_code,'') "
                             f"FROM public.hours_mail_messages WHERE graph_message_id='AAMkGone' "
                             f"AND organization_id={literal(self.org)};"),
                         "dismissed/verdwenen")
        self.assertEqual(self.claim(folder)["messages"][0]["graph_message_id"], "AAMkOther")

    def test_a_filed_message_keeps_its_source_when_the_mailbox_deletes_it(self):
        """A delivery that really happened is not undone by a later mailbox change."""
        folder, _, code, token, message = self.prepare_claimed()
        rpc("hours_mail_match_message", role="service_role", p_message_id=message,
            p_claim_token=token, p_codes=text_array([code]), p_reply_ids=text_array(None), p_conversation_id=None)
        rpc("hours_mail_file_message", role="service_role", p_message_id=message, p_claim_token=token,
            p_source=self.stored_file(), p_attachments=[], p_proposals=[])
        self.observe(folder, removed=["AAMkGraph1"])
        row = json.loads(sql(f"SELECT jsonb_build_object('status',status,'source',source_id is not null) "
                             f"FROM public.hours_mail_messages WHERE organization_id={literal(self.org)};"))
        self.assertEqual(row["status"], "filed")
        self.assertTrue(row["source"])
        self.assertIn("42501", sql(f"UPDATE public.hours_mail_messages SET status='pending' "
                                   f"WHERE organization_id={literal(self.org)};", expect_error=True))

    # --- the queue ---------------------------------------------------------

    def test_an_expired_lease_returns_the_message_with_its_attempt_counted(self):
        self.open_week()
        folder = self.folder_id(self.follow())
        self.observe(folder)
        first = self.claim(folder, lease=30)
        self.assertEqual(sql(f"SELECT attempt_count FROM public.hours_mail_messages WHERE organization_id={literal(self.org)};"), "1")
        sql(f"UPDATE public.hours_mail_messages SET lease_expires_at = now() - interval '1 minute' "
            f"WHERE organization_id={literal(self.org)} AND status='processing';")
        second = self.claim(folder)
        self.assertEqual(len(second["messages"]), 1)
        self.assertNotEqual(second["claim_token"], first["claim_token"])
        self.assertEqual(sql(f"SELECT attempt_count FROM public.hours_mail_messages WHERE organization_id={literal(self.org)};"), "2")

    def test_a_stale_claim_can_no_longer_finish_the_message(self):
        self.open_week()
        folder = self.folder_id(self.follow())
        self.observe(folder)
        stale = self.claim(folder)
        message = stale["messages"][0]["id"]
        sql(f"UPDATE public.hours_mail_messages SET lease_expires_at = now() - interval '1 minute' "
            f"WHERE organization_id={literal(self.org)} AND status='processing';")
        self.claim(folder)
        self.reject("hours_mail_fail_message", code="22023", role="service_role", user=None,
                    p_message_id=message, p_claim_token=stale["claim_token"],
                    p_status="needs_attention", p_reason_code="geen_uitvraag", p_reason_note=None)

    def test_renewals_are_bounded(self):
        self.open_week()
        folder = self.folder_id(self.follow())
        self.observe(folder)
        claimed = self.claim(folder)
        message, token = claimed["messages"][0]["id"], claimed["claim_token"]
        for expected in (2, 1, 0):
            result = rpc("hours_mail_renew_lease", role="service_role", p_message_id=message,
                         p_claim_token=token, p_lease_seconds=300)
            self.assertEqual(result["renewals_left"], expected)
        self.reject("hours_mail_renew_lease", code="22023", role="service_role", user=None,
                    p_message_id=message, p_claim_token=token, p_lease_seconds=300)

    def test_a_message_that_keeps_failing_lands_in_the_control_bin(self):
        self.open_week()
        folder = self.folder_id(self.follow())
        self.observe(folder)
        for _ in range(5):
            self.claim(folder)
            sql(f"UPDATE public.hours_mail_messages SET lease_expires_at = now() - interval '1 minute' "
            f"WHERE organization_id={literal(self.org)} AND status='processing';")
        self.assertEqual(self.claim(folder)["messages"], [])
        self.assertEqual(sql(f"SELECT status || '/' || reason_code FROM public.hours_mail_messages WHERE organization_id={literal(self.org)};"),
                         "needs_attention/te_vaak_geprobeerd")

    def test_releasing_a_claim_costs_nothing_extra(self):
        self.open_week()
        folder = self.folder_id(self.follow())
        self.observe(folder)
        claimed = self.claim(folder)
        rpc("hours_mail_release_message", role="service_role",
            p_message_id=claimed["messages"][0]["id"], p_claim_token=claimed["claim_token"])
        self.assertEqual(sql(f"SELECT status FROM public.hours_mail_messages WHERE organization_id={literal(self.org)};"), "pending")
        self.assertEqual(len(self.claim(folder)["messages"]), 1)

    # --- the coupling ------------------------------------------------------

    def test_a_reference_plus_a_known_sender_resolves_to_the_week(self):
        _, request_id, code, token, message = self.prepare_claimed()
        matched = rpc("hours_mail_match_message", role="service_role", p_message_id=message,
                      p_claim_token=token, p_codes=text_array([code.lower()]), p_reply_ids=text_array(None),
                      p_conversation_id=None)
        self.assertTrue(matched["ok"])
        self.assertEqual(matched["week_id"], self.week_id)
        self.assertEqual(matched["request_id"], request_id)
        self.assertEqual(len(matched["context"]["days"]), 7)
        self.assertEqual([m["name"] for m in matched["context"]["members"]],
                         [m["candidate_name"] for m in self.view(self.week_id)["members"]])

    def test_no_reference_at_all_goes_to_the_control_bin(self):
        _, _, _, token, message = self.prepare_claimed()
        matched = rpc("hours_mail_match_message", role="service_role", p_message_id=message,
                      p_claim_token=token, p_codes=text_array(None), p_reply_ids=text_array(None), p_conversation_id=None)
        self.assertFalse(matched["ok"])
        self.assertEqual(matched["reason_code"], "geen_uitvraag")

    def test_two_different_references_are_a_contradiction_not_a_choice(self):
        _, _, code, token, message = self.prepare_claimed()
        _, other = self.request(label="Tweede")
        matched = rpc("hours_mail_match_message", role="service_role", p_message_id=message,
                      p_claim_token=token, p_codes=text_array([code, other]), p_reply_ids=text_array(None),
                      p_conversation_id=None)
        self.assertEqual(matched["reason_code"], "dubbele_uitvraag")

    def test_the_same_reference_twice_is_not_a_contradiction(self):
        _, _, code, token, message = self.prepare_claimed()
        matched = rpc("hours_mail_match_message", role="service_role", p_message_id=message,
                      p_claim_token=token, p_codes=text_array([code, code.lower()]), p_reply_ids=text_array(None),
                      p_conversation_id=None)
        self.assertTrue(matched["ok"])

    def test_an_unknown_reference_says_so(self):
        _, _, _, token, message = self.prepare_claimed()
        matched = rpc("hours_mail_match_message", role="service_role", p_message_id=message,
                      p_claim_token=token, p_codes=text_array(["UR-2222-3333"]), p_reply_ids=text_array(None),
                      p_conversation_id=None)
        self.assertEqual(matched["reason_code"], "onbekende_uitvraag")

    def test_a_withdrawn_or_expired_request_no_longer_accepts_replies(self):
        _, request_id, code, token, message = self.prepare_claimed()
        rpc("hours_revoke_week_request", user=self.admin, p_request_id=request_id, p_note=None)
        matched = rpc("hours_mail_match_message", role="service_role", p_message_id=message,
                      p_claim_token=token, p_codes=text_array([code]), p_reply_ids=text_array(None), p_conversation_id=None)
        self.assertEqual(matched["reason_code"], "uitvraag_gesloten")

    def test_an_unknown_sender_never_files_even_with_a_valid_reference(self):
        _, _, code, token, message = self.prepare_claimed(sender="vreemde@elders.invalid", contact=False)
        matched = rpc("hours_mail_match_message", role="service_role", p_message_id=message,
                      p_claim_token=token, p_codes=text_array([code]), p_reply_ids=text_array(None), p_conversation_id=None)
        self.assertEqual(matched["reason_code"], "onbekende_afzender")

    def test_a_sender_of_another_client_is_a_contradiction(self):
        self.open_week()
        folder = self.folder_id(self.follow())
        _, code = self.request()
        self.contact("planner@anderbedrijf.invalid", company=self.second_company())
        self.observe(folder, sender="planner@anderbedrijf.invalid")
        claimed = self.claim(folder)
        matched = rpc("hours_mail_match_message", role="service_role",
                      p_message_id=claimed["messages"][0]["id"], p_claim_token=claimed["claim_token"],
                      p_codes=text_array([code]), p_reply_ids=text_array(None), p_conversation_id=None)
        self.assertEqual(matched["reason_code"], "tegenstrijdige_koppeling")

    def second_company(self):
        identifier = str(uuid.uuid4())
        sql(f"""INSERT INTO public.companies(id,organization_id,name)
          VALUES ({literal(identifier)},{literal(self.org)},'Tweede QA-opdrachtgever');""")
        return identifier

    def test_the_company_mail_address_counts_as_a_known_sender(self):
        self.open_week()
        sql(f"UPDATE public.companies SET email='administratie@klant.invalid' "
            f"WHERE id={literal(self.company)};")
        folder = self.folder_id(self.follow())
        _, code = self.request()
        self.observe(folder, sender="Administratie@Klant.Invalid")
        claimed = self.claim(folder)
        matched = rpc("hours_mail_match_message", role="service_role",
                      p_message_id=claimed["messages"][0]["id"], p_claim_token=claimed["claim_token"],
                      p_codes=text_array([code]), p_reply_ids=text_array(None), p_conversation_id=None)
        self.assertTrue(matched["ok"])

    def test_the_reply_chain_resolves_once_the_outbox_has_filled_it(self):
        _, request_id, _, token, message = self.prepare_claimed()
        sql(f"""UPDATE public.hours_week_requests SET outbound_message_id='<uitvraag-1@ja.invalid>',
          sent_at=now() WHERE id={literal(request_id)};""")
        matched = rpc("hours_mail_match_message", role="service_role", p_message_id=message,
                      p_claim_token=token, p_codes=text_array(None),
                      p_reply_ids=text_array(["<ander@x.invalid>", "<UITVRAAG-1@ja.invalid>"]),
                      p_conversation_id=None)
        self.assertTrue(matched["ok"])
        self.assertEqual(matched["request_id"], request_id)

    def test_the_conversation_is_the_last_net(self):
        _, request_id, _, token, message = self.prepare_claimed()
        sql(f"""UPDATE public.hours_week_requests SET conversation_id='conv-9', sent_at=now()
          WHERE id={literal(request_id)};""")
        matched = rpc("hours_mail_match_message", role="service_role", p_message_id=message,
                      p_claim_token=token, p_codes=text_array(None), p_reply_ids=text_array(None), p_conversation_id="conv-9")
        self.assertTrue(matched["ok"])

    def test_a_hand_assignment_beats_every_mechanism(self):
        folder, _, _, token, message = self.prepare_claimed(sender="vreemde@elders.invalid",
                                                            contact=False)
        rpc("hours_mail_fail_message", role="service_role", p_message_id=message, p_claim_token=token,
            p_status="needs_attention", p_reason_code="onbekende_afzender", p_reason_note=None)
        overview = rpc("hours_mail_assign_message", user=self.admin, p_message_id=message,
                       p_week_id=self.week_id, p_note="Dit is de week van Kowalski")
        self.assertEqual(overview["attention"], [])
        claimed = self.claim(folder)
        matched = rpc("hours_mail_match_message", role="service_role", p_message_id=message,
                      p_claim_token=claimed["claim_token"], p_codes=text_array(None), p_reply_ids=text_array(None),
                      p_conversation_id=None)
        self.assertTrue(matched["ok"], "A person who looked overrules the reference")
        self.assertEqual(matched["week_id"], self.week_id)

    def test_a_closed_client_blocks_the_coupling(self):
        _, _, code, token, message = self.prepare_claimed()
        self.settings(p_enabled=False)
        matched = rpc("hours_mail_match_message", role="service_role", p_message_id=message,
                      p_claim_token=token, p_codes=text_array([code]), p_reply_ids=text_array(None), p_conversation_id=None)
        self.assertEqual(matched["reason_code"], "week_gesloten")

    # --- filing ------------------------------------------------------------

    def matched_message(self, sender="planner@klant.invalid"):
        folder, request_id, code, token, message = self.prepare_claimed(sender=sender)
        rpc("hours_mail_match_message", role="service_role", p_message_id=message,
            p_claim_token=token, p_codes=text_array([code]), p_reply_ids=text_array(None), p_conversation_id=None)
        return folder, request_id, token, message

    def test_filing_lands_the_message_as_a_source_with_proposals(self):
        _, request_id, token, message = self.matched_message()
        week = self.view(self.week_id)
        day = week["members"][0]["days"][0]
        filed = rpc("hours_mail_file_message", role="service_role", p_message_id=message,
                    p_claim_token=token, p_source=self.stored_file(name="RE uren.eml"),
                    p_attachments=[],
                    p_proposals=[{"day_id": day["id"], "minutes": 480, "no_hours_reason": None,
                                  "note": None, "source_input": None, "page_label": "regel 3",
                                  "page_number": 1, "assignment_uncertain": False}])
        self.assertTrue(filed["ok"])
        self.assertEqual(filed["proposals"], 1)
        projection = rpc("hours_get_week_sources", user=self.admin, p_week_id=self.week_id)
        source = self.source_named(projection, "RE uren.eml")
        self.assertEqual(source["mail_message_id"], message)
        self.assertEqual(source["mail_from"], "planner@klant.invalid")
        self.assertEqual(source["page_count"], 1, "A message is always one page")
        self.assertEqual(len(source["proposals"]), 1)
        self.assertEqual(projection["requests"][0]["received"], 1)
        # The boundary: a proposal is not a day version.
        self.assertIsNone(self.revision_of(self.week_id, day["id"]))
        self.assertEqual(sql(f"SELECT count(*) FROM public.hours_day_revisions WHERE organization_id={literal(self.org)};"), "0")

    def test_a_mailed_source_has_no_internal_author_and_no_client_link(self):
        _, _, token, message = self.matched_message()
        rpc("hours_mail_file_message", role="service_role", p_message_id=message, p_claim_token=token,
            p_source=self.stored_file(), p_attachments=[], p_proposals=[])
        row = json.loads(sql(f"SELECT jsonb_build_object('by',created_by,'link',client_link_id,"
                             f"'mail',mail_message_id) FROM public.hours_week_sources "
                             f"WHERE mail_message_id IS NOT NULL "
                             f"AND organization_id={literal(self.org)};"))
        self.assertIsNone(row["by"])
        self.assertIsNone(row["link"])
        self.assertEqual(row["mail"], message)

    def test_a_message_and_its_attachments_are_one_receipt(self):
        _, _, token, message = self.matched_message()
        rpc("hours_mail_file_message", role="service_role", p_message_id=message, p_claim_token=token,
            p_source=self.stored_file(name="RE uren.eml"),
            p_attachments=[self.stored_file(extension="xlsx", mimetype=XLSX, name="week37.xlsx")],
            p_proposals=[])
        projection = rpc("hours_get_week_sources", user=self.admin, p_week_id=self.week_id)
        receipt = self.source_named(projection, "RE uren.eml")
        attachment = self.source_named(projection, "week37.xlsx")
        self.assertEqual(attachment["received_with_source_id"], receipt["id"])
        self.assertEqual(attachment["mail_message_id"], message)
        self.assertIsNone(attachment["page_count"],
                          "Nothing counted the pages of a mailed attachment, so it stays unknown")

    def test_an_attachment_that_is_itself_a_message_is_refused(self):
        _, _, token, message = self.matched_message()
        self.reject("hours_mail_file_message", code="22023", role="service_role", user=None,
                    p_message_id=message, p_claim_token=token, p_source=self.stored_file(),
                    p_attachments=[self.stored_file(name="doorgestuurd.eml")], p_proposals=[])
        self.assertEqual(sql(f"SELECT count(*) FROM public.hours_week_sources WHERE organization_id={literal(self.org)};"), "0",
                         "Filing is one transaction: a refused attachment leaves nothing behind")

    def test_one_bad_proposal_leaves_nothing_behind(self):
        _, _, token, message = self.matched_message()
        week = self.view(self.week_id)
        days = week["members"][0]["days"]
        self.reject("hours_mail_file_message", code="22023", role="service_role", user=None,
                    p_message_id=message, p_claim_token=token, p_source=self.stored_file(),
                    p_attachments=[],
                    p_proposals=[{"day_id": days[0]["id"], "minutes": 480, "no_hours_reason": None,
                                  "note": None, "source_input": None, "page_label": None,
                                  "page_number": 1, "assignment_uncertain": False},
                                 {"day_id": days[1]["id"], "minutes": 0, "no_hours_reason": None,
                                  "note": None, "source_input": None, "page_label": None,
                                  "page_number": 1, "assignment_uncertain": False}])
        self.assertEqual(sql(f"SELECT count(*) FROM public.hours_week_sources WHERE organization_id={literal(self.org)};"), "0")
        self.assertEqual(sql(f"SELECT count(*) FROM public.hours_source_proposals WHERE organization_id={literal(self.org)};"), "0")
        self.assertEqual(sql(f"SELECT status FROM public.hours_mail_messages WHERE organization_id={literal(self.org)};"), "processing")

    def test_a_day_of_another_week_is_refused(self):
        _, _, token, message = self.matched_message()
        self.add_placement(start="2026-09-14", end="2026-09-20")
        other = self.week("2026-09-14")
        stranger = other["members"][0]["days"][0]
        self.reject("hours_mail_file_message", code="42501", role="service_role", user=None,
                    p_message_id=message, p_claim_token=token, p_source=self.stored_file(),
                    p_attachments=[],
                    p_proposals=[{"day_id": stranger["id"], "minutes": 480, "no_hours_reason": None,
                                  "note": None, "source_input": None, "page_label": None,
                                  "page_number": 1, "assignment_uncertain": False}])

    def test_filing_without_a_coupling_is_refused(self):
        self.open_week()
        folder = self.folder_id(self.follow())
        self.observe(folder)
        claimed = self.claim(folder)
        self.reject("hours_mail_file_message", code="22023", role="service_role", user=None,
                    p_message_id=claimed["messages"][0]["id"], p_claim_token=claimed["claim_token"],
                    p_source=self.stored_file(), p_attachments=[], p_proposals=[])

    def test_a_source_without_a_stored_object_is_refused(self):
        _, _, token, message = self.matched_message()
        self.reject("hours_mail_file_message", code="22023", role="service_role", user=None,
                    p_message_id=message, p_claim_token=token,
                    p_source={"content_hash": digest("never-uploaded"), "file_name": "spook.eml",
                              "content_type": EML, "page_count": 1},
                    p_attachments=[], p_proposals=[])

    def test_the_receipt_itself_must_be_the_message(self):
        _, _, token, message = self.matched_message()
        self.reject("hours_mail_file_message", code="22023", role="service_role", user=None,
                    p_message_id=message, p_claim_token=token,
                    p_source=self.stored_file(extension="xlsx", mimetype=XLSX, name="los.xlsx"),
                    p_attachments=[], p_proposals=[])

    def test_applying_a_mailed_proposal_still_needs_an_internal_user(self):
        _, _, token, message = self.matched_message()
        week = self.view(self.week_id)
        day = week["members"][0]["days"][0]
        rpc("hours_mail_file_message", role="service_role", p_message_id=message, p_claim_token=token,
            p_source=self.stored_file(), p_attachments=[],
            p_proposals=[{"day_id": day["id"], "minutes": 450, "no_hours_reason": None, "note": None,
                          "source_input": None, "page_label": "regel 2", "page_number": 1,
                          "assignment_uncertain": False}])
        projection = rpc("hours_get_week_sources", user=self.admin, p_week_id=self.week_id)
        proposal = projection["sources"][0]["proposals"][0]
        self.assertIn("42501", sql(f"SELECT public.hours_apply_source_proposal("
                                   f"{literal(proposal['id'])},null);", role="service_role",
                                   expect_error=True))
        applied = rpc("hours_apply_source_proposal", user=self.admin, p_proposal_id=proposal["id"],
                      p_expected_revision_id=None)
        self.assertTrue(applied["applied_created_revision"])
        revision = self.revision_of(self.week_id, day["id"])
        self.assertEqual(revision["minutes"], 450, "The proposal is applied literally")
        self.assertEqual([ref["kind"] for ref in revision["source_references"]], ["upload"])

    # --- the control bin ---------------------------------------------------

    def test_a_failed_message_is_named_in_the_control_bin(self):
        _, _, _, token, message = self.prepare_claimed()
        rpc("hours_mail_fail_message", role="service_role", p_message_id=message, p_claim_token=token,
            p_status="needs_attention", p_reason_code="geen_uitvraag", p_reason_note=None)
        overview = rpc("hours_mail_overview", user=self.admin)
        self.assertEqual(len(overview["attention"]), 1)
        self.assertEqual(overview["attention"][0]["reason_code"], "geen_uitvraag")
        self.assertEqual(overview["attention"][0]["from_address"], "planner@klant.invalid")
        self.assertEqual(sql(f"SELECT count(*) FROM public.hours_week_sources WHERE organization_id={literal(self.org)};"), "0")

    def test_an_unknown_reason_is_refused(self):
        _, _, _, token, message = self.prepare_claimed()
        self.reject("hours_mail_fail_message", code="23514", role="service_role", user=None,
                    p_message_id=message, p_claim_token=token, p_status="needs_attention",
                    p_reason_code="omdat_het_kan", p_reason_note=None)

    def test_dismissing_takes_it_off_the_list_without_deleting(self):
        _, _, _, token, message = self.prepare_claimed()
        rpc("hours_mail_fail_message", role="service_role", p_message_id=message, p_claim_token=token,
            p_status="needs_attention", p_reason_code="onbekende_afzender", p_reason_note=None)
        overview = rpc("hours_mail_dismiss_message", user=self.admin, p_message_id=message,
                       p_note="Nieuwsbrief")
        self.assertEqual(overview["attention"], [])
        self.assertEqual(sql(f"SELECT status || '/' || reason_code FROM public.hours_mail_messages WHERE organization_id={literal(self.org)};"),
                         "dismissed/handmatig_afgehandeld")

    def test_the_control_bin_is_tenant_scoped(self):
        _, _, _, token, message = self.prepare_claimed()
        rpc("hours_mail_fail_message", role="service_role", p_message_id=message, p_claim_token=token,
            p_status="needs_attention", p_reason_code="geen_uitvraag", p_reason_note=None)
        self.assertEqual(rpc("hours_mail_overview", user=self.other_admin)["attention"], [])
        self.reject("hours_mail_dismiss_message", code="42501", user=self.other_admin,
                    p_message_id=message, p_note=None)

    def test_the_portal_sees_no_mail_at_all(self):
        _, _, _, token, message = self.prepare_claimed()
        rpc("hours_mail_fail_message", role="service_role", p_message_id=message, p_claim_token=token,
            p_status="needs_attention", p_reason_code="geen_uitvraag", p_reason_note=None)
        for table in ("hours_week_requests", "hours_mail_folders", "hours_mail_messages"):
            self.assertEqual(sql(f"SELECT count(*) FROM public.{table};",
                                 role="authenticated", user=self.worker), "0", table)
        self.reject("hours_mail_overview", code="42501", user=self.worker)

    def test_a_read_only_user_cannot_change_anything(self):
        self.open_week()
        viewer = str(uuid.uuid4())
        sql(f"""INSERT INTO auth.users(id) VALUES({literal(viewer)});
          INSERT INTO public.profiles(id,organization_id,role) VALUES
            ({literal(viewer)},{literal(self.org)},'finance');
          UPDATE public.organizations SET settings=jsonb_build_object('role_permissions',
            jsonb_build_object('finance', jsonb_build_array('finance.view')))
            WHERE id={literal(self.org)};""")
        rpc("hours_mail_overview", user=viewer)
        self.reject("hours_mail_set_folder", code="42501", user=viewer,
                    p_mail_account_id=self.mailbox(), p_folder_id="inbox",
                    p_folder_label="Postvak IN", p_enabled=True)
        self.reject("hours_issue_week_request", code="42501", user=viewer, p_week_id=self.week_id,
                    p_label=None, p_valid_days=30)

    # --- the unattended run's own gate -------------------------------------

    def test_due_folders_only_names_switched_on_organisations(self):
        self.open_week()
        self.follow()
        mine = lambda: rpc("hours_mail_due_folders", role="service_role", p_limit=100,
                           p_organization_id=self.org)
        self.assertEqual(len(mine()), 1)
        gate.toggle(self.org, False)
        self.assertEqual(mine(), [], "A switched-off organisation is simply not polled")

    def test_a_switched_off_module_closes_every_service_route(self):
        folder, _, _, token, message = self.prepare_claimed()
        gate.toggle(self.org, False)
        for name, params in (
            ("hours_mail_record_messages", dict(p_folder_row_id=folder, p_messages=[], p_removed=text_array(None))),
            ("hours_mail_set_cursor", dict(p_folder_row_id=folder, p_delta_link=GRAPH,
                                           p_resynced=False, p_error=None)),
            ("hours_mail_clear_cursor", dict(p_folder_row_id=folder)),
            ("hours_mail_claim_messages", dict(p_folder_row_id=folder, p_limit=5, p_lease_seconds=300)),
            ("hours_mail_renew_lease", dict(p_message_id=message, p_claim_token=token,
                                            p_lease_seconds=300)),
            ("hours_mail_match_message", dict(p_message_id=message, p_claim_token=token, p_codes=text_array(None),
                                              p_reply_ids=text_array(None), p_conversation_id=None)),
            ("hours_mail_file_message", dict(p_message_id=message, p_claim_token=token,
                                             p_source={}, p_attachments=[], p_proposals=[])),
            ("hours_mail_fail_message", dict(p_message_id=message, p_claim_token=token,
                                             p_status="needs_attention",
                                             p_reason_code="geen_uitvraag", p_reason_note=None)),
            ("hours_mail_release_message", dict(p_message_id=message, p_claim_token=token)),
        ):
            with self.subTest(rpc=name):
                self.reject(name, code="42501", role="service_role", user=None, **params)

    def test_no_service_key_shortcut_into_the_office_routes(self):
        self.open_week()
        for name, params in (
            ("hours_issue_week_request", dict(p_week_id=self.week_id, p_label=None, p_valid_days=30)),
            ("hours_mail_overview", {}),
            ("hours_mail_set_folder", dict(p_mail_account_id=self.mailbox(), p_folder_id="inbox",
                                           p_folder_label="Postvak IN", p_enabled=True)),
        ):
            with self.subTest(rpc=name):
                self.reject(name, code="42501", role="service_role", user=None, **params)

    # --- findings from the first review round ------------------------------

    def test_following_a_folder_needs_a_read_right_on_that_mailbox(self):
        """The access table is leading: a finance role is not a mailbox key."""
        self.open_week()
        account = self.mailbox(grant_to=False)
        self.reject("hours_mail_set_folder", code="42501", user=self.admin,
                    p_mail_account_id=account, p_folder_id="inbox", p_folder_label="Postvak IN",
                    p_enabled=True)
        self.grant(account)
        rpc("hours_mail_set_folder", user=self.admin, p_mail_account_id=account,
            p_folder_id="inbox", p_folder_label="Postvak IN", p_enabled=True)

    def test_a_read_right_that_is_switched_off_is_not_a_read_right(self):
        self.open_week()
        account = self.mailbox(grant_to=False)
        self.grant(account, read=False)
        self.reject("hours_mail_set_folder", code="42501", user=self.admin,
                    p_mail_account_id=account, p_folder_id="inbox", p_folder_label="Postvak IN",
                    p_enabled=True)

    def test_a_personal_mailbox_is_never_followed(self):
        """Somebody's own mailbox is not the office's intake, even with a grant."""
        self.open_week()
        personal = self.mailbox(scope="personal", owner=self.admin)
        self.reject("hours_mail_set_folder", code="22023", user=self.admin,
                    p_mail_account_id=personal, p_folder_id="inbox", p_folder_label="Postvak IN",
                    p_enabled=True)

    def test_the_listing_can_be_asked_for_one_organisation(self):
        self.open_week()
        self.follow()
        mine = rpc("hours_mail_due_folders", role="service_role", p_limit=25,
                   p_organization_id=self.org)
        self.assertEqual([folder["organization_id"] for folder in mine], [self.org])
        self.assertEqual(rpc("hours_mail_due_folders", role="service_role", p_limit=25,
                             p_organization_id=self.other_org), [])

    def test_the_least_recently_run_folder_comes_first(self):
        """Ordering by creation starves every folder past the bound; a run has to
        reach the one that waited longest."""
        self.open_week()
        first = self.folder_id(self.follow(folder="map-een", label="Een"))
        second = self.folder_id(self.follow(folder="map-twee", label="Twee"), index=1)
        rpc("hours_mail_set_cursor", role="service_role", p_folder_row_id=first,
            p_delta_link=GRAPH, p_resynced=False, p_error=None)
        order = [folder["id"] for folder in rpc("hours_mail_due_folders", role="service_role",
                                                p_limit=25, p_organization_id=self.org)]
        self.assertEqual(order, [second, first], "A folder that never ran comes before one that did")
        rpc("hours_mail_set_cursor", role="service_role", p_folder_row_id=second,
            p_delta_link=GRAPH, p_resynced=False, p_error=None)
        rpc("hours_mail_set_cursor", role="service_role", p_folder_row_id=first,
            p_delta_link=GRAPH, p_resynced=False, p_error=None)
        order = [folder["id"] for folder in rpc("hours_mail_due_folders", role="service_role",
                                                p_limit=25, p_organization_id=self.org)]
        self.assertEqual(order, [second, first], "The one that ran longest ago comes first")

    def test_a_read_doubt_travels_with_a_mailed_proposal_and_blocks_applying(self):
        """The same contradiction must block on every route, or one route writes
        an unclassifiable day revision while the other refuses."""
        _, _, token, message = self.matched_message()
        week = self.view(self.week_id)
        day = week["members"][0]["days"][0]
        rpc("hours_mail_file_message", role="service_role", p_message_id=message, p_claim_token=token,
            p_source=self.stored_file(), p_attachments=[],
            p_proposals=[{"day_id": day["id"], "minutes": 480, "no_hours_reason": None, "note": None,
                          "source_input": None, "page_label": "regel 1", "page_number": 1,
                          "assignment_uncertain": False, "uncertain_fields": ["total"]}])
        projection = rpc("hours_get_week_sources", user=self.admin, p_week_id=self.week_id)
        proposal = projection["sources"][0]["proposals"][0]
        self.assertEqual(proposal["uncertain_fields"], ["total"])
        self.assertEqual(projection["uncertain_values"], 1)
        self.reject("hours_apply_source_proposal", code="22023", user=self.admin,
                    p_proposal_id=proposal["id"], p_expected_revision_id=None)
        rpc("hours_confirm_proposal_values", user=self.admin, p_proposal_id=proposal["id"],
            p_note="Nagekeken op het briefje")
        rpc("hours_apply_source_proposal", user=self.admin, p_proposal_id=proposal["id"],
            p_expected_revision_id=None)

    def test_an_unknown_doubt_label_is_refused_rather_than_dropped(self):
        _, _, token, message = self.matched_message()
        day = self.view(self.week_id)["members"][0]["days"][0]
        self.reject("hours_mail_file_message", code="22023", role="service_role", user=None,
                    p_message_id=message, p_claim_token=token, p_source=self.stored_file(),
                    p_attachments=[],
                    p_proposals=[{"day_id": day["id"], "minutes": 480, "no_hours_reason": None,
                                  "note": None, "source_input": None, "page_label": None,
                                  "page_number": 1, "assignment_uncertain": False,
                                  "uncertain_fields": ["verzonnen"]}])

    def test_a_message_that_comes_back_is_picked_up_again(self):
        """Gone and back is the same message, and nothing was written for it."""
        self.open_week()
        folder = self.folder_id(self.follow())
        self.observe(folder)
        self.observe(folder, key="<msg-2@example.invalid>", graph="AAMkOther",
                     removed=["AAMkGraph1"])
        self.assertEqual(sql(f"SELECT status FROM public.hours_mail_messages "
                             f"WHERE graph_message_id='AAMkGraph1' "
                             f"AND organization_id={literal(self.org)};"), "dismissed")
        # Somebody put it back in the followed folder; Graph reports it as added.
        self.observe(folder, graph="AAMkGraph1")
        self.assertEqual(sql(f"SELECT status FROM public.hours_mail_messages "
                             f"WHERE graph_message_id='AAMkGraph1' "
                             f"AND organization_id={literal(self.org)};"), "pending")
        claimed = [m["graph_message_id"] for m in self.claim(folder)["messages"]]
        self.assertIn("AAMkGraph1", claimed)

    def test_a_decision_of_a_person_is_not_undone_by_the_mailbox(self):
        """Only the mailbox's own 'gone' is revived; a human's dismissal stands."""
        _, _, _, token, message = self.prepare_claimed()
        rpc("hours_mail_fail_message", role="service_role", p_message_id=message, p_claim_token=token,
            p_status="needs_attention", p_reason_code="onbekende_afzender", p_reason_note=None)
        rpc("hours_mail_dismiss_message", user=self.admin, p_message_id=message, p_note="Nieuwsbrief")
        folder = self.folder_id()
        self.observe(folder)
        self.assertEqual(sql(f"SELECT status || '/' || reason_code FROM public.hours_mail_messages "
                             f"WHERE organization_id={literal(self.org)};"),
                         "dismissed/handmatig_afgehandeld")

    def test_a_filed_message_is_never_revived_by_the_mailbox(self):
        _, _, token, message = self.matched_message()
        rpc("hours_mail_file_message", role="service_role", p_message_id=message, p_claim_token=token,
            p_source=self.stored_file(), p_attachments=[], p_proposals=[])
        folder = self.folder_id()
        self.observe(folder)
        self.assertEqual(sql(f"SELECT status FROM public.hours_mail_messages "
                             f"WHERE organization_id={literal(self.org)};"), "filed")

    def test_the_conversation_travels_with_the_message(self):
        """The fourth net can only work if the message carries its own thread id."""
        self.open_week()
        folder = self.folder_id(self.follow())
        self.observe(folder, conversation="AAQkGesprek")
        claimed = self.claim(folder)["messages"][0]
        self.assertEqual(claimed["conversation_id"], "AAQkGesprek")

    def test_the_conversation_is_the_last_net_end_to_end(self):
        self.open_week()
        folder = self.folder_id(self.follow())
        request_id, _ = self.request()
        self.contact("planner@klant.invalid")
        sql(f"""UPDATE public.hours_week_requests SET conversation_id='AAQkGesprek', sent_at=now()
          WHERE id={literal(request_id)};""")
        self.observe(folder, conversation="AAQkGesprek")
        claimed = self.claim(folder)
        matched = rpc("hours_mail_match_message", role="service_role",
                      p_message_id=claimed["messages"][0]["id"],
                      p_claim_token=claimed["claim_token"], p_codes=text_array(None),
                      p_reply_ids=text_array(None),
                      p_conversation_id=claimed["messages"][0]["conversation_id"])
        self.assertTrue(matched["ok"])
        self.assertEqual(matched["request_id"], request_id)

    def test_the_thread_of_a_message_never_moves(self):
        self.open_week()
        folder = self.folder_id(self.follow())
        self.observe(folder, conversation="AAQkGesprek")
        self.assertIn("42501", sql(f"UPDATE public.hours_mail_messages SET conversation_id='anders' "
                                   f"WHERE organization_id={literal(self.org)};", expect_error=True))


class MailFoundationRegression(wordmail.WordMailFoundationRegression):
    """The released foundation contract, unchanged on the mail-intake schema."""

    def test_rpc_and_private_helper_permissions_no_service_shortcut(self):
        MailIntakeTests.test_permission_contract_covers_the_new_functions(self)


class MailModuleGateTests(wordmail.WordMailModuleGateTests):
    """The released SaaS gate, widened with the sixteen new functions and three tables."""

    def prepare_all(self):
        day, calls = wordmail.WordMailModuleGateTests.prepare_all(self)
        week_id = day["week_id"]
        account = str(uuid.uuid4())
        sql(f"""INSERT INTO public.mail_accounts(id,organization_id,provider,scope,mailbox_mode,
          display_name,from_email,mailbox_email,mail_read_enabled,status)
          VALUES ({literal(account)},{literal(self.org)},'outlook','organization','user',
            'Gate-postbus','gate@example.invalid','gate@example.invalid',true,'connected');""")
        sql(f"""INSERT INTO public.mail_account_user_access(organization_id,mail_account_id,user_id,
          can_read_mail) VALUES ({literal(self.org)},{literal(account)},{literal(self.admin)},true);""")
        folder = rpc("hours_mail_set_folder", user=self.admin, p_mail_account_id=account,
                     p_folder_id="gate-inbox", p_folder_label="Postvak IN",
                     p_enabled=True)["folder_row_id"]
        request_id = rpc("hours_issue_week_request", user=self.admin, p_week_id=week_id,
                         p_label="Gate", p_valid_days=30)["request_id"]
        rpc("hours_mail_record_messages", role="service_role", p_folder_row_id=folder,
            p_messages=[{"message_key": "<gate@example.invalid>", "graph_message_id": "AAMkGate",
                         "internet_message_id": "<gate@example.invalid>", "subject": "gate",
                         "from_address": "gate@klant.invalid", "from_name": "Gate",
                         "received_at": "2026-09-14T08:00:00Z", "has_attachments": False}],
            p_removed=text_array(None))
        claimed = rpc("hours_mail_claim_messages", role="service_role", p_folder_row_id=folder,
                      p_limit=1, p_lease_seconds=300)
        message = claimed["messages"][0]["id"]
        token = claimed["claim_token"]
        rpc("hours_mail_fail_message", role="service_role", p_message_id=message,
            p_claim_token=token, p_status="needs_attention", p_reason_code="geen_uitvraag",
            p_reason_note=None)
        # The scan-reading log needs a real, running claim: the released gate case
        # passed a random identifier, which an unknown id refuses before it ever
        # reaches the module check — and left this table without a sample.
        marker = digest(f"gate-reading-{week_id}")
        sql(f"""INSERT INTO storage.objects(bucket_id,name,metadata) VALUES ('hours-sources',
          {literal(f"{self.org}/{week_id}/{marker}.jpg")},
          jsonb_build_object('size',2048,'mimetype','image/jpeg'));""")
        reading_source = rpc("hours_add_week_source", user=self.admin, p_week_id=week_id,
                             p_content_hash=marker, p_file_name="gate-reading.jpg",
                             p_content_type="image/jpeg")["source_id"]
        reading = rpc("hours_claim_source_reading", role="service_role",
                      p_source_id=reading_source, p_actor_id=self.admin)["reading_id"]
        calls["hours_claim_source_reading"] = dict(p_source_id=reading_source, p_actor_id=self.admin)
        calls["hours_finish_source_reading"] = dict(p_reading_id=reading, p_status="failed",
                                                    p_request_id=None, p_cost_cents=None,
                                                    p_lines=None, p_error_code="GATE")
        calls.update({
            "hours_issue_week_request": dict(p_week_id=week_id, p_label=None, p_valid_days=30),
            "hours_revoke_week_request": dict(p_request_id=request_id, p_note=None),
            "hours_mail_overview": {},
            "hours_mail_set_folder": dict(p_mail_account_id=account, p_folder_id="gate-inbox",
                                          p_folder_label="Postvak IN", p_enabled=True),
            "hours_mail_dismiss_message": dict(p_message_id=message, p_note=None),
            "hours_mail_assign_message": dict(p_message_id=message, p_week_id=week_id, p_note=None),
            "hours_mail_due_folders": dict(p_limit=25, p_organization_id=None),
            "hours_mail_record_messages": dict(p_folder_row_id=folder, p_messages=[], p_removed=text_array(None)),
            "hours_mail_set_cursor": dict(p_folder_row_id=folder, p_delta_link=GRAPH,
                                          p_resynced=False, p_error=None),
            "hours_mail_clear_cursor": dict(p_folder_row_id=folder),
            "hours_mail_claim_messages": dict(p_folder_row_id=folder, p_limit=1, p_lease_seconds=300),
            "hours_mail_renew_lease": dict(p_message_id=message, p_claim_token=token,
                                           p_lease_seconds=300),
            "hours_mail_match_message": dict(p_message_id=message, p_claim_token=token, p_codes=text_array(None),
                                             p_reply_ids=text_array(None), p_conversation_id=None),
            "hours_mail_file_message": dict(p_message_id=message, p_claim_token=token, p_source={},
                                            p_attachments=[], p_proposals=[]),
            "hours_mail_fail_message": dict(p_message_id=message, p_claim_token=token,
                                            p_status="needs_attention",
                                            p_reason_code="geen_uitvraag", p_reason_note=None),
            "hours_mail_release_message": dict(p_message_id=message, p_claim_token=token),
        })
        return day, calls

    def data_snapshot(self):
        return {table: json.loads(sql(f"SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), '[]') "
                                      f"FROM public.{table} t WHERE organization_id={literal(self.org)};"))
                for table in MAIL_TABLES}

    def test_all_eighteen_tables_hide_disabled_data_and_deny_direct_writes(self):
        raise unittest.SkipTest("Superseded by the twenty-two-table check that also covers mail intake")

    def test_all_twenty_two_tables_hide_disabled_data_and_deny_direct_writes(self):
        self.prepare_all()
        before = self.data_snapshot()
        self.assertEqual(len(before), 22)
        self.assertTrue(all(before.values()), "Every gated table must have a nonempty synthetic sample")
        gate.toggle(self.org, False)
        for table in MAIL_TABLES:
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

    def test_every_workflow_rpc_rejects_both_disabled_and_missing_flag(self):
        """The released sweep, with the one listing that empties instead of refusing.

        `hours_mail_due_folders` spans organisations by design: it is how the
        unattended run finds work at all. A switched-off organisation therefore
        has to disappear from its answer rather than make it raise, and that is
        exactly as closed — there is nothing to poll.
        """
        day, calls = self.prepare_all()
        actual = set(json.loads(sql("SELECT jsonb_agg(proname) FROM pg_proc p JOIN pg_namespace n "
                                    "ON n.oid=p.pronamespace WHERE n.nspname='public' AND proname LIKE 'hours_%' "
                                    "AND proname <> 'hours_get_module_access';")))
        self.assertEqual(set(calls), actual, "New workflow RPCs need an explicit gate test")
        before = self.data_snapshot()
        service_calls = (client.CLIENT_SERVICE_FUNCTIONS | MAIL_SERVICE_FUNCTIONS
                         | {"hours_finalize_day_classification", "hours_claim_source_reading",
                            "hours_finish_source_reading"})
        for state in ("disabled", "missing"):
            if state == "disabled":
                gate.toggle(self.org, False)
            else:
                sql(f"DELETE FROM public.organization_modules WHERE organization_id={literal(self.org)} "
                    "AND module_name='uren-workflow';", role="authenticated", user=gate.SA)
            for name, params in calls.items():
                with self.subTest(state=state, rpc=name):
                    if name == "hours_mail_due_folders":
                        # The container is shared across the class, so other
                        # tests' still-enabled folders legitimately show up here.
                        self.assertEqual(rpc(name, role="service_role", p_limit=25,
                                             p_organization_id=self.org), [])
                        continue
                    is_service = name in service_calls
                    actor = self.worker if name in {"hours_confirm_day", "hours_confirm_days"} else self.admin
                    code = "PT404" if name in client.CLIENT_SERVICE_FUNCTIONS else "42501"
                    self.reject(name, code=code, role="service_role" if is_service else "authenticated",
                                user=None if is_service else actor, **params)
            for name in ("hours_get_week", "hours_list_weeks"):
                self.reject(name, user=self.worker, **calls[name])
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
    )]
    fixtures = [ROOT / "tests/db/hours-workflow-fixture.sql", ROOT / "tests/db/hours-module-gate-fixture.sql",
                ROOT / "tests/db/hours-intake-fixture.sql", ROOT / "tests/db/hours-mail-intake-fixture.sql"]
    harnesses = [ROOT / "scripts" / name for name in (
        "hours-workflow-db-test.py", "hours-classification-db-test.py",
        "hours-module-gate-db-test.py", "hours-conflict-db-test.py", "hours-intake-db-test.py",
        "hours-pages-db-test.py", "hours-workbook-db-test.py", "hours-client-week-db-test.py",
        "hours-scan-db-test.py", "hours-word-mail-db-test.py", "hours-mail-intake-db-test.py")]
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
    classes = [MailIntakeTests] if args.new_only else [
        MailFoundationRegression, gate.EnabledClassificationRegression,
        MailModuleGateTests, MailIntakeTests]
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
        "run_command": "python3 scripts/hours-mail-intake-db-test.py" + (" --new-only" if args.new_only else ""),
        "output_directory": str(OUTPUT.resolve()),
    }
    OUTPUT.mkdir(parents=True, exist_ok=True)
    path = OUTPUT / "hours-mail-intake-db-qa-result.json"
    path.write_text(json.dumps(report, indent=2) + "\n")
    print("Result JSON:", path, flush=True)
    return 0 if report["success"] else 1


if __name__ == "__main__":
    sys.exit(main())
