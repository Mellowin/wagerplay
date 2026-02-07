import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HouseService } from './house.service';
import { User } from '../users/user.entity';
import { Wallet } from '../wallets/wallet.entity';

@Module({
    imports: [TypeOrmModule.forFeature([User, Wallet])],
    providers: [HouseService],
    exports: [HouseService],
})
export class HouseModule { }
