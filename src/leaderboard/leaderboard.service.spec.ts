import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LeaderboardService } from './leaderboard.service';
import { UserStats } from '../users/user-stats.entity';
import { User } from '../users/user.entity';

describe('LeaderboardService', () => {
  let service: LeaderboardService;
  let userStatsRepo: Repository<UserStats>;
  let userRepo: Repository<User>;

  const mockUserStats = [
    {
      userId: 'user-1',
      totalMatches: 10,
      wins: 8,
      losses: 2,
      totalWonVp: 5000,
      totalLostVp: 1000,
      totalStakedVp: 2000,
      biggestWinVp: 3000,
      biggestStakeVp: 1000,
      winStreak: 3,
      maxWinStreak: 5,
      user: {
        userId: 'user-1',
        displayName: 'Player 1',
        username: 'player1',
        avatarUrl: null,
      } as User,
    },
    {
      userId: 'user-2',
      totalMatches: 5,
      wins: 2,
      losses: 3,
      totalWonVp: 2000,
      totalLostVp: 1500,
      totalStakedVp: 1000,
      biggestWinVp: 1500,
      biggestStakeVp: 500,
      winStreak: 1,
      maxWinStreak: 2,
      user: {
        userId: 'user-2',
        displayName: 'Player 2',
        username: 'player2',
        avatarUrl: 'http://example.com/avatar.png',
      } as User,
    },
  ] as UserStats[];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeaderboardService,
        {
          provide: getRepositoryToken(UserStats),
          useValue: {
            find: jest.fn().mockImplementation((options) => {
            let result = [...mockUserStats];
            if (options?.skip) result = result.slice(options.skip);
            if (options?.take) result = result.slice(0, options.take);
            return Promise.resolve(result);
          }),
            findOne: jest.fn().mockImplementation(({ where }) => {
              const stat = mockUserStats.find(s => s.userId === where.userId);
              return Promise.resolve(stat || null);
            }),
            count: jest.fn().mockResolvedValue(2),
          },
        },
        {
          provide: getRepositoryToken(User),
          useValue: {
            findOne: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<LeaderboardService>(LeaderboardService);
    userStatsRepo = module.get<Repository<UserStats>>(getRepositoryToken(UserStats));
    userRepo = module.get<Repository<User>>(getRepositoryToken(User));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getLeaderboard', () => {
    it('should return leaderboard sorted by wins', async () => {
      const result = await service.getLeaderboard('wins', 10, 0);

      expect(result).toHaveProperty('entries');
      expect(result).toHaveProperty('total');
      expect(Array.isArray(result.entries)).toBe(true);
      expect(result.entries.length).toBe(2);
      expect(result.entries[0].stats.wins).toBeGreaterThanOrEqual(result.entries[1].stats.wins);
    });

    it('should return leaderboard sorted by profit (totalWonVp)', async () => {
      const result = await service.getLeaderboard('profit', 10, 0);

      expect(result.entries.length).toBe(2);
      expect(result.entries[0].value).toBe(5000);
    });

    it('should return leaderboard sorted by streak', async () => {
      const result = await service.getLeaderboard('streak', 10, 0);

      expect(result.entries.length).toBe(2);
      expect(result.entries[0].value).toBe(3);
    });

    it('should return leaderboard sorted by biggestWin (maxWinStreak)', async () => {
      const result = await service.getLeaderboard('biggestWin', 10, 0);

      expect(result.entries.length).toBe(2);
      expect(result.entries[0].value).toBe(5);
    });

    it('should support pagination', async () => {
      const result = await service.getLeaderboard('wins', 1, 0);

      expect(result.entries.length).toBeLessThanOrEqual(1);
      expect(result.total).toBe(2);
    });
  });

  describe('findUserPosition', () => {
    it('should return user position', async () => {
      const result = await service.findUserPosition('user-1', 'wins');

      expect(result).not.toBeNull();
      expect(result?.userId).toBe('user-1');
      expect(result).toHaveProperty('rank');
      expect(result).toHaveProperty('stats');
      expect(result).toHaveProperty('value');
    });

    it('should return null for non-existent user', async () => {
      const result = await service.findUserPosition('non-existent', 'wins');

      expect(result).toBeNull();
    });

    it('should work with all categories', async () => {
      const categories: Array<'wins' | 'winRate' | 'profit' | 'streak' | 'biggestWin'> = 
        ['wins', 'winRate', 'profit', 'streak', 'biggestWin'];

      for (const category of categories) {
        const result = await service.findUserPosition('user-1', category);
        expect(result).not.toBeNull();
        expect(result?.userId).toBe('user-1');
      }
    });
  });

  describe('getGlobalLeaderboard', () => {
    it('should return leaderboard for all categories', async () => {
      const result = await service.getGlobalLeaderboard(5);

      expect(result).toHaveProperty('wins');
      expect(result).toHaveProperty('winRate');
      expect(result).toHaveProperty('profit');
      expect(result).toHaveProperty('streak');
      expect(result).toHaveProperty('biggestWin');

      expect(Array.isArray(result.wins)).toBe(true);
      expect(result.wins.length).toBe(2);
    });
  });
});
