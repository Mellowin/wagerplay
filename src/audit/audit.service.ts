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
        
        // 🔄 Retry с exponential backoff (3 попытки)
        this.saveWithRetry(e, 3).catch(err => console.error('Audit log error (final):', err));
        return e;
    }

    private async saveWithRetry(event: AuditEvent, maxRetries: number, attempt = 1): Promise<void> {
        try {
            await this.repo.save(event);
        } catch (err) {
            if (attempt >= maxRetries) {
                throw err;
            }
            const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000); // max 10s
            console.warn(`Audit save failed (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms...`);
            await new Promise(r => setTimeout(r, delay));
            return this.saveWithRetry(event, maxRetries, attempt + 1);
        }
    }

    async getByUser(userId: string, limit = 100) {
        return this.repo.find({
            where: [
                { actorId: userId },
                { payload: { userId } },
            ],
            order: { createdAt: 'DESC' },
            take: limit,
        });
    }

    async getByMatch(matchId: string, limit = 200) {
        return this.repo.find({
            where: { matchId },
            order: { createdAt: 'ASC' },
            take: limit,
        });
    }
}
