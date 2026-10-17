import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { bulkStartSchema } from '@closeup/shared';
import { AdminGuard, type AdminRequest } from '../../auth/admin.guard.js';
import { BulkImportService } from './bulk-import.service.js';

/** The mass import of the back-office: one run at a time, watched, paused or stopped. */
@Controller('admin/import/bulk')
@UseGuards(AdminGuard)
export class BulkImportController {
  constructor(private readonly bulk: BulkImportService) {}

  @Get()
  async current() {
    return { run: await this.bulk.current() };
  }

  @Post()
  async start(@Body() body: unknown, @Req() request: AdminRequest) {
    const parsed = bulkStartSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return { run: await this.bulk.start(parsed.data, request.user!) };
  }

  @Post(':id/pause')
  async pause(@Param('id', ParseUUIDPipe) id: string) {
    return { run: await this.bulk.pause(id) };
  }

  @Post(':id/resume')
  async resume(@Param('id', ParseUUIDPipe) id: string) {
    return { run: await this.bulk.resume(id) };
  }

  @Post(':id/stop')
  async stop(@Param('id', ParseUUIDPipe) id: string) {
    return { run: await this.bulk.stop(id) };
  }
}
