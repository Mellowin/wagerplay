import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, JoinColumn, OneToOne } from 'typeorm';
import { User } from './user.entity';

@Entity('user_stats')
export class UserStats {
    @PrimaryColumn('uuid')
    userId: string;

    @OneToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'userId' })
    user: User;

    @Column({ type: 'int', default: 0 })
    totalMatches: number;

    @Column({ type: 'int', default: 0 })
    wins: number;

    @Column({ type: 'int', default: 0 })
    losses: number;

    @Column({ type: 'int', default: 0 })
    totalWonVp: number;

    @Column({ type: 'int', default: 0 })
    totalLostVp: number;

    @Column({ type: 'int', default: 0 })
    totalStakedVp: number;

    @Column({ type: 'int', default: 0 })
    biggestWinVp: number;

    @Column({ type: 'int', default: 0 })
    biggestStakeVp: number;

    @Column({ type: 'int', default: 0 })
    winStreak: number;

    @Column({ type: 'int', default: 0 })
    maxWinStreak: number;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    // Вычисляемое поле (не сохраняется в БД)
    get winRate(): number {
        if (this.totalMatches === 0) return 0;
        return Math.round((this.wins / this.totalMatches) * 100);
    }
}
