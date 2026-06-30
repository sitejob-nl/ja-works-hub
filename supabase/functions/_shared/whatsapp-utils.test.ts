import {
  buildWhatsAppProviderPayload,
  markWhatsAppMessageRead,
  sendOutboundWhatsApp,
  WhatsAppProviderError,
  type WhatsAppProviderAdapter,
} from "./whatsapp-utils.ts";

type Operation = {
  table: string;
  action: "select" | "insert" | "update";
  payload?: unknown;
  filters: Record<string, unknown>;
};

function assert(condition: unknown, message = "assertion failed"): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown, message = "values are not equal") {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message}\nactual:   ${actualJson}\nexpected: ${expectedJson}`);
  }
}

class FakeQuery {
  private action: Operation["action"] = "select";
  private payload: unknown;
  private filters: Record<string, unknown> = {};

  constructor(
    private readonly table: string,
    private readonly operations: Operation[],
    private readonly rows: Record<string, any[]>,
  ) {}

  select() {
    return this;
  }

  insert(payload: unknown) {
    this.action = "insert";
    this.payload = payload;
    return this;
  }

  update(payload: unknown) {
    this.action = "update";
    this.payload = payload;
    return this;
  }

  eq(key: string, value: unknown) {
    this.filters[key] = value;
    return this;
  }

  maybeSingle() {
    return this;
  }

  single() {
    return this;
  }

  then(resolve: (value: { data: any; error: any }) => void) {
    this.operations.push({
      table: this.table,
      action: this.action,
      payload: this.payload,
      filters: this.filters,
    });

    if (this.action === "select") {
      const row = (this.rows[this.table] ?? []).find((candidate) =>
        Object.entries(this.filters).every(([key, value]) => candidate[key] === value)
      );
      resolve({ data: row ?? null, error: null });
      return;
    }

    if (this.action === "insert" && this.table === "communications") {
      resolve({ data: { id: "comm-1" }, error: null });
      return;
    }

    resolve({ data: null, error: null });
  }
}

function fakeClient(input: {
  rows?: Record<string, any[]>;
  credentials?: any[] | null;
} = {}) {
  const operations: Operation[] = [];
  const rpcCalls: Array<{ fn: string; args?: Record<string, unknown> }> = [];
  return {
    operations,
    rpcCalls,
    client: {
      from: (table: string) => new FakeQuery(table, operations, input.rows ?? {}),
      rpc: (fn: string, args?: Record<string, unknown>) => {
        rpcCalls.push({ fn, args });
        if (fn === "get_whatsapp_token") {
          return Promise.resolve({ data: input.credentials ?? [], error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
    },
  };
}

const credentials = [{
  phone_number_id: "phone-number-id",
  decrypted_access_token: "access-token",
  waba_id: "waba-id",
  display_phone: "+31612345678",
  decrypted_webhook_secret: "secret",
}];

Deno.test("buildWhatsAppProviderPayload normaliseert nummers en verbergt Meta-shape voor callers", () => {
  const built = buildWhatsAppProviderPayload({
    to: "06 12 34 56 78",
    type: "text",
    text: { body: "Hoi", preview_url: true },
    context: { message_id: "wamid.reply" },
  });

  assertEquals(built.normalizedTo, "+31612345678");
  assertEquals(built.messageBody, "Hoi");
  assertEquals(built.payload, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: "31612345678",
    type: "text",
    text: { body: "Hoi", preview_url: true },
    context: { message_id: "wamid.reply" },
  });
});

Deno.test("sendOutboundWhatsApp stopt bij pause en logt concept zonder credentials/provider-call", async () => {
  const { client, operations, rpcCalls } = fakeClient({
    rows: {
      organizations: [{ id: "org-1", settings: { outbound_paused: { whatsapp: true } } }],
    },
    credentials,
  });
  let providerCalled = false;
  const provider: WhatsAppProviderAdapter = {
    async sendMessage() {
      providerCalled = true;
      return { messageId: "wamid.sent" };
    },
  };

  const result = await sendOutboundWhatsApp(client, {
    orgId: "org-1",
    to: "0612345678",
    type: "text",
    text: { body: "Niet versturen" },
    candidateId: "candidate-1",
    sentBy: "user-1",
    provider,
  });

  assertEquals(result.paused, true);
  assertEquals(providerCalled, false);
  assertEquals(rpcCalls.length, 0, "credentials mogen niet geladen worden als WhatsApp gepauzeerd is");
  const concept = operations.find((operation) => operation.table === "communications" && operation.action === "insert");
  assert(concept, "concept communication ontbreekt");
  assertEquals((concept?.payload as any).message_type, "concept");
  assertEquals((concept?.payload as any).body, "Niet versturen");
});

Deno.test("sendOutboundWhatsApp gebruikt mock-provider en logt succesvolle outbound communicatie", async () => {
  const { client, operations } = fakeClient({
    rows: {
      organizations: [{ id: "org-1", settings: {} }],
    },
    credentials,
  });
  let providerPayload: Record<string, unknown> | null = null;
  const provider: WhatsAppProviderAdapter = {
    async sendMessage(input) {
      providerPayload = input.payload;
      return { messageId: "wamid.sent" };
    },
  };

  const result = await sendOutboundWhatsApp(client, {
    orgId: "org-1",
    to: "+31 6 12 34 56 78",
    type: "text",
    text: { body: "Versturen" },
    candidateId: "candidate-1",
    sentBy: "user-1",
    provider,
  });

  assertEquals(result.success, true);
  assertEquals(result.messageId, "wamid.sent");
  assertEquals(result.communicationId, "comm-1");
  assert(providerPayload, "provider payload ontbreekt");
  assertEquals((providerPayload as Record<string, unknown>).to, "31612345678");
  const outbound = operations.find((operation) => operation.table === "communications" && operation.action === "insert");
  assertEquals((outbound?.payload as any).whatsapp_message_id, "wamid.sent");
  assertEquals((outbound?.payload as any).whatsapp_status, "pending");
});

Deno.test("sendOutboundWhatsApp classificeert provider errors zonder communication success-log", async () => {
  const { client, operations } = fakeClient({
    rows: {
      organizations: [{ id: "org-1", settings: {} }],
    },
    credentials,
  });
  const provider: WhatsAppProviderAdapter = {
    async sendMessage() {
      throw new WhatsAppProviderError("Meta stuk", {
        providerStatus: 503,
        providerCode: "temporarily_unavailable",
      });
    },
  };

  const result = await sendOutboundWhatsApp(client, {
    orgId: "org-1",
    to: "0612345678",
    type: "text",
    text: { body: "Probeersel" },
    candidateId: "candidate-1",
    provider,
  });

  assertEquals(result.success, false);
  assertEquals(result.reason, "provider_error");
  assertEquals(result.httpStatus, 502);
  assertEquals(result.providerStatus, 503);
  assert(!operations.some((operation) => operation.table === "communications" && operation.action === "insert"));
});

Deno.test("markWhatsAppMessageRead gebruikt dezelfde credentials en mock-adapter", async () => {
  const { client } = fakeClient({ credentials });
  let markedId: string | null = null;
  const provider: WhatsAppProviderAdapter = {
    async sendMessage() {
      return { messageId: "unused" };
    },
    async markMessageRead(input) {
      markedId = input.messageId;
    },
  };

  const result = await markWhatsAppMessageRead(client, {
    orgId: "org-1",
    messageId: "wamid.inbound",
    provider,
  });

  assertEquals(result.success, true);
  assertEquals(markedId, "wamid.inbound");
});
