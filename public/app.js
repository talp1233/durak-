const logEl = document.getElementById("log");
const roomInfoEl = document.getElementById("room-info");
const voteInfoEl = document.getElementById("vote-info");
const joinBtn = document.getElementById("join");
const startBtn = document.getElementById("start");
const nameInput = document.getElementById("name");
const roomInput = document.getElementById("room");
const voteButtons = document.querySelectorAll(".vote");
const emojiBar = document.getElementById("emoji-bar");
const playersEl = document.getElementById("players");
// game-state log div removed – table is rendered visually now
const handEl = document.getElementById("hand");
const gameMetaEl = document.getElementById("game-meta");
const turnTimerEl = document.getElementById("turn-timer");
const attackIndexSelect = document.getElementById("attack-index");
const attackBtn = document.getElementById("attack");
const defendBtn = document.getElementById("defend");
const discardBtn = document.getElementById("discard");
const endAttackBtn = document.getElementById("end-attack");
const takeCardsBtn = document.getElementById("take-cards");

const emojis = ["😂", "😡", "😎", "😭", "👏", "🤡", "🔥", "👍", "👎"];

let socket = null;
let playerId = null;
let isHost = false;
let currentRoom = null;
let currentVote = null;
let selectedCardId = null;
let timerInterval = null;

const suitSymbols = {
  H: "♥",
  D: "♦",
  C: "♣",
  S: "♠",
};

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

function createCardElement(card, extraClass) {
  const el = document.createElement("button");
  el.className = "card-item" + (isRedSuit(card.suit) ? " red" : " black") + (extraClass ? " " + extraClass : "");
  const symbol = suitSymbols[card.suit] || card.suit;
  const rLabel = rankLabel(card.rank);
  el.innerHTML =
    `<span class="card-corner">${rLabel}<br>${symbol}</span>` +
    `<span class="card-rank">${rLabel}</span>` +
    `<span class="card-suit">${symbol}</span>` +
    `<span class="card-corner-br">${rLabel}<br>${symbol}</span>`;
  return el;
}

const tableArea = document.getElementById("table-area");

function log(message) {
  const time = new Date().toLocaleTimeString();
  logEl.textContent += `[${time}] ${message}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

function renderHand(cards = [], trumpSuit = null) {
  handEl.innerHTML = "";
  selectedCardId = null;
  const sorted = [...cards];
  if (trumpSuit) {
    sorted.sort((a, b) => {
      const aTrump = a.suit === trumpSuit;
      const bTrump = b.suit === trumpSuit;
      if (aTrump && !bTrump) {
        return 1;
      }
      if (!aTrump && bTrump) {
        return -1;
      }
      if (a.suit !== b.suit) {
        return suitOrder.indexOf(a.suit) - suitOrder.indexOf(b.suit);
      }
      return a.rank - b.rank;
    });
  }
  sorted.forEach((card) => {
    const button = createCardElement(card);
    button.addEventListener("click", () => {
      selectedCardId = card.id;
      Array.from(handEl.children).forEach((child) => child.classList.remove("active"));
      button.classList.add("active");
    });
    handEl.appendChild(button);
  });
}

function renderTable(state) {
  tableArea.innerHTML = "";
  if (!state) return;
  if (state.mode === "6") {
    attackIndexSelect.innerHTML = "";
    state.table.forEach((pair, index) => {
      const pairEl = document.createElement("div");
      pairEl.className = "table-pair";
      pairEl.appendChild(createCardElement(pair.attack));
      if (pair.defense) {
        const defEl = createCardElement(pair.defense, "defense-card");
        pairEl.appendChild(defEl);
      } else {
        const placeholder = document.createElement("div");
        placeholder.className = "undefended";
        placeholder.textContent = "?";
        pairEl.appendChild(placeholder);
      }
      pairEl.addEventListener("click", () => {
        attackIndexSelect.value = index;
        document.querySelectorAll(".table-pair").forEach((p) => (p.style.outline = "none"));
        pairEl.style.outline = "2px solid #22d3ee";
      });
      tableArea.appendChild(pairEl);

      const option = document.createElement("option");
      option.value = index;
      const atkLabel = rankLabel(pair.attack.rank) + (suitSymbols[pair.attack.suit] || "");
      const defLabel = pair.defense ? rankLabel(pair.defense.rank) + (suitSymbols[pair.defense.suit] || "") : "?";
      option.textContent = `${index + 1}: ${atkLabel} / ${defLabel}`;
      attackIndexSelect.appendChild(option);
    });
  } else if (state.mode === "4") {
    state.board.forEach((card) => {
      const el = createCardElement(card);
      el.style.cursor = "default";
      tableArea.appendChild(el);
    });
  }
}

function findPlayerName(id) {
  if (!currentRoom) return id;
  const p = currentRoom.players.find((pl) => pl.id === id);
  return p ? p.name : id;
}

function renderGameState(state) {
  if (!state) {
    tableArea.innerHTML = "";
    gameMetaEl.innerHTML = "";
    renderHand([]);
    turnTimerEl.textContent = "";
    return;
  }
  if (state.mode === "6") {
    const trumpSymbol = suitSymbols[state.trumpSuit] || state.trumpSuit;
    const trumpColor = isRedSuit(state.trumpSuit) ? "red" : "black";
    const attackerName = findPlayerName(state.attackerId);
    const defenderName = findPlayerName(state.defenderId);
    const phaseLabel = state.phase === "attack" ? "Attack" : state.phase === "defend" ? "Defend" : state.phase === "complete" ? "Game Over" : state.phase;
    const handsInfo = state.hands.map((h) => `${findPlayerName(h.playerId)}: ${h.count}`).join(" | ");
    gameMetaEl.innerHTML =
      `<div style="margin-bottom:6px"><b>Durak</b> · ${phaseLabel} · Trump: <span class="trump-badge ${trumpColor}">${trumpSymbol}</span> · Deck: ${state.deckCount}</div>` +
      `<div style="margin-bottom:6px">Attacker: <b>${attackerName}</b> · Defender: <b>${defenderName}</b></div>` +
      `<div style="font-size:13px;color:#9ca3af">${handsInfo}</div>`;
    renderTable(state);
    const playerHand = state.hands.find((hand) => hand.playerId === playerId);
    renderHand(playerHand?.cards || [], state.trumpSuit);
  } else if (state.mode === "4") {
    gameMetaEl.innerHTML = `<div><b>Omaha 4</b> · Stage: ${state.stage}</div>`;
    renderTable(state);
    const playerHand = state.hands.find((hand) => hand.playerId === playerId);
    renderHand(playerHand?.cards || []);
  }
}

function renderPlayers(room) {
  playersEl.innerHTML = "";
  if (!room) {
    return;
  }
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

function startTimerTicker() {
  if (timerInterval) {
    clearInterval(timerInterval);
  }
  timerInterval = setInterval(() => {
    if (!currentRoom || !currentRoom.gameState) {
      turnTimerEl.textContent = "";
      return;
    }
    const state = currentRoom.gameState;
    if (state.mode === "6" && state.turnDeadline) {
      const seconds = Math.max(0, Math.ceil((state.turnDeadline - Date.now()) / 1000));
      turnTimerEl.textContent = `Turn timer: ${seconds}s`;
      return;
    }
    if (state.mode === "4" && state.discardDeadlines) {
      const myDeadline = state.discardDeadlines[playerId];
      if (myDeadline) {
        const seconds = Math.max(0, Math.ceil((myDeadline - Date.now()) / 1000));
        turnTimerEl.textContent = `Discard timer: ${seconds}s`;
      } else {
        turnTimerEl.textContent = "";
      }
      return;
    }
    turnTimerEl.textContent = "";
  }, 500);
}

function updateRoom(room) {
  currentRoom = room;
  if (!room) {
    roomInfoEl.textContent = "Not connected.";
    voteInfoEl.textContent = "";
    renderGameState(null);
    renderPlayers(null);
    return;
  }

  const players = room.players.map((player) => player.name).join(", ");
  roomInfoEl.textContent = `Room ${room.code} · Host: ${room.hostId} · Players: ${players}`;

  voteInfoEl.textContent = `Votes: 4 = ${room.votes.votes4}/${room.playerCount}, 6 = ${room.votes.votes6}/${room.playerCount}`;

  startBtn.disabled = !isHost || room.playerCount < 2 || room.gameState.started;

  renderGameState(room.gameState);
  renderPlayers(room);
  startTimerTicker();
}

function send(type, payload = {}) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }
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
      updateRoom(message.payload);
      return;
    }

    if (message.type === "START_GAME") {
      updateRoom(message.payload.room);
      return;
    }

    if (message.type === "EMOJI_EVENT") {
      const { playerId: sender, emojiCode } = message.payload;
      log(`Emoji from ${sender}: ${emojiCode}`);
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

voteButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const mode = button.dataset.mode;
    currentVote = mode;
    voteButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.mode === mode));
    send("VOTE_MODE", { mode });
  });
});

startBtn.addEventListener("click", () => {
  send("START_GAME");
});

attackBtn.addEventListener("click", () => {
  if (!selectedCardId) {
    return;
  }
  send("GAME_ACTION", { type: "PLAY_ATTACK", cardId: selectedCardId });
});

defendBtn.addEventListener("click", () => {
  if (!selectedCardId) {
    return;
  }
  const attackIndex = Number(attackIndexSelect.value);
  send("GAME_ACTION", { type: "PLAY_DEFENSE", cardId: selectedCardId, attackIndex });
});

endAttackBtn.addEventListener("click", () => {
  send("GAME_ACTION", { type: "END_ATTACK" });
});

takeCardsBtn.addEventListener("click", () => {
  send("GAME_ACTION", { type: "TAKE_CARDS" });
});

discardBtn.addEventListener("click", () => {
  if (!selectedCardId) {
    return;
  }
  send("GAME_ACTION", { type: "DISCARD", cardId: selectedCardId });
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
