import { createFileRoute } from "@tanstack/react-router";
import { json, readJson, withReceiptActor } from "@/lib/receipt-controls-http.server";
import {
  readChangePolicy,
  setChangePolicy,
  validateChangePolicyInput,
} from "@/lib/hotel-change-controls-store.server";
export const Route = createFileRoute("/api/hotel/change-controls")({
  server: {
    handlers: {
      GET: ({ request }) =>
        withReceiptActor(request, "hotel:receipt_controls:request", false, async (actor) => {
          const policy = await readChangePolicy(actor.tenantId);
          return json({ available: policy !== null, policy });
        }),
      PATCH: ({ request }) =>
        withReceiptActor(request, "hotel:setup", true, async (actor) =>
          json({
            policy: await setChangePolicy(
              actor,
              validateChangePolicyInput(await readJson(request)),
            ),
          }),
        ),
    },
  },
});
