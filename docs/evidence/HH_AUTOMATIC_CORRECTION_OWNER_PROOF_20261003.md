# Owner-run automatic receipt Update proof

Date: 03/10/2026, Malaysia. Upload to Project Sources: No.
Status: TEST DESIGN ONLY; no N3 login, probe, receipt modification or build performed.
Companion: `../superpowers/specs/2026-10-03-automatic-receipt-correction-design.md`.

## Owner instructions / 老板操作说明

这次 APPROVE 允许完成设计文件，不代表已把真实 RM50 改成 RM65。
实施计划批准后，Codex 准备限定用途的测试工具及自动生成的安全报告；
N3 登录和测试由老板自己操作，不需要在聊天发送密码、Token 或完整客人资料。
当前应用还没有这个自动 Update 测试工具，以下不是现在可以点击的按钮说明。

开始金融测试前只需确认一份具体测试单：

1. 确认是可修改的测试公司，以及指定的未匹配、未对账、未退款、未取消测试收据。
   不把 BK260920001 / OR2610/001 当作测试单；现有 RM65 请求也不自动重放。
2. 查看工具列出的公司、收据 ID/编号、日期、原金额、收款账户、客户代码、
   要求修改的新金额及联系人字段。确认本次精确测试修改后才执行。
3. 按准备好的测试步骤，在 HotelHub 批准一次或直接保存一次；查看结果报告，
   同时打开 N3 确认金额及凭证。失败或不确定时只检查结果，不重复金融发送。
4. 并发、断网和限制状态测试由 Codex 准备的隔离工具控制；任何需要再次真实修改
   的测试都先显示明确目标和字段。完成后上传脱敏报告即可。

如果原测试公司没有真实隔离确认，停止写入；继续本地/隔离模拟验证。
已有 Cash Sale、退款、核销的界面测试，不能代替本次 AR Receipt Update API 证明。

## Contract source and evidence requirements

Official unauthenticated sales-v1 OpenAPI fetched 03/10/2026:
`https://openapi.account.qne.cloud/doc/sales-v1.json`.
SHA256 `0d01ddd02952f17b71603bb72bffe2139b1bf5a24ccafef659efd1f18b3989f2`.
Lists POST `/api/ARReceipts/Update`, ARReceiptDto and confirmation flags, both
default false. It does not establish successful tenant mutation, preservation,
conditional concurrency, retry semantics or balanced final accounting.

The prepared proof package must bind each case to source SHA, payload hash,
tenant/company, immutable receipt ID, document code, N3 date/reference/customer/
currency, baseline payment lines, exact baseline journal, policy revision, actor
and expected outcome. Keep full necessary evidence in access-controlled storage;
commit sanitized fixtures/reports/hashes without tokens or guest personal data.
No simulated result is labelled live proof.

## Exact required test matrix

| Case | Owner-authorized action / probe | Required result |
| --- | --- | --- |
| Amount, approval ON | On a designated MYR50 test receipt propose MYR65; Owner clicks Approve once | Exactly one Update dispatch, N3 receipt MYR65, same account debit MYR65 and correct customer credit MYR65; one effective version |
| Direct mode | On another designated fixture switch approval OFF; Owner saves the displayed new amount | Same proof pipeline without fabricated approval; unchanged FrontDesk financial-write permissions |
| Contact-only | Change only explicitly displayed receipt contact fields | Exact requested contact; amount/payment/account/customer/date/reference unchanged; journal still exact |
| Combined fields | Amount plus contact with only one relevant switch ON | Whole proposal awaits approval; no split/direct bypass |
| Preservation | Inspect receipt before/after the approved Update | ID/document/date/reference/currency/customer/details and every non-proposed field preserved under the documented adapter contract |
| Repeated action | Double-click and reopen the same completed proposal | At most one dispatch; same local result; no duplicate journal/effective contribution |
| Outside concurrency | Owner-authorized isolated API test: read baseline, apply an intervening N3 change, attempt the prepared stale payload | Upstream rejects stale Update without overwriting the intervening change, with a documented concurrency mechanism |
| Restrictions | Prepared fixtures with matching/refund/reconciliation/cancellation/unknown state | HotelHub preflight refuses; no override flags or financial POST. Upstream restrictions can be proved only with separately approved safe probes |
| Lost response | Controlled approved sandbox send with response loss, then GET-only reconciliation | No resend; retained hold; proven final receipt/journal completes once, or explicit unresolved outcome |
| Post-send DB failure | Isolated instrumented failure after approved N3 result | Durable unknown attempt; later proof completes once; no second Update |
| Two browsers | Requester and Owner watch booking/checkout/dashboard/report through a success | All effective values refresh on next revision poll/refetch; month/role/tenant rules stay intact |
| Local bill-to | Test approval ON then OFF on a disposable reservation, not an N3 receipt | ON leaves effective/printed details until approval; OFF local authorized save; posted N3 contact is not silently changed |

New amount values for cases other than the explicit MYR50→65 fixture are displayed
in each generated test package and approved before those writes. The fixture must
actually start at MYR50; do not manufacture a baseline by editing a real receipt.

The outside-concurrency result is an activation blocker, not an optional check.
If N3 cannot enforce stale-update rejection or an equivalent conditional write,
record unsupported and leave automatic financial execution disabled. A successful
single-user change is insufficient. Do not pass bank-recon/knockoff confirmations
as true. Do not use Void/Delete/refund/unmatch to clean up tests; cleanup requires
its own approved scope.

## Completion report

For each case record PASS / FAIL / BLOCKED, expected versus actual fields and safe
reason codes, request/attempt IDs, dispatch count, business-envelope outcome,
receipt/journal hashes, local verified-version count, revision and timing. Prove
the balanced exact account/customer posting, not just a receipt screenshot or
HTTP200. Record unchanged prohibited fields and no unexpected accounting rows.
The Owner confirms the report belongs to their signed-in sandbox operation.

Separately record disposable-PostgreSQL two-connection race results, hosting
execution deadline measurement and two-browser refresh evidence. No production
enablement until all blocking contract results pass and exact activation/release
candidate receives its separate approval. No proof has been executed yet.
