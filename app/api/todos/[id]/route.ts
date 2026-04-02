import { z } from "zod";

import { jsonNoStore } from "@/lib/http";
import { deleteTodo, updateTodo } from "@/lib/notebook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const updateSchema = z
  .object({
    title: z.string().trim().min(1).max(180).optional(),
    priceCents: z.number().int().min(0).max(999999999999).optional(),
    completed: z.boolean().optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required."
  });

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const [{ id }, payload] = await Promise.all([params, request.json()]);
    const parsed = updateSchema.safeParse(payload);

    if (!parsed.success) {
      return jsonNoStore(
        {
          error: "Invalid todo payload."
        },
        { status: 400 }
      );
    }

    const state = await updateTodo(id, parsed.data);

    if (!state) {
      return jsonNoStore(
        {
          error: "Todo not found."
        },
        { status: 404 }
      );
    }

    return jsonNoStore(state);
  } catch (error) {
    return jsonNoStore(
      {
        error: error instanceof Error ? error.message : "Unable to update todo."
      },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const state = await deleteTodo(id);

    if (!state) {
      return jsonNoStore(
        {
          error: "Todo not found."
        },
        { status: 404 }
      );
    }

    return jsonNoStore(state);
  } catch (error) {
    return jsonNoStore(
      {
        error: error instanceof Error ? error.message : "Unable to delete todo."
      },
      { status: 500 }
    );
  }
}
