import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  type AdminCard,
  cardInputSchema,
  catalogueQuerySchema,
  localeSchema,
  newCardSchema,
  packDraftSchema,
  packSubmitSchema,
  takedownSchema,
  UPLOAD,
  zoomPointsInputSchema,
} from '@closeup/shared';
import type { z } from 'zod';
import { AdminContentService } from '../admin/admin-content.service.js';
import { DEVICE_COOKIE, readCookie } from '../identity/device-token.js';
import { IdentityService } from '../identity/identity.service.js';
import { type AdminRequest, SessionGuard } from '../auth/admin.guard.js';
import { PacksService } from './packs.service.js';

function parse<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
  const result = schema.safeParse(body);
  if (!result.success) throw new BadRequestException(result.error.issues);
  return result.data;
}

const language = (header: string | undefined) =>
  localeSchema.safeParse(header?.slice(0, 2).toLowerCase()).data ?? 'fr';

/** The public catalogue and the credits: no account, no cookie, nothing to prove. */
@Controller('packs')
export class CatalogueController {
  constructor(private readonly packs: PacksService) {}

  @Get()
  catalogue(
    @Query() query: Record<string, string>,
    @Headers('accept-language') accept: string | undefined,
  ) {
    const { category, sort } = parse(catalogueQuerySchema, {
      ...(query.category ? { category: query.category } : {}),
      ...(query.sort ? { sort: query.sort } : {}),
    });
    return this.packs.catalogue(language(accept), category, sort);
  }

  /** Every published pack owes its images a credit, and this is the page that shows them. */
  @Get(':id/credits')
  credits(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('accept-language') accept: string | undefined,
  ) {
    return this.packs.credits(id, language(accept));
  }
}

/**
 * A player's own packs. An account is required (the brief): a pack outlives the browser that
 * made it. Card editing is the back-office's, behind an ownership check.
 */
@Controller('me/packs')
@UseGuards(SessionGuard)
export class MyPacksController {
  constructor(
    private readonly packs: PacksService,
    private readonly content: AdminContentService,
  ) {}

  /** The player this account plays as. An admin who never played has none. */
  private playerOf(request: AdminRequest): string {
    const playerId = request.user?.playerId;
    if (!playerId) throw new BadRequestException({ code: 'NO_PLAYER' });
    return playerId;
  }

  @Get()
  async list(@Req() request: AdminRequest) {
    const playerId = this.playerOf(request);
    const [packs, quota] = await Promise.all([
      this.packs.mine(playerId),
      this.packs.quota(playerId),
    ]);
    return { packs, quota };
  }

  @Post()
  create(@Body() body: unknown, @Req() request: AdminRequest) {
    return this.packs.create(this.playerOf(request), parse(packDraftSchema, body), request.user!);
  }

  @Get(':id')
  async one(@Param('id', ParseUUIDPipe) id: string, @Req() request: AdminRequest) {
    const playerId = this.playerOf(request);
    await this.packs.own(playerId, id);
    const { cards } = await this.content.getPack(id);
    const mine = (await this.packs.mine(playerId)).find((pack) => pack.id === id)!;
    return { pack: mine, cards };
  }

  @Put(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() request: AdminRequest,
  ) {
    return this.packs.update(this.playerOf(request), id, parse(packDraftSchema, body));
  }

  @Post(':id/submit')
  submit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() request: AdminRequest,
  ) {
    parse(packSubmitSchema, body);
    return this.packs.submit(this.playerOf(request), id);
  }

  @Post(':id/withdraw')
  withdraw(@Param('id', ParseUUIDPipe) id: string, @Req() request: AdminRequest) {
    return this.packs.withdraw(this.playerOf(request), id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string, @Req() request: AdminRequest) {
    return this.packs.remove(this.playerOf(request), id);
  }

  // ---- the cards inside, with the back-office's editor ----

  @Post(':id/cards')
  async createCard(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() request: AdminRequest,
  ) {
    const playerId = this.playerOf(request);
    await this.packs.canAddCard(playerId, id, request.user!);
    return this.content.createCard(id, parse(newCardSchema, body), request.user!);
  }

  @Get('cards/:cardId')
  async card(@Param('cardId', ParseUUIDPipe) cardId: string, @Req() request: AdminRequest) {
    await this.ownCard(request, cardId);
    return this.content.getCard(cardId);
  }

  @Put('cards/:cardId')
  async updateCard(
    @Param('cardId', ParseUUIDPipe) cardId: string,
    @Body() body: unknown,
    @Req() request: AdminRequest,
  ) {
    await this.ownCard(request, cardId);
    return this.content.updateCard(cardId, parse(cardInputSchema, body), request.user!);
  }

  @Post('cards/:cardId/image')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: UPLOAD.maxBytes, files: 1 } }))
  async upload(
    @Param('cardId', ParseUUIDPipe) cardId: string,
    @UploadedFile() file: { buffer: Buffer; size: number } | undefined,
    @Body() body: { rightsConfirmed?: string; auto?: string },
    @Req() request: AdminRequest,
  ) {
    const playerId = await this.ownCard(request, cardId);
    await this.packs.canUpload(playerId, request.user!);
    // `auto`: the folder import. The worker sets the zoom points and publishes by itself.
    const auto = body?.auto === 'true' ? { autoPoints: true, publish: true } : {};
    return this.content.acceptUpload(
      cardId,
      file,
      body?.rightsConfirmed === 'true',
      request.user!,
      auto,
    );
  }

  @Put('cards/:cardId/zoom-points')
  async setZoomPoints(
    @Param('cardId', ParseUUIDPipe) cardId: string,
    @Body() body: unknown,
    @Req() request: AdminRequest,
  ) {
    await this.ownCard(request, cardId);
    const { points } = parse(zoomPointsInputSchema, body);
    return this.content.setZoomPoints(cardId, points, request.user!);
  }

  /**
   * A player publishes their own card into their own pack: it becomes playable in their rooms
   * at once, which is not the same as the pack being public. That is the moderation queue.
   */
  @Put('cards/:cardId/live')
  async setLive(
    @Param('cardId', ParseUUIDPipe) cardId: string,
    @Body() body: unknown,
    @Req() request: AdminRequest,
  ) {
    await this.ownCard(request, cardId);
    const live = Boolean((body as { live?: boolean })?.live);
    return this.content.setLive(cardId, live, request.user!);
  }

  @Delete('cards/:cardId')
  @HttpCode(204)
  async deleteCard(@Param('cardId', ParseUUIDPipe) cardId: string, @Req() request: AdminRequest) {
    await this.ownCard(request, cardId);
    await this.content.deleteCard(cardId, request.user!);
  }

  /** Returns the player id, having checked the card belongs to one of their packs. */
  private async ownCard(request: AdminRequest, cardId: string): Promise<string> {
    const playerId = this.playerOf(request);
    const card: AdminCard = await this.content.getCard(cardId);
    await this.packs.own(playerId, card.packId);
    return playerId;
  }
}

/** A takedown request needs no account: whoever holds the rights may not play at all. */
@Controller('takedown')
export class TakedownController {
  constructor(private readonly packs: PacksService) {}

  @Post()
  @HttpCode(204)
  async takedown(@Body() body: unknown): Promise<void> {
    await this.packs.takedown(parse(takedownSchema, body));
  }
}

/** What a room may be told to play: the catalogue, plus the host's own packs. */
@Controller('playable-packs')
export class PlayablePacksController {
  constructor(
    private readonly packs: PacksService,
    private readonly identities: IdentityService,
  ) {}

  @Get()
  async list(
    @Headers('cookie') cookies: string | undefined,
    @Headers('accept-language') accept: string | undefined,
  ) {
    const identity = await this.identities.resolve(readCookie(cookies, DEVICE_COOKIE));
    return this.packs.playableFor(identity?.playerId, language(accept));
  }
}
