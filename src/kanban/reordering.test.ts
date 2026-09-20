import { describe, expect, it } from "vitest";
import { moveBefore, moveOne } from "./reordering";
import type { BoardTask } from "./store";
const tasks: BoardTask[] = ["a", "b", "c", "d"].map((id, index) => ({
  id,
  title: id,
  listId: "list",
  position: String(index),
}));
describe("non-destructive sibling reordering", () => {
  it("moves before the first task by omitting previous", () => {
    expect(moveBefore(tasks, tasks[3], tasks[0])).toEqual({
      listId: "list",
      taskId: "d",
      parent: undefined,
      previous: undefined,
    });
  });
  it("excludes the source when choosing the preceding sibling", () => {
    expect(moveBefore(tasks, tasks[0], tasks[3])?.previous).toBe("c");
    expect(moveBefore(tasks, tasks[3], tasks[1])?.previous).toBe("a");
  });
  it("ignores no-op drops and refuses cross-list or cross-parent moves", () => {
    expect(moveBefore(tasks, tasks[0], tasks[0])).toBeNull();
    expect(moveBefore(tasks, tasks[0], tasks[1])).toBeNull();
    expect(
      moveBefore(tasks, tasks[0], { ...tasks[2], listId: "other" }),
    ).toBeNull();
    expect(
      moveBefore(tasks, tasks[0], { ...tasks[2], parent: "parent" }),
    ).toBeNull();
  });
  it("supports one-step keyboard/touch moves and bounds the endpoints", () => {
    expect(moveOne(tasks, tasks[0], -1)).toBeNull();
    expect(moveOne(tasks, tasks[3], 1)).toBeNull();
    expect(moveOne(tasks, tasks[2], -1)?.previous).toBe("a");
    expect(moveOne(tasks, tasks[0], 1)?.previous).toBe("b");
  });
  it("preserves subtask parent and excludes unrelated sibling sets", () => {
    const nested = tasks.map((task) => ({ ...task, parent: "parent" }));
    const move = moveOne(
      [...nested, { ...tasks[0], id: "root" }],
      nested[1],
      -1,
    );
    expect(move).toMatchObject({
      parent: "parent",
      taskId: "b",
      previous: undefined,
    });
  });
});
