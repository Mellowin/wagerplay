import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { MatchmakingService } from './matchmaking.service';

type Move = 'ROCK' | 'PAPER' | 'SCISSORS';

@WebSocketGateway({
  cors: { origin: '*' }, // для MVP удобно
})
export class MatchmakingGateway {
  @WebSocketServer()
  server: Server;

  // связь userId -> socket.id (для MVP достаточно)
  private userSockets = new Map<string, string>();

  constructor(private mm: MatchmakingService) {}

  handleConnection(socket: Socket) {
    // token = userId (как у нас сейчас)
    const token = (socket.handshake.auth?.token || socket.handshake.query?.token) as string | undefined;
    if (!token) {
      socket.disconnect();
      return;
    }

    const userId = token.toString().trim();
    socket.data.userId = userId;
    this.userSockets.set(userId, socket.id);

    socket.emit('connected', { userId });
  }

  handleDisconnect(socket: Socket) {
    const userId = socket.data.userId as string | undefined;
    if (userId) {
      const cur = this.userSockets.get(userId);
      if (cur === socket.id) this.userSockets.delete(userId);
    }
  }

  private getUserId(socket: Socket): string {
    const userId = socket.data.userId as string | undefined;
    if (!userId) throw new WsException('Unauthorized: missing token');
    return userId;
  }

  @SubscribeMessage('quickplay')
  async onQuickplay(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { playersCount: number; stakeVp: number },
  ) {
    const userId = this.getUserId(socket);

    const res = await this.mm.quickPlay(userId, body.playersCount, body.stakeVp);
    socket.emit('quickplay:result', res);

    // Если попали в очередь — через 60 сек пробуем fallback
    if (res.status === 'IN_QUEUE' && res.ticketId) {
      socket.emit('queue:waiting', { seconds: 60 });

      setTimeout(async () => {
        try {
          // если пользователь отключился — не шлём
          if (!this.userSockets.has(userId)) return;

          const fb = await this.mm.fallbackToBotIfTimedOut(res.ticketId);
          socket.emit('fallback:result', fb);

          // если нашли матч — добавим в комнату матча и отправим состояние
          if (fb.matchId) {
            socket.join(`match:${fb.matchId}`);
            const m = await this.mm.getMatch(fb.matchId);
            socket.emit('match:update', m);
          }
        } catch (e: any) {
          socket.emit('error', { message: e?.message || 'fallback failed' });
        }
      }, 60_000);
    }

    // Если матч готов сразу — подписываем на комнату и отправляем состояние
    if (res.status === 'MATCH_READY' && res.matchId) {
      socket.join(`match:${res.matchId}`);
      const m = await this.mm.getMatch(res.matchId);
      socket.emit('match:update', m);
    }

    return { ok: true };
  }

  @SubscribeMessage('move')
  async onMove(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { matchId: string; move: Move },
  ) {
    const userId = this.getUserId(socket);

    const updated = await this.mm.submitMove(body.matchId, userId, body.move);

    // рассылаем всем участникам комнаты матча (в PVP пригодится)
    this.server.to(`match:${body.matchId}`).emit('match:update', updated);

    // если клиент ещё не в комнате — добавим (на всякий)
    socket.join(`match:${body.matchId}`);

    return { ok: true };
  }

  @SubscribeMessage('match:get')
  async onGetMatch(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { matchId: string },
  ) {
    const m = await this.mm.getMatch(body.matchId);
    socket.emit('match:update', m);
    socket.join(`match:${body.matchId}`);
    return { ok: true };
  }
}
