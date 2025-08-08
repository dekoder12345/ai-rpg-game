'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Axe, BookOpen, Coins, Dice5, FlaskConical, Heart, Home, Menu, MessageSquare, Shield, Swords, SwordsIcon, Wand2, Waypoints } from 'lucide-react'
import Image from 'next/image'
import { cn } from '@/lib/utils'
import { type GameClass, type GameSave, type GameState, defaultStatsFor, emptyGameState, initialInventory, statLabel } from '@/lib/game'
import { useAudio } from '@/lib/sfx'

function useLocalStorage<T>(key: string, initial: T) {
  const [val, setVal] = useState<T>(() => {
    if (typeof window === 'undefined') return initial
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : initial
  })
  useEffect(() => {
    if (typeof window === 'undefined') return
    localStorage.setItem(key, JSON.stringify(val))
  }, [key, val])
  return [val, setVal] as const
}

function ensureSessionId(): string {
  if (typeof window === 'undefined') return ''
  let id = localStorage.getItem('rpg_session_id')
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem('rpg_session_id', id)
  }
  return id
}

const QUICK_ACTIONS = [
  { key: 'attack', label: 'Atakuj', icon: Swords },
  { key: 'talk', label: 'Porozmawiaj', icon: MessageSquare },
  { key: 'search', label: 'Przeszukaj', icon: Waypoints },
  { key: 'defend', label: 'Broń się', icon: Shield },
  { key: 'cast', label: 'Rzuć czar', icon: Wand2 },
  { key: 'use', label: 'Użyj przedmiotu', icon: FlaskConical },
]

export default function Page() {
  const [screen, setScreen] = useLocalStorage<'hero' | 'select' | 'game'>('rpg_screen', 'hero')
  const [state, setState] = useLocalStorage<GameState>('rpg_state', emptyGameState())
  const [input, setInput] = useState('')
  const [rolling, setRolling] = useState(false)
  const [rollResult, setRollResult] = useState<number | null>(null)
  const [isSending, setIsSending] = useState(false)
  const [nav, setNav] = useState<'create' | 'saved' | 'explore'>('create')

  const sessionId = useMemo(() => ensureSessionId(), [])
  const clickSfx = useAudio('/audio/click.mp3', 0.7)
  const diceSfx = useAudio('/audio/dice.mp3', 0.9)

  function resetGameForClass(cls: GameClass) {
    const base = emptyGameState()
    base.playerClass = cls
    base.stats = defaultStatsFor(cls)
    base.inventory = initialInventory(cls)
    base.messages = [
      { role: 'system', content: 'Mistrz Gry: Witaj w leśnej krainie. Wybierz drogę mądrze...' },
    ]
    setState(base)
  }

  function startAdventure(cls: GameClass) {
    clickSfx.play()
    resetGameForClass(cls)
    setScreen('game')
    void sendToAI('(Rozpocznij przygodę i przedstaw cel misji.)', null, true)
  }

  function saveCurrent() {
    clickSfx.play()
    const snapshot: GameSave = {
      id: crypto.randomUUID(),
      name: `Przygoda ${new Date().toLocaleString()}`,
      createdAt: Date.now(),
      state,
    }
    const saves = JSON.parse(localStorage.getItem('rpg_saves') || '[]') as GameSave[]
    const next = [snapshot, ...saves].slice(0, 20)
    localStorage.setItem('rpg_saves', JSON.stringify(next))
    fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, save: snapshot }),
    }).catch(() => {})
  }

  async function sendToAI(action: string, dice: number | null, isIntro = false) {
    setIsSending(true)
    try {
      const body = { sessionId, playerAction: action, diceRoll: dice, gameState: state, isIntro }
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      const messages = [
        ...state.messages,
        ...(action && !isIntro ? [{ role: 'user' as const, content: `Gracz: ${action}` }] : []),
        { role: 'assistant' as const, content: data.narration },
      ]
      const eff = (data.effects ?? {}) as Partial<GameState>
      const next: GameState = {
        ...state,
        messages,
        hp: Math.max(0, eff.hp ?? state.hp),
        mana: Math.max(0, eff.mana ?? state.mana),
        stats: eff.stats ?? state.stats,
        inventory: eff.inventory ?? state.inventory,
        questLog: eff.questLog ?? state.questLog,
        goal: eff.goal ?? state.goal,
        isOver: eff.isOver ?? state.isOver,
        outcome: eff.outcome ?? state.outcome,
      }
      setState(next)
      fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, state: next }),
      }).catch(() => {})
    } catch (e) {
      const messages = [...state.messages, { role: 'assistant' as const, content: 'MG: Coś poszło nie tak z magią Orakla. Spróbuj ponownie.' }]
      setState({ ...state, messages })
    } finally {
      setIsSending(false)
    }
  }

  async function rollAndSend(baseAction: string) {
    diceSfx.play()
    setRolling(true)
    const start = Date.now()
    let current = 1 + Math.floor(Math.random() * 20)
    const interval = setInterval(() => {
      current = 1 + Math.floor(Math.random() * 20)
      setRollResult(current)
      if (Date.now() - start > 900) {
        clearInterval(interval)
        setRolling(false)
        setRollResult(current)
        const relevant = guessRelevantStat(baseAction, state.playerClass)
        const mod = state.stats[relevant] ?? 0
        const total = current + mod
        void sendToAI(`${baseAction} (rzucono k20=${current} + modyfikator ${statLabel(relevant)}=${mod} => wynik ${total})`, total, false)
      }
    }, 60)
  }

  function guessRelevantStat(action: string, cls: GameClass | null) {
    const a = action.toLowerCase()
    if (a.includes('atak') || a.includes('cios') || a.includes('walcz')) return 'strength'
    if (a.includes('rozm') || a.includes('persw') || a.includes('ucisz') || a.includes('negoc')) return 'wisdom'
    if (a.includes('szuk') || a.includes('skr') || a.includes('unik') || a.includes('zwin')) return 'dexterity'
    if (a.includes('czar') || a.includes('zakl') || a.includes('mag')) return 'wisdom'
    if (cls === 'Wojownik') return 'strength'
    if (cls === 'Łotrzyk') return 'dexterity'
    if (cls === 'Mag' || cls === 'Zielarz') return 'wisdom'
    return 'strength'
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#0b100b] text-foreground">
      <Header nav={nav} setNav={setNav} />
      <main className="flex-1">
        {screen === 'hero' && (
          <Hero
            onStart={() => {
              clickSfx.play()
              setScreen('select')
            }}
            onChooseCampaign={() => setNav('explore')}
          />
        )}
        {screen === 'select' && <CharacterSelect onBack={() => setScreen('hero')} onSelect={(c) => startAdventure(c)} />}
        {screen === 'game' && (
          <GameArea
            state={state}
            onQuick={(a) => void rollAndSend(a)}
            onSubmit={(actionText) => void rollAndSend(actionText)}
            isSending={isSending}
          />
        )}
        {nav === 'saved' && <SavedList />}
      </main>
      <Footer />
      {rolling && <DiceOverlay value={rollResult ?? 1} />}
      <Fireflies />
    </div>
  )
}

function Header({
  nav,
  setNav,
}: {
  nav: 'create' | 'saved' | 'explore'
  setNav: (v: 'create' | 'saved' | 'explore') => void
}) {
  return (
    <header className="sticky top-0 z-30">
      <div className="w-full bg-[url('/images/wood-texture.png')] bg-repeat bg-center" style={{ imageRendering: 'pixelated' as any }} role="navigation" aria-label="Główna nawigacja">
        <div className="backdrop-brightness-[.85]">
          <div className="mx-auto max-w-6xl px-4 py-2 flex items-center gap-3">
            <Image src="/images/logo-forest.png" alt="Logo lasu" width={32} height={32} className="rounded-sm border border-[#3b2f20]" />
            <span className="font-black tracking-wider text-[#f0e7cf] drop-shadow">Leśny Orakl</span>
            <div className="ml-auto hidden sm:flex items-center gap-1">
              <NavButton active={nav === 'create'} onClick={() => setNav('create')} icon={Home} label="Stwórz przygodę" />
              <NavButton active={nav === 'saved'} onClick={() => setNav('saved')} icon={BookOpen} label="Zapisane" />
              <NavButton active={nav === 'explore'} onClick={() => setNav('explore')} icon={Waypoints} label="Eksploruj" />
            </div>
            <Button variant="secondary" size="icon" className="sm:hidden bg-[#3b5d3b] hover:bg-[#2f4a2f] text-[#f0e7cf] border border-[#233823]" aria-label="Menu">
              <Menu className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </div>
    </header>
  )
}

function NavButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active?: boolean
  icon: any
  label: string
  onClick: () => void
}) {
  return (
    <Button
      onClick={onClick}
      variant={active ? 'default' : 'secondary'}
      className={cn(
        'gap-2 bg-[#3b5d3b] hover:bg-[#2f4a2f] text-[#f0e7cf] border border-[#233823]',
        active && 'bg-[#576f2e] hover:bg-[#4c6128]',
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </Button>
  )
}

function Hero({ onStart, onChooseCampaign }: { onStart: () => void; onChooseCampaign: () => void }) {
  return (
    <section className="relative min-h-[80vh] md:min-h-[88vh] flex items-center justify-center" aria-label="Sekcja bohatera">
      <Image src="/images/forest-hero.png" alt="Pikselowy las nocą" fill priority className="object-cover" style={{ imageRendering: 'pixelated' as any }} />
      <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/35 to-black/80" />
      <div className="relative z-10 max-w-3xl mx-auto px-4 text-center">
        <h1 className="text-4xl md:text-6xl font-extrabold text-[#f0e7cf] drop-shadow-lg">{'Przygotuj sesję RPG w minutę'}</h1>
        <p className="mt-4 text-[#e0d7bd]">{'Wejdź do pikselowego boru i pozwól polskiemu Mistrzowi Gry poprowadzić Cię przez misję.'}</p>
        <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
          <Button onClick={onStart} className="bg-[#6e5b3d] hover:bg-[#5d4c32] text-[#f7f2e6] border border-[#3d3021]">{'Rozpocznij przygodę'}</Button>
          <Button onClick={onChooseCampaign} variant="secondary" className="bg-[#2f4a2f] hover:bg-[#253b25] text-[#f0e7cf] border border-[#1f2f1f]">{'Wybierz kampanię'}</Button>
        </div>
      </div>
    </section>
  )
}

function CharacterSelect({ onSelect, onBack }: { onSelect: (cls: GameClass) => void; onBack: () => void }) {
  const classes: { cls: GameClass; icon: any; desc: string }[] = [
    { cls: 'Wojownik', icon: SwordsIcon, desc: 'Silny i wytrzymały wojownik, mistrz broni białej.' },
    { cls: 'Mag', icon: Wand2, desc: 'Uczony mag, władający tajemną mocą lasu.' },
    { cls: 'Łotrzyk', icon: Axe, desc: 'Zwinny i sprytny, cichy jak cień między drzewami.' },
    { cls: 'Zielarz', icon: FlaskConical, desc: 'Znawca ziół i alchemii, leczy i zatruwa z równą gracją.' },
  ]
  return (
    <section className="relative py-12">
      <div className="absolute inset-0">
        <Image src="/images/forest-hero.png" alt="" fill className="object-cover opacity-20" />
      </div>
      <div className="relative mx-auto max-w-6xl px-4">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl md:text-3xl font-bold text-[#e8e0c7]">{'Wybór postaci'}</h2>
          <Button onClick={onBack} variant="secondary" className="bg-[#2f4a2f] text-[#f0e7cf] border border-[#1f2f1f]">{'Powrót'}</Button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {classes.map(({ cls, icon: Icon, desc }) => {
            const stats = defaultStatsFor(cls)
            return (
              <Card key={cls} className="bg-[#162016]/90 border-[#3d3021]">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-[#f0e7cf]"><Icon className="h-5 w-5" /> {cls}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-[#d8cfb5]">
                  <p className="min-h-[48px]">{desc}</p>
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    <StatPill label="HP" value={stats.hpBase} icon={Heart} />
                    <StatPill label="Mana" value={stats.manaBase} icon={FlaskConical} />
                    <StatPill label="Sila" value={stats.strength} icon={Swords} />
                    <StatPill label="Zrecz" value={stats.dexterity} icon={Dice5} />
                    <StatPill label="Mądrość" value={stats.wisdom} icon={BookOpen} />
                    <StatPill label="Sakiewka" value={stats.gold} icon={Coins} />
                  </div>
                  <Button onClick={() => onSelect(cls)} className="w-full mt-3 bg-[#6e5b3d] hover:bg-[#5d4c32] text-[#f7f2e6]">{'Wybierz'}</Button>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function StatPill({ label, value, icon: Icon }: { label: string; value: number; icon: any }) {
  return (
    <div className="flex items-center gap-1.5 rounded border border-[#3d3021] bg-[#1a241a] px-2 py-1">
      <Icon className="h-3.5 w-3.5 text-[#d4c8a7]" />
      <span className="text-[11px] text-[#cfc5ab]">{label}</span>
      <span className="ml-auto text-[#f0e7cf] text-xs font-bold">{value}</span>
    </div>
  )
}

function GameArea({
  state,
  onQuick,
  onSubmit,
  isSending,
}: {
  state: GameState
  onQuick: (a: string) => void
  onSubmit: (text: string) => void
  isSending: boolean
}) {
  const [text, setText] = useState('')

  const endMsg = state.isOver
    ? state.outcome === 'win'
      ? 'Zwycięstwo! Cel misji został osiągnięty.'
      : 'Porażka... Twoje HP spadło do zera.'
    : null

  return (
    <section className="mx-auto max-w-6xl px-4 py-6 grid gap-4 md:grid-cols-[2fr,1fr]">
      <div className="space-y-4">
        <Card className="bg-[#11150f] border-[#3d3021]">
          <CardHeader className="pb-2">
            <CardTitle className="text-[#f0e7cf] flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              {'Okno dialogu'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[46vh] md:h-[48vh] pr-3">
              <div className="space-y-3">
                {state.messages.map((m, i) => (
                  <div key={i} className={cn('leading-6', m.role === 'assistant' ? 'text-[#e7dec5]' : 'text-[#d0c7ad]')}>
                    {m.content}
                  </div>
                ))}
                {endMsg && (
                  <div className="mt-2 p-3 rounded bg-[#2f4a2f] text-[#f0e7cf] border border-[#1f2f1f]">
                    {endMsg}
                  </div>
                )}
              </div>
            </ScrollArea>
            <Separator className="my-3 bg-[#3d3021]" />
            <div className="flex flex-wrap gap-2 mb-3">
              {QUICK_ACTIONS.map((q) => (
                <Button
                  key={q.key}
                  onClick={() => onQuick(q.label)}
                  disabled={isSending || state.isOver}
                  className="bg-[#2f4a2f] hover:bg-[#253b25] text-[#f0e7cf] border border-[#1f2f1f] h-9 px-2 gap-1"
                >
                  <q.icon className="h-4 w-4" />
                  <span className="text-sm">{q.label}</span>
                </Button>
              ))}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (!text.trim()) return
                onSubmit(text.trim())
                setText('')
              }}
              className="flex gap-2"
            >
              <Input
                aria-label="Akcja gracza"
                placeholder="Opisz swoją akcję (np. 'Skradam się do strażnika' lub 'Atakuję wilka')"
                value={text}
                onChange={(e) => setText(e.target.value)}
                disabled={isSending || state.isOver}
                className="bg-[#0c120c] text-[#f0e7cf] border-[#233823] placeholder:text-[#8ba08b]"
              />
              <Button
                type="submit"
                disabled={isSending || state.isOver || !text.trim()}
                className="bg-[#6e5b3d] hover:bg-[#5d4c32] text-[#f7f2e6] min-w-[112px]"
              >
                {isSending ? 'Wysyłanie...' : 'Wykonaj'}
              </Button>
            </form>

            <div className="mt-4 flex flex-col sm:flex-row gap-2 sm:items-center">
              <SaveInline />
              <p className="text-xs text-[#9fb19f] sm:ml-2">{'Zapisy są przechowywane lokalnie i na serwerze (sesja demo).'}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <SidePanel state={state} />
    </section>
  )
}

function SaveInline() {
  const [name, setName] = useState('Moja Przygoda')
  return (
    <div className="flex items-center gap-2">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Nazwa zapisu"
        className="bg-[#0c120c] text-[#f0e7cf] border-[#233823] placeholder:text-[#8ba08b]"
      />
      <Button
        onClick={() => {
          const state = JSON.parse(localStorage.getItem('rpg_state') || 'null')
          if (!state) return
          const snapshot: GameSave = { id: crypto.randomUUID(), name: name || `Przygoda ${new Date().toLocaleString()}`, createdAt: Date.now(), state }
          const saves = JSON.parse(localStorage.getItem('rpg_saves') || '[]') as GameSave[]
          localStorage.setItem('rpg_saves', JSON.stringify([snapshot, ...saves].slice(0, 20)))
          const sessionId = localStorage.getItem('rpg_session_id') || ''
          fetch('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId, save: snapshot }) }).catch(() => {})
        }}
        className="bg-[#576f2e] hover:bg-[#4c6128] text-[#f7f2e6]"
      >
        {'Zapisz'}
      </Button>
    </div>
  )
}

function SidePanel({ state }: { state: GameState }) {
  return (
    <div className="space-y-4">
      <Card className="bg-[#11150f] border-[#3d3021]">
        <CardHeader className="pb-2">
          <CardTitle className="text-[#f0e7cf] flex items-center gap-2">
            <Shield className="h-5 w-5" />
            {'Bohater'}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-[#d8cfb5]">
          <div className="grid grid-cols-2 gap-2">
            <Bar label="HP" value={state.hp} max={state.stats.hpBase} color="#a33b3b" icon={Heart} />
            <Bar label="Mana" value={state.mana} max={state.stats.manaBase} color="#3b8aa3" icon={FlaskConical} />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
            <StatPill label="Siła" value={state.stats.strength} icon={Swords} />
            <StatPill label="Zręcz." value={state.stats.dexterity} icon={Dice5} />
            <StatPill label="Mądrość" value={state.stats.wisdom} icon={BookOpen} />
          </div>
          {state.playerClass && <p className="mt-2 text-xs text-[#bdb397]">{'Klasa: '}<b>{state.playerClass}</b></p>}
        </CardContent>
      </Card>

      <Card className="bg-[#11150f] border-[#3d3021]">
        <CardHeader className="pb-2">
          <CardTitle className="text-[#f0e7cf] flex items-center gap-2">
            <BackpackIcon />
            {'Ekwipunek'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1 text-[#d8cfb5] text-sm">
            {state.inventory.length === 0 && <li className="text-[#9fb19f]">{'Pusto...'}</li>}
            {state.inventory.map((it, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-sm bg-[#6e5b3d] inline-block border border-[#3d3021]" />
                {it}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card className="bg-[#11150f] border-[#3d3021]">
        <CardHeader className="pb-2">
          <CardTitle className="text-[#f0e7cf] flex items-center gap-2">
            <Waypoints className="h-5 w-5" />
            {'Dziennik zadań'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-[#cfc5ab] text-sm">
            {state.goal ? (
              <p className="mb-2"><span className="text-[#9fb19f]">{'Cel: '}</span>{state.goal}</p>
            ) : (
              <p className="text-[#9fb19f]">{'Cel misji zostanie wkrótce ustalony.'}</p>
            )}
            <ul className="list-disc ml-5 space-y-1">
              {state.questLog.map((q, i) => (<li key={i}>{q}</li>))}
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function Bar({ label, value, max, color, icon: Icon }: { label: string; value: number; max: number; color: string; icon: any }) {
  const pct = Math.max(0, Math.min(100, Math.round((value / Math.max(1, max)) * 100)))
  return (
    <div>
      <div className="flex items-center justify-between text-xs text-[#e0d7bd]">
        <span className="flex items-center gap-1"><Icon className="h-3.5 w-3.5" />{label}</span>
        <span>{value}/{max}</span>
      </div>
      <div className="h-2 mt-1 rounded border border-[#3d3021] bg-black/30 overflow-hidden">
        <div className="h-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  )
}

function DiceOverlay({ value }: { value: number }) {
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/60 backdrop-blur-sm">
      <div className="w-40 h-40 rounded-lg border border-[#3d3021] bg-[url('/images/wood-texture.png')] bg-center bg-cover grid place-items-center animate-pulse" style={{ imageRendering: 'pixelated' as any }}>
        <div className="text-6xl font-black text-[#f0e7cf] drop-shadow">k20</div>
        <div className="absolute bottom-3 text-3xl font-black text-[#f0e7cf]">{value}</div>
      </div>
    </div>
  )
}

function SavedList() {
  const saves = JSON.parse(typeof window !== 'undefined' ? localStorage.getItem('rpg_saves') || '[]' : '[]') as GameSave[]
  return (
    <section className="mx-auto max-w-4xl px-4 py-8">
      <h2 className="text-2xl font-bold text-[#e8e0c7] mb-4">{'Zapisane przygody'}</h2>
      <div className="grid gap-3">
        {saves.length === 0 && <p className="text-[#9fb19f]">{'Brak zapisów.'}</p>}
        {saves.map((s) => (
          <Card key={s.id} className="bg-[#12180f] border-[#3d3021]">
            <CardContent className="p-3 flex items-center gap-3">
              <div className="flex-1">
                <div className="text-[#f0e7cf] font-medium">{s.name}</div>
                <div className="text-[#9fb19f] text-xs">{new Date(s.createdAt).toLocaleString()}</div>
              </div>
              <Button
                onClick={() => {
                  localStorage.setItem('rpg_state', JSON.stringify(s.state))
                  window.location.reload()
                }}
                className="bg-[#576f2e] hover:bg-[#4c6128] text-[#f7f2e6]"
              >
                {'Wczytaj'}
              </Button>
              <Button
                onClick={() => {
                  const all = JSON.parse(localStorage.getItem('rpg_saves') || '[]') as GameSave[]
                  localStorage.setItem('rpg_saves', JSON.stringify(all.filter(x => x.id !== s.id)))
                  window.location.reload()
                }}
                variant="secondary"
                className="bg-[#6e3b3b] hover:bg-[#5a3232] text-[#f7f2e6] border border-[#3d3021]"
              >
                {'Usuń'}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="mt-auto bg-[url('/images/wood-texture.png')] bg-repeat bg-center border-t border-[#3d3021]" style={{ imageRendering: 'pixelated' as any }}>
      <div className="backdrop-brightness-[.85]">
        <div className="mx-auto max-w-6xl px-4 py-4 flex items-center justify-between">
          <span className="text-[#e0d7bd] text-sm">{'© '}{new Date().getFullYear()}{' Leśny Orakl'}</span>
          <div className="flex items-center gap-3">
            <SocialIcon label="Twitter" />
            <SocialIcon label="GitHub" />
            <SocialIcon label="Discord" />
          </div>
        </div>
      </div>
    </footer>
  )
}

function SocialIcon({ label }: { label: string }) {
  return (
    <div className="w-6 h-6 grid place-items-center rounded-sm border border-[#3d3021] bg-[#1a241a] text-[#f0e7cf] text-[10px]" aria-label={label}>
      {label[0]}
    </div>
  )
}

function Fireflies() {
  const nodes = Array.from({ length: 24 })
  return (
    <div aria-hidden="true">
      {nodes.map((_, i) => (
        <span
          key={i}
          className="pointer-events-none fixed top-0 left-0 w-1 h-1 rounded-full bg-[#d1ff82]/90 blur-[1px]"
          style={{
            animation: `floaty ${8 + (i % 8)}s linear ${i * 0.73}s infinite`,
            transform: `translate(${(i * 37) % 100}vw, ${(i * 53) % 100}vh)`,
            boxShadow: '0 0 6px #d1ff82',
          }}
        />
      ))}
      <style jsx global>{`
        @keyframes floaty {
          0% { transform: translate(0, 0); opacity: .7; }
          25% { opacity: 1; }
          50% { transform: translate(30vw, 40vh); opacity: .6; }
          75% { opacity: .9; }
          100% { transform: translate(0, 0); opacity: .7; }
        }
      `}</style>
    </div>
  )
}

function BackpackIcon() {
  return (
    <div className="h-5 w-5 grid place-items-center rounded-sm border border-[#3d3021] bg-[#6e5b3d] text-[#f7f2e6] text-[9px]" aria-hidden>
      {'EQ'}
    </div>
  )
}
