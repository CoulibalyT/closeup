import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import {
  createRoomSchema,
  type RoomCreated,
  roomCodeSchema,
  type RoomSummary,
} from '@closeup/shared';
import { DEVICE_COOKIE, readCookie } from '../../identity/device-token.js';
import { IdentityService } from '../../identity/identity.service.js';
import { RoomService } from './room.service.js';

@Controller('rooms')
export class RoomsController {
  constructor(
    private readonly rooms: RoomService,
    private readonly identities: IdentityService,
  ) {}

  /** Creating a room is REST; everything that happens inside it goes through the socket. */
  @Post()
  async create(
    @Body() body: unknown,
    @Headers('cookie') cookies: string | undefined,
  ): Promise<RoomCreated> {
    const identity = await this.identities.resolve(readCookie(cookies, DEVICE_COOKIE));
    if (!identity) throw new UnauthorizedException('Call POST /api/identity/guest first');

    const request = createRoomSchema.safeParse(body);
    if (!request.success) throw new BadRequestException(request.error.issues);
    const { mode, settings, language, nickname } = request.data;

    // The nickname typed for this room becomes the player's, so it is prefilled next time.
    if (nickname && nickname !== identity.nickname) {
      await this.identities.rename(identity.playerId, nickname);
      identity.nickname = nickname;
    }
    return { code: await this.rooms.create(mode, identity, settings, language) };
  }

  /** For the join screen. Says nothing a stranger with the code should not know. */
  @Get(':code')
  summary(@Param('code') raw: string): RoomSummary {
    const code = roomCodeSchema.safeParse(raw);
    const summary = code.success ? this.rooms.summary(code.data) : null;
    if (!summary) throw new NotFoundException();
    return summary;
  }
}
