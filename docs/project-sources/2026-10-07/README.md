# HotelHub source pack — installation

Date07/10/2026, Malaysia; client target 01/11/2026.
Upload to Project Sources: **No** — installation guide only.

## 安装方法

1. 解压ZIP；sources/下18个Markdown全部Upload **Yes**，用同名文件替换旧来源，
   新增HH_BEC_ROOM_LOT_CONTROL.md，每个逻辑文件保留一份当前版本。
2. PROJECT_INSTRUCTIONS.md：Upload **No**。复制其中text代码块到Project Instructions。
   此次没有修改实际设置，也没有安装Lovable Knowledge。
3. ZIP、README和MANIFEST.json：Upload **No**。旧原件在仓库archive中保留，
   不作为“当前”来源再次上传。

已记录一个HotelHub套餐、默认30房/份：1=30，2=60，3=90。
MUGS编辑份数/默认大小、实际计数/降额/到期机制属于规格待审核部分。
BEC目前未控制HotelHub，本次没有修改授权、数据库、产品代码或发布网站。

## Active files

| File | Upload to Project Sources |
| --- | --- |
| 00-MUGS_DIRECTBUILD_PROTOCOL.md | Yes |
| 01-SOURCE_REFRESH_SUMMARY.md | Yes |
| 02-HOTELHUB_COMPLETION_PLAN.md | Yes |
| 03-HOTELHUB_N3_FINANCIAL_POSTING_KNOCKOFF_MASTER_RECORD.md | Yes |
| 04-HOTELHUB_BASE_INDEX.md | Yes |
| 05-VERIFIED_BASELINE_CURRENT.md | Yes |
| 06-HH1.0_PROJECT_SOURCE_REFRESH_REPORT.md | Yes |
| 07-HOTELHUB_INTEGRATION_REGISTRY.md | Yes |
| 08-HOTELHUB_PRODUCT_DECISIONS.md | Yes |
| 09-PROJECT_START_HERE.md | Yes |
| 10-LOVABLE_GOVERNANCE.md | Yes |
| 11-CROSS_PROJECT_LESSONS_AND_BUG_PREVENTION.md | Yes |
| HH_BEC_ROOM_LOT_CONTROL.md | Yes |
| HH_CHANGE_IMPACT_MAP.md | Yes |
| HH_DEPOSIT_VERIFICATION_CHECKPOINT.md | Yes |
| HH_PAYMENT_METHOD_CONTROLS_CHECKPOINT.md | Yes |
| HH_UI_NAVIGATION_HELP_CHECKPOINT.md | Yes |
| MDB-01_HOTELHUB_ADOPTION.md | Yes |

## Continuity

Canonical: docs/project-sources/2026-10-07 on existing HotelHub review branch.
Original 17 inputs: docs/project-sources/archive/2026-10-07-inputs, byte-identical.
Manifest includesSHA256; commonprotocolv1.1 unchanged.
Baseline/roadmap separate facts, approvedtarget and incompletework.
No exhaustive access to all original project conversations is claimed.

Latest order: N3账单/收据核销 → 安全退房/房态交接 → 门卡 → BEC → 全系统客户验收。
门卡SDK只读检查完成；并非已接通或实物验收。
