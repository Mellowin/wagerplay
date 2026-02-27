import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Wallet } from './wallet.entity';
import { UserStats } from '../users/user-stats.entity';
import { WalletsService } from './wallets.service';
import { WalletsController } from './wallets.controller';
import { MatchmakingModule } from '../matchmaking/matchmaking.module';

@Module({
    imports: [TypeOrmModule.forFeature([Wallet, UserStats]), MatchmakingModule],
    providers: [WalletsService],
    controllers: [WalletsController],
})
export class WalletsModule { }
