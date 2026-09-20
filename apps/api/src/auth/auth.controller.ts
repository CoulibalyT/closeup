import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpException,
  Ip,
  Post,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { loginSchema, type SessionUser } from '@closeup/shared';
import { AppConfig } from '../config/app-config.js';
import { readCookie } from '../identity/device-token.js';
import { AuthService } from './auth.service.js';
import { SESSION_COOKIE, SESSION_TTL_MS } from './session-cookie.js';

interface CookieResponse {
  cookie(name: string, value: string, options: Record<string, unknown>): unknown;
  clearCookie(name: string, options: Record<string, unknown>): unknown;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfig,
  ) {}

  private get cookieOptions() {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.env.NODE_ENV === 'production',
      path: '/',
    };
  }

  /** One answer for "no such account" and "wrong password": the form never says which. */
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: unknown,
    @Ip() ip: string,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<SessionUser> {
    const request = loginSchema.safeParse(body);
    if (!request.success) throw new BadRequestException('Expected { email, password }');

    const result = await this.auth.login(request.data.email, request.data.password, ip ?? '?');
    if (!result.ok) {
      if (result.reason === 'RATE_LIMITED') throw new HttpException('Too many attempts', 429);
      if (result.reason === 'UNAVAILABLE') throw new ServiceUnavailableException();
      throw new UnauthorizedException('Wrong email or password');
    }
    response.cookie(SESSION_COOKIE, result.token, {
      ...this.cookieOptions,
      maxAge: SESSION_TTL_MS,
    });
    return result.user;
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Headers('cookie') cookies: string | undefined,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<void> {
    await this.auth.logout(readCookie(cookies, SESSION_COOKIE));
    response.clearCookie(SESSION_COOKIE, this.cookieOptions);
  }

  @Get('me')
  async me(@Headers('cookie') cookies: string | undefined): Promise<SessionUser> {
    const user = await this.auth.resolve(readCookie(cookies, SESSION_COOKIE));
    if (!user) throw new UnauthorizedException();
    return user;
  }
}
