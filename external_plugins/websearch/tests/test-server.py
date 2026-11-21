#!/usr/bin/env python3
"""Tests for the websearch MCP server.

Offline by default: spawns the server, speaks MCP over stdio, and checks the
handshake, the tool list and the error paths. `--live` additionally calls the
real engines and the network guard, which needs internet access.

    python plugins/websearch/tests/test-server.py [--live]

Requires Python 3.8+ and Node 18+ (global fetch). No third-party packages.
"""
import argparse
import json
import os
import subprocess
import tempfile
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PLUGIN = os.path.dirname(HERE)
SERVER = os.path.join(PLUGIN, "bin", "server.mjs")

FAILURES = []


def check(label, ok, detail=""):
    print(f"{'OK  ' if ok else 'FAIL'} {label}{(' — ' + detail) if detail else ''}")
    if not ok:
        FAILURES.append(label)


def call_server(messages, env=None, timeout=60):
    """Send newline-delimited JSON-RPC and return the parsed responses."""
    payload = "".join(json.dumps(message) + "\n" for message in messages)
    proc = subprocess.run(
        ["node", SERVER], input=payload, capture_output=True, text=True,
        timeout=timeout, encoding="utf-8", env={**os.environ, **(env or {})},
    )
    responses = []
    for line in proc.stdout.splitlines():
        line = line.strip()
        if line:
            responses.append(json.loads(line))
    return responses, proc


def by_id(responses, wanted):
    for response in responses:
        if response.get("id") == wanted:
            return response
    return None


def tool_text(response):
    return json.loads(response["result"]["content"][0]["text"])


def offline():
    self_test = subprocess.run(["node", SERVER, "--self-test"], capture_output=True, text=True, encoding="utf-8")
    check("--self-test exits 0", self_test.returncode == 0, self_test.stdout.strip().splitlines()[-1] if self_test.stdout else "")

    data_dir = tempfile.mkdtemp(prefix="websearch-test-")
    env = {"ZCODE_PLUGIN_DATA": data_dir}
    config_file = os.path.join(data_dir, "websearch.json")

    responses, proc = call_server([
        {"jsonrpc": "2.0", "id": 1, "method": "initialize",
         "params": {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "test", "version": "0"}}},
        {"jsonrpc": "2.0", "method": "notifications/initialized"},
        {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
        {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "nope", "arguments": {}}},
        {"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": "web_search", "arguments": {}}},
        {"jsonrpc": "2.0", "id": 5, "method": "tools/call", "params": {"name": "fetch_page", "arguments": {"url": "ftp://x"}}},
        {"jsonrpc": "2.0", "id": 6, "method": "unknown/method"},
    ], env=env)
    check("server exits cleanly", proc.returncode == 0, proc.stderr.strip()[:120])

    check("first start creates the config template", os.path.isfile(config_file))
    if os.path.isfile(config_file):
        template = json.load(open(config_file, encoding="utf-8"))
        check("config template has empty keys and the default order",
              template.get("anysearchKey") == "" and template.get("order", "").startswith("anysearch"))

    init = by_id(responses, 1)
    check("initialize returns serverInfo", bool(init) and init["result"]["serverInfo"]["name"] == "websearch")
    check("initialize echoes the protocol version", bool(init) and init["result"]["protocolVersion"] == "2024-11-05")
    check("notification gets no response", all(r.get("id") != 0 for r in responses))

    tools = by_id(responses, 2)
    names = [tool["name"] for tool in tools["result"]["tools"]] if tools else []
    check("tools/list exposes both tools", names == ["web_search", "fetch_page"], ",".join(names))
    if tools:
        search_tool = tools["result"]["tools"][0]
        check("web_search requires query", search_tool["inputSchema"].get("required") == ["query"])
        check("web_search engine enum matches the chain",
              search_tool["inputSchema"]["properties"]["engines"]["items"]["enum"] == ["anysearch", "exa", "parallel", "bing", "searxng"])
        check("web_search description carries the concrete config path", config_file in search_tool["description"])

    unknown_response = by_id(responses, 3)
    unknown = tool_text(unknown_response)
    check("unknown tool reports UNKNOWN_TOOL", unknown["errorCode"] == "UNKNOWN_TOOL")
    check("unknown tool sets isError", unknown_response["result"]["isError"] is True)

    empty = tool_text(by_id(responses, 4))
    check("empty query reports INVALID_PARAMS", empty["errorCode"] == "INVALID_PARAMS")

    bad_url = tool_text(by_id(responses, 5))
    check("non-http url reports INVALID_PARAMS", bad_url["errorCode"] == "INVALID_PARAMS")

    missing = by_id(responses, 6)
    check("unknown method returns -32601", missing["error"]["code"] == -32601)


def live():
    responses, _ = call_server([
        {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
         "params": {"name": "web_search", "arguments": {"query": "ZCode 插件", "limit": 3, "engines": ["bing"]}}},
        {"jsonrpc": "2.0", "id": 2, "method": "tools/call",
         "params": {"name": "web_search", "arguments": {"query": "zcode plugin marketplace", "limit": 3}}},
        {"jsonrpc": "2.0", "id": 3, "method": "tools/call",
         "params": {"name": "fetch_page", "arguments": {"url": "https://example.com"}}},
        {"jsonrpc": "2.0", "id": 4, "method": "tools/call",
         "params": {"name": "fetch_page", "arguments": {"url": "http://127.0.0.1:8080/"}}},
    ], timeout=180)

    bing = tool_text(by_id(responses, 1))
    check("bing returns results", bing.get("ok") is True and len(bing["results"]) > 0,
          bing.get("message", "")[:100] if bing.get("ok") is not True else f"{len(bing['results'])} results")
    if bing.get("ok"):
        first = bing["results"][0]
        check("bing results carry title and url", bool(first.get("title")) and first["url"].startswith("http"), first["url"][:60])

    chain = tool_text(by_id(responses, 2))
    check("default chain returns results", chain.get("ok") is True,
          str([f"{a['engine']}:{'ok' if a['ok'] else a.get('error', '')[:40]}" for a in chain.get("attempts", [])])[:200])
    if chain.get("ok"):
        check("chain reports attempts for every engine tried", len(chain["attempts"]) >= 1)
        check("chain reports which engine answered", chain.get("engine") in ("anysearch", "exa", "parallel", "bing", "searxng"),
              str(chain.get("engine")))

    page = tool_text(by_id(responses, 3))
    check("fetch_page reads a public page", page.get("ok") is True and "Example Domain" in page.get("text", ""),
          page.get("message", "")[:80])
    if page.get("ok"):
        check("fetch_page marks content untrusted", page["contentIsUntrusted"] is True)

    blocked = tool_text(by_id(responses, 4))
    check("fetch_page blocks loopback", blocked.get("ok") is False and blocked["errorCode"] == "FETCH_BLOCKED",
          blocked.get("message", "")[:80])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true", help="also hit the real engines (needs internet)")
    args = parser.parse_args()
    if not os.path.isfile(SERVER):
        print(f"server not found: {SERVER}")
        return 2
    offline()
    if args.live:
        print("\n-- live --")
        live()
    print("\n" + ("FAILED: " + ", ".join(FAILURES) if FAILURES else "OK"))
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
