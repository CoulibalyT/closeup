import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { createRoomSchema, type RoomCreated } from '@closeup/shared';
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

    const { settings, language } = request.data;
    return { code: await this.rooms.createSolo(identity, settings, language) };
  }
}
