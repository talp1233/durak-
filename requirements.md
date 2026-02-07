# Durak- Online Requirements

This document captures the lobby rules, game-mode voting, and mode-specific gameplay requirements for the Durak/Omaha Custom online app.

## Lobby / Room Rules (Online)

- **Room capacity**: up to **5 players**.
- **Start condition**: game can start from **2 players**.
- **Start control**: only the **Host** can press **Start** (no auto-start for now).
- **Mode lock**: once **Start** is pressed, the selected mode is locked and the game session is created with that mode.

## Game Mode Voting (Lobby)

During the lobby (before Start), the bottom of the screen shows two toggles/buttons:

- **"4"** → Omaha (Custom)
- **"6"** → Durak

### Voting Rules

- Each player has **one vote**.
- Players can **change their vote** until the game starts.
- Live counters are shown:
  - `votes4 / playersInRoom`
  - `votes6 / playersInRoom`

### Decision Rule (Strict Majority > 50%)

- If **more than 50%** of players vote **4**, start **Omaha Custom**.
- If **more than 50%** of players vote **6**, start **Durak**.
- **If no majority**:
  - Default to **Durak (6)** (current fixed default).

**Examples**:
- 5 players → need **3 votes** to win.
- 3 players → need **2 votes**.
- 2 players → need **2 votes** (unanimous).

---

## Mode A: Durak (6) — Full Deck (52)

### Core Rules

- **Deck**: 52 cards (2–A)
- **Players**: 2–6
- **Trump**: reveal one card at game start → its suit is trump for the whole game.
- **Card order**: 2 < 3 < 4 < 5 < 6 < 7 < 8 < 9 < 10 < J < Q < K < A

### Deal

- Each player is dealt **6 cards**.
- Remaining deck is stock until empty.

### Roles per Round

- **Attacker** and **Defender**
- With **3+ players**, all non-defenders can **throw in**.

### Attack Rules

- Attacker starts with 1 card.
- Additional attack cards are allowed **only if their rank appears on the table**.
- Max attack cards:
  - not more than defender’s **hand size at start of fight**
  - not more than **6**

### Defense Rules

Each attack card must be covered with one defense card:

- **Same suit + higher rank**, or
- **Trump** (if attack card is not trump)

Trump can only be covered by **higher trump**.

### Failure to Defend

If defender cannot cover all cards:

- Defender **takes all table cards** into hand.
- Defender **does not attack** next round.
- **Next attacker** is the next player clockwise.

### Successful Defense

If all cards are covered:

- All table cards go to discard.
- Defender becomes **next attacker**.

### Drawing from Stock

After each fight:

1. Attacker draws up to 6.
2. Other throw-in players (clockwise).
3. Defender draws last.

When deck is empty, continue without draws.

### Endgame

- Players who have **no cards** leave the game.
- The **last player with cards** is the **Durak**.

---

## Mode A UI/UX — Critical Hand Sorting

The user’s hand must always be sorted as follows:

1. **All trump cards** are placed on the **right** side of the hand.
2. Non-trump cards are sorted on the left:
   - by **suit first**
   - then by **ascending rank**

Sorting must happen:

- After **deal**
- After **draw**
- After **taking**

Example:

```
[♣3][♣K][♦5][♥9] | [♠2][♠A]
                         ↑
                    trumps on right
```

---

## Server Logic (Authoritative)

- Server validates **all moves**; client never decides legality.
- Server must maintain:
  - turn state
  - hands
  - table cards
  - trump
- Reconnects return **full game state**.

---

## Online Room Requirements

- **Private rooms** with short code (4–6 chars).
- **Join** by code.
- **Minimum 2 players** to start.
- Host can:
  - **Start** game
  - **Close** room

---

## Emoji Reactions (Realtime)

### UX

- Fixed emoji button near hand/avatar.
- Tap opens small popup with emojis:

```
😂 😡 😎 😭 👏 🤡 🔥 👍 👎
```

- Emoji displays above player avatar for **1.5–2 seconds**.
- Must **not** block the table.

### Backend Event

Emoji is a realtime event (no persistence):

- `playerId`
- `emojiCode`
- `timestamp`

---

## Mode B: Omaha 4 (Custom)

### Deck / Players

- **Deck**: 52 cards
- **Players**: 2–5
- No betting or chips at this stage.

### Street Flow (Strict)

**Preflop**

- Each player gets **4 hole cards**.

**Burn + Flop**

- Burn 1 card.
- Flop: **3 community cards**.

**Discard to Turn**

- Each player **discards 1 card** from their 4 (secretly).
- Player now holds **3 cards**.
- Optional timer (15–30s); if no choice, system discards a **random card**.
- Burn 1 card.
- Turn: **1 community card** (total 4 on board).

**Discard to River**

- Each player discards **1 card** from their 3 (secretly).
- Player now holds **2 cards**.
- Burn 1 card.
- River: **1 community card** (total 5 on board).

**Showdown**

- All players reveal their **2 remaining cards**.

### Winner Determination (Fixed)

- Best **5-card poker hand** using:
  - 5 community cards
  - 0, 1, or 2 of the player’s remaining 2 cards
- This matches **Texas Hold’em** style selection (not true Omaha).

### Ties

- If hand ranks are equal → **Tie** (no tiebreaker in MVP).

---

## Omaha UI/UX Requirements

- During discard, each player only sees their own hand, selects a card, and confirms.
- After confirmation, the card is removed from the hand.
- On showdown, display:
  - The full **5-card board**
  - Each player’s **2 remaining cards**

---

## Server Events (Lobby + Omaha Custom)

The server must validate all events.

### Lobby

- `PLAYER_JOIN`
- `PLAYER_LEAVE`
- `VOTE_MODE (4|6)`
- `START_GAME`

### Omaha Custom

- `DEAL_4`
- `BURN`
- `FLOP`
- `DISCARD_REQUEST (count=1)`
- `DISCARD_SUBMIT (cardId)`
- `TURN`
- `DISCARD_REQUEST (count=1)`
- `RIVER`
- `SHOWDOWN`
