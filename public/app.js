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
const gameStateEl = document.getElementById("game-state");
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
    const button = document.createElement("button");
    button.className = "card-item";
    const symbol = suitSymbols[card.suit] || card.suit;
    button.textContent = `${card.rank}${symbol}`;
    if (card.suit === "H" || card.suit === "D") {
      button.classList.add("red");
    }
    button.addEventListener("click", () => {
      selectedCardId = card.id;
      Array.from(handEl.children).forEach((child) => child.classList.remove("active"));
      button.classList.add("active");
    });
    handEl.appendChild(button);
  });
}

function renderGameState(state) {
  if (!state) {
    gameStateEl.textContent = "No game started.";
    gameMetaEl.textContent = "";
    renderHand([]);
    turnTimerEl.textContent = "";
    return;
  }
  gameStateEl.textContent = JSON.stringify(state, null, 2);
  attackIndexSelect.innerHTML = "";
  if (state.mode === "6") {
    gameMetaEl.textContent = `Durak · Phase: ${state.phase} · Trump: ${state.trumpSuit}`;
    state.table.forEach((pair, index) => {
      const option = document.createElement("option");
      const defenseLabel = pair.defense
        ? `${pair.defense.rank}${suitSymbols[pair.defense.suit] || pair.defense.suit}`
        : "—";
      option.value = index;
      option.textContent = `Attack ${index + 1}: ${pair.attack.rank}${
        suitSymbols[pair.attack.suit] || pair.attack.suit
      } / ${defenseLabel}`;
      attackIndexSelect.appendChild(option);
    });
    const playerHand = state.hands.find((hand) => hand.playerId === playerId);
    renderHand(playerHand?.cards || [], state.trumpSuit);
  } else if (state.mode === "4") {
    gameMetaEl.textContent = `Omaha 4 · Stage: ${state.stage} · Board: ${state.board
      .map((card) => `${card.rank}${suitSymbols[card.suit] || card.suit}`)
      .join(" ")}`;
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
