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

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToOne(() => Wallet, (w) => w.user)
  wallet: Wallet;
}
