export type NotebookMode = "note" | "todo";

export type TodoItem = {
  id: string;
  title: string;
  priceCents: number;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
};

export type NotebookState = {
  noteText: string;
  noteRevision: number;
  stateRevision: number;
  updatedAt: string;
  todos: TodoItem[];
};

export type NoteConflictPayload = {
  conflict: true;
  state: NotebookState;
};
