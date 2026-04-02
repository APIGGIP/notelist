import { NotebookWorkspace } from "@/components/notebook-workspace";
import { getNotebookState } from "@/lib/notebook";
import type { NotebookState } from "@/types/notebook";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function HomePage() {
  let initialState: NotebookState | null = null;
  let bootstrapError: string | null = null;

  try {
    initialState = await getNotebookState();
  } catch (error) {
    bootstrapError =
      error instanceof Error
        ? error.message
        : "無法連線到資料庫，請確認環境變數是否已設定完成。";
  }

  return <NotebookWorkspace initialState={initialState} bootstrapError={bootstrapError} />;
}
