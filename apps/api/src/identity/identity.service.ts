import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.module.js';
import { hashToken, newDeviceToken } from './device-token.js';

export interface Identity {
  playerId: string;
  deviceId: string;
  nickname: string;
}

/**
 * Guests are a device token and a nickname: no signup wall, ever. The player row, not the
 * device, carries history, so an account (phase 6) only has to adopt it.
 */
@Injectable()
export class IdentityService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(token: string | undefined): Promise<Identity | null> {
    if (!token) return null;
    const device = await this.prisma.device.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { player: true },
    });
    if (!device || device.bannedAt) return null;
    return { playerId: device.playerId, deviceId: device.id, nickname: device.player.nickname };
  }

  async createGuest(nickname: string): Promise<{ identity: Identity; token: string }> {
    const token = newDeviceToken();
    const device = await this.prisma.device.create({
      data: { tokenHash: hashToken(token), player: { create: { nickname } } },
    });
    return {
      token,
      identity: { playerId: device.playerId, deviceId: device.id, nickname },
    };
  }

  async rename(playerId: string, nickname: string): Promise<void> {
    await this.prisma.player.update({ where: { id: playerId }, data: { nickname } });
  }

  async touch(deviceId: string): Promise<void> {
    await this.prisma.device.update({ where: { id: deviceId }, data: { lastSeenAt: new Date() } });
  }
}
