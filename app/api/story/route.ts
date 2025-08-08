import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { generateText } from 'ai'
import { openai } from '@ai-sdk/openai'
import { type GameWorldKey, WORLDS, type StoryOutline } from '@/lib/game'

const stories = new Map<string, StoryOutline>()

const RequestSchema = z.object({
  sessionId: z.string().min(1),
  worldKey: z.enum(['wiedzmin','forgotten-realms','elder-scrolls','gothic','dragon-age']),
  players: z.array(z.object({
    name: z.string().min(1),
    cls: z.string().min(1),
  })).min(1).max(4),
  seed: z.string().optional(),
})

export async function POST(req: NextRequest) {
  try {
    const parse = RequestSchema.safeParse(await req.json())
    if (!parse.success) return NextResponse.json({ error: 'Invalid payload', issues: parse.error.issues }, { status: 400 })
    const { sessionId, worldKey, players, seed } = parse.data
    const world = WORLDS[worldKey as GameWorldKey]

    if (!process.env.OPENAI_API_KEY) {
      // Offline simple scaffold
      const outline: StoryOutline = {
        worldKey,
        synopsis: `Krótka kampania w świecie "${world.name}": drużyna (${players.map(p=>`${p.name}-${p.cls}`).join(', ')}) staje wobec tajemnicy pradawnego lasu.`,
        acts: [
          { title: 'Akt I: Szept drzew', summary: 'Drużyna odkrywa zwiastuny większego zagrożenia.', scenes: [
            { title: 'Polana run', goal: 'Odczytaj znak', hooks: ['Świetliki układają wzór', 'Szmer ostrzeżeń'], dangers: ['Wilki', 'Pułapki z zarośli'] },
            { title: 'Chata pustelnika', goal: 'Zdobądź wskazówki', hooks: ['Mapa z kory', 'Zagadka'], dangers: ['Nieufność', 'Przekleństwo'] },
          ]},
          { title: 'Akt II: Ciemny trakt', summary: 'Wędrówka przez niebezpieczne ostępy.', scenes: [
            { title: 'Wąwóz echa', goal: 'Przetrwaj zasadzki', hooks: ['Głos zza skał'], dangers: ['Bandyci', 'Zwalone pnie'] },
          ]},
          { title: 'Akt III: Serce dębu', summary: 'Konfrontacja i finał.', scenes: [
            { title: 'Korzenie', goal: 'Wypełnij cel', hooks: ['Pulsujące światło'], dangers: ['Strażnik', 'Korzenie więżące'] },
          ]},
        ],
      }
      stories.set(sessionId, outline)
      return NextResponse.json({ outline })
    }

    const system = [
      'Jesteś polskim Mistrzem Gry i generujesz zwięzły, grywalny zarys kampanii w strukturze JSON.',
      'Świat będzie zgodny z opisem, bez używania zastrzeżonych nazw z IP.',
      'JSON ma mieć format: { "synopsis": string, "acts": [ { "title": string, "summary": string, "scenes": [ { "title": string, "goal": string, "hooks": string[], "dangers": string[] } ] } ] }',
      'Utrzymaj leśny klimat i tempo scen.',
      'Zwróć wyłącznie czysty JSON w ```{...}``` bez komentarzy.',
    ].join(' ')

    const prompt = [
      `Świat: ${world.name}. Opis: ${world.description}. Wskazówki: ${world.styleHints}.`,
      `Zasady bezpieczeństwa: ${world.contentGuidelines}.`,
      `Drużyna: ${players.map(p=>`${p.name} (${p.cls})`).join(', ')}.`,
      seed ? `Ziarno fabuły: ${seed}.` : '',
      'Przygotuj 3 akty. Każdy akt 1-3 scen. Zakończ finałem.',
    ].filter(Boolean).join(' ')

    const { text } = await generateText({
      model: openai(process.env.OPENAI_MODEL || 'gpt-4o-mini'),
      system,
      prompt,
      maxOutputTokens: 500,
    }) // AI SDK generateText + OpenAI integration [^1]

    const outline = extractJSON<StoryOutline>(text)
    if (!outline) return NextResponse.json({ error: 'Nie udało się zbudować zarysu historii' }, { status: 500 })

    stories.set(sessionId, { ...outline, worldKey })
    return NextResponse.json({ outline: { ...outline, worldKey } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Story error' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const sessionId = searchParams.get('sessionId') || ''
  if (!sessionId) return NextResponse.json({ error: 'Brak sessionId' }, { status: 400 })
  const outline = stories.get(sessionId) || null
  return NextResponse.json({ outline })
}

function extractJSON<T>(text: string): T | null {
  const m = text.match(/```([\s\S]*?)```/)
  try {
    const raw = m ? m[1] : text
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}
