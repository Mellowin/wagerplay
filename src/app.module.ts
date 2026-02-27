import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
// import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';

import { AppController } from './app.controller';
import { AppService } from './app.service';

import { User } from './users/user.entity';
import { Wallet } from './wallets/wallet.entity';
import { AuthModule } from './auth/auth.module';
import { MatchmakingModule } from './matchmaking/matchmaking.module';
import { WalletsModule } from './wallets/wallets.module';
import { AuditModule } from './audit/audit.module';
import { HouseModule } from './house/house.module';
import { AvatarsModule } from './avatars/avatars.module';
import { ThrottleModule } from './throttle/throttle.module';
import { LeaderboardModule } from './leaderboard/leaderboard.module';

@Module({
    imports: [
        ConfigModule.forRoot({ isGlobal: true }),

        TypeOrmModule.forRootAsync({
            inject: [ConfigService],
            useFactory: (cfg: ConfigService) => ({
                type: 'postgres',
                host: cfg.get<string>('DB_HOST'),
                port: Number(cfg.get<string>('DB_PORT')),
                username: cfg.get<string>('DB_USER'),
                password: cfg.get<string>('DB_PASSWORD'),
                database: cfg.get<string>('DB_NAME'),
                autoLoadEntities: true,
                entities: [User, Wallet],
                synchronize: true, // для MVP ок. Потом выключим и сделаем миграции.
            }),
        }),

        AuthModule,
        WalletsModule,
        AuditModule,
        MatchmakingModule,
        HouseModule,
        AvatarsModule,
        ThrottleModule,
        LeaderboardModule,
        // ServeStaticModule.forRoot({
        //     rootPath: join(process.cwd()),
        // }),
    ],
    controllers: [AppController],
    providers: [AppService],
})
export class AppModule { }
