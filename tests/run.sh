#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
php -l app.php
php -l lib/AgentRegistry.php
node --check integrations/kodbox-file/index.js
node --check integrations/kodbox-file/session-security.js
node --check integrations/kodbox-file/account-guard.js
node --check integrations/kodbox-file/office-bytes.js
node --check integrations/kodbox-file/client.js
php tests/registry.php
php tests/api.php
php tests/security.php
php tests/space-security.php
node tests/handoff.cjs
node --experimental-vm-modules tests/session-security.cjs
node tests/office-bytes.cjs
node tests/spreadsheet-read.cjs
node tests/model-recovery.cjs
node tests/tcp-relay.cjs
node tests/client.cjs
node tests/client-experience.cjs
node tests/concurrent-writes.cjs
node tests/account-guard.cjs
node tests/bootstrap-guard.cjs
python3 -B tests/launch-output.py
python3 -B scripts/check_docs.py
