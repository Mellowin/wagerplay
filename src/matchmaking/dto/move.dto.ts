import { IsEnum, IsNotEmpty, IsIn, Min, Max } from 'class-validator';

export enum Move {
  ROCK = 'ROCK',
  PAPER = 'PAPER',
  SCISSORS = 'SCISSORS',
}

export class SubmitMoveDto {
  @IsEnum(Move, { message: 'Move must be ROCK, PAPER, or SCISSORS' })
  @IsNotEmpty()
  move: Move;
}

export class QuickplayDto {
  @IsIn([2, 3, 4, 5], { message: 'playersCount must be 2, 3, 4, or 5' })
  playersCount: number;

  @IsIn([100, 200, 500, 1000, 2500, 5000, 10000], { message: 'stakeVp must be one of: 100, 200, 500, 1000, 2500, 5000, 10000' })
  stakeVp: number;
}
