/** A Unified Namespace id, `uns://segment/segment/...`. */
export type UnsId = string;

const SCHEME = "uns://";
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

/** True when `value` is usable as one segment of a UNS id or of a broker resource path. */
export function isPathSegment(value: unknown): value is string {
    return typeof value === "string" && SEGMENT.test(value) && value !== "." && value !== "..";
}

/**
 * A parsed Unified Namespace identity.
 *
 * The UNS id is the durable name of a resource: it carries no slot, host,
 * session or protocol address. Its path is also the MCP Broker resource path
 * the policy engine evaluates (`uns://a/b/c` is `/a/b/c`), so one subtree
 * assignment governs a resource in every domain that names it by UNS id:
 * its live value (SCADA), its history, its cached value.
 */
export class UnsPath {
    readonly segments: readonly string[];

    private constructor(segments: readonly string[]) {
        this.segments = Object.freeze([...segments]);
    }

    static parse(id: UnsId): UnsPath {
        if (typeof id !== "string" || !id.startsWith(SCHEME)) throw new Error(`UNS id "${String(id)}" must start with "${SCHEME}".`);
        const body = id.slice(SCHEME.length).replace(/\/$/, "");
        if (!body) throw new Error(`UNS id "${id}" has no path.`);
        const segments = body.split("/");
        for (const segment of segments) {
            if (!isPathSegment(segment)) throw new Error(`UNS id "${id}" has an invalid segment "${segment}".`);
        }
        return new UnsPath(segments);
    }

    static tryParse(id: UnsId): UnsPath | undefined {
        try {
            return UnsPath.parse(id);
        } catch {
            return undefined;
        }
    }

    /** The canonical id, without a trailing slash. */
    get id(): UnsId {
        return `${SCHEME}${this.segments.join("/")}`;
    }

    /** The MCP Broker resource path: `uns://a/b/c` is `/a/b/c`. */
    get resourcePath(): string {
        return `/${this.segments.join("/")}`;
    }

    /** A descendant: `uns://a/b` with `c`, `d` is `uns://a/b/c/d`. Throws on an invalid segment. */
    child(...segments: string[]): UnsPath {
        return UnsPath.parse(`${this.id}/${segments.join("/")}`);
    }

    /** True when `other` is this path or one of its descendants. */
    contains(other: UnsPath): boolean {
        return other.segments.length >= this.segments.length && this.segments.every((segment, index) => other.segments[index] === segment);
    }

    toString(): string {
        return this.id;
    }
}
