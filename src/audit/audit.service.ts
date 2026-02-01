import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditEvent } from './audit-event.entity';

@Injectable()
export class AuditService {
    constructor(@InjectRepository(AuditEvent) private repo: Repository<AuditEvent>) { }

    async log(params: {
        eventType: string;
        matchId?: string | null;
        actorId?: string | null;
        roundNo?: number | null;
        payload?: Record<string, any>;
    }) {
        const e = this.repo.create({
            eventType: params.eventType,
            matchId: params.matchId ?? null,
            actorId: params.actorId ?? null,
            roundNo: params.roundNo ?? null,
            payload: params.payload ?? {},
        });
        return this.repo.save(e);
    }

    async getByMatch(matchId: string, limit = 200) {
        return this.repo.find({
            where: { matchId },
            order: { createdAt: 'ASC' },
            take: limit,
        });
    }
}
