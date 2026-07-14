# Proxy trust

Fastify uses the request's immediate TCP peer as `request.ip` by default and
ignores `X-Forwarded-For`, `X-Forwarded-Host`, and `X-Forwarded-Proto`. This is
the safe setting whenever clients can reach the API directly.

Set `TRUST_PROXY` only when every request path reaches the API through a proxy
that you control or whose forwarding behavior you have verified. The value is
validated at startup:

| Value                                             | Meaning                                            |
| ------------------------------------------------- | -------------------------------------------------- |
| unset, empty, or `false`                          | Trust no proxy (default).                          |
| A positive integer such as `1`                    | Trust exactly that many hops outward from the API. |
| IPs/CIDRs such as `127.0.0.1,10.0.0.0/8,fd00::/8` | Trust only matching proxy peers.                   |
| `loopback`, `linklocal`, `uniquelocal`            | Trust Fastify's supported local-network ranges.    |

`true`, zero or negative hop counts, hostnames, unknown aliases, malformed
addresses/ranges, and lists with empty entries are rejected. Restart the server
after changing the value.

## How the boundary works

Trust is evaluated from the API's immediate TCP peer toward the client, from
right to left through `X-Forwarded-For`. Address policies stop at the first
untrusted hop; that address becomes the verified `request.ip`. An address
claimed inside the header is never enough to make the immediate peer trusted.

Prefer an address or CIDR policy when proxy addresses are stable. A hop count is
appropriate only when every route to the API has exactly the same number of
trusted proxies. If a shorter route exists, a client may occupy a trusted hop
and choose forwarded values.

Examples:

- Directly reachable API: `TRUST_PROXY=false`.
- Tailscale Serve from this repo: `TRUST_PROXY=loopback`. Serve connects to the
  backend over loopback, so only that immediate local peer may supply forwarded
  metadata.
- Standard Render public web service: `TRUST_PROXY=1`. Render does not expose
  the backend port directly to the public internet, and one hop trusts only the
  immediate platform peer. Fastify then uses the nearest (rightmost) forwarded
  address rather than any client-supplied entries farther left. If another
  custom proxy is added in front, re-evaluate the full route instead of
  automatically increasing the count.
- Local proxy followed by a private network proxy:
  `TRUST_PROXY=loopback,10.0.0.0/8`. The chain is accepted only while each hop
  matches one of those ranges.

Both global and auth rate limits key on the verified `request.ip`. OAuth issuer,
authorization endpoints, login redirects, and MCP resource identity always use
`BETTER_AUTH_URL`, `CORS_ORIGIN`, and `MCP_CANONICAL_URL`; proxy headers never
define server identity. See
[ADR-0002](adr/0002-server-identity-from-configured-origin.md).
