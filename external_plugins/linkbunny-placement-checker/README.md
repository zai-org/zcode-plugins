# LinkBunny Placement Checker

Check one published page for a link to an expected URL. See the matching href,
anchor text, `rel` attributes, and whether the link uses `nofollow`. The Checker
can also report observed redirects and the source page's declared canonical URL.

[简体中文](./README_CN.md)

## Use in ZCode

Install and enable **LinkBunny Placement Checker** in ZCode's Plugin Marketplace.
In a new ZCode session with a configured model, try:

> Use `inspect_placement` to check whether `https://getlinkbunny.com/` links to
> `https://saasaffiliate.net/`. Report the observed href and whether it has
> `nofollow`.

The Checker inspects fetched HTML. JavaScript-rendered links may be missing from
that HTML. Results describe the observed placement and do not establish indexing,
ranking, or permanence.

## Network, privacy, and license

ZCode connects to the [hosted LinkBunny Checker](https://mcp.getlinkbunny.com/mcp)
using Streamable HTTP. Each check sends the published page URL and the expected
destination URL to LinkBunny, which makes HTTP requests to those sites. Use
public HTTPS URLs and omit private query parameters. See the
[LinkBunny privacy policy](https://getlinkbunny.com/privacy).

The plugin configuration and documentation are [MIT licensed](./LICENSE).
The package contains one read-only MCP connection and requires no LinkBunny
account or API key. It includes no bundled dependencies, local commands, hooks,
plugin-managed file writes, or additional telemetry. ZCode manages its own model
connection and conversation history.
