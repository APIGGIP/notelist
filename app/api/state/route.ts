import { z } from "zod";

import { getNotebookRevision, getNotebookState } from "@/lib/notebook";
import { emptyNoStore, jsonNoStore } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const querySchema = z.object({
  since: z.coerce.number().int().min(0).optional()
});

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const parsed = querySchema.safeParse({
      since: searchParams.get("since") ?? undefined
    });

    if (!parsed.success) {
      return jsonNoStore(
        {
          error: "Invalid query parameters."
        },
        { status: 400 }
      );
    }

    const currentRevision = await getNotebookRevision();

    if (parsed.data.since !== undefined && currentRevision <= parsed.data.since) {
      return emptyNoStore(204, {
        "x-state-revision": String(currentRevision)
      });
    }

    const state = await getNotebookState();

    return jsonNoStore(state, {
      headers: {
        "x-state-revision": String(state.stateRevision)
      }
    });
  } catch (error) {
    return jsonNoStore(
      {
        error: error instanceof Error ? error.message : "Unable to load notebook state."
      },
      { status: 500 }
    );
  }
}
