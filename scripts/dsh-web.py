import os, pty, re, subprocess, sys
token_file = "/Users/fly/gits/docker/compose/site/data/dsh-launch-token"
os.makedirs(os.path.dirname(token_file), exist_ok=True)
# 3081 stays on loopback. The proxy forwards the browser Host, so each LAN
# address this machine owns must be trusted or /api answers 403.
trusted = ["127.0.0.1"]
try:
    listed = subprocess.check_output(["/sbin/ifconfig"], text=True, errors="replace")
except Exception:
    listed = ""
for address in re.findall(r"\binet (\d+\.\d+\.\d+\.\d+)\b", listed):
    if address.startswith("127.") or address in trusted:
        continue
    trusted.append(address)
cmd = [
    "/opt/homebrew/bin/node",
    "--import", os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "integrations/kodbox-file/bootstrap-guard.js"),
    "/Users/fly/gits/dshAsk/.dsh-runtime/node_modules/.bin/dsh",
    "web", "--host", "127.0.0.1", "--port", "3081", "--no-open",
]
for host in trusted:
    cmd.extend(["--trusted-host", host])
from launch_output import LaunchOutput
output = LaunchOutput(token_file)
def read(fd):
    while True:
        try:
            data = os.read(fd, 4096)
        except OSError as error:
            if error.errno != 5:  # A PTY reports EIO when its child exits.
                raise
            data = b""
        clean = output.feed(data, final=not data)
        if clean or not data:
            return clean
sys.exit(os.waitstatus_to_exitcode(pty.spawn(cmd, read)))
