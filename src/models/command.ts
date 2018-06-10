import { BaseForLines, IGameCode } from "./game";
import { GameSound } from "./sound";

export enum COMMAND_TYPE {
    SFX = 'SFX',
    CANCEL = 'CANCEL',
    CHECKPOINT = 'CHECKPOINT',
    RESTART = 'RESTART',
    MESSAGE = 'MESSAGE',
    WIN = 'WIN',
    AGAIN = 'AGAIN' // This acts more as a RULE_MODIFIER but is included here for parsing and then is moved into the modifier section
}

export class AbstractCommand extends BaseForLines {
    getType(): COMMAND_TYPE {
        throw new Error(`BUG: Concrete class must implement this method`)
    }
    getSound(): GameSound {
        throw new Error(`BUG: Concrete class must implement this method`)
    }
}

export class MessageCommand extends AbstractCommand {
    _message: string

    constructor(source: IGameCode, message: string) {
        super(source)
        this._message = message
    }

    getType() { return COMMAND_TYPE.MESSAGE }

    // THese are used by message levels. Maybe we should split this into 2 classes
    isInvalid(): string {
        return null
    }
    isMap() {
        return false
    }
}

export class SoundCommand extends AbstractCommand {
    _sound: GameSound
    constructor(source: IGameCode, sound: GameSound) {
        super(source)
        this._sound = sound
        if (!sound) {
            debugger
            console.error(this.toString())
            throw new Error(`ERROR: Sound not found`)
        }
    }

    getType() { return COMMAND_TYPE.SFX }
    getSound() {
        return this._sound
    }
}

export class CancelCommand extends AbstractCommand {
    constructor(source: IGameCode) {
        super(source)
    }
    getType() { return COMMAND_TYPE.CANCEL }
}

export class CheckpointCommand extends AbstractCommand {
    constructor(source: IGameCode) {
        super(source)
    }
    getType() { return COMMAND_TYPE.CHECKPOINT }
}

export class RestartCommand extends AbstractCommand {
    constructor(source: IGameCode) {
        super(source)
    }
    getType() { return COMMAND_TYPE.RESTART }
}

export class WinCommand extends AbstractCommand {
    constructor(source: IGameCode) {
        super(source)
    }
    getType() { return COMMAND_TYPE.WIN }
}

export class AgainCommand extends AbstractCommand {
    constructor(source: IGameCode) {
        super(source)
    }
    getType() { return COMMAND_TYPE.AGAIN }
}