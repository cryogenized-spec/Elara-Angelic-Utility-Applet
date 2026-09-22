import { describe, expect, it } from 'vitest';
import {
  CLICKUP_API_ORIGIN,
  CLICKUP_OAUTH_AUTHORIZE_URL,
  CLICKUP_RATE_LIMIT_HEADERS,
  clickupRestOperations,
} from './rest-contract';

describe('ClickUp REST contract map', () => {
  it('pins the reviewed provider origins', () => {
    expect(CLICKUP_API_ORIGIN).toBe('https://api.clickup.com');
    expect(CLICKUP_OAUTH_AUTHORIZE_URL).toBe('https://app.clickup.com/api');
  });

  it('contains no arbitrary absolute provider URL operation', () => {
    for (const operation of Object.values(clickupRestOperations)) {
      expect(operation.path).toMatch(/^\/api\/v[23]\//);
      expect(operation.path).not.toContain('://');
    }
  });

  it('maps the core task/comment/custom-field primitives to current ClickUp paths', () => {
    expect(clickupRestOperations.getFilteredWorkspaceTasks).toMatchObject({
      method: 'GET',
      path: '/api/v2/team/{team_Id}/task',
      pagination: 'page-zero-based-100',
    });
    expect(clickupRestOperations.getTaskComments).toMatchObject({
      method: 'GET',
      path: '/api/v2/task/{task_id}/comment',
      pagination: 'comment-start-and-start-id',
    });
    expect(clickupRestOperations.replyToComment).toMatchObject({
      method: 'POST',
      path: '/api/v2/comment/{comment_id}/reply',
    });
    expect(clickupRestOperations.setTaskCustomField).toMatchObject({
      method: 'POST',
      path: '/api/v2/task/{task_id}/field/{field_id}',
    });
  });

  it('uses multipart only for reviewed attachment upload operations', () => {
    const multipart = Object.entries(clickupRestOperations)
      .filter(([, operation]) => operation.contentType === 'multipart/form-data')
      .map(([name]) => name)
      .sort();
    expect(multipart).toEqual(['createEntityAttachmentV3', 'createTaskAttachment']);
  });

  it('pins the rate-limit header names used by the future adaptive limiter', () => {
    expect(CLICKUP_RATE_LIMIT_HEADERS).toEqual({
      limit: 'X-RateLimit-Limit',
      remaining: 'X-RateLimit-Remaining',
      reset: 'X-RateLimit-Reset',
    });
  });
});
