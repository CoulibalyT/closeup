import { Controller, Get, Headers, NotFoundException, Query } from '@nestjs/common';
import { type PlayerStats, type Rankings, rankingPeriodSchema } from '@closeup/shared';
import { DEVICE_COOKIE, readCookie } from '../identity/device-token.js';
import { IdentityService } from '../identity/identity.service.js';
import { AccountService } from './account.service.js';

/**
 * Both read the *device* cookie, not the session: statistics belong to whoever plays on this
 * device, guest or not, and a ranking only needs to know which line is the viewer's.
 */
@Controller()
export class AccountController {
  constructor(
    private readonly accounts: AccountService,
    private readonly identities: IdentityService,
  ) {}

  @Get('me/stats')
  async stats(@Headers('cookie') cookies: string | undefined): Promise<PlayerStats> {
    const identity = await this.identities.resolve(readCookie(cookies, DEVICE_COOKIE));
    const stats = identity ? await this.accounts.stats(identity.playerId) : null;
    // Never played on this device: nothing to show yet, which is not an error for the page.
    if (!stats) throw new NotFoundException();
    return stats;
  }

  @Get('rankings')
  async rankings(
    @Query('period') period: string | undefined,
    @Headers('cookie') cookies: string | undefined,
  ): Promise<Rankings> {
    const parsed = rankingPeriodSchema.safeParse(period ?? 'week');
    const identity = await this.identities.resolve(readCookie(cookies, DEVICE_COOKIE));
    return this.accounts.rankings(parsed.success ? parsed.data : 'week', identity?.playerId);
  }
}
