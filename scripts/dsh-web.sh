#!/bin/zsh
# Keep launch credentials out of terminal and service logs.
set -euo pipefail
exec /usr/bin/python3 "$(dirname "$0")/dsh-web.py"
