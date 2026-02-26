import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { InjectRepository } from '@nestjs/typeorm';
import { Server, Socket } from 'socket.io';
import { Repository } from 'typeorm';
import { User } from '../users/user.entity';
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

  constructor(
    private mm: MatchmakingService,
    @InjectRepository(User)
    private usersRepo: Repository<User>,
  ) {}

  afterInit() {
    // Передаём сервер в сервис для отправки событий
    this.mm.setServer(this.server);
  }

  async handleConnection(socket: Socket) {
    // token = userId (как у нас сейчас)
    const token = (socket.handshake.auth?.token || socket.handshake.query?.token) as string | undefined;
    if (!token) {
      socket.disconnect();
      return;
    }

    const userId = token.toString().trim();
    const displayName = (socket.handshake.auth?.displayName || socket.handshake.query?.displayName) as string | undefined;
    socket.data.userId = userId;
    socket.data.displayName = displayName;
    this.userSockets.set(userId, socket.id);

    // 🆕 Проверяем и очищаем зависшие матчи при подключении
    try {
      const cleanup = await this.mm.checkAndCleanupUserMatches(userId);
      if (cleanup.cleaned > 0) {
        console.log(`[Gateway] Cleaned ${cleanup.cleaned} orphaned matches for user ${userId}, returned ${cleanup.returnedVp} VP`);
        socket.emit('matches:cleanup', { 
          cleaned: cleanup.cleaned, 
          returnedVp: cleanup.returnedVp,
          message: `Возвращено ${cleanup.returnedVp} VP из зависших матчей`
        });
      }
    } catch (e) {
      console.error(`[Gateway] Error cleaning matches for user ${userId}:`, e);
    }

    // 🆕 Проверяем, находится ли игрок в очереди (F5 восстановление)
    try {
      const queueInfo = await this.mm.findUserTicket(userId);
      if (queueInfo) {
        console.log(`[Gateway] User ${userId.slice(0,8)} reconnected while in queue, sending queue:sync`);
        socket.emit('queue:sync', {
          playersFound: queueInfo.playersFound,
          totalNeeded: queueInfo.ticket.playersCount,
          secondsLeft: queueInfo.secondsLeft,
          stakeVp: queueInfo.ticket.stakeVp,
          reconnected: true  // ← флаг что это восстановление после F5
        });
      }
    } catch (e) {
      console.error(`[Gateway] Error checking queue for ${userId}:`, e);
    }

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
    const displayName = socket.data.displayName as string | undefined;

    const res = await this.mm.quickPlay(userId, body.playersCount, body.stakeVp, displayName);
    socket.emit('quickplay:result', res);

    // Если попали в очередь — ждём синхронизированное время
    if (res.status === 'IN_QUEUE' && res.ticketId) {
      const secondsLeft = (res as any).secondsLeft || 20;
      // Отправляем queue:sync с актуальным количеством игроков
      const queueLen = await this.mm.getQueueLength(body.playersCount, body.stakeVp);
      socket.emit('queue:sync', { 
        playersFound: queueLen, 
        totalNeeded: body.playersCount,
        secondsLeft: secondsLeft 
      });
      socket.emit('queue:waiting', { seconds: secondsLeft, playersFound: queueLen });
      console.log(`[Gateway] User ${userId.slice(0,8)} in queue, ${queueLen}/${body.playersCount} players, ${secondsLeft}s left`);

      // ⏱️ Запускаем fallback через secondsLeft секунд (20 сек по умолчанию)
      setTimeout(async () => {
        try {
          const fb = await this.mm.fallbackToBotIfTimedOut(res.ticketId);
          
          // 🔄 Ищем АКТУАЛЬНЫЙ socket по userId (после F5 может быть новый)
          const sockets = await this.server.fetchSockets();
          const currentSocket = sockets.find(s => s.data?.userId === userId);
          
          if (!currentSocket) {
            console.log(`[Gateway] User ${userId.slice(0,8)} disconnected, skipping bot match events`);
            return;
          }
          
          currentSocket.emit('fallback:result', fb);

          // если нашли матч — делаем отсчёт и начинаем
          if (fb.matchId) {
            // Отсчёт 5 секунд перед матчем с ботами
            currentSocket.emit('match:found', { matchId: fb.matchId, countdown: 5, mode: 'BOT_MATCH' });
            
            for (let i = 5; i >= 1; i--) {
              setTimeout(() => {
                // 🔄 Снова ищем актуальный socket (могли переподключиться во время отсчёта)
                this.server.fetchSockets().then(sockets => {
                  const s = sockets.find(sock => sock.data?.userId === userId);
                  if (s) s.emit('match:countdown', { seconds: i });
                });
              }, (5 - i) * 1000);
            }
            
            // Запускаем матч сразу после отсчёта (5 сек)
            setTimeout(async () => {
              // 🛡️ Защита от двойного запуска
              const startLockKey = `match:startlock:${fb.matchId}`;
              const startLock = await this.mm.acquireLock(startLockKey, 10);
              if (!startLock) {
                console.log(`[Gateway] Match ${fb.matchId} start already in progress, skipping`);
                return;
              }
              
              try {
                // 🔄 Ищем актуальный socket ПЕРЕД отправкой событий
                const sockets = await this.server.fetchSockets();
                const actualSocket = sockets.find(s => s.data?.userId === userId);
                
                if (!actualSocket) {
                  console.log(`[Gateway] User ${userId.slice(0,8)} disconnected before match start`);
                  return;
                }
                
                // Устанавливаем таймер для первого хода
                await this.mm.startMoveTimer(fb.matchId, 12);
                
                actualSocket.join(`match:${fb.matchId}`);
                const m = await this.mm.getMatch(fb.matchId);
                if (!m || !m.moveDeadline) return;
                
                const matchWithDeadline = { ...m, deadline: m.moveDeadline };
                actualSocket.emit('match:start', matchWithDeadline);
                actualSocket.emit('match:update', matchWithDeadline);
                
                // Отправляем таймер отдельным событием
                actualSocket.emit('match:timer', {
                  type: 'move',
                  deadline: m.moveDeadline,
                  secondsLeft: 12,
                  round: m.round,
                });
                
                // Если остались только боты — запускаем пошаговую игру
                if (m.aliveIds.length > 0 && m.aliveIds.every((id: string) => id.startsWith('BOT'))) {
                  this.mm.processBotRounds(fb.matchId);
                }
              } finally {
                await this.mm.releaseLock(startLockKey);
              }
            }, 5000);
          }
        } catch (e: any) {
          // 🔄 Ищем актуальный socket для отправки ошибки
          const sockets = await this.server.fetchSockets();
          const s = sockets.find(sock => sock.data?.userId === userId);
          if (s) s.emit('error', { message: e?.message || 'fallback failed' });
        }
      }, secondsLeft * 1000);  // ⏱️ Ждём 20 секунд (или secondsLeft от сервера)
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
    this.server.to(`match:${body.matchId}`).emit('match:update', { ...updated, deadline: updated.moveDeadline });
    
    // ⏱️ Отправляем информацию о таймере хода
    if (updated.moveDeadline) {
      this.server.to(`match:${body.matchId}`).emit('match:timer', {
        type: 'move',
        deadline: updated.moveDeadline,
        secondsLeft: Math.ceil((updated.moveDeadline - Date.now()) / 1000),
        round: updated.round,  // 👈 Всегда включаем номер раунда
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
    // 🔄 Отправляем match:get для восстановления после F5
    socket.emit('match:get', m);
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
    
    // Get user profile for displayName and avatar
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    const displayName = user?.displayName || userId.slice(0, 8);
    
    // Отправляем сообщение всем в комнате матча
    this.server.to(`match:${body.matchId}`).emit('chat:game', {
      author: userId,
      displayName,
      avatarUrl: user?.avatarUrl || null,
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
    
    // Get user profile for displayName and avatar
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    const displayName = user?.displayName || userId.slice(0, 8);
    
    // Отправляем сообщение всем подключенным клиентам
    this.server.emit('chat:global', {
      author: userId,
      displayName,
      avatarUrl: user?.avatarUrl || null,
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
      this.server.to(`match:${matchId}`).emit('match:update', { ...updated, deadline: updated.moveDeadline });

      // Если матч закончился — выходим
      if (updated.status === 'FINISHED' || updated.aliveIds.length === 1) {
        break;
      }
    }
  }
}
