import { Column, Entity, JoinColumn, OneToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from '../users/user.entity';

@Entity('wallets')
export class Wallet {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @OneToOne(() => User, (u) => u.wallet, { onDelete: 'CASCADE' })
    @JoinColumn()
    user: User;

    @Column({ type: 'int', default: 10000 })
    balanceWp: number;

    @Column({ type: 'int', default: 0 })
    frozenWp: number;
}
