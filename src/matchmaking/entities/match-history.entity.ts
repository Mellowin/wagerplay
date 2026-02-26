import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity('match_history')
export class MatchHistory {
    @PrimaryColumn('uuid')
    id: string;

    @Column('varchar')
    winnerId: string;

    @Column('jsonb')
    playerIds: string[];

    @Column('jsonb')
    players: { id: string; displayName: string; move: string }[];

    @Column('int')
    stake: number;

    @Column('int')
    payout: number;

    @Column('int')
    rounds: number;

    @Column('jsonb')
    roundResults: {
        round: number;
        moves: Record<string, string>;
        eliminated: string[];
    }[];

    @Column('timestamp')
    startedAt: Date;

    @CreateDateColumn()
    finishedAt: Date;
}
