import { BadRequestException, Body, Controller, Headers, Post, Res } from '@nestjs/common';
import { guestRequestSchema, type IdentityView } from '@closeup/shared';
import { AppConfig } from '../config/app-config.js';
import { DEVICE_COOKIE, DEVICE_COOKIE_MAX_AGE_S, readCookie } from './device-token.js';
import { IdentityService } from './identity.service.js';

/** The slice of the HTTP response this controller needs (Express, but not tied to its types). */
interface CookieResponse {
  cookie(name: string, value: string, options: Record<string, unknown>): unknown;
}

const DEFAULT_NICKNAME = 'Joueur';

@Controller('identity')
export class IdentityController {
  constructor(
    private readonly identities: IdentityService,
    private readonly config: AppConfig,
  ) {}

  /**
   * Idempotent: a device that already has a token gets its player back. The token only travels
   * in an httpOnly cookie set by the server, which Safari does not expire after seven days the
   * way it does script-writable storage.
   */
  @Post('guest')
  async guest(
    @Body() body: unknown,
    @Headers('cookie') cookies: string | undefined,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<IdentityView> {
    const request = guestRequestSchema.safeParse(body ?? {});
    if (!request.success) throw new BadRequestException('Invalid nickname');
    const { nickname } = request.data;

    const known = await this.identities.resolve(readCookie(cookies, DEVICE_COOKIE));
    if (known) {
      if (nickname && nickname !== known.nickname) {
        await this.identities.rename(known.playerId, nickname);
      }
      await this.identities.touch(known.deviceId);
      return { playerId: known.playerId, nickname: nickname ?? known.nickname };
    }

    const { identity, token } = await this.identities.createGuest(nickname ?? DEFAULT_NICKNAME);
    response.cookie(DEVICE_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.env.NODE_ENV === 'production',
      maxAge: DEVICE_COOKIE_MAX_AGE_S * 1000,
      path: '/',
    });
    return { playerId: identity.playerId, nickname: identity.nickname };
  }
}
