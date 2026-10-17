Source: https://github.com/deepseek-ai/deepseek-harness/tree/main/packages/client/ui-settings-models

Vendored browser bundle from the deployed `@deepseek-ai/dsh-client-ui-settings-models` 0.2.0-rc.2 (MIT). Changes: module id renamed; activation requires fresh KodBox administrator identity; onboarding slots omitted; model descriptor reads use authenticated host RPCs on LAN URLs (upstream shared form mirror is local-only). Keep the upstream version aligned with the deployed DSH client services. Server authorization lives in ../account-guard.js and does not rely on this UI check.
