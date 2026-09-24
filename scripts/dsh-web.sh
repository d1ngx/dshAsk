#!/bin/zsh
# Run DSH on a pseudo-terminal so the launch line is flushed, and publish
# that token for the /dsh/ proxy. The file is under KodBox data/, which nginx does not serve.
set -euo pipefail
exec /usr/bin/python3 - <<'PY'
import os, pty, re, sys
token_file = "/Users/fly/gits/docker/compose/site/data/dsh-launch-token"
os.makedirs(os.path.dirname(token_file), exist_ok=True)
cmd = [
    "/opt/homebrew/bin/node",
    "/Users/fly/gits/dshAsk/.dsh-runtime/node_modules/.bin/dsh",
    "web", "--host", "127.0.0.1", "--port", "3081", "--no-open",
    "--trusted-host", "127.0.0.1",
]
pattern = re.compile(r"token=([A-Za-z0-9_-]+)")
def read(fd):
    data = os.read(fd, 4096)
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()
    match = pattern.search(data.decode("utf-8", "replace"))
    if match:
        fd_out = os.open(token_file, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        os.write(fd_out, (match.group(1) + "\n").encode())
        os.close(fd_out)
    return data
pty.spawn(cmd, read)
PY
