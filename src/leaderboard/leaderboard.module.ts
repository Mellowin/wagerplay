import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LeaderboardService } from './leaderboard.service';
import { LeaderboardController } from './leaderboard.controller';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UserStats } from '../users/user-stats.entity';
import { User } from '../users/user.entity';

@Module({
    imports: [
        TypeOrmModule.forFeature([UserStats, User]),
        JwtModule.registerAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (config: ConfigService) => ({
                secret: config.get<string>('JWT_SECRET') || 'fallback-secret',
                signOptions: { expiresIn: '7d' },
            }),
        }),
    ],
    controllers: [LeaderboardController],
    providers: [LeaderboardService, JwtAuthGuard],
    exports: [LeaderboardService],
})
export class LeaderboardModule {}
