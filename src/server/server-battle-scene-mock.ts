// src/server/server-battle-scene-mock.ts
import { BattlerIndex } from '../enums/battler-index';
import { UiMode } from '../enums/ui-mode';
import { Command } from '../enums/command';
import { BiomeId } from '../enums/biome-id';
import { BattlerTagType } from '../enums/battler-tag-type';
import { MoveId } from '../enums/move-id';
import { BattleType } from '../enums/battle-type';
import { MoveTarget } from '../enums/MoveTarget'; // Added
import { PokemonType } from '../enums/pokemon-type'; // Added

// Import actual phase classes
import { TurnInitPhase } from '../phases/turn-init-phase';
import { CommandPhase } from '../phases/command-phase';
import { EnemyCommandPhase } from '../phases/enemy-command-phase';
import { TurnStartPhase } from '../phases/turn-start-phase';
import { GameOverPhase } from '../phases/game-over-phase';
import { ToggleDoublePositionPhase } from '../phases/toggle-double-position-phase';
import { MessagePhase } from '../phases/message-phase';
import { SelectTargetPhase } from '../phases/select-target-phase';

// Access to globalScene for MockPokemon methods
let globalSceneRef: ServerBattleSceneMock | null = null;

// Helper to create mock moves
const createMockMove = (id: MoveId, pp: number = 10, maxPP: number = 10) => ({
    moveId: id,
    pp: pp,
    maxPP: maxPP,
    disabled: false,
    isUsable: function(pokemonOwner: MockPokemon, ignorePP: boolean = false) {
        return (ignorePP || this.pp > 0) && !this.disabled;
    },
    getName: () => `MockMove_${MoveId[id] || 'Unknown'}`
});

class MockPokemon {
    public moveset: any[];
    public moveQueue: any[] = [];
    public tags: Map<BattlerTagType, any> = new Map();
    public species: any = { speciesId: 0, getFormSpriteKey: () => '', abilityHidden: null, baseStats: [50,50,50,50,50,50], types: [PokemonType.NORMAL] };
    public formIndex: number = 0;
    public currentBattle: any = null; // Will be set externally
    public types: PokemonType[];

    constructor(public id: number, public name: string = 'MockMon', public battlerIndex: BattlerIndex, public active: boolean = true, public isPlayerPokemon: boolean = true) {
        this.moveset = [createMockMove(MoveId.TACKLE, 10, 10), createMockMove(MoveId.GROWL, 5, 10)];
        this.types = [PokemonType.NORMAL]; // Default type
        if (id === 1) { // PlayerMon1
             this.moveset.push(createMockMove(MoveId.HELPING_HAND, 5, 5));
        }
    }

    isOnField = () => this.active;
    isAllowedInBattle = () => true;
    switchOut = () => console.log(`${this.name} MockPokemon.switchOut called`);
    leaveField = () => { this.active = false; console.log(`${this.name} MockPokemon.leaveField called`); };
    isPlayer = () => this.isPlayerPokemon;
    resetTurnData = () => console.log(`${this.name} MockPokemon.resetTurnData called`);

    getBattlerIndex = (): BattlerIndex => this.battlerIndex;

    getOpponents = (includeFainted: boolean = false): MockPokemon[] => {
        if (!globalSceneRef) return [];
        if (this.isPlayerPokemon) {
            return globalSceneRef.mockEnemyField.filter(p => includeFainted || p.isOnField());
        }
        return globalSceneRef.mockPlayerField.filter(p => includeFainted || p.isOnField());
    };

    getAlly = (): MockPokemon | null => {
        if (!globalSceneRef?.currentBattle?.double) return null;
        const field = this.isPlayerPokemon ? globalSceneRef.mockPlayerField : globalSceneRef.mockEnemyField;
        return field.find(p => p.id !== this.id && p.isOnField()) || null;
    };

    randBattleSeedInt = (range: number, min: number = 0): number => {
        if (this.currentBattle && typeof this.currentBattle.randSeedInt === 'function') {
            return this.currentBattle.randSeedInt(range, min);
        }
        return Math.floor(Math.random() * range) + min;
    };

    getTypes = (ignoreConversion?: boolean): PokemonType[] => this.types;
    getTag = (tagType: BattlerTagType): any => this.tags.get(tagType) || null;
    lapseTag = (tagType: BattlerTagType): void => { console.log(`${this.name} MockPokemon.lapseTag for ${BattlerTagType[tagType]}`); this.tags.delete(tagType); };
    getMoveset = (): any[] => this.moveset;
    getMoveQueue = (): any[] => this.moveQueue;

    trySelectMove = (cursor: number, ignorePP?: boolean): boolean => {
        console.log(`${this.name} MockPokemon.trySelectMove on slot ${cursor}`);
        const move = this.moveset[cursor];
        return move && move.isUsable(this, ignorePP);
    };

    isMoveRestricted = (moveId: MoveId, pokemon: any): boolean => false;
    getRestrictingTag = (moveId: MoveId, pokemon: any): any => null;
    isTrapped = (messages?: string[]): boolean => false;
}

export class ServerBattleSceneMock /* implements Partial<BattleScene> */ {
    public rngCounter: number = 0;
    public rngSeedOverride: string | null = null;
    public phaseManager: any;
    public allMoves: any; // For getMoveData

    public currentBattle: any = {
        turn: 1, double: false, battleType: BattleType.WILD,
        isBattleMysteryEncounter: () => false, mysteryEncounter: null,
        turnCommands: {}, preTurnCommands: {}
    };

    public eventTarget: any = {
        dispatchEvent: (event: any) => console.log('ServerBattleSceneMock.eventTarget.dispatchEvent called:', event?.type, event)
    };

    public mockPlayerField: MockPokemon[];
    public mockEnemyField: MockPokemon[];

    public ui: any;
    public arena: any;
    public commandCursorMemory: any = Command.FIGHT;
    public gameData: any;

    constructor() {
        console.log('ServerBattleSceneMock initialized');
        globalSceneRef = this; // Set the reference for MockPokemon methods

        this.mockPlayerField = [
            new MockPokemon(1, 'PlayerMon1', BattlerIndex.PLAYER_1_0, true, true),
            new MockPokemon(2, 'PlayerMon2', BattlerIndex.PLAYER_1_1, false, true)
        ];
        this.mockEnemyField = [
            new MockPokemon(3, 'EnemyMon1', BattlerIndex.ENEMY_1_0, true, false),
            new MockPokemon(4, 'EnemyMon2', BattlerIndex.ENEMY_1_1, false, false)
        ];

        this.allMoves = {
            [MoveId.NONE]: { moveId: MoveId.NONE, moveTarget: MoveTarget.USER, hasAttr: () => false },
            [MoveId.STRUGGLE]: { moveId: MoveId.STRUGGLE, moveTarget: MoveTarget.NEAR_ENEMY, hasAttr: () => false },
            [MoveId.TACKLE]: { moveId: MoveId.TACKLE, moveTarget: MoveTarget.NEAR_ENEMY, hasAttr: (attr: string) => false },
            [MoveId.GROWL]: { moveId: MoveId.GROWL, moveTarget: MoveTarget.ALL_NEAR_ENEMIES, hasAttr: (attr: string) => false },
            [MoveId.HELPING_HAND]: { moveId: MoveId.HELPING_HAND, moveTarget: MoveTarget.ALLY, hasAttr: (attr: string) => false }
        };

        const phaseManagerCreate = this.phaseManager_create.bind(this);
        this.phaseManager = { /* same as before, just ensure create is bound */
            phaseQueue: [] as any[], currentPhase: null as any,
            pushPhase: (phase: any): void => { this.phaseManager.phaseQueue.push(phase); console.log('Mock.PM.pushPhase:', phase?.constructor?.name); },
            unshiftPhase: (...phases: any[]): void => { this.phaseManager.phaseQueue.unshift(...phases); console.log('Mock.PM.unshiftPhase:', phases.map(p=>p?.constructor?.name)); },
            shiftPhase: (): void => {
                if (this.phaseManager.phaseQueue.length === 0) { this.phaseManager.currentPhase = null; return; }
                this.phaseManager.currentPhase = this.phaseManager.phaseQueue.shift();
                const n = this.phaseManager.currentPhase?.constructor?.name || 'UnknownPhase'; console.log(`Mock.PM.shiftPhase: Starting ${n}`);
                try { if (this.phaseManager.currentPhase?.start) this.phaseManager.currentPhase.start(); else console.warn(`${n} no start`); }
                catch (e) { console.error(`Mock.PM.shiftPhase: Error starting ${n}:`, e); }
            },
            clearPhaseQueue: (): void => { this.phaseManager.phaseQueue = []; this.phaseManager.currentPhase = null; console.log('Mock.PM.clearQ'); },
            create: phaseManagerCreate,
            pushNew: function(phaseName: string, ...args: any[]): void { const phase = this.create(phaseName, ...args); if (phase) this.pushPhase(phase); },
            unshiftNew: function(phaseName: string, ...args: any[]): void { const phase = this.create(phaseName, ...args); if (phase) this.unshiftPhase(phase); },
            startBattlePhase: (battle: any) => { console.log('Mock.PM.startBattlePhase for wave:', battle?.waveIndex); },
            queueMessage: (message: string, cb?: () => void) => { console.log(`Mock.PM.queueMessage: "${message}"`); if (cb) cb(); },
        };

        this.ui = { /* same as before */
            handlers: { [UiMode.COMMAND]: { cursor: Command.FIGHT, getCursor: () => this.ui.handlers[UiMode.COMMAND].cursor, setCursor: (nc: any) => { this.ui.handlers[UiMode.COMMAND].cursor = nc; console.log(`MockUI: Command cursor set to ${nc}`); } } },
            setMode: (mode: any, ...args: any[]) => { console.log(`MockUI: setMode ${mode}`, args); return Promise.resolve(); },
            showText: (msg: string, d?: number|null, cb?: (()=>void)|null) => { console.log(`MockUI: showText: ${msg}`); if (cb) cb(); },
            clearText: () => { console.log('MockUI: clearText'); }
        };
        this.arena = { /* same as before */
            biomeType: BiomeId.TOWN,
            getTagOnSide: (tagType: any, side: any) => { console.log(`MockArena: getTagOnSide ${tagType} side ${side}`); return null; }
        };
        this.gameData = { /* same as before */
            dexData: {}, getStarterCount: (filterFunc?: any) => 0,
            setPokemonSeen: (pokemon: any, v?: boolean, i?: boolean) => { console.log(`MockGameData: setPokemonSeen ${pokemon?.name}`); }
        };
    }

    private phaseManager_create(phaseName: string, ...args: any[]): any {
        console.log(`Mock.PM.create: ${phaseName} with args:`, args);
        try {
            switch (phaseName) {
                case "TurnInitPhase": return new TurnInitPhase(...args);
                case "CommandPhase": return new CommandPhase(...args);
                case "EnemyCommandPhase": return new EnemyCommandPhase(...args);
                case "TurnStartPhase": return new TurnStartPhase(...args);
                case "GameOverPhase": return new GameOverPhase(...args);
                case "ToggleDoublePositionPhase": return new ToggleDoublePositionPhase(...args);
                case "MessagePhase": return new MessagePhase(args[0] || "Default mock message", ...args.slice(1));
                case "SelectTargetPhase": return new SelectTargetPhase(...args); // Added
                default: throw new Error(`Unknown phase: ${phaseName}`);
            }
        } catch (e) { console.error(`Mock.PM.create: Error for ${phaseName}:`, e); return null; }
    }

    public getMoveData = (moveId: MoveId): any => {
        console.log(`MockGlobalScene: getMoveData called for ${MoveId[moveId]}`);
        return this.allMoves[moveId] || { moveId: moveId, moveTarget: MoveTarget.NEAR_ENEMY, преступник: () => false }; // Fallback
    };

    public randSeedInt(range: number, min: number = 0): number {
        const result = Math.floor(Math.random() * range) + min;
        return result;
    }

    public getPlayerField = (): MockPokemon[] => this.mockPlayerField;
    public getField = (): MockPokemon[] => [...this.mockPlayerField.filter(p=>p.isOnField()), ...this.mockEnemyField.filter(p=>p.isOnField())];
    public getPokemonAllowedInBattle = (): MockPokemon[] => this.mockPlayerField.filter(p => p.isAllowedInBattle());
    public getPokemonById = (id: number): MockPokemon | null => {
        let found = this.mockPlayerField.find(p => p.id === id) || this.mockEnemyField.find(p => p.id === id);
        return found || null;
    };
}
