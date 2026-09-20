import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpException,
  Ip,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  accountDeleteSchema,
  loginSchema,
  passwordChangeSchema,
  passwordForgotSchema,
  passwordResetSchema,
  registerSchema,
  type SessionUser,
} from '@closeup/shared';
import type { z } from 'zod';
import { AccountService } from '../account/account.service.js';
import { AppConfig } from '../config/app-config.js';
import { DEVICE_COOKIE, DEVICE_COOKIE_MAX_AGE_S, readCookie } from '../identity/device-token.js';
import { type AdminRequest, SessionGuard } from './admin.guard.js';
import { AuthService, type LoginResult } from './auth.service.js';
import { SESSION_COOKIE, SESSION_TTL_MS } from './session-cookie.js';

interface CookieResponse {
  cookie(name: string, value: string, options: Record<string, unknown>): unknown;
  clearCookie(name: string, options: Record<string, unknown>): unknown;
}

function parse<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
  const result = schema.safeParse(body);
  if (!result.success) throw new BadRequestException(result.error.issues);
  return result.data;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly accounts: AccountService,
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

  /**
   * After a sign-up or a login: the session cookie, and this browser's device now plays as the
   * account's player. Whatever the guest on this device had played is linked or merged.
   */
  private async welcome(
    result: Extract<LoginResult, { ok: true }>,
    cookies: string | undefined,
    response: CookieResponse,
  ): Promise<SessionUser> {
    response.cookie(SESSION_COOKIE, result.token, {
      ...this.cookieOptions,
      maxAge: SESSION_TTL_MS,
    });
    return this.playAs(result.user, cookies, response);
  }

  /**
   * The invariant of accounts: a browser with a session plays as the account's player. It is
   * restored here whenever it does not hold (first login, or a device cookie that was lost
   * while the session lived on), so games never go to a guest behind a "logged in" screen.
   */
  private async playAs(
    user: SessionUser,
    cookies: string | undefined,
    response: CookieResponse,
  ): Promise<SessionUser> {
    const adopted = await this.accounts.adopt(user.id, readCookie(cookies, DEVICE_COOKIE));
    if (adopted.newDeviceToken) {
      response.cookie(DEVICE_COOKIE, adopted.newDeviceToken, {
        ...this.cookieOptions,
        maxAge: DEVICE_COOKIE_MAX_AGE_S * 1000,
      });
    }
    return { ...user, nickname: adopted.nickname };
  }

  private static refuse(reason: 'INVALID' | 'RATE_LIMITED' | 'UNAVAILABLE' | 'EMAIL_TAKEN'): never {
    if (reason === 'RATE_LIMITED') throw new HttpException('Too many attempts', 429);
    if (reason === 'UNAVAILABLE') throw new ServiceUnavailableException();
    if (reason === 'EMAIL_TAKEN') throw new ConflictException({ code: 'EMAIL_TAKEN' });
    throw new UnauthorizedException('Wrong email or password');
  }

  @Post('register')
  async register(
    @Body() body: unknown,
    @Ip() ip: string,
    @Headers('cookie') cookies: string | undefined,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<SessionUser> {
    const { email, password, locale } = parse(registerSchema, body);
    const result = await this.auth.register(email, password, locale, ip ?? '?');
    if (!result.ok) AuthController.refuse(result.reason);
    return this.welcome(result, cookies, response);
  }

  /** One answer for "no such account" and "wrong password": the form never says which. */
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: unknown,
    @Ip() ip: string,
    @Headers('cookie') cookies: string | undefined,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<SessionUser> {
    const request = loginSchema.safeParse(body);
    if (!request.success) throw new BadRequestException('Expected { email, password }');
    const result = await this.auth.login(request.data.email, request.data.password, ip ?? '?');
    if (!result.ok) AuthController.refuse(result.reason);
    return this.welcome(result, cookies, response);
  }

  /** The device stops playing as the account: it gets a fresh guest, the history stays behind. */
  @Post('logout')
  @HttpCode(204)
  async logout(
    @Headers('cookie') cookies: string | undefined,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<void> {
    const token = readCookie(cookies, SESSION_COOKIE);
    if (await this.auth.resolve(token)) {
      await this.accounts.release(readCookie(cookies, DEVICE_COOKIE));
    }
    await this.auth.logout(token);
    response.clearCookie(SESSION_COOKIE, this.cookieOptions);
  }

  @Get('me')
  async me(
    @Headers('cookie') cookies: string | undefined,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<SessionUser> {
    const user = await this.auth.resolve(readCookie(cookies, SESSION_COOKIE));
    if (!user) throw new UnauthorizedException();
    return this.playAs(user, cookies, response);
  }

  @Post('password/change')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async changePassword(
    @Body() body: unknown,
    @Req() request: AdminRequest,
    @Headers('cookie') cookies: string | undefined,
  ): Promise<void> {
    const { current, next } = parse(passwordChangeSchema, body);
    const keep = readCookie(cookies, SESSION_COOKIE);
    const changed = await this.auth.changePassword(request.user!.id, current, next, keep);
    if (!changed) throw new ConflictException({ code: 'WRONG_PASSWORD' });
  }

  /** 204 whatever happened: neither the address nor the outcome is revealed. */
  @Post('password/forgot')
  @HttpCode(204)
  async forgot(@Body() body: unknown, @Ip() ip: string): Promise<void> {
    await this.auth.forgotPassword(parse(passwordForgotSchema, body).email, ip ?? '?');
  }

  @Post('password/reset')
  @HttpCode(204)
  async reset(@Body() body: unknown): Promise<void> {
    const { token, password } = parse(passwordResetSchema, body);
    if (!(await this.auth.resetPassword(token, password))) {
      throw new ConflictException({ code: 'RESET_INVALID' });
    }
  }

  @Delete('me')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async deleteAccount(
    @Body() body: unknown,
    @Req() request: AdminRequest,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<void> {
    const { password } = parse(accountDeleteSchema, body);
    const user = request.user!;
    if (!(await this.auth.checkPassword(user.id, password))) {
      throw new ConflictException({ code: 'WRONG_PASSWORD' });
    }
    await this.accounts.forget(user.id);
    response.clearCookie(SESSION_COOKIE, this.cookieOptions);
  }
}
