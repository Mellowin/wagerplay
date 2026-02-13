import { Module } from '@nestjs/common';
import { MatchmakingService } from './matchmaking.service';
import { MatchmakingController } from './matchmaking.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/user.entity';
import { Wallet } from '../wallets/wallet.entity';
import { UserStats } from '../users/user-stats.entity';
import { MatchmakingGateway } from './matchmaking.gateway';
import { AuditModule } from '../audit/audit.module';
import { HouseModule } from '../house/house.module';

@Module({
    imports: [TypeOrmModule.forFeature([User, Wallet, UserStats]), AuditModule, HouseModule],
    providers: [MatchmakingService, MatchmakingGateway],
    controllers: [MatchmakingController]
})
export class MatchmakingModule { }
