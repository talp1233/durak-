# Durak Online Lobby (Minimal)

This repo contains a working lobby + game-mode voting server with basic Durak and Omaha Custom game logic.

## What Works

- Room capacity (max 5 players).
- Host-only start.
- Voting for mode `4` (Omaha Custom) or `6` (Durak) with strict majority > 50%.
- Default to Durak when no majority exists.
- Live room updates, emoji events, and in-game state updates.
- Durak attack/defense/take/end-round flow with deck/trump handling and a 20s turn timer.
- Omaha Custom deal + two discard rounds + board progression to showdown with auto-discard on timeout.
- UI indicators for Durak loser (clown hat) and Omaha winners (crown).

## Run Locally

1. Start the server:

```bash
node server.js
```

2. Open the lobby UI:

Visit `http://localhost:3000` in multiple tabs to simulate players.

## Event Types (WebSocket)

- `JOIN` `{ name, roomCode, playerId? }`
- `VOTE_MODE` `{ mode: "4" | "6" }`
- `START_GAME`
- `EMOJI_EVENT` `{ emojiCode }`
- `GAME_ACTION` `{ type, ... }`

Server responses:

- `PLAYER_JOINED` `{ playerId, isHost, room }`
- `ROOM_UPDATE` `{ room }`
- `START_GAME` `{ room }`
- `EMOJI_EVENT` `{ playerId, emojiCode, timestamp }`
- `ERROR` `{ message }`

## Notes

Game actions include:

- Durak: `PLAY_ATTACK`, `PLAY_DEFENSE`, `END_ATTACK`, `TAKE_CARDS`
- Omaha: `DISCARD`

## Reconnect

If a client reconnects within 60 seconds, pass the previous `playerId` in the `JOIN` payload to resume the same seat and hand.
