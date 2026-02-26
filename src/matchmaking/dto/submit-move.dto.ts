import { IsEnum } from 'class-validator';

export enum Move {
  ROCK = 'ROCK',
  PAPER = 'PAPER',
  SCISSORS = 'SCISSORS',
}

export class SubmitMoveDto {
  @IsEnum(Move, { message: 'Move must be one of: ROCK, PAPER, SCISSORS' })
  move: Move;
}
