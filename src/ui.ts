import * as _ from 'lodash'
import * as ansiStyles from 'ansi-styles'
import * as ansiEscapes from 'ansi-escapes'
import * as supportsColor from 'supports-color'
import { GameSprite } from './models/tile'
import { GameData } from './models/game'
import { IColor } from './models/colors'
import { GameEngine, Cell } from './engine'
import { RULE_DIRECTION_ABSOLUTE } from './util';
import chalk from 'chalk';

// Determine if this
// 'truecolor' if this terminal supports 16m colors. 256 colors otherwise
const supports16mColors = process.env['COLORTERM'] === 'truecolor'

function setBgColor(hex) {
    if (supports16mColors) {
        return ansiStyles.bgColor.ansi16m.hex(hex)
    } else {
        return ansiStyles.bgColor.ansi256.hex(hex)
    }
}

function setFgColor(hex) {
    if (supports16mColors) {
        return ansiStyles.color.ansi16m.hex(hex)
    } else {
        return ansiStyles.color.ansi256.hex(hex)
    }
}
function writeBgColor(hex) {
    process.stdout.write(setBgColor(hex))
}
function writeFgColor(hex) {
    process.stdout.write(setFgColor(hex))
}
function setMoveTo(x, y) {
    return ansiEscapes.cursorTo(x, y)
}
function setHideCursor() {
    return ansiEscapes.cursorHide
}
function setShowCursor() {
    return ansiEscapes.cursorShow
}
function clearScreen() {
    process.stdout.write(ansiEscapes.clearScreen)
}
function writeTextAt(x, y, msg) {
    process.stdout.write(`${setMoveTo(x, y)}${msg}`)
}
function drawPixelChar(x, y, fgHex, bgHex, char) {
    const out = []
    if (fgHex) {
        out.push(writeFgColor(fgHex))
    }
    if (bgHex) {
        out.push(writeBgColor(bgHex))
    }
    out.push(setMoveTo(x, y))
    out.push(char)
    // In case the user presses Ctrl+C, always set the colors back to white on black
    out.push(setBgColor('#000000'))
    out.push(setFgColor('#ffffff'))
    out.push(setShowCursor())
    process.stdout.write(out.join(''))
}


class CellColorCache {
    _cache: Map<string, IColor[][]>

    constructor() {
        this._cache = new Map()
    }

    get(spritesToDraw: GameSprite[], backgroundColor: IColor, spriteHeight: number, spriteWidth: number) {
        const key = spritesToDraw.map(s => s._name).join(' ')
        if (!this._cache.has(key)) {
            this._cache.set(key, collapseSpritesToPixels(spritesToDraw, backgroundColor, spriteHeight, spriteWidth))
        }
        return this._cache.get(key)
    }

    clear() {
        this._cache.clear()
    }
}

// First Sprite one is on top.
// This caused a 2x speedup while rendering.
function collapseSpritesToPixels(spritesToDraw: GameSprite[], backgroundColor: IColor, spriteHeight: number, spriteWidth: number) {
    if (spritesToDraw.length === 0) {
        // Just draw the background
        const sprite: IColor[][] = []
        for (let y = 0; y < spriteHeight; y++) {
            sprite[y] = sprite[y] || []
            for (let x = 0; x < spriteWidth; x++) {
                // If this is the last sprite and nothing was found then use the game background color
                sprite[y][x] = backgroundColor
            }
        }
        return sprite
    }
    // Record Code coverage
    if (process.env['NODE_ENV'] === 'development') {
        spritesToDraw[0].__coverageCount++
    }
    if (spritesToDraw.length === 1) {
        return spritesToDraw[0].getPixels(spriteHeight, spriteWidth)
    }
    const sprite = spritesToDraw[0].getPixels(spriteHeight, spriteWidth)
    spritesToDraw.slice(1).forEach((objectToDraw, spriteIndex) => {
        if (process.env['NODE_ENV'] === 'development') {
            objectToDraw.__coverageCount++
        }
        const pixels = objectToDraw.getPixels(spriteHeight, spriteWidth)
        for (let y = 0; y < spriteHeight; y++) {
            sprite[y] = sprite[y] || []
            for (let x = 0; x < spriteWidth; x++) {
                const pixel = pixels[y][x]
                // try to pull it out of the current sprite
                if ((!sprite[y][x] || sprite[y][x].isTransparent()) && pixel && !pixel.isTransparent()) {
                    sprite[y][x] = pixel
                }
            }
        }
    })
    return sprite
}

class TerminalUI {
    private _gameData: GameData
    private _engine: GameEngine
    private _cellColorCache: CellColorCache
    private _renderedPixels: {hex: string, chars: string}[][] // string is the hex code of the pixel
    private _resizeHandler?: () => void
    private _windowOffsetColStart: number
    private _windowOffsetRowStart: number
    private _windowOffsetWidth: number
    private _windowOffsetHeight: number
    PIXEL_WIDTH: number // number of characters in the terminal used to represent a pixel
    PIXEL_HEIGHT: number
    private SPRITE_WIDTH: number
    private SPRITE_HEIGHT: number

    private _dumpingScreen: boolean

    constructor() {
        this._cellColorCache = new CellColorCache()
        this._resizeHandler = null
        this._renderedPixels = []
        this._windowOffsetColStart = 0
        this._windowOffsetRowStart = 0
        this._dumpingScreen = false
        this.setSmallTerminal(false) // use really big (but cleaner) characters
    }
    setGame(engine: GameEngine) {
        this._engine = engine
        this._gameData = engine.getGameData()
        this._cellColorCache.clear()
        this._renderedPixels = []

        // reset flickscreen and zoomscreen settings
        this._windowOffsetColStart = 0
        this._windowOffsetRowStart = 0

        this._windowOffsetWidth = null
        this._windowOffsetHeight = null
        if (this._gameData.metadata.flickscreen) {
            const { width, height } = this._gameData.metadata.flickscreen
            this._windowOffsetWidth = width
            this._windowOffsetHeight = height
        } else if (this._gameData.metadata.zoomscreen) {
            const { width, height } = this._gameData.metadata.zoomscreen
            this._windowOffsetWidth = width
            this._windowOffsetHeight = height
        }

        // Set the sprite width/height based on the 1st sprite (default is 5x5)
        // TODO: Loop until we find an actual sprite, not a single-color sprite
        const {spriteHeight, spriteWidth} = this.getSpriteSize(this._gameData)
        this.SPRITE_HEIGHT = spriteHeight
        this.SPRITE_WIDTH = spriteWidth
    }
    setSmallTerminal(yesNo: boolean) {
        if (yesNo) {
            this.PIXEL_WIDTH = 1 // number of characters in the terminal used to represent a pixel
            this.PIXEL_HEIGHT = .5
        } else {
            this.PIXEL_WIDTH = 2
            this.PIXEL_HEIGHT = 1
        }
    }
    private isConfiguredForSmallTerminal() {
        return this.PIXEL_HEIGHT !== 1
    }
    private getSpriteSize(gameData: GameData) {
        const firstSpriteWithPixels = gameData.objects.filter(sprite => sprite.hasPixels())[0]
        if (firstSpriteWithPixels) {
            const firstSpritePixels = firstSpriteWithPixels.getPixels(1, 1) // We don't care about these args
            return {
                spriteHeight: firstSpritePixels.length,
                spriteWidth: firstSpritePixels[0].length
            }
        } else {
            // All the sprites are just a single color, so set the size to be 5x5
            return {
                spriteHeight: 1,
                spriteWidth: 1
            }
        }
    }
    debugRenderScreen() {
        if (this._engine) {
            this.renderScreen(true)
        }
    }
    dumpScreen() {
        // Used by unit tests when one of the games fails to complete or completes prematurely
        this._dumpingScreen = true
        this.renderScreen(false)
        this._dumpingScreen = false

        process.stdout.write('\n')
        for (let y = 0; y < this._renderedPixels.length; y++) {
            const row = this._renderedPixels[y]
            if (!row) { continue }
            for (let x = 0; x < row.length; x++) {
                let {hex, chars} = row[x]

                writeBgColor(hex)
                if (chars.length === 1) { chars = ' ' + chars }
                if (chars.length === 0) { chars = '  ' }
                process.stdout.write(chars)
            }
            writeBgColor('#000000')
            process.stdout.write('\n')
        }
        process.stdout.write('\n')
        process.stdout.write('\n')
        process.stdout.write('\n')
    }
    renderScreen(clearCaches: boolean, renderScreenDepth: number = 0) {
        if (!supportsColor.stdout) {
            console.log('Playing a game in the console requires color support. Unfortunately, color is not supported so not rendering (for now). We could just do an ASCII dump or something, using  ░▒▓█ to denote shades of cells')
            return
        }

        const level = this._engine.getCurrentLevel()
        if (!level.isMap()) {
            function prettyKey(keyCode) {
                return chalk.whiteBright.bgWhite(`[${chalk.black(keyCode)}]`);
            }

            this.clearScreen()
            console.log(``)
            console.log(``)
            console.log(``)
            console.log(``)
            console.log(``)
            console.log(``)
            console.log(chalk.bold.whiteBright(level.getMessage()))
            console.log(``)
            console.log(``)
            console.log(``)
            console.log(``)
            console.log(``)
            console.log(``)
            console.log(chalk.white(`Press Action (${chalk.bold.whiteBright('X')} or ${chalk.bold.whiteBright('space')} or ${chalk.bold.whiteBright('enter')}) to Continue`))
            console.log(``)
            console.log(``)
            console.log(``)
            console.log(``)
            console.log(chalk.dim(`NOTE: these messages will be bigger. Submit a Pull Request!)`))

            return
        }

        // Otherwise, the level is a Map so render the cells
        const levelRows = this._engine.getCurrentLevelCells()

        if (clearCaches) {
            this._cellColorCache.clear()
            this._renderedPixels = []
        }

        // Handle resize events by redrawing the game. Ooh, we do not have Cells at this point.
        // TODO Run renderScreen on cells from the engine rather than cells from the Level data
        if (!this._resizeHandler) {
            this._resizeHandler = _.debounce(() => {
                this.clearScreen()
                this.renderScreen(true)
            })
            process.stdout.on('resize', this._resizeHandler)
        }

        levelRows.forEach((row, rowIndex) => {
            row.forEach((cell, colIndex) => {
                this.drawCell(cell, false, renderScreenDepth)
            })
        })

        // Just for debugging, print the game title (doing it here helps with Jest rendering correctly)
        this.writeDebug(`"${this._gameData.title}"`)
    }

    private cellPosToXY(cell: Cell) {
        const { colIndex, rowIndex } = cell
        let isOnScreen = true // can be set to false for many reasons
        let cellStartX = -1
        let cellStartY = -1
        if (this._windowOffsetHeight && this._windowOffsetWidth) {
            if (this._windowOffsetColStart > colIndex ||
                this._windowOffsetRowStart > rowIndex ||
                this._windowOffsetColStart + this._windowOffsetWidth <= colIndex ||
                this._windowOffsetRowStart + this._windowOffsetHeight <= rowIndex) {

                // cell is off-screen
                isOnScreen = false
            }
        }
        cellStartX = (colIndex - this._windowOffsetColStart) * this.SPRITE_WIDTH
        cellStartY = (rowIndex - this._windowOffsetRowStart) * this.SPRITE_HEIGHT /*pixels*/

        // Check if the cell can be completely drawn on the screen. If not, print ellipses
        const cellIsTooWide = (cellStartX + this.SPRITE_WIDTH) * this.PIXEL_WIDTH >= process.stdout.columns // 10 because we print 2 chars per pixel
        const cellIsTooHigh = (cellStartY + this.SPRITE_HEIGHT) * this.PIXEL_HEIGHT >= process.stdout.rows
        if (cellIsTooWide || cellIsTooHigh) {
            // do not draw the cell
            isOnScreen = false
        }

        if (cellStartX < 0 || cellStartY < 0) {
            isOnScreen = false
        }
        return { isOnScreen, cellStartX, cellStartY }
    }

    private setPixel(x: number, y: number, hex: string, fgHex: string, chars: string) {
        const getColor = (y, x) => {
            if (this._renderedPixels[y] && this._renderedPixels[y][x]) {
                return this._renderedPixels[y][x].hex
            } else {
                return '#000000'
            }
        }
        if (!chars) {
            chars = ' '
        }

        if (chars.length > 2) {
            throw new Error(`BUG: Expected char to be of length 0, 1, or 2`)
        }
        if (!this._renderedPixels[y]) {
            this._renderedPixels[y] = []
        }
        const onScreenPixel = this._renderedPixels[y][x]
        if (!onScreenPixel || onScreenPixel.hex !== hex || onScreenPixel.chars !== chars) {
            this._renderedPixels[y][x] = {hex, chars}

            if (this._dumpingScreen) {
                return // don't actually render the pixel
            }
            if (this.PIXEL_HEIGHT === 1) {
                drawPixelChar(x * this.PIXEL_WIDTH, y + 1/*titlebar*/, fgHex, hex, chars[0] || ' ')
                drawPixelChar(x * this.PIXEL_WIDTH + 1, y + 1/*titlebar*/, fgHex, hex, chars[1] || ' ')
            } else {
                let upperColor
                let lowerColor
                if (y % 2 === 0) {
                    upperColor = hex
                    lowerColor = getColor(y + 1, x)
                } else {
                    upperColor = getColor(y - 1, x)
                    lowerColor = hex
                }
                drawPixelChar(x * this.PIXEL_WIDTH, Math.floor(y * this.PIXEL_HEIGHT) + 1/*titlebar*/, lowerColor, upperColor, '▄')
            }
        }
    }


    // Returns true if the window was moved (so we can re-render the screen)
    private recenterPlayerIfNeeded(playerCell: Cell, isOnScreen: boolean) {
        let boundingBoxLeft
        let boundingBoxTop
        let boundingBoxWidth
        let boundingBoxHeight

        const windowLeft = this._windowOffsetColStart
        const windowTop = this._windowOffsetRowStart
        let windowWidth
        let windowHeight

        const flickScreen = this._gameData.metadata.flickscreen
        const zoomScreen = this._gameData.metadata.zoomscreen
        // these are number of sprites that can fit on the terminal
        const terminalWidth = Math.floor(process.stdout.columns / this.SPRITE_WIDTH / this.PIXEL_WIDTH)
        const terminalHeight = Math.floor(process.stdout.rows / this.SPRITE_HEIGHT / this.PIXEL_HEIGHT)

        if (flickScreen) {
            boundingBoxTop = playerCell.rowIndex - (playerCell.rowIndex % flickScreen.height)
            boundingBoxLeft = playerCell.colIndex - (playerCell.colIndex % flickScreen.width)
            boundingBoxHeight = flickScreen.height
            boundingBoxWidth = flickScreen.width
        } else {
            boundingBoxLeft = 0
            boundingBoxTop = 0
            boundingBoxHeight = this._engine.getCurrentLevelCells().length
            boundingBoxWidth = this._engine.getCurrentLevelCells()[0].length
        }

        if (zoomScreen) {
            windowHeight = Math.min(zoomScreen.height, terminalHeight)
            windowWidth = Math.min(zoomScreen.width, terminalWidth)
        } else {
            windowHeight = terminalHeight
            windowWidth = terminalWidth
        }


        // If the boundingbox is larger than the window then we need to apply the zoom
        // which means we need to pan whenever the player moves out of the middle 1/2 of
        // the screen.
        if (boundingBoxHeight <= windowHeight && boundingBoxWidth <= windowWidth) {
            // just ensure that the player is on the screen
            if (isOnScreen) {
            } else {
                this._windowOffsetColStart = boundingBoxLeft
                this._windowOffsetRowStart = boundingBoxTop
                return true
            }
        } else {
            // Move the screen so that the player is centered*
            // Except when we are at one of the edges of the level/flickscreen

            //Check the left and then the top
            let didADirectionChange = false

            if (boundingBoxWidth > windowWidth) {
                if (windowLeft + Math.round(windowWidth / 4) > playerCell.colIndex ||
                    windowLeft + Math.round(windowWidth * 3 / 4) <= playerCell.colIndex) {

                    let newWindowLeft = playerCell.colIndex - Math.floor(windowWidth / 2)
                    // Check the near sides of the bounding box (left)
                    newWindowLeft = Math.max(newWindowLeft, boundingBoxLeft)
                    // Check the far sides of the bounding box (right)
                    if (newWindowLeft + windowWidth > boundingBoxLeft + boundingBoxWidth) {
                        newWindowLeft = boundingBoxLeft + boundingBoxWidth - windowWidth
                    }

                    if (newWindowLeft !== this._windowOffsetColStart) {
                        this._windowOffsetColStart = newWindowLeft
                        didADirectionChange = true
                    }
                }
            }

            // This is copy/pasta'd from above but adjusted for Top instead of Left
            if (boundingBoxHeight > windowHeight) {
                if (windowTop + Math.round(windowHeight / 4) > playerCell.rowIndex ||
                    windowTop + Math.round(windowHeight * 3 / 4) <= playerCell.rowIndex) {

                    let newWindowTop = playerCell.rowIndex - Math.floor(windowHeight / 2)

                    // Check the near sides of the bounding box (top)
                    newWindowTop = Math.max(newWindowTop, boundingBoxTop)

                    // Check the far sides of the bounding box (bottom)
                    if (newWindowTop + windowHeight > boundingBoxTop + boundingBoxHeight) {
                        newWindowTop = boundingBoxTop + boundingBoxHeight - windowHeight
                    }

                    // Only recenter the axis that moved to be out-of-center
                    // Use Math.abs() because an even number of cells visible (e.g. 4) will cause the screen to clicker back and forth
                    if (newWindowTop !== this._windowOffsetRowStart) {
                        this._windowOffsetRowStart = newWindowTop
                        didADirectionChange = true
                    }
                }
            }

            if (!didADirectionChange) {
                // cell is within the middle of the window.
                // just ensure that the player is on the screen
                if (isOnScreen) {
                } else {
                    this._windowOffsetColStart = boundingBoxLeft
                    this._windowOffsetRowStart = boundingBoxTop
                    return true
                }

            }
            return didADirectionChange
        }

        return false
    }

    drawCell(cell: Cell, dontRestoreCursor: boolean, renderScreenDepth: number = 0) {
        const { rowIndex, colIndex } = cell
        if (!supportsColor.stdout) {
            console.log(`Updating cell [${cell.rowIndex}][${cell.colIndex}] to have sprites: [${cell.getSprites().map(sprite => sprite._name)}]`)
            return
        }

        const spritesForDebugging = cell.getSprites().filter(s => !s.isBackground())

        let { isOnScreen, cellStartX, cellStartY } = this.cellPosToXY(cell)

        // Sort of HACKy... If the player is not visible on the screen then we need to
        // move the screen so that they are visible.
        const playerTile = this._gameData.getPlayer()
        const cellHasPlayer = playerTile.matchesCell(cell)
        if (playerTile.getCellsThatMatch().size === 1 && cellHasPlayer) {
            // if the screen can only show an even number of cells (eg 4) then this will oscillate indefinitely
            // So we limit the recursion to just a couple of recursions
            if (renderScreenDepth <= 1) {
                if (this.recenterPlayerIfNeeded(cell, isOnScreen)) {
                    return this.renderScreen(false, renderScreenDepth + 1)
                }
            }
            // otherwise, keep rendering cells like normal
        }

        if (!isOnScreen) {
            return // no need to render because it is off-screen
        }
        const pixels: IColor[][] = this.getPixelsForCell(cell)
        pixels.forEach((spriteRow, spriteRowIndex) => {
            spriteRow.forEach((spriteColor: IColor, spriteColIndex) => {
                const x = cellStartX + spriteColIndex
                const y = cellStartY + spriteRowIndex

                let color: IColor

                if (spriteColor) {
                    if (!spriteColor.isTransparent()) {
                        color = spriteColor
                    }
                    else if (this._gameData.metadata.background_color) {
                        color = this._gameData.metadata.background_color
                    }
                }

                if (!!color) {
                    const { r, g, b } = color.toRgb()
                    const hex = color.toHex()
                    let fgHex = null

                    let chars = ' '

                    // Print a debug number which contains the number of sprites in this cell
                    // Change the foreground color to be black if the color is light
                    if (process.env['NODE_ENV'] === 'development') {
                        if (r > 192 && g > 192 && b > 192) {
                            fgHex = '#000000'
                        } else {
                            fgHex = '#ffffff'
                        }
                        const sprite = spritesForDebugging[spriteRowIndex]
                        if (sprite) {
                            let spriteName = sprite._name
                            let wantsToMove

                            switch (cell.getWantsToMove(sprite)) {
                                case RULE_DIRECTION_ABSOLUTE.STATIONARY:
                                    wantsToMove = ''
                                    break
                                case RULE_DIRECTION_ABSOLUTE.UP:
                                    wantsToMove = '^'
                                    break
                                case RULE_DIRECTION_ABSOLUTE.DOWN:
                                    wantsToMove = 'v'
                                    break
                                case RULE_DIRECTION_ABSOLUTE.LEFT:
                                    wantsToMove = '<'
                                    break
                                case RULE_DIRECTION_ABSOLUTE.RIGHT:
                                    wantsToMove = '>'
                                    break
                                case RULE_DIRECTION_ABSOLUTE.ACTION:
                                    wantsToMove = 'X'
                                    break
                                default:
                                    throw new Error(`BUG: Invalid wantsToMove "${cell.getWantsToMove(sprite)}"`)
                            }
                            spriteName = `${wantsToMove}${spriteName}`
                            if (spriteName.length > 10) {
                                spriteName = `${spriteName.substring(0, 5)}.${spriteName.substring(spriteName.length - 4)}`
                            }
                            const msg = `${spriteName.substring(spriteColIndex * 2, spriteColIndex * 2 + 2)}`
                            chars = msg.substring(0, 2)
                        }
                        if (spriteRowIndex === 4 && spriteColIndex === 4) {
                            if (spritesForDebugging.length > 9) {
                                chars = `${spritesForDebugging.length}`
                            } else {
                                chars = ` ${spritesForDebugging.length}`
                            }
                        }
                    }


                    this.setPixel(x, y, hex, fgHex, chars)

                }
            })
        })

        if (!dontRestoreCursor) {
            restoreCursor()
        }
    }

    private getPixelsForCell(cell: Cell) {
        const spritesToDraw = cell.getSprites() // Not sure why, but entanglement renders properly when reversed

        // If there is a magic background object then rely on it last
        let magicBackgroundSprite = this._gameData.getMagicBackgroundSprite()
        if (magicBackgroundSprite) {
            spritesToDraw.push(magicBackgroundSprite)
        }

        const pixels = this._cellColorCache.get(spritesToDraw, this._gameData.metadata.background_color, this.SPRITE_HEIGHT, this.SPRITE_WIDTH)
        return pixels
    }

    clearScreen() {
        if (!supportsColor.stdout) {
            console.log(`Clearing screen`)
            return
        }

        // clear the cache of what is rendered
        this._renderedPixels = []

        writeFgColor('#ffffff')
        writeBgColor('#000000')
        // Output \n for each row that we have. That way any output from before is preserved
        // const rows = process.stdout.rows || 0
        // for (let i = 0; i < rows; i++) {
        //   console.log('\n')
        // }
        clearScreen()
    }

    writeDebug(text: string) {
        if (!supportsColor.stdout) {
            console.log(`Writing Debug text "${text}"`)
            return
        }
        if (!this._dumpingScreen) {
            writeFgColor('#ffffff')
            writeBgColor('#000000')
            writeText(0, 0, `[${text}]`)
        }
    }

    willAllLevelsFitOnScreen(gameData: GameData) {
        let maxWidth = 0
        let maxHeight = 0
        const {flickscreen, zoomscreen} = gameData.metadata
        if (flickscreen) {
            maxWidth = flickscreen.width
            maxHeight = flickscreen.height
        } else if (zoomscreen) {
            maxWidth = zoomscreen.width
            maxHeight = zoomscreen.height
        } else {
            // loop through all the levels and find the largest one
            for (const level of gameData.levels) {
                if (level.isMap()) {
                    maxWidth = Math.max(maxWidth, level.getWidth())
                    maxHeight = Math.max(maxHeight, level.getHeight())
                }
            }
        }
        // Check to see if it fits in the terminal
        const {spriteHeight, spriteWidth} = this.getSpriteSize(gameData)
        const terminalWidth = Math.floor(process.stdout.columns / spriteWidth / this.PIXEL_WIDTH)
        const terminalHeight = Math.floor(process.stdout.rows / spriteHeight / this.PIXEL_HEIGHT)

        if (terminalWidth < maxWidth || terminalHeight < maxHeight) {
            return false
        } else {
            return true
        }
    }

    _drawPixel(x, y, fgHex, bgHex, chars) {
        drawPixelChar(x, y, fgHex, bgHex, chars)
    }
}

function restoreCursor() {
    if (!supportsColor.stdout) {
        return
    }
    process.stdout.write([
        setFgColor('#ffffff'),
        setBgColor('#000000'),
        setMoveTo(process.stdout.columns, process.stdout.rows)
    ].join(''))
}

function writeText(x: number, y: number, text: string) {
    if (!supportsColor.stdout) {
        console.log(`Writing text at [${y}][${x}]: "${text}"`)
        return
    }
    writeTextAt(x, y, text)
    restoreCursor()
}

export default new TerminalUI()

// Mac terminal does not render all the colors so some pixels do not look different.
// See 391852197b1aef15558342df2670d635 (the grid)
// for (let r = 0; r < 256; r+=16) {
//   for (let g = 0; g < 256; g+=16) {
//     for (let b = 0; b < 256; b+=16) {
//       console.log(ansiStyles.bgColor.ansi16m.rgb(r, g, b) + ' ' + ansiStyles.bgColor.close)
//     }
//     console.log(ansiStyles.bgColor.ansi16m.rgb(0, 0, 0) + '\n' + ansiStyles.bgColor.close)
//   }
//   console.log(ansiStyles.bgColor.ansi16m.rgb(0, 0, 0) + '\n' + ansiStyles.bgColor.close)
// }