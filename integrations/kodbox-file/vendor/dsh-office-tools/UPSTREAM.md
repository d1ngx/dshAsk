# Vendored Office tools

- Upstream: `dsh-office-tools` by kw78
- Upstream version: `1.0.3`
- Source: https://github.com/kw78/dsh-office-tools
- License: MIT; see `LICENSE`
- Included file: `lib/index.js`, bundled upstream build

The upstream `apply()` is invoked by the single `kodbox-office-tools` entry point. It is not installed as a second DSH plugin.

Local change: the eight `presentCall` titles read `Office · <app> <action>：<path>` instead of `Create/Read/Update <path>`, so Office calls stand out in the conversation.
