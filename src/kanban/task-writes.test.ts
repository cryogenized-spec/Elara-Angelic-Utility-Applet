import { describe, expect, it } from "vitest";
import { acceptedBoardTask } from "./task-writes";
import type { TaskLocalMetadata } from "./store";

describe("accepted provider task projection", () => {
  it("replaces the stale provider ETag while preserving established provenance", () => {
    const previousLocal: TaskLocalMetadata = {
      createdAt: "2026-09-20T08:00:00.000Z",
      firstSeenAt: "2026-09-20T08:00:00.000Z",
      dueTime: "08:00",
      timeZone: "Africa/Johannesburg",
      labelIds: ["old"],
    };

    const accepted = acceptedBoardTask(
      { id: "task-1", title: "Updated", etag: "provider-next", status: "needsAction" },
      "list-a",
      previousLocal,
      previousLocal.createdAt,
      "09:30",
      "Africa/Johannesburg",
      ["supplier"],
    );

    expect(accepted).toMatchObject({
      id: "task-1",
      listId: "list-a",
      title: "Updated",
      etag: "provider-next",
      local: {
        createdAt: "2026-09-20T08:00:00.000Z",
        firstSeenAt: "2026-09-20T08:00:00.000Z",
        dueTime: "09:30",
        timeZone: "Africa/Johannesburg",
        labelIds: ["supplier"],
      },
    });
  });

  it("initializes creation and first-seen provenance for a newly accepted task", () => {
    const createdAt = "2026-09-21T18:20:00.000Z";
    expect(acceptedBoardTask(
      { id: "new-task", title: "New", etag: "created-etag" },
      "list-a",
      undefined,
      createdAt,
      undefined,
      undefined,
      [],
    )).toMatchObject({
      id: "new-task",
      etag: "created-etag",
      listId: "list-a",
      local: {
        createdAt,
        firstSeenAt: createdAt,
        labelIds: [],
      },
    });
  });
});
