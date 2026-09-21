export const CLICKUP_API_ORIGIN = 'https://api.clickup.com';
export const CLICKUP_OAUTH_AUTHORIZE_URL = 'https://app.clickup.com/api';
export const CLICKUP_RATE_LIMIT_HEADERS = {
  limit: 'X-RateLimit-Limit',
  remaining: 'X-RateLimit-Remaining',
  reset: 'X-RateLimit-Reset',
} as const;

export type ClickUpHttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
export type ClickUpRequestContentType = 'none' | 'application/json' | 'multipart/form-data';
export type ClickUpPagination =
  | 'none'
  | 'page-zero-based-100'
  | 'comment-start-and-start-id'
  | 'cursor';

export interface ClickUpRestOperation {
  readonly apiVersion: 'v2' | 'v3';
  readonly method: ClickUpHttpMethod;
  readonly path: string;
  readonly contentType: ClickUpRequestContentType;
  readonly pagination: ClickUpPagination;
  readonly officialOperation: string;
}

/**
 * Pass-1 operation contract for the first-party ClickUp integration.
 *
 * These are provider primitives, not model tools. The model-facing ClickUp
 * catalog stays deliberately smaller and composes these operations inside the
 * Worker. No operation here grants arbitrary URL or HTTP-method authority.
 *
 * Source of truth reviewed 2026-09-21:
 * - ClickUp Public API v2 OpenAPI 3.1 specification
 * - ClickUp Public API v3 OpenAPI specification
 * - current ClickUp REST reference pages for the named operations
 */
export const clickupRestOperations = {
  exchangeOAuthCode: {
    apiVersion: 'v2',
    method: 'POST',
    path: '/api/v2/oauth/token',
    contentType: 'application/json',
    pagination: 'none',
    officialOperation: 'GetAccessToken',
  },
  getAuthorizedUser: {
    apiVersion: 'v2',
    method: 'GET',
    path: '/api/v2/user',
    contentType: 'none',
    pagination: 'none',
    officialOperation: 'GetAuthorizedUser',
  },
  getAuthorizedWorkspaces: {
    apiVersion: 'v2',
    method: 'GET',
    path: '/api/v2/team',
    contentType: 'none',
    pagination: 'none',
    officialOperation: 'GetAuthorizedTeams',
  },
  getSpaces: {
    apiVersion: 'v2',
    method: 'GET',
    path: '/api/v2/team/{team_id}/space',
    contentType: 'none',
    pagination: 'none',
    officialOperation: 'GetSpaces',
  },
  getFolders: {
    apiVersion: 'v2',
    method: 'GET',
    path: '/api/v2/space/{space_id}/folder',
    contentType: 'none',
    pagination: 'none',
    officialOperation: 'GetFolders',
  },
  getFolder: {
    apiVersion: 'v2',
    method: 'GET',
    path: '/api/v2/folder/{folder_id}',
    contentType: 'none',
    pagination: 'none',
    officialOperation: 'GetFolder',
  },
  getFolderLists: {
    apiVersion: 'v2',
    method: 'GET',
    path: '/api/v2/folder/{folder_id}/list',
    contentType: 'none',
    pagination: 'none',
    officialOperation: 'GetLists',
  },
  getFolderlessLists: {
    apiVersion: 'v2',
    method: 'GET',
    path: '/api/v2/space/{space_id}/list',
    contentType: 'none',
    pagination: 'none',
    officialOperation: 'GetFolderlessLists',
  },
  getList: {
    apiVersion: 'v2',
    method: 'GET',
    path: '/api/v2/list/{list_id}',
    contentType: 'none',
    pagination: 'none',
    officialOperation: 'GetList',
  },
  getFilteredWorkspaceTasks: {
    apiVersion: 'v2',
    method: 'GET',
    path: '/api/v2/team/{team_Id}/task',
    contentType: 'none',
    pagination: 'page-zero-based-100',
    officialOperation: 'GetFilteredTeamTasks',
  },
  getTask: {
    apiVersion: 'v2',
    method: 'GET',
    path: '/api/v2/task/{task_id}',
    contentType: 'none',
    pagination: 'none',
    officialOperation: 'GetTask',
  },
  createTask: {
    apiVersion: 'v2',
    method: 'POST',
    path: '/api/v2/list/{list_id}/task',
    contentType: 'application/json',
    pagination: 'none',
    officialOperation: 'CreateTask',
  },
  updateTask: {
    apiVersion: 'v2',
    method: 'PUT',
    path: '/api/v2/task/{task_id}',
    contentType: 'application/json',
    pagination: 'none',
    officialOperation: 'UpdateTask',
  },
  getTaskComments: {
    apiVersion: 'v2',
    method: 'GET',
    path: '/api/v2/task/{task_id}/comment',
    contentType: 'none',
    pagination: 'comment-start-and-start-id',
    officialOperation: 'GetTaskComments',
  },
  createTaskComment: {
    apiVersion: 'v2',
    method: 'POST',
    path: '/api/v2/task/{task_id}/comment',
    contentType: 'application/json',
    pagination: 'none',
    officialOperation: 'CreateTaskComment',
  },
  replyToComment: {
    apiVersion: 'v2',
    method: 'POST',
    path: '/api/v2/comment/{comment_id}/reply',
    contentType: 'application/json',
    pagination: 'none',
    officialOperation: 'CreateThreadedComment',
  },
  getListCustomFields: {
    apiVersion: 'v2',
    method: 'GET',
    path: '/api/v2/list/{list_id}/field',
    contentType: 'none',
    pagination: 'none',
    officialOperation: 'GetAccessibleCustomFields',
  },
  setTaskCustomField: {
    apiVersion: 'v2',
    method: 'POST',
    path: '/api/v2/task/{task_id}/field/{field_id}',
    contentType: 'application/json',
    pagination: 'none',
    officialOperation: 'SetCustomFieldValue',
  },
  removeTaskCustomField: {
    apiVersion: 'v2',
    method: 'DELETE',
    path: '/api/v2/task/{task_id}/field/{field_id}',
    contentType: 'none',
    pagination: 'none',
    officialOperation: 'RemoveCustomFieldValue',
  },
  createTaskAttachment: {
    apiVersion: 'v2',
    method: 'POST',
    path: '/api/v2/task/{task_id}/attachment',
    contentType: 'multipart/form-data',
    pagination: 'none',
    officialOperation: 'CreateTaskAttachment',
  },
  createEntityAttachmentV3: {
    apiVersion: 'v3',
    method: 'POST',
    path: '/api/v3/workspaces/{workspace_id}/{entity_type}/{entity_id}/attachments',
    contentType: 'multipart/form-data',
    pagination: 'none',
    officialOperation: 'postEntityAttachment',
  },
  getEntityAttachmentsV3: {
    apiVersion: 'v3',
    method: 'GET',
    path: '/api/v3/workspaces/{workspace_id}/{entity_type}/{entity_id}/attachments',
    contentType: 'none',
    pagination: 'cursor',
    officialOperation: 'getParentEntityAttachments',
  },
} as const satisfies Record<string, ClickUpRestOperation>;

export type ClickUpRestOperationName = keyof typeof clickupRestOperations;

/**
 * ClickUp's v2 terminology calls a Workspace a "team". Semantic Elara schemas
 * use workspaceId; only the REST serializer is allowed to translate that value
 * into provider path/query names such as team_id or team_Id.
 */
export const CLICKUP_PROVIDER_NAMING = Object.freeze({
  workspaceIdV2Path: 'team_id',
  filteredWorkspaceTasksPath: 'team_Id',
  oauthAuthorizationHeader: 'Authorization: Bearer {access_token}',
});
