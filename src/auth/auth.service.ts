import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { Wallet } from '../wallets/wallet.entity';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private usersRepo: Repository<User>,
    @InjectRepository(Wallet) private walletsRepo: Repository<Wallet>,
  ) {}

  async guestLogin() {
    const user = this.usersRepo.create();
    await this.usersRepo.save(user);

    const wallet = this.walletsRepo.create({
      user,
      balanceWp: 10000,
      frozenWp: 0,
    });
    await this.walletsRepo.save(wallet);

    // MVP токен = userId. Потом сделаем JWT.
    return { userId: user.id, token: user.id, balanceWp: wallet.balanceWp };
  }
  async me(token: string) {
    // Пока токен = userId (позже заменим на JWT)
    const userId = token;

    const user = await this.usersRepo.findOne({
      where: { id: userId },
      relations: { wallet: true },
    });

    if (!user) {
      throw new Error("User not found");
    }

    return {
      userId: user.id,
      balanceWp: user.wallet?.balanceWp ?? 0,
      frozenWp: user.wallet?.frozenWp ?? 0,
    };
  }
}
