# Production-like HTTPS dev over Tailscale

Strict OAuth clients require the authorization-server issuer, token `iss`, and
MCP resource metadata to agree on the same HTTPS API origin. To keep local dev
close to production, serve the frontend and API as separate HTTPS origins through
[Tailscale Serve](https://tailscale.com/kb/1242/tailscale-serve):

- Web: `https://<machine>.<tailnet>.ts.net:5200`
- API/Auth/MCP: `https://<machine>.<tailnet>.ts.net`

1. Enable MagicDNS and HTTPS certificates for the tailnet in Tailscale.
2. Start the app locally with `pnpm go`.
3. Start the HTTPS reverse proxies with `pnpm tailscale:serve`.
4. Set these values in `.env`, replacing the host with this machine's MagicDNS name:

```sh
VITE_SERVER_URL=https://<machine>.<tailnet>.ts.net
CORS_ORIGIN=https://<machine>.<tailnet>.ts.net:5200
BETTER_AUTH_URL=https://<machine>.<tailnet>.ts.net
MCP_CANONICAL_URL=https://<machine>.<tailnet>.ts.net/mcp
VITE_ALLOWED_HOSTS=<machine>.<tailnet>.ts.net
TRUST_PROXY=loopback
```

Then restart `pnpm go` and open the web app at
`https://<machine>.<tailnet>.ts.net:5200`.

`loopback` trusts Tailscale Serve as the API's immediate local peer while still
rejecting forwarded headers from other peers. See [Proxy trust](proxy-trust.md)
before changing this for a different topology.

For production, use the same model with real domains, for example
`https://app.example.com` for the static frontend and `https://api.example.com`
for API/Auth/MCP.

## Tailscale commands

| Command                       | Description                                   |
| ----------------------------- | --------------------------------------------- |
| `pnpm tailscale:serve`        | Share web + API dev servers over HTTPS        |
| `pnpm tailscale:serve:status` | Show current Tailscale Serve config           |
| `pnpm tailscale:serve:reset`  | Clear Tailscale Serve config                  |
