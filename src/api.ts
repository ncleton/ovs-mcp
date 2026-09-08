import { OvsError } from "./errors.js";
import {
  loadSession,
  OVS_ORIGIN,
  type OvsSession,
  saveSession,
} from "./session.js";

export interface OvsClientOptions {
  sessionPath: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

export class OvsClient {
  readonly #sessionPath: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #timeoutMs: number;
  #cookies = new Map<string, string>();
  #loaded = false;
  #authenticated = false;

  constructor(options: OvsClientOptions) {
    this.#sessionPath = options.sessionPath;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#timeoutMs = options.timeoutMs ?? 20_000;
  }

  get sessionPath(): string {
    return this.#sessionPath;
  }

  async login(email: string, password: string): Promise<void> {
    if (!email.trim() || !password)
      throw new OvsError(
        "Email and password are required.",
        "OVS_LOGIN_INVALID",
      );
    this.#cookies.clear();
    this.#loaded = true;
    this.#authenticated = false;
    await this.request("/connexion", { redirect: "manual" }, false);
    await this.request(
      "/connexion",
      {
        method: "POST",
        redirect: "manual",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          email: email.trim(),
          password,
          submitLogin: "1",
        }),
      },
      false,
    );
    const account = await this.request(
      "/mon-compte",
      { redirect: "manual" },
      false,
    );
    if (account.status !== 200) {
      this.#cookies.clear();
      throw new OvsError(
        "OVS rejected the email or password.",
        "OVS_LOGIN_REJECTED",
      );
    }
    this.#authenticated = true;
    await this.persist();
  }

  async isAuthenticated(): Promise<boolean> {
    try {
      await this.loadCookies();
      if (this.#cookies.size === 0) return false;
      const response = await this.request(
        "/mon-compte",
        { redirect: "manual" },
        false,
      );
      this.#authenticated = response.status === 200;
      if (this.#authenticated) await this.persist();
      return this.#authenticated;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("session file not found")
      )
        return false;
      throw error;
    }
  }

  async get(path: string, headers?: HeadersInit): Promise<Response> {
    await this.requireAuthenticated();
    return this.request(path, { headers }, true);
  }

  async postForm(
    path: string,
    values: Record<string, string>,
  ): Promise<Response> {
    await this.requireAuthenticated();
    return this.request(
      path,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(values),
      },
      true,
    );
  }

  private async requireAuthenticated(): Promise<void> {
    if (this.#authenticated) return;
    if (!(await this.isAuthenticated())) {
      throw new OvsError(
        "OVS connection required. Call connect_ovs first.",
        "OVS_CONNECTION_REQUIRED",
      );
    }
  }

  private async loadCookies(): Promise<void> {
    if (this.#loaded) return;
    const session = await loadSession(this.#sessionPath);
    this.#cookies = new Map(Object.entries(session.cookies));
    this.#loaded = true;
  }

  private async persist(): Promise<void> {
    const session: OvsSession = {
      version: 2,
      backend: "ovs-website",
      cookies: Object.fromEntries(this.#cookies),
      authenticatedAt: new Date().toISOString(),
    };
    await saveSession(this.#sessionPath, session);
  }

  private async request(
    path: string,
    init: RequestInit,
    persistCookies: boolean,
  ): Promise<Response> {
    if (!path.startsWith("/") || path.startsWith("//"))
      throw new OvsError("Invalid OVS path.", "OVS_INVALID_ENDPOINT");
    const headers = new Headers(init.headers);
    headers.set(
      "accept",
      headers.get("accept") ?? "text/html,application/json;q=0.9,*/*;q=0.8",
    );
    headers.set("accept-language", "fr-FR,fr;q=0.9");
    headers.set(
      "user-agent",
      "ovs-mcp/1.0 (+https://github.com/ncleton/ovs-mcp)",
    );
    if (this.#cookies.size > 0)
      headers.set(
        "cookie",
        [...this.#cookies].map(([key, value]) => `${key}=${value}`).join("; "),
      );
    let response: Response;
    try {
      response = await this.#fetch(`${OVS_ORIGIN}${path}`, {
        ...init,
        headers,
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (error) {
      const timeout =
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError");
      throw new OvsError(
        timeout
          ? `OVS did not answer within ${this.#timeoutMs} ms.`
          : "OVS network request failed.",
        timeout ? "OVS_TIMEOUT" : "OVS_NETWORK_ERROR",
        true,
      );
    }
    this.captureCookies(response.headers);
    if (persistCookies && this.#authenticated) await this.persist();
    if (response.status >= 500)
      throw new OvsError(
        `OVS returned HTTP ${response.status}.`,
        "OVS_UPSTREAM_ERROR",
        true,
      );
    return response;
  }

  private captureCookies(headers: Headers): void {
    const values =
      typeof headers.getSetCookie === "function"
        ? headers.getSetCookie()
        : [headers.get("set-cookie") ?? ""];
    for (const value of values) {
      const pair = value.split(";", 1)[0];
      const separator = pair?.indexOf("=") ?? -1;
      if (!pair || separator < 1) continue;
      const name = pair.slice(0, separator).trim();
      const cookie = pair.slice(separator + 1).trim();
      if (!cookie) this.#cookies.delete(name);
      else this.#cookies.set(name, cookie);
    }
  }
}
