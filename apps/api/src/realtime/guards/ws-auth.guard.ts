import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { URL } from 'node:url';
import type { VinopsDatabase } from '@vinops/database';
import { verifyAccessToken, type AccessTokenClaims } from '../../security.js';

export interface WsClientIdentity {
  userId: string;
  organizationId: string;
  sessionId: string;
  projectIds: string[];
  claims: AccessTokenClaims;
}

export class WsUnauthorizedException extends Error {
  readonly code = 4401;
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'WsUnauthorizedException';
  }
}

export function extractWsToken(request: IncomingMessage): string | undefined {
  if (request.url) {
    try {
      const url = new URL(request.url, 'http://localhost');
      const token = url.searchParams.get('token');
      if (token && token.trim().length > 0) {
        return token.trim();
      }
    } catch {
      // Invalid URL format
    }
  }

  const authHeader = request.headers['authorization'];
  if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }

  return undefined;
}

export async function verifyWsHandshake(
  token: string | undefined,
  secret: string,
  database?: VinopsDatabase,
): Promise<WsClientIdentity> {
  if (!token || token.trim().length === 0) {
    throw new WsUnauthorizedException('Missing authentication token');
  }

  let claims: AccessTokenClaims;
  try {
    claims = verifyAccessToken(token, secret);
  } catch {
    throw new WsUnauthorizedException('Invalid or expired token');
  }

  const userId = claims.sub;
  const sessionId = claims.sid;
  let organizationId = '';
  const projectIds: string[] = [];

  if (database) {
    try {
      await database.withTransaction(
        { actorUserId: userId, correlationId: `ws-handshake:${sessionId}` },
        async (tx) => {
          // Verify session is active
          const sessionRows = await tx.query<{ organization_id: string }>(
            `SELECT m.organization_id
               FROM vinops.organization_members m
              WHERE m.user_id = $1::uuid
                AND m.status = 'Active'
              LIMIT 1`,
            [userId],
          );
          if (sessionRows.length > 0 && sessionRows[0]) {
            organizationId = sessionRows[0].organization_id;
          }

          // Query accessible projects
          const memberProjects = await tx.query<{ project_id: string }>(
            `SELECT pm.project_id
               FROM vinops.project_members pm
              WHERE pm.user_id = $1::uuid
                AND pm.status = 'Active'`,
            [userId],
          );
          for (const row of memberProjects) {
            projectIds.push(row.project_id);
          }
        },
      );
    } catch {
      // Database context error, keep identity with claims
    }
  }

  return {
    userId,
    organizationId,
    sessionId,
    projectIds,
    claims,
  };
}

@Injectable()
export class WsAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const client = context.switchToWs().getClient<{ data?: Record<string, unknown> }>();
    if (client && client.data && client.data['userId']) {
      return true;
    }
    throw new WsUnauthorizedException('Connection not authenticated');
  }
}
