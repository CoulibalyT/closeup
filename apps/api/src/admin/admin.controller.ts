import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  cardInputSchema,
  newCardSchema,
  packInputSchema,
  packVisibilityInputSchema,
  publishInputSchema,
  type SessionUser,
  UPLOAD,
  zoomPointsInputSchema,
} from '@closeup/shared';
import type { z } from 'zod';
import { AdminGuard, type AdminRequest } from '../auth/admin.guard.js';
import { AdminContentService } from './admin-content.service.js';

function parse<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
  const result = schema.safeParse(body);
  if (!result.success) throw new BadRequestException(result.error.issues);
  return result.data;
}

/** The guard has run: there is a user, and they are an admin. */
const actorOf = (request: AdminRequest): SessionUser => request.user!;

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly content: AdminContentService) {}

  @Get('packs')
  listPacks() {
    return this.content.listPacks();
  }

  @Post('packs')
  createPack(@Body() body: unknown, @Req() request: AdminRequest) {
    return this.content.createPack(parse(packInputSchema, body), actorOf(request));
  }

  @Get('packs/:id')
  getPack(@Param('id', ParseUUIDPipe) id: string) {
    return this.content.getPack(id);
  }

  @Put('packs/:id')
  updatePack(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() request: AdminRequest,
  ) {
    return this.content.updatePack(id, parse(packInputSchema, body), actorOf(request));
  }

  @Delete('packs/:id')
  @HttpCode(204)
  deletePack(@Param('id', ParseUUIDPipe) id: string, @Req() request: AdminRequest) {
    return this.content.deletePack(id, actorOf(request));
  }

  @Put('packs/:id/visibility')
  setVisibility(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() request: AdminRequest,
  ) {
    const { visibility } = parse(packVisibilityInputSchema, body);
    return this.content.setVisibility(id, visibility, actorOf(request));
  }

  @Post('packs/:id/cards')
  createCard(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() request: AdminRequest,
  ) {
    return this.content.createCard(id, parse(newCardSchema, body), actorOf(request));
  }

  @Get('cards/:id')
  getCard(@Param('id', ParseUUIDPipe) id: string) {
    return this.content.getCard(id);
  }

  @Put('cards/:id')
  updateCard(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() request: AdminRequest,
  ) {
    return this.content.updateCard(id, parse(cardInputSchema, body), actorOf(request));
  }

  /** Multipart: `file`, and `rightsConfirmed=true`. Held in memory, bounded by the size limit. */
  @Post('cards/:id/image')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: UPLOAD.maxBytes, files: 1 } }))
  upload(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: { buffer: Buffer; size: number } | undefined,
    @Body() body: { rightsConfirmed?: string },
    @Req() request: AdminRequest,
  ) {
    return this.content.acceptUpload(id, file, body?.rightsConfirmed === 'true', actorOf(request));
  }

  @Put('cards/:id/zoom-points')
  setZoomPoints(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() request: AdminRequest,
  ) {
    const { points } = parse(zoomPointsInputSchema, body);
    return this.content.setZoomPoints(id, points, actorOf(request));
  }

  @Put('cards/:id/live')
  setLive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() request: AdminRequest,
  ) {
    return this.content.setLive(id, parse(publishInputSchema, body).live, actorOf(request));
  }

  @Delete('cards/:id')
  @HttpCode(204)
  deleteCard(@Param('id', ParseUUIDPipe) id: string, @Req() request: AdminRequest) {
    return this.content.deleteCard(id, actorOf(request));
  }
}
