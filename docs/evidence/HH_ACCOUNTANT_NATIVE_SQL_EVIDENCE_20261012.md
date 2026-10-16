# HotelHub accountant native SQL evidence — 12/10/2026

Upload to Project Sources: **No** — review-branch engineering evidence.

Source: remote43bd2b3a6283a88c68c5b6f8635d3b6f51efcc97; exact tree2831a37c5506ba881377eff37a9d0ed729d44608 equals localf23beae85252d5475f6ce7972827211ca26129de. Parent05e9951296f31083572546330f9eced940091af3. Existing review/hh-source-prerequisites-20261012 advanced nonforce; main not changed.

Fresh API readback: workflow Accountant review SQL, run38202969784, job114660187231, all steps completed successfully and containers stopped. [Run](https://github.com/mugs-AI/hotel-hub/actions/runs/38202969784). Actual decoded job logs identify exact checkout, PostgreSQL17.6 and three distinct backend connections.13single-session checks and6multi-session/history scenarios passed. Expected denial errors in PostgreSQL logs belong to assertions; no failed test or job step was reported.

This supersedes the earlier native-NOT-VERIFIED hold for this exact accountant schema delta. It does not verify all earlier settlement/source-billing native scenarios, schema/types/RPC parity in Lovable, live N3 semantics, Task2 checker, Task4 close, Task5 mounted report, or client acceptance. Operational migration remains UNAPPLIED; live ledger20261003120216. Existing Lovable backend only; no separate Supabase account/auth used. No N3 request/write, main merge, activation, deployment/publication or BEC action.

The disposable CI database was hh_accountant_test on127.0.0.1 with synthetic fixtures and no real secrets. It was not HotelHub's Lovable database. Current code contracts stay held, and normal receipt editing stays OFF as governing direction.

## Read job output

```text
2026-10-12T04:14:39.6103415Z [command]/usr/bin/git -c protocol.version=2 fetch --no-tags --prune --no-recurse-submodules --depth=1 origin +43bd2b3a6283a88c68c5b6f8635d3b6f51efcc97:refs/remotes/origin/review/hh-source-prerequisites-20261012
2026-10-12T04:14:40.4146837Z  * [new ref]         43bd2b3a6283a88c68c5b6f8635d3b6f51efcc97 -> origin/review/hh-source-prerequisites-20261012
2026-10-12T04:14:40.4768578Z 43bd2b3a6283a88c68c5b6f8635d3b6f51efcc97
2026-10-12T04:14:41.9149538Z PASS stable_case_and_request_replay
2026-10-12T04:14:41.9165659Z PASS known_OR_number_survives_the_durable_reference_snapshot
2026-10-12T04:14:41.9202518Z PASS exclusive_day_end_includes_the_last_microseconds
2026-10-12T04:14:41.9244369Z PASS committed_resolution_has_exact_GET_only_replay
2026-10-12T04:14:41.9264930Z PASS same_request_changed_input_denied
2026-10-12T04:14:41.9281836Z PASS unowned_or_and_alien_booking_cannot_be_adopted
2026-10-12T04:14:41.9298036Z PASS review_is_not_resolution_and_notes_keep_unknown_amount
2026-10-12T04:14:41.9323600Z PASS stale_case_version_and_request_replay_fenced
2026-10-12T04:14:41.9342996Z PASS body_digest_cannot_resolve
2026-10-12T04:14:41.9362861Z PASS immutable_case_identity_event_and_statement
2026-10-12T04:14:41.9392349Z PASS read_and_statement_capture_do_not_change_case_events
2026-10-12T04:14:41.9403807Z PASS historical_capture_unavailable_before_installed_history
2026-10-12T04:14:41.9417475Z PASS public_roles_denied_and_rls_enabled
2026-10-12T04:14:41.9453718Z PASS native17.6 accountant single-session SQL; races run separately
2026-10-12T04:14:42.0039751Z Native PostgreSQL 17.6 (Debian 17.6-2.pgdg13+1); three distinct backend PIDs
2026-10-12T04:14:42.0335629Z PASS duplicate request waits then replays one case/event
2026-10-12T04:14:42.0571922Z PASS stale concurrent event cannot overwrite the committed version
2026-10-12T04:14:42.0613189Z PASS waiting writer stamps history after the earlier committed event
2026-10-12T04:14:42.0620815Z PASS conflicting request identity on another booking is rejected
2026-10-12T04:14:42.0661697Z PASS concurrent statement capture replays one snapshot; later events never change its bytes
2026-10-12T04:14:44.0711714Z PASS expired original GET evidence cannot resolve after a lock wait
2026-10-12T04:14:44.0712220Z PASS six native accountant concurrency/history scenarios
```
