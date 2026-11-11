#!/usr/bin/env bash
# Start ClaimPay in the background for a CI step and wait until it answers. Stops any earlier
# instance first. Extra environment (for example DEMO_DEFECT=payment-rounding) is passed through.
set -euo pipefail

if [[ -f app.pid ]] && kill -0 "$(cat app.pid)" 2>/dev/null; then
  kill "$(cat app.pid)"
  # It was started by an earlier step's shell, so `wait` can't see it. Poll until it is gone,
  # or the new instance would find the port still taken.
  while kill -0 "$(cat app.pid)" 2>/dev/null; do sleep 0.2; done
fi

node --import tsx app/src/main.ts >> app.log 2>&1 &
echo $! > app.pid

for _ in $(seq 1 30); do
  if curl --silent --fail http://127.0.0.1:3000/api/health > /dev/null; then
    exit 0
  fi
  sleep 1
done
echo "the app did not answer on :3000 within 30 seconds" >&2
tail -20 app.log >&2
exit 1
