#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
php -l app.php
php -l lib/AgentRegistry.php
node --check integrations/kodbox-file/index.js
node --check integrations/kodbox-file/session-security.js
node --check integrations/kodbox-file/client.js
php tests/registry.php
php tests/api.php
php tests/security.php
node tests/handoff.cjs
node --experimental-vm-modules tests/session-security.cjs
