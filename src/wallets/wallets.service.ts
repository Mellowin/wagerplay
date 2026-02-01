import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Wallet } from './wallet.entity';

@Injectable()
export class WalletsService {
    constructor(@InjectRepository(Wallet) private walletsRepo: Repository<Wallet>) { }

    async getByUserId(userId: string) {
        return this.walletsRepo.findOne({
            where: { user: { id: userId } },
            relations: { user: true },
        });
    }
}
