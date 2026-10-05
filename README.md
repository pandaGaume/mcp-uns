[![npm](https://img.shields.io/npm/v/@cyanmycelium/mcp-uns)](https://www.npmjs.com/package/@cyanmycelium/mcp-uns)
[![CI](https://github.com/pandaGaume/mcp-uns/actions/workflows/ci.yml/badge.svg)](https://github.com/pandaGaume/mcp-uns/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

<p align="center">
  <img src="https://raw.githubusercontent.com/pandaGaume/mcp-uns/main/docs/assets/logo.png" alt="mcp-uns logo: the network-discovery panda holding a location pin, a namespace tree glowing on its chest" width="180">
</p>

# mcp-uns

Unified Namespace identities for the domains above an [mcp-broker](https://github.com/pandaGaume/mcp-broker): SCADA, history, cache. One resource, one UNS id, in every domain, and one broker policy that governs it everywhere.

```text
uns://site1/line1/motor01/speed   the durable name: no slot, host, session or protocol address
/site1/line1/motor01/speed        the broker resource path the policy evaluates
```

An assignment on `/site1/line1/**` therefore governs the live value (`scada.observe`), its history (`history.read`) and its cached value (`cache.read`) with no second resource model.

## What is in it

| export | role |
|---|---|
| `UnsPath`, `UnsId`, `isPathSegment` | parse and compare UNS ids; `resourcePath`; `contains` by whole segments (`uns://a/b` covers `uns://a/b/c`, not `uns://a/bc`) |
| `IAccessGuard` | where a provider asks before serving, one check per id |
| `BrokerAccessGuard` | the broker decides (`broker/authorize` on behalf of the caller reference), the provider applies and reports outcomes (`broker/audit/result`) |
| `openGuard()` | bench only: allows everything, audits nothing |
| `unsChecks(capability, ids)` | one check per id, with its resource path |
| `callerRefOf(meta)`, `CALLER_META_KEY` | the caller reference the broker attaches to each request |

## Use

```ts
import { DirectTransport } from "@cyanmycelium/mcp-broker-provider";
import { BrokerAccessGuard, unsChecks } from "@cyanmycelium/mcp-uns";

const transport = new DirectTransport(url, { secret });
const guard = new BrokerAccessGuard(transport.broker);

// In a tool handler, with the request context mcp-core 1.4.0 hands an adapter:
const decisions = await guard.authorizeAsync(unsChecks("history.read", ids), request);
```

`BrokerAccessGuard` never substitutes an identity: a request without a caller reference is denied. An `allow-with-constraints` carrying constraints is refused and reported `refused` by default, since a domain with no engineering limits cannot apply them; a domain that applies them (SCADA writes) creates the guard with `{ constraints: "return" }` and receives them on the decision.

The guard depends on no broker package: `IBrokerAuthority` restates the two methods of mcp-broker-provider's `BrokerClient` it uses, and `DirectTransport.broker` satisfies it as is.

## Develop

```sh
npm install
npm run typecheck
npm test
npm run build
```

## License

Apache-2.0.
