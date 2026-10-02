#!/usr/bin/env python3
"""Check maintained local links and public route coverage; no network required."""
import re
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent.parent
FILES = [ROOT / 'readme.md', ROOT / 'integrations/kodbox-file/README.md']
FILES += sorted(p for p in (ROOT / 'docs').rglob('*.md')
                if 'kod' not in p.relative_to(ROOT / 'docs').parts)
FILES += [ROOT / 'docs/kod/README.md']
errors = []
for file in FILES:
    # Ignore examples in fenced code; images use the same link syntax.
    content = re.sub(r'```.*?```', '', file.read_text(), flags=re.S)
    for target in re.findall(r'\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)', content):
        parsed = urlsplit(target.strip('<>'))
        if parsed.scheme or parsed.netloc or not parsed.path:
            continue
        if not (file.parent / unquote(parsed.path)).exists():
            errors.append(f'{file.relative_to(ROOT)}: missing {target}')
api = (ROOT / 'docs/development/api.md').read_text()
php = (ROOT / 'app.php').read_text()
internal = {'__construct', 'regist', 'echoJs', 'install', 'onChangeStatus'}
php_routes = set(re.findall(r'public function (\w+)\(', php)) - internal
js = (ROOT / 'integrations/kodbox-file/index.js').read_text()
dsh_routes = set(re.findall(r'path: "(/kodbox/[^"\s]+)"', js))
dsh_routes.update('/kodbox/' + route for route in re.findall(r'\["(\w+)", "(?:commitPending|cancelPending)"\]', js))
for route in sorted({'plugin/dshAsk/' + name for name in php_routes} | dsh_routes):
    if '`' + route + '`' not in api:
        errors.append('Undocumented route: ' + route)
if errors:
    raise SystemExit('\n'.join(errors))
print(f'Docs OK: {len(FILES)} files, {len(php_routes)} PHP routes, {len(dsh_routes)} DSH routes')
