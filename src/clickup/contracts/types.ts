export type ClickUpGeneratedApiVersion = 'v2' | 'v3';

export interface ClickUpGeneratedSchemaSummary {
  readonly $ref?: string;
  readonly type?: string | readonly string[];
  readonly format?: string;
  readonly nullable?: boolean;
  readonly required?: readonly string[];
  readonly properties?: readonly string[];
  readonly enum?: readonly unknown[];
  readonly items?: ClickUpGeneratedSchemaSummary | null;
}

export interface ClickUpGeneratedParameter {
  readonly name: string;
  readonly required: boolean;
  readonly schema: ClickUpGeneratedSchemaSummary | null;
}

export interface ClickUpGeneratedOperation {
  readonly operationId: string;
  readonly apiVersion: ClickUpGeneratedApiVersion;
  readonly method: string;
  readonly path: string;
  readonly pathParameters: readonly ClickUpGeneratedParameter[];
  readonly queryParameters: readonly ClickUpGeneratedParameter[];
  readonly requestContentTypes: readonly string[];
  readonly requestSchemas: Readonly<Record<string, ClickUpGeneratedSchemaSummary | null>>;
  readonly responseSchemas: Readonly<Record<string, Readonly<Record<string, ClickUpGeneratedSchemaSummary | null>>>>;
  readonly security: readonly Readonly<Record<string, readonly string[]>>[];
  readonly tags: readonly string[];
}
