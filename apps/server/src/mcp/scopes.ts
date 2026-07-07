export interface McpAuthContext {
  userId: string;
  scopes: string[];
}

export const MCP_SCOPES = ['workspaces:read', 'projects:read'] as const;
export const MCP_SCOPE_STRING = MCP_SCOPES.join(' ');
export const MCP_TOOL_SCOPES: Record<string, (typeof MCP_SCOPES)[number]> = {
  list_workspaces: 'workspaces:read',
  list_projects: 'projects:read',
};

export class InsufficientScopeError extends Error {
  public readonly code = 'INSUFFICIENT_SCOPE';

  constructor(public readonly requiredScope: string) {
    super(`Missing required scope: ${requiredScope}`);
    this.name = 'InsufficientScopeError';
  }
}

export function requireScope(scope: string, authCtx: McpAuthContext): void {
  if (!authCtx.scopes.includes(scope)) {
    throw new InsufficientScopeError(scope);
  }
}
