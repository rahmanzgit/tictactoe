import { useState, useEffect, useCallback, useRef } from "react";
import { io } from "socket.io-client";

// Always use the secure version of the URL in production
const rawUrl = import.meta.env.VITE_SERVER_URL || `http://${window.location.hostname}:3001`;
const SERVER_URL = rawUrl.replace(/^http:\/\//, window.location.protocol === "https:" ? "https://" : "http://");

// ─── Square ───────────────────────────────────────────────
function Square({ value, onClick, isWinning, isDisabled, index }) {
  return (
    <button
      className={[
        "square",
        value ? `square--${value.toLowerCase()}` : "",
        isWinning ? "square--winning" : "",
        isDisabled ? "square--disabled" : "",
      ].join(" ")}
      onClick={onClick}
      style={{ "--i": index }}
      aria-label={value ?? `Position ${index + 1}`}
    >
      {value === "X" && (
        <svg viewBox="0 0 40 40" className="mark mark--x">
          <line x1="6" y1="6" x2="34" y2="34" strokeLinecap="round" />
          <line x1="34" y1="6" x2="6" y2="34" strokeLinecap="round" />
        </svg>
      )}
      {value === "O" && (
        <svg viewBox="0 0 40 40" className="mark mark--o">
          <circle cx="20" cy="20" r="13" fill="none" strokeLinecap="round" />
        </svg>
      )}
    </button>
  );
}

// ─── Scoreboard ───────────────────────────────────────────
function ScoreBoard({ scores, myMark, currentMark, gameActive }) {
  return (
    <div className="scoreboard">
      {["X", "O"].map((mark) => {
        const isMe = mark === myMark;
        const isActive = gameActive && mark === currentMark;
        return (
          <div key={mark} className={`score-card ${isActive ? "score-card--active" : ""}`}>
            <span className="score-label">{isMe ? `You (${mark})` : `Opponent (${mark})`}</span>
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
function Lobby({ onCreate, onJoin, error, connected }) {
  const [joinCode, setJoinCode] = useState("");
  return (
    <div className="lobby">
      {!connected && (
        <div className="lobby-connecting">
          <div className="waiting-spinner" style={{ width: 24, height: 24, borderWidth: 2 }} />
          <span>Connecting to server…</span>
        </div>
      )}
      <div className="lobby-card">
        <h2 className="lobby-title">New Game</h2>
        <p className="lobby-desc">Create a room and share the code with your opponent.</p>
        <button className="btn btn--primary btn--full" onClick={onCreate} disabled={!connected}>
          {connected ? "Create Room" : "Waiting for connection…"}
        </button>
      </div>
      <div className="lobby-divider"><span>or</span></div>
      <div className="lobby-card">
        <h2 className="lobby-title">Join Game</h2>
        <p className="lobby-desc">Enter a room code to join a friend's game.</p>
        <input
          className="code-input"
          placeholder="Enter room code…"
          value={joinCode}
          onChange={e => setJoinCode(e.target.value.toUpperCase())}
          onKeyDown={e => e.key === "Enter" && joinCode && connected && onJoin(joinCode)}
          maxLength={6}
          spellCheck={false}
          disabled={!connected}
        />
        <button
          className="btn btn--secondary btn--full"
          onClick={() => joinCode && onJoin(joinCode)}
          disabled={!joinCode || !connected}
        >Join Room</button>
      </div>
      {error && <p className="lobby-error">{error}</p>}
    </div>
  );
}

// ─── Waiting Room ─────────────────────────────────────────
function WaitingRoom({ code, onCancel }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
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

// ─── App ──────────────────────────────────────────────────
export default function App() {
  const socketRef = useRef(null);
  const [screen, setScreen] = useState("lobby");
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
      transports: ["websocket", "polling"],
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      timeout: 10000,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true); setConnError("");
      console.log("[DEBUG] Connected, socket id:", socket.id);
    });
    socket.on("disconnect", () => {
      setConnected(false);
      console.log("[DEBUG] Disconnected");
    });
    socket.on("connect_error", (err) => {
      setConnected(false);
      setConnError(`Cannot reach server: ${err.message}`);
      console.error("[DEBUG] Connection error:", err);
    });

    socket.on("room_created", ({ code, mark }) => {
      console.log("[DEBUG] room_created:", code, mark);
      setRoomCode(code); setMyMark(mark); setScreen("waiting");
    });
    socket.on("room_joined", ({ code, mark }) => {
      console.log("[DEBUG] room_joined:", code, mark);
      setRoomCode(code); setMyMark(mark);
    });
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

  const handleCreate = () => {
    setLobbyError("");
    console.log("[DEBUG] Create Room clicked");
    console.log("[DEBUG] Socket connected:", socketRef.current?.connected);
    console.log("[DEBUG] Socket id:", socketRef.current?.id);
    console.log("[DEBUG] SERVER_URL:", SERVER_URL);
    socketRef.current.emit("create_room");
    console.log("[DEBUG] create_room event emitted");
  };
  const handleJoin = (code) => {
    setLobbyError("");
    console.log("[DEBUG] Join Room clicked, code:", code);
    socketRef.current.emit("join_room", { code });
  };
  const handleMove = (index) => {
    if (!result && squares[index] === null)
      socketRef.current.emit("make_move", { code: roomCode, index });
  };
  const handleRematch = () => {
    setRematchSent(true);
    socketRef.current.emit("rematch", { code: roomCode });
  };
  const handleLeave = () => {
    socketRef.current.disconnect();
    socketRef.current.connect();
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
        <div className={`connection-dot ${connected ? "connection-dot--on" : "connection-dot--off"}`}>
          <span className="connection-pip" />{connected ? "Online" : connError ? "Error" : "Connecting…"}
        </div>
        {connError && <p className="conn-error">{connError}</p>}
      </header>

      {screen === "lobby" && <Lobby onCreate={handleCreate} onJoin={handleJoin} error={lobbyError} connected={connected} />}
      {screen === "waiting" && <WaitingRoom code={roomCode} onCancel={handleLeave} />}

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
                <Square key={i} index={i} value={val}
                  onClick={() => handleMove(i)}
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
                        ? <p className="waiting-label" style={{ fontSize: "0.85rem" }}>
                            {rematchRequested ? "Starting…" : "Waiting for opponent…"}
                          </p>
                        : <button className="btn btn--primary" onClick={handleRematch}>
                            {rematchRequested ? "Accept Rematch" : "Request Rematch"}
                          </button>
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
