// Real local application + intercepted fixture APIs only. No backend/N3 request is allowed.
const { chromium } = require("playwright");
const strictAssert = require("node:assert/strict");
let checks = 0;
const assert = Object.fromEntries(
  ["equal", "deepEqual", "match"].map((method) => [
    method,
    (...args) => {
      strictAssert[method](...args);
      checks++;
    },
  ]),
);
const { spawn } = require("node:child_process");
const { openSync } = require("node:fs");
const base = process.env.HH_UI_BASE || "http://127.0.0.1:5191";
const id = "11111111-1111-4111-8111-111111111111";
const accountId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const session = {
  authenticated: true,
  tenant: { tenantId: "fixture-tenant", tenantCode: "FIXTURE", companyName: "HotelHub UI Fixture" },
  user: {
    n3UserKey: "fixture-owner",
    userName: "Fixture Owner",
    userEmail: "fixture@example.test",
  },
  role: "owner",
  roleStatus: "assigned",
  roleReason: null,
  housekeepingMode: "dedicated",
  exceptionApprovalMode: "owner_approval",
  displaySize: 7,
};
const reservation = {
  id,
  bookingReference: "BK261001001",
  bookingSource: "walk_in",
  status: "confirmed",
  arrivalDate: "2026-10-01",
  departureDate: "2026-10-02",
  currency: "MYR",
  notes: null,
  externalBookingReference: null,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  createdByLabel: "Fixture Owner",
  checkedInAt: null,
  checkedInByLabel: null,
  expectedCheckOutAt: null,
  rooms: [],
  guests: [],
};
const capabilities = {
  mode: "full",
  canOpenEditor: true,
  canEditStayAndRooms: true,
  canEditGuestContact: true,
  canEditGuestIdentity: true,
  canAddRemoveGuests: true,
  canReassignGuests: true,
  canChangePrimaryGuest: true,
  requiresCorrectionReason: false,
  reasonCode: null,
};
const roomId = "22222222-2222-4222-8222-222222222222";
reservation.rooms = [
  {
    id: roomId,
    hotelRoomId: roomId,
    roomNumber: "101",
    displayName: "Room 101",
    n3StockName: "Standard",
    baseRateSnapshot: 100,
    agreedRate: 100,
    adults: 1,
    children: 0,
    maxOccupancy: 2,
    allocationStatus: "reserved",
    rateOverrideReason: null,
    remark: null,
  },
];
reservation.guests = [
  {
    id: "33333333-3333-4333-8333-333333333333",
    guestId: "33333333-3333-4333-8333-333333333333",
    fullName: "Fixture Guest",
    mobile: null,
    email: null,
    nationality: null,
    nationalityCode: null,
    identityType: null,
    identityNumberMasked: null,
    notes: null,
    addressLine1: null,
    addressLine2: null,
    addressLine3: null,
    city: null,
    postcode: null,
    countryCode: null,
    stateCode: null,
    stateProvince: null,
    isPrimary: true,
    assignedReservationRoomId: roomId,
  },
];
const secondId = "44444444-4444-4444-8444-444444444444";
const secondReservation = {
  ...reservation,
  id: secondId,
  bookingReference: "BK261001002",
  updatedAt: "2026-10-01T02:00:00Z",
  notes: "Original B",
};
const requests = [],
  errors = [];
let listError = false,
  split = false,
  gate = true,
  depositRows = [],
  releasePost,
  releaseSave,
  lostSave = false,
  replaySave = false;
async function run() {
  const log = openSync("/tmp/hh-workspace-vite.log", "w");
  const server = spawn(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "5191"],
    { stdio: ["ignore", log, log] },
  );
  for (let tries = 0; tries < 60; tries++) {
    try {
      await fetch(base);
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  const browser = await chromium.launch({
    executablePath: "/tmp/servicehub-shell/chrome-headless-shell-linux64/chrome-headless-shell",
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    if (url.origin !== base) return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    requests.push({ path: url.pathname, method: req.method(), body: req.postDataJSON() });
    const json = (body, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/api/session/me") return json(session);
    if (url.pathname === `/api/hotel/reservations/${id}`) {
      if (req.method() === "PATCH") {
        const payload = req.postDataJSON();
        if (!replaySave)
          await new Promise((resolve) => {
            releaseSave = resolve;
          });
        reservation.notes = payload.notes;
        reservation.updatedAt = replaySave
          ? reservation.updatedAt
          : lostSave
            ? "2026-10-01T03:00:00Z"
            : "2026-10-01T01:00:00Z";
        if (lostSave) {
          lostSave = false;
          replaySave = true;
          return route.abort("failed");
        }
        const replayed = replaySave;
        replaySave = false;
        return json({ reservationId: id, updatedAt: reservation.updatedAt, replayed });
      }
      return json({ reservation, editCapabilities: capabilities, checkInAction: null });
    }
    if (url.pathname === `/api/hotel/reservations/${secondId}`)
      return json({
        reservation: secondReservation,
        editCapabilities: capabilities,
        checkInAction: null,
      });
    if (url.pathname.endsWith("/deposits/preview")) {
      const data = req.postDataJSON();
      return json({
        preview: {
          bookingReference: reservation.bookingReference,
          customerLabel: "Fixture walk-in",
          amount: data.amount,
          currency: "MYR",
          accountLabel: "DuitNow",
          paymentLines: data.paymentLines.map((l) => ({
            accountLabel: "DuitNow",
            amount: l.amount,
          })),
          warning: "Fixture only",
        },
      });
    }
    if (url.pathname.endsWith("/deposits")) {
      if (req.method() === "POST") {
        const payload = req.postDataJSON();
        await new Promise((resolve) => {
          releasePost = resolve;
        });
        depositRows = [
          {
            id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            clientRequestId: payload.clientRequestId,
            status: "unknown",
            amount: payload.amount,
            currency: "MYR",
            n3DocCode: null,
            n3ReceiptId: null,
            customerLabel: "Fixture walk-in",
            accountLabel: "DuitNow",
            paymentLines: [{ accountLabel: "DuitNow", amount: payload.amount }],
            description: null,
            createdByLabel: "Fixture Owner",
            createdAt: "2026-10-01T00:00:00Z",
            errorCode: "n3_result_uncertain",
          },
        ];
        return route.abort("failed");
      }
      return listError
        ? json({ error: "deposit_read_failed" }, 500)
        : json({ deposits: depositRows, capability: { canCreate: gate, canSplit: split } });
    }
    if (url.pathname.endsWith("/reconcile")) {
      depositRows = depositRows.map((d) => ({
        ...d,
        status: "posted",
        n3DocCode: "OR-FIXTURE",
        n3ReceiptId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        errorCode: null,
      }));
      return json({ deposit: depositRows[0] });
    }
    if (url.pathname === "/api/hotel/payment-accounts")
      return json({
        accounts: [
          {
            id: accountId,
            code: "700-0310",
            name: "Bank",
            label: "DuitNow",
            kind: "bank",
            show: true,
          },
        ],
      });
    if (url.pathname === "/api/hotel/availability") return json({ rooms: [] });
    if (url.pathname === "/api/hotel/booking-sources")
      return json({ sources: [{ code: "walk_in", name: "Walk-in", isActive: true }] });
    if (url.pathname === "/api/hotel/housekeeping")
      return json({
        mode: "dedicated",
        propertyDate: "2026-10-01",
        timezone: "Asia/Kuala_Lumpur",
        rooms: [],
        counts: { not_set_up: 0 },
        authority: {
          canInitialize: true,
          canUpdate: true,
          canOpenWorkspace: true,
          canUseDedicatedWorkspace: true,
        },
      });
    if (url.pathname === "/api/hotel/reservation-calendar")
      return json({
        rangeStart: "2026-10-01",
        rangeEndExclusive: "2026-10-31",
        rooms: [
          {
            hotelRoomId: roomId,
            roomNumber: "101",
            displayName: "Room 101",
            n3StockCode: "ROOM101",
            n3StockName: "Standard",
            roomType: "Standard",
            floor: "1",
            maxGuests: 2,
            isActive: true,
          },
        ],
        allocations: [],
      });
    if (url.pathname === "/api/hotel/reservations")
      return json({
        items: [reservation, secondReservation].map((r) => ({
          ...r,
          primaryGuestName: "Fixture Guest",
          primaryGuestMobile: null,
          roomLabels: ["Room 101"],
          roomCount: 1,
          guestCount: 1,
        })),
        total: 2,
        propertyDate: "2026-10-01",
        limit: 25,
        offset: 0,
      });
    if (url.pathname.endsWith("/operations")) return json({ requests: [] });
    if (url.pathname.endsWith("/timeline")) return json({ events: [] });
    return json({ error: "fixture_unavailable" }, 403);
  });
  try {
    await page.goto(`${base}/reservations/${id}`);
    if (process.env.HH_UI_CALENDAR_ONLY) {
      await page.getByRole("link", { name: "Back to Calendar", exact: true }).click();
      const grid = page.getByLabel(
        "Room calendar; scroll horizontally or vertically to view dates and rooms",
        { exact: true },
      );
      await grid.waitFor();
      await grid.evaluate((e) => {
        e.scrollLeft = 200;
      });
      await page.waitForTimeout(150);
      const before = await grid.evaluate((e) => e.scrollLeft);
      await page
        .getByRole("navigation", { name: "Primary", exact: true })
        .getByRole("link", { name: "Housekeeping", exact: true })
        .click();
      await page.getByRole("heading", { name: "Housekeeping", exact: true }).waitFor();
      await page.getByRole("button", { name: "Open Calendar", exact: true }).click();
      await grid.waitFor();
      await page.waitForTimeout(150);
      assert.equal(await grid.evaluate((e) => e.scrollLeft), before);
      console.log("Calendar focus PASS");
      return;
    }

    const deposits = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Deposits", exact: true }) });
    await deposits.locator("select").waitFor();
    await deposits.locator("select").selectOption(accountId);
    await deposits.locator("input").last().fill("50");
    await deposits.getByRole("heading", { name: "Deposits", exact: true }).click();
    assert.equal(
      await deposits.locator("input").last().inputValue(),
      "50.00",
      "payment blur must show 2 decimals",
    );
    assert.equal(
      await deposits.getByRole("button", { name: "Add deposit", exact: true }).isEnabled(),
      true,
      "payment-line entry must enable Add Deposit",
    );
    assert.equal(
      await deposits.getByRole("button", { name: "Add another payment method" }).count(),
      0,
      "closed split gate must not offer second method",
    );
    await deposits.getByRole("button", { name: "Add deposit", exact: true }).click();
    await deposits.getByText("Fixture walk-in", { exact: true }).waitFor();
    const preview = requests.find((r) => r.path.endsWith("/deposits/preview"));
    assert.deepEqual(preview.body, { amount: 50, paymentLines: [{ accountId, amount: 50 }] });
    assert.equal(
      requests.filter((r) => r.method === "POST" && r.path.endsWith("/deposits")).length,
      0,
      "review does not submit a financial write",
    );
    await deposits.getByRole("button", { name: "Cancel", exact: true }).click();
    await deposits.locator("input").last().fill("40.3");
    await deposits.getByRole("heading", { name: "Deposits", exact: true }).click();
    assert.equal(await deposits.locator("input").last().inputValue(), "40.30");
    await page
      .getByRole("navigation", { name: "Primary", exact: true })
      .getByRole("link", { name: "Housekeeping", exact: true })
      .click();
    const tabs = page.getByRole("navigation", { name: "Open work tabs" });
    await tabs.getByRole("button", { name: "Open BK261001001", exact: true }).click();
    assert.equal(
      await deposits.locator("input").last().inputValue(),
      "40.30",
      "switching workspace preserves payment draft",
    );
    await page.evaluate(() => window.scrollTo(0, 600));
    await page.waitForTimeout(300);
    assert.equal(
      await page
        .locator('[data-testid="fixed-workspace-bars"]')
        .evaluate((e) => Math.round(e.getBoundingClientRect().top)),
      0,
      "menu and tabs remain visible",
    );
    assert.equal(
      await page
        .getByRole("heading", { name: "Reservation", exact: true })
        .locator("xpath=ancestor::header[1]")
        .evaluate((e) => Math.round(e.getBoundingClientRect().top)),
      await page
        .locator('[data-testid="fixed-workspace-bars"]')
        .evaluate((e) => Math.round(e.getBoundingClientRect().bottom)),
      "title stays directly below fixed navigation and tabs",
    );
    const account = page.getByRole("button", { name: "Account information" });
    assert.match(
      await account.innerText(),
      /Fixture Owner[\s\S]*Owner/,
      "actual role is next to signed-in name",
    );
    await page.screenshot({ path: "/tmp/hh-workspace-desktop.png", fullPage: false });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: "/tmp/hh-workspace-phone.png", fullPage: false });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      true,
      "phone page must not overflow horizontally",
    );
    await page.getByRole("button", { name: "Open main menu" }).click();
    await page
      .getByRole("navigation", { name: "Mobile primary" })
      .getByRole("link", { name: "Housekeeping", exact: true })
      .click();
    await tabs.getByRole("button", { name: "Open BK261001001", exact: true }).click();
    assert.equal(await deposits.locator("input").last().inputValue(), "40.30");
    let closeDialog = false;
    page.once("dialog", async (dialog) => {
      closeDialog = true;
      await dialog.dismiss();
    });
    await tabs.getByRole("button", { name: "Close BK261001001", exact: true }).click();
    assert.equal(closeDialog, true, "closing a payment draft requests confirmation");
    assert.equal(
      await tabs.getByRole("button", { name: "Open BK261001001", exact: true }).count(),
      1,
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("link", { name: "Edit reservation", exact: true }).click();
    const notes = page.getByRole("textbox", { name: "Internal notes", exact: true });
    await notes.fill("Retained draft");
    await page
      .getByRole("navigation", { name: "Primary", exact: true })
      .getByRole("link", { name: "Housekeeping", exact: true })
      .click();
    await tabs.getByRole("button", { name: "Open BK261001001", exact: true }).click();
    assert.equal(
      await notes.inputValue(),
      "Retained draft",
      "editor draft survives workspace switching",
    );
    let discardDialog = false;
    page.once("dialog", async (dialog) => {
      discardDialog = true;
      await dialog.dismiss();
    });
    await page.getByRole("link", { name: "Discard changes", exact: true }).click();
    assert.equal(discardDialog, true, "discard dirty editor requests confirmation");
    assert.equal(await notes.inputValue(), "Retained draft");
    page.once("dialog", async (dialog) => {
      await dialog.accept();
    });
    await page.getByRole("link", { name: "Discard changes", exact: true }).click();
    assert.equal(
      await deposits.locator("input").last().inputValue(),
      "40.30",
      "discarding editor leaves payment draft intact",
    );
    // Confirmation previews belong to the same booking as the retained intent.
    await deposits.getByRole("button", { name: "Add deposit", exact: true }).click();
    await deposits.getByText("Fixture walk-in", { exact: true }).waitFor();
    await page
      .getByRole("navigation", { name: "Primary", exact: true })
      .getByRole("link", { name: "Reservations", exact: true })
      .click();
    await page.getByRole("link", { name: "BK261001002", exact: true }).click();
    await deposits.locator("select").selectOption(accountId);
    await deposits.locator("input").last().fill("80");
    await deposits.getByRole("button", { name: "Add deposit", exact: true }).click();
    await deposits.getByText("MYR 80.00", { exact: true }).waitFor();
    await tabs.getByRole("button", { name: "Open BK261001001", exact: true }).click();
    await deposits.getByRole("button", { name: "Review deposit", exact: true }).waitFor();
    assert.equal(
      await deposits
        .getByRole("button", { name: "Confirm and post to N3", exact: true })
        .isDisabled(),
      true,
      "cached preview from another booking cannot authorize confirmation",
    );
    await deposits.getByRole("button", { name: "Review deposit", exact: true }).click();
    await deposits.getByText("MYR 40.30", { exact: true }).waitFor();
    assert.equal(
      await deposits.getByText("MYR 80.00", { exact: true }).count(),
      0,
      "preview shows this booking's retained amount",
    );
    await deposits.getByRole("button", { name: "Cancel", exact: true }).click();
    await tabs.getByRole("button", { name: "Open BK261001002", exact: true }).click();
    await deposits.getByRole("button", { name: "Cancel", exact: true }).click();
    await tabs.getByRole("button", { name: "Open BK261001001", exact: true }).click();
    await deposits.getByRole("button", { name: "Add deposit", exact: true }).click();
    await deposits.getByText("Fixture walk-in", { exact: true }).waitFor();
    await deposits.getByRole("button", { name: "Confirm and post to N3", exact: true }).click();
    await page
      .getByRole("navigation", { name: "Primary", exact: true })
      .getByRole("link", { name: "Housekeeping", exact: true })
      .click();
    await tabs.getByRole("button", { name: "Open BK261001001", exact: true }).click();
    assert.equal(
      await deposits
        .getByRole("button", { name: "Confirm and post to N3", exact: true })
        .isDisabled(),
      true,
      "a retained pending intent cannot be posted again",
    );
    releasePost();
    await deposits.getByRole("button", { name: "Check N3 result", exact: true }).waitFor();
    assert.equal(
      await deposits.getByRole("button", { name: "Add deposit", exact: true }).count(),
      0,
      "unconfirmed server result blocks another receipt",
    );
    await deposits.getByRole("button", { name: "Check N3 result", exact: true }).click();
    await deposits.locator("input").last().waitFor();
    assert.equal(
      requests.filter((r) => r.method === "POST" && r.path.endsWith("/deposits")).length,
      1,
      "no duplicate simulated Create after switching tabs",
    );
    // A save cannot enable a second editor or erase fresh drafts after tab switching.
    await page.getByRole("link", { name: "Edit reservation", exact: true }).click();
    await notes.fill("Saved across tabs");
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await page.getByRole("button", { name: "Saving…", exact: true }).waitFor();
    await page
      .getByRole("navigation", { name: "Primary", exact: true })
      .getByRole("link", { name: "Housekeeping", exact: true })
      .click();
    await tabs.getByRole("button", { name: "Open BK261001001", exact: true }).click();
    assert.equal(await notes.isDisabled(), true, "pending save locks the remounted editor");
    let blockedClose = false;
    page.once("dialog", async (dialog) => {
      blockedClose = true;
      await dialog.accept();
    });
    await tabs.getByRole("button", { name: "Close BK261001001", exact: true }).click();
    assert.equal(blockedClose, true, "pending save cannot be discarded by closing its tab");
    await page
      .getByRole("navigation", { name: "Primary", exact: true })
      .getByRole("link", { name: "Housekeeping", exact: true })
      .click();
    releaseSave();
    await page.getByText("Reservation updated.", { exact: true }).waitFor();
    assert.equal(
      new URL(page.url()).pathname,
      "/housekeeping",
      "background save does not force the active workspace away",
    );
    await tabs.getByRole("button", { name: "Open BK261001001", exact: true }).click();
    assert.equal(await notes.inputValue(), "Saved across tabs");
    await notes.fill("Lost-response draft");
    lostSave = true;
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await page.getByRole("button", { name: "Saving…", exact: true }).waitFor();
    releaseSave();
    await page.getByRole("button", { name: "Retry saved changes", exact: true }).waitFor();
    await page
      .getByRole("navigation", { name: "Primary", exact: true })
      .getByRole("link", { name: "Housekeeping", exact: true })
      .click();
    await tabs.getByRole("button", { name: "Open BK261001001", exact: true }).click();
    assert.equal(
      await notes.isDisabled(),
      true,
      "uncertain save remains protected across switching",
    );
    await page.getByRole("button", { name: "Retry saved changes", exact: true }).click();
    await deposits.getByRole("heading", { name: "Deposits", exact: true }).waitFor();
    const updates = requests.filter((r) => r.method === "PATCH");
    assert.equal(updates.length, 3);
    assert.deepEqual(
      updates[1].body,
      updates[2].body,
      "lost-response retry sends the same ID, version and payload",
    );
    // Direct cached editor A/B switching must not reuse another booking's refs.
    await page.getByRole("link", { name: "Edit reservation", exact: true }).click();
    await notes.waitFor();
    await page
      .getByRole("navigation", { name: "Primary", exact: true })
      .getByRole("link", { name: "Reservations", exact: true })
      .click();
    await page.getByRole("link", { name: "BK261001002", exact: true }).click();
    await page.getByRole("link", { name: "Edit reservation", exact: true }).click();
    await notes.fill("Draft for B");
    await tabs.getByRole("button", { name: "Open BK261001001", exact: true }).click();
    assert.equal(await notes.inputValue(), "Lost-response draft");
    await tabs.getByRole("button", { name: "Open BK261001002", exact: true }).click();
    assert.equal(
      await notes.inputValue(),
      "Draft for B",
      "switching directly between cached editors preserves each draft",
    );
    page.once("dialog", async (dialog) => {
      await dialog.accept();
    });
    await page.getByRole("link", { name: "Discard changes", exact: true }).click();
    await tabs.getByRole("button", { name: "Open BK261001001", exact: true }).click();
    await page.getByRole("link", { name: "Discard changes", exact: true }).click();
    await page
      .getByRole("navigation", { name: "Primary", exact: true })
      .getByRole("link", { name: "Housekeeping", exact: true })
      .click();
    assert.equal(
      await page.getByText(/Property date/).count(),
      0,
      "property date stays inside the title info",
    );
    await page.getByRole("button", { name: "About Housekeeping", exact: true }).click();
    await page
      .getByText("Property date 01/10/2026 · Asia/Kuala_Lumpur.", { exact: true })
      .waitFor();
    await page.keyboard.press("Escape");
    await page
      .getByText("Property date 01/10/2026 · Asia/Kuala_Lumpur.", { exact: true })
      .waitFor({ state: "hidden" });
    await page.getByRole("button", { name: /Ready/ }).first().click();
    await page.screenshot({ path: "/tmp/hh-workspace-housekeeping.png", fullPage: false });
    await tabs.getByRole("button", { name: "Open BK261001001", exact: true }).click();
    await page.getByRole("link", { name: "Back to Calendar", exact: true }).click();
    const grid = page.getByLabel(
      "Room calendar; scroll horizontally or vertically to view dates and rooms",
      { exact: true },
    );
    await grid.waitFor();
    await grid.evaluate((e) => {
      e.scrollLeft = 500;
    });
    await page.waitForTimeout(150);
    const calendarX = await grid.evaluate((e) => e.scrollLeft);
    assert.equal(calendarX > 0, true);
    await tabs.getByRole("button", { name: "Open Housekeeping", exact: true }).click();
    assert.equal(
      await page.getByRole("button", { name: /Ready/ }).first().getAttribute("aria-pressed"),
      "true",
      "housekeeping filter survives tab switching",
    );
    await tabs.getByRole("button", { name: "Open Calendar", exact: true }).click();
    await grid.waitFor();
    assert.equal(
      await grid.evaluate((e) => e.scrollLeft),
      calendarX,
      "calendar horizontal scroll survives tab switching",
    );
    await tabs.getByRole("button", { name: "Open BK261001001", exact: true }).click();
    listError = true;
    await page.reload();
    await deposits.getByRole("button", { name: "Retry deposits" }).waitFor();
    listError = false;
    await deposits.getByRole("button", { name: "Retry deposits" }).click();
    await deposits.locator("input").last().waitFor();
    session.role = "front_desk";
    await page.reload();
    await deposits.getByText(/Only the Owner/).waitFor();
    assert.equal(
      await deposits.getByRole("button", { name: "Add deposit", exact: true }).count(),
      0,
    );
    assert.equal(
      await tabs.getByRole("button", { name: "Open BK261001001", exact: true }).count(),
      1,
    );
    assert.deepEqual(errors, [], "no runtime render errors");
    console.log(
      JSON.stringify({
        result: "PASS",
        checks,
        realFinancialPosts: 0,
        simulatedCreates: requests.filter(
          (r) => r.method === "POST" && r.path.endsWith("/deposits"),
        ).length,
        apiFixtures: requests.length,
      }),
    );
  } finally {
    await browser.close();
    server.kill("SIGTERM");
  }
}
run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
