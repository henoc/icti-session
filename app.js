const COLS = 10;
const ROWS = 20;
const BLOCK = 30;
const SESSION_SECONDS = 20 * 60;
const RECALL_SECONDS = 10;

const COLORS = {
  I: "#4cc9f0",
  J: "#5e7ce2",
  L: "#f59f47",
  O: "#f6d55c",
  S: "#48c4a3",
  T: "#b56fe8",
  Z: "#e85b64"
};

const SHAPES = {
  I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
  J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
  L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
  O: [[1, 1], [1, 1]],
  S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
  T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
  Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]]
};

const views = {
  recall: document.getElementById("recallView"),
  rating: document.getElementById("ratingView"),
  game: document.getElementById("gameView"),
  done: document.getElementById("doneView")
};

const boardCanvas = document.getElementById("board");
const boardCtx = boardCanvas.getContext("2d");
const nextCanvas = document.getElementById("next");
const nextCtx = nextCanvas.getContext("2d");

const state = {
  step: "recall",
  rating: null,
  board: createBoard(),
  piece: null,
  nextPiece: null,
  score: 0,
  lines: 0,
  restarts: 0,
  dropCounter: 0,
  dropInterval: 820,
  lastTime: 0,
  running: false,
  paused: false,
  finished: false,
  sessionRemaining: SESSION_SECONDS,
  sessionStartedAt: null,
  timerId: null,
  recallId: null
};

function createBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(""));
}

function setView(step) {
  state.step = step;
  Object.entries(views).forEach(([name, el]) => el.classList.toggle("active", name === step));
  document.querySelectorAll("[data-step-dot]").forEach((dot) => {
    dot.classList.toggle("active", dot.dataset.stepDot === step);
  });
}

function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = Math.max(0, totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function startRecallCountdown() {
  clearInterval(state.recallId);
  let remaining = RECALL_SECONDS;
  document.getElementById("recallClock").textContent = formatTime(remaining);
  state.recallId = setInterval(() => {
    remaining -= 1;
    document.getElementById("recallClock").textContent = formatTime(remaining);
    if (remaining <= 0) {
      clearInterval(state.recallId);
      setView("rating");
    }
  }, 1000);
}

function choosePiece() {
  const keys = Object.keys(SHAPES);
  const type = keys[Math.floor(Math.random() * keys.length)];
  return {
    type,
    matrix: SHAPES[type].map((row) => row.slice()),
    x: Math.floor(COLS / 2) - 2,
    y: 0
  };
}

function resetGame() {
  state.board = createBoard();
  state.piece = choosePiece();
  state.nextPiece = choosePiece();
  state.score = 0;
  state.lines = 0;
  state.restarts = 0;
  state.dropCounter = 0;
  state.dropInterval = 820;
  state.lastTime = 0;
  state.running = true;
  state.paused = false;
  state.finished = false;
  state.sessionRemaining = SESSION_SECONDS;
  state.sessionStartedAt = Date.now();
  updateStats();
  draw();
}

function rotate(matrix) {
  return matrix[0].map((_, index) => matrix.map((row) => row[index]).reverse());
}

function collides(piece, offsetX = 0, offsetY = 0, matrix = piece.matrix) {
  for (let y = 0; y < matrix.length; y += 1) {
    for (let x = 0; x < matrix[y].length; x += 1) {
      if (!matrix[y][x]) continue;
      const nextX = piece.x + x + offsetX;
      const nextY = piece.y + y + offsetY;
      if (nextX < 0 || nextX >= COLS || nextY >= ROWS) return true;
      if (nextY >= 0 && state.board[nextY][nextX]) return true;
    }
  }
  return false;
}

function mergePiece() {
  state.piece.matrix.forEach((row, y) => {
    row.forEach((value, x) => {
      if (value && state.piece.y + y >= 0) {
        state.board[state.piece.y + y][state.piece.x + x] = state.piece.type;
      }
    });
  });
}

function clearLines() {
  let cleared = 0;
  outer: for (let y = ROWS - 1; y >= 0; y -= 1) {
    for (let x = 0; x < COLS; x += 1) {
      if (!state.board[y][x]) continue outer;
    }
    state.board.splice(y, 1);
    state.board.unshift(Array(COLS).fill(""));
    cleared += 1;
    y += 1;
  }
  if (cleared) {
    state.lines += cleared;
    state.score += [0, 100, 300, 500, 800][cleared] || cleared * 250;
    state.dropInterval = Math.max(180, state.dropInterval - cleared * 16);
  }
}

function spawnPiece() {
  state.piece = state.nextPiece;
  state.piece.x = Math.floor(COLS / 2) - 2;
  state.piece.y = 0;
  state.nextPiece = choosePiece();
  if (collides(state.piece)) {
    restartBoard();
  }
}

function restartBoard() {
  state.board = createBoard();
  state.piece = choosePiece();
  state.nextPiece = choosePiece();
  state.dropCounter = 0;
  state.dropInterval = 820;
  state.restarts += 1;
  updateStats();
  draw();
}

function hardDrop() {
  if (!state.running || state.paused) return;
  while (!collides(state.piece, 0, 1)) {
    state.piece.y += 1;
    state.score += 1;
  }
  dropPiece();
}

function dropPiece() {
  if (!collides(state.piece, 0, 1)) {
    state.piece.y += 1;
    return;
  }
  mergePiece();
  clearLines();
  spawnPiece();
  updateStats();
}

function movePiece(direction) {
  if (!state.running || state.paused) return;
  if (!collides(state.piece, direction, 0)) {
    state.piece.x += direction;
    draw();
  }
}

function rotatePiece() {
  if (!state.running || state.paused) return;
  const rotated = rotate(state.piece.matrix);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collides(state.piece, kick, 0, rotated)) {
      state.piece.x += kick;
      state.piece.matrix = rotated;
      draw();
      return;
    }
  }
}

function drawCell(ctx, x, y, color, size = BLOCK) {
  ctx.fillStyle = color;
  ctx.fillRect(x * size, y * size, size, size);
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 2;
  ctx.strokeRect(x * size + 1, y * size + 1, size - 2, size - 2);
}

function drawMatrix(ctx, matrix, offsetX, offsetY, type, size = BLOCK) {
  matrix.forEach((row, y) => {
    row.forEach((value, x) => {
      if (value) drawCell(ctx, x + offsetX, y + offsetY, COLORS[type], size);
    });
  });
}

function draw() {
  boardCtx.clearRect(0, 0, boardCanvas.width, boardCanvas.height);
  boardCtx.fillStyle = "#111";
  boardCtx.fillRect(0, 0, boardCanvas.width, boardCanvas.height);
  boardCtx.strokeStyle = "rgba(255,255,255,0.06)";
  boardCtx.lineWidth = 1;
  for (let x = 1; x < COLS; x += 1) {
    boardCtx.beginPath();
    boardCtx.moveTo(x * BLOCK, 0);
    boardCtx.lineTo(x * BLOCK, boardCanvas.height);
    boardCtx.stroke();
  }
  for (let y = 1; y < ROWS; y += 1) {
    boardCtx.beginPath();
    boardCtx.moveTo(0, y * BLOCK);
    boardCtx.lineTo(boardCanvas.width, y * BLOCK);
    boardCtx.stroke();
  }
  state.board.forEach((row, y) => {
    row.forEach((type, x) => {
      if (type) drawCell(boardCtx, x, y, COLORS[type]);
    });
  });
  if (state.piece) drawMatrix(boardCtx, state.piece.matrix, state.piece.x, state.piece.y, state.piece.type);
  drawNext();
}

function drawNext() {
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  nextCtx.fillStyle = "#1a1c1d";
  nextCtx.fillRect(0, 0, nextCanvas.width, nextCanvas.height);
  if (!state.nextPiece) return;
  const size = 22;
  const matrix = state.nextPiece.matrix;
  const offsetX = Math.max(0, Math.floor((4 - matrix.length) / 2));
  const offsetY = Math.max(0, Math.floor((4 - matrix.length) / 2));
  drawMatrix(nextCtx, matrix, offsetX, offsetY, state.nextPiece.type, size);
}

function updateStats() {
  document.getElementById("score").textContent = state.score.toString();
  document.getElementById("lines").textContent = state.lines.toString();
  document.getElementById("restarts").textContent = state.restarts.toString();
  document.getElementById("sessionTimer").textContent = formatTime(state.sessionRemaining);
  document.getElementById("mobileTimer").textContent = formatTime(state.sessionRemaining);
  document.getElementById("mobileScore").textContent = state.score.toString();
  document.getElementById("mobileRestarts").textContent = state.restarts.toString();
}

function loop(time = 0) {
  if (!state.running || state.finished) return;
  const delta = time - state.lastTime;
  state.lastTime = time;
  if (!state.paused) {
    state.dropCounter += delta;
    if (state.dropCounter > state.dropInterval) {
      dropPiece();
      state.dropCounter = 0;
    }
    draw();
  }
  requestAnimationFrame(loop);
}

function startSessionTimer() {
  clearInterval(state.timerId);
  state.timerId = setInterval(() => {
    if (state.paused || state.finished) return;
    state.sessionRemaining -= 1;
    updateStats();
    if (state.sessionRemaining <= 0) finishSession();
  }, 1000);
}

function finishSession() {
  if (state.finished) return;
  state.finished = true;
  state.running = false;
  clearInterval(state.timerId);
  const duration = state.sessionStartedAt ? Math.round((Date.now() - state.sessionStartedAt) / 1000) : 0;
  const record = {
    date: new Date().toISOString(),
    rating: state.rating,
    duration,
    score: state.score,
    lines: state.lines,
    restarts: state.restarts
  };
  const records = JSON.parse(localStorage.getItem("ictiSessions") || "[]");
  records.unshift(record);
  localStorage.setItem("ictiSessions", JSON.stringify(records.slice(0, 20)));
  document.getElementById("summaryRating").textContent = state.rating || "-";
  document.getElementById("summaryDuration").textContent = formatTime(duration);
  document.getElementById("summaryScore").textContent = state.score.toString();
  document.getElementById("pauseOverlay").classList.add("hidden");
  setView("done");
}

function startGame() {
  resetGame();
  setView("game");
  startSessionTimer();
  requestAnimationFrame(loop);
}

function fullReset() {
  clearInterval(state.timerId);
  clearInterval(state.recallId);
  state.running = false;
  state.paused = false;
  state.finished = true;
  state.rating = null;
  document.querySelectorAll(".rating-btn").forEach((btn) => btn.classList.remove("selected"));
  document.getElementById("startGameBtn").disabled = true;
  document.getElementById("pauseBtn").textContent = "Ⅱ 一時停止";
  document.getElementById("recallClock").textContent = formatTime(RECALL_SECONDS);
  document.getElementById("pauseOverlay").classList.add("hidden");
  setView("recall");
}

document.getElementById("beginRecallBtn").addEventListener("click", startRecallCountdown);
document.getElementById("skipRecallBtn").addEventListener("click", () => setView("rating"));
document.getElementById("startGameBtn").addEventListener("click", startGame);
document.getElementById("finishBtn").addEventListener("click", finishSession);
document.getElementById("newSessionBtn").addEventListener("click", fullReset);
document.getElementById("resetBtn").addEventListener("click", fullReset);

document.getElementById("pauseBtn").addEventListener("click", () => {
  if (!state.running) return;
  state.paused = !state.paused;
  document.getElementById("pauseBtn").textContent = state.paused ? "▶ 再開" : "Ⅱ 一時停止";
  document.getElementById("pauseOverlay").classList.toggle("hidden", !state.paused);
});

document.querySelectorAll(".rating-btn").forEach((button) => {
  button.addEventListener("click", () => {
    state.rating = Number(button.dataset.rating);
    document.querySelectorAll(".rating-btn").forEach((btn) => btn.classList.remove("selected"));
    button.classList.add("selected");
    document.getElementById("startGameBtn").disabled = false;
  });
});

document.querySelectorAll("[data-control]").forEach((button) => {
  button.addEventListener("click", () => {
    if (!state.running || state.paused) return;
    const action = button.dataset.control;
    if (action === "left") movePiece(-1);
    if (action === "right") movePiece(1);
    if (action === "down") dropPiece();
    if (action === "rotate") rotatePiece();
    if (action === "drop") hardDrop();
    updateStats();
    draw();
  });
});

document.addEventListener("keydown", (event) => {
  if (state.step !== "game") return;
  if (["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp", " "].includes(event.key)) {
    event.preventDefault();
  }
  if (!state.running || state.paused) return;
  if (event.key === "ArrowLeft") movePiece(-1);
  if (event.key === "ArrowRight") movePiece(1);
  if (event.key === "ArrowDown") dropPiece();
  if (event.key === "ArrowUp") rotatePiece();
  if (event.key === " ") hardDrop();
  updateStats();
});

draw();
