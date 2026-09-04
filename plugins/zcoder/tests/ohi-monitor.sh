#!/usr/bin/env bash
# 5-hour continuous static OHI monitor — 1 sample/minute, sparse logging.
# Logs every regression immediately; heartbeat every 15 samples.
cd "$(dirname "$0")/.." || exit 1
LOG=tests/ohi-continuous.log
echo "=== monitor start $(date '+%F %T') ===" >> "$LOG"
for i in $(seq 1 300); do
  out=$(bash tests/ohi-static.sh 2>&1)
  line=$(echo "$out" | tail -1)
  ts=$(date '+%F %T')
  fails=$(echo "$out" | grep '^FAIL' | tr '\n' ';' )
  if [ -n "$fails" ]; then
    echo "$ts REGRESSION: $line :: $fails" >> "$LOG"
  elif [ "$i" -eq 1 ] || [ $((i % 15)) -eq 0 ]; then
    echo "$ts OK: $line" >> "$LOG"
  fi
  sleep 60
done
echo "=== monitor end $(date '+%F %T') (300 samples) ===" >> "$LOG"
