"""Extract a launch credential before returning redacted PTY output."""
import os
import re
import tempfile


class LaunchOutput:
    def __init__(self, token_file):
        self.token_file = token_file
        self.pending = b""
        self.discarding = False

    def line(self, raw):
        pattern = rb"token=([A-Za-z0-9_-]+)"
        match = re.search(pattern, raw)
        if match and 16 <= len(match[1]) <= 128:
            fd, tmp = tempfile.mkstemp(dir=os.path.dirname(self.token_file))
            try:
                with os.fdopen(fd, "wb") as stream:
                    stream.write(match[1] + b"\n")
                os.replace(tmp, self.token_file)
            finally:
                if os.path.exists(tmp):
                    os.unlink(tmp)
        return re.sub(pattern, b"token=[REDACTED]", raw)

    def feed(self, data, final=False):
        out = []
        for part in data.splitlines(keepends=True):
            ended = part.endswith((b"\n", b"\r"))
            if not self.discarding:
                self.pending += part
                if len(self.pending) > 65536:
                    self.pending = b""
                    self.discarding = True
            if ended:
                out.append(b"[oversized output omitted]\n" if self.discarding else self.line(self.pending))
                self.pending = b""
                self.discarding = False
        if final and self.pending:
            out.append(self.line(self.pending))
            self.pending = b""
        return b"".join(out)
