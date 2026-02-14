const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const ROOM_CAPACITY = 5;
const MIN_PLAYERS_TO_START = 2;
const DEFAULT_MODE = "6";
const DISCONNECT_GRACE_MS = 60000;

const rooms = new Map();

const SUITS = ["H", "D", "C", "S"];
const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const TURN_DURATION_MS = 20000;

function createDeck() {
  const deck = [];
  let id = 0;
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ id: id++, suit, rank });
    }
  }
  return deck;
}

function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
}


function createRoom(code, hostId) {
  return {
    code,
    hostId,
    players: new Map(),
    votes: new Map(),
    createdAt: Date.now(),
    gameState: {
      started: false,
      mode: null,
    },
  };
}

function decideMode(room) {
  const totalPlayers = room.players.size;
  const votes4 = Array.from(room.votes.values()).filter((vote) => vote === "4").length;
  const votes6 = Array.from(room.votes.values()).filter((vote) => vote === "6").length;
  const majority = Math.floor(totalPlayers / 2) + 1;

  if (votes4 >= majority) {
    return "4";
  }
  if (votes6 >= majority) {
    return "6";
  }
  return DEFAULT_MODE;
}

function dealCards(deck, hand, count) {
  for (let i = 0; i < count; i += 1) {
    const card = deck.shift();
    if (!card) {
      return;
    }
    hand.push(card);
  }
}

function orderHands(room) {
  const trumpSuit = room.gameState.trumpSuit;
  for (const hand of room.gameState.hands.values()) {
    hand.sort((a, b) => {
      const aTrump = a.suit === trumpSuit;
      const bTrump = b.suit === trumpSuit;
      if (aTrump && !bTrump) {
        return 1;
      }
      if (!aTrump && bTrump) {
        return -1;
      }
      if (a.suit !== b.suit) {
        return SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit);
      }
      return a.rank - b.rank;
    });
  }
}

function startDurak(room) {
  const deck = createDeck();
  shuffle(deck);
  const trumpCard = deck[deck.length - 1];
  const trumpSuit = trumpCard.suit;
  const hands = new Map();
  const playersOrder = Array.from(room.players.keys());

  playersOrder.forEach((playerId) => {
    hands.set(playerId, []);
  });

  for (let i = 0; i < 6; i += 1) {
    for (const playerId of playersOrder) {
      dealCards(deck, hands.get(playerId), 1);
    }
  }

  room.gameState = {
    started: true,
    mode: "6",
    deck,
    trumpCard,
    trumpSuit,
    playersOrder,
    hands,
    table: [],
    discard: [],
    attackerIndex: 0,
    defenderIndex: playersOrder.length > 1 ? 1 : 0,
    phase: "attack",
    maxAttacks: Math.min(hands.get(playersOrder[1]).length, 6),
    transferOccurred: false,
    durakLoserId: null,
    turn: null,
    turnDeadline: null,
    turnTimeout: null,
  };

  orderHands(room);
  setDurakTurn(room);
}

function startOmaha(room) {
  const deck = createDeck();
  shuffle(deck);
  const hands = new Map();
  const playersOrder = Array.from(room.players.keys());
  playersOrder.forEach((playerId) => {
    hands.set(playerId, []);
  });
  for (let i = 0; i < 4; i += 1) {
    for (const playerId of playersOrder) {
      dealCards(deck, hands.get(playerId), 1);
    }
  }

  const burn = [deck.shift()];
  const board = [deck.shift(), deck.shift(), deck.shift()];

  room.gameState = {
    started: true,
    mode: "4",
    deck,
    hands,
    playersOrder,
    burn,
    board,
    stage: "discard-to-turn",
    pendingDiscards: new Set(playersOrder),
    discardDeadlines: new Map(),
    stageDeadlineInterval: null,
    winners: [],
  };

  setOmahaDeadlines(room);
}

function setDurakTurn(room) {
  const gameState = room.gameState;
  if (!gameState || gameState.mode !== "6") {
    return;
  }
  if (gameState.phase === "complete") {
    return;
  }
  if (gameState.turnTimeout) {
    clearTimeout(gameState.turnTimeout);
  }
  const activeId =
    gameState.phase === "defend"
      ? gameState.playersOrder[gameState.defenderIndex]
      : gameState.playersOrder[gameState.attackerIndex];
  gameState.turn = activeId;
  gameState.turnDeadline = Date.now() + TURN_DURATION_MS;
  gameState.turnTimeout = setTimeout(() => {
    if (gameState.phase === "defend") {
      endDurakRound(room, true);
    } else if (gameState.table.length > 0 && gameState.table.every((pair) => pair.defense)) {
      endDurakRound(room, false);
    }
    broadcastRoom(room);
  }, TURN_DURATION_MS);
}

function setOmahaDeadlines(room) {
  const gameState = room.gameState;
  if (!gameState || gameState.mode !== "4") {
    return;
  }
  if (gameState.stageDeadlineInterval) {
    clearInterval(gameState.stageDeadlineInterval);
  }
  gameState.discardDeadlines = new Map();
  for (const playerId of gameState.pendingDiscards) {
    gameState.discardDeadlines.set(playerId, Date.now() + TURN_DURATION_MS);
  }
  gameState.stageDeadlineInterval = setInterval(() => {
    const now = Date.now();
    for (const [playerId, deadline] of gameState.discardDeadlines.entries()) {
      if (deadline > now) {
        continue;
      }
      const hand = gameState.hands.get(playerId);
      if (!hand || hand.length === 0) {
        continue;
      }
      const randomCard = hand[Math.floor(Math.random() * hand.length)];
      handleOmahaAction(room, playerId, { type: "DISCARD", cardId: randomCard.id });
    }
  }, 1000);
}

function canAttack(gameState, playerId, card) {
  if (gameState.phase !== "attack") {
    return false;
  }
  const attackerId = gameState.playersOrder[gameState.attackerIndex];
  const defenderId = gameState.playersOrder[gameState.defenderIndex];
  if (playerId === defenderId) {
    return false;
  }
  if (playerId !== attackerId && gameState.table.length === 0) {
    return false;
  }
  if (gameState.table.length >= gameState.maxAttacks) {
    return false;
  }
  if (gameState.table.length === 0) {
    return true;
  }
  const ranksOnTable = new Set();
  for (const pair of gameState.table) {
    ranksOnTable.add(pair.attack.rank);
    if (pair.defense) {
      ranksOnTable.add(pair.defense.rank);
    }
  }
  return ranksOnTable.has(card.rank);
}

function canDefend(gameState, attackCard, defenseCard) {
  if (!attackCard || !defenseCard) {
    return false;
  }
  if (defenseCard.suit === attackCard.suit && defenseCard.rank > attackCard.rank) {
    return true;
  }
  if (defenseCard.suit === gameState.trumpSuit && attackCard.suit !== gameState.trumpSuit) {
    return true;
  }
  if (defenseCard.suit === gameState.trumpSuit && attackCard.suit === gameState.trumpSuit) {
    return defenseCard.rank > attackCard.rank;
  }
  return false;
}

function drawUpToSix(gameState, oldAttackerId, oldDefenderId) {
  const order = gameState.playersOrder;
  const drawOrder = [];
  const startIdx = order.indexOf(oldAttackerId);
  let idx = startIdx >= 0 ? startIdx : 0;
  for (let i = 0; i < order.length; i += 1) {
    const pid = order[idx];
    if (pid !== oldDefenderId) {
      drawOrder.push(pid);
    }
    idx = (idx + 1) % order.length;
  }
  drawOrder.push(oldDefenderId);

  for (const pid of drawOrder) {
    const hand = gameState.hands.get(pid);
    if (!hand) continue;
    while (hand.length < 6 && gameState.deck.length > 0) {
      hand.push(gameState.deck.shift());
    }
  }
}

function nextPlayerIndex(order, fromIndex, skipId) {
  let idx = (fromIndex + 1) % order.length;
  const start = idx;
  do {
    if (order[idx] !== skipId) return idx;
    idx = (idx + 1) % order.length;
  } while (idx !== start);
  return idx;
}

function endDurakRound(room, defenderTakes) {
  const gameState = room.gameState;
  const oldAttackerId = gameState.playersOrder[gameState.attackerIndex];
  const oldDefenderId = gameState.playersOrder[gameState.defenderIndex];

  if (defenderTakes) {
    const hand = gameState.hands.get(oldDefenderId);
    for (const pair of gameState.table) {
      hand.push(pair.attack);
      if (pair.defense) {
        hand.push(pair.defense);
      }
    }
  } else {
    for (const pair of gameState.table) {
      gameState.discard.push(pair.attack);
      if (pair.defense) {
        gameState.discard.push(pair.defense);
      }
    }
  }

  drawUpToSix(gameState, oldAttackerId, oldDefenderId);
  gameState.table = [];
  gameState.phase = "attack";
  gameState.transferOccurred = false;
  orderHands(room);
  pruneDurakPlayers(room, oldAttackerId, oldDefenderId, defenderTakes);
  if (gameState.phase !== "complete") {
    const defenderHand =
      gameState.hands.get(gameState.playersOrder[gameState.defenderIndex]) || [];
    gameState.maxAttacks = Math.min(defenderHand.length, 6);
    setDurakTurn(room);
  }
}

function pruneDurakPlayers(room, oldAttackerId, oldDefenderId, defenderTook) {
  const gameState = room.gameState;
  const remaining = gameState.playersOrder.filter((pid) => {
    const hand = gameState.hands.get(pid);
    return hand && hand.length > 0;
  });
  for (const pid of gameState.playersOrder) {
    const hand = gameState.hands.get(pid);
    if (!hand || hand.length === 0) {
      gameState.hands.delete(pid);
    }
  }
  gameState.playersOrder = remaining;

  if (remaining.length <= 1) {
    gameState.durakLoserId = remaining.length === 1 ? remaining[0] : null;
    gameState.phase = "complete";
    if (gameState.turnTimeout) {
      clearTimeout(gameState.turnTimeout);
    }
    return;
  }

  let newAttackerId;
  if (defenderTook) {
    const defIdx = remaining.indexOf(oldDefenderId);
    const afterDef = defIdx >= 0 ? (defIdx + 1) % remaining.length : 0;
    newAttackerId = remaining[afterDef];
  } else {
    newAttackerId = remaining.includes(oldDefenderId)
      ? oldDefenderId
      : remaining[0];
  }

  gameState.attackerIndex = remaining.indexOf(newAttackerId);
  if (gameState.attackerIndex < 0) gameState.attackerIndex = 0;
  gameState.defenderIndex = (gameState.attackerIndex + 1) % remaining.length;
}

function handleDurakAction(room, playerId, action) {
  const gameState = room.gameState;
  if (!gameState || gameState.mode !== "6") {
    return;
  }
  const hand = gameState.hands.get(playerId);
  if (!hand) {
    return;
  }

  if (action.type === "PLAY_ATTACK") {
    const card = hand.find((entry) => entry.id === action.cardId);
    if (!card || !canAttack(gameState, playerId, card)) {
      return;
    }
    gameState.table.push({ attack: card, defense: null });
    hand.splice(hand.indexOf(card), 1);
    gameState.phase = "defend";
    setDurakTurn(room);
    orderHands(room);
    return;
  }

  if (action.type === "TRANSFER") {
    const defenderId = gameState.playersOrder[gameState.defenderIndex];
    if (playerId !== defenderId) {
      return;
    }
    if (gameState.table.some((pair) => pair.defense)) {
      return;
    }
    if (gameState.playersOrder.length <= 2) {
      return;
    }
    const card = hand.find((entry) => entry.id === action.cardId);
    if (!card) {
      return;
    }
    const attackRanks = new Set(gameState.table.map((pair) => pair.attack.rank));
    if (!attackRanks.has(card.rank)) {
      return;
    }
    const newDefIdx = (gameState.defenderIndex + 1) % gameState.playersOrder.length;
    if (newDefIdx === gameState.attackerIndex) {
      return;
    }
    const newDefenderHand = gameState.hands.get(gameState.playersOrder[newDefIdx]);
    if (!newDefenderHand || newDefenderHand.length === 0) {
      return;
    }
    gameState.table.push({ attack: card, defense: null });
    hand.splice(hand.indexOf(card), 1);
    gameState.defenderIndex = newDefIdx;
    gameState.transferOccurred = true;
    gameState.maxAttacks = Math.min(gameState.maxAttacks, 5);
    gameState.phase = "defend";
    setDurakTurn(room);
    orderHands(room);
    return;
  }

  if (action.type === "PLAY_DEFENSE") {
    const defenderId = gameState.playersOrder[gameState.defenderIndex];
    if (playerId !== defenderId) {
      return;
    }
    const card = hand.find((entry) => entry.id === action.cardId);
    const target = gameState.table[action.attackIndex];
    if (!card || !target || target.defense) {
      return;
    }
    if (!canDefend(gameState, target.attack, card)) {
      return;
    }
    target.defense = card;
    hand.splice(hand.indexOf(card), 1);
    orderHands(room);
    if (gameState.table.every((pair) => pair.defense)) {
      gameState.phase = "attack";
      setDurakTurn(room);
    }
    return;
  }

  if (action.type === "END_ATTACK") {
    const attackerId = gameState.playersOrder[gameState.attackerIndex];
    if (playerId !== attackerId) {
      return;
    }
    if (gameState.table.length === 0) {
      return;
    }
    if (gameState.table.some((pair) => !pair.defense)) {
      return;
    }
    endDurakRound(room, false);
    return;
  }

  if (action.type === "TAKE_CARDS") {
    const defenderId = gameState.playersOrder[gameState.defenderIndex];
    if (playerId !== defenderId) {
      return;
    }
    if (gameState.table.length === 0) {
      return;
    }
    endDurakRound(room, true);
  }
}

function handleOmahaAction(room, playerId, action) {
  const gameState = room.gameState;
  if (!gameState || gameState.mode !== "4") {
    return;
  }
  const hand = gameState.hands.get(playerId);
  if (!hand) {
    return;
  }

  if (action.type !== "DISCARD") {
    return;
  }

  if (!gameState.pendingDiscards?.has(playerId)) {
    return;
  }
  const card = hand.find((entry) => entry.id === action.cardId);
  if (!card) {
    return;
  }
  hand.splice(hand.indexOf(card), 1);
  gameState.pendingDiscards.delete(playerId);
  gameState.discardDeadlines.delete(playerId);

  if (gameState.pendingDiscards.size === 0) {
    if (gameState.stage === "discard-to-turn") {
      gameState.burn.push(gameState.deck.shift());
      gameState.board.push(gameState.deck.shift());
      gameState.stage = "discard-to-river";
      gameState.pendingDiscards = new Set(gameState.playersOrder);
      setOmahaDeadlines(room);
      return;
    }
    if (gameState.stage === "discard-to-river") {
      gameState.burn.push(gameState.deck.shift());
      gameState.board.push(gameState.deck.shift());
      gameState.stage = "showdown";
      if (gameState.stageDeadlineInterval) {
        clearInterval(gameState.stageDeadlineInterval);
      }
      gameState.winners = evaluateOmahaWinners(gameState);
    }
  }
}

function rankHand(cards) {
  const ranks = cards.map((card) => card.rank).sort((a, b) => b - a);
  const suits = cards.map((card) => card.suit);
  const counts = new Map();
  ranks.forEach((rank) => counts.set(rank, (counts.get(rank) || 0) + 1));
  const countValues = Array.from(counts.values()).sort((a, b) => b - a);
  const uniqueRanks = Array.from(counts.keys()).sort((a, b) => b - a);

  const isFlush = suits.every((suit) => suit === suits[0]);
  const isStraight =
    new Set(ranks).size === 5 &&
    (ranks[0] - ranks[4] === 4 ||
      (ranks[0] === 14 && ranks[1] === 5 && ranks[4] === 2));

  if (isStraight && isFlush) {
    return [8, ranks[0] === 14 && ranks[1] === 5 ? 5 : ranks[0]];
  }
  if (countValues[0] === 4) {
    const fourRank = uniqueRanks.find((rank) => counts.get(rank) === 4);
    const kicker = uniqueRanks.find((rank) => counts.get(rank) === 1);
    return [7, fourRank, kicker];
  }
  if (countValues[0] === 3 && countValues[1] === 2) {
    const threeRank = uniqueRanks.find((rank) => counts.get(rank) === 3);
    const pairRank = uniqueRanks.find((rank) => counts.get(rank) === 2);
    return [6, threeRank, pairRank];
  }
  if (isFlush) {
    return [5, ...ranks];
  }
  if (isStraight) {
    return [4, ranks[0] === 14 && ranks[1] === 5 ? 5 : ranks[0]];
  }
  if (countValues[0] === 3) {
    const threeRank = uniqueRanks.find((rank) => counts.get(rank) === 3);
    const kickers = uniqueRanks.filter((rank) => counts.get(rank) === 1);
    return [3, threeRank, ...kickers];
  }
  if (countValues[0] === 2 && countValues[1] === 2) {
    const pairs = uniqueRanks.filter((rank) => counts.get(rank) === 2);
    const kicker = uniqueRanks.find((rank) => counts.get(rank) === 1);
    return [2, ...pairs, kicker];
  }
  if (countValues[0] === 2) {
    const pairRank = uniqueRanks.find((rank) => counts.get(rank) === 2);
    const kickers = uniqueRanks.filter((rank) => counts.get(rank) === 1);
    return [1, pairRank, ...kickers];
  }
  return [0, ...ranks];
}

function compareRanks(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

function combinations(arr, choose) {
  if (choose === 0) {
    return [[]];
  }
  if (arr.length < choose) {
    return [];
  }
  const [first, ...rest] = arr;
  const withFirst = combinations(rest, choose - 1).map((combo) => [first, ...combo]);
  const withoutFirst = combinations(rest, choose);
  return withFirst.concat(withoutFirst);
}

function evaluateOmahaWinners(gameState) {
  const board = gameState.board;
  const results = [];
  for (const playerId of gameState.playersOrder) {
    const hand = gameState.hands.get(playerId) || [];
    const handCombos = combinations(hand, Math.min(hand.length, 2));
    if (hand.length >= 1) handCombos.push(...combinations(hand, 1));
    handCombos.push([]);
    let bestRank = null;
    for (const h of handCombos) {
      const need = 5 - h.length;
      if (need < 0 || need > board.length) continue;
      const boardCombos = combinations(board, need);
      for (const b of boardCombos) {
        const combo = [...h, ...b];
        if (combo.length !== 5) continue;
        const rank = rankHand(combo);
        if (!bestRank || compareRanks(rank, bestRank) > 0) {
          bestRank = rank;
        }
      }
    }
    if (!bestRank) {
      const all = [...hand, ...board];
      const fallback = combinations(all, Math.min(all.length, 5));
      for (const c of fallback) {
        const rank = rankHand(c);
        if (!bestRank || compareRanks(rank, bestRank) > 0) {
          bestRank = rank;
        }
      }
    }
    results.push({ playerId, rank: bestRank || [0] });
  }
  const best = results.reduce((acc, entry) => {
    if (!acc || compareRanks(entry.rank, acc.rank) > 0) {
      return entry;
    }
    return acc;
  }, null);
  if (!best) {
    return [];
  }
  return results.filter((entry) => compareRanks(entry.rank, best.rank) === 0).map((r) => r.playerId);
}

function createRoomSnapshot(room, playerId) {
  const gameState = room.gameState;
  let viewState = null;
  if (gameState.started) {
    if (gameState.mode === "6") {
      viewState = {
        mode: "6",
        phase: gameState.phase,
        attackerId: gameState.playersOrder[gameState.attackerIndex],
        defenderId: gameState.playersOrder[gameState.defenderIndex],
        trumpSuit: gameState.trumpSuit,
        trumpCard: gameState.trumpCard,
        deckCount: gameState.deck.length,
        discardCount: gameState.discard.length,
        table: gameState.table.map((pair) => ({
          attack: pair.attack,
          defense: pair.defense,
        })),
        hands: gameState.playersOrder.map((id) => ({
          playerId: id,
          count: gameState.hands.get(id)?.length || 0,
          cards: id === playerId ? gameState.hands.get(id) : undefined,
        })),
        transferOccurred: gameState.transferOccurred,
        maxAttacks: gameState.maxAttacks,
        durakLoserId: gameState.durakLoserId,
        turn: gameState.turn,
        turnDeadline: gameState.turnDeadline,
      };
    }
    if (gameState.mode === "4") {
      viewState = {
        mode: "4",
        stage: gameState.stage,
        board: gameState.board,
        burnCount: gameState.burn.length,
        deckCount: gameState.deck.length,
        pendingDiscards: Array.from(gameState.pendingDiscards || []),
        discardDeadlines: Object.fromEntries(gameState.discardDeadlines || []),
        hands: gameState.playersOrder.map((id) => ({
          playerId: id,
          count: gameState.hands.get(id)?.length || 0,
          cards: id === playerId ? gameState.hands.get(id) : undefined,
        })),
        winners: gameState.winners,
      };
    }
  }

  return {
    code: room.code,
    hostId: room.hostId,
    playerId,
    players: Array.from(room.players.values()).map((player) => ({
      id: player.id,
      name: player.name,
    })),
    votes: {
      votes4: Array.from(room.votes.values()).filter((vote) => vote === "4").length,
      votes6: Array.from(room.votes.values()).filter((vote) => vote === "6").length,
    },
    playerCount: room.players.size,
    gameState: viewState || { started: false },
  };
}

function broadcastRoom(room) {
  for (const player of room.players.values()) {
    if (player.socket && player.socket.readyState === "open") {
      player.socket.send(
        JSON.stringify({ type: "ROOM_UPDATE", payload: createRoomSnapshot(room, player.id) })
      );
    }
  }
}

function handleJoin(socket, { name, roomCode, playerId }) {
  if (!roomCode) {
    socket.send(JSON.stringify({ type: "ERROR", payload: { message: "Room code required." } }));
    return;
  }

  let room = rooms.get(roomCode);
  const isNewRoom = !room;
  if (!room) {
    room = createRoom(roomCode, null);
    rooms.set(roomCode, room);
  }

  if (room.players.size >= ROOM_CAPACITY) {
    socket.send(JSON.stringify({ type: "ERROR", payload: { message: "Room is full." } }));
    return;
  }

  let finalPlayerId = null;
  if (playerId && room.players.has(playerId)) {
    const existingPlayer = room.players.get(playerId);
    existingPlayer.socket = socket;
    existingPlayer.name = name || existingPlayer.name;
    if (existingPlayer.disconnectTimeout) {
      clearTimeout(existingPlayer.disconnectTimeout);
      existingPlayer.disconnectTimeout = null;
    }
    finalPlayerId = playerId;
  } else {
    finalPlayerId = crypto.randomUUID();
    if (isNewRoom || !room.hostId) {
      room.hostId = finalPlayerId;
    }
    room.players.set(finalPlayerId, {
      id: finalPlayerId,
      name,
      socket,
      disconnectTimeout: null,
    });
  }

  socket.send(
    JSON.stringify({
      type: "PLAYER_JOINED",
      payload: {
        playerId: finalPlayerId,
        isHost: room.hostId === finalPlayerId,
        room: createRoomSnapshot(room, finalPlayerId),
      },
    })
  );

  broadcastRoom(room);
}

function handleVote(room, playerId, mode) {
  if (!room || !room.players.has(playerId)) {
    return;
  }
  if (room.gameState.started) {
    return;
  }
  if (mode !== "4" && mode !== "6") {
    return;
  }
  room.votes.set(playerId, mode);
  broadcastRoom(room);
}

function handleRestart(room, playerId) {
  if (!room) return;
  if (room.hostId !== playerId) return;
  if (room.gameState.turnTimeout) clearTimeout(room.gameState.turnTimeout);
  if (room.gameState.stageDeadlineInterval) clearInterval(room.gameState.stageDeadlineInterval);
  room.gameState = { started: false, mode: null };
  room.votes = new Map();
  broadcastRoom(room);
}

function handleStart(room, playerId) {
  if (!room || room.gameState.started) {
    return;
  }
  if (room.hostId !== playerId) {
    return;
  }
  if (room.players.size < MIN_PLAYERS_TO_START) {
    return;
  }

  const mode = decideMode(room);
  if (mode === "6") {
    startDurak(room);
  } else {
    startOmaha(room);
  }
  broadcastRoom(room);
}

function handleEmoji(room, playerId, emojiCode) {
  if (!room || !room.players.has(playerId)) {
    return;
  }
  for (const player of room.players.values()) {
    if (player.socket && player.socket.readyState === "open") {
      player.socket.send(
        JSON.stringify({
          type: "EMOJI_EVENT",
          payload: { playerId, emojiCode, timestamp: Date.now() },
        })
      );
    }
  }
}

function handleGameAction(room, playerId, action) {
  if (!room || !room.players.has(playerId)) {
    return;
  }
  if (!room.gameState.started) {
    return;
  }
  if (room.gameState.mode === "6") {
    handleDurakAction(room, playerId, action);
  } else {
    handleOmahaAction(room, playerId, action);
  }
  broadcastRoom(room);
}

function removePlayer(room, playerId) {
  if (!room) {
    return;
  }
  const player = room.players.get(playerId);
  if (!player) {
    return;
  }
  room.players.delete(playerId);
  room.votes.delete(playerId);

  if (room.players.size === 0) {
    rooms.delete(room.code);
    return;
  }

  if (room.hostId === playerId) {
    const [nextHost] = room.players.keys();
    room.hostId = nextHost;
  }

  broadcastRoom(room);
}

const server = http.createServer((req, res) => {
  const safePath = req.url === "/" ? "/index.html" : req.url;
  const filePath = path.join(__dirname, "public", safePath);
  if (!filePath.startsWith(path.join(__dirname, "public"))) {
    res.writeHead(404);
    res.end();
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end();
      return;
    }
    const ext = path.extname(filePath);
    const typeMap = {
      ".html": "text/html",
      ".js": "text/javascript",
      ".css": "text/css",
    };
    res.writeHead(200, { "Content-Type": typeMap[ext] || "text/plain" });
    res.end(data);
  });
});

server.on("upgrade", (req, socket) => {
  const key = req.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return;
  }
  const accept = crypto
    .createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`, "binary")
    .digest("base64");
  const headers = [
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${accept}`,
  ];
  socket.write(`${headers.join("\r\n")}\r\n\r\n`);

  const ws = {
    socket,
    readyState: "open",
    send: (data) => {
      const payload = Buffer.from(data);
      const frame = [0x81];
      if (payload.length < 126) {
        frame.push(payload.length);
      } else if (payload.length < 65536) {
        frame.push(126, (payload.length >> 8) & 255, payload.length & 255);
      } else {
        frame.push(127, 0, 0, 0, 0, (payload.length >> 24) & 255, (payload.length >> 16) & 255);
        frame.push((payload.length >> 8) & 255, payload.length & 255);
      }
      socket.write(Buffer.concat([Buffer.from(frame), payload]));
    },
  };

  let buffer = Buffer.alloc(0);
  let currentRoom = null;
  let currentPlayerId = null;

  socket.on("data", (data) => {
    buffer = Buffer.concat([buffer, data]);
    while (buffer.length >= 2) {
      const firstByte = buffer[0];
      const secondByte = buffer[1];
      const opcode = firstByte & 0x0f;
      const isMasked = (secondByte & 0x80) === 0x80;
      let payloadLength = secondByte & 0x7f;
      let offset = 2;
      if (payloadLength === 126) {
        if (buffer.length < 4) {
          return;
        }
        payloadLength = buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLength === 127) {
        if (buffer.length < 10) {
          return;
        }
        payloadLength = buffer.readUInt32BE(6);
        offset = 10;
      }
      const totalLength = offset + (isMasked ? 4 : 0) + payloadLength;
      if (buffer.length < totalLength) {
        return;
      }
      let payload = buffer.slice(offset, totalLength);
      if (isMasked) {
        const mask = buffer.slice(offset, offset + 4);
        payload = buffer.slice(offset + 4, totalLength);
        for (let i = 0; i < payload.length; i += 1) {
          payload[i] ^= mask[i % 4];
        }
      }
      buffer = buffer.slice(totalLength);

      if (opcode === 0x8) {
        ws.readyState = "closed";
        socket.end();
        removePlayer(currentRoom, currentPlayerId);
        return;
      }
      if (opcode === 0x9) {
        ws.send(Buffer.from([0x8a, 0x00]));
        continue;
      }
      if (opcode !== 0x1) {
        continue;
      }
      let message;
      try {
        message = JSON.parse(payload.toString("utf8"));
      } catch (error) {
        ws.send(JSON.stringify({ type: "ERROR", payload: { message: "Invalid JSON." } }));
        continue;
      }
      switch (message.type) {
        case "JOIN": {
          const { name, roomCode, playerId } = message.payload || {};
          handleJoin(ws, { name: name || "Player", roomCode, playerId });
          for (const room of rooms.values()) {
            const player = Array.from(room.players.values()).find((entry) => entry.socket === ws);
            if (player) {
              currentRoom = room;
              currentPlayerId = player.id;
              break;
            }
          }
          break;
        }
        case "VOTE_MODE":
          handleVote(currentRoom, currentPlayerId, message.payload?.mode);
          break;
        case "START_GAME":
          handleStart(currentRoom, currentPlayerId);
          break;
        case "RESTART_GAME":
          handleRestart(currentRoom, currentPlayerId);
          break;
        case "EMOJI_EVENT":
          handleEmoji(currentRoom, currentPlayerId, message.payload?.emojiCode);
          break;
        case "GAME_ACTION":
          handleGameAction(currentRoom, currentPlayerId, message.payload || {});
          break;
        default:
          ws.send(JSON.stringify({ type: "ERROR", payload: { message: "Unknown event." } }));
      }
    }
  });

  socket.on("close", () => {
    ws.readyState = "closed";
    if (!currentRoom || !currentPlayerId) {
      return;
    }
    const player = currentRoom.players.get(currentPlayerId);
    if (!player) {
      return;
    }
    player.socket = null;
    if (player.disconnectTimeout) {
      clearTimeout(player.disconnectTimeout);
    }
    player.disconnectTimeout = setTimeout(() => {
      removePlayer(currentRoom, currentPlayerId);
    }, DISCONNECT_GRACE_MS);
    broadcastRoom(currentRoom);
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
