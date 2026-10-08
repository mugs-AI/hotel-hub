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


## Bill-progress checkpoint — native CI run3

- Exact source `4deea858669a0f853ffcd202ffdff2bdc6c431f7`; tree `7b8db975f059d81b99eaf43880e6be614a15a953` equals local `57f69c3ee8826e5bbdb59592b4ee101fdc4ded57` at publication.
- [CI run37714838244](https://github.com/mugs-AI/hotel-hub/actions/runs/37714838244), job113108845998, completed success. Both native SQL steps successful; actual logs inspected.
- Exact Git blob identities (these are Git object hashes, not SHA256):
  - `db/checks/hh-settlement-multisession.mjs`: `d714fe43a0ed01a0109115c585183dd0a580ab76`.
  - `db/checks/hh-settlement-single.sql`: `1682cceadf83e970eedc53cc04e7d5de9004fa78`.
  - `supabase/migrations/20261008080000_hh_billing_settlement.sql`: `e3b1bed5eb187a7ca958630ae0144779e38ec05c`.
- 55 actual assertion PASS lines, including unknown bill resolved only by accounting proof, expired/tampered proof rejection, digest replay, and the 20 independent backend races. Disposable PostgreSQL17.6 only; no N3 calls or operational database connection.
- This run covers bill-progress SQL in the exact checkpoint above. Later local balance/header/allocation changes are outside this CI evidence. Task7 and the release remain incomplete; this is not database application or publishing approval.

```text
2026-10-08T01:50:05.1531884Z PASS settlement_snapshot_changed: settlement_snapshot_changed
2026-10-08T01:50:05.1548320Z PASS settlement_snapshot_changed: settlement_snapshot_changed
2026-10-08T01:50:05.1589049Z PASS freeze creates immutable intent
2026-10-08T01:50:05.1599825Z PASS same key/digest replays
2026-10-08T01:50:05.1612525Z PASS settlement_conflicting_request: settlement_conflicting_request
2026-10-08T01:50:05.1619416Z PASS settlement_locked: settlement_locked
2026-10-08T01:50:05.1624172Z PASS settlement_locked: settlement_locked
2026-10-08T01:50:05.1628841Z PASS settlement_locked: settlement_locked
2026-10-08T01:50:05.1633600Z PASS settlement_locked: settlement_locked
2026-10-08T01:50:05.1634519Z PASS locked writes roll back
2026-10-08T01:50:05.1643968Z PASS settlement_invalid_dispatch_facts: settlement_invalid_dispatch_facts
2026-10-08T01:50:05.1676019Z PASS one claim in 20 sequential calls (NOT concurrency proof)
2026-10-08T01:50:05.1679518Z PASS dispatch recovery facts survive a new read
2026-10-08T01:50:05.1684312Z PASS settlement_stale_revision: settlement_stale_revision
2026-10-08T01:50:05.1687933Z PASS settlement_dispatched: settlement_dispatched
2026-10-08T01:50:05.1689792Z PASS browser tables denied
2026-10-08T01:50:05.1690320Z PASS browser functions denied
2026-10-08T01:50:05.1694629Z PASS cross_tenant_fk_denied
2026-10-08T01:50:05.1700240Z PASS settlement_locked: settlement_locked
2026-10-08T01:50:05.1700860Z PASS settlement_immutable: settlement_immutable
2026-10-08T01:50:05.1702828Z PASS settlement_immutable: settlement_immutable
2026-10-08T01:50:05.1703945Z PASS settlement_immutable: settlement_immutable
2026-10-08T01:50:05.1718557Z PASS unknown stays frozen
2026-10-08T01:50:05.1720022Z PASS expired_lease_never_redispatches (no lease reset exists)
2026-10-08T01:50:05.1723451Z PASS cross tenant read empty
2026-10-08T01:50:05.1744022Z PASS settlement_pending_financial_operation: settlement_pending_financial_operation
2026-10-08T01:50:05.1759870Z PASS settlement_pending_financial_operation: settlement_pending_financial_operation
2026-10-08T01:50:05.1781121Z PASS settlement_pending_financial_operation: settlement_pending_financial_operation
2026-10-08T01:50:05.1803785Z PASS settlement_pending_financial_operation: settlement_pending_financial_operation
2026-10-08T01:50:05.1804603Z PASS pending deposit or receipt execution refuses freeze
2026-10-08T01:50:05.1808247Z PASS settlement_locked: settlement_locked
2026-10-08T01:50:05.1813157Z PASS settlement_locked: settlement_locked
2026-10-08T01:50:05.1816186Z PASS settlement_locked: settlement_locked
2026-10-08T01:50:05.1818992Z PASS settlement_locked: settlement_locked
2026-10-08T01:50:05.1821330Z PASS settlement_locked: settlement_locked
2026-10-08T01:50:05.1823729Z PASS settlement_locked: settlement_locked
2026-10-08T01:50:05.1832412Z PASS settlement_locked: settlement_locked
2026-10-08T01:50:05.1871849Z PASS unknown bill cannot advance without bound evidence
2026-10-08T01:50:05.1887342Z PASS settlement_expired_proof: settlement_expired_proof
2026-10-08T01:50:05.1895030Z PASS settlement_untrusted_proof: settlement_untrusted_proof
2026-10-08T01:50:05.1899203Z PASS settlement_untrusted_proof: settlement_untrusted_proof
2026-10-08T01:50:05.1900847Z PASS invalid progress cannot persist evidence
2026-10-08T01:50:05.1914713Z PASS only accounting proof resolves unknown bill
2026-10-08T01:50:05.1915543Z PASS progress evidence is append-only
2026-10-08T01:50:05.1922454Z PASS same progress digest replays without extra event
2026-10-08T01:50:05.3683546Z PASS native PostgreSQL17.6 setup and single-session checks
2026-10-08T01:50:05.5987875Z PASS one_claim_in_20_sessions
2026-10-08T01:50:05.5992590Z PASS one durable dispatch attempt
2026-10-08T01:50:05.6296321Z PASS freeze waits for started deposit
2026-10-08T01:50:05.6316211Z PASS pending deposit blocks concurrent freeze
2026-10-08T01:50:05.6631697Z PASS deposit waits for freezing transaction
2026-10-08T01:50:05.6640258Z PASS freeze wins deposit check/insert race
2026-10-08T01:50:05.6679083Z PASS settlement_busy
2026-10-08T01:50:05.6687166Z PASS child-first rollback and no deadlock
2026-10-08T01:50:05.6687746Z PASS all named native multi-session checks; no N3 calls
```


## Coordinator/proof checkpoint — native CI run4

Exact remote `286426f0b9e85a58689d22505808003a80b684df`, local `54479ba9fde8532cdfb1a805d5c8bbc35d71ef10`, tree `bfcca2a013d62780e204734f0f5f9bd0696b083c`. [Run37725121448](https://github.com/mugs-AI/hotel-hub/actions/runs/37725121448), job113141424270: both native steps successful. Actual 65 PASS lines inspected. Synthetic disposable PostgreSQL17.6 only. This proves allocation/final proof, later-unresolved-dispatch fencing and original20-backend races for this checkpoint. All-room close changes after this checkpoint require their own CI.

```text
2026-10-08T03:57:12.3146037Z PASS settlement_snapshot_changed: settlement_snapshot_changed
2026-10-08T03:57:12.3160439Z PASS settlement_snapshot_changed: settlement_snapshot_changed
2026-10-08T03:57:12.3206427Z PASS freeze creates immutable intent
2026-10-08T03:57:12.3228452Z PASS same key/digest replays
2026-10-08T03:57:12.3245698Z PASS settlement_conflicting_request: settlement_conflicting_request
2026-10-08T03:57:12.3254947Z PASS settlement_locked: settlement_locked
2026-10-08T03:57:12.3262182Z PASS settlement_locked: settlement_locked
2026-10-08T03:57:12.3268140Z PASS settlement_locked: settlement_locked
2026-10-08T03:57:12.3274913Z PASS settlement_locked: settlement_locked
2026-10-08T03:57:12.3276300Z PASS locked writes roll back
2026-10-08T03:57:12.3289532Z PASS settlement_invalid_dispatch_facts: settlement_invalid_dispatch_facts
2026-10-08T03:57:12.3335772Z PASS one claim in 20 sequential calls (NOT concurrency proof)
2026-10-08T03:57:12.3340716Z PASS dispatch recovery facts survive a new read
2026-10-08T03:57:12.3347414Z PASS settlement_stale_revision: settlement_stale_revision
2026-10-08T03:57:12.3352717Z PASS settlement_dispatched: settlement_dispatched
2026-10-08T03:57:12.3355486Z PASS browser tables denied
2026-10-08T03:57:12.3356529Z PASS browser functions denied
2026-10-08T03:57:12.3362122Z PASS cross_tenant_fk_denied
2026-10-08T03:57:12.3369459Z PASS settlement_locked: settlement_locked
2026-10-08T03:57:12.3370428Z PASS settlement_immutable: settlement_immutable
2026-10-08T03:57:12.3373528Z PASS settlement_immutable: settlement_immutable
2026-10-08T03:57:12.3374921Z PASS settlement_immutable: settlement_immutable
2026-10-08T03:57:12.3396080Z PASS unknown stays frozen
2026-10-08T03:57:12.3399001Z PASS expired_lease_never_redispatches (no lease reset exists)
2026-10-08T03:57:12.3402503Z PASS cross tenant read empty
2026-10-08T03:57:12.3429914Z PASS settlement_pending_financial_operation: settlement_pending_financial_operation
2026-10-08T03:57:12.3451810Z PASS settlement_pending_financial_operation: settlement_pending_financial_operation
2026-10-08T03:57:12.3480069Z PASS settlement_pending_financial_operation: settlement_pending_financial_operation
2026-10-08T03:57:12.3510922Z PASS settlement_pending_financial_operation: settlement_pending_financial_operation
2026-10-08T03:57:12.3512559Z PASS pending deposit or receipt execution refuses freeze
2026-10-08T03:57:12.3516677Z PASS settlement_locked: settlement_locked
2026-10-08T03:57:12.3523263Z PASS settlement_locked: settlement_locked
2026-10-08T03:57:12.3528098Z PASS settlement_locked: settlement_locked
2026-10-08T03:57:12.3531688Z PASS settlement_locked: settlement_locked
2026-10-08T03:57:12.3534866Z PASS settlement_locked: settlement_locked
2026-10-08T03:57:12.3539156Z PASS settlement_locked: settlement_locked
2026-10-08T03:57:12.3550510Z PASS settlement_locked: settlement_locked
2026-10-08T03:57:12.3606878Z PASS unknown bill cannot advance without bound evidence
2026-10-08T03:57:12.3629771Z PASS settlement_expired_proof: settlement_expired_proof
2026-10-08T03:57:12.3640731Z PASS settlement_untrusted_proof: settlement_untrusted_proof
2026-10-08T03:57:12.3646681Z PASS settlement_untrusted_proof: settlement_untrusted_proof
2026-10-08T03:57:12.3649196Z PASS invalid progress cannot persist evidence
2026-10-08T03:57:12.3669802Z PASS only accounting proof resolves unknown bill
2026-10-08T03:57:12.3670823Z PASS progress evidence is append-only
2026-10-08T03:57:12.3681651Z PASS same progress digest replays without extra event
2026-10-08T03:57:12.3728477Z PASS proven balance receipt recovers unknown create without repost
2026-10-08T03:57:12.3729461Z PASS settlement balance is never inserted as a deposit
2026-10-08T03:57:12.3782130Z PASS allocation proof resolves unknown without a second POST
2026-10-08T03:57:12.3794248Z PASS settlement_untrusted_proof: settlement_untrusted_proof
2026-10-08T03:57:12.3806487Z PASS settlement_untrusted_proof: settlement_untrusted_proof
2026-10-08T03:57:12.3832490Z PASS full conservation proof settles without a financial retry
2026-10-08T03:57:12.3833801Z PASS bill balance and allocation each retain exactly one attempt
2026-10-08T03:57:12.3861103Z PASS GET-only proof refresh supports an expired local close retry
2026-10-08T03:57:12.3976935Z PASS settlement_invalid_state: settlement_invalid_state
2026-10-08T03:57:12.3977530Z PASS unresolved later allocation fences every subsequent write
2026-10-08T03:57:12.3982161Z PASS native PostgreSQL17.6 setup and single-session checks
2026-10-08T03:57:12.6212345Z PASS one_claim_in_20_sessions
2026-10-08T03:57:12.6220533Z PASS one durable dispatch attempt
2026-10-08T03:57:12.6562804Z PASS freeze waits for started deposit
2026-10-08T03:57:12.6590436Z PASS pending deposit blocks concurrent freeze
2026-10-08T03:57:12.6930263Z PASS deposit waits for freezing transaction
2026-10-08T03:57:12.6941985Z PASS freeze wins deposit check/insert race
2026-10-08T03:57:12.6998010Z PASS settlement_busy
2026-10-08T03:57:12.7006750Z PASS child-first rollback and no deadlock
2026-10-08T03:57:12.7007232Z PASS all named native multi-session checks; no N3 calls
```


## Atomic-close checkpoint — native CI run5

Exact remote `f8ced15d6e4126f8d30d0ca52d6e6dcb8aadc0ed`, local `2db0ba85296362182418c6f57d675055648bb1b1`, tree `878917f2c0251479fb7affd6e702c889ffdcf497`. [Run37725810756](https://github.com/mugs-AI/hotel-hub/actions/runs/37725810756), job113143578641. Both native SQL steps successful; actual84 PASS assertion lines inspected. Covers two-room close, rollback of room2 failure, scoped room FK/occupant/TTL guards, replay and20 simultaneous native closes with exactly1 close event/2 applied handoffs. Synthetic disposable PostgreSQL17.6 only, no N3 calls or live migration.

```text
2026-10-08T04:06:00.5710339Z PASS settlement_snapshot_changed: settlement_snapshot_changed
2026-10-08T04:06:00.5729915Z PASS settlement_snapshot_changed: settlement_snapshot_changed
2026-10-08T04:06:00.5772820Z PASS freeze creates immutable intent
2026-10-08T04:06:00.5794429Z PASS same key/digest replays
2026-10-08T04:06:00.5812816Z PASS settlement_conflicting_request: settlement_conflicting_request
2026-10-08T04:06:00.5822499Z PASS settlement_locked: settlement_locked
2026-10-08T04:06:00.5830684Z PASS settlement_locked: settlement_locked
2026-10-08T04:06:00.5837207Z PASS settlement_locked: settlement_locked
2026-10-08T04:06:00.5844273Z PASS settlement_locked: settlement_locked
2026-10-08T04:06:00.5846380Z PASS locked writes roll back
2026-10-08T04:06:00.5858870Z PASS settlement_invalid_dispatch_facts: settlement_invalid_dispatch_facts
2026-10-08T04:06:00.5917295Z PASS one claim in 20 sequential calls (NOT concurrency proof)
2026-10-08T04:06:00.5918349Z PASS dispatch recovery facts survive a new read
2026-10-08T04:06:00.5919865Z PASS settlement_stale_revision: settlement_stale_revision
2026-10-08T04:06:00.5921681Z PASS settlement_dispatched: settlement_dispatched
2026-10-08T04:06:00.5923039Z PASS browser tables denied
2026-10-08T04:06:00.5924066Z PASS browser functions denied
2026-10-08T04:06:00.5931264Z PASS cross_tenant_fk_denied
2026-10-08T04:06:00.5939689Z PASS settlement_locked: settlement_locked
2026-10-08T04:06:00.5941020Z PASS settlement_immutable: settlement_immutable
2026-10-08T04:06:00.5943564Z PASS settlement_immutable: settlement_immutable
2026-10-08T04:06:00.5949109Z PASS settlement_immutable: settlement_immutable
2026-10-08T04:06:00.5962354Z PASS unknown stays frozen
2026-10-08T04:06:00.5963343Z PASS expired_lease_never_redispatches (no lease reset exists)
2026-10-08T04:06:00.5968012Z PASS cross tenant read empty
2026-10-08T04:06:00.5993349Z PASS settlement_pending_financial_operation: settlement_pending_financial_operation
2026-10-08T04:06:00.6013608Z PASS settlement_pending_financial_operation: settlement_pending_financial_operation
2026-10-08T04:06:00.6040352Z PASS settlement_pending_financial_operation: settlement_pending_financial_operation
2026-10-08T04:06:00.6070154Z PASS settlement_pending_financial_operation: settlement_pending_financial_operation
2026-10-08T04:06:00.6071359Z PASS pending deposit or receipt execution refuses freeze
2026-10-08T04:06:00.6075762Z PASS settlement_locked: settlement_locked
2026-10-08T04:06:00.6082301Z PASS settlement_locked: settlement_locked
2026-10-08T04:06:00.6085098Z PASS settlement_locked: settlement_locked
2026-10-08T04:06:00.6089480Z PASS settlement_locked: settlement_locked
2026-10-08T04:06:00.6092103Z PASS settlement_locked: settlement_locked
2026-10-08T04:06:00.6095038Z PASS settlement_locked: settlement_locked
2026-10-08T04:06:00.6107906Z PASS settlement_locked: settlement_locked
2026-10-08T04:06:00.6181949Z PASS unknown bill cannot advance without bound evidence
2026-10-08T04:06:00.6203697Z PASS settlement_expired_proof: settlement_expired_proof
2026-10-08T04:06:00.6213450Z PASS settlement_untrusted_proof: settlement_untrusted_proof
2026-10-08T04:06:00.6219651Z PASS settlement_untrusted_proof: settlement_untrusted_proof
2026-10-08T04:06:00.6221938Z PASS invalid progress cannot persist evidence
2026-10-08T04:06:00.6239859Z PASS only accounting proof resolves unknown bill
2026-10-08T04:06:00.6240871Z PASS progress evidence is append-only
2026-10-08T04:06:00.6248712Z PASS same progress digest replays without extra event
2026-10-08T04:06:00.6291456Z PASS proven balance receipt recovers unknown create without repost
2026-10-08T04:06:00.6292316Z PASS settlement balance is never inserted as a deposit
2026-10-08T04:06:00.6338880Z PASS allocation proof resolves unknown without a second POST
2026-10-08T04:06:00.6349900Z PASS settlement_untrusted_proof: settlement_untrusted_proof
2026-10-08T04:06:00.6360804Z PASS settlement_untrusted_proof: settlement_untrusted_proof
2026-10-08T04:06:00.6383426Z PASS full conservation proof settles without a financial retry
2026-10-08T04:06:00.6384257Z PASS bill balance and allocation each retain exactly one attempt
2026-10-08T04:06:00.6410383Z PASS GET-only proof refresh supports an expired local close retry
2026-10-08T04:06:00.6515474Z PASS settlement_invalid_state: settlement_invalid_state
2026-10-08T04:06:00.6516208Z PASS unresolved later allocation fences every subsequent write
2026-10-08T04:06:00.6538799Z PASS settlement_stale_revision: settlement_stale_revision
2026-10-08T04:06:00.6543396Z PASS settlement_untrusted_proof: settlement_untrusted_proof
2026-10-08T04:06:00.6554941Z PASS settlement_expired_proof: settlement_expired_proof
2026-10-08T04:06:00.6563675Z PASS alien room reparenting rejected by scoped FK
2026-10-08T04:06:00.6596197Z PASS settlement_room_scope_mismatch: settlement_room_scope_mismatch
2026-10-08T04:06:00.6654185Z PASS synthetic_room_two_failure: synthetic_room_two_failure
2026-10-08T04:06:00.6656812Z PASS room2 failure rolls back reservation room1 and DND
2026-10-08T04:06:00.6657603Z PASS failed close has zero handoffs and close events
2026-10-08T04:06:00.6717450Z PASS settled stay closes atomically
2026-10-08T04:06:00.6718719Z PASS all occupied rooms released Dirty DNDoff
2026-10-08T04:06:00.6720650Z PASS one intent-linked housekeeping handoff per room
2026-10-08T04:06:00.6722266Z PASS one close event
2026-10-08T04:06:00.6730943Z PASS repeated close returns same durable result
2026-10-08T04:06:00.6733567Z PASS settlement_locked: settlement_locked
2026-10-08T04:06:00.6734771Z PASS browser cannot close
2026-10-08T04:06:00.6744781Z PASS native PostgreSQL17.6 setup and single-session checks
2026-10-08T04:06:00.8741529Z PASS one_claim_in_20_sessions
2026-10-08T04:06:00.8747324Z PASS one durable dispatch attempt
2026-10-08T04:06:00.9076681Z PASS freeze waits for started deposit
2026-10-08T04:06:00.9098793Z PASS pending deposit blocks concurrent freeze
2026-10-08T04:06:00.9432429Z PASS deposit waits for freezing transaction
2026-10-08T04:06:00.9444442Z PASS freeze wins deposit check/insert race
2026-10-08T04:06:00.9489898Z PASS settlement_busy
2026-10-08T04:06:00.9497576Z PASS child-first rollback and no deadlock
2026-10-08T04:06:01.0012726Z PASS 20 parallel closes return one durable outcome
2026-10-08T04:06:01.0022284Z PASS parallel close has one close event
2026-10-08T04:06:01.0028630Z PASS parallel close has exactly two applied room handoffs
2026-10-08T04:06:01.0034213Z PASS parallel close releases every room Dirty DNDoff
2026-10-08T04:06:01.0035183Z PASS all named native multi-session checks; no N3 calls
```
