import { Module } from '@nestjs/common';
import { MatchmakingService } from './matchmaking.service';
import { MatchmakingController } from './matchmaking.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Wallet } from '../wallets/wallet.entity';
import { MatchmakingGateway } from './matchmaking.gateway';
import { AuditModule } from '../audit/audit.module';

@Module({
    imports: [TypeOrmModule.forFeature([Wallet]), AuditModule],
    providers: [MatchmakingService, MatchmakingGateway],
    controllers: [MatchmakingController]
})
export class MatchmakingModule { }
