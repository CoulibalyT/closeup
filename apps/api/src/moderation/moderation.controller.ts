import { BadRequestException, Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { contentReportSchema, reportSchema } from '@closeup/shared';
import { DEVICE_COOKIE, readCookie } from '../identity/device-token.js';
import { IdentityService } from '../identity/identity.service.js';
import { ModerationService } from './moderation.service.js';

@Controller('reports')
export class ReportsController {
  constructor(
    private readonly moderation: ModerationService,
    private readonly identities: IdentityService,
  ) {}

  /** Anybody who plays can report: a guest is who most public games are made of. */
  @Post()
  @HttpCode(204)
  async report(
    @Body() body: unknown,
    @Headers('cookie') cookies: string | undefined,
  ): Promise<void> {
    const identity = await this.identities.resolve(readCookie(cookies, DEVICE_COOKIE));

    // A pack or a card of the catalogue: anybody who can see it may say something about it.
    const content = contentReportSchema.safeParse(body);
    if (content.success) {
      await this.moderation.reportContent(content.data, identity?.playerId ?? null);
      return;
    }

    const input = reportSchema.safeParse(body);
    if (!input.success) throw new BadRequestException(input.error.issues);
    if (!identity) throw new BadRequestException({ code: 'UNAUTHENTICATED' });
    await this.moderation.report(input.data, identity.playerId);
  }
}
