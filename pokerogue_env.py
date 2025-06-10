import gymnasium as gym
from gymnasium import spaces
import numpy as np # Will be used for observation/action spaces

# --- WebSocket Client Implementation ---
import asyncio
import websockets
import json
import threading
import queue
import time # Added for time.sleep
# -------------------------------------------------------------------------

# Define a timeout for queue operations
QUEUE_TIMEOUT = 10 # seconds (increased for initial connection)
RECONNECT_DELAY = 5 # seconds

# Global constants for observation space, must match in _get_placeholder_observation and _parse_observation
MAX_POKEMON_PER_TEAM = 6
MAX_MOVES_PER_POKEMON = 4
MAX_STAT_VALUE = 1000
MAX_ID_VALUE = 1200

class WebSocketClientThread(threading.Thread):
    def __init__(self, uri, action_queue, state_queue):
        super().__init__()
        self.uri = uri
        self.action_queue = action_queue
        self.state_queue = state_queue
        self._stop_event = threading.Event()
        self.websocket = None
        self.loop = None
        self.name = "WebSocketClientThread" # Assign a name for easier debugging

    async def main_logic(self):
        while not self._stop_event.is_set():
            try:
                print(f"{self.name}: Attempting to connect to {self.uri}...")
                async with websockets.connect(self.uri) as websocket:
                    self.websocket = websocket
                    print(f"{self.name}: WebSocket connected to {self.uri}.")

                    while not self._stop_event.is_set():
                        action_to_send = None
                        try:
                            action_to_send = self.action_queue.get_nowait()
                            if action_to_send == "STOP_THREAD_SIGNAL":
                                self._stop_event.set()
                                print(f"{self.name}: Stop signal received in action queue.")
                                break
                            await websocket.send(json.dumps(action_to_send))
                            # print(f"{self.name}: Sent action: {action_to_send}")
                        except queue.Empty:
                            pass # No action to send

                        try:
                            message_str = await asyncio.wait_for(websocket.recv(), timeout=0.1)
                            # print(f"{self.name}: Raw message received: {message_str}")
                            message_data = json.loads(message_str)
                            if not self.state_queue.full():
                                self.state_queue.put_nowait(message_data)
                            else:
                                print(f"{self.name}: Warning: State queue is full. Discarding message.")
                        except asyncio.TimeoutError:
                            pass # No message received
                        except websockets.exceptions.ConnectionClosedOK:
                            print(f"{self.name}: WebSocket connection closed by server (OK).")
                            break
                        except websockets.exceptions.ConnectionClosedError as e:
                            print(f"{self.name}: WebSocket connection closed by server (Error: {e}).")
                            break
                        except json.JSONDecodeError as e:
                            print(f"{self.name}: Error decoding JSON from server: {e}. Message: '{message_str}'")
                        except Exception as e:
                            print(f"{self.name}: Error receiving/processing message: {e}")
                            break

                        await asyncio.sleep(0.01) # Prevent busy-waiting

            except (websockets.exceptions.ConnectionClosedError, ConnectionRefusedError, OSError) as e:
                print(f"{self.name}: WebSocket connection failed or closed: {e}.")
            except Exception as e:
                print(f"{self.name}: Unexpected error in WebSocket main_logic: {e}")
            finally:
                self.websocket = None
                if not self._stop_event.is_set():
                    print(f"{self.name}: Retrying connection in {RECONNECT_DELAY}s...")
                    await asyncio.sleep(RECONNECT_DELAY)
        print(f"{self.name}: main_logic loop ended.")

    def run(self):
        print(f"{self.name}: Thread started.")
        self.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)
        try:
            self.loop.run_until_complete(self.main_logic())
        except Exception as e:
            print(f"{self.name}: Exception in run method: {e}")
        finally:
            if self.websocket and self.websocket.open:
                try:
                    self.loop.run_until_complete(self.websocket.close())
                except Exception as e:
                    print(f"{self.name}: Error closing websocket in run finally: {e}")
            self.loop.close()
            print(f"{self.name}: Thread finished.")

    def stop(self):
        print(f"{self.name}: Stop method called.")
        self._stop_event.set()
        try:
            self.action_queue.put_nowait("STOP_THREAD_SIGNAL") # Wake up thread if blocked
        except queue.Full:
            print(f"{self.name}: Action queue full while trying to send stop signal.")
            pass


class PokerogueEnv(gym.Env):
    metadata = {'render_modes': ['human', 'rgb_array'], 'render_fps': 4}

    def __init__(self, render_mode=None):
        super().__init__()
        self.render_mode = render_mode
        self.uri = "ws://localhost:8080"

        self.action_queue = queue.Queue(maxsize=1)
        self.state_queue = queue.Queue(maxsize=1)
        self.websocket_thread = None

        self.action_space = spaces.Discrete(6) # 4 moves, 1 switch (to slot 0), 1 flee

        self.observation_space = spaces.Dict({
            "player_active_pokemon": spaces.Dict({
                "id": spaces.Discrete(MAX_ID_VALUE),
                "hp_current": spaces.Box(low=0, high=MAX_STAT_VALUE, shape=(1,), dtype=np.int32),
                "hp_max": spaces.Box(low=1, high=MAX_STAT_VALUE, shape=(1,), dtype=np.int32),
                "stats": spaces.Box(low=0, high=MAX_STAT_VALUE, shape=(5,), dtype=np.int32),
                "status_conditions": spaces.MultiBinary(5),
                "moves_pp": spaces.Box(low=0, high=64, shape=(MAX_MOVES_PER_POKEMON,), dtype=np.int32),
                "moves_max_pp": spaces.Box(low=0, high=64, shape=(MAX_MOVES_PER_POKEMON,), dtype=np.int32),
            }),
            "opponent_active_pokemon": spaces.Dict({
                "id": spaces.Discrete(MAX_ID_VALUE),
                "hp_current_ratio": spaces.Box(low=0, high=1.0, shape=(1,), dtype=np.float32),
                "stats_known": spaces.Box(low=0, high=MAX_STAT_VALUE, shape=(5,), dtype=np.int32),
                "status_conditions": spaces.MultiBinary(5),
            }),
            "player_party": spaces.Tuple(
                tuple([spaces.Dict({
                    "id": spaces.Discrete(MAX_ID_VALUE),
                    "hp_current": spaces.Box(low=0, high=MAX_STAT_VALUE, shape=(1,), dtype=np.int32),
                    "hp_max": spaces.Box(low=1, high=MAX_STAT_VALUE, shape=(1,), dtype=np.int32),
                    "status_conditions": spaces.MultiBinary(5),
                    "is_active": spaces.Discrete(2)
                })] * MAX_POKEMON_PER_TEAM)
            ),
            "opponent_party_known_pokemon": spaces.Tuple(
                 tuple([spaces.Dict({
                    "id": spaces.Discrete(MAX_ID_VALUE),
                    "fainted": spaces.Discrete(2)
                })] * MAX_POKEMON_PER_TEAM)
            ),
            "opponent_num_remaining": spaces.Discrete(MAX_POKEMON_PER_TEAM + 1),
            "battle_state": spaces.Dict({
                "turn": spaces.Box(low=0, high=10000, shape=(1,), dtype=np.int32),
                "is_double_battle": spaces.Discrete(2),
            })
        })

        self.current_observation = None
        self.current_reward = 0.0
        self.is_terminated = False
        self.is_truncated = False

        print("PokerogueEnv initialized.")

    def _process_game_message(self, message_data: dict):
        # print(f"Processing game message: {message_data}")
        if not isinstance(message_data, dict):
            print("Error: Message from state_queue is not a dict.")
            self.current_observation = self._get_placeholder_observation()
            self.is_terminated = True # Critical error
            return

        message_type = message_data.get('type')
        if message_type == 'initial_state' or message_type == 'state_update':
            obs_data = message_data.get('observation')
            if obs_data:
                self.current_observation = self._parse_observation(obs_data)
            else:
                print("Warning: No observation data in message, using placeholder.")
                self.current_observation = self._get_placeholder_observation()

            self.current_reward = float(message_data.get('reward', 0.0))
            self.is_terminated = bool(message_data.get('terminated', False))
            self.is_truncated = bool(message_data.get('truncated', False))
        elif message_type == 'error':
            print(f"Error message from server: {message_data.get('message')}")
            self.is_terminated = True
            self.current_observation = self._get_placeholder_observation()
        else:
            print(f"Unknown message type received: {message_type}")
            self.current_observation = self._get_placeholder_observation()

    def _parse_observation(self, obs_data: dict) -> dict:
        parsed_obs = {}
        try:
            pa_pokemon = obs_data.get("player_active_pokemon", {})
            parsed_obs["player_active_pokemon"] = {
                "id": int(pa_pokemon.get("id", 0)),
                "hp_current": np.array(pa_pokemon.get("hp_current", [0]), dtype=np.int32).reshape((1,)),
                "hp_max": np.array(pa_pokemon.get("hp_max", [1]), dtype=np.int32).reshape((1,)),
                "stats": np.array(pa_pokemon.get("stats", [0]*5), dtype=np.int32),
                "status_conditions": np.array(pa_pokemon.get("status_conditions", [0]*5), dtype=np.int8),
                "moves_pp": np.array(pa_pokemon.get("moves_pp", [0]*MAX_MOVES_PER_POKEMON), dtype=np.int32),
                "moves_max_pp": np.array(pa_pokemon.get("moves_max_pp", [0]*MAX_MOVES_PER_POKEMON), dtype=np.int32),
            }

            opp_pokemon = obs_data.get("opponent_active_pokemon", {})
            parsed_obs["opponent_active_pokemon"] = {
                "id": int(opp_pokemon.get("id", 0)),
                "hp_current_ratio": np.array(opp_pokemon.get("hp_current_ratio", [0.0]), dtype=np.float32).reshape((1,)),
                "stats_known": np.array(opp_pokemon.get("stats_known", [0]*5), dtype=np.int32),
                "status_conditions": np.array(opp_pokemon.get("status_conditions", [0]*5), dtype=np.int8),
            }

            player_party_data = obs_data.get("player_party", [])
            parsed_player_party = []
            for i in range(MAX_POKEMON_PER_TEAM):
                p_data = player_party_data[i] if i < len(player_party_data) else {}
                parsed_player_party.append({
                    "id": int(p_data.get("id", 0)),
                    "hp_current": np.array(p_data.get("hp_current", [0]), dtype=np.int32).reshape((1,)),
                    "hp_max": np.array(p_data.get("hp_max", [1]), dtype=np.int32).reshape((1,)),
                    "status_conditions": np.array(p_data.get("status_conditions", [0]*5), dtype=np.int8),
                    "is_active": int(p_data.get("is_active", 0)),
                })
            parsed_obs["player_party"] = tuple(parsed_player_party)

            opp_party_data = obs_data.get("opponent_party_known_pokemon", [])
            parsed_opp_party = []
            for i in range(MAX_POKEMON_PER_TEAM):
                op_data = opp_party_data[i] if i < len(opp_party_data) else {}
                parsed_opp_party.append({
                    "id": int(op_data.get("id", 0)),
                    "fainted": int(op_data.get("fainted", 0)),
                })
            parsed_obs["opponent_party_known_pokemon"] = tuple(parsed_opp_party)

            parsed_obs["opponent_num_remaining"] = int(obs_data.get("opponent_num_remaining", MAX_POKEMON_PER_TEAM))

            battle_state_data = obs_data.get("battle_state", {})
            parsed_obs["battle_state"] = {
                "turn": np.array(battle_state_data.get("turn", [0]), dtype=np.int32).reshape((1,)),
                "is_double_battle": int(battle_state_data.get("is_double_battle", 0)),
            }
        except Exception as e:
            print(f"Error parsing observation data: {e}. Data was: {obs_data}")
            return self._get_placeholder_observation()

        # Basic validation, can be expanded
        if not self.observation_space.contains(parsed_obs):
           print(f"Warning: Parsed observation does not strictly match observation space. Data: {obs_data}")
           # It might be due to subtle type differences (e.g. int vs int32) if data is otherwise correct.
           # For now, we'll proceed with the parsed_obs if it got this far.
        return parsed_obs

    def _get_placeholder_observation(self):
        obs = {
            "player_active_pokemon": {
                "id": 0, "hp_current": np.array([1], dtype=np.int32), "hp_max": np.array([1], dtype=np.int32),
                "stats": np.zeros(5, dtype=np.int32), "status_conditions": np.zeros(5, dtype=np.int8),
                "moves_pp": np.zeros(MAX_MOVES_PER_POKEMON, dtype=np.int32),
                "moves_max_pp": np.zeros(MAX_MOVES_PER_POKEMON, dtype=np.int32),
            },
            "opponent_active_pokemon": {
                "id": 0, "hp_current_ratio": np.array([1.0], dtype=np.float32),
                "stats_known": np.zeros(5, dtype=np.int32), "status_conditions": np.zeros(5, dtype=np.int8),
            },
            "player_party": tuple([{
                "id": 0, "hp_current": np.array([1 if i == 0 else 0], dtype=np.int32), "hp_max": np.array([1], dtype=np.int32),
                "status_conditions": np.zeros(5, dtype=np.int8), "is_active": 1 if i == 0 else 0
            } for i in range(MAX_POKEMON_PER_TEAM)]),
            "opponent_party_known_pokemon": tuple([{ "id": 0, "fainted": 0 }] * MAX_POKEMON_PER_TEAM),
            "opponent_num_remaining": MAX_POKEMON_PER_TEAM,
            "battle_state": { "turn": np.array([0], dtype=np.int32), "is_double_battle": 0, }
        }
        return obs

    def _format_action(self, action_num: int) -> dict:
        action_details = {}
        if action_num < 4: # Moves 0-3
            action_details = {"action_type": "move", "move_slot": int(action_num)}
        elif action_num == 4: # Switch to first benched Pokemon (index 0)
            action_details = {"action_type": "switch", "switch_slot": 0}
        elif action_num == 5: # Flee
            action_details = {"action_type": "flee"}
        else: # Fallback
            action_details = {"action_type": "flee"}
        return {"type": "action", "action_details": action_details}

    def step(self, action: int):
        if self.websocket_thread is None or \
           not self.websocket_thread.is_alive() or \
           self.websocket_thread.websocket is None: # Simplified check
            error_msg = "WebSocket is not connected or thread is not running for step."
            print(f"Error in step: {error_msg}")
            self.is_terminated = True # Terminate if connection lost before step
            # Return a consistent structure even on critical failure
            return self._get_placeholder_observation(), 0.0, self.is_terminated, self.is_truncated, {"error": error_msg, "status": "No connection"}

        obs_to_return = self.current_observation if self.current_observation is not None else self._get_placeholder_observation()
        reward_to_return = self.current_reward
        terminated_to_return = self.is_terminated
        truncated_to_return = self.is_truncated
        info_to_return = {} # Default info

        formatted_action_for_game = self._format_action(action)
        try:
            self.action_queue.put(formatted_action_for_game, timeout=1.0)
        except queue.Full:
            error_msg = "Action queue full, action could not be sent."
            print(f"Error in step: {error_msg}")
            truncated_to_return = True
            info_to_return = {"error": error_msg, "status": "Action queue full"}
            # Return current state as action wasn't processed by server
            return obs_to_return, reward_to_return, terminated_to_return, truncated_to_return, info_to_return

        try:
            new_state_message = self.state_queue.get(timeout=QUEUE_TIMEOUT)
            self._process_game_message(new_state_message) # This updates self.current_observation, reward, terminated, truncated

            # Update return values based on the processed message
            obs_to_return = self.current_observation
            reward_to_return = self.current_reward
            terminated_to_return = self.is_terminated
            truncated_to_return = self.is_truncated
            info_to_return = new_state_message.get('info', {}) # Get info from the message
        except queue.Empty:
            error_msg = "State queue empty, no response from server in step."
            print(f"Error in step: {error_msg}")
            truncated_to_return = True # Truncate as we missed a state update
            info_to_return = {"error": error_msg, "status": "No response from server"}
            # self.current_observation, etc., remain from the previous step
            obs_to_return = self.current_observation if self.current_observation is not None else self._get_placeholder_observation()
            # Potentially set reward to 0 or a penalty if desired for timeouts
            # reward_to_return = 0

        return obs_to_return, reward_to_return, terminated_to_return, truncated_to_return, info_to_return

    def reset(self, seed=None, options=None):
        super().reset(seed=seed)
        print("Resetting environment...")

        if self.websocket_thread is not None and self.websocket_thread.is_alive():
            print("Stopping existing WebSocket thread...")
            self.websocket_thread.stop()
            self.websocket_thread.join(timeout=5)
            if self.websocket_thread.is_alive():
                print("Warning: WebSocket thread did not stop in time.")

        while not self.action_queue.empty(): self.action_queue.get_nowait() # Clear queues
        while not self.state_queue.empty(): self.state_queue.get_nowait()

        print("Starting new WebSocket thread...")
        self.websocket_thread = WebSocketClientThread(self.uri, self.action_queue, self.state_queue)
        self.websocket_thread.start()

        initial_obs_received = False
        info = {} # Initialize info
        try:
            # Wait for the server to send the initial_state message
            initial_state_message = self.state_queue.get(timeout=QUEUE_TIMEOUT * 2) # Longer timeout for initial connect
            self._process_game_message(initial_state_message)
            initial_obs_received = True
        except queue.Empty:
            print("Failed to receive initial state from server within timeout. Using placeholder observation.")
            self.current_observation = self._get_placeholder_observation()
            self.is_terminated = True
            info['error'] = "Failed to receive initial state" # Add error to info

        # Reset internal state variables
        self.current_reward = 0.0
        # self.is_terminated is set by _process_game_message or above exception handling
        if not initial_obs_received and not self.is_terminated: # Ensure terminated if obs not received
            self.is_terminated = True
            if 'error' not in info: info['error'] = "Initial state not processed correctly but not explicitly terminated."

        self.is_truncated = False

        if self.render_mode == "human":
            self.render()

        print(f"Reset complete. Initial observation received: {initial_obs_received}")
        if self.is_terminated and not initial_obs_received: # Further clarify status in info if needed
             print("Environment is terminated due to failure to receive initial state.")
             if 'status' not in info: info['status'] = "Reset failed: No initial state from server"
        elif initial_obs_received and not self.is_terminated:
            info['status'] = "Reset successful"

        return self.current_observation, info

    def render(self):
        if self.render_mode == 'human':
            print("\n--- Battle State ---")
            if self.current_observation is None:
                print("No observation data available to render (env not reset or critical error).")
                # Optionally print terminated/truncated if they provide context
                print(f"Terminated: {self.is_terminated}, Truncated: {self.is_truncated}")
                print("--------------------")
                return

            # If current_observation is not None, proceed to render its contents.
            # self.is_terminated being true will be rendered as part of the general info below.
            obs = self.current_observation

            # Player's Active Pokemon
            pa = obs.get("player_active_pokemon", {})
            print("\nPlayer's Active Pokemon:")
            if pa:
                print(f"  ID: {pa.get('id', 'N/A')}, HP: {pa.get('hp_current', ['N/A'])[0]}/{pa.get('hp_max', ['N/A'])[0]}")
                stats = pa.get('stats', ['N/A']*5)
                print(f"  Stats (Atk,Def,SpA,SpD,Spe): {stats}")
                status = pa.get('status_conditions', ['N/A']*5)
                status_names = ["Burn", "Freeze", "Paralysis", "Poison", "Sleep"]
                active_statuses = [status_names[i] for i, s_val in enumerate(status) if s_val == 1]
                print(f"  Status: {', '.join(active_statuses) if any(active_statuses) else 'None'}")
                print(f"  Moves (PP/MaxPP):")
                moves_pp = pa.get('moves_pp', [])
                moves_max_pp = pa.get('moves_max_pp', [])
                for i in range(len(moves_pp)):
                    print(f"    - Move {i+1}: {moves_pp[i]}/{moves_max_pp[i] if i < len(moves_max_pp) else 'N/A'}")
            else:
                print("  Data not available.")

            # Opponent's Active Pokemon
            oa = obs.get("opponent_active_pokemon", {})
            print("\nOpponent's Active Pokemon:")
            if oa:
                hp_ratio_val = oa.get('hp_current_ratio', [None])[0] # Get the scalar from array
                if hp_ratio_val is not None and isinstance(hp_ratio_val, (float, np.floating)):
                    hp_display = f"{hp_ratio_val*100:.1f}%"
                else:
                    hp_display = "N/A"
                print(f"  ID: {oa.get('id', 'N/A')}, HP Ratio: {hp_display}")
                # Opponent stats are 'stats_known', may not be fully available
                # opp_stats = oa.get('stats_known', ['N/A']*5)
                # print(f"  Known Stats: {opp_stats}")
                opp_status = oa.get('status_conditions', ['N/A']*5)
                opp_active_statuses = [status_names[i] for i, s_val in enumerate(opp_status) if s_val == 1]
                print(f"  Status: {', '.join(opp_active_statuses) if any(opp_active_statuses) else 'None'}")
            else:
                print("  Data not available.")

            # Player's Party
            print("\nPlayer's Party:")
            player_party = obs.get("player_party", [])
            for i, pkm in enumerate(player_party):
                if pkm.get('id', 0) != 0: # Assuming ID 0 means empty slot
                    status = pkm.get('status_conditions', [0]*5)
                    active_statuses = [status_names[i] for i, s_val in enumerate(status) if s_val == 1]
                    status_str = f", Status: {', '.join(active_statuses) if any(active_statuses) else 'None'}"
                    active_str = " (Active)" if pkm.get('is_active') else ""
                    print(f"  Slot {i+1}: ID {pkm.get('id')} HP {pkm.get('hp_current', ['N/A'])[0]}/{pkm.get('hp_max', ['N/A'])[0]}{status_str}{active_str}")

            # Opponent's Party (Known Pokemon)
            # print("\nOpponent's Known Party:")
            # opp_party = obs.get("opponent_party_known_pokemon", [])
            # known_opp_count = 0
            # for i, pkm in enumerate(opp_party):
            #     if pkm.get('id', 0) != 0:
            #         known_opp_count +=1
            #         fainted_str = " (Fainted)" if pkm.get('fainted') else ""
            #         print(f"  Slot {i+1}: ID {pkm.get('id')}{fainted_str}")
            # if known_opp_count == 0: print("  No opponent party members revealed yet.")
            print(f"\nOpponent Pokémon Remaining: {obs.get('opponent_num_remaining', 'N/A')}")


            # Battle State
            battle_state = obs.get("battle_state", {})
            print("\nGeneral Battle Info:")
            print(f"  Turn: {battle_state.get('turn', ['N/A'])[0]}")
            # print(f"  Is Double Battle: {'Yes' if battle_state.get('is_double_battle') else 'No'}")


            print(f"\nCurrent Reward: {self.current_reward}")
            print(f"Terminated: {self.is_terminated}, Truncated: {self.is_truncated}")
            print("--------------------")

        elif self.render_mode == 'rgb_array':
            # True rgb_array rendering would require the TypeScript game to send
            # image data (e.g., a canvas screenshot) through the WebSocket connection.
            # That data would then be processed here and returned as a NumPy array.
            return np.zeros((3, 100, 100), dtype=np.uint8) # Placeholder

    def close(self):
        print("Closing environment...")
        if self.websocket_thread is not None and self.websocket_thread.is_alive():
            print("Stopping WebSocket thread...")
            self.websocket_thread.stop()
            self.websocket_thread.join(timeout=10)
            if self.websocket_thread.is_alive():
                print("Warning: WebSocket thread did not stop in time during close.")
        self.websocket_thread = None
        print("Environment closed.")


if __name__ == '__main__':
    # --- IMPORTANT ---
    # 1. Compile the TypeScript server: `npm run build:tsc`
    #    This should create files in the `./build` directory (e.g., ./build/src/run-server.js)
    # 2. Run the compiled TypeScript WebSocket server: `node ./build/src/run-server.js`
    #    (Or use `ts-node src/run-server.ts` if you have ts-node installed globally and configured for ES modules)
    # 3. Then, run this Python script.
    # --- ----------- ---
    print("Reminder: Start the TypeScript WebSocket server before running this script.")
    print("Build server with: npm run build:tsc")
    print("Run server with: node ./build/src/run-server.js (or ts-node src/run-server.ts)")
    print("------------------------------------------------------------------------------------")

    env = None
    try:
        env = PokerogueEnv(render_mode='human')
        print("\n--- Resetting Environment ---")
        initial_obs, info = env.reset()

        # Check for successful reset based on info dict and terminated status
        reset_status = info.get('status', '')
        reset_error = info.get('error', '')

        if env.is_terminated and "Reset successful" not in reset_status :
            print(f"Environment reset failed or resulted in a terminated state. Error: {reset_error}. Status: {reset_status}.")
            print("Exiting example.")
        else:
            print(f"Initial Observation received: {initial_obs is not None}")
            print(f"Reset Info: {info}")
            env.render() # Render initial state

            done = False
            total_reward = 0
            num_steps = 7 # Run for a few steps

            for i in range(num_steps):
                print(f"\n--- Step {i+1}/{num_steps} ---")
                action = env.action_space.sample()
                print(f"Taking Action: {action}")

                obs, reward, terminated, truncated, info = env.step(action)
                done = terminated or truncated
                total_reward += reward

                print(f"Observation received: {obs is not None}")
                print(f"Reward: {reward}")
                print(f"Terminated: {terminated}, Truncated: {truncated}")
                print(f"Step Info: {info}")
                env.render() # Render state after step

                if done:
                    print(f"Episode finished after {i+1} steps.")
                    break

                print("Waiting 1 second before next step...")
                time.sleep(1) # Sleep to observe logs

            print(f"\n--- Episode Finished or Max Steps Reached ---")
            print(f"Total reward: {total_reward}")

    except KeyboardInterrupt:
        print("\nKeyboardInterrupt received. Exiting example.")
    except ConnectionRefusedError:
        print("\nConnectionRefusedError: Could not connect to the WebSocket server. Ensure it's running.")
    except Exception as e:
        print(f"An error occurred during example usage: {e}")
        import traceback
        traceback.print_exc()
    finally:
        if env is not None:
            print("\nClosing env from finally block...")
            env.close()

    print("\nPokerogueEnv example usage finished.")
