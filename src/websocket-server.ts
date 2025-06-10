import WebSocket, { WebSocketServer } from 'ws';
import { GameMode, getGameMode } from '../game-mode';
import { GameModes } from '../enums/game-modes';
import { globalScene } from '../global-scene'; // Added import
import type { Battle, TurnCommand as BattleTurnCommand } from '../battle'; // Renamed to avoid conflict
import { Command } from '../enums/command';
import { BattlerIndex } from '../enums/battler-index';


// Define a basic TurnCommand interface if not already well-defined
// This is a simplified version based on potential needs.
// It might need to be adjusted based on the actual structure in battle.ts or a shared types file.
interface TurnCommand {
  command: Command;
  cursor?: number; // For move_slot or switch_slot
  // move?: any; // Placeholder for more detailed move info if needed
  // targets?: BattlerIndex[]; // Placeholder for target info
}


const PORT = 8080; // Port for the WebSocket server

export class PokerogueWebSocketServer {
    private wss: WebSocketServer;
    private client: WebSocket | null = null;
    private gameInstance: GameMode | null = null; // Or your main game controller class

    constructor(gameModeId: GameModes = GameModes.CLASSIC) {
        try {
            console.log(`Initializing game with mode: ${GameModes[gameModeId]}`);
            this.gameInstance = getGameMode(gameModeId);
            console.log('Game instance created successfully.');
        } catch (error) {
            console.error('Failed to initialize game instance:', error);
            // Depending on the desired behavior, we might want to throw the error,
            // or handle it by setting gameInstance to null or a default fallback.
            // For now, we'll let it be null and the server might not function correctly.
            this.gameInstance = null;
        }
        this.wss = new WebSocketServer({ port: PORT });
        this.initialize();
        console.log('WebSocket server started on ws://localhost:' + PORT); // Changed from template literal
    }

    private initialize() {
        this.wss.on('connection', (ws) => {
            if (this.client && this.client.readyState === WebSocket.OPEN) {
                console.log('A client is already connected. Rejecting new connection.');
                ws.terminate();
                return;
            }

            this.client = ws;
            console.log('Client connected to WebSocket server.');

            // Send initial state (placeholder)
            this.sendInitialState(ws);

            ws.on('message', (message) => {
                try {
                    const parsedMessage = JSON.parse(message.toString());
                    console.log('Received message from client:', parsedMessage);
                    this.handleClientAction(parsedMessage);
                } catch (error) {
                    console.error('Failed to parse message or handle action:', error);
                    this.sendError(ws, 'Invalid message format.');
                }
            });

            ws.on('close', () => {
                console.log('Client disconnected.');
                this.client = null;
                // Handle client disconnection, e.g., pause game, reset state
            });

            ws.on('error', (error) => {
                console.error('WebSocket error:', error);
                if (this.client === ws) {
                    this.client = null;
                }
                // Handle error, potentially clean up
            });
        });

        this.wss.on('error', (error) => {
            console.error('WebSocketServer error:', error);
            // Handle server-level errors, e.g. port in use
        });
    }

    private handleClientAction(message: any) {
        if (!this.client || this.client.readyState !== WebSocket.OPEN) {
            console.warn('No open client to handle action for.');
            return;
        }

        if (message.type === 'action') {
            // The Python client sends action_details that already contain action_type, move_slot etc.
            // So we can directly use message.action_details if it matches the expected structure
            // from _format_action in pokerogue_env.py
            const actionDetails = message.action_details; // e.g. { action_type: "move", move_slot: 0 }
            console.log('Action received:', actionDetails);

            if (!this.gameInstance) {
                console.error('Game instance not available. Cannot process action.');
                this.sendError(this.client, 'Game instance not ready.');
                return;
            }

            const battle = this.gameInstance.getCurrentBattle();

            if (!battle) {
                console.error('No active battle. Cannot process action.');
                // Potentially send an error to the client or specific state
                this.sendError(this.client, 'No active battle.');
                return;
            }
            (globalScene as any).currentBattle = battle; // Set currentBattle in globalScene
            // Link MockPokemon instances to this battle
            const gs = globalScene as any;
            if (gs.mockPlayerField) gs.mockPlayerField.forEach((p: any) => p.currentBattle = battle);
            if (gs.mockEnemyField) gs.mockEnemyField.forEach((p: any) => p.currentBattle = battle);

            // Translate actionDetails to TurnCommand
            let translatedCommand: TurnCommand | null = null;

            switch (actionDetails.action_type) {
                case 'move':
                    if (typeof actionDetails.move_slot === 'number') {
                        translatedCommand = {
                            command: Command.FIGHT,
                            cursor: actionDetails.move_slot
                        };
                    } else {
                        console.error('Invalid move action: move_slot missing or not a number.');
                        this.sendError(this.client, 'Invalid move action.');
                        return;
                    }
                    break;
                case 'switch':
                    if (typeof actionDetails.switch_slot === 'number') {
                        translatedCommand = {
                            command: Command.SWITCH,
                            cursor: actionDetails.switch_slot
                        };
                    } else {
                        console.error('Invalid switch action: switch_slot missing or not a number.');
                        this.sendError(this.client, 'Invalid switch action.');
                        return;
                    }
                    break;
                case 'flee':
                    translatedCommand = { command: Command.RUN };
                    break;
                default:
                    console.warn('Unknown action_type:', actionDetails.action_type);
                    this.sendError(this.client, `Unknown action type: ${actionDetails.action_type}`);
                    return;
            }

            if (translatedCommand) {
                // Store the command for PLAYER_1_0. This might need adjustment based on multi-player or AI control.
                // Also, ensure battle.turnCommands is initialized in the Battle class.
                // Casting to BattleTurnCommand as it's expected by the Battle class.
                // This assumes our local TurnCommand is compatible or can be assigned.
                battle.turnCommands[BattlerIndex.PLAYER_1_0] = translatedCommand as BattleTurnCommand;
                console.log(`Command for BattlerIndex.PLAYER_1_0 set:`, translatedCommand);
                console.log('Action relayed to battle object. Attempting to process turn...');

                // Process the turn using GameMode
                this.gameInstance.processPlayerTurn(battle);

                // Send state update after attempting to process the turn.
                // For now, this still sends placeholder data.
                // Ideally, sendStateUpdate would be triggered by the PhaseManager
                // or after the battle state has been verifiably updated.
                this.sendStateUpdate();

            } else {
                // If translatedCommand is null, it means an issue was already handled (error sent to client)
                // or it was an unknown action type. No further state update needed here.
            }

        } else {
            console.warn('Unknown message type:', message.type);
            this.sendError(this.client, `Unknown message type: ${message.type}`);
        }
    }

    public sendInitialState(ws: WebSocket) {
         if (ws && ws.readyState === WebSocket.OPEN) {
            if (!this.gameInstance) {
                console.error('WebSocketServer: Game instance not available. Cannot start battle for initial state.');
                this.sendError(ws, 'Game instance not ready. Cannot start game.');
                // Send a basic state without observation or with an error state
                const errorState = {
                    type: 'initial_state',
                    observation: null, // Or some error-specific observation
                    info: { message: 'Error: Game instance not available. Cannot start game.' }
                };
                ws.send(JSON.stringify(errorState));
                return;
            }

            const battle = this.gameInstance.startNewBattle();

            if (!battle) {
                console.error('WebSocketServer: Failed to start new battle. GlobalScene might be missing components.');
                this.sendError(ws, 'Critical Error: Failed to start game battle.');
                // Send a basic state without observation or with an error state
                const errorState = {
                    type: 'initial_state',
                    observation: this.getPlaceholderObservation(), // Keep sending placeholder for now
                    info: { message: 'Error: Failed to start game battle. Placeholder observation sent.' }
                };
                ws.send(JSON.stringify(errorState));
                // Depending on desired behavior, might want to close connection or prevent further interaction
                return;
            }

            console.log('WebSocketServer: Initial battle started successfully.');
            (globalScene as any).currentBattle = battle; // Set currentBattle in globalScene
            // Link MockPokemon instances to this battle
            const gsInitial = globalScene as any;
            if (gsInitial.mockPlayerField) gsInitial.mockPlayerField.forEach((p: any) => p.currentBattle = battle);
            if (gsInitial.mockEnemyField) gsInitial.mockEnemyField.forEach((p: any) => p.currentBattle = battle);

            // --- TODO: Get actual initial state from the game (battle.getObservation()) ---
            const initialState = {
                type: 'initial_state',
                observation: this.getPlaceholderObservation(), // Replace with battle.getObservation(BattlerIndex.PLAYER_1_0)
                info: { message: 'Welcome to Pokerogue RL Environment! Battle started.' }
            };
            console.log('Sending initial state to client.');
            ws.send(JSON.stringify(initialState));
        }
    }

    public sendStateUpdate() {
        if (!this.client || this.client.readyState !== WebSocket.OPEN) {
            // console.warn('No open client to send state update to.');
            return;
        }
        // --- TODO: Get actual current state, reward, terminated status from the game ---
        const gameState = {
            type: 'state_update',
            observation: this.getPlaceholderObservation(), // Replace with actual game observation
            reward: 0.1, // Replace with actual reward
            terminated: false, // Replace with actual termination status
            truncated: false,
            info: {}
        };
        console.log('Sending state update to client.');
        this.client.send(JSON.stringify(gameState));
    }

    private sendError(ws: WebSocket, errorMessage: string) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'error', message: errorMessage }));
        }
    }

    private getPlaceholderObservation(): any {
        // This structure should align with self.observation_space in pokerogue_env.py
        const MAX_POKEMON_PER_TEAM = 6;
        const MAX_MOVES_PER_POKEMON = 4;

        return {
            player_active_pokemon: {
                id: 25, // Example: Pikachu
                hp_current: [50],
                hp_max: [100],
                stats: [55, 40, 50, 50, 90], // Atk,Def,SpA,SpD,Spe
                status_conditions: [0, 0, 0, 0, 0], // Burn, Freeze, Paralysis, Poison, Sleep
                moves_pp: [15, 20, 25, 30],
                moves_max_pp: [15, 20, 25, 30],
            },
            opponent_active_pokemon: {
                id: 133, // Example: Eevee
                hp_current_ratio: [0.8],
                stats_known: [0, 0, 0, 0, 0], // Partially observable, 0 if unknown
                status_conditions: [0, 0, 0, 0, 0],
            },
            player_party: Array(MAX_POKEMON_PER_TEAM).fill(null).map((_, i) => ({
                id: i === 0 ? 25 : 0, // Active one first, rest empty/unknown
                hp_current: i === 0 ? [50] : [0],
                hp_max: i === 0 ? [100] : [1],
                status_conditions: [0, 0, 0, 0, 0],
                is_active: i === 0 ? 1 : 0,
            })),
            opponent_party_known_pokemon: Array(MAX_POKEMON_PER_TEAM).fill(null).map(() => ({
                id: 0, // 0 if unknown/not seen
                fainted: 0, // 0 = not fainted, 1 = fainted
            })),
            opponent_num_remaining: MAX_POKEMON_PER_TEAM,
            battle_state: {
                turn: [1],
                is_double_battle: 0, // 0 for false, 1 for true
            }
        };
    }

    public close() {
        console.log('Closing WebSocket server...');
        if (this.client) {
            this.client.terminate();
        }
        this.wss.close((err) => {
            if (err) {
                console.error('Error closing WebSocket server:', err);
            } else {
                console.log('WebSocket server closed successfully.');
            }
        });
    }
}
