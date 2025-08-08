export type GameClass = 'Wojownik' | 'Mag' | 'Łotrzyk' | 'Zielarz'

export type RoleMsg = { role: 'system' | 'assistant' | 'user'; content: string }

export type GameStats = {
  strength: number
  dexterity: number
  wisdom: number
  hpBase: number
  manaBase: number
  gold: number
}

export type GameState = {
  playerClass: GameClass | null
  stats: GameStats
  hp: number
  mana: number
  inventory: string[]
  questLog: string[]
  goal: string | null
  isOver: boolean
  outcome: 'win' | 'lose' | null
  messages: RoleMsg[]
}

export type GameSave = {
  id: string
  name: string
  createdAt: number
  state: GameState
}

export function emptyGameState(): GameState {
  return {
    playerClass: null,
    stats: { strength: 0, dexterity: 0, wisdom: 0, hpBase: 20, manaBase: 10, gold: 0 },
    hp: 20,
    mana: 10,
    inventory: [],
    questLog: [],
    goal: null,
    isOver: false,
    outcome: null,
    messages: [],
  }
}

export function defaultStatsFor(cls: GameClass): GameStats & { hpBase: number; manaBase: number; gold: number } {
  switch (cls) {
    case 'Wojownik':
      return { strength: 4, dexterity: 1, wisdom: 0, hpBase: 30, manaBase: 5, gold: 10 }
    case 'Mag':
      return { strength: 0, dexterity: 1, wisdom: 4, hpBase: 18, manaBase: 20, gold: 8 }
    case 'Łotrzyk':
      return { strength: 1, dexterity: 4, wisdom: 1, hpBase: 22, manaBase: 8, gold: 14 }
    case 'Zielarz':
      return { strength: 1, dexterity: 1, wisdom: 3, hpBase: 24, manaBase: 12, gold: 12 }
  }
}

export function initialInventory(cls: GameClass): string[] {
  switch (cls) {
    case 'Wojownik':
      return ['Miecz żelazny', 'Tarcza drewniana', 'Porcja suszonego mięsa']
    case 'Mag':
      return ['Laska runiczna', 'Księga Zaklęć', 'Fiolka many']
    case 'Łotrzyk':
      return ['Sztylet', 'Wytrychy', 'Lina z hakiem']
    case 'Zielarz':
      return ['Nóż zielarski', 'Zioła lecznicze', 'Maść z piołunu']
  }
}

export function statLabel(k: keyof Pick<GameStats, 'strength' | 'dexterity' | 'wisdom'>): string {
  if (k === 'strength') return 'Siła'
  if (k === 'dexterity') return 'Zręczność'
  return 'Mądrość'
}
