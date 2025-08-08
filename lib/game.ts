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

export type Player = {
  id: string
  name: string
  cls: GameClass
  stats: GameStats
  hp: number
  mana: number
  inventory: string[]
}

export type GameWorldKey = 'wiedzmin' | 'forgotten-realms' | 'elder-scrolls' | 'gothic' | 'dragon-age'
export type GameWorld = {
  key: GameWorldKey
  name: string
  description: string
  contentGuidelines: string
  styleHints: string
}

export const WORLDS: Record<GameWorldKey, GameWorld> = {
  'wiedzmin': {
    key: 'wiedzmin',
    name: 'Wiedźmin',
    description: 'Ponury słowiański mrok, potwory, alchemia, polityczne intrygi.',
    contentGuidelines: 'Unikaj bezpośrednich odniesień do licencjonowanych postaci. Generuj oryginalne miejsca i imiona inspirowane klimatem.',
    styleHints: 'Gorzki, surowy ton. Las, bagna, opuszczone sioła.',
  },
  'forgotten-realms': {
    key: 'forgotten-realms',
    name: 'Zapomniane Krainy (D&D)',
    description: 'Klasyczne high fantasy: gildie, lochy, smoki, bogowie.',
    contentGuidelines: 'Bez nazw zastrzeżonych marek. Generuj oryginalne miasta i bóstwa w klasycznym duchu.',
    styleHints: 'Heroiczne wyprawy, drużyna, lochy i skarby.',
  },
  'elder-scrolls': {
    key: 'elder-scrolls',
    name: 'Elder Scrolls',
    description: 'Otwarte światy, starożytne ruiny, tajemnicza magia.',
    contentGuidelines: 'Bez nazw własnych z serii. Odwołuj się do motywów (ruiny, pradawne artefakty).',
    styleHints: 'Epicka, opisowa narracja, pradawne proroctwa.',
  },
  'gothic': {
    key: 'gothic',
    name: 'Gothic',
    description: 'Surowa kraina, kolonie górnicze, frakcje i trudne wybory.',
    contentGuidelines: 'Brak znanych nazw. Silna ekspozycja frakcji i zasobów.',
    styleHints: 'Twardy, bezpośredni język, niedostatek i ryzyko.',
  },
  'dragon-age': {
    key: 'dragon-age',
    name: 'Dragon Age',
    description: 'Mroczna fantastyka, herezja, magia okalająca.',
    contentGuidelines: 'Brak konkretnych nazw. Motywy herezji, plagi, łotrów i zakonów.',
    styleHints: 'Mroczny, dojrzały ton, polityka i konsekwencje.',
  },
}

export type StoryScene = {
  title: string
  goal: string
  hooks: string[]
  dangers: string[]
}

export type StoryAct = {
  title: string
  summary: string
  scenes: StoryScene[]
}

export type StoryOutline = {
  worldKey: GameWorldKey
  synopsis: string
  acts: StoryAct[]
}

export type GameState = {
  stateVersion: 2
  world: GameWorld | null
  players: Player[]
  activeIndex: number
  stats: GameStats // legacy fallback, unused for party logic
  hp: number // legacy fallback, unused for party logic
  mana: number // legacy fallback, unused for party logic
  inventory: string[] // legacy fallback, unused for party logic
  questLog: string[]
  goal: string | null
  isOver: boolean
  outcome: 'win' | 'lose' | null
  messages: RoleMsg[]
  story?: StoryOutline | null
}

export type GameSave = {
  id: string
  name: string
  createdAt: number
  state: GameState
}

export function emptyGameState(): GameState {
  return {
    stateVersion: 2,
    world: null,
    players: [],
    activeIndex: 0,
    stats: { strength: 0, dexterity: 0, wisdom: 0, hpBase: 20, manaBase: 10, gold: 0 },
    hp: 20,
    mana: 10,
    inventory: [],
    questLog: [],
    goal: null,
    isOver: false,
    outcome: null,
    messages: [],
    story: null,
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

export function createPlayer(name: string, cls: GameClass): Player {
  const stats = defaultStatsFor(cls)
  return {
    id: crypto.randomUUID(),
    name,
    cls,
    stats,
    hp: stats.hpBase,
    mana: stats.manaBase,
    inventory: initialInventory(cls),
  }
}

export function statLabel(k: keyof Pick<GameStats, 'strength' | 'dexterity' | 'wisdom'>): string {
  if (k === 'strength') return 'Siła'
  if (k === 'dexterity') return 'Zręczność'
  return 'Mądrość'
}
