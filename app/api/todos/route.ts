import { z } from "zod";

import { jsonNoStore } from "@/lib/http";
import { createTodo } from "@/lib/notebook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const createSchema = z.object({
  title: z.string().trim().min(1).max(180),
  priceCents: z.number().int().min(0).max(999999999999)
});

export async function POST(request: Request) {
  try {
    const parsed = createSchema.safeParse(await request.json());

    if (!parsed.success) {
      return jsonNoStore(
        {
          error: "Invalid todo payload."
        },
        { status: 400 }
      );
    }

    const state = await createTodo(parsed.data);
    return jsonNoStore(state, { status: 201 });
  } catch (error) {
    return jsonNoStore(
      {
        error: error instanceof Error ? error.message : "Unable to create todo."
      },
      { status: 500 }
    );
  }
}
