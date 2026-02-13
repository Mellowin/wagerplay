import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Wallet } from './wallet.entity';
import { UserStats } from '../users/user-stats.entity';
import { WalletsService } from './wallets.service';
import { WalletsController } from './wallets.controller';

@Module({
    imports: [TypeOrmModule.forFeature([Wallet, UserStats])],
    providers: [WalletsService],
    controllers: [WalletsController],
})
export class WalletsModule { }
