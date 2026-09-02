---
description: Intraday snapshot of a watchlist with move-vs-benchmark
argument-hint: "[list-name]"
---

Load the `intraday-watch` skill and produce an intraday snapshot for: $ARGUMENTS

If no list is named, use the only stored watchlist, or ask which one when several exist.

Establish from the returned `time` stamp whether the session is actually open before
reporting anything as a live quote.
