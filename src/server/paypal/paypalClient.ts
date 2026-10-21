// src/server/paypal/paypalClient.ts
// PayPal Orders v2 + Payments v2 client: OAuth2 token cache, idempotent mutations, safe retries.

import { generatePayPalRequestId, type RequestIdOptions } from "./idempotency.js";
import { assertCents, centsToUsdString, usdStringToCents } from "../../shared/money.js";

export const PAYPAL_SANDBOX_BASE_URL = "https://api-m.sandbox.paypal.com";
const TOKEN_EXPIRY_SKEW_MS = 60_000;
const CUSTOM_ID_MAX_LENGTH = 127;
const BATCH_ID_RE = /^[A-Za-z0-9_-]{12}$/;
const SHA256_HEX_RE = /^[a-f0-9]{64}$/;

// ---------- Errors ----------

export class PayPalApiError extends Error {
  override readonly name = "PayPalApiError";
  constructor(
    message: string,
    readonly status: number,
    readonly method: string,
    readonly path: string,
    readonly debugId: string | undefined,
    readonly issue: string | undefined,
    readonly details: unknown,
  ) {
    super(message);
  }
}

// ---------- Wire types (minimal subset) ----------

interface PayPalLink {
  href: string;
  rel: string;
  method?: string;
}

interface PayPalMoney {
  currency_code: string;
  value: string;
}

interface PayPalAuthorization {
  id: string;
  status: string;
  amount?: PayPalMoney;
  expiration_time?: string;
}

interface PayPalOrderResponse {
  id: string;
  status: string;
  links?: PayPalLink[];
  purchase_units?: Array<{
    reference_id?: string;
    payments?: { authorizations?: PayPalAuthorization[] };
  }>;
}

interface PayPalCaptureResponse {
  id: string;
  status: string;
  amount?: PayPalMoney;
  custom_id?: string;
  final_capture?: boolean;
}

interface PayPalTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

interface PayPalErrorBody {
  name?: string;
  message?: string;
  debug_id?: string;
  details?: Array<{ issue?: string; description?: string; field?: string }>;
  error?: string;
  error_description?: string;
}

// ---------- Public types ----------

export interface PayPalClientConfig {
  clientId: string;
  clientSecret: string;
  baseUrl?: string;
  requestTimeoutMs?: number;
  /** Retries for network errors / 429 / 5xx on idempotent requests. */
  maxRetries?: number;
  idempotency?: RequestIdOptions;
  fetchImpl?: typeof fetch;
}

export interface CreateAuthOrderInput {
  batchId: string;
  amountCents: number;
  returnUrl: string;
  cancelUrl: string;
  description?: string;
  brandName?: string;
}

export interface CreateAuthOrderResult {
  orderId: string;
  status: string;
  approvalUrl: string;
  requestId: string;
  raw: PayPalOrderResponse;
}

export interface AuthorizeOrderResult {
  orderId: string;
  orderStatus: string;
  authorizationId: string;
  authorizationStatus: string;
  authorizedCents: number;
  expirationTime: string | undefined;
  requestId: string;
  raw: PayPalOrderResponse;
}

export interface CaptureAuthorizationInput {
  authorizationId: string;
  batchId: string;
  amountCents: number;
  auditSha256: string;
  finalCapture?: boolean;
  invoiceId?: string;
  noteToPayer?: string;
}

export interface CaptureAuthorizationResult {
  captureId: string;
  status: string;
  capturedCents: number;
  customId: string;
  requestId: string;
  raw: PayPalCaptureResponse;
}

export interface VoidAuthorizationResult {
  authorizationId: string;
  status: string;
  requestId: string;
}

export interface GetCaptureResult {
  captureId: string;
  status: string;
  capturedCents: number;
  customId: string | undefined;
  invoiceId: string | undefined;
  finalCapture: boolean | undefined;
  createTime: string | undefined;
  raw: unknown;
}

// ---------- Helpers ----------

/** Builds "VERACT:<batchId_12chars>:<sha256_hex>" (85 chars, hard-capped at 127). */
export function buildVeractCustomId(batchId: string, auditSha256: string): string {
  if (!BATCH_ID_RE.test(batchId)) {
    throw new TypeError(`batchId must be exactly 12 chars [A-Za-z0-9_-], received: "${batchId}"`);
  }
  if (!SHA256_HEX_RE.test(auditSha256)) {
    throw new TypeError("auditSha256 must be a 64-char lowercase hex SHA-256 digest");
  }
  const customId = `VERACT:${batchId}:${auditSha256}`;
  if (customId.length > CUSTOM_ID_MAX_LENGTH) {
    throw new RangeError(`custom_id length ${customId.length} exceeds ${CUSTOM_ID_MAX_LENGTH}`);
  }
  return customId;
}

function assertNonEmptyId(value: string, label: string): void {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
    throw new TypeError(`${label} is invalid: "${String(value)}"`);
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function backoffMs(attempt: number, retryAfterHeader: string | null): number {
  const retryAfterSec = retryAfterHeader ? Number(retryAfterHeader) : NaN;
  if (Number.isFinite(retryAfterSec) && retryAfterSec >= 0) return Math.min(retryAfterSec * 1000, 10_000);
  const base = 250 * 2 ** attempt;
  return base + Math.floor(Math.random() * base);
}

function safeJsonParse(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

// ---------- Client ----------

type HttpMethod = "GET" | "POST";

interface RequestOptions {
  body?: unknown;
  requestId?: string;
}

export class PayPalClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;
  private readonly idempotency: RequestIdOptions;

  private token: { value: string; expiresAt: number } | undefined;
  private tokenInFlight: Promise<string> | undefined;

  constructor(private readonly config: PayPalClientConfig) {
    if (!config.clientId || !config.clientSecret) {
      throw new TypeError("PayPalClient requires clientId and clientSecret");
    }
    this.baseUrl = (config.baseUrl ?? PAYPAL_SANDBOX_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = config.requestTimeoutMs ?? 15_000;
    this.maxRetries = config.maxRetries ?? 2;
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.idempotency = config.idempotency ?? {};
  }

  // ----- OAuth2 -----

  async getAccessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt - TOKEN_EXPIRY_SKEW_MS) {
      return this.token.value;
    }
    // Single-flight: concurrent callers share one token request.
    this.tokenInFlight ??= this.fetchToken().finally(() => {
      this.tokenInFlight = undefined;
    });
    return this.tokenInFlight;
  }

  invalidateToken(): void {
    this.token = undefined;
  }

  private async fetchToken(): Promise<string> {
    const path = "/v1/oauth2/token";
    const basic = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`, "utf8").toString("base64");
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({ grant_type: "client_credentials" }).toString(),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const parsed = safeJsonParse(await res.text()) as (PayPalTokenResponse & PayPalErrorBody) | undefined;
    if (!res.ok || !parsed?.access_token) {
      throw new PayPalApiError(
        `OAuth2 token request failed: ${parsed?.error_description ?? parsed?.error ?? res.statusText}`,
        res.status,
        "POST",
        path,
        res.headers.get("paypal-debug-id") ?? undefined,
        parsed?.error,
        parsed,
      );
    }
    this.token = {
      value: parsed.access_token,
      expiresAt: Date.now() + parsed.expires_in * 1000,
    };
    return parsed.access_token;
  }

  // ----- Core request -----

  private async request<T>(method: HttpMethod, path: string, opts: RequestOptions = {}): Promise<T | undefined> {
    // Mutations are only retried when protected by PayPal-Request-Id.
    const retryable = method === "GET" || Boolean(opts.requestId);
    let attempt = 0;
    let refreshedAfter401 = false;

    for (;;) {
      const accessToken = await this.getAccessToken();
      const headers: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        Prefer: "return=representation",
      };
      if (opts.requestId) headers["PayPal-Request-Id"] = opts.requestId;

      let res: Response;
      try {
        res = await this.fetchImpl(`${this.baseUrl}${path}`, {
          method,
          headers,
          body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (err) {
        if (retryable && attempt < this.maxRetries) {
          await sleep(backoffMs(attempt++, null));
          continue;
        }
        throw new PayPalApiError(
          `Network error calling PayPal ${method} ${path}: ${(err as Error).message}`,
          0,
          method,
          path,
          undefined,
          "NETWORK_ERROR",
          err,
        );
      }

      if (res.status === 401 && !refreshedAfter401) {
        refreshedAfter401 = true;
        this.invalidateToken();
        continue;
      }

      if ((res.status === 429 || res.status >= 500) && retryable && attempt < this.maxRetries) {
        await res.body?.cancel().catch(() => undefined);
        await sleep(backoffMs(attempt++, res.headers.get("retry-after")));
        continue;
      }

      const text = await res.text();
      const parsed = safeJsonParse(text);

      if (!res.ok) {
        const errBody = (parsed ?? {}) as PayPalErrorBody;
        const firstDetail = errBody.details?.[0];
        throw new PayPalApiError(
          `PayPal ${method} ${path} failed (${res.status}): ${errBody.name ?? "UNKNOWN_ERROR"} - ${
            firstDetail?.description ?? errBody.message ?? res.statusText
          }`,
          res.status,
          method,
          path,
          errBody.debug_id ?? res.headers.get("paypal-debug-id") ?? undefined,
          firstDetail?.issue ?? errBody.name,
          parsed,
        );
      }

      return parsed as T | undefined;
    }
  }

  private requestId(...args: Parameters<typeof generatePayPalRequestId>): string {
    return generatePayPalRequestId(args[0], args[1], { ...this.idempotency, ...args[2] });
  }

  // ----- Orders v2 -----

  async createAuthOrder(input: CreateAuthOrderInput): Promise<CreateAuthOrderResult> {
    if (!BATCH_ID_RE.test(input.batchId)) {
      throw new TypeError(`batchId must be exactly 12 chars [A-Za-z0-9_-], received: "${input.batchId}"`);
    }
    assertCents(input.amountCents, "amountCents");
    if (input.amountCents === 0) throw new RangeError("amountCents must be > 0");

    const requestId = this.requestId("orders.create", [input.batchId, input.amountCents, "USD"]);
    const body = {
      intent: "AUTHORIZE",
      purchase_units: [
        {
          reference_id: input.batchId,
          description: (input.description ?? `Veract batch ${input.batchId}`).slice(0, 127),
          amount: { currency_code: "USD", value: centsToUsdString(input.amountCents) },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: (input.brandName ?? "Veract").slice(0, 127),
            shipping_preference: "NO_SHIPPING",
            user_action: "PAY_NOW",
            return_url: input.returnUrl,
            cancel_url: input.cancelUrl,
          },
        },
      },
    };

    const order = await this.request<PayPalOrderResponse>("POST", "/v2/checkout/orders", { body, requestId });
    if (!order?.id) throw new Error("PayPal create order returned no order id");

    const approval = order.links?.find((l) => l.rel === "payer-action" || l.rel === "approve");
    if (!approval) throw new Error(`PayPal order ${order.id} has no approval link (status ${order.status})`);

    return { orderId: order.id, status: order.status, approvalUrl: approval.href, requestId, raw: order };
  }

  async authorizeOrder(orderId: string): Promise<AuthorizeOrderResult> {
    assertNonEmptyId(orderId, "orderId");
    const requestId = this.requestId("orders.authorize", [orderId]);
    const order = await this.request<PayPalOrderResponse>(
      "POST",
      `/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`,
      { body: {}, requestId },
    );
    const auth = order?.purchase_units?.[0]?.payments?.authorizations?.[0];
    if (!order || !auth?.id) {
      throw new Error(`PayPal authorize for order ${orderId} returned no authorization`);
    }
    if (auth.amount && auth.amount.currency_code !== "USD") {
      throw new Error(`Unexpected authorization currency: ${auth.amount.currency_code}`);
    }
    return {
      orderId: order.id,
      orderStatus: order.status,
      authorizationId: auth.id,
      authorizationStatus: auth.status,
      authorizedCents: auth.amount ? usdStringToCents(auth.amount.value) : 0,
      expirationTime: auth.expiration_time,
      requestId,
      raw: order,
    };
  }

  // ----- Payments v2 -----

  async captureAuthorization(input: CaptureAuthorizationInput): Promise<CaptureAuthorizationResult> {
    assertNonEmptyId(input.authorizationId, "authorizationId");
    assertCents(input.amountCents, "amountCents");
    if (input.amountCents === 0) throw new RangeError("Capture amount must be > 0; use voidAuthorization instead");

    const finalCapture = input.finalCapture ?? true;
    const customId = buildVeractCustomId(input.batchId, input.auditSha256);
    const requestId = this.requestId("authorizations.capture", [
      input.authorizationId,
      input.amountCents,
      finalCapture ? 1 : 0,
      input.auditSha256,
    ]);

    const body: Record<string, unknown> = {
      amount: { currency_code: "USD", value: centsToUsdString(input.amountCents) },
      final_capture: finalCapture,
      custom_id: customId,
    };
    if (input.invoiceId) body.invoice_id = input.invoiceId.slice(0, 127);
    if (input.noteToPayer) body.note_to_payer = input.noteToPayer.slice(0, 255);

    const capture = await this.request<PayPalCaptureResponse>(
      "POST",
      `/v2/payments/authorizations/${encodeURIComponent(input.authorizationId)}/capture`,
      { body, requestId },
    );
    if (!capture?.id) throw new Error(`PayPal capture for ${input.authorizationId} returned no capture id`);

    const capturedCents = capture.amount ? usdStringToCents(capture.amount.value) : input.amountCents;
    if (capturedCents !== input.amountCents) {
      throw new Error(`Capture amount mismatch: requested ${input.amountCents}¢, PayPal reported ${capturedCents}¢`);
    }

    return {
      captureId: capture.id,
      status: capture.status,
      capturedCents,
      customId,
      requestId,
      raw: capture,
    };
  }

  async voidAuthorization(authorizationId: string): Promise<VoidAuthorizationResult> {
    assertNonEmptyId(authorizationId, "authorizationId");
    const requestId = this.requestId("authorizations.void", [authorizationId]);
    // 204 No Content (minimal) or 200 with representation.
    const result = await this.request<PayPalAuthorization>(
      "POST",
      `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/void`,
      { requestId },
    );
    return { authorizationId, status: result?.status ?? "VOIDED", requestId };
  }

  async getCaptureDetails(captureId: string): Promise<GetCaptureResult> {
    assertNonEmptyId(captureId, "captureId");
    const result = await this.request<
      PayPalCaptureResponse & { invoice_id?: string; create_time?: string }
    >("GET", `/v2/payments/captures/${encodeURIComponent(captureId)}`);
    if (!result?.id) {
      throw new Error(`PayPal GET capture ${captureId} returned no id`);
    }
    return {
      captureId: result.id,
      status: result.status,
      capturedCents: result.amount ? usdStringToCents(result.amount.value) : 0,
      customId: result.custom_id,
      invoiceId: result.invoice_id,
      finalCapture: result.final_capture,
      createTime: result.create_time,
      raw: result,
    };
  }
}
