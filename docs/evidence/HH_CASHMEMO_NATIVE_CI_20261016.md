# CashMemo current-candidate native SQL proof — 16/10/2026

Upload to Project Sources: No. Repository evidence; no raw Owner data or credentials.

Workflow: CashMemo combined native SQL proof. [Run38828072125](https://github.com/mugs-AI/hotel-hub/actions/runs/38828072125), job116740119253, conclusion success. Remote commit `ed3432947884dbc0e593595fb6a41c4e15df62d1`, exact tree `2d8fb49c8b267cc6aa3ad1231a6a6e0e6a67a3a9` (local `a9c7000`). Native PostgreSQL17.6 in disposable GitHub service container, synthetic tenant/stay only. Eleven candidate application migrations applied after reconstructing the existing receipt generations. No operational backend or N3 request.

Retrieved job log assertions:

```text
2026-10-16T00:12:10.2992913Z PASS combined11 migrations and current canonical source freeze on native PostgreSQL17.6
2026-10-16T00:12:10.4161173Z PASS exactly one current source-leg claim across20 independent Owner/FrontDesk sessions
2026-10-16T00:12:10.4187241Z PASS duplicate replay creates no second claim; Housekeeper denied
2026-10-16T00:12:10.4188177Z N3 financial acceptance, allocation concurrency and whole-stay close NOT VERIFIED by this SQL proof
```

Initial run38827562502 did not execute tests: workflow validation rejected `runner.temp` in job-level env. The runner dependency path now uses a static directory within the disposable job; the successful run above follows that correction. Expected denied Housekeeper SQL raises settlement_forbidden in service logs and is asserted by the runner.

Acceptance scope: current combined migration syntax/function dependencies and one-dispatch source-leg claim under20 real backend sessions. It does not prove installed production RLS/runtime, same-receipt competition in N3, live bill/receipt/matching contracts, whole-stay close/no-show, printing/reporting or published UI acceptance.
