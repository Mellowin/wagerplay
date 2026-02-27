import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class JwtAuthGuard implements CanActivate {
    constructor(private jwtService: JwtService) {}

    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest();
        const authHeader = request.headers.authorization;
        const path = request.path || request.url;

        console.log(`[JwtAuthGuard] Path: ${path}`);
        console.log(`[JwtAuthGuard] Auth header: ${authHeader ? authHeader.substring(0, 50) + '...' : 'NONE'}`);

        if (!authHeader) {
            console.log('[JwtAuthGuard] ❌ No authorization header');
            throw new UnauthorizedException('No authorization header');
        }

        const [type, token] = authHeader.split(' ');
        console.log(`[JwtAuthGuard] Type: ${type}, Token length: ${token?.length || 0}`);

        if (type !== 'Bearer' || !token) {
            console.log('[JwtAuthGuard] ❌ Invalid format');
            throw new UnauthorizedException('Invalid authorization header format');
        }

        try {
            const payload = this.jwtService.verify(token);
            // Fallback: используем sub если userId не определен (для старых токенов)
            const userId = payload.userId || payload.sub;
            console.log(`[JwtAuthGuard] ✅ Verified, userId: ${userId?.substring(0, 8)}...`);
            request.user = { ...payload, userId };
            return true;
        } catch (err) {
            console.log(`[JwtAuthGuard] ❌ Token verify failed: ${err.message}`);
            throw new UnauthorizedException('Invalid token');
        }
    }
}
