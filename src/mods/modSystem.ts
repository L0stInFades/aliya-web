/**
 * Aliya Web Mod System
 *
 * This is much simpler and more powerful than Unity's mod system.
 * Mods can be loaded as simple JavaScript/TypeScript files.
 */

export interface Mod {
  id: string
  name: string
  version: string
  description: string
  author: string
  hooks: ModHooks
}

export interface ModHooks {
  // Resource hooks
  onO2Change?: (value: number) => number
  onWaterChange?: (value: number) => number
  onEnergyChange?: (value: number) => number

  // Message hooks
  onSendMessage?: (message: string) => string
  onReceiveMessage?: (message: string) => string

  // Choice hooks
  onChoiceAppear?: (choices: Choice[]) => Choice[]
  onChoiceSelect?: (choiceId: string) => string

  // UI hooks
  onRenderMessage?: (element: HTMLElement) => HTMLElement
  onRenderChoice?: (element: HTMLElement) => HTMLElement

  // Game hooks
  onGameSave?: (data: unknown) => unknown
  onGameLoad?: (data: unknown) => unknown
  onGameUpdate?: (deltaTime: number) => void
}

export interface Choice {
  id: string
  text: string
  nextBlock: string
  hidden?: boolean
}

// Mod Manager
class ModManager {
  private mods: Map<string, Mod> = new Map()
  private activeMods: Set<string> = new Set()

  // Register a mod
  register(mod: Mod) {
    this.mods.set(mod.id, mod)
    console.log(`Mod registered: ${mod.name} v${mod.version}`)
  }

  // Activate a mod
  activate(modId: string) {
    if (this.mods.has(modId)) {
      this.activeMods.add(modId)
      console.log(`Mod activated: ${modId}`)
    }
  }

  // Deactivate a mod
  deactivate(modId: string) {
    this.activeMods.delete(modId)
    console.log(`Mod deactivated: ${modId}`)
  }

  // Get all registered mods
  getMods(): Mod[] {
    return Array.from(this.mods.values())
  }

  // Get active mods
  getActiveMods(): Mod[] {
    return Array.from(this.activeMods)
      .map((id) => this.mods.get(id))
      .filter((mod): mod is Mod => mod !== undefined)
  }

  // Execute hook
  executeHook<T>(hookName: keyof ModHooks, initialValue: T, ...args: unknown[]): T {
    let value = initialValue

    for (const mod of this.getActiveMods()) {
      const hook = mod.hooks[hookName]
      if (hook) {
        try {
          value = (hook as (currentValue: T, ...hookArgs: unknown[]) => T)(value, ...args)
        } catch (error) {
          console.error(`Error executing hook ${hookName} in mod ${mod.id}:`, error)
        }
      }
    }

    return value
  }
}

// Singleton instance
export const modManager = new ModManager()

// Example: Infinite O2 Mod
export const infiniteO2Mod: Mod = {
  id: 'infinite-o2',
  name: 'Infinite O2',
  version: '1.0.0',
  description: 'Makes oxygen infinite',
  author: 'Modder',
  hooks: {
    onO2Change: (_value) => 100 // Always return 100
  }
}

// Example: Skip Wait Mod
export const skipWaitMod: Mod = {
  id: 'skip-wait',
  name: 'Skip Wait',
  version: '1.0.0',
  description: 'Skips all wait times',
  author: 'Modder',
  hooks: {
    // This would hook into the wait system
  }
}

// Example: Custom Dialogue Mod
export const customDialogueMod: Mod = {
  id: 'custom-dialogue',
  name: 'Custom Dialogue',
  version: '1.0.0',
  description: 'Adds custom dialogue options',
  author: 'Modder',
  hooks: {
    onChoiceAppear: (choices) => {
      // Add a custom choice
      return [
        ...choices,
        {
          id: 'custom-1',
          text: '[Mod] 这是一个自定义选项',
          nextBlock: 'custom-block'
        }
      ]
    }
  }
}

// Auto-register example mods
modManager.register(infiniteO2Mod)
modManager.register(skipWaitMod)
modManager.register(customDialogueMod)
