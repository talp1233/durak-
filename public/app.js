const logEl = document.getElementById("log");
const roomInfoEl = document.getElementById("room-info");
const voteInfoEl = document.getElementById("vote-info");
const joinBtn = document.getElementById("join");
const startBtn = document.getElementById("start");
const addBotBtn = document.getElementById("add-bot");
const nameInput = document.getElementById("name");
const roomInput = document.getElementById("room");
const voteButtons = document.querySelectorAll(".vote");
const emojiBar = document.getElementById("emoji-bar");
const playersEl = document.getElementById("players");
const restartBtn = document.getElementById("restart");

// Legacy elements (hidden, kept for compatibility)
const gameMetaEl = document.getElementById("game-meta");
const turnTimerEl = document.getElementById("turn-timer");
const tableArea = document.getElementById("table-area");
const attackIndexSelect = document.getElementById("attack-index");
const handEl = document.getElementById("hand");

// Game view elements
const lobbyView = document.getElementById("lobby-view");
const gameView = document.getElementById("game-view");
const opponentsBar = document.getElementById("opponents-bar");
const gameInfoBar = document.getElementById("game-info-bar");
const gameTable = document.getElementById("game-table");
const actionBar = document.getElementById("action-bar");
const gameHand = document.getElementById("game-hand");

const emojis = ["😂", "😡", "😎", "😭", "👏", "🤡", "🔥", "👍", "👎"];

let socket = null;
let playerId = null;
let isHost = false;
let currentRoom = null;
let currentVote = null;
let selectedCardId = null;
let selectedAttackIndex = 0;
let timerInterval = null;

const suitSymbols = { H: "♥", D: "♦", C: "♣", S: "♠" };
const suitOrder = ["H", "D", "C", "S"];
const rankNames = {
  2: "2", 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8", 9: "9", 10: "10",
  11: "J", 12: "Q", 13: "K", 14: "A",
};

function rankLabel(rank) {
  return rankNames[rank] || String(rank);
}

function isRedSuit(suit) {
  return suit === "H" || suit === "D";
}

function log(message) {
  const time = new Date().toLocaleTimeString();
  logEl.textContent += `[${time}] ${message}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

function findPlayerName(id) {
  if (!currentRoom) return id;
  const p = currentRoom.players.find((pl) => pl.id === id);
  return p ? p.name : id;
}

// --- View switching ---

function showGameView() {
  const wasAlreadyActive = gameView.classList.contains("active");
  lobbyView.style.display = "none";
  gameView.classList.add("active");
  document.body.style.padding = "0";
  if (!wasAlreadyActive) previousHandIds = new Set();
  document.body.style.overflow = "hidden";
}

function showLobbyView() {
  gameView.classList.remove("active");
  lobbyView.style.display = "";
  document.body.style.padding = "20px";
  document.body.style.overflow = "";
}

// --- Game card element for fullscreen view ---

function createGameCard(card) {
  const el = document.createElement("div");
  const red = isRedSuit(card.suit);
  el.className = "game-card" + (red ? " red" : " black");
  el.dataset.cardId = card.id;
  const symbol = suitSymbols[card.suit];
  const rank = rankLabel(card.rank);
  el.innerHTML =
    `<span class="gc-corner-tl">${rank}<br>${symbol}</span>` +
    `<span class="gc-center-suit">${symbol}</span>` +
    `<span class="gc-corner-br">${rank}<br>${symbol}</span>`;
  return el;
}

// --- Fullscreen game rendering ---

function renderGameView(room) {
  const state = room.gameState;
  if (!state || !state.started) return;

  renderOpponents(room, state);
  renderGameInfo(state);
  renderGameTableView(state);
  renderActionBarView(state);
  renderGameHandView(state);
  startGameTimer(state);
}

function renderOpponents(room, state) {
  opponentsBar.innerHTML = "";
  const hands = state.hands || [];
  for (const h of hands) {
    if (h.playerId === playerId) continue;
    const name = findPlayerName(h.playerId);
    const isAttacker = h.playerId === state.attackerId;
    const isDefender = h.playerId === state.defenderId;
    const isActive = h.playerId === state.turn;

    const badge = document.createElement("div");
    badge.className = "opponent-badge";
    if (isAttacker) badge.classList.add("attacker");
    if (isDefender) badge.classList.add("defender");
    if (isActive) badge.classList.add("active-turn");

    badge.classList.add("anim-badge");
    let cardsHTML = '<div class="opponent-cards">';
    for (let c = 0; c < Math.min(h.count, 10); c++) {
      cardsHTML += '<div class="card-back"></div>';
    }
    cardsHTML += '</div>';
    badge.innerHTML =
      `<div class="opponent-badge-top">` +
        `<div class="opponent-avatar">${name.charAt(0).toUpperCase()}</div>` +
        `<span class="opponent-name">${name}</span>` +
        `<span class="opponent-card-count">${h.count}</span>` +
      `</div>` +
      cardsHTML;
    opponentsBar.appendChild(badge);
  }
}

function renderGameInfo(state) {
  const trumpSymbol = suitSymbols[state.trumpSuit] || state.trumpSuit;
  const trumpColor = isRedSuit(state.trumpSuit) ? "red" : "black";
  const phaseLabel = state.phase === "attack" ? "ATK" : state.phase === "defend" ? "DEF" : state.phase === "complete" ? "END" : state.phase;

  gameInfoBar.innerHTML =
    `<div class="game-info-left">` +
      `<div class="deck-indicator"><div class="deck-stack">${state.deckCount}</div></div>` +
      `<div class="trump-indicator">Trump: <span class="trump-symbol ${trumpColor}">${trumpSymbol}</span></div>` +
      `<span class="phase-label">${phaseLabel}</span>` +
    `</div>` +
    `<div class="turn-timer-game" id="game-timer"></div>`;
  gameInfoBar.classList.add("anim-fade");
}

function renderGameTableView(state) {
  gameTable.innerHTML = "";

  if (state.phase === "complete") {
    const resultEl = document.createElement("div");
    resultEl.className = "game-result anim-result";
    const loserName = state.durakLoserId ? findPlayerName(state.durakLoserId) : null;
    resultEl.innerHTML = loserName
      ? `<div class="game-result-title">🤡 ${loserName} is the Durak! 🤡</div>`
      : `<div class="game-result-title">Draw!</div>`;
    gameTable.appendChild(resultEl);
    return;
  }

  state.table.forEach((pair, index) => {
    const pairEl = document.createElement("div");
    pairEl.className = "table-pair-game anim-table-in";
    pairEl.style.animationDelay = `${index * 80}ms`;
    if (index === selectedAttackIndex) pairEl.classList.add("selected-pair");

    pairEl.appendChild(createGameCard(pair.attack));

    if (pair.defense) {
      const defEl = createGameCard(pair.defense);
      defEl.classList.add("defense-card");
      pairEl.appendChild(defEl);
    } else {
      const placeholder = document.createElement("div");
      placeholder.className = "placeholder-card";
      placeholder.textContent = "?";
      pairEl.appendChild(placeholder);
    }

    pairEl.addEventListener("click", () => {
      selectedAttackIndex = index;
      document.querySelectorAll(".table-pair-game").forEach((p) => p.classList.remove("selected-pair"));
      pairEl.classList.add("selected-pair");
    });

    gameTable.appendChild(pairEl);
  });
}

function renderActionBarView(state) {
  actionBar.innerHTML = "";

  const isAttacker = state.attackerId === playerId;
  const isDefender = state.defenderId === playerId;
  const allDefended = state.table.length > 0 && state.table.every((p) => p.defense);

  if (state.phase === "complete") {
    if (isHost) {
      const btn = document.createElement("button");
      btn.className = "action-btn success anim-btn";
      btn.textContent = "New Game";
      btn.addEventListener("click", () => send("RESTART_GAME"));
      actionBar.appendChild(btn);
    }
    return;
  }

  if (isAttacker && state.phase === "attack") {
    if (allDefended && state.table.length > 0) {
      const btn = document.createElement("button");
      btn.className = "action-btn primary anim-btn";
      btn.textContent = "Done";
      btn.addEventListener("click", () => send("GAME_ACTION", { type: "END_ATTACK" }));
      actionBar.appendChild(btn);
    }
  }

  if (isDefender) {
    const noDefensesYet = state.table.length > 0 && state.table.every((p) => !p.defense);
    const canTransfer = noDefensesYet && !state.transferOccurred && state.hands.length > 2;
    if (canTransfer) {
      const btn = document.createElement("button");
      btn.className = "action-btn primary anim-btn";
      btn.textContent = "Transfer";
      btn.addEventListener("click", () => {
        if (selectedCardId != null) {
          send("GAME_ACTION", { type: "TRANSFER", cardId: selectedCardId });
        }
      });
      actionBar.appendChild(btn);
    }
    if (state.table.length > 0) {
      const btn = document.createElement("button");
      btn.className = "action-btn danger anim-btn";
      btn.textContent = "Take";
      btn.addEventListener("click", () => send("GAME_ACTION", { type: "TAKE_CARDS" }));
      actionBar.appendChild(btn);
    }
  }
}

let previousHandIds = new Set();

function renderGameHandView(state) {
  selectedCardId = null;

  const playerHand = state.hands.find((h) => h.playerId === playerId);
  const cards = playerHand?.cards || [];

  const trumpSuit = state.trumpSuit;
  const sorted = [...cards];
  if (trumpSuit) {
    sorted.sort((a, b) => {
      const aTrump = a.suit === trumpSuit;
      const bTrump = b.suit === trumpSuit;
      if (aTrump && !bTrump) return 1;
      if (!aTrump && bTrump) return -1;
      if (a.suit !== b.suit) return suitOrder.indexOf(a.suit) - suitOrder.indexOf(b.suit);
      return a.rank - b.rank;
    });
  }

  const currentIds = new Set(sorted.map((c) => c.id));
  const newCardIds = new Set(sorted.filter((c) => !previousHandIds.has(c.id)).map((c) => c.id));

  // Compute deal origin for new card animations
  const deckEl = document.querySelector(".deck-stack");
  const handRect = gameHand.getBoundingClientRect();
  let dealDx = "-40vw";
  let dealDy = "-60vh";
  if (deckEl) {
    const deckRect = deckEl.getBoundingClientRect();
    const dx = deckRect.left - (handRect.left + handRect.width / 2);
    const dy = deckRect.top - (handRect.top + handRect.height / 2);
    dealDx = dx + "px";
    dealDy = dy + "px";
  }

  // Rebuild hand — only animate NEW cards
  gameHand.innerHTML = "";
  let newCardIndex = 0;
  sorted.forEach((card) => {
    const el = createGameCard(card);
    if (newCardIds.has(card.id)) {
      el.classList.add("anim-deal");
      el.style.setProperty("--deal-dx", dealDx);
      el.style.setProperty("--deal-dy", dealDy);
      el.style.animationDelay = `${newCardIndex * 100}ms`;
      newCardIndex++;
    }
    el.addEventListener("click", () => {
      if (selectedCardId === card.id) {
        autoPlayCard(state, card);
        return;
      }
      selectedCardId = card.id;
      document.querySelectorAll("#game-hand .game-card").forEach((c) => {
        c.classList.remove("selected", "anim-select");
      });
      el.classList.add("selected", "anim-select");
    });
    gameHand.appendChild(el);
  });

  previousHandIds = currentIds;
}

function autoPlayCard(state, card) {
  const isAttacker = state.attackerId === playerId;
  const isDefender = state.defenderId === playerId;

  if (state.phase === "attack" && isAttacker) {
    send("GAME_ACTION", { type: "PLAY_ATTACK", cardId: card.id });
  } else if (state.phase === "attack" && !isDefender) {
    // Throw-in by non-defender
    send("GAME_ACTION", { type: "PLAY_ATTACK", cardId: card.id });
  } else if (state.phase === "defend" && isDefender) {
    const noDefensesYet = state.table.length > 0 && state.table.every((p) => !p.defense);
    const canTransfer = noDefensesYet && !state.transferOccurred && state.hands.length > 2;
    const attackRanks = new Set(state.table.map((p) => p.attack.rank));
    if (canTransfer && attackRanks.has(card.rank)) {
      send("GAME_ACTION", { type: "TRANSFER", cardId: card.id });
    } else {
      const undefIdx = state.table.findIndex((p) => !p.defense);
      const atkIdx = undefIdx !== -1 ? (selectedAttackIndex != null && !state.table[selectedAttackIndex]?.defense ? selectedAttackIndex : undefIdx) : 0;
      send("GAME_ACTION", { type: "PLAY_DEFENSE", cardId: card.id, attackIndex: atkIdx });
    }
  }
  selectedCardId = null;
}

function startGameTimer(state) {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    const timerEl = document.getElementById("game-timer");
    if (!timerEl) return;
    if (state.turnDeadline) {
      const seconds = Math.max(0, Math.ceil((state.turnDeadline - Date.now()) / 1000));
      timerEl.textContent = `${seconds}s`;
      if (seconds <= 5) timerEl.style.color = "#fc8181";
      else timerEl.style.color = "#f6e05e";
    } else {
      timerEl.textContent = "";
    }
  }, 500);
}

// --- Omaha fullscreen rendering ---

function renderOmahaView(room) {
  const state = room.gameState;
  if (!state || !state.started) return;

  // Opponents
  opponentsBar.innerHTML = "";
  for (const h of state.hands || []) {
    if (h.playerId === playerId) continue;
    const name = findPlayerName(h.playerId);
    const badge = document.createElement("div");
    badge.className = "opponent-badge";
    const isWinner = state.winners?.includes(h.playerId);
    badge.innerHTML =
      `<div class="opponent-avatar">${name.charAt(0).toUpperCase()}</div>` +
      `<span class="opponent-name">${name}${isWinner ? " 👑" : ""}</span>` +
      `<span class="opponent-card-count">${h.count}</span>`;
    opponentsBar.appendChild(badge);
  }

  // Info bar
  const stageLabels = { "discard-to-turn": "Discard → Turn", "discard-to-river": "Discard → River", "showdown": "Showdown" };
  gameInfoBar.innerHTML =
    `<div class="game-info-left">` +
      `<div class="deck-indicator"><div class="deck-stack">${state.deckCount}</div></div>` +
      `<span class="phase-label">${stageLabels[state.stage] || state.stage}</span>` +
    `</div>` +
    `<div class="turn-timer-game" id="game-timer"></div>`;

  // Board cards in center
  gameTable.innerHTML = "";
  if (state.stage === "showdown" && state.winners && state.winners.length > 0) {
    const resultEl = document.createElement("div");
    resultEl.className = "game-result";
    const winnerNames = state.winners.map((id) => findPlayerName(id)).join(", ");
    resultEl.innerHTML = `<div class="game-result-title">👑 ${winnerNames} wins! 👑</div>`;
    gameTable.appendChild(resultEl);
  }
  const boardRow = document.createElement("div");
  boardRow.style.cssText = "display:flex;gap:8px;justify-content:center;flex-wrap:wrap;";
  (state.board || []).forEach((card) => {
    boardRow.appendChild(createGameCard(card));
  });
  gameTable.appendChild(boardRow);

  // Show all hands at showdown
  if (state.stage === "showdown") {
    for (const h of state.hands || []) {
      if (h.playerId === playerId) continue;
      if (!h.cards) continue;
      const row = document.createElement("div");
      row.style.cssText = "display:flex;gap:6px;justify-content:center;margin-top:12px;";
      const label = document.createElement("span");
      label.style.cssText = "color:#a0aec0;font-size:12px;align-self:center;margin-right:6px;";
      label.textContent = findPlayerName(h.playerId) + ":";
      row.appendChild(label);
      h.cards.forEach((card) => row.appendChild(createGameCard(card)));
      gameTable.appendChild(row);
    }
  }

  // Action bar
  actionBar.innerHTML = "";
  const isPending = state.pendingDiscards?.includes(playerId);
  if (state.stage === "showdown") {
    if (isHost) {
      const btn = document.createElement("button");
      btn.className = "action-btn success anim-btn";
      btn.textContent = "New Game";
      btn.addEventListener("click", () => send("RESTART_GAME"));
      actionBar.appendChild(btn);
    }
  } else if (isPending) {
    const btn = document.createElement("button");
    btn.className = "action-btn primary anim-btn";
    btn.textContent = "Discard Selected";
    btn.addEventListener("click", () => {
      if (selectedCardId != null) {
        send("GAME_ACTION", { type: "DISCARD", cardId: selectedCardId });
      }
    });
    actionBar.appendChild(btn);
  }

  // Hand
  gameHand.innerHTML = "";
  selectedCardId = null;
  const playerHand = (state.hands || []).find((h) => h.playerId === playerId);
  const cards = playerHand?.cards || [];
  cards.forEach((card) => {
    const el = createGameCard(card);
    el.addEventListener("click", () => {
      if (selectedCardId === card.id && isPending) {
        send("GAME_ACTION", { type: "DISCARD", cardId: card.id });
        return;
      }
      selectedCardId = card.id;
      document.querySelectorAll("#game-hand .game-card").forEach((c) => c.classList.remove("selected"));
      el.classList.add("selected");
    });
    gameHand.appendChild(el);
  });

  // Timer
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    const timerEl = document.getElementById("game-timer");
    if (!timerEl || !state.discardDeadlines) return;
    const myDeadline = state.discardDeadlines[playerId];
    if (myDeadline) {
      const seconds = Math.max(0, Math.ceil((myDeadline - Date.now()) / 1000));
      timerEl.textContent = `${seconds}s`;
    } else {
      timerEl.textContent = "";
    }
  }, 500);
}

// --- Lobby rendering ---

function renderPlayers(room) {
  playersEl.innerHTML = "";
  if (!room) return;
  const list = document.createElement("div");
  list.className = "player-list";
  room.players.forEach((player) => {
    const entry = document.createElement("div");
    entry.className = "player";
    const isLoser = room.gameState?.durakLoserId === player.id;
    const isWinner = room.gameState?.winners?.includes(player.id);
    const badge = isLoser ? " 🤡" : isWinner ? " 👑" : "";
    entry.textContent = `${player.name}${badge}`;
    list.appendChild(entry);
  });
  playersEl.appendChild(list);
}

// --- Main update ---

function updateRoom(room) {
  currentRoom = room;
  if (!room) {
    roomInfoEl.textContent = "Not connected.";
    voteInfoEl.textContent = "";
    renderPlayers(null);
    showLobbyView();
    return;
  }

  isHost = playerId === room.hostId;

  const gameStarted = room.gameState && room.gameState.started;

  if (gameStarted) {
    showGameView();
    if (room.gameState.mode === "6") {
      renderGameView(room);
    } else if (room.gameState.mode === "4") {
      renderOmahaView(room);
    }
  } else {
    showLobbyView();
  }

  // Always update lobby info
  const players = room.players.map((player) => player.name).join(", ");
  roomInfoEl.textContent = `Room ${room.code} · Host: ${findPlayerName(room.hostId)} · Players: ${players}`;
  voteInfoEl.textContent = `Votes: 4 = ${room.votes.votes4}/${room.playerCount}, 6 = ${room.votes.votes6}/${room.playerCount}`;

  const gameComplete = gameStarted && (room.gameState.phase === "complete" || room.gameState.stage === "showdown");
  startBtn.disabled = !isHost || room.playerCount < 2 || (gameStarted && !gameComplete);
  addBotBtn.style.display = (!gameStarted && isHost) ? "inline-block" : "none";
  restartBtn.style.display = (isHost && gameComplete) ? "inline-block" : "none";

  renderPlayers(room);
}

// --- WebSocket ---

function send(type, payload = {}) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type, payload }));
}

joinBtn.addEventListener("click", () => {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.close();
  }

  const roomCode = roomInput.value.trim();
  const name = nameInput.value.trim() || "Player";
  const storedPlayerId = localStorage.getItem("playerId");

  socket = new WebSocket(`ws://${window.location.host}`);

  socket.addEventListener("open", () => {
    send("JOIN", { name, roomCode, playerId: storedPlayerId });
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "PLAYER_JOINED") {
      playerId = message.payload.playerId;
      localStorage.setItem("playerId", playerId);
      isHost = message.payload.isHost;
      updateRoom(message.payload.room);
      log(`Joined room ${message.payload.room.code} as ${name}.`);
      return;
    }

    if (message.type === "ROOM_UPDATE") {
      log(`ROOM_UPDATE: started=${message.payload?.gameState?.started}, mode=${message.payload?.gameState?.mode}`);
      try {
        updateRoom(message.payload);
      } catch (e) {
        log(`ERROR in updateRoom: ${e.message}`);
        document.title = "ERROR: " + e.message;
      }
      return;
    }

    if (message.type === "EMOJI_EVENT") {
      const { playerId: sender, emojiCode } = message.payload;
      log(`Emoji from ${findPlayerName(sender)}: ${emojiCode}`);
      return;
    }

    if (message.type === "ERROR") {
      log(`Error: ${message.payload.message}`);
    }
  });

  socket.addEventListener("close", () => {
    log("Disconnected.");
    updateRoom(null);
  });
});

// --- Lobby buttons ---

voteButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const mode = button.dataset.mode;
    currentVote = mode;
    voteButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.mode === mode));
    send("VOTE_MODE", { mode });
  });
});

startBtn.addEventListener("click", () => {
  log("Sending START_GAME...");
  startBtn.textContent = "Starting...";
  send("START_GAME");
});

addBotBtn.addEventListener("click", () => {
  send("ADD_BOT");
});

restartBtn.addEventListener("click", () => {
  send("RESTART_GAME");
});

emojis.forEach((emoji) => {
  const button = document.createElement("button");
  button.className = "emoji";
  button.textContent = emoji;
  button.addEventListener("click", () => {
    send("EMOJI_EVENT", { emojiCode: emoji });
  });
  emojiBar.appendChild(button);
});
