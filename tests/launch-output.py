import importlib.util
from pathlib import Path
import tempfile

module = importlib.util.spec_from_file_location("launch_output", Path(__file__).resolve().parents[1] / "scripts/launch_output.py")
loaded = importlib.util.module_from_spec(module)
module.loader.exec_module(loaded)
with tempfile.TemporaryDirectory() as folder:
    token_file = Path(folder) / "token"
    secret = b"aB12_-" * 8
    raw = b"ready http://127.0.0.1/?token=" + secret + b"&theme=dark\n"
    for split in range(1, len(raw)):
        reader = loaded.LaunchOutput(str(token_file))
        logged = reader.feed(raw[:split]) + reader.feed(raw[split:]) + reader.feed(b"", final=True)
        assert secret not in logged and b"token=[REDACTED]" in logged
        assert token_file.read_bytes() == secret + b"\n"
        assert token_file.stat().st_mode & 0o777 == 0o600
    reader = loaded.LaunchOutput(str(token_file))
    assert secret not in reader.feed(b"x" * 70000 + raw)
    reader = loaded.LaunchOutput(str(token_file))
    assert reader.feed(raw[:-1]) == b""
    assert secret not in reader.feed(b"", final=True)
print("Launch output: every chunk boundary, redaction, private token file and bounded buffering passed")
