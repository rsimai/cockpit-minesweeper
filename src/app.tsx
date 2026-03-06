/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2024 Red Hat, Inc.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardBody, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { FormSelect, FormSelectOption } from "@patternfly/react-core/dist/esm/components/FormSelect/index.js";
import { Toolbar, ToolbarContent, ToolbarItem } from "@patternfly/react-core/dist/esm/components/Toolbar/index.js";

import cockpit from 'cockpit';

const _ = cockpit.gettext;

type CellState = {
    isMine: boolean;
    isRevealed: boolean;
    isFlagged: boolean;
    adjacentMines: number;
};

type GameStatus = 'idle' | 'playing' | 'won' | 'lost';

type BoardConfig = {
    rows: number;
    cols: number;
    mines: number;
};

const BOARD_CONFIGS: Record<string, BoardConfig> = {
    '9x9': { rows: 9, cols: 9, mines: 10 },
    '16x16': { rows: 16, cols: 16, mines: 40 },
    '16x30': { rows: 16, cols: 30, mines: 99 },
};

const MINE_OPTIONS: Record<string, number[]> = {
    '9x9': [10, 15, 20, 25, 30],
    '16x16': [40, 50, 60, 70, 80],
    '16x30': [99, 110, 130, 150, 170],
};

function createEmptyBoard(rows: number, cols: number): CellState[][] {
    return Array.from({ length: rows }, () =>
        Array.from({ length: cols }, () => ({
            isMine: false,
            isRevealed: false,
            isFlagged: false,
            adjacentMines: 0,
        }))
    );
}

function placeMines(board: CellState[][], mines: number, firstRow: number, firstCol: number): CellState[][] {
    const rows = board.length;
    const cols = board[0].length;
    const newBoard = board.map(row => row.map(cell => ({ ...cell })));

    let placed = 0;
    while (placed < mines) {
        const r = Math.floor(Math.random() * rows);
        const c = Math.floor(Math.random() * cols);
        // Avoid placing mine on first click cell and 8 neighbors
        if (!newBoard[r][c].isMine && !(Math.abs(r - firstRow) <= 1 && Math.abs(c - firstCol) <= 1)) {
            newBoard[r][c].isMine = true;
            placed++;
        }
    }

    // Calculate adjacent mine counts
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            if (!newBoard[r][c].isMine) {
                let count = 0;
                for (let dr = -1; dr <= 1; dr++) {
                    for (let dc = -1; dc <= 1; dc++) {
                        const nr = r + dr;
                        const nc = c + dc;
                        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && newBoard[nr][nc].isMine) {
                            count++;
                        }
                    }
                }
                newBoard[r][c].adjacentMines = count;
            }
        }
    }
    return newBoard;
}

function revealCells(board: CellState[][], row: number, col: number): CellState[][] {
    const rows = board.length;
    const cols = board[0].length;
    const newBoard = board.map(r => r.map(cell => ({ ...cell })));

    const stack: [number, number][] = [[row, col]];
    while (stack.length > 0) {
        const [r, c] = stack.pop()!;
        if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
        if (newBoard[r][c].isRevealed || newBoard[r][c].isFlagged) continue;
        newBoard[r][c].isRevealed = true;
        if (newBoard[r][c].adjacentMines === 0 && !newBoard[r][c].isMine) {
            for (let dr = -1; dr <= 1; dr++) {
                for (let dc = -1; dc <= 1; dc++) {
                    if (dr !== 0 || dc !== 0) {
                        stack.push([r + dr, c + dc]);
                    }
                }
            }
        }
    }
    return newBoard;
}

function checkWin(board: CellState[][]): boolean {
    return board.every(row =>
        row.every(cell => cell.isMine ? !cell.isRevealed : cell.isRevealed)
    );
}

const ADJACENT_COLORS = ['', '#1565c0', '#2e7d32', '#c62828', '#283593', '#b71c1c', '#006064', '#000000', '#424242'];

const Cell = React.memo(({
    cell,
    row,
    col,
    gameStatus,
    onReveal,
    onFlag,
}: {
    cell: CellState;
    row: number;
    col: number;
    gameStatus: GameStatus;
    onReveal: (r: number, c: number) => void;
    onFlag: (r: number, c: number) => void;
}) => {
    const disabled = gameStatus === 'won' || gameStatus === 'lost';

    let content: React.ReactNode = null;
    let className = 'ms-cell';

    if (cell.isRevealed) {
        className += ' ms-cell--revealed';
        if (cell.isMine) {
            className += ' ms-cell--mine';
            content = '💣';
        } else if (cell.adjacentMines > 0) {
            content = (
                <span style={{ color: ADJACENT_COLORS[cell.adjacentMines], fontWeight: 'bold' }}>
                    {cell.adjacentMines}
                </span>
            );
        }
    } else if (cell.isFlagged) {
        content = '🚩';
    }

    return (
        <button
            className={className}
            disabled={disabled && !cell.isMine && !cell.isFlagged}
            aria-label={_("Cell") + ` ${row},${col}`}
            onClick={() => onReveal(row, col)}
            onContextMenu={(e) => { e.preventDefault(); onFlag(row, col) }}
        >
            {content}
        </button>
    );
});
Cell.displayName = 'Cell';

export const Application = () => {
    const [boardSize, setBoardSize] = useState('9x9');
    const [mineCount, setMineCount] = useState(10);
    const [board, setBoard] = useState<CellState[][]>(() => createEmptyBoard(9, 9));
    const [gameStatus, setGameStatus] = useState<GameStatus>('idle');
    const [elapsed, setElapsed] = useState(0);
    const [flagCount, setFlagCount] = useState(0);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const config = BOARD_CONFIGS[boardSize];

    const stopTimer = useCallback(() => {
        if (timerRef.current !== null) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
    }, []);

    const startNewGame = useCallback((size: string) => {
        stopTimer();
        const cfg = BOARD_CONFIGS[size];
        setBoard(createEmptyBoard(cfg.rows, cfg.cols));
        setGameStatus('idle');
        setElapsed(0);
        setFlagCount(0);
    }, [stopTimer]);

    // Start timer on first click
    const startTimer = useCallback(() => {
        timerRef.current = setInterval(() => {
            setElapsed(prev => prev + 1);
        }, 1000);
    }, []);

    useEffect(() => {
        return () => stopTimer();
    }, [stopTimer]);

    const handleBoardSizeChange = (value: string) => {
        setBoardSize(value);
        const defaultMines = MINE_OPTIONS[value][0];
        setMineCount(defaultMines);
        startNewGame(value);
    };

    const handleMineCountChange = (value: string) => {
        const mines = parseInt(value, 10);
        setMineCount(mines);
        startNewGame(boardSize);
    };

    const handleNewGame = () => {
        startNewGame(boardSize);
    };

    const handleReveal = useCallback((row: number, col: number) => {
        setBoard(prevBoard => {
            const cell = prevBoard[row][col];
            if (cell.isRevealed || cell.isFlagged) return prevBoard;

            let newBoard = prevBoard;

            if (gameStatus === 'idle') {
                // Place mines avoiding first click, then start timer
                newBoard = placeMines(prevBoard, mineCount, row, col);
                startTimer();
                setGameStatus('playing');
            }

            if (newBoard[row][col].isMine) {
                // Reveal all mines
                const blownBoard = newBoard.map(r =>
                    r.map(c => c.isMine ? { ...c, isRevealed: true } : c)
                );
                stopTimer();
                setGameStatus('lost');
                return blownBoard;
            }

            const revealed = revealCells(newBoard, row, col);
            if (checkWin(revealed)) {
                stopTimer();
                setGameStatus('won');
            }
            return revealed;
        });
    }, [gameStatus, mineCount, startTimer, stopTimer]);

    const handleFlag = useCallback((row: number, col: number) => {
        if (gameStatus === 'idle' || gameStatus === 'won' || gameStatus === 'lost') return;
        setBoard(prevBoard => {
            const cell = prevBoard[row][col];
            if (cell.isRevealed) return prevBoard;
            const newBoard = prevBoard.map(r => r.map(c => ({ ...c })));
            newBoard[row][col].isFlagged = !newBoard[row][col].isFlagged;
            setFlagCount(prev => prev + (newBoard[row][col].isFlagged ? 1 : -1));
            return newBoard;
        });
    }, [gameStatus]);

    const minesRemaining = mineCount - flagCount;
    const timerDisplay = String(Math.min(elapsed, 999)).padStart(3, '0');
    const minesDisplay = String(Math.max(minesRemaining, -99)).padStart(3, '0');

    let statusEmoji = '🙂';
    if (gameStatus === 'won') statusEmoji = '😎';
    else if (gameStatus === 'lost') statusEmoji = '😵';

    return (
        <Card className="ms-card">
            <CardTitle>{_("Minesweeper")}</CardTitle>
            <CardBody>
                <Toolbar className="ms-toolbar">
                    <ToolbarContent>
                        <ToolbarItem>
                            <FormSelect
                                aria-label={_("Board size")}
                                value={boardSize}
                                onChange={(_event, value) => handleBoardSizeChange(value)}
                            >
                                <FormSelectOption value="9x9" label={_("9×9 (Beginner)")} />
                                <FormSelectOption value="16x16" label={_("16×16 (Intermediate)")} />
                                <FormSelectOption value="16x30" label={_("16×30 (Expert)")} />
                            </FormSelect>
                        </ToolbarItem>
                        <ToolbarItem>
                            <FormSelect
                                aria-label={_("Mine count")}
                                value={String(mineCount)}
                                onChange={(_event, value) => handleMineCountChange(value)}
                            >
                                {(MINE_OPTIONS[boardSize] || []).map(n => (
                                    <FormSelectOption key={n} value={String(n)} label={cockpit.format(_("$0 mines"), n)} />
                                ))}
                            </FormSelect>
                        </ToolbarItem>
                        <ToolbarItem>
                            <Button variant="primary" onClick={handleNewGame}>{_("New Game")}</Button>
                        </ToolbarItem>
                    </ToolbarContent>
                </Toolbar>

                <div className="ms-statusbar">
                    <span className="ms-counter ms-counter--mines" aria-label={_("Mines remaining")}>
                        {minesDisplay}
                    </span>
                    <button
                        className="ms-smiley"
                        aria-label={_("New game")}
                        onClick={handleNewGame}
                    >
                        {statusEmoji}
                    </button>
                    <span className="ms-counter ms-counter--timer" aria-label={_("Timer")}>
                        {timerDisplay}
                    </span>
                </div>

                {(gameStatus === 'won' || gameStatus === 'lost') && (
                    <div className={`ms-message ms-message--${gameStatus}`}>
                        {gameStatus === 'won' ? _("You win! 🎉") : _("Game over! 💥")}
                    </div>
                )}

                <div
                    className="ms-board"
                    style={{ gridTemplateColumns: `repeat(${config.cols}, 2rem)` }}
                >
                    {board.map((row, r) =>
                        row.map((cell, c) => (
                            <Cell
                                key={`${r}-${c}`}
                                cell={cell}
                                row={r}
                                col={c}
                                gameStatus={gameStatus}
                                onReveal={handleReveal}
                                onFlag={handleFlag}
                            />
                        ))
                    )}
                </div>
            </CardBody>
        </Card>
    );
};
