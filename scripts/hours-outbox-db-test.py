#!/usr/bin/env python3
"""Real PostgreSQL tests for mail profiles, deadlines and the outbox (T8).

Runs the released hours migrations plus the new outbox migration in a
disposable container, then the full basis-replacement/mail-intake/word-mail/
scan/client-week/workbook/pages/intake/module-gate/classification/foundation
regressions on top, so the new outgoing route is proven to leave the released
behaviour intact. No production writes, providers, network or host mounts.
Run: python3 scripts/hours-outbox-db-test.py
Cleanup: python3 scripts/hours-outbox-db-test.py --cleanup
HOURS_OUTBOX_QA_OUTPUT selects a durable output directory.
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
OUTPUT = Path(os.environ.get("HOURS_OUTBOX_QA_OUTPUT", ROOT / "test-results/hours-outbox-db"))
# Import through the released basis-replacement harness so every earlier case
# runs against this schema unchanged; only the expectations that genuinely moved
# are overridden below, and each override says why.
spec = importlib.util.spec_from_file_location(
    "hours_basis_replacement_qa", ROOT / "scripts/hours-basis-replacement-db-test.py")
basis = importlib.util.module_from_spec(spec)
spec.loader.exec_module(basis)
mailintake = basis.mailintake
classification = basis.classification
client = basis.client
intake = basis.intake
gate = basis.gate
qa = basis.qa
qa.CONTAINER = "ja-works-hours-outbox-test-20260918"
qa.LABEL = "ja-werkt-hours-outbox-qa"
qa.LABEL_VALUE = "20260918"
sql, rpc, literal = qa.sql, qa.rpc, qa.literal
rpc_statement = qa.rpc_statement

# The port list grows by the profile, the template store and the outbox itself.
# Inheriting the released list unchanged would leave all three out of every
# tenant-isolation and module-gate sweep: twenty-four becomes twenty-seven.
OUTBOX_TABLES = basis.BASIS_TABLES + (
    "hours_mail_profiles", "hours_mail_templates", "hours_outbox_messages")
# The sender is the only caller of these, and it holds the service key.
OUTBOX_SERVICE_FUNCTIONS = {
    "hours_outbox_due_weeks", "hours_outbox_sync", "hours_outbox_claim",
    "hours_outbox_record_sent", "hours_outbox_record_failure", "hours_outbox_release"}
EXPECTED_SIGNATURES = basis.EXPECTED_SIGNATURES + (
    "hours_get_mail_profile(uuid)",
    "hours_save_mail_profile(uuid,integer,jsonb,text,integer)",
    "hours_save_mail_template(text,text,text,text)",
    "hours_outbox_overview(uuid,uuid,integer)",
    "hours_approve_outbox_message(uuid,text,text)",
    "hours_withdraw_outbox_message(uuid,text,boolean)",
    "hours_outbox_due_weeks(integer,uuid)",
    "hours_outbox_sync(uuid,jsonb,jsonb,boolean,jsonb)",
    "hours_outbox_claim(integer,integer,uuid)",
    "hours_outbox_record_sent(uuid,uuid,text,text,jsonb)",
    "hours_outbox_record_failure(uuid,uuid,text,text)",
    "hours_outbox_release(uuid,uuid)",
)

RULE_TEMPLATE = "uitvraag"


def rule(identifier="klant-uitvraag", enabled=True, mail_type="hours_request", party="customer",
         recipients=(), weekday=1, time_of_day="09:00", week_offset=1, template=RULE_TEMPLATE,
         language="nl", at=None):
    return {
        "id": identifier, "enabled": enabled, "mailType": mail_type, "party": party,
        "recipientIds": list(recipients),
        "at": at or {"kind": "week_time", "weekOffset": week_offset, "weekday": weekday,
                     "time": time_of_day},
        "templateId": template, "language": language,
    }


class OutboxTests(basis.BasisReplacementTests):
    """Mail profiles, the outbox and its approval, on the released contract."""

    # --- helpers -----------------------------------------------------------

    def client_contact(self, company=None, org=None, email=None, first="Planner", last="Klant"):
        identifier = str(uuid.uuid4())
        sql(f"""INSERT INTO public.company_contacts(id,organization_id,company_id,email,first_name,last_name)
          VALUES ({literal(identifier)},{literal(org or self.org)},{literal(company or self.company)},
            {literal(email or f'planner-{identifier[:8]}@klant.invalid')},{literal(first)},{literal(last)});""")
        return identifier

    def template(self, template_id=RULE_TEMPLATE, language="nl",
                 subject="Uren week {{week}}", body="Beste {{ontvanger}},\n\nGraag de uren.", user=None):
        return rpc("hours_save_mail_template", user=user or self.admin, p_template_id=template_id,
                   p_language=language, p_subject=subject, p_body=body)

    def profile(self, rules, company=None, user=None, mode="require_review", window=60, code=None):
        company = company or self.company
        current = rpc("hours_get_mail_profile", user=user or self.admin, p_company_id=company)
        params = dict(p_company_id=company, p_expected_version=current["version"], p_rules=rules,
                      p_late_approval_mode=mode, p_late_approval_window_minutes=window)
        if code is not None:
            return self.reject("hours_save_mail_profile", code=code, user=user or self.admin, **params)
        return rpc("hours_save_mail_profile", user=user or self.admin, **params)

    def due(self, org=None, limit=25):
        return rpc("hours_outbox_due_weeks", role="service_role",
                   p_limit=limit, p_organization_id=org)

    def action(self, week, dedup=None, status="due", approval=False, mail_type="hours_request",
               party="customer", recipient=None, subject="Uren week 37 [UR-AAAA-BBBB]",
               body="<p>Beste Planner</p>", recipients=None, content="hash-1", request=None,
               rule_id="klant-uitvraag", issue=None, at="2026-09-14T07:00:00Z"):
        return {
            "dedup_key": dedup or f"hours:v1:{uuid.uuid4()}",
            "rule_id": rule_id, "mail_type": mail_type, "party": party,
            "recipient_id": recipient or getattr(self, "qa_contact", None) or str(uuid.uuid4()),
            "channel": "email", "scheduled_at": at, "effective_at": at,
            "status": status, "reason": None, "approval_required": approval,
            "subject": subject, "body_html": body,
            "recipients": recipients if recipients is not None else ["planner@klant.invalid"],
            "company_contact_id": None, "candidate_id": None,
            "content_hash": content, "request_id": request, "issue": issue,
        }

    def sync(self, week_id, actions, code=None, role="service_role", user=None):
        params = dict(p_week_id=week_id, p_actions=actions, p_issues=[])
        if code is not None:
            return self.reject("hours_outbox_sync", code=code, role=role, user=user, **params)
        return rpc("hours_outbox_sync", role=role, user=user, **params)

    def outbox_row(self, dedup):
        return json.loads(sql(f"""SELECT coalesce(to_jsonb(t),'null'::jsonb) FROM public.hours_outbox_messages t
          WHERE t.dedup_key={literal(dedup)} AND t.organization_id={literal(self.org)};"""))

    #: The cron deliberately claims across every tenant, so a test that does the
    #: same picks up rows left by earlier tests in this shared database. Every
    #: case scopes to its own organisation unless it explicitly tests the sweep.
    OWN_TENANT = object()

    def outbox_claim(self, limit=1, org=OWN_TENANT):
        return rpc("hours_outbox_claim", role="service_role", p_limit=limit,
                   p_lease_seconds=300,
                   p_organization_id=self.org if org is OutboxTests.OWN_TENANT else org)

    def prepared_week(self):
        """A week with a contact, a template and a profile that names both."""
        week = self.week()
        contact = self.client_contact()
        self.template()
        self.profile([rule(recipients=[contact])])
        # The claim checks that the recipient still belongs to the rule, so every
        # action this case builds has to name the contact the profile names.
        self.qa_contact = contact
        return week, contact

    # --- contract ----------------------------------------------------------

    def test_permission_contract_covers_the_new_functions(self):
        """The released check, widened with this ticket's twelve RPCs."""
        functions = json.loads(sql("""SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,
          'name',p.proname,'schema',n.nspname)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname IN ('public','private') AND p.proname LIKE 'hours_%';"""))
        names = {f["signature"] for f in functions}
        for expected in EXPECTED_SIGNATURES:
            self.assertIn(expected, names)
        service_names = (classification.SERVICE_FUNCTIONS | client.CLIENT_SERVICE_FUNCTIONS
                         | {"hours_claim_source_reading", "hours_finish_source_reading"}
                         | mailintake.MAIL_SERVICE_FUNCTIONS | OUTBOX_SERVICE_FUNCTIONS)
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
        OutboxTests.test_permission_contract_covers_the_new_functions(self)

    # --- the profile decides whether anything goes out at all --------------

    def test_a_client_without_a_profile_is_never_due(self):
        self.week()
        self.assertEqual(self.due(org=self.org), [])

    def test_a_profile_whose_only_message_is_switched_off_is_never_due(self):
        week = self.week()
        contact = self.client_contact()
        self.template()
        self.profile([rule(recipients=[contact], enabled=False)])
        self.assertEqual(self.due(org=self.org), [])

    def test_two_clients_carry_their_own_schedule_and_their_own_frozen_deadlines(self):
        first, _ = self.prepared_week()
        second_company = str(uuid.uuid4())
        sql(f"""INSERT INTO public.companies(id,organization_id) VALUES
          ({literal(second_company)},{literal(self.org)});""")
        candidate = str(uuid.uuid4())
        sql(f"""INSERT INTO public.candidates(id,organization_id) VALUES
          ({literal(candidate)},{literal(self.org)});""")
        self.add_placement(candidate=candidate, company=second_company)
        current = rpc("hours_get_company_settings", user=self.admin, p_company_id=second_company)
        rpc("hours_set_company_settings", user=self.admin, p_company_id=second_company,
            p_expected_version=current["version"], p_enabled=True, p_submission_day_offset=9,
            p_submission_time="16:30", p_confirmation_day_offset=11, p_confirmation_time="09:00")
        rpc("hours_create_week", user=self.admin, p_company_id=second_company, p_week_start="2026-09-07")
        other_contact = self.client_contact(company=second_company)
        self.profile([rule(recipients=[other_contact], weekday=3, time_of_day="16:30")],
                     company=second_company)
        weeks = {row["company_id"]: row for row in self.due(org=self.org)}
        self.assertEqual(len(weeks), 2)
        # Each client's own numbers, rebuilt from that week's own frozen snapshot.
        self.assertEqual(weeks[self.company]["config"]["submissionDeadline"],
                         {"kind": "week_time", "weekOffset": 1, "weekday": 1, "time": "10:00"})
        self.assertEqual(weeks[second_company]["config"]["submissionDeadline"],
                         {"kind": "week_time", "weekOffset": 1, "weekday": 3, "time": "16:30"})
        self.assertEqual(weeks[self.company]["config"]["rules"][0]["at"]["weekday"], 1)
        self.assertEqual(weeks[second_company]["config"]["rules"][0]["at"]["weekday"], 3)

    def test_a_bounded_run_rotates_instead_of_starving_the_same_clients(self):
        """A fixed order would mean everything past the bound is never planned."""
        first, _ = self.prepared_week()
        second_company = str(uuid.uuid4())
        sql(f"""INSERT INTO public.companies(id,organization_id) VALUES
          ({literal(second_company)},{literal(self.org)});""")
        candidate = str(uuid.uuid4())
        sql(f"""INSERT INTO public.candidates(id,organization_id) VALUES
          ({literal(candidate)},{literal(self.org)});""")
        self.add_placement(candidate=candidate, company=second_company)
        current = rpc("hours_get_company_settings", user=self.admin, p_company_id=second_company)
        rpc("hours_set_company_settings", user=self.admin, p_company_id=second_company,
            p_expected_version=current["version"], p_enabled=True, p_submission_day_offset=8,
            p_submission_time="10:00", p_confirmation_day_offset=9, p_confirmation_time="12:00")
        rpc("hours_create_week", user=self.admin, p_company_id=second_company, p_week_start="2026-09-07")
        self.profile([rule(recipients=[self.client_contact(company=second_company)])],
                     company=second_company)
        seen = set()
        for _ in range(2):
            batch = self.due(org=self.org, limit=1)
            self.assertEqual(len(batch), 1)
            seen.add(batch[0]["company_id"])
            # Planning is what marks a client as recently seen.
            self.sync(batch[0]["week_id"], [])
        self.assertEqual(seen, {self.company, second_company},
                         "A second pass has to reach the client the first one could not")

    def test_the_payload_resolves_only_recipients_of_this_client_and_this_tenant(self):
        week, contact = self.prepared_week()
        stranger = self.client_contact(company=self.other_company, org=self.other_org)
        self.profile([rule(recipients=[contact, stranger])])
        payload = self.due(org=self.org)[0]
        self.assertIn(contact, payload["recipients"])
        self.assertNotIn(stranger, payload["recipients"],
                         "A recipient of another tenant may never resolve to an address")

    def test_a_report_about_one_week_does_not_erase_the_report_about_another(self):
        """`last_issues` staat per opdrachtgever, maar wordt per week geschreven.
        Een run plant er vijfentwintig, dus de laatste week overschreef alles wat
        de eerdere te melden hadden. Een melding draagt nu zijn week, en de
        planning vervangt alleen de meldingen van diezelfde week."""
        week, _ = self.prepared_week()
        elders = {"scope": "klant-uitvraag", "code": "invalid_deadline_order",
                  "message": "Andere week", "weekStart": "2026-09-14"}
        sql(f"""UPDATE public.hours_mail_profiles
          SET last_issues = {literal(json.dumps([elders]))}::jsonb
          WHERE company_id={literal(self.company)};""")
        eigen = {"scope": "klant-uitvraag", "code": "invalid_language",
                 "message": "Deze week", "weekStart": "2026-09-07"}
        rpc("hours_outbox_sync", role="service_role", p_week_id=week["id"], p_actions=[],
            p_issues=[eigen], p_prune=True, p_prune_keys=[])
        messages = {issue["message"] for issue in rpc(
            "hours_get_mail_profile", user=self.admin, p_company_id=self.company)["last_issues"]}
        self.assertIn("Deze week", messages)
        self.assertIn("Andere week", messages,
                      "De melding over een andere week hoort niet te zijn overschreven")
        # En een volgende planning van diezelfde week vervangt wel zijn eigen melding.
        rpc("hours_outbox_sync", role="service_role", p_week_id=week["id"], p_actions=[],
            p_issues=[], p_prune=True, p_prune_keys=[])
        messages = {issue["message"] for issue in rpc(
            "hours_get_mail_profile", user=self.admin, p_company_id=self.company)["last_issues"]}
        self.assertNotIn("Deze week", messages, "Opgelost is opgelost")
        self.assertIn("Andere week", messages, "En de andere week blijft staan")

    def test_a_full_report_list_still_makes_room_for_this_week(self):
        """Het plafond moet de verse melding houden, niet de oudste. Zonder een
        expliciete volgorde geeft Postgres geen garantie, en dan gooit `limit`
        precies weg waar deze planning voor liep."""
        week, _ = self.prepared_week()
        vol = [{"scope": f"regel-{n}", "code": "invalid_language",
                "message": f"Oud {n}", "weekStart": "2026-09-14"} for n in range(50)]
        sql(f"""UPDATE public.hours_mail_profiles
          SET last_issues = {literal(json.dumps(vol))}::jsonb
          WHERE company_id={literal(self.company)};""")
        rpc("hours_outbox_sync", role="service_role", p_week_id=week["id"], p_actions=[],
            p_issues=[{"scope": "klant-uitvraag", "code": "invalid_language",
                       "message": "Vers"}],
            p_prune=True, p_prune_keys=[])
        issues = rpc("hours_get_mail_profile", user=self.admin,
                     p_company_id=self.company)["last_issues"]
        self.assertLessEqual(len(issues), 50, "Het plafond hoort te gelden")
        self.assertIn("Vers", {issue["message"] for issue in issues},
                      "De verse melding hoort het plafond te overleven")

    def test_the_store_stamps_the_week_itself_so_the_caller_cannot_get_it_wrong(self):
        """De aanroeper hoeft de week niet mee te sturen: de opslag weet welke
        week hij aan het plannen is. Zo kan die stempel niet misgaan."""
        week, _ = self.prepared_week()
        rpc("hours_outbox_sync", role="service_role", p_week_id=week["id"], p_actions=[],
            p_issues=[{"scope": "klant-uitvraag", "code": "invalid_language",
                       "message": "Zonder week meegestuurd"}],
            p_prune=True, p_prune_keys=[])
        issues = rpc("hours_get_mail_profile", user=self.admin,
                     p_company_id=self.company)["last_issues"]
        self.assertEqual([issue.get("weekStart") for issue in issues], ["2026-09-07"])

    def test_too_many_reports_are_capped_and_never_lose_the_planning(self):
        """Een week met veel meldingen mag de hele planning niet laten
        terugdraaien; het plafond hoort te knippen, niet af te breken."""
        week, _ = self.prepared_week()
        action = self.action(week)
        veel = [{"scope": f"regel-{n}", "code": "missing_template", "message": f"Melding {n}"}
                for n in range(80)]
        rpc("hours_outbox_sync", role="service_role", p_week_id=week["id"],
            p_actions=[action], p_issues=veel, p_prune=True,
            p_prune_keys=[action["dedup_key"]])
        self.assertEqual(self.outbox_row(action["dedup_key"])["status"], "gereed",
                         "De planning zelf hoort gewoon te zijn vastgelegd")
        issues = rpc("hours_get_mail_profile", user=self.admin,
                     p_company_id=self.company)["last_issues"]
        self.assertEqual(len(issues), 50)

    def test_a_switched_off_rule_is_judged_exactly_as_the_planner_judges_it(self):
        """De planner slaat een uitgeschakelde regel over voordat hij de taal
        bekijkt. Strenger zijn zou een profiel onopslaanbaar maken door een regel
        die niets doet."""
        self.week()
        contact = self.client_contact()
        self.template()
        self.profile([rule(recipients=[contact], party="customer", language="pl", enabled=False)])

    def test_saving_a_profile_does_not_push_that_client_to_the_front_of_the_queue(self):
        """`due_weeks` sorteert `last_planned_at nulls first`. Wie zijn profiel
        vaak bewerkt, drong daarmee telkens voor - precies de uithongering die
        die volgorde moest voorkomen."""
        week, contact = self.prepared_week()
        rpc("hours_outbox_sync", role="service_role", p_week_id=week["id"], p_actions=[],
            p_issues=[], p_prune=True, p_prune_keys=[])
        planned = rpc("hours_get_mail_profile", user=self.admin,
                      p_company_id=self.company)["last_planned_at"]
        self.assertIsNotNone(planned)
        self.profile([rule(recipients=[contact], time_of_day="10:00")])
        after = rpc("hours_get_mail_profile", user=self.admin, p_company_id=self.company)
        self.assertEqual(after["last_planned_at"], planned,
                         "Opslaan hoort de plek in de wachtrij niet te verzetten")
        self.assertEqual(after["last_issues"], [],
                         "De meldingen over de oude regels horen wel te verdwijnen")

    def test_a_client_rule_in_polish_is_refused_instead_of_dying_quietly(self):
        """De planner weigert Pools voor een klantmail, maar de opslag nam hem
        aan. Het scherm meldde dan "opgeslagen" en die regel verstuurde nooit
        iets - zonder dat iemand kon zien waarom. De opslag hoort dezelfde grens
        te kennen als de planner."""
        self.week()
        contact = self.client_contact()
        self.template()
        error = self.profile([rule(recipients=[contact], party="customer", language="pl")],
                             code="22023")
        self.assertIn("pools", error.lower())
        # Voor een medewerker is Pools juist het punt van die instelling.
        self.profile([rule(party="employee", recipients=["*"], mail_type="approval_request",
                           language="pl")])

    def test_a_deadline_task_is_refused_by_the_profile(self):
        self.week()
        contact = self.client_contact()
        self.template()
        error = self.profile([rule(recipients=[contact], mail_type="submission_deadline",
                                   party="internal")], code="22023")
        self.assertIn("deadlinetaak", error.lower())

    def test_a_profile_refuses_an_unknown_message_type_or_an_empty_recipient_list(self):
        self.week()
        contact = self.client_contact()
        self.template()
        self.profile([rule(recipients=[contact], mail_type="verzin_iets")], code="22023")
        self.profile([rule(recipients=[])], code="22023")
        self.profile([rule(recipients=[contact], identifier="a"), rule(recipients=[contact], identifier="a")],
                     code="22023")

    def test_saving_the_profile_uses_compare_and_swap(self):
        self.week()
        contact = self.client_contact()
        self.template()
        self.profile([rule(recipients=[contact])])
        self.reject("hours_save_mail_profile", code="PT409", user=self.admin,
                    p_company_id=self.company, p_expected_version=0,
                    p_rules=[rule(recipients=[contact])],
                    p_late_approval_mode="require_review", p_late_approval_window_minutes=60)

    # --- the outbox --------------------------------------------------------

    def test_the_same_plan_twice_makes_one_row(self):
        week, _ = self.prepared_week()
        action = self.action(week)
        self.sync(week["id"], [action])
        self.sync(week["id"], [action])
        self.assertEqual(sql(f"""SELECT count(*) FROM public.hours_outbox_messages
          WHERE week_id={literal(week['id'])};"""), "1")

    def test_a_scheduled_moment_never_stands_in_for_an_approval(self):
        week, _ = self.prepared_week()
        action = self.action(week, approval=True, mail_type="correction_query")
        self.sync(week["id"], [action])
        row = self.outbox_row(action["dedup_key"])
        self.assertEqual(row["status"], "concept")
        self.assertEqual(row["block_reason"], "goedkeuring_vereist")
        self.assertEqual(self.outbox_claim()["messages"], [],
                         "An unapproved correction may never be handed to the mailbox")
        # And the database refuses the shortcut outright, not only the RPC.
        error = sql(f"""UPDATE public.hours_outbox_messages SET status='gereed'
          WHERE id={literal(row['id'])};""", expect_error=True)
        self.assertIn("check", error.lower())

    def test_an_ordinary_scheduled_message_is_sendable_without_a_person(self):
        week, _ = self.prepared_week()
        action = self.action(week)
        self.sync(week["id"], [action])
        self.assertEqual(self.outbox_row(action["dedup_key"])["status"], "gereed")
        self.assertEqual(len(self.outbox_claim()["messages"]), 1)

    def test_approval_records_exactly_what_the_approver_read(self):
        week, _ = self.prepared_week()
        action = self.action(week, approval=True, mail_type="correction_query")
        self.sync(week["id"], [action])
        row = self.outbox_row(action["dedup_key"])
        rpc("hours_approve_outbox_message", user=self.admin, p_id=row["id"],
            p_expected_content_hash=row["content_hash"],
            p_expected_source_revision=row["source_revision"])
        approved = self.outbox_row(action["dedup_key"])
        self.assertEqual(approved["status"], "goedgekeurd")
        self.assertEqual(approved["approved_by"], self.admin)
        self.assertEqual(approved["approved_content_hash"], row["content_hash"])
        self.assertEqual(len(self.outbox_claim()["messages"]), 1)

    def test_approving_something_else_than_what_was_read_is_a_conflict(self):
        week, _ = self.prepared_week()
        action = self.action(week, approval=True, mail_type="correction_query")
        self.sync(week["id"], [action])
        row = self.outbox_row(action["dedup_key"])
        self.reject("hours_approve_outbox_message", code="PT409", user=self.admin, p_id=row["id"],
                    p_expected_content_hash="een-andere-tekst",
                    p_expected_source_revision=row["source_revision"])
        self.assertEqual(self.outbox_row(action["dedup_key"])["status"], "concept")

    def test_a_changed_source_revision_invalidates_a_standing_approval(self):
        week, _ = self.prepared_week()
        action = self.action(week, approval=True, mail_type="correction_query")
        self.sync(week["id"], [action])
        row = self.outbox_row(action["dedup_key"])
        rpc("hours_approve_outbox_message", user=self.admin, p_id=row["id"],
            p_expected_content_hash=row["content_hash"],
            p_expected_source_revision=row["source_revision"])
        self.assertEqual(self.outbox_row(action["dedup_key"])["status"], "goedgekeurd")
        # One saved hours day is enough to change what the message is about.
        self.save(self.first_day(week))
        self.sync(week["id"], [action])
        invalidated = self.outbox_row(action["dedup_key"])
        self.assertEqual(invalidated["status"], "concept")
        self.assertEqual(invalidated["block_reason"], "goedkeuring_vervallen")
        self.assertIsNone(invalidated["approved_at"])
        self.assertEqual(self.outbox_claim()["messages"], [])

    def test_approval_cannot_bring_a_message_forward_that_is_held_for_another_reason(self):
        """Approval lifts one block, not every block."""
        week, _ = self.prepared_week()
        # A message that never needed approval: only its own moment decides.
        plain = self.action(week, status="planned")
        self.sync(week["id"], [plain])
        row = self.outbox_row(plain["dedup_key"])
        self.assertEqual(row["status"], "concept")
        error = self.reject("hours_approve_outbox_message", code="22023", user=self.admin,
                            p_id=row["id"], p_expected_content_hash=row["content_hash"],
                            p_expected_source_revision=row["source_revision"])
        self.assertIn("verzendmoment", error)
        # And one that does need approval, but is also still waiting.
        waiting = self.action(week, status="waiting", approval=True, mail_type="correction_query")
        self.sync(week["id"], [waiting])
        held = self.outbox_row(waiting["dedup_key"])
        self.reject("hours_approve_outbox_message", code="22023", user=self.admin, p_id=held["id"],
                    p_expected_content_hash=held["content_hash"],
                    p_expected_source_revision=held["source_revision"])
        self.assertEqual(self.outbox_claim()["messages"], [])

    def test_a_stale_approval_never_blocks_a_message_that_did_not_need_one(self):
        """Being looked at once is not a condition for sending."""
        week, _ = self.prepared_week()
        action = self.action(week)
        self.sync(week["id"], [action])
        # Model an approval that was recorded on a message that needs none.
        sql(f"""UPDATE public.hours_outbox_messages SET approved_by={literal(self.admin)},
          approved_at=clock_timestamp(), approved_content_hash='iets-anders',
          approved_source_revision='iets-anders'
          WHERE dedup_key={literal(action['dedup_key'])};""")
        self.sync(week["id"], [action])
        row = self.outbox_row(action["dedup_key"])
        self.assertEqual(row["status"], "gereed")
        self.assertIsNone(row["approved_at"], "The stale approval is dropped, not kept")
        self.assertEqual(len(self.outbox_claim()["messages"]), 1)

    def test_the_reason_the_planner_gives_is_the_reason_approval_lifts(self):
        """Two vocabularies for one state means the approve button never works.

        The planner says `correction_approval_required`; the approve RPC unblocks
        `goedkeuring_vereist`. If those are allowed to drift apart, every
        correction and query message is stuck as a draft forever.
        """
        week, _ = self.prepared_week()
        action = self.action(week, status="requires_review", approval=True,
                             mail_type="correction_query")
        action["reason"] = "correction_approval_required"
        self.sync(week["id"], [action])
        row = self.outbox_row(action["dedup_key"])
        self.assertEqual(row["status"], "concept")
        rpc("hours_approve_outbox_message", user=self.admin, p_id=row["id"],
            p_expected_content_hash=row["content_hash"],
            p_expected_source_revision=row["source_revision"])
        self.assertEqual(self.outbox_row(action["dedup_key"])["status"], "goedgekeurd")
        self.assertEqual(len(self.outbox_claim()["messages"]), 1)

    def test_a_withdrawal_survives_the_next_planning(self):
        """A person stopped this message; a replan may not resurrect it."""
        week, _ = self.prepared_week()
        action = self.action(week)
        self.sync(week["id"], [action])
        row = self.outbox_row(action["dedup_key"])
        rpc("hours_withdraw_outbox_message", user=self.admin, p_id=row["id"],
            p_note="met de hand gestopt")
        self.assertEqual(self.outbox_row(action["dedup_key"])["status"], "vervallen")
        self.sync(week["id"], [action])
        after = self.outbox_row(action["dedup_key"])
        self.assertEqual(after["status"], "vervallen",
                         "De volgende cron-run mag een besluit van een mens niet terugdraaien")
        self.assertEqual(self.outbox_claim()["messages"], [])

    def test_switching_a_message_type_off_stops_one_that_was_already_ready(self):
        """The claim may not lean on a planning run that might never come."""
        week, contact = self.prepared_week()
        action = self.action(week)
        self.sync(week["id"], [action])
        self.assertEqual(len(self.outbox_claim()["messages"]), 1)
        sql(f"""UPDATE public.hours_outbox_messages SET claim_token=NULL, claimed_at=NULL,
          lease_expires_at=NULL, next_attempt_at=NULL
          WHERE dedup_key={literal(action['dedup_key'])};""")
        self.profile([rule(recipients=[contact], enabled=False)])
        self.assertEqual(self.outbox_claim()["messages"], [],
                         "Een uitgeschakelde berichtsoort mag niets meer versturen")

    def test_taking_a_failed_message_off_the_list_really_lets_it_be_planned_again(self):
        """The screen promises this; two earlier fixes together made it a lie."""
        week, _ = self.prepared_week()
        action = self.action(week)
        self.sync(week["id"], [action])
        claimed = self.outbox_claim()
        rpc("hours_outbox_record_failure", role="service_role", p_id=claimed["messages"][0]["id"],
            p_claim_token=claimed["claim_token"], p_kind="permanent", p_error="verkeerd adres")
        row = self.outbox_row(action["dedup_key"])
        self.assertEqual(row["status"], "mislukt")
        rpc("hours_withdraw_outbox_message", user=self.admin, p_id=row["id"],
            p_note="adres hersteld", p_allow_replan=True)
        self.assertEqual(self.outbox_row(action["dedup_key"])["block_reason"], "opnieuw_plannen")
        self.sync(week["id"], [action])
        again = self.outbox_row(action["dedup_key"])
        self.assertEqual(again["status"], "gereed",
                         "Van de lijst halen moet het bericht echt opnieuw laten voorstellen")
        self.assertEqual(again["attempt_count"], 0)

    def test_a_stopped_message_stays_stopped_even_with_the_replan_route_next_to_it(self):
        week, _ = self.prepared_week()
        action = self.action(week)
        self.sync(week["id"], [action])
        row = self.outbox_row(action["dedup_key"])
        rpc("hours_withdraw_outbox_message", user=self.admin, p_id=row["id"], p_note="niet versturen")
        self.sync(week["id"], [action])
        self.assertEqual(self.outbox_row(action["dedup_key"])["status"], "vervallen")
        self.assertEqual(self.outbox_row(action["dedup_key"])["block_reason"], "ingetrokken")

    def test_a_lease_that_ran_out_never_sends_the_same_mail_again(self):
        """Nobody knows whether that mail left. Sending twice is the worse half."""
        week, _ = self.prepared_week()
        action = self.action(week)
        self.sync(week["id"], [action])
        claimed = self.outbox_claim()
        self.assertEqual(len(claimed["messages"]), 1)
        sql(f"""UPDATE public.hours_outbox_messages
          SET lease_expires_at = clock_timestamp() - interval '1 minute'
          WHERE dedup_key={literal(action['dedup_key'])};""")
        self.assertEqual(self.outbox_claim()["messages"], [],
                         "Een afgelopen lease mag het bericht niet opnieuw aanbieden")
        row = self.outbox_row(action["dedup_key"])
        self.assertEqual(row["status"], "mislukt")
        self.assertEqual(row["block_reason"], "verzending_onzeker")

    def test_a_rule_that_now_names_somebody_else_no_longer_sends_to_the_old_one(self):
        week, contact = self.prepared_week()
        action = self.action(week, recipient=contact)
        self.sync(week["id"], [action])
        self.assertEqual(len(self.outbox_claim()["messages"]), 1)
        sql(f"""UPDATE public.hours_outbox_messages SET claim_token=NULL, claimed_at=NULL,
          lease_expires_at=NULL, next_attempt_at=NULL
          WHERE dedup_key={literal(action['dedup_key'])};""")
        self.profile([rule(recipients=[self.client_contact()])])
        self.assertEqual(self.outbox_claim()["messages"], [],
                         "De vertrokken contactpersoon mag geen post meer krijgen")

    def test_a_planning_that_did_not_fit_cancels_nothing_it_never_saw(self):
        week, _ = self.prepared_week()
        keeper = self.action(week)
        self.sync(week["id"], [keeper])
        other = self.action(week)
        rpc("hours_outbox_sync", role="service_role", p_week_id=week["id"],
            p_actions=[other], p_issues=[], p_prune=False)
        self.assertEqual(self.outbox_row(keeper["dedup_key"])["status"], "gereed",
                         "Een afgekapte planning mag niet opruimen wat hij niet gezien heeft")

    def test_a_failed_message_can_still_be_taken_off_the_list(self):
        week, _ = self.prepared_week()
        action = self.action(week)
        self.sync(week["id"], [action])
        claimed = self.outbox_claim()
        rpc("hours_outbox_record_failure", role="service_role", p_id=claimed["messages"][0]["id"],
            p_claim_token=claimed["claim_token"], p_kind="permanent", p_error="verkeerd adres")
        row = self.outbox_row(action["dedup_key"])
        self.assertEqual(row["status"], "mislukt")
        rpc("hours_withdraw_outbox_message", user=self.admin, p_id=row["id"], p_note="adres hersteld")
        self.assertEqual(self.outbox_row(action["dedup_key"])["status"], "vervallen")

    def test_a_token_that_outlived_its_lease_is_never_left_behind(self):
        """De val van ronde twee. Een goedgekeurd bericht wordt geclaimd, de run
        valt om, en ondertussen wijzigen de uren. De planner zette die rij dan
        terug op `concept` - buiten het bereik van de veger, mét het token er
        nog op. Daarna kwam niemand er ooit nog bij: de veger niet, de planner
        niet, en de mens niet. Een rij met een token blijft daarom van de
        planner af."""
        week, _ = self.prepared_week()
        action = self.action(week, approval=True, mail_type="correction_query")
        self.sync(week["id"], [action])
        row = self.outbox_row(action["dedup_key"])
        rpc("hours_approve_outbox_message", user=self.admin, p_id=row["id"],
            p_expected_content_hash=row["content_hash"],
            p_expected_source_revision=row["source_revision"])
        self.assertEqual(self.outbox_row(action["dedup_key"])["status"], "goedgekeurd")
        claimed = self.outbox_claim()
        self.assertEqual(len(claimed["messages"]), 1)
        sql(f"""UPDATE public.hours_outbox_messages
          SET lease_expires_at = clock_timestamp() - interval '1 minute'
          WHERE dedup_key={literal(action['dedup_key'])};""")
        # De uren wijzigen, dus de goedkeuring vervalt: precies het moment waarop
        # de planner deze rij uit de verzendbare verzameling zou halen.
        self.sync(week["id"], [dict(action, content_hash="uren-gewijzigd")])
        row = self.outbox_row(action["dedup_key"])
        self.assertIn(row["status"], ("gereed", "goedgekeurd"),
                      "Een rij met een claim-token mag niet uit het bereik van de veger worden geschreven")
        self.assertEqual(row["content_hash"], "hash-1",
                         "De planner hoort deze rij helemaal niet aan te raken")
        # En de eerstvolgende claim beslecht de onzekerheid alsnog.
        self.outbox_claim()
        row = self.outbox_row(action["dedup_key"])
        self.assertEqual(row["status"], "mislukt")
        self.assertEqual(row["block_reason"], "verzending_onzeker")
        self.assertIsNone(row["claim_token"], "Het token hoort hier losgelaten te zijn")

    def test_a_message_in_verzending_is_left_alone_by_both_human_routes(self):
        """Goedkeuren of intrekken terwijl een token staat, laat dat token
        achter op een rij waar de veger niet meer bij kan. Dat geldt ook - en
        juist - wanneer de lease allang verlopen is."""
        week, _ = self.prepared_week()
        action = self.action(week, approval=True, mail_type="correction_query")
        self.sync(week["id"], [action])
        row = self.outbox_row(action["dedup_key"])
        rpc("hours_approve_outbox_message", user=self.admin, p_id=row["id"],
            p_expected_content_hash=row["content_hash"],
            p_expected_source_revision=row["source_revision"])
        claimed = self.outbox_claim()
        identifier = claimed["messages"][0]["id"]
        sql(f"""UPDATE public.hours_outbox_messages
          SET lease_expires_at = clock_timestamp() - interval '1 minute'
          WHERE id={literal(identifier)};""")
        self.reject("hours_withdraw_outbox_message", code="PT409", user=self.admin,
                    p_id=identifier, p_note="stop", p_allow_replan=False)
        self.assertIsNotNone(self.outbox_row(action["dedup_key"])["claim_token"],
                             "Intrekken mag dit token niet achterlaten")
        # En goedkeuren evenmin. Daarvoor moet de rij weer een concept zijn dat
        # op goedkeuring wacht - met het token er nog op.
        sql(f"""UPDATE public.hours_outbox_messages SET status='concept',
          block_reason='goedkeuring_vervallen', approved_at=NULL, approved_by=NULL,
          approved_content_hash=NULL, approved_source_revision=NULL
          WHERE id={literal(identifier)};""")
        row = self.outbox_row(action["dedup_key"])
        self.reject("hours_approve_outbox_message", code="PT409", user=self.admin,
                    p_id=identifier, p_expected_content_hash=row["content_hash"],
                    p_expected_source_revision=row["source_revision"])
        self.assertIsNotNone(self.outbox_row(action["dedup_key"])["claim_token"],
                             "Goedkeuren mag dit token niet achterlaten")

    def test_every_member_of_the_week_means_who_is_in_it_now(self):
        """Ronde twee controleerde de ontvanger opnieuw, maar liet `*` altijd
        door - en `*` is de enige vorm die het scherm voor medewerkers aanbiedt.
        Wiens plaatsing tussen plannen en versturen eindigde, krijgt geen mail."""
        week = self.week()
        self.template()
        member = sql(f"""SELECT m.candidate_id::text FROM public.hours_week_members m
          WHERE m.week_id={literal(week['id'])} ORDER BY m.id LIMIT 1;""")
        self.assertTrue(member, "Deze week hoort een medewerker te hebben")
        self.profile([rule(party="employee", recipients=["*"], mail_type="approval_request")])
        # Wie in de week staat, mag post krijgen.
        current = self.action(week, recipient=member, party="employee",
                              mail_type="approval_request")
        self.sync(week["id"], [current])
        self.assertEqual(len(self.outbox_claim()["messages"]), 1)
        # Urenhistorie is onveranderlijk, dus een vertrokken medewerker wordt
        # hier nagebootst door iemand die nooit in deze week stond: voor de
        # claim is dat exact hetzelfde geval.
        gone = str(uuid.uuid4())
        sql(f"""INSERT INTO public.candidates(id,organization_id,first_name,last_name,email)
          VALUES ({literal(gone)},{literal(self.org)},'Vertrokken','Kracht','weg@medewerker.invalid');""")
        departed = self.action(week, recipient=gone, party="employee",
                               mail_type="approval_request")
        self.sync(week["id"], [current, departed])
        # De eerste claim losmaken, zodat deze ronde beide berichten kán zien en
        # het verschil dus echt van de controle komt en niet van een lease.
        sql(f"""UPDATE public.hours_outbox_messages SET claim_token=NULL, claimed_at=NULL,
          lease_expires_at=NULL, next_attempt_at=NULL
          WHERE dedup_key={literal(current['dedup_key'])};""")
        offered = {m["id"] for m in self.outbox_claim(limit=5)["messages"]}
        self.assertIn(self.outbox_row(current["dedup_key"])["id"], offered,
                      "Wie wel in de week staat, hoort zijn bericht te krijgen")
        self.assertNotIn(self.outbox_row(departed["dedup_key"])["id"], offered,
                         "Wie niet in de week staat, hoort geen post te krijgen")

    def test_a_configuration_error_is_not_painted_over_by_a_stale_approval(self):
        """Een ontbrekende tekst is het enige wat die rij nog kan melden. Zegt
        hij in plaats daarvan 'de uren zijn gewijzigd', dan zoekt de lezer op de
        verkeerde plek - en het scherm biedt dan geen enkele knop."""
        week, _ = self.prepared_week()
        action = self.action(week, approval=True, mail_type="correction_query")
        self.sync(week["id"], [action])
        row = self.outbox_row(action["dedup_key"])
        rpc("hours_approve_outbox_message", user=self.admin, p_id=row["id"],
            p_expected_content_hash=row["content_hash"],
            p_expected_source_revision=row["source_revision"])
        broken = dict(action, content_hash="andere-hash", subject="", body_html="",
                      issue="ontbrekende_tekst")
        self.sync(week["id"], [broken])
        self.assertEqual(self.outbox_row(action["dedup_key"])["block_reason"], "ontbrekende_tekst",
                         "De onleesbare regel is wat deze rij moet blijven melden")

    def test_pruning_looks_at_the_keys_of_the_whole_plan(self):
        """Een planning die niet in een aanroep past, ruimt op met de sleutels
        van het geheel - anders schrapt de laatste batch alle eerdere."""
        week, _ = self.prepared_week()
        first = self.action(week)
        second = self.action(week)
        rpc("hours_outbox_sync", role="service_role", p_week_id=week["id"],
            p_actions=[first], p_issues=[], p_prune=False)
        rpc("hours_outbox_sync", role="service_role", p_week_id=week["id"],
            p_actions=[second], p_issues=[], p_prune=True,
            p_prune_keys=[first["dedup_key"], second["dedup_key"]])
        self.assertEqual(self.outbox_row(first["dedup_key"])["status"], "gereed",
                         "Een bericht uit een eerdere batch hoort de opruiming te overleven")
        third = self.action(week)
        rpc("hours_outbox_sync", role="service_role", p_week_id=week["id"],
            p_actions=[third], p_issues=[], p_prune=True,
            p_prune_keys=[third["dedup_key"]])
        self.assertEqual(self.outbox_row(first["dedup_key"])["status"], "vervallen",
                         "Wat echt niet meer in de planning zit, hoort wel te vervallen")

    def test_a_send_whose_outcome_is_unknown_goes_to_a_person(self):
        """Aanmaken is herhaalbaar, versturen niet. Een verzendopdracht die
        faalde nadat het bericht al bestond, mag niet opnieuw."""
        week, _ = self.prepared_week()
        action = self.action(week)
        self.sync(week["id"], [action])
        claimed = self.outbox_claim()
        rpc("hours_outbox_record_failure", role="service_role", p_id=claimed["messages"][0]["id"],
            p_claim_token=claimed["claim_token"], p_kind="uncertain",
            p_error="Graph gaf geen antwoord op de verzendopdracht")
        row = self.outbox_row(action["dedup_key"])
        self.assertEqual(row["status"], "mislukt")
        self.assertEqual(row["block_reason"], "verzending_onzeker")
        self.assertIsNone(row["next_attempt_at"], "Hier hoort geen nieuwe poging te wachten")
        self.assertEqual(self.outbox_claim()["messages"], [])

    def test_the_overview_puts_what_needs_a_person_first(self):
        week, _ = self.prepared_week()
        later = self.action(week, at="2027-01-04T09:00:00Z", status="planned")
        now_due = self.action(week, approval=True, mail_type="correction_query")
        now_due["reason"] = "correction_approval_required"
        self.sync(week["id"], [later, now_due])
        overview = rpc("hours_outbox_overview", user=self.admin, p_week_id=week["id"],
                       p_company_id=None, p_limit=1)
        self.assertEqual(len(overview["messages"]), 1)
        self.assertEqual(overview["messages"][0]["dedup_key"] if "dedup_key" in overview["messages"][0]
                         else overview["messages"][0]["block_reason"], "goedkeuring_vereist",
                         "Een pagina vol toekomstige concepten mag niet verbergen wat nu een mens vraagt")

    def test_a_message_the_planner_dropped_stops_being_pending_work(self):
        week, _ = self.prepared_week()
        action = self.action(week)
        self.sync(week["id"], [action])
        self.sync(week["id"], [])
        self.assertEqual(self.outbox_row(action["dedup_key"])["status"], "vervallen")

    def test_a_missing_recipient_or_text_lands_visibly_and_is_never_sent(self):
        week, _ = self.prepared_week()
        blind = self.action(week, issue="onbekende_ontvanger", recipients=[], subject="", body="")
        self.sync(week["id"], [blind])
        row = self.outbox_row(blind["dedup_key"])
        self.assertEqual(row["status"], "concept")
        self.assertEqual(row["block_reason"], "onbekende_ontvanger")
        self.assertEqual(self.outbox_claim()["messages"], [])
        self.reject("hours_approve_outbox_message", code="22023", user=self.admin, p_id=row["id"],
                    p_expected_content_hash=row["content_hash"],
                    p_expected_source_revision=row["source_revision"])

    def test_what_the_planner_could_not_read_is_written_back_where_people_look(self):
        """A rule that silently never fires is the worst configuration bug."""
        week, _ = self.prepared_week()
        issues = [{"scope": "klant-uitvraag", "code": "missing_template",
                   "message": "Kies een template en taal voor deze mail."}]
        rpc("hours_outbox_sync", role="service_role", p_week_id=week["id"],
            p_actions=[], p_issues=issues)
        profile = rpc("hours_get_mail_profile", user=self.admin, p_company_id=self.company)
        # De opslag zet de week erbij; de melding zelf komt er ongewijzigd door.
        self.assertEqual([{k: v for k, v in issue.items() if k != "weekStart"}
                          for issue in profile["last_issues"]], issues)
        self.assertEqual([issue["weekStart"] for issue in profile["last_issues"]],
                         ["2026-09-07"])
        self.assertIsNotNone(profile["last_planned_at"])
        # Saving new rules clears complaints about rules that no longer exist.
        contact = self.client_contact()
        self.profile([rule(recipients=[contact])])
        fresh = rpc("hours_get_mail_profile", user=self.admin, p_company_id=self.company)
        self.assertEqual(fresh["last_issues"], [])
        # `last_planned_at` blijft staan: dat is de plek in de wachtrij, en die
        # hoort niet te verspringen omdat iemand zijn profiel bewerkt.
        self.assertIsNotNone(fresh["last_planned_at"])

    # --- sending -----------------------------------------------------------

    def test_a_claim_counts_an_attempt_and_five_failures_end_it(self):
        week, _ = self.prepared_week()
        action = self.action(week)
        self.sync(week["id"], [action])
        for _ in range(5):
            claimed = self.outbox_claim()
            if not claimed["messages"]:
                break
            rpc("hours_outbox_record_failure", role="service_role",
                p_id=claimed["messages"][0]["id"], p_claim_token=claimed["claim_token"],
                p_kind="transient", p_error="graph_503")
            sql(f"""UPDATE public.hours_outbox_messages SET next_attempt_at=NULL
              WHERE dedup_key={literal(action['dedup_key'])};""")
        row = self.outbox_row(action["dedup_key"])
        self.assertEqual(row["status"], "mislukt")
        self.assertEqual(row["block_reason"], "te_vaak_geprobeerd")
        self.assertEqual(self.outbox_claim()["messages"], [])

    def test_a_transient_failure_always_waits_before_the_next_try(self):
        week, _ = self.prepared_week()
        action = self.action(week)
        self.sync(week["id"], [action])
        claimed = self.outbox_claim()
        rpc("hours_outbox_record_failure", role="service_role", p_id=claimed["messages"][0]["id"],
            p_claim_token=claimed["claim_token"], p_kind="transient", p_error="graph_503")
        self.assertEqual(sql(f"""SELECT next_attempt_at > clock_timestamp() FROM public.hours_outbox_messages
          WHERE dedup_key={literal(action['dedup_key'])};"""), "t")
        self.assertEqual(self.outbox_claim()["messages"], [],
                         "A message that just failed may not be retried in the same breath")

    def test_a_permanent_refusal_is_not_retried_at_all(self):
        week, _ = self.prepared_week()
        action = self.action(week)
        self.sync(week["id"], [action])
        claimed = self.outbox_claim()
        rpc("hours_outbox_record_failure", role="service_role", p_id=claimed["messages"][0]["id"],
            p_claim_token=claimed["claim_token"], p_kind="permanent", p_error="invalid recipient")
        row = self.outbox_row(action["dedup_key"])
        self.assertEqual(row["status"], "mislukt")
        self.assertEqual(self.outbox_claim()["messages"], [])

    def test_an_outbound_pause_keeps_the_approval_and_gives_the_attempt_back(self):
        week, _ = self.prepared_week()
        action = self.action(week, approval=True, mail_type="correction_query")
        self.sync(week["id"], [action])
        row = self.outbox_row(action["dedup_key"])
        rpc("hours_approve_outbox_message", user=self.admin, p_id=row["id"],
            p_expected_content_hash=row["content_hash"],
            p_expected_source_revision=row["source_revision"])
        claimed = self.outbox_claim()
        self.assertEqual(sql(f"""SELECT attempt_count FROM public.hours_outbox_messages
          WHERE dedup_key={literal(action['dedup_key'])};"""), "1")
        rpc("hours_outbox_record_failure", role="service_role", p_id=claimed["messages"][0]["id"],
            p_claim_token=claimed["claim_token"], p_kind="paused",
            p_error="Uitgaande e-mail staat op pauze")
        paused = self.outbox_row(action["dedup_key"])
        self.assertEqual(paused["status"], "goedgekeurd", "A pause may not revoke an approval")
        self.assertEqual(paused["attempt_count"], 0, "A pause may not consume the retry budget")
        self.assertEqual(paused["block_reason"], "uitgaande_pauze")
        self.assertIsNone(paused["sent_at"])

    def test_a_sent_message_is_a_fact_and_cannot_be_rewritten(self):
        week, _ = self.prepared_week()
        action = self.action(week)
        self.sync(week["id"], [action])
        claimed = self.outbox_claim()
        rpc("hours_outbox_record_sent", role="service_role", p_id=claimed["messages"][0]["id"],
            p_claim_token=claimed["claim_token"], p_outbound_message_id="<sent-1@ja.invalid>",
            p_conversation_id="AAQkConv", p_recipients=["planner@klant.invalid"])
        row = self.outbox_row(action["dedup_key"])
        self.assertEqual(row["status"], "verzonden")
        self.assertIsNotNone(row["sent_at"])
        for statement in (f"UPDATE public.hours_outbox_messages SET subject='x' WHERE id={literal(row['id'])};",
                          f"DELETE FROM public.hours_outbox_messages WHERE id={literal(row['id'])};"):
            self.assertIn("42501", sql(statement, expect_error=True))
        # And a second run finds nothing left to do.
        self.sync(week["id"], [action])
        self.assertEqual(self.outbox_claim()["messages"], [])
        self.assertEqual(self.outbox_row(action["dedup_key"])["status"], "verzonden")

    def test_sending_without_any_identifier_is_refused(self):
        week, _ = self.prepared_week()
        action = self.action(week)
        self.sync(week["id"], [action])
        claimed = self.outbox_claim()
        self.reject("hours_outbox_record_sent", code="22023", role="service_role",
                    p_id=claimed["messages"][0]["id"], p_claim_token=claimed["claim_token"],
                    p_outbound_message_id=None, p_conversation_id=None,
                    p_recipients=["planner@klant.invalid"])

    def test_a_stale_claim_token_can_neither_complete_nor_fail_a_message(self):
        week, _ = self.prepared_week()
        action = self.action(week)
        self.sync(week["id"], [action])
        claimed = self.outbox_claim()
        wrong = str(uuid.uuid4())
        self.reject("hours_outbox_record_sent", code="PT409", role="service_role",
                    p_id=claimed["messages"][0]["id"], p_claim_token=wrong,
                    p_outbound_message_id="<x@y.invalid>", p_conversation_id=None,
                    p_recipients=["planner@klant.invalid"])
        self.reject("hours_outbox_record_failure", code="PT409", role="service_role",
                    p_id=claimed["messages"][0]["id"], p_claim_token=wrong, p_kind="permanent")

    def test_the_request_reference_learns_the_thread_only_once(self):
        week, contact = self.prepared_week()
        # The claim re-reads the profile, so every rule a message came from has to
        # still be in it. This case sends a reminder as well as a request.
        self.profile([rule(recipients=[contact]),
                      rule(identifier="klant-herinnering", mail_type="submission_reminder",
                           recipients=[contact], weekday=3)])
        issued = rpc("hours_issue_week_request", user=self.admin, p_week_id=week["id"])
        request_id = issued["request_id"]
        first = self.action(week, request=request_id, recipients=["planner@klant.invalid"])
        self.sync(week["id"], [first])
        claimed = self.outbox_claim()
        rpc("hours_outbox_record_sent", role="service_role", p_id=claimed["messages"][0]["id"],
            p_claim_token=claimed["claim_token"], p_outbound_message_id="<eerste@ja.invalid>",
            p_conversation_id="AAQkEerste", p_recipients=["planner@klant.invalid"])
        stored = json.loads(sql(f"""SELECT to_jsonb(t) FROM public.hours_week_requests t
          WHERE t.id={literal(request_id)};"""))
        self.assertEqual(stored["outbound_message_id"], "<eerste@ja.invalid>")
        self.assertEqual(stored["conversation_id"], "AAQkEerste")
        self.assertEqual(stored["recipients"], ["planner@klant.invalid"])
        self.assertIsNotNone(stored["sent_at"])
        # T7 froze all four fields the moment sent_at was set, so a later message
        # leaves the request exactly as it is: a client replies to the message in
        # front of them, and moving the anchor would break that thread.
        second = self.action(week, request=request_id, recipients=["backoffice@klant.invalid"],
                             mail_type="submission_reminder", rule_id="klant-herinnering")
        self.sync(week["id"], [second])
        claimed = self.outbox_claim()
        rpc("hours_outbox_record_sent", role="service_role", p_id=claimed["messages"][0]["id"],
            p_claim_token=claimed["claim_token"], p_outbound_message_id="<tweede@ja.invalid>",
            p_conversation_id="AAQkTweede", p_recipients=["backoffice@klant.invalid"])
        after = json.loads(sql(f"""SELECT to_jsonb(t) FROM public.hours_week_requests t
          WHERE t.id={literal(request_id)};"""))
        self.assertEqual(after["outbound_message_id"], "<eerste@ja.invalid>")
        self.assertEqual(after["conversation_id"], "AAQkEerste")
        self.assertEqual(after["recipients"], ["planner@klant.invalid"])
        self.assertEqual(after["sent_at"], stored["sent_at"])
        # The reminder itself did go out; only the reference stayed put.
        self.assertEqual(self.outbox_row(second["dedup_key"])["status"], "verzonden")

    def test_a_switched_off_client_stops_being_sendable(self):
        week, _ = self.prepared_week()
        action = self.action(week)
        self.sync(week["id"], [action])
        current = rpc("hours_get_company_settings", user=self.admin, p_company_id=self.company)
        rpc("hours_set_company_settings", user=self.admin, p_company_id=self.company,
            p_expected_version=current["version"], p_enabled=False,
            p_submission_day_offset=current["submission_day_offset"],
            p_submission_time=current["submission_time"],
            p_confirmation_day_offset=current["confirmation_day_offset"],
            p_confirmation_time=current["confirmation_time"])
        self.assertEqual(self.outbox_claim()["messages"], [])
        self.assertEqual(self.due(org=self.org), [])

    # --- who may do what ---------------------------------------------------

    def test_an_unscoped_sweep_never_reaches_a_switched_off_organisation(self):
        """What the cron does: no organisation filter, and still gated."""
        week, _ = self.prepared_week()
        action = self.action(week)
        self.sync(week["id"], [action])
        gate.toggle(self.org, False)
        everything = rpc("hours_outbox_claim", role="service_role", p_limit=25,
                         p_lease_seconds=300, p_organization_id=None)
        self.assertNotIn(action["dedup_key"],
                         [row.get("dedup_key") for row in everything["messages"]])
        self.assertEqual(sql(f"SELECT count(*) FROM public.hours_outbox_messages "
                             f"WHERE dedup_key={literal(action['dedup_key'])} "
                             f"AND claim_token IS NOT NULL;"), "0")

    def test_the_service_route_is_closed_to_a_logged_in_user_and_to_anon(self):
        week, _ = self.prepared_week()
        for role, user in (("authenticated", self.admin), ("anon", None)):
            self.reject("hours_outbox_due_weeks", code="42501", role=role, user=user,
                        p_limit=25, p_organization_id=self.org)
            self.reject("hours_outbox_claim", code="42501", role=role, user=user,
                        p_limit=1, p_lease_seconds=300, p_organization_id=self.org)

    def test_another_tenant_can_neither_read_nor_approve_this_outbox(self):
        week, _ = self.prepared_week()
        action = self.action(week, approval=True, mail_type="correction_query")
        self.sync(week["id"], [action])
        row = self.outbox_row(action["dedup_key"])
        self.assertEqual(rpc("hours_outbox_overview", user=self.other_admin)["messages"], [])
        self.reject("hours_approve_outbox_message", code="42501", user=self.other_admin, p_id=row["id"],
                    p_expected_content_hash=row["content_hash"],
                    p_expected_source_revision=row["source_revision"])
        self.reject("hours_withdraw_outbox_message", code="42501", user=self.other_admin, p_id=row["id"])

    def test_an_employee_never_reaches_the_outbox(self):
        week, _ = self.prepared_week()
        action = self.action(week)
        self.sync(week["id"], [action])
        self.reject("hours_outbox_overview", code="42501", user=self.worker)
        self.assertEqual(sql(f"""SELECT count(*) FROM public.hours_outbox_messages
          WHERE organization_id={literal(self.org)};""", role="authenticated", user=self.worker), "0")

    # --- the boundaries that stay ------------------------------------------

    def test_the_whole_route_writes_nothing_outside_its_own_tables(self):
        week, contact = self.prepared_week()
        before = self.outside_rows()
        action = self.action(week)
        self.sync(week["id"], [action])
        claimed = self.outbox_claim()
        rpc("hours_outbox_record_sent", role="service_role", p_id=claimed["messages"][0]["id"],
            p_claim_token=claimed["claim_token"], p_outbound_message_id="<x@ja.invalid>",
            p_conversation_id=None, p_recipients=["planner@klant.invalid"])
        self.assertEqual(before, self.outside_rows(),
                         "The outgoing route may not touch timesheets, invoicing or communications")

    def test_the_release_register_stays_empty_and_unreachable(self):
        week, _ = self.prepared_week()
        action = self.action(week)
        self.sync(week["id"], [action])
        self.assertEqual(sql(f"SELECT count(*) FROM public.hours_day_releases "
                             f"WHERE organization_id={literal(self.org)};"), "0")
        # Still exactly one function may name it, and this ticket added none.
        self.assertEqual(sql("""SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname IN ('public','private') AND p.prosrc LIKE '%hours_day_releases%';"""), "1")


class OutboxFoundationRegression(basis.BasisFoundationRegression):
    """The released foundation regressions; only the helper allowlist grows."""

    def test_rpc_and_private_helper_permissions_no_service_shortcut(self):
        OutboxTests.test_permission_contract_covers_the_new_functions(self)


class OutboxModuleGateTests(basis.BasisModuleGateTests):
    """The released SaaS-gate contract, extended to this ticket's tables."""

    def prepare_all(self):
        day, calls = basis.BasisModuleGateTests.prepare_all(self)
        week_id = sql(f"SELECT week_id FROM public.hours_days WHERE id={literal(day['id'])};")
        company = sql(f"SELECT company_id FROM public.hours_weeks WHERE id={literal(week_id)};")
        contact = str(uuid.uuid4())
        sql(f"""INSERT INTO public.company_contacts(id,organization_id,company_id,email,first_name,last_name)
          VALUES ({literal(contact)},{literal(self.org)},{literal(company)},
            'gate-planner@klant.invalid','Gate','Planner');""")
        rpc("hours_save_mail_template", user=self.admin, p_template_id="uitvraag", p_language="nl",
            p_subject="Uren week {{week}}", p_body="Beste {{ontvanger}}, graag de uren.")
        rpc("hours_save_mail_profile", user=self.admin, p_company_id=company, p_expected_version=0,
            p_rules=[rule(recipients=[contact])], p_late_approval_mode="require_review",
            p_late_approval_window_minutes=60)
        rpc("hours_outbox_sync", role="service_role", p_week_id=week_id, p_issues=[], p_actions=[{
            "dedup_key": f"hours:v1:gate:{uuid.uuid4()}", "rule_id": "klant-uitvraag",
            "mail_type": "hours_request", "party": "customer", "recipient_id": contact,
            "channel": "email", "scheduled_at": "2026-09-14T07:00:00Z",
            "effective_at": "2026-09-14T07:00:00Z", "status": "planned", "reason": None,
            "approval_required": False, "subject": "Uren week 37", "body_html": "<p>Gate</p>",
            "recipients": ["gate-planner@klant.invalid"], "company_contact_id": contact,
            "candidate_id": None, "content_hash": "gate-hash", "request_id": None, "issue": None}])
        # Every new RPC needs its own entry: the released sweep compares this
        # dictionary against every public hours_% function and fails when one is
        # missing, which is exactly how a new route cannot slip past the gate.
        placeholder = str(uuid.uuid4())
        # A real, claimed message. The three RPCs below check the claim before the
        # module gate - they have to, because a row they cannot find has no
        # organisation whose gate could be read - so a made-up id would answer
        # PT409 and prove nothing about the gate at all.
        rpc("hours_outbox_sync", role="service_role", p_week_id=week_id, p_issues=[], p_actions=[{
            "dedup_key": f"hours:v1:gate-send:{uuid.uuid4()}", "rule_id": "klant-uitvraag",
            "mail_type": "hours_request", "party": "customer", "recipient_id": contact,
            "channel": "email", "scheduled_at": "2026-09-14T07:00:00Z",
            "effective_at": "2026-09-14T07:00:00Z", "status": "due", "reason": None,
            "approval_required": False, "subject": "Gate", "body_html": "<p>Gate</p>",
            "recipients": ["gate-planner@klant.invalid"], "company_contact_id": contact,
            "candidate_id": None, "content_hash": "gate-send", "request_id": None, "issue": None}])
        claimed = rpc("hours_outbox_claim", role="service_role", p_limit=1, p_lease_seconds=900,
                      p_organization_id=self.org)
        held = claimed["messages"][0]["id"]
        token = claimed["claim_token"]
        calls["hours_get_mail_profile"] = dict(p_company_id=company)
        calls["hours_save_mail_profile"] = dict(
            p_company_id=company, p_expected_version=1, p_rules=[rule(recipients=[contact])],
            p_late_approval_mode="require_review", p_late_approval_window_minutes=60)
        calls["hours_save_mail_template"] = dict(
            p_template_id="gate", p_language="nl", p_subject="Gate", p_body="Gate")
        calls["hours_outbox_overview"] = dict(p_week_id=week_id, p_company_id=company, p_limit=50)
        calls["hours_approve_outbox_message"] = dict(
            p_id=placeholder, p_expected_content_hash="gate-hash", p_expected_source_revision="gate")
        calls["hours_withdraw_outbox_message"] = dict(p_id=placeholder, p_note=None)
        calls["hours_outbox_due_weeks"] = dict(p_limit=25, p_organization_id=self.org)
        calls["hours_outbox_sync"] = dict(p_week_id=week_id, p_actions=[], p_issues=[])
        calls["hours_outbox_claim"] = dict(
            p_limit=1, p_lease_seconds=300, p_organization_id=self.org)
        calls["hours_outbox_record_sent"] = dict(
            p_id=held, p_claim_token=token, p_outbound_message_id="<gate@ja.invalid>",
            p_conversation_id=None, p_recipients=["gate-planner@klant.invalid"])
        calls["hours_outbox_record_failure"] = dict(
            p_id=held, p_claim_token=token, p_kind="permanent", p_error="gate")
        calls["hours_outbox_release"] = dict(p_id=held, p_claim_token=token)
        return day, calls

    def test_every_workflow_rpc_rejects_both_disabled_and_missing_flag(self):
        """The released sweep, widened with this ticket's twelve RPCs.

        Two of them span organisations by design, because that is how the
        unattended run finds work at all: a switched-off organisation has to
        disappear from their answer rather than make it raise, and that is just
        as closed — there is nothing left to send.
        """
        day, calls = self.prepare_all()
        actual = set(json.loads(sql("SELECT jsonb_agg(proname) FROM pg_proc p JOIN pg_namespace n "
                                    "ON n.oid=p.pronamespace WHERE n.nspname='public' AND proname LIKE 'hours_%' "
                                    "AND proname <> 'hours_get_module_access';")))
        self.assertEqual(set(calls), actual, "New workflow RPCs need an explicit gate test")
        before = self.data_snapshot()
        service_calls = (client.CLIENT_SERVICE_FUNCTIONS | mailintake.MAIL_SERVICE_FUNCTIONS
                         | OUTBOX_SERVICE_FUNCTIONS
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
                        self.assertEqual(rpc(name, role="service_role", p_limit=25,
                                             p_organization_id=self.org), [])
                        continue
                    if name == "hours_outbox_due_weeks":
                        self.assertEqual(rpc(name, role="service_role", **params), [])
                        continue
                    if name == "hours_outbox_claim":
                        # It answers, but with nothing — and it touches nothing.
                        self.assertEqual(rpc(name, role="service_role", **params)["messages"], [])
                        continue
                    is_service = name in service_calls
                    actor = self.worker if name in {"hours_confirm_day", "hours_confirm_days"} else self.admin
                    code = "PT404" if name in client.CLIENT_SERVICE_FUNCTIONS else "42501"
                    self.reject(name, code=code, role="service_role" if is_service else "authenticated",
                                user=None if is_service else actor, **params)
            for name in ("hours_get_week", "hours_list_weeks"):
                self.reject(name, user=self.worker, **calls[name])
            self.assertEqual(before, self.data_snapshot())

    def data_snapshot(self):
        return {table: json.loads(sql(f"SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), '[]') "
                                      f"FROM public.{table} t WHERE organization_id={literal(self.org)};"))
                for table in OUTBOX_TABLES}

    def test_all_twenty_four_tables_hide_disabled_data_and_deny_direct_writes(self):
        raise unittest.SkipTest("Superseded by the twenty-seven-table check that also covers the outbox")

    def test_all_twenty_seven_tables_hide_disabled_data_and_deny_direct_writes(self):
        self.prepare_all()
        before = self.data_snapshot()
        self.assertEqual(len(before), 27)
        self.assertTrue(all(before.values()), "Every gated table must have a nonempty synthetic sample")
        gate.toggle(self.org, False)
        for table in OUTBOX_TABLES:
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
    parser.add_argument("--cleanup", action="store_true", help="Remove the disposable container")
    parser.add_argument("--new-only", action="store_true",
                        help="Development rerun; the final run also repeats the released regressions")
    args = parser.parse_args()
    if args.cleanup:
        qa.owned_container()
        subprocess.run(["docker", "rm", "-f", "-v", qa.CONTAINER], check=True)
        return 0
    # Twenty released migrations plus this ticket's three: twenty becomes twenty-two.
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
        "20260918090000_hours_outbox.sql",
        # The cron migration is deliberately absent: pg_cron is not in the
        # disposable container, and scheduling is not what this proves.
        "20260919090000_hours_outbox_review_fixes.sql",
        "20260920090000_hours_outbox_round_two.sql",
        "20260921090000_hours_outbox_round_three.sql",
        "20260922090000_hours_outbox_round_four.sql",
    )]
    fixtures = [ROOT / "tests/db/hours-workflow-fixture.sql", ROOT / "tests/db/hours-module-gate-fixture.sql",
                ROOT / "tests/db/hours-intake-fixture.sql", ROOT / "tests/db/hours-mail-intake-fixture.sql"]
    harnesses = [ROOT / "scripts" / name for name in (
        "hours-workflow-db-test.py", "hours-classification-db-test.py",
        "hours-module-gate-db-test.py", "hours-conflict-db-test.py", "hours-intake-db-test.py",
        "hours-pages-db-test.py", "hours-workbook-db-test.py", "hours-client-week-db-test.py",
        "hours-scan-db-test.py", "hours-word-mail-db-test.py", "hours-mail-intake-db-test.py",
        "hours-basis-replacement-db-test.py", "hours-outbox-db-test.py")]
    hashes = {path: hashlib.sha256(path.read_bytes()).hexdigest()
              for path in paths + fixtures + harnesses}
    basis.wordmail.conflict.adapt_business_expectations()
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
    classes = [OutboxTests] if args.new_only else [
        OutboxFoundationRegression, gate.EnabledClassificationRegression,
        OutboxModuleGateTests, OutboxTests]
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
        "run_command": "python3 scripts/hours-outbox-db-test.py" + (" --new-only" if args.new_only else ""),
        "output_directory": str(OUTPUT.resolve()),
    }
    OUTPUT.mkdir(parents=True, exist_ok=True)
    path = OUTPUT / "hours-outbox-db-qa-result.json"
    path.write_text(json.dumps(report, indent=2) + "\n")
    print("Result JSON:", path, flush=True)
    return 0 if report["success"] else 1


if __name__ == "__main__":
    sys.exit(main())
