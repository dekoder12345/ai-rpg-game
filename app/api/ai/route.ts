import { NextRequest, NextResponse } from 'next/server'
import { generateText } from 'ai'
import { openai } from '@ai-sdk/openai'
import { type GameState } from '@/lib/game'

// In-memory session store for demo
const sessions = new Map<string, GameState>()

export async function POST(req: NextRequest) {
  try {
    const { sessionId, playerAction, diceRoll, gameState, isIntro } = (await req.json()) as {
      sessionId: string
      playerAction: string
      diceRoll: number | null
      gameState: GameState
      isIntro?: boolean
    }

    const current = sessions.get(sessionId) ?? gameState
    sessions.set(sessionId, current)

    const system = [
      'Jesteś polskim Mistrzem Gry fantasy (MG) w stylu tekstowej gry RPG.',
      'Odpowiadasz żywymi opisami świata, konsekwencjami działań gracza i proponujesz 2-3 krótkie możliwe następne kroki.',
      'Utrzymuj odpowiedzi zwięzłe (maks 120-160 słów), tak aby mieściły się w oknie dialogowym, ale bogate w detal.',
      'Zawsze odpowiadaj po polsku. Nie używaj markdown.',
      'Na końcu odpowiedzi nie dodawaj żadnych technicznych komentarzy.',
      'Zwróć również ukryty blok efektów w czystym JSON w trzech backtickach (```{...}```), który MG nie wypowiada na głos.',
      'JSON "effects" może zawierać: hp (liczba), mana (liczba), inventory (string[]), questLog (string[]), goal (string), isOver (boolean), outcome ("win"|"lose"|null).',
      'Zmniejsz HP do 0 i ustaw isOver=true,outcome="lose" jeśli wynik walki śmiertelny lub hp<=0. Ustaw isOver=true i outcome="win" jeśli cel misji został osiągnięty.',
    ].join(' ')

    const statText = `Statystyki: HP=${current.hp}/${current.stats.hpBase}, Mana=${current.mana}/${current.stats.manaBase}, Siła=${current.stats.strength}, Zręczność=${current.stats.dexterity}, Mądrość=${current.stats.wisdom}.`
    const invText = `Ekwipunek: ${current.inventory.join(', ') || 'pusty'}.`
    const questText = `Cel: ${current.goal || 'nieustalony'}. Dziennik: ${current.questLog.join('; ') || '—'}.`
    const introHint = isIntro
      ? 'Rozpocznij przygodę w pikselowym, leśnym klimacie. Przedstaw tło, sojuszników/niebezpieczeństwa oraz wyraźny cel misji w jednym zdaniu.'
      : ''

    const userPrompt = [
      introHint,
      `Akcja gracza: ${playerAction || '(intro)'}.`,
      diceRoll != null ? `Wynik testu (k20 + mod): ${diceRoll}. Uwzględnij konsekwencje.` : '',
      statText,
      invText,
      questText,
      'Zakończ odpowiedź propozycją 2-3 krótkich następnych kroków gracza.',
      'Po odpowiedzi dołącz blok efektów w ```{...}```.',
    ].filter(Boolean).join(' ')

    const { text } = await generateText({
      model: openai(process.env.OPENAI_MODEL || 'gpt-4o-mini'),
      system,
      prompt: userPrompt,
    }) // AI SDK generateText with OpenAI integration [^1]

    const effects = safeExtractEffects(text)
    const narration = text.replace(/```[\s\S]*?```/g, '').trim()

    if (effects) {
      const next = {
        ...current,
        hp: effects.hp ?? current.hp,
        mana: effects.mana ?? current.mana,
        inventory: effects.inventory ?? current.inventory,
        questLog: effects.questLog ?? current.questLog,
        goal: effects.goal ?? current.goal,
        isOver: effects.isOver ?? current.isOver,
        outcome: (effects as any).outcome ?? current.outcome,
      } as GameState
      sessions.set(sessionId, next)
    }

    return NextResponse.json({ narration, effects: effects || null })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'AI error' }, { status: 500 })
  }
}

function safeExtractEffects(text: string): Partial<GameState> | null {
  const match = text.match(/```([\s\S]*?)```/)
  if (!match) return null
  try {
    const obj = JSON.parse(match[1])
    if (obj && typeof obj === 'object') return obj as Partial<GameState>
  } catch {}
  return null
}
