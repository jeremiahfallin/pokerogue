import WebSocket, { WebSocketServer } from 'ws';
// import { Battle } from './battle'; // Assuming Battle class handles game logic
// import { GameMode } from './game-mode'; // Assuming GameMode manages overall game flow

const PORT = 8080; // Port for the WebSocket server

export class PokerogueWebSocketServer {
    private wss: WebSocketServer;
    private client: WebSocket | null = null;
    // private gameInstance: GameMode | null = null; // Or your main game controller class

    constructor(/* game: GameMode */) {
        // this.gameInstance = game;
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
            const actionDetails = message.action_details;
            console.log('Action received:', actionDetails); // Corrected line

            // --- TODO: Integrate with actual game logic ---
            // Example: this.gameInstance.handleRlAction(actionDetails.action_type, actionDetails);
            // After processing the action in the game, the game should trigger sending an updated state.
            // For now, we'll send a placeholder state update back.

            // Simulate game processing delay and send state update
            setTimeout(() => {
                this.sendStateUpdate();
            }, 500); // Simulate 0.5s processing time

        } else {
            console.warn('Unknown message type:', message.type);
            this.sendError(this.client, `Unknown message type: ${message.type}`);
        }
    }

    public sendInitialState(ws: WebSocket) {
         if (ws && ws.readyState === WebSocket.OPEN) {
            // --- TODO: Get actual initial state from the game ---
            const initialState = {
                type: 'initial_state',
                observation: this.getPlaceholderObservation(),
                info: { message: 'Welcome to Pokerogue RL Environment!' }
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
