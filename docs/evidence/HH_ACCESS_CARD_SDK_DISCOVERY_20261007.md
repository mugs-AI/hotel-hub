# HotelHub access-card SDK read-only discovery

Date: 07/10/2026, Asia/Kuala_Lumpur.
Upload to Project Sources: No — repository evidence; active integration registry summarizes it.

Input: Owner-uploaded PzUsbSdkDemo third-party protocol/example ZIP, SHA256
c69f72023080f6512236038ade696e94a3410f4493f7ae8cef4cd92792b3cba7.
Selectively extracted frm_main.cs, PzUsbSdkTest.csproj and protocol 3.2.doc to scratch;
converted the protocol to text for static reading. Did not run supplied DLL/EXE,
build the example, install drivers, access a USB device or write a physical card.
No vendor binaries, source code, full protocol or example passwords are published.

Observed sample: Windows Forms, .NET Framework 4.0, x86; P/Invoke declarations for
card_operate/card_Read/card_Write. JSON commands 101 read/102 write/103 cancel;
GB2312 sample encoding; room/building/floor and authorized date/card fields.
Protocol rev 3.2 is dated 19/07/2021. These observations identify an example contract,
not the installed writer/lock model, licensing or actual deployed compatibility.

Protocol says PZ22 main guest card invalidates prior guest cards based on issue time
when presented at the lock. PZ23 additional cards do not overwrite; subsequent cards
must use that type. Losing/replacing/extending a card must consider other guest
cards and physically offline locks. Cancel-at-writer does not prove lock revocation.
System password and sector keys must stay outside browser/logs. Generic sector
writes include password blocks that protocol warns may damage cards; exclude generic
writes from the proposed HotelHub adapter and require a separate vendor-safe contract.

Discrepancies to settle with vendor before hardware dispatch:
- Protocol describes dlen[0]; sample read builds a four-byte little-endian integer,
  write/cancel supply decimal-text bytes, and read decodes returned length as text.
  Establish ABI, capacity, input/output encoding, terminator and error semantics.
- Protocol JSON illustration shows long dates, while field table and sample use
  yyMMddHHmm / yyMMddHHmmss. Confirm timezone, lock clock, range and valid formatting.
- Protocol illustration is not valid JSON syntax; sample uses a JSON serializer.
- Return 0 and UID/read-back must not be treated as door-unlock acceptance.

Proposed direction only: authenticated bounded Windows adapter/agent for vendor
DLL on an approved front-desk computer, with server-authorized tenant/stay/device
jobs, idempotency, one writer claim, audit and uncertain-outcome recovery. Review
origin/channel protection and connection lifecycle before choosing a bridge.
No raw DLL keys/commands or arbitrary USB gateway exposed to browser. No contract
for a Cloudflare runtime loading the local Windows USB DLL is established.

Required next evidence: writer and lock vendor/model/firmware, Windows/driver/SDK
redistribution licence, actual card technology and configured sector/system identity,
room mapping, ABI clarification, kit and authorized physical acceptance. Test issue/
read-back, real lock open, primary/additional cards, extension/late departure,
room change, loss/replacement, checkout and disconnected-device/two-device recovery.
Physical access failures remain visible and do not falsify N3 settlement or room state.

Primary architecture references read 07/10/2026:
- https://learn.microsoft.com/en-us/dotnet/standard/native-interop/consuming-unmanaged-dll-functions
- https://developer.mozilla.org/en-US/docs/Web/API/WebUSB_API
.NET P/Invoke calls unmanaged DLL functions; WebUSB is a different limited-availability
browser device API. Adapter need is an inference from the supplied native example,
not evidence that no alternate vendor web API exists.
