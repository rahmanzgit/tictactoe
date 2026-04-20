import { useState, useEffect, useRef, useCallback } from "react";
import { io } from "socket.io-client";

const rawUrl = import.meta.env.VITE_SERVER_URL || `http://${window.location.hostname}:3001`;
const SERVER_URL = rawUrl.replace(/^http:\/\//, window.location.protocol === "https:" ? "https://" : "http://");

// ─── AI / Minimax ─────────────────────────────────────────
const LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];

function checkWinner(sq) {
  for (const [a,b,c] of LINES)
    if (sq[a] && sq[a] === sq[b] && sq[a] === sq[c])
      return { winner: sq[a], line: [a,b,c] };
  return null;
}

function minimax(sq, isMaximizing, aiMark, humanMark, depth = 0) {
  const result = checkWinner(sq);
  if (result) return result.winner === aiMark ? 10 - depth : depth - 10;
  if (sq.every(Boolean)) return 0;
  const moves = sq.map((v,i) => v ? null : i).filter(i => i !== null);
  if (isMaximizing) {
    let best = -Infinity;
    for (const i of moves) {
      sq[i] = aiMark;
      best = Math.max(best, minimax(sq, false, aiMark, humanMark, depth + 1));
      sq[i] = null;
    }
    return best;
  } else {
    let best = Infinity;
    for (const i of moves) {
      sq[i] = humanMark;
      best = Math.min(best, minimax(sq, true, aiMark, humanMark, depth + 1));
      sq[i] = null;
    }
    return best;
  }
}

function getBestMove(squares, aiMark, humanMark) {
  const sq = [...squares];
  const moves = sq.map((v,i) => v ? null : i).filter(i => i !== null);
  let bestScore = -Infinity, bestMove = moves[0];
  for (const i of moves) {
    sq[i] = aiMark;
    const score = minimax(sq, false, aiMark, humanMark, 0);
    sq[i] = null;
    if (score > bestScore) { bestScore = score; bestMove = i; }
  }
  return bestMove;
}

function getAIMove(squares, aiMark, humanMark, difficulty) {
  const empty = squares.map((v,i) => v ? null : i).filter(i => i !== null);
  if (difficulty === "easy") {
    // 80% random
    return Math.random() < 0.8
      ? empty[Math.floor(Math.random() * empty.length)]
      : getBestMove(squares, aiMark, humanMark);
  }
  if (difficulty === "medium") {
    // 50% best, 50% random
    return Math.random() < 0.5
      ? getBestMove(squares, aiMark, humanMark)
      : empty[Math.floor(Math.random() * empty.length)];
  }
  return getBestMove(squares, aiMark, humanMark); // hard: always best
}

// ─── Square ───────────────────────────────────────────────
function Square({ value, onClick, isWinning, isDisabled, index }) {
  return (
    <button
      className={["square", value ? `square--${value.toLowerCase()}` : "", isWinning ? "square--winning" : "", isDisabled ? "square--disabled" : ""].join(" ")}
      onClick={onClick}
      style={{ "--i": index }}
    >
      {value === "X" && <svg viewBox="0 0 40 40" className="mark mark--x"><line x1="6" y1="6" x2="34" y2="34" strokeLinecap="round" /><line x1="34" y1="6" x2="6" y2="34" strokeLinecap="round" /></svg>}
      {value === "O" && <svg viewBox="0 0 40 40" className="mark mark--o"><circle cx="20" cy="20" r="13" fill="none" strokeLinecap="round" /></svg>}
    </button>
  );
}

// ─── Scoreboard ───────────────────────────────────────────
function ScoreBoard({ scores, myMark, currentMark, gameActive, vsAI }) {
  return (
    <div className="scoreboard">
      {["X", "O"].map((mark) => {
        const isMe = mark === myMark;
        const isActive = gameActive && mark === currentMark;
        const label = vsAI ? (isMe ? `You (${mark})` : `AI (${mark})`) : (isMe ? `You (${mark})` : `Opponent (${mark})`);
        return (
          <div key={mark} className={`score-card ${isActive ? "score-card--active" : ""}`}>
            <span className="score-label">{label}</span>
            <span className="score-value">{scores[mark]}</span>
          </div>
        );
      })}
      <div className="score-divider">
        <span className="score-draws-label">Draws</span>
        <span className="score-draws-value">{scores.draws}</span>
      </div>
    </div>
  );
}

// ─── Lobby ────────────────────────────────────────────────
function Lobby({ onCreate, onJoin, onPlayAI, error, connected }) {
  const [joinCode, setJoinCode] = useState("");
  return (
    <div className="lobby">
      {/* vs AI */}
      <div className="lobby-card lobby-card--featured">
        <div className="lobby-card-header">
          <h2 className="lobby-title">vs Computer</h2>
          <span className="lobby-badge">Single Player</span>
        </div>
        <p className="lobby-desc">Play against the AI. Choose your difficulty.</p>
        <div className="difficulty-row">
          {["easy","medium","hard"].map(d => (
            <button key={d} className={`btn btn--difficulty btn--difficulty-${d}`} onClick={() => onPlayAI(d)}>
              {d.charAt(0).toUpperCase() + d.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="lobby-divider"><span>multiplayer</span></div>

      {!connected && (
        <div className="lobby-connecting">
          <div className="waiting-spinner" style={{ width: 20, height: 20, borderWidth: 2 }} />
          <span>Connecting to server…</span>
        </div>
      )}

      {/* Create room */}
      <div className="lobby-card">
        <h2 className="lobby-title">New Game</h2>
        <p className="lobby-desc">Create a room and share the code with a friend.</p>
        <button className="btn btn--primary btn--full" onClick={onCreate} disabled={!connected}>
          {connected ? "Create Room" : "Waiting for connection…"}
        </button>
      </div>

      <div className="lobby-divider"><span>or</span></div>

      {/* Join room */}
      <div className="lobby-card">
        <h2 className="lobby-title">Join Game</h2>
        <p className="lobby-desc">Enter a room code to join a friend's game.</p>
        <input className="code-input" placeholder="Enter room code…" value={joinCode}
          onChange={e => setJoinCode(e.target.value.toUpperCase())}
          onKeyDown={e => e.key === "Enter" && joinCode && connected && onJoin(joinCode)}
          maxLength={6} spellCheck={false} disabled={!connected}
        />
        <button className="btn btn--secondary btn--full" onClick={() => joinCode && onJoin(joinCode)} disabled={!joinCode || !connected}>
          Join Room
        </button>
      </div>
      {error && <p className="lobby-error">{error}</p>}
    </div>
  );
}

// ─── Waiting Room ─────────────────────────────────────────
function WaitingRoom({ code, onCancel }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  return (
    <div className="waiting">
      <div className="waiting-spinner" />
      <p className="waiting-label">Waiting for opponent…</p>
      <p className="waiting-sub">Share this room code:</p>
      <div className="room-code" onClick={copy}>
        <span className="room-code-text">{code}</span>
        <span className="room-code-copy">{copied ? "✓ Copied!" : "Click to copy"}</span>
      </div>
      <button className="btn btn--ghost" onClick={onCancel}>Cancel</button>
    </div>
  );
}

// ─── AI Game ──────────────────────────────────────────────
function AIGame({ difficulty, onLeave }) {
  const [squares, setSquares] = useState(Array(9).fill(null));
  const [isPlayerTurn, setIsPlayerTurn] = useState(true);
  const [scores, setScores] = useState({ X: 0, O: 0, draws: 0 });
  const [result, setResult] = useState(null);
  const [thinking, setThinking] = useState(false);
  const playerMark = "X";
  const aiMark = "O";

  const resolve = useCallback((sq) => {
    const r = checkWinner(sq);
    if (r) {
      setScores(s => ({ ...s, [r.winner]: s[r.winner] + 1 }));
      setResult(r);
      return true;
    }
    if (sq.every(Boolean)) {
      setScores(s => ({ ...s, draws: s.draws + 1 }));
      setResult({ isDraw: true, line: [] });
      return true;
    }
    return false;
  }, []);

  // AI move
  useEffect(() => {
    if (isPlayerTurn || result) return;
    setThinking(true);
    const delay = difficulty === "hard" ? 500 : 300;
    const timer = setTimeout(() => {
      setSquares(prev => {
        const next = [...prev];
        const move = getAIMove(next, aiMark, playerMark, difficulty);
        if (move === undefined) return prev;
        next[move] = aiMark;
        resolve(next);
        setIsPlayerTurn(true);
        setThinking(false);
        return next;
      });
    }, delay);
    return () => clearTimeout(timer);
  }, [isPlayerTurn, result, difficulty, resolve]);

  const handleClick = (i) => {
    if (!isPlayerTurn || squares[i] || result || thinking) return;
    const next = [...squares];
    next[i] = playerMark;
    setSquares(next);
    if (!resolve(next)) setIsPlayerTurn(false);
  };

  const reset = () => {
    setSquares(Array(9).fill(null));
    setResult(null);
    setIsPlayerTurn(true);
    setThinking(false);
  };

  const winningLine = result?.line ?? [];
  const gameActive = !result;

  let resultMsg = "";
  if (result?.isDraw) resultMsg = "It's a Draw!";
  else if (result?.winner === playerMark) resultMsg = "You Win! 🎉";
  else if (result?.winner === aiMark) resultMsg = "AI Wins!";

  const diffLabel = { easy: "🟢 Easy", medium: "🟡 Medium", hard: "🔴 Hard" }[difficulty];

  return (
    <>
      <div className="room-badge">vs AI · <strong>{diffLabel}</strong></div>
      <ScoreBoard
        scores={scores} myMark={playerMark}
        currentMark={isPlayerTurn ? playerMark : aiMark}
        gameActive={gameActive} vsAI
      />
      <div className="game-area">
        <div className={`turn-indicator ${!gameActive ? "turn-indicator--hidden" : ""}`}>
          {thinking
            ? <><div className="waiting-spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /><span>AI is thinking…</span></>
            : <><span className={`turn-dot turn-dot--${(isPlayerTurn ? playerMark : aiMark).toLowerCase()}`} /><span>{isPlayerTurn ? <strong>Your turn</strong> : "AI's turn…"}</span></>
          }
        </div>
        <div className={`board ${!gameActive ? "board--over" : ""}`}>
          {squares.map((val, i) => (
            <Square key={i} index={i} value={val}
              onClick={() => handleClick(i)}
              isWinning={winningLine.includes(i)}
              isDisabled={!!val || !isPlayerTurn || !!result || thinking}
            />
          ))}
        </div>
        {result && (
          <div className="result-overlay">
            <div className="result-card">
              <p className="result-text">{resultMsg}</p>
              <div className="result-actions">
                <button className="btn btn--primary" onClick={reset}>Play Again</button>
                <button className="btn btn--ghost" onClick={onLeave}>Leave</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ─── App ──────────────────────────────────────────────────
export default function App() {
  const socketRef = useRef(null);
  const [screen, setScreen] = useState("lobby"); // lobby | waiting | game | ai
  const [aiDifficulty, setAiDifficulty] = useState("medium");
  const [roomCode, setRoomCode] = useState("");
  const [myMark, setMyMark] = useState(null);
  const [squares, setSquares] = useState(Array(9).fill(null));
  const [isXTurn, setIsXTurn] = useState(true);
  const [scores, setScores] = useState({ X: 0, O: 0, draws: 0 });
  const [result, setResult] = useState(null);
  const [rematchRequested, setRematchRequested] = useState(false);
  const [rematchSent, setRematchSent] = useState(false);
  const [playerLeft, setPlayerLeft] = useState(false);
  const [lobbyError, setLobbyError] = useState("");
  const [connected, setConnected] = useState(false);
  const [connError, setConnError] = useState("");

  useEffect(() => {
    const socket = io(SERVER_URL, {
      transports: ["polling", "websocket"],
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      timeout: 20000,
      forceNew: true,
    });
    socketRef.current = socket;
    socket.on("connect", () => { setConnected(true); setConnError(""); });
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", (err) => { setConnected(false); setConnError(`Cannot reach server: ${err.message}`); });
    socket.on("room_created", ({ code, mark }) => { setRoomCode(code); setMyMark(mark); setScreen("waiting"); });
    socket.on("room_joined", ({ code, mark }) => { setRoomCode(code); setMyMark(mark); });
    socket.on("game_start", ({ squares, isXTurn, scores }) => {
      setSquares(squares); setIsXTurn(isXTurn); setScores(scores);
      setResult(null); setRematchRequested(false); setRematchSent(false);
      setPlayerLeft(false); setScreen("game");
    });
    socket.on("game_update", ({ squares, isXTurn, scores, result }) => {
      setSquares(squares); setIsXTurn(isXTurn); setScores(scores);
      if (result) setResult(result);
    });
    socket.on("rematch_requested", () => setRematchRequested(true));
    socket.on("player_left", () => setPlayerLeft(true));
    socket.on("error", ({ message }) => setLobbyError(message));
    return () => socket.disconnect();
  }, []);

  const handleCreate = () => { setLobbyError(""); socketRef.current.emit("create_room"); };
  const handleJoin = (code) => { setLobbyError(""); socketRef.current.emit("join_room", { code }); };
  const handlePlayAI = (difficulty) => { setAiDifficulty(difficulty); setScreen("ai"); };
  const handleMove = (index) => {
    if (!result && squares[index] === null)
      socketRef.current.emit("make_move", { code: roomCode, index });
  };
  const handleRematch = () => { setRematchSent(true); socketRef.current.emit("rematch", { code: roomCode }); };
  const handleLeave = () => {
    if (screen === "game" || screen === "waiting") {
      socketRef.current.disconnect();
      socketRef.current.connect();
    }
    setScreen("lobby"); setRoomCode(""); setMyMark(null);
    setSquares(Array(9).fill(null)); setResult(null);
    setPlayerLeft(false); setRematchRequested(false); setRematchSent(false);
    setScores({ X: 0, O: 0, draws: 0 });
  };

  const isMyTurn = myMark === (isXTurn ? "X" : "O");
  const winningLine = result?.line ?? [];
  const gameActive = !result && !playerLeft;
  const currentMark = isXTurn ? "X" : "O";
  let resultMsg = "";
  if (playerLeft) resultMsg = "Opponent disconnected";
  else if (result?.isDraw) resultMsg = "It's a Draw!";
  else if (result?.winner) resultMsg = result.winner === myMark ? "You Win! 🎉" : "You Lose";

  return (
    <div className="app">
      <div className="bg-grid" aria-hidden="true" />
      <header className="header">
        <h1 className="title">
          <span className="title-x">X</span>
          <span className="title-sep">/</span>
          <span className="title-o">O</span>
        </h1>
        <p className="subtitle">Tic · Tac · Toe</p>
        {screen === "lobby" && (
          <div className={`connection-dot ${connected ? "connection-dot--on" : "connection-dot--off"}`}>
            <span className="connection-pip" />{connected ? "Online" : connError ? "Error" : "Connecting…"}
          </div>
        )}
        {connError && screen === "lobby" && <p className="conn-error">{connError}</p>}
      </header>

      {screen === "lobby" && <Lobby onCreate={handleCreate} onJoin={handleJoin} onPlayAI={handlePlayAI} error={lobbyError} connected={connected} />}
      {screen === "waiting" && <WaitingRoom code={roomCode} onCancel={handleLeave} />}
      {screen === "ai" && <AIGame difficulty={aiDifficulty} onLeave={handleLeave} />}

      {screen === "game" && (
        <>
          <div className="room-badge">Room: <strong>{roomCode}</strong></div>
          <ScoreBoard scores={scores} myMark={myMark} currentMark={currentMark} gameActive={gameActive} />
          <div className="game-area">
            <div className={`turn-indicator ${!gameActive ? "turn-indicator--hidden" : ""}`}>
              <span className={`turn-dot turn-dot--${currentMark.toLowerCase()}`} />
              {isMyTurn ? <span><strong>Your turn</strong></span> : <span>Opponent's turn…</span>}
            </div>
            <div className={`board ${!gameActive ? "board--over" : ""}`}>
              {squares.map((val, i) => (
                <Square key={i} index={i} value={val} onClick={() => handleMove(i)}
                  isWinning={winningLine.includes(i)}
                  isDisabled={!!val || !isMyTurn || !!result || playerLeft}
                />
              ))}
            </div>
            {(result || playerLeft) && (
              <div className="result-overlay">
                <div className="result-card">
                  <p className="result-text">{resultMsg}</p>
                  {!playerLeft ? (
                    <div className="result-actions">
                      {rematchSent
                        ? <p className="waiting-label" style={{ fontSize: "0.85rem" }}>{rematchRequested ? "Starting…" : "Waiting for opponent…"}</p>
                        : <button className="btn btn--primary" onClick={handleRematch}>{rematchRequested ? "Accept Rematch" : "Request Rematch"}</button>
                      }
                      <button className="btn btn--ghost" onClick={handleLeave}>Leave</button>
                    </div>
                  ) : (
                    <button className="btn btn--primary" onClick={handleLeave}>Back to Lobby</button>
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
