import { UnsPath, type UnsId } from "./uns";

/** The `params._meta` key under which the broker passes the caller reference (mcp-broker-provider `CALLER_META_KEY`). */
export const CALLER_META_KEY = "io.cyanmycelium/caller";

/** What a provider knows about a request, beyond its arguments (mcp-core `IMcpRequestContext`). */
export interface IAccessContext {
    readonly meta?: Readonly<Record<string, unknown>>;
}

/** One question: may the caller do `capability` on this resource? */
export interface IAccessCheck {
    readonly capability: string;
    /** The native id, for the audit: a UNS id. */
    readonly resource: string;
    /** The path the policy evaluates: `uns://a/b` is `/a/b`. */
    readonly resourcePath: string;
}

export interface IAccessDecision {
    readonly allowed: boolean;
    /** Present when a broker decided; report the outcome under it when the capability requires a result. */
    readonly decisionId?: string;
    readonly reason: string;
    /** Engineering limits that come with the allow, for a guard created with `constraints: "return"`. */
    readonly constraints?: object;
}

export type AccessOutcome = "success" | "failure" | "refused";

/**
 * Where a provider asks before serving. It never decides itself: an
 * implementation forwards to the broker, or, on a bench, allows everything
 * and says so.
 */
export interface IAccessGuard {
    /** One decision per check, in the same order. Rejects with {@link AccessUnavailableError} when no decision can be had. */
    authorizeAsync(checks: readonly IAccessCheck[], context?: IAccessContext): Promise<IAccessDecision[]>;
    /** The outcome of what a decision allowed. A no-op for decisions without an id. */
    report(decision: IAccessDecision, outcome: AccessOutcome, errorCode?: string): void;
}

/** No decision could be had: the broker is unreachable, or answered something else than asked. */
export class AccessUnavailableError extends Error {
    readonly code = "authorization_unavailable";

    constructor(message: string) {
        super(message);
        this.name = "AccessUnavailableError";
    }
}

/** One check per id, with the resource path the broker evaluates. Throws on an id that is not a UNS id. */
export function unsChecks(capability: string, ids: readonly UnsId[]): IAccessCheck[] {
    return ids.map((id) => ({ capability, resource: id, resourcePath: UnsPath.parse(id).resourcePath }));
}

/**
 * Allows everything, without asking anyone. For tests and a single-operator
 * bench only: nothing is audited, and every caller is everyone.
 */
export function openGuard(): IAccessGuard {
    return {
        async authorizeAsync(checks) {
            return checks.map(() => ({ allowed: true, reason: "open-guard" }));
        },
        report() {},
    };
}

// ── Broker mode ─────────────────────────────────────────────────────────────

/**
 * The part of mcp-broker-provider's `BrokerClient` (`transport.broker`) the
 * guard uses, restated so this package does not depend on the provider:
 * `DirectTransport.broker` satisfies it as is.
 */
export interface IBrokerAuthority {
    authorize(query: { readonly principal: { readonly type: "caller-ref"; readonly ref: string }; readonly checks: readonly IAccessCheck[] }): Promise<{
        readonly policyVersion: string;
        readonly decisions: readonly {
            readonly decisionId: string;
            readonly effect: "allow" | "deny" | "allow-with-constraints";
            readonly allowed: boolean;
            readonly reason: string;
            readonly obligations?: { readonly constraints?: object };
        }[];
    }>;
    reportResult(report: { readonly decisionId: string; readonly result: AccessOutcome; readonly errorCode?: string }): void;
}

/** Reads the caller reference the broker attached to a request, or `undefined`. */
export function callerRefOf(meta: Readonly<Record<string, unknown>> | undefined): string | undefined {
    const value = meta?.[CALLER_META_KEY];
    if (typeof value !== "object" || value === null) return undefined;
    const ref = (value as { ref?: unknown }).ref;
    return typeof ref === "string" && ref.length > 0 ? ref : undefined;
}

export interface IBrokerAccessGuardOptions {
    /**
     * What to do with an `allow-with-constraints` that carries constraints:
     * - `refuse` (default): the domain has no engineering limits to apply, so
     *   it refuses rather than oversteps, and reports `refused`;
     * - `return`: the decision is an allow carrying `constraints`, and the
     *   domain applies them right before executing (SCADA writes).
     */
    readonly constraints?: "refuse" | "return";
}

/**
 * The broker decides; the provider applies.
 *
 * Without a caller reference (no declaration accepted, or a request that did
 * not come through the broker) every check is denied: the provider never
 * substitutes an identity of its own.
 */
export class BrokerAccessGuard implements IAccessGuard {
    private readonly _constraints: "refuse" | "return";

    constructor(
        private readonly _broker: IBrokerAuthority,
        options: IBrokerAccessGuardOptions = {}
    ) {
        this._constraints = options.constraints ?? "refuse";
    }

    async authorizeAsync(checks: readonly IAccessCheck[], context?: IAccessContext): Promise<IAccessDecision[]> {
        if (checks.length === 0) return [];
        const ref = callerRefOf(context?.meta);
        if (!ref) return checks.map(() => ({ allowed: false, reason: "no-caller-reference" }));

        let answer: Awaited<ReturnType<IBrokerAuthority["authorize"]>>;
        try {
            answer = await this._broker.authorize({ principal: { type: "caller-ref", ref }, checks });
        } catch (error) {
            throw new AccessUnavailableError(`the broker gave no decision: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (answer.decisions.length !== checks.length) throw new AccessUnavailableError("the broker answered a different number of checks");

        return answer.decisions.map((decision) => {
            if (decision.effect === "allow") return { allowed: true, decisionId: decision.decisionId, reason: decision.reason };
            if (decision.effect === "allow-with-constraints") {
                const constraints = decision.obligations?.constraints;
                if (!constraints || Object.keys(constraints).length === 0) return { allowed: true, decisionId: decision.decisionId, reason: decision.reason };
                if (this._constraints === "return") return { allowed: true, decisionId: decision.decisionId, reason: decision.reason, constraints };
                this._broker.reportResult({ decisionId: decision.decisionId, result: "refused", errorCode: "unsupported_capability" });
                return { allowed: false, decisionId: decision.decisionId, reason: "constraints-not-applicable" };
            }
            return { allowed: false, decisionId: decision.decisionId, reason: decision.reason };
        });
    }

    report(decision: IAccessDecision, outcome: AccessOutcome, errorCode?: string): void {
        if (!decision.decisionId) return;
        this._broker.reportResult({ decisionId: decision.decisionId, result: outcome, ...(errorCode ? { errorCode } : {}) });
    }
}
