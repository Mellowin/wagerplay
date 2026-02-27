import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerStorageRedisService } from './throttle-storage.service';
import { CustomThrottlerGuard } from './custom-throttle.guard';

@Module({
    imports: [
        ThrottlerModule.forRoot({
            throttlers: [
                // Global: 100 запросов за 60 секунд
                {
                    name: 'default',
                    ttl: 60000,
                    limit: 100,
                },
            ],
        }),
    ],
    providers: [
        ThrottlerStorageRedisService,
        {
            provide: APP_GUARD,
            useClass: CustomThrottlerGuard,
        },
    ],
    exports: [ThrottlerStorageRedisService],
})
export class ThrottleModule {}
