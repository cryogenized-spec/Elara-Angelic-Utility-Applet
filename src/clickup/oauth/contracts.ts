import { z } from 'zod';

export const clickUpWorkspaceSchema = z.object({
  id: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(500),
}).strict();

export const clickUpOAuthStatusSchema = z.object({
  connected: z.boolean(),
  account: z.object({
    id: z.string().trim().min(1).max(100),
    username: z.string().trim().max(500).optional(),
    email: z.string().trim().max(320).optional(),
  }).strict().optional(),
  workspaces: z.array(clickUpWorkspaceSchema).max(100),
  updatedAt: z.number().int().positive().optional(),
}).strict();

export type ClickUpOAuthStatus = z.infer<typeof clickUpOAuthStatusSchema>;

export const clickUpConnectionMethodsSchema = z.object({
  oauth: z.boolean(),
  personalToken: z.boolean(),
}).strict();

export type ClickUpConnectionMethods = z.infer<typeof clickUpConnectionMethodsSchema>;

export interface ClickUpExecutionGrant {
  readonly status: ClickUpOAuthStatus;
  readonly authorityBinding: string;
  readonly revision: number;
}

export const clickUpOAuthStartSchema = z.object({
  authorizationUrl: z.string().url().max(4096),
  state: z.string().trim().min(16).max(512),
  expiresAt: z.number().int().positive(),
}).strict();

export type ClickUpOAuthStart = z.infer<typeof clickUpOAuthStartSchema>;

export interface ClickUpOAuthAuthority {
  getStatus(): Promise<ClickUpOAuthStatus>;
  getConnectionMethods(): Promise<ClickUpConnectionMethods>;
  getExecutionGrant(): Promise<ClickUpExecutionGrant>;
  beginConnect(redirectUri: string): Promise<ClickUpOAuthStart>;
  completeConnect(input: { code: string; state: string; redirectUri: string }): Promise<ClickUpOAuthStatus>;
  connectPersonalToken(): Promise<ClickUpOAuthStatus>;
  disconnect(): Promise<void>;
}
