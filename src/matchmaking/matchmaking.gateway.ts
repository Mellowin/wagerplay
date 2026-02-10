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

  afterInit() {
    // Передаём сервер в сервис для отправки событий
    this.mm.setServer(this.server);
  }

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

    // Если попали в очередь — ждём синхронизированное время
    if (res.status === 'IN_QUEUE' && res.ticketId) {
      const secondsLeft = res.secondsLeft || 20;
      // Отправляем queue:sync с актуальным количеством игроков
      const queueLen = await this.mm.getQueueLength(body.playersCount, body.stakeVp);
      socket.emit('queue:sync', { 
        playersFound: queueLen, 
        totalNeeded: body.playersCount,
        secondsLeft: secondsLeft 
      });
      socket.emit('queue:waiting', { seconds: secondsLeft, playersFound: queueLen });
      console.log(`[Gateway] User ${userId.slice(0,8)} in queue, ${queueLen}/${body.playersCount} players, ${secondsLeft}s left`);

      setTimeout(async () => {
        try {
          // если пользователь отключился — не шлём
          if (!this.userSockets.has(userId)) return;

          const fb = await this.mm.fallbackToBotIfTimedOut(res.ticketId);
          socket.emit('fallback:result', fb);

          // если нашли матч — делаем отсчёт и начинаем
          if (fb.matchId) {
            // Отсчёт 5 секунд перед матчем с ботами
            socket.emit('match:found', { matchId: fb.matchId, countdown: 5, mode: 'BOT_MATCH' });
            
            for (let i = 5; i >= 1; i--) {
              setTimeout(() => {
                socket.emit('match:countdown', { seconds: i });
              }, (5 - i) * 1000);
            }
            
            setTimeout(async () => {
              socket.join(`match:${fb.matchId}`);
              const m = await this.mm.getMatch(fb.matchId);
              socket.emit('match:start', m);
              socket.emit('match:update', m);
              
              // Если остались только боты — запускаем пошаговую игру
              if (m && m.aliveIds.length > 0 && m.aliveIds.every((id: string) => id.startsWith('BOT'))) {
                this.mm.processBotRounds(fb.matchId);
              }
            }, 5000);
          }
        } catch (e: any) {
          socket.emit('error', { message: e?.message || 'fallback failed' });
        }
      }, 20_000);  // 20 секунд ждём реальных игроков
    }

    // Если матч готов сразу — НИЧЕГО НЕ ДЕЛАЕМ здесь
    // Все события отправляются из matchmaking.service.ts при создании матча
    // Это нужно чтобы ВСЕ игроки получили события одновременно
    if (res.status === 'MATCH_READY' && res.matchId) {
      console.log(`[Gateway] MATCH_READY for ${userId.slice(0,8)}, match: ${res.matchId.slice(0,8)} - events sent from service`);
      // Не отправляем события здесь - они уже отправлены из tryAssembleMatch!
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
    
    // ⏱️ Отправляем информацию о таймере хода
    if (updated.moveDeadline) {
      this.server.to(`match:${body.matchId}`).emit('match:timer', {
        type: 'move',
        deadline: updated.moveDeadline,
        secondsLeft: Math.ceil((updated.moveDeadline - Date.now()) / 1000),
      });
    }

    // если клиент ещё не в комнате — добавим (на всякий)
    socket.join(`match:${body.matchId}`);

    // Если игрок выбыл и остались только боты — запускаем пошаговую игру
    // (теперь эта логика внутри submitMove, оставляем как fallback)
    if (updated && !updated.aliveIds.includes(userId) && 
        updated.aliveIds.length > 0 && 
        updated.aliveIds.every((id: string) => id.startsWith('BOT'))) {
      this.mm.processBotRounds(body.matchId);
    }

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

  @SubscribeMessage('match:join')
  async onMatchJoin(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { matchId: string },
  ) {
    socket.join(`match:${body.matchId}`);
    console.log(`[match:join] ${socket.data.userId} joined room match:${body.matchId}`);
    return { ok: true };
  }

  @SubscribeMessage('chat:message')
  async onChatMessage(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { matchId: string; text: string },
  ) {
    const userId = this.getUserId(socket);
    
    // Отправляем сообщение всем в комнате матча
    this.server.to(`match:${body.matchId}`).emit('chat:message', {
      author: userId,
      text: body.text,
      matchId: body.matchId,
      timestamp: Date.now(),
    });
    
    return { ok: true };
  }

  @SubscribeMessage('chat:game')
  async onChatGame(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { matchId: string; text: string },
  ) {
    const userId = this.getUserId(socket);
    
    // Отправляем сообщение всем в комнате матча
    this.server.to(`match:${body.matchId}`).emit('chat:game', {
      author: userId,
      text: body.text,
      matchId: body.matchId,
      timestamp: Date.now(),
    });
    
    return { ok: true };
  }

  @SubscribeMessage('chat:global')
  async onChatGlobal(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { text: string },
  ) {
    const userId = this.getUserId(socket);
    
    // Отправляем сообщение всем подключенным клиентам
    this.server.emit('chat:global', {
      author: userId,
      text: body.text,
      timestamp: Date.now(),
    });
    
    return { ok: true };
  }

  // Пошаговая игра ботов с задержкой 1.5 секунды между раундами
  async processBotRoundsWithDelay(matchId: string) {
    const ROUND_DELAY_MS = 1500; // 1.5 секунды между раундами
    const MAX_ROUNDS = 50; // защита от бесконечного цикла
    
    for (let round = 0; round < MAX_ROUNDS; round++) {
      // ⏱️ ЗАДЕРЖКА В НАЧАЛЕ - перед каждым раундом ботов
      await new Promise(resolve => setTimeout(resolve, ROUND_DELAY_MS));
      
      const m = await this.mm.getMatch(matchId);
      
      // Проверяем, что матч ещё активен и остались только боты
      if (!m || m.status === 'FINISHED' || m.aliveIds.length <= 1) {
        break;
      }
      
      // Проверяем, что все оставшиеся — боты
      if (!m.aliveIds.every((id: string) => id.startsWith('BOT'))) {
        break;
      }

      // Делаем один раунд ботов
      const updated = await this.mm.processSingleBotRound(matchId);
      
      if (!updated) {
        break;
      }

      // Отправляем событие нового раунда для звукового эффекта
      this.server.to(`match:${matchId}`).emit('match:round', { 
        round: updated.round,
        aliveCount: updated.aliveIds.length 
      });
      
      // Отправляем обновление всем в комнате матча
      this.server.to(`match:${matchId}`).emit('match:update', updated);

      // Если матч закончился — выходим
      if (updated.status === 'FINISHED' || updated.aliveIds.length === 1) {
        break;
      }
    }
  }
}
