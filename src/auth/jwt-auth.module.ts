import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from './jwt-auth.guard';

@Global()
@Module({
    imports: [
        JwtModule.registerAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (config: ConfigService) => ({
                secret: config.get<string>('JWT_SECRET') || 'fallback-secret-change-in-production',
                signOptions: { expiresIn: '7d' },
            }),
        }),
    ],
    providers: [JwtAuthGuard],
    exports: [JwtModule, JwtAuthGuard],
})
export class JwtAuthModule {}
