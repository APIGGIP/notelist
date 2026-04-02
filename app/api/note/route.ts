import { z } from "zod";

import { jsonNoStore } from "@/lib/http";
import { saveNote } from "@/lib/notebook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const payloadSchema = z.object({
  text: z.string().max(500000),
  baseRevision: z.number().int().min(0),
  force: z.boolean().optional()
});

export async function PUT(request: Request) {
  try {
    const parsed = payloadSchema.safeParse(await request.json());

    if (!parsed.success) {
      return jsonNoStore(
        {
          error: "Invalid note payload."
        },
        { status: 400 }
      );
    }

    const result = await saveNote(parsed.data);

    if (result.conflict) {
      return jsonNoStore(result, { status: 409 });
    }

    return jsonNoStore(result.state);
  } catch (error) {
    return jsonNoStore(
      {
        error: error instanceof Error ? error.message : "Unable to save note."
      },
      { status: 500 }
    );
  }
}
