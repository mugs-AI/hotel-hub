# Native PostgreSQL settlement evidence — 2026-10-08


## Recovery-facts checkpoint — native CI run2

- Source `25aae0018c9448d3dd59e564cc1eba13064863eb`; tree `daa2ffd96e22552c3e0acdb375c81a0989716801` equals local `5f3cc38a58d75c3d6f2da19f91da60abfd250bec`.
- [CI run37713703631](https://github.com/mugs-AI/hotel-hub/actions/runs/37713703631), job113105236249, completed success. Both native SQL steps successful; actual logs inspected.
- Migration SHA256 `a434d75cae543e00146877beced70def8fca28e2874301389f806d8c5234cd29`; single-session SHA256 `5506f4cc914a528f6595789a91d3b972860e2b4d9ca5b05e2ab6e4f1b8a96b67`; independent backend runner SHA256 `4bde07fd63a9bb9f667a5af6597f19a48dbc7e4fbfe5cd5a998a9e45847dfd98`.
-47 actual assertion PASS lines, including recovery facts surviving a new read, wrong payload digest denied, and all prior native race checks. No N3 calls or operational database connections.
-This confirms the dispatch-facts checkpoint only. Later bill/progress/close SQL changes need new native CI evidence; no claim that an untested later tree passed this run.

```text
2026-10-08T01:36:09.8427684Z PASS settlement_snapshot_changed: settlement_snapshot_changed
2026-10-08T01:36:09.8446018Z PASS settlement_snapshot_changed: settlement_snapshot_changed
2026-10-08T01:36:09.8479071Z PASS freeze creates immutable intent
2026-10-08T01:36:09.8495677Z PASS same key/digest replays
2026-10-08T01:36:09.8508225Z PASS settlement_conflicting_request: settlement_conflicting_request
2026-10-08T01:36:09.8514497Z PASS settlement_locked: settlement_locked
2026-10-08T01:36:09.8519325Z PASS settlement_locked: settlement_locked
2026-10-08T01:36:09.8523610Z PASS settlement_locked: settlement_locked
2026-10-08T01:36:09.8527463Z PASS settlement_locked: settlement_locked
2026-10-08T01:36:09.8528767Z PASS locked writes roll back
2026-10-08T01:36:09.8538872Z PASS settlement_invalid_dispatch_facts: settlement_invalid_dispatch_facts
2026-10-08T01:36:09.8569219Z PASS one claim in 20 sequential calls (NOT concurrency proof)
2026-10-08T01:36:09.8572206Z PASS dispatch recovery facts survive a new read
2026-10-08T01:36:09.8577548Z PASS settlement_stale_revision: settlement_stale_revision
2026-10-08T01:36:09.8581051Z PASS settlement_dispatched: settlement_dispatched
2026-10-08T01:36:09.8582920Z PASS browser tables denied
2026-10-08T01:36:09.8583571Z PASS browser functions denied
2026-10-08T01:36:09.8588033Z PASS cross_tenant_fk_denied
2026-10-08T01:36:09.8593622Z PASS settlement_locked: settlement_locked
2026-10-08T01:36:09.8594051Z PASS settlement_immutable: settlement_immutable
2026-10-08T01:36:09.8595881Z PASS settlement_immutable: settlement_immutable
2026-10-08T01:36:09.8597269Z PASS settlement_immutable: settlement_immutable
2026-10-08T01:36:09.8611672Z PASS unknown stays frozen
2026-10-08T01:36:09.8613179Z PASS expired_lease_never_redispatches (no lease reset exists)
2026-10-08T01:36:09.8615971Z PASS cross tenant read empty
2026-10-08T01:36:09.8637085Z PASS settlement_pending_financial_operation: settlement_pending_financial_operation
2026-10-08T01:36:09.8653150Z PASS settlement_pending_financial_operation: settlement_pending_financial_operation
2026-10-08T01:36:09.8674118Z PASS settlement_pending_financial_operation: settlement_pending_financial_operation
2026-10-08T01:36:09.8697546Z PASS settlement_pending_financial_operation: settlement_pending_financial_operation
2026-10-08T01:36:09.8698321Z PASS pending deposit or receipt execution refuses freeze
2026-10-08T01:36:09.8701865Z PASS settlement_locked: settlement_locked
2026-10-08T01:36:09.8707359Z PASS settlement_locked: settlement_locked
2026-10-08T01:36:09.8710395Z PASS settlement_locked: settlement_locked
2026-10-08T01:36:09.8713371Z PASS settlement_locked: settlement_locked
2026-10-08T01:36:09.8715892Z PASS settlement_locked: settlement_locked
2026-10-08T01:36:09.8718242Z PASS settlement_locked: settlement_locked
2026-10-08T01:36:09.8726814Z PASS settlement_locked: settlement_locked
2026-10-08T01:36:09.8730340Z PASS native PostgreSQL17.6 setup and single-session checks
2026-10-08T01:36:10.0574881Z PASS one_claim_in_20_sessions
2026-10-08T01:36:10.0581605Z PASS one durable dispatch attempt
2026-10-08T01:36:10.0888519Z PASS freeze waits for started deposit
2026-10-08T01:36:10.0905223Z PASS pending deposit blocks concurrent freeze
2026-10-08T01:36:10.1222354Z PASS deposit waits for freezing transaction
2026-10-08T01:36:10.1230227Z PASS freeze wins deposit check/insert race
2026-10-08T01:36:10.1266899Z PASS settlement_busy
2026-10-08T01:36:10.1273447Z PASS child-first rollback and no deadlock
2026-10-08T01:36:10.1273941Z PASS all named native multi-session checks; no N3 calls
```


Status: PASSED for this exact SQL checkpoint; not a database apply or production activation.

- Repository: mugs-AI/hotel-hub; isolated branch review/hh-n3-billing-20261008.
- Remote source: `10f9e8ac306a81ee7cee2a82c888313afc7f6d70`; tree `07557eb5db1ade7655fab18baa8c6c4e33d5cd87` equals local `96ff0777b30a6901447d15ef683f8b0c8ee43f54`.
- [CI run](https://github.com/mugs-AI/hotel-hub/actions/runs/37712611523), job113101756989, push run1, conclusion success. Job steps5 and6 successful; actual logs inspected.
- Disposable localhost database hh_settlement_test, postgres:17.6. The client independently rejects any other server version/database/marker. Synthetic fixtures only; no application/backend credentials or N3 calls.
- Checkout pinned to official v4.2.2 SHA11bd71901bbe5b1630ceea73d27597364c9af683; contents-read permission; no persisted credentials. Test-only pg8.16.3 installed separately from app dependencies.
- Candidate migration SHA256 `c03b097060ba460b9aa73cf500caf4fe169c524bd4acd5d8384ab3d7b70b6437`.
- Single-session SQL SHA256 `9c81762897e3e87aaf33851477a066713682be6f2ad3517f937a619827c3b21e`.
- Independent backend runner SHA256 `2426e9bbbf92240bb79d3fcf451f9420c9a32a979d6a7b4ae05d8be237aa7e55`.

This supersedes the earlier native-concurrency NOT VERIFIED status for the exact checkpoint above. Later SQL changes must re-run this CI and cite their own source/logs. Proof persistence and atomic close remain later plan tasks. Real N3 API contract acceptance remains unproven and all financial gates remain closed.

Observed assertion log:

```text
2026-10-08T01:22:55.7650109Z PASS settlement_snapshot_changed: settlement_snapshot_changed
2026-10-08T01:22:55.7663501Z PASS settlement_snapshot_changed: settlement_snapshot_changed
2026-10-08T01:22:55.7688411Z PASS freeze creates immutable intent
2026-10-08T01:22:55.7702390Z PASS same key/digest replays
2026-10-08T01:22:55.7713211Z PASS settlement_conflicting_request: settlement_conflicting_request
2026-10-08T01:22:55.7719204Z PASS settlement_locked: settlement_locked
2026-10-08T01:22:55.7723996Z PASS settlement_locked: settlement_locked
2026-10-08T01:22:55.7727536Z PASS settlement_locked: settlement_locked
2026-10-08T01:22:55.7730538Z PASS settlement_locked: settlement_locked
2026-10-08T01:22:55.7731420Z PASS locked writes roll back
2026-10-08T01:22:55.7755593Z PASS one claim in 20 sequential calls (NOT concurrency proof)
2026-10-08T01:22:55.7759455Z PASS settlement_stale_revision: settlement_stale_revision
2026-10-08T01:22:55.7762249Z PASS settlement_dispatched: settlement_dispatched
2026-10-08T01:22:55.7763649Z PASS browser tables denied
2026-10-08T01:22:55.7764225Z PASS browser functions denied
2026-10-08T01:22:55.7767785Z PASS cross_tenant_fk_denied
2026-10-08T01:22:55.7771432Z PASS settlement_locked: settlement_locked
2026-10-08T01:22:55.7772214Z PASS settlement_immutable: settlement_immutable
2026-10-08T01:22:55.7773608Z PASS settlement_immutable: settlement_immutable
2026-10-08T01:22:55.7774896Z PASS settlement_immutable: settlement_immutable
2026-10-08T01:22:55.7784858Z PASS unknown stays frozen
2026-10-08T01:22:55.7786077Z PASS expired_lease_never_redispatches (no lease reset exists)
2026-10-08T01:22:55.7788039Z PASS cross tenant read empty
2026-10-08T01:22:55.7804692Z PASS settlement_pending_financial_operation: settlement_pending_financial_operation
2026-10-08T01:22:55.7817170Z PASS settlement_pending_financial_operation: settlement_pending_financial_operation
2026-10-08T01:22:55.7833741Z PASS settlement_pending_financial_operation: settlement_pending_financial_operation
2026-10-08T01:22:55.7852252Z PASS settlement_pending_financial_operation: settlement_pending_financial_operation
2026-10-08T01:22:55.7853177Z PASS pending deposit or receipt execution refuses freeze
2026-10-08T01:22:55.7855761Z PASS settlement_locked: settlement_locked
2026-10-08T01:22:55.7860260Z PASS settlement_locked: settlement_locked
2026-10-08T01:22:55.7862656Z PASS settlement_locked: settlement_locked
2026-10-08T01:22:55.7865043Z PASS settlement_locked: settlement_locked
2026-10-08T01:22:55.7866966Z PASS settlement_locked: settlement_locked
2026-10-08T01:22:55.7868798Z PASS settlement_locked: settlement_locked
2026-10-08T01:22:55.7875929Z PASS settlement_locked: settlement_locked
2026-10-08T01:22:55.7879294Z PASS native PostgreSQL17.6 setup and single-session checks
2026-10-08T01:22:55.9366794Z PASS one_claim_in_20_sessions
2026-10-08T01:22:55.9372260Z PASS one durable dispatch attempt
2026-10-08T01:22:55.9675196Z PASS freeze waits for started deposit
2026-10-08T01:22:55.9691705Z PASS pending deposit blocks concurrent freeze
2026-10-08T01:22:56.0009127Z PASS deposit waits for freezing transaction
2026-10-08T01:22:56.0023243Z PASS freeze wins deposit check/insert race
2026-10-08T01:22:56.0068758Z PASS settlement_busy
2026-10-08T01:22:56.0081396Z PASS child-first rollback and no deadlock
2026-10-08T01:22:56.0083075Z PASS all named native multi-session checks; no N3 calls
```

