import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { SessionUser } from '@closeup/shared';
import { AppConfig } from '../config/app-config.js';
import { readCookie } from '../identity/device-token.js';
import { AuthService } from './auth.service.js';
import { SESSION_COOKIE } from './session-cookie.js';

/** The slice of the HTTP request the guard reads (Express, but not tied to its types). */
export interface AdminRequest {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  user?: SessionUser;
}

const header = (request: AdminRequest, name: string): string | undefined => {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
};

/**
 * True when a browser request that changes something comes from our own pages. The session
 * cookie is `SameSite=Lax`, which already keeps it off cross-site POSTs; this is the second lock,
 * for the one content type a foreign form can send without a preflight: a file upload.
 */
export function sameOrigin(request: AdminRequest, allowedOrigins: string[]): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return true;
  const origin = header(request, 'origin');
  // No Origin header: not a browser form (a script, a test). Cookies are its own business.
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  try {
    return new URL(origin).host === header(request, 'host');
  } catch {
    return false;
  }
}

/** Everything under `/api/admin` goes through this: a live session of an admin, nothing less. */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    if (!sameOrigin(request, this.config.env.CORS_ORIGINS)) {
      throw new ForbiddenException('Cross-site request refused');
    }
    const user = await this.auth.resolve(readCookie(header(request, 'cookie'), SESSION_COOKIE));
    if (!user) throw new UnauthorizedException();
    if (user.role !== 'ADMIN') throw new ForbiddenException();
    request.user = user;
    return true;
  }
}
