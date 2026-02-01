export type Move = "ROCK" | "PAPER" | "SCISSORS";

export function decideWinner(moves: Record<string, Move>) {
  // moves: { userId: "ROCK", botId: "SCISSORS" }

  const entries = Object.entries(moves);

  // Если у всех одинаково — ничья
  const unique = new Set(entries.map(([, m]) => m));
  if (unique.size === 1) {
    return { type: "TIE" as const };
  }

  // Если есть все три (R,P,S) — ничья
  if (unique.size === 3) {
    return { type: "TIE" as const };
  }

  // Осталось 2 варианта — определяем победителя
  const [aMove, bMove] = Array.from(unique);

  const beats: Record<Move, Move> = {
    ROCK: "SCISSORS",
    SCISSORS: "PAPER",
    PAPER: "ROCK",
  };

  const winningMove = beats[aMove as Move] === (bMove as Move) ? (aMove as Move) : (bMove as Move);

  const winners = entries.filter(([, m]) => m === winningMove).map(([id]) => id);
  const losers = entries.filter(([, m]) => m !== winningMove).map(([id]) => id);

  return { type: "DECIDED" as const, winningMove, winners, losers };
}
