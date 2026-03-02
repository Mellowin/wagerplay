import { Column, CreateDateColumn, Entity, OneToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Wallet } from '../wallets/wallet.entity';

export type Gender = 'male' | 'female' | null;

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255, unique: true, nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  passwordHash: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  username: string | null;

  @Column({ type: 'boolean', default: false })
  emailVerified: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  verificationToken: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  resetToken: string | null;

  @Column({ type: 'timestamp', nullable: true })
  resetTokenExpires: Date | null;

  // Profile fields
  @Column({ type: 'varchar', length: 100, nullable: true })
  displayName: string | null;

  @Column({ type: 'enum', enum: ['male', 'female'], nullable: true })
  gender: Gender;

  @Column({ type: 'text', nullable: true })
  avatarUrl: string | null;

  @Column({ type: 'boolean', default: true })
  isGuest: boolean;

  // 🛡️ Admin security fields
  @Column({ type: 'varchar', length: 45, nullable: true })
  adminIp: string | null; // IP с которого первый раз зашёл админ

  @Column({ type: 'timestamp', nullable: true })
  lastAdminActivity: Date | null; // Последняя активность админа (устарело)

  @Column({ type: 'bigint', nullable: true })
  lastAdminActivityMs: number | null; // Последняя активность админа (Unix ms) - фикс timezone

  // 🚫 Ban system
  @Column({ type: 'boolean', default: false })
  isBanned: boolean;

  @Column({ type: 'text', nullable: true })
  banReason: string | null;

  @Column({ type: 'uuid', nullable: true })
  bannedBy: string | null; // ID админа который забанил

  @Column({ type: 'timestamp', nullable: true })
  bannedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToOne(() => Wallet, (w) => w.user)
  wallet: Wallet;
}
