import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildParticipantSearch,
  MAX_PARTICIPANT_EMAILS,
  messageMatchesParticipants,
  messageParticipantAddresses,
} from "./outlook-mail-filter.ts";

const msg = (over: Record<string, unknown> = {}) => ({
  from: { emailAddress: { address: "Jeroen@jawerkt.nl" } },
  toRecipients: [{ emailAddress: { address: "m.kox@baxmetaal.nl" } }],
  ccRecipients: [{ emailAddress: { address: "info@jawerkt.nl" } }],
  ...over,
});

Deno.test("buildParticipantSearch: één adres → één quoted KQL-term", () => {
  assertEquals(buildParticipantSearch(["m.kox@baxmetaal.nl"]), '"participants:m.kox@baxmetaal.nl"');
});

Deno.test("buildParticipantSearch: meerdere adressen → OR binnen één set aanhalingstekens", () => {
  assertEquals(
    buildParticipantSearch([" M.Swaanen@bm-holding.nl ", "facturen@baxmetaal.nl", "m.kox@baxmetaal.nl", "m.kox@baxmetaal.nl"]),
    '"participants:m.swaanen@bm-holding.nl OR participants:facturen@baxmetaal.nl OR participants:m.kox@baxmetaal.nl"',
  );
});

Deno.test("buildParticipantSearch: leeg → null, en cap op MAX_PARTICIPANT_EMAILS", () => {
  assertEquals(buildParticipantSearch([]), null);
  assertEquals(buildParticipantSearch(["", "  "]), null);
  const many = Array.from({ length: MAX_PARTICIPANT_EMAILS + 5 }, (_, i) => `p${i}@x.nl`);
  const built = buildParticipantSearch(many)!;
  assertEquals(built.split(" OR ").length, MAX_PARTICIPANT_EMAILS);
});

Deno.test("messageParticipantAddresses: from/sender/to/cc/bcc, lowercase, ontdubbeld", () => {
  const addresses = messageParticipantAddresses(msg({
    sender: { emailAddress: { address: "jeroen@jawerkt.nl" } },
    bccRecipients: [{ emailAddress: { address: "Verborgen@voorbeeld.nl" } }, null],
  }));
  assertEquals(addresses, ["jeroen@jawerkt.nl", "m.kox@baxmetaal.nl", "info@jawerkt.nl", "verborgen@voorbeeld.nl"]);
});

Deno.test("messageMatchesParticipants: treffer op elk deelnemersveld, anders uitgesloten", () => {
  assertEquals(messageMatchesParticipants(msg(), ["M.KOX@baxmetaal.nl"]), true);
  assertEquals(messageMatchesParticipants(msg(), ["info@jawerkt.nl"]), true);
  assertEquals(messageMatchesParticipants(msg({ bccRecipients: [{ emailAddress: { address: "bcc@baxmetaal.nl" } }] }), ["bcc@baxmetaal.nl"]), true);
  assertEquals(messageMatchesParticipants(msg(), ["joos.vermolen@spacemonline.com"]), false);
  assertEquals(messageMatchesParticipants({}, ["x@y.nl"]), false);
});

Deno.test("messageMatchesParticipants: zonder gewenste adressen geen filter", () => {
  assertEquals(messageMatchesParticipants(msg(), []), true);
});
