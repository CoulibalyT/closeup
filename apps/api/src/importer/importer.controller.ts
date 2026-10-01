import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { importInputSchema, importSearchInputSchema, importSourceSchema } from '@closeup/shared';
import type { z } from 'zod';
import { AdminGuard, type AdminRequest } from '../auth/admin.guard.js';
import { ImporterService } from './importer.service.js';

function parse<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException(result.error.issues);
  return result.data;
}

/** The Wikidata + Commons importer of the back-office. Admins only, like the rest of it. */
@Controller('admin/import')
@UseGuards(AdminGuard)
export class ImporterController {
  constructor(private readonly importer: ImporterService) {}

  /** The last search for a source (a preset, or `names`), if any. Polled while one runs. */
  @Get('searches/:preset')
  async search(@Param('preset') preset: string) {
    return { search: await this.importer.get(parse(importSourceSchema, preset)) };
  }

  @Post('searches')
  async start(@Body() body: unknown) {
    return { search: await this.importer.start(parse(importSearchInputSchema, body)) };
  }

  @Post()
  run(@Body() body: unknown, @Req() request: AdminRequest) {
    return this.importer.import(parse(importInputSchema, body), request.user!);
  }
}
