import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('audit_events')
export class AuditEvent {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Index()
    @Column({ type: 'uuid', nullable: true })
    matchId: string | null;

    @Index()
    @Column({ type: 'varchar', length: 64 })
    eventType: string;

    // кто инициировал: userId / BOT / SYSTEM / HOUSE
    @Index()
    @Column({ type: 'varchar', length: 64, nullable: true })
    actorId: string | null;

    @Column({ type: 'int', nullable: true })
    roundNo: number | null;

    @Column({ type: 'jsonb', default: {} })
    payload: Record<string, any>;

    @CreateDateColumn()
    createdAt: Date;
}
