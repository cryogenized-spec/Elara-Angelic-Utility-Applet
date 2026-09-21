import { describe, expect, it } from 'vitest';
import {
  ClickUpProviderError,
  buildClickUpCommentBody,
  buildClickUpCreateTaskBody,
  buildClickUpUpdateTaskBody,
  fetchAuthorizedClickUpUser,
} from '../src/clickup/provider';

describe('ClickUp provider wire mapping', () => {
  it('maps semantic create-task fields to documented ClickUp JSON names', () => {
    expect(buildClickUpCreateTaskBody({
      listId: '123',
      name: 'Repair S56',
      markdownContent: '**Inspect trigger link**',
      assigneeIds: ['183', '456'],
      tags: ['repair'],
      status: 'open',
      priority: 2,
      dueAt: '2026-09-22T09:30:00+02:00',
      startAt: '2026-09-21',
      timeEstimateMs: 3_600_000,
      points: 3,
      parentTaskId: '86parent',
      notifyAll: false,
    })).toEqual({
      name: 'Repair S56',
      markdown_content: '**Inspect trigger link**',
      assignees: [183, 456],
      tags: ['repair'],
      status: 'open',
      priority: 2,
      due_date: Date.parse('2026-09-22T09:30:00+02:00'),
      due_date_time: true,
      start_date: Date.parse('2026-09-21'),
      start_date_time: false,
      time_estimate: 3_600_000,
      points: 3,
      parent: '86parent',
      notify_all: false,
    });
  });

  it('maps semantic assignee removal to ClickUp rem without exposing that spelling upstream', () => {
    expect(buildClickUpUpdateTaskBody({
      taskId: '86task',
      assignees: { add: ['183'], remove: ['456'] },
      archived: true,
    })).toEqual({
      assignees: { add: [183], rem: [456] },
      archived: true,
    });
  });

  it('uses plain comment_text when no genuine mentions are requested', () => {
    expect(buildClickUpCommentBody('Inspection complete.', undefined, false)).toEqual({
      comment_text: 'Inspection complete.',
      notify_all: false,
    });
  });

  it('renders requested mentions as ClickUp structured tag segments', () => {
    expect(buildClickUpCommentBody('Please review this.', ['183', '456'], true)).toEqual({
      comment: [
        { text: 'Please review this.' },
        { type: 'tag', user: { id: 183 } },
        { type: 'tag', user: { id: 456 } },
      ],
      notify_all: true,
    });
  });

  it('cancels chunked provider JSON as soon as it crosses the hard byte ceiling', async () => {
    let cancelled = false;
    const chunk = new Uint8Array(700_000);
    let emitted = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        emitted += 1;
        controller.enqueue(chunk);
        if (emitted >= 3) controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetcher = vi.fn(async () => new Response(stream, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;

    const request = fetchAuthorizedClickUpUser('provider-token', fetcher);
    await expect(request).rejects.toBeInstanceOf(ClickUpProviderError);
    await expect(request).rejects.toMatchObject({ code: 'response-too-large' });
    expect(cancelled).toBe(true);
  });
});
