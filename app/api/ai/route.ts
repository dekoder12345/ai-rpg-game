import { NextRequest, NextResponse } from 'next/server'
import { generateText } from 'ai'
import { openai } from '@ai-sdk/openai'
import { z } from 'zod'
import { type GameState, type StoryOutline } from '@/lib/game'

// In-memory session store for demo
const sessions = new Map<string, GameState>()
const stories = new Map<string, StoryOutline>() // optional mirror if needed

const RequestSchema = z.object({
  sessionId: z.string().min(1),
  playerAction: z.string(),
  diceRoll: z.number().int().min(0).max(60).nullable(),
  gameState: z.any(),
  isIntro: z.boolean().optional(),
  playerIndex: z.number().int().min(0).max(3).default(0),
})

export async function POST(req: NextRequest) {
  try {
    const parse = RequestSchema.safeParse(await req.json())
    if (!parse.success) {
      return NextResponse.json({ error: 'Invalid payload', issues: parse.error.issues }, { status: 400 })
    }
    const { sessionId, playerAction, diceRoll, gameState, isIntro, playerIndex } = parse.data

    const current = sessions.get(sessionId) ?? (gameState as GameState)
    sessions.set(sessionId, current)
    const outline = (current.story || stories.get(sessionId) || null) as StoryOutline | null

    // OFFLINE mode
    if (!process.env.OPENAI_API_KEY) {
      const offline = offlineNarrate({ playerAction, diceRoll, current, isIntro: !!isIntro, playerIndex })
      const next = applyEffects(current, offline.effects, playerIndex)
      sessions.set(sessionId, next)
      return NextResponse.json(offline)
    }

    const worldName = current.world?.name || 'Leśna Kraina'
    const worldStyle = current.world?.styleHints || ''
    const system = [
      'Jesteś polskim Mistrzem Gry fantasy (MG) w stylu tekstowej gry RPG.',
      'Uwzględniaj wybrany świat, drużynę oraz zarys kampanii.',
      'Odpowiadaj barwnie, ale zwięźle (120–160 słów). Zawsze po polsku, bez markdown.',
      'Zaproponuj 2–3 kolejne kroki.',
      'Dodatkowo zwróć blok efektów w ```{...}``` (czysty JSON, bez komentarzy).',
      'effects może zawierać: goal, questLog, isOver, outcome,',
      'oraz dla aktywnego gracza: actorHp, actorMana, actorInventory (pełna lista) lub actorAddItems/actorRemoveItems (listy).',
    ].join(' ')

    const party = current.players.map((p, i) =>
      `${i === playerIndex ? '[AKTYWNY]' : ''}${p.name} (${p.cls}) HP:${p.hp}/${p.stats.hpBase} Mana:${p.mana}/${p.stats.manaBase}`
    ).join(' | ')

    const storySynopsis = outline ? `Zarys: ${outline.synopsis}. Najbliższe sceny: ${outline.acts.map(a => a.scenes[0]?.title).filter(Boolean).slice(0,2).join(', ')}.` : 'Zarys: wkrótce rozwinie się przygoda.'

    const userPrompt = [
      isIntro ? `Rozpocznij przygodę w świecie: ${worldName}. Styl: ${worldStyle}.` : '',
      storySynopsis,
      `Drużyna: ${party}.`,
      `Akcja gracza (${current.players[playerIndex]?.name || 'Gracz'}): ${playerAction || '(intro)'}.`,
      diceRoll != null ? `Wynik testu (k20 + mod): ${diceRoll}. Uwzględnij konsekwencje.` : '',
      current.goal ? `Cel misji: ${current.goal}.` : '',
      current.questLog.length ? `Dziennik: ${current.questLog.join('; ')}` : '',
      'Po narracji zwróć effects w ```{...}``` zgodnie z opisem.',
    ].filter(Boolean).join(' ')

    const { text } = await generateText({
      model: openai(process.env.OPENAI_MODEL || 'gpt-4o-mini'),
      system,
      prompt: userPrompt,
      maxOutputTokens: 380,
    }) // AI SDK generateText + OpenAI integration [^1]

    const effects = safeExtractEffects(text)
    const narration = text.replace(/```[\s\S]*?```/g, '').trim()

    const next = applyEffects(current, effects || {}, playerIndex)
    sessions.set(sessionId, next)

    return NextResponse.json({ narration, effects: effects || null })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'AI error' }, { status: 500 })
  }
}

function safeExtractEffects(text: string): any | null {
  const match = text.match(/```([\s\S]*?)```/)
  if (!match) return null
  try {
    const obj = JSON.parse(match[1])
    if (obj && typeof obj === 'object') return obj
  } catch {}
  return null
}

function applyEffects(current: GameState, eff: any, actorIndex: number): GameState {
  const next = structuredClone(current) as GameState
  // Global
  if (typeof eff.goal === 'string') next.goal = eff.goal
  if (Array.isArray(eff.questLog)) next.questLog = eff.questLog
  if (typeof eff.isOver === 'boolean') next.isOver = eff.isOver
  if (typeof eff.outcome === 'string') next.outcome = eff.outcome

  const actor = next.players[actorIndex]
  if (actor) {
    if (typeof eff.actorHp === 'number') actor.hp = Math.max(0, Math.min(actor.stats.hpBase, eff.actorHp))
    if (typeof eff.actorMana === 'number') actor.mana = Math.max(0, Math.min(actor.stats.manaBase, eff.actorMana))
    if (Array.isArray(eff.actorInventory)) actor.inventory = eff.actorInventory
    if (Array.isArray(eff.actorAddItems)) {
      for (const it of eff.actorAddItems) if (!actor.inventory.includes(it)) actor.inventory.push(it)
    }
    if (Array.isArray(eff.actorRemoveItems)) {
      actor.inventory = actor.inventory.filter((i) => !eff.actorRemoveItems.includes(i))
    }
  }

  // Auto-lose if everyone dead
  if (next.players.length && next.players.every(p => p.hp <= 0)) {
    next.isOver = true
    next.outcome = 'lose'
  }
  return next
}

// Offline deterministic narrator (multi-gracz)
function offlineNarrate({
  playerAction,
  diceRoll,
  current,
  isIntro,
  playerIndex,
}: {
  playerAction: string
  diceRoll: number | null
  current: GameState
  isIntro: boolean
  playerIndex: number
}) {
  const actor = current.players[playerIndex]
  const worldName = current.world?.name || 'Leśna Kraina'
  if (isIntro) {
    const goal = 'Odkryj tajemnicę serca pradawnego dębu.'
    const narration =
      `Świetliki tańczą nad mchem. Drużyna stawia pierwszy krok w świecie "${worldName}". ` +
      `Czeka was mroczny trakt i sekrety, które nie lubią światła. Cel: ${goal} ` +
      `Co robicie? (1) Zwiad. (2) Rozmowa z pustelnikiem. (3) Badanie run.`
    return {
      narration,
      effects: {
        goal,
        questLog: [...current.questLog, 'Cel główny wyznaczony.'],
      },
    }
  }

  const roll = diceRoll ?? 10
  const updates: string[] = []
  let actorHp = actor?.hp ?? 10
  let actorMana = actor?.mana ?? 5

  if (roll <= 5) {
    actorHp = Math.max(0, actorHp - 3)
    updates.push(`${actor?.name || 'Bohater'} ponosi straty (-3 HP).`)
  } else if (roll >= 16) {
    actorMana = Math.min((actor?.stats.manaBase ?? 10), actorMana + 1)
    updates.push(`${actor?.name || 'Bohater'} zyskuje rezon z magią (+1 Mana).`)
  } else {
    updates.push('Częściowy sukces – napięcie rośnie.')
  }

  let isOver = current.isOver
  let outcome = current.outcome
  if (current.goal && roll >= 19) {
    isOver = true
    outcome = 'win'
    updates.push('Cel na wyciągnięcie dłoni – zwycięstwo!')
  }
  if (actorHp <= 0 && current.players.every((p, idx) => idx === playerIndex ? actorHp <= 0 : p.hp <= 0)) {
    isOver = true
    outcome = 'lose'
    updates.push('Drużyna pada bez sił...')
  }

  const narration =
    `Akcja: ${playerAction}. Rzut k20: ${roll}. ${updates.join(' ')} ` +
    `Następnie? (1) Atakuj. (2) Rozmawiaj. (3) Przeszukuj.`

  return {
    narration,
    effects: {
      actorHp,
      actorMana,
      questLog: roll >= 12 ? [...current.questLog, `Postęp: ${playerAction}`] : current.questLog,
      isOver,
      outcome,
    },
  }
}
