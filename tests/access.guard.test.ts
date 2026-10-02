import { describe, expect, it } from "vitest";
import { AccessUnavailableError, BrokerAccessGuard, CALLER_META_KEY, openGuard, unsChecks, type IBrokerAuthority } from "../src/index";

const CHECK = { capability: "history.read", resource: "uns://site1/a", resourcePath: "/site1/a" };
const meta = { [CALLER_META_KEY]: { ref: "ref-1", correlationId: "c-1" } };

function fakeBroker(answer: IBrokerAuthority["authorize"]): IBrokerAuthority & { reports: unknown[]; queries: unknown[] } {
    const reports: unknown[] = [];
    const queries: unknown[] = [];
    return {
        reports,
        queries,
        authorize: (query) => {
            queries.push(query);
            return answer(query);
        },
        reportResult: (report) => reports.push(report),
    };
}

describe("BrokerAccessGuard", () => {
    it("denies everything, without asking, when the request carries no caller reference", async () => {
        const broker = fakeBroker(async () => ({ policyVersion: "1", decisions: [] }));
        const decisions = await new BrokerAccessGuard(broker).authorizeAsync([CHECK], {});
        expect(decisions).toEqual([{ allowed: false, reason: "no-caller-reference" }]);
        expect(broker.queries).toEqual([]);
    });

    it("asks on behalf of the caller reference", async () => {
        const broker = fakeBroker(async () => ({ policyVersion: "1", decisions: [{ decisionId: "d1", effect: "allow", allowed: true, reason: "role-grant" }] }));
        expect(await new BrokerAccessGuard(broker).authorizeAsync([CHECK], { meta })).toEqual([{ allowed: true, decisionId: "d1", reason: "role-grant" }]);
        expect(broker.queries).toEqual([{ principal: { type: "caller-ref", ref: "ref-1" }, checks: [CHECK] }]);
    });

    it("refuses, and reports refused, an allow whose constraints it cannot apply", async () => {
        const broker = fakeBroker(async () => ({
            policyVersion: "1",
            decisions: [{ decisionId: "d1", effect: "allow-with-constraints", allowed: false, reason: "role-grant", obligations: { constraints: { maxValue: 10 } } }],
        }));
        expect(await new BrokerAccessGuard(broker).authorizeAsync([CHECK], { meta })).toEqual([{ allowed: false, decisionId: "d1", reason: "constraints-not-applicable" }]);
        expect(broker.reports).toEqual([{ decisionId: "d1", result: "refused", errorCode: "unsupported_capability" }]);
    });

    it("applies an allow-with-constraints that carries no constraint as an allow", async () => {
        const broker = fakeBroker(async () => ({
            policyVersion: "1",
            decisions: [{ decisionId: "d1", effect: "allow-with-constraints", allowed: false, reason: "budget", obligations: {} }],
        }));
        expect((await new BrokerAccessGuard(broker).authorizeAsync([CHECK], { meta }))[0]!.allowed).toBe(true);
    });

    it("fails the request with authorization_unavailable when the broker gives no decision", async () => {
        const broker = fakeBroker(async () => {
            throw new Error("socket closed");
        });
        const error = await new BrokerAccessGuard(broker).authorizeAsync([CHECK], { meta }).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(AccessUnavailableError);
        expect((error as AccessUnavailableError).code).toBe("authorization_unavailable");
    });

    it("reports outcomes under the decision id, and ignores decisions without one", () => {
        const broker = fakeBroker(async () => ({ policyVersion: "1", decisions: [] }));
        const guard = new BrokerAccessGuard(broker);
        guard.report({ allowed: true, decisionId: "d1", reason: "x" }, "failure", "store_unavailable");
        guard.report({ allowed: true, reason: "open" }, "success");
        expect(broker.reports).toEqual([{ decisionId: "d1", result: "failure", errorCode: "store_unavailable" }]);
    });
});

describe("constraints: return", () => {
    it("hands the constraints to a domain that applies them", async () => {
        const broker = fakeBroker(async () => ({
            policyVersion: "1",
            decisions: [{ decisionId: "d1", effect: "allow-with-constraints", allowed: false, reason: "role-grant", obligations: { constraints: { maxValue: 10 } } }],
        }));
        const [decision] = await new BrokerAccessGuard(broker, { constraints: "return" }).authorizeAsync([CHECK], { meta });
        expect(decision).toEqual({ allowed: true, decisionId: "d1", reason: "role-grant", constraints: { maxValue: 10 } });
        expect(broker.reports).toEqual([]);
    });
});

describe("unsChecks and openGuard", () => {
    it("builds one check per id with the broker resource path", () => {
        expect(unsChecks("history.read", ["uns://site1/a", "uns://site1/b/c"])).toEqual([
            { capability: "history.read", resource: "uns://site1/a", resourcePath: "/site1/a" },
            { capability: "history.read", resource: "uns://site1/b/c", resourcePath: "/site1/b/c" },
        ]);
        expect(() => unsChecks("history.read", ["site1/a"])).toThrow(/uns:\/\//);
    });

    it("openGuard allows everything and audits nothing", async () => {
        expect(await openGuard().authorizeAsync([CHECK, CHECK])).toEqual([
            { allowed: true, reason: "open-guard" },
            { allowed: true, reason: "open-guard" },
        ]);
    });
});
