# Pokerogue Gymnasium RL Environment

This document describes how to set up and use the Gymnasium reinforcement learning environment for the Pokerogue project. The environment allows an RL agent to interact with the Pokerogue game via a WebSocket connection.

## Overview

The Gymnasium environment consists of two main parts:
1.  **TypeScript Game Server:** A WebSocket server integrated into the Pokerogue game (currently using placeholder game logic) that listens for actions and sends game states.
2.  **Python Gymnasium Environment:** A Python class `PokerogueEnv` (in `pokerogue_env.py`) that implements the `gymnasium.Env` interface and communicates with the TypeScript game server.

## Prerequisites

*   **Node.js and npm:** For running the TypeScript game server. (Recommended: Node.js LTS version, though project specifies >=22.0.0)
*   **Python:** For running the Gymnasium environment and RL agents. (Recommended: Python 3.8+)
*   **Git:** For cloning the repository.

## Setup Instructions

1.  **Clone the Repository:**
    ```bash
    git clone <repository_url>
    cd <repository_directory>
    ```

2.  **Set up the TypeScript Game Server:**
    *   Install Node.js dependencies:
        ```bash
        npm install
        ```
        *(Note: If you encounter issues with `lefthook` during installation, especially in some CI/dev environments, you might need to use `npm install --ignore-scripts`)*
    *   Compile the TypeScript code (this will create a `build` directory):
        ```bash
        npm run build:tsc
        ```
        *(Note: `build:tsc` is a script added to `package.json` that runs `tsc`)*

3.  **Set up the Python Environment:**
    *   It's recommended to use a virtual environment:
        ```bash
        python -m venv .venv
        source .venv/bin/activate  # On Windows: .venv\Scripts\activate
        ```
    *   Install Python dependencies:
        ```bash
        pip install gymnasium numpy websockets
        ```

## Running the Environment

1.  **Start the TypeScript WebSocket Server:**
    Open a terminal, navigate to the repository root, and run:
    ```bash
    node build/src/run-server.js
    ```
    You should see a message like "Pokerogue WebSocket Server runner started." and "WebSocket server started on ws://localhost:8080". Keep this server running.
    *(Alternatively, if you have `ts-node` installed and configured for ES modules, you might be able to run `ts-node src/run-server.ts` directly from the root, but ensure your `tsconfig.json` and Node environment support this for ES modules.)*

2.  **Run the Python Environment:**
    Open another terminal, navigate to the repository root, activate your Python virtual environment (if used), and run the example script:
    ```bash
    python pokerogue_env.py
    ```
    This script will attempt to connect to the WebSocket server, reset the environment, take a few random actions, and print observations.

## Environment Details

*   **Action Space (`env.action_space`):**
    Currently a `gymnasium.spaces.Discrete(6)` space, representing:
    *   `0-3`: Select move (index 0 to 3 of the active Pokemon's moves).
    *   `4`: Switch Pokemon (currently defaults to switching to the first available benched Pokemon, typically slot 0).
    *   `5`: Flee battle.
    *(This is a simplified placeholder. Future development should expand this to a `gymnasium.spaces.Dict` space to allow choosing specific moves by ID, selecting specific targets in double battles, and choosing specific Pokemon to switch to from the party.)*

*   **Observation Space (`env.observation_space`):**
    A `gymnasium.spaces.Dict` space containing detailed information about the battle state. Key components (as per `pokerogue_env.py` and server placeholders) include:
    *   `player_active_pokemon`: Details of the player's active Pokemon (ID, HP current/max, stats, status conditions, move PPs).
    *   `opponent_active_pokemon`: Details of the opponent's active Pokemon (ID, HP ratio, known stats, status conditions).
    *   `player_party`: A tuple representing each Pokemon in the player's party (ID, HP current/max, status conditions, active status).
    *   `opponent_party_known_pokemon`: A tuple for known opponent party members (ID, fainted status).
    *   `opponent_num_remaining`: Number of opponent Pokemon remaining.
    *   `battle_state`: General battle information (turn count, double battle status).
    *(Refer to the `__init__` method in `pokerogue_env.py` for the exact structure, including `Box`, `Discrete`, and `MultiBinary` space definitions for each field. The actual data sent by the server should match this structure.)*

*   **Reward System:**
    The reward system is currently placeholder (e.g., `reward = 0.1` from the server for taking steps). This will need to be significantly developed. Rewards should be calculated based on meaningful game events (e.g., winning/losing battles, fainting an opponent's Pokemon, damage dealt/taken, status conditions applied/received) and sent by the game server as part of the state update.

## Development Notes

*   **Game Logic Integration:** The TypeScript `PokerogueWebSocketServer` (`src/websocket-server.ts`) currently uses placeholder logic for game state updates via its `getPlaceholderObservation()` method. The core task for making a functional RL environment is to modify `handleClientAction()`:
    1.  Take the `actionDetails` received from the Python client.
    2.  Interface with the actual Pokerogue game engine (e.g., `src/battle.ts`, `src/game-mode.ts`) to apply this action to the current game state.
    3.  After the game state updates, extract the true, new game state.
    4.  Calculate a meaningful reward based on the outcome of the action and the new state.
    5.  Determine if the episode has terminated (e.g., player won/lost) or truncated.
    6.  Send this comprehensive update (new observation, reward, terminated, truncated, info) back to the Python client via `sendStateUpdate()`.
*   **Python Environment (`pokerogue_env.py`):**
    *   **Action Space:** As mentioned, the `action_space` may need to become a `gymnasium.spaces.Dict` for more granular control. The `_format_action()` method would then need to translate this dictionary action into the appropriate JSON structure for the server.
    *   **Observation Parsing:** `_parse_observation()` needs to be kept in sync with the data structure sent by the server.
    *   **Reward Handling:** `_process_game_message()` will simply use the reward value sent by the server.
*   **Current Limitations:**
    *   **Placeholder Game Logic:** The game server does not yet implement actual game mechanics in response to agent actions. All interactions currently use placeholder state transitions.
    *   **Simplified Actions:** The current action space is basic and doesn't cover all possible in-game decisions.
    *   **Basic Rewards:** Rewards are not yet tied to meaningful game events.

## Troubleshooting

*   **Connection Refused (Python Client):** Ensure the TypeScript server (`node build/src/run-server.js`) is running and listening on `ws://localhost:8080`. Check for any firewall issues.
*   **TypeScript Compilation Errors (`npm run build:tsc`):**
    *   Ensure all dependencies in `package.json` are installed (`npm install`).
    *   Check `tsconfig.json` for correct settings (e.g., `"noEmit": false`, correct `outDir`).
    *   Look for syntax errors in your `.ts` files. The error `TS1160: Unterminated template literal` can sometimes be misleading if there's a syntax error earlier in the file.
*   **Module Not Found (Node.js Server - e.g., `Error [ERR_MODULE_NOT_FOUND]`):**
    *   Ensure TypeScript has been compiled successfully to JavaScript in the `build` directory (or your `outDir`).
    *   If using ES Modules (`"type": "module"` in `package.json`), ensure relative imports in your `.ts` files include the `.js` extension (e.g., `import { MyClass } from './my-module.js';`). `tsc` might not add these automatically.
*   **Python Script Errors:**
    *   `AttributeError: 'ClientConnection' object has no attribute 'open'/'closed'`: This indicates an incorrect attempt to check the WebSocket connection status directly on the connection object from the main Python thread. Connection status should be managed within the `WebSocketClientThread` or by handling exceptions from `send`/`recv` operations. The check in `PokerogueEnv.step()` should primarily rely on `self.websocket_thread.websocket is None`.
    *   `ValueError: The truth value of an array with more than one element is ambiguous...`: This occurs when a NumPy array is used in a boolean context (e.g., `if numpy_array:` or `if array1 == array2:` when `array1` and `array2` are complex objects/dicts containing arrays). Use `.any()` or `.all()` if appropriate, or compare elements specifically, or use flags/status fields from `info` dictionaries.

```
