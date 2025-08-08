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
import { WORLDS, type GameClass, type GameSave, type GameState, type Player, createPlayer, defaultStatsFor, emptyGameState, statLabel } from '@/lib/game'
import { useAudio } from '@/lib/sfx'

function useLocalStorage<T>(key: string, initial: T) {
  const [val, setVal] = useState<T>(() => {
    if (typeof window === 'undefined') return initial
    const raw = localStorage.getItem(key)
    if (!raw) return initial
    try {
      const parsed = JSON.parse(raw)
      // Migration: enforce stateVersion 2
      if ((parsed as any)?.stateVersion === 2) return parsed as T
      return initial
    } catch {
      return initial
    }
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

type Screen = 'hero' | 'world' | 'team' | 'game'

export default function Page() {
  const [screen, setScreen] = useLocalStorage<Screen>('rpg_screen', 'hero')
  const [state, setState] = useLocalStorage<GameState>('rpg_state', emptyGameState())
  const [isSending, setIsSending] = useState(false)
  const [rolling, setRolling] = useState(false)
  const [rollResult, setRollResult] = useState<number | null>(null)
  const [nav, setNav] = useState<'create' | 'saved' | 'explore'>('create')

  const sessionId = useMemo(() => ensureSessionId(), [])
  const clickSfx = useAudio('/audio/click.mp3', 0.7)
  const diceSfx = useAudio('/audio/dice.mp3', 0.9)

  useEffect(() => {
    document.documentElement.classList.add('antialiased')
  }, [])

  function resetToWorld() {
    const base = emptyGameState()
    setState(base)
    setScreen('world')
  }

  async function generateStory(worldKey: string, players: Player[]) {
    // store world and players first
    const world = WORLDS[worldKey as keyof typeof WORLDS]
    const base: GameState = {
      ...emptyGameState(),
      world,
      players,
      activeIndex: 0,
      messages: [{ role: 'system', content: 'Mistrz Gry: Witajcie w leśnej krainie. Wasza ścieżka dopiero się zaczyna...' }],
    }
    setState(base)

    // ask server for outline
    try {
      const res = await fetch('/api/story', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          worldKey,
          players: players.map(p => ({ name: p.name, cls: p.cls })),
        }),
      })
      const data = await res.json()
      const outline = data.outline || null
      const withStory = { ...base, story: outline }
      setState(withStory)
      // intro
      await sendToAI('(Rozpocznij przygodę zgodnie z zarysem historii.)', null, true, 0, withStory)
      setScreen('game')
    } catch {
      // fallback to game without outline
      await sendToAI('(Rozpocznij przygodę.)', null, true, 0, base)
      setScreen('game')
    }
  }

  async function sendToAI(action: string, dice: number | null, isIntro = false, playerIndex = 0, s?: GameState) {
    const st = s ?? state
    setIsSending(true)
    try {
      const body = { sessionId, playerAction: action, diceRoll: dice, gameState: st, isIntro, playerIndex }
      const res = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json()
      const messages = [
        ...st.messages,
        ...(action && !isIntro ? [{ role: 'user' as const, content: `(${st.players[playerIndex]?.name}): ${action}` }] : []),
        { role: 'assistant' as const, content: data.narration },
      ]
      const next: GameState = { ...(s ?? state), messages }
      // Server already applied effects in session and returned only narration/effects. For client mirror, fetch session? For demo, also apply quickly here:
      const eff = data.effects || {}
      const actor = next.players[playerIndex]
      if (actor) {
        if (typeof eff.actorHp === 'number') actor.hp = Math.max(0, Math.min(actor.stats.hpBase, eff.actorHp))
        if (typeof eff.actorMana === 'number') actor.mana = Math.max(0, Math.min(actor.stats.manaBase, eff.actorMana))
        if (Array.isArray(eff.actorInventory)) actor.inventory = eff.actorInventory
        if (Array.isArray(eff.actorAddItems)) eff.actorAddItems.forEach((it: string) => { if (!actor.inventory.includes(it)) actor.inventory.push(it) })
        if (Array.isArray(eff.actorRemoveItems)) actor.inventory = actor.inventory.filter(i => !eff.actorRemoveItems.includes(i))
      }
      if (typeof eff.goal === 'string') next.goal = eff.goal
      if (Array.isArray(eff.questLog)) next.questLog = eff.questLog
      if (typeof eff.isOver === 'boolean') next.isOver = eff.isOver
      if (typeof eff.outcome === 'string') next.outcome = eff.outcome

      setState(next)
      // mirror to backend session (demo)
      fetch('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId, state: next }) }).catch(() => {})
    } catch {
      const messages = [...state.messages, { role: 'assistant' as const, content: 'MG: Zakłócenia w echa Orakla. Spróbuj ponownie.' }]
      setState({ ...state, messages })
    } finally {
      setIsSending(false)
    }
  }

  async function rollAndSend(baseAction: string) {
    const actor = state.players[state.activeIndex]
    if (!actor) return
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
        // choose relevant stat
        const relevant = guessRelevantStat(baseAction, actor.cls)
        const mod = actor.stats[relevant] ?? 0
        const total = current + mod
        void sendToAI(`${baseAction} (rzucono k20=${current} + modyfikator ${statLabel(relevant)}=${mod} => wynik ${total})`, total, false, state.activeIndex)
      }
    }, 60)
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#0b100b] text-foreground">
      <Header nav={nav} setNav={setNav} />
      <main className="flex-1">
        {screen === 'hero' && (
          <Hero
            onStart={() => {
              clickSfx.play()
              resetToWorld()
            }}
            onChooseCampaign={() => setNav('explore')}
          />
        )}
        {screen === 'world' && (
          <WorldSelect
            onBack={() => setScreen('hero')}
            onNext={(worldKey, count) => setScreen('team') || setState({ ...state, world: WORLDS[worldKey], players: Array.from({ length: count }).map((_, i) => createPlayer(defaultName(i), 'Wojownik')) })}
          />
        )}
        {screen === 'team' && state.world && (
          <TeamSetup
            worldKey={state.world.key}
            players={state.players}
            onBack={() => setScreen('world')}
            onUpdate={(players) => setState({ ...state, players })}
            onStart={() => generateStory(state.world!.key, state.players)}
          />
        )}
        {screen === 'game' && (
          <GameArea
            state={state}
            isSending={isSending}
            onQuick={(a) => void rollAndSend(a)}
            onSubmit={(a) => void rollAndSend(a)}
            onSetActive={(idx) => setState({ ...state, activeIndex: idx })}
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

function defaultName(i: number) {
  const names = ['Alder', 'Mira', 'Toran', 'Lysa']
  return names[i % names.length]
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

function WorldSelect({ onBack, onNext }: { onBack: () => void; onNext: (worldKey: keyof typeof WORLDS, count: number) => void }) {
  const [selected, setSelected] = useState<keyof typeof WORLDS>('wiedzmin')
  const [count, setCount] = useState(1)
  return (
    <section className="relative py-12">
      <div className="absolute inset-0">
        <Image src="/images/forest-hero.png" alt="" fill className="object-cover opacity-20" />
      </div>
      <div className="relative mx-auto max-w-6xl px-4">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl md:text-3xl font-bold text-[#e8e0c7]">{'Wybierz świat i liczbę graczy'}</h2>
          <Button onClick={onBack} variant="secondary" className="bg-[#2f4a2f] text-[#f0e7cf] border border-[#1f2f1f]">{'Powrót'}</Button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(Object.keys(WORLDS) as (keyof typeof WORLDS)[]).map((key) => {
            const w = WORLDS[key]
            const active = key === selected
            return (
              <Card key={key} className={cn('bg-[#162016]/90 border-[#3d3021] cursor-pointer', active && 'ring-2 ring-[#6e5b3d]')} onClick={() => setSelected(key)}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-[#f0e7cf]">{w.name}</CardTitle>
                </CardHeader>
                <CardContent className="text-[#d8cfb5] text-sm space-y-2">
                  <p>{w.description}</p>
                  <p className="text-[#9fb19f]">{w.styleHints}</p>
                </CardContent>
              </Card>
            )
          })}
        </div>

        <div className="mt-6 flex items-center gap-3">
          <label className="text-[#e8e0c7]">{'Liczba graczy:'}</label>
          <div className="flex items-center gap-2">
            {[1,2,3,4].map(n => (
              <Button key={n} onClick={() => setCount(n)} className={cn('bg-[#2f4a2f] text-[#f0e7cf] border border-[#1f2f1f]', count===n && 'bg-[#576f2e] hover:bg-[#4c6128]')}>
                {n}
              </Button>
            ))}
          </div>
          <div className="ml-auto">
            <Button onClick={() => onNext(selected, count)} className="bg-[#6e5b3d] hover:bg-[#5d4c32] text-[#f7f2e6]">
              {'Dalej'}
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}

function TeamSetup({
  worldKey,
  players,
  onBack,
  onUpdate,
  onStart,
}: {
  worldKey: string
  players: Player[]
  onBack: () => void
  onUpdate: (players: Player[]) => void
  onStart: () => void
}) {
  function update(i: number, patch: Partial<Player>) {
    const next = players.map((p, idx) => idx === i ? { ...p, ...patch } : p)
    // if class changed, refresh stats/hp/mana/inventory
    const np = next[i]
    if (patch.cls) {
      const cls = patch.cls as GameClass
      const stats = defaultStatsFor(cls)
      next[i] = { ...np, cls, stats, hp: stats.hpBase, mana: stats.manaBase, inventory: np.inventory?.length ? np.inventory : [] }
    }
    if (patch.name !== undefined && !patch.id) {
      next[i] = { ...next[i], name: String(patch.name) }
    }
    onUpdate(next)
  }

  const classes: { cls: GameClass; icon: any; desc: string }[] = [
    { cls: 'Wojownik', icon: SwordsIcon, desc: 'Silny i wytrzymały wojownik, mistrz broni białej.' },
    { cls: 'Mag', icon: Wand2, desc: 'Uczony mag, władający tajemną mocą.' },
    { cls: 'Łotrzyk', icon: Axe, desc: 'Zwinny i sprytny, cichy jak cień.' },
    { cls: 'Zielarz', icon: FlaskConical, desc: 'Znawca ziół i alchemii.' },
  ]

  return (
    <section className="relative py-12">
      <div className="absolute inset-0">
        <Image src="/images/forest-hero.png" alt="" fill className="object-cover opacity-20" />
      </div>
      <div className="relative mx-auto max-w-6xl px-4">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl md:text-3xl font-bold text-[#e8e0c7]">{'Ustaw drużynę'}</h2>
          <div className="flex gap-2">
            <Button onClick={onBack} variant="secondary" className="bg-[#2f4a2f] text-[#f0e7cf] border border-[#1f2f1f]">{'Powrót'}</Button>
            <Button onClick={onStart} className="bg-[#6e5b3d] hover:bg-[#5d4c32] text-[#f7f2e6]">{'Rozpocznij'}</Button>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {players.map((p, i) => {
            const stats = p.stats
            return (
              <Card key={p.id} className="bg-[#162016]/90 border-[#3d3021]">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-[#f0e7cf]">
                    {'Gracz '}{i+1}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-[#d8cfb5]">
                  <Input
                    value={p.name}
                    onChange={(e) => update(i, { name: e.target.value })}
                    placeholder="Imię bohatera"
                    className="bg-[#0c120c] text-[#f0e7cf] border-[#233823] placeholder:text-[#8ba08b]"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    {classes.map(({ cls, icon: Icon }) => (
                      <Button
                        key={cls}
                        onClick={() => update(i, { cls })}
                        className={cn(
                          'justify-start bg-[#2f4a2f] text-[#f0e7cf] border border-[#1f2f1f]',
                          p.cls === cls && 'bg-[#576f2e] hover:bg-[#4c6128]'
                        )}
                      >
                        <Icon className="h-4 w-4 mr-2" />
                        {cls}
                      </Button>
                    ))}
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-sm mt-1">
                    <StatPill label="HP" value={stats.hpBase} icon={Heart} />
                    <StatPill label="Mana" value={stats.manaBase} icon={FlaskConical} />
                    <StatPill label="Siła" value={stats.strength} icon={Swords} />
                    <StatPill label="Zręcz" value={stats.dexterity} icon={Dice5} />
                    <StatPill label="Mądrość" value={stats.wisdom} icon={BookOpen} />
                    <StatPill label="Złoto" value={stats.gold} icon={Coins} />
                  </div>
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
  isSending,
  onQuick,
  onSubmit,
  onSetActive,
}: {
  state: GameState
  isSending: boolean
  onQuick: (a: string) => void
  onSubmit: (text: string) => void
  onSetActive: (idx: number) => void
}) {
  const [text, setText] = useState('')
  const endMsg = state.isOver ? (state.outcome === 'win' ? 'Zwycięstwo! Cel misji został osiągnięty.' : 'Porażka... Drużyna pada bez sił.') : null

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
            <PartyBar state={state} onSetActive={onSetActive} />
            <ScrollArea className="h-[42vh] md:h-[44vh] pr-3 mt-3">
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
                <Button key={q.key} onClick={() => onQuick(q.label)} disabled={isSending || state.isOver} className="bg-[#2f4a2f] hover:bg-[#253b25] text-[#f0e7cf] border border-[#1f2f1f] h-9 px-2 gap-1">
                  <q.icon className="h-4 w-4" />
                  <span className="text-sm">{q.label}</span>
                </Button>
              ))}
            </div>
            <form onSubmit={(e) => { e.preventDefault(); if (!text.trim()) return; onSubmit(text.trim()); setText('') }} className="flex gap-2">
              <Input
                aria-label="Akcja gracza"
                placeholder={`Akcja (${state.players[state.activeIndex]?.name || 'Bohater'})...`}
                value={text}
                onChange={(e) => setText(e.target.value)}
                disabled={isSending || state.isOver}
                className="bg-[#0c120c] text-[#f0e7cf] border-[#233823] placeholder:text-[#8ba08b]"
              />
              <Button type="submit" disabled={isSending || state.isOver || !text.trim()} className="bg-[#6e5b3d] hover:bg-[#5d4c32] text-[#f7f2e6] min-w-[112px]">
                {isSending ? 'Wysyłanie...' : 'Wykonaj'}
              </Button>
            </form>
            <div className="mt-3 text-xs text-[#9fb19f]">
              {state.world && <>Świat: <b>{state.world.name}</b>. </>}
              {state.goal && <>Cel: {state.goal}</>}
            </div>
          </CardContent>
        </Card>
      </div>
      <SidePanel state={state} />
    </section>
  )
}

function PartyBar({ state, onSetActive }: { state: GameState; onSetActive: (i: number) => void }) {
  return (
    <div className="flex gap-2 overflow-x-auto">
      {state.players.map((p, i) => {
        const active = i === state.activeIndex
        const hpPct = Math.round((p.hp / Math.max(1, p.stats.hpBase)) * 100)
        const manaPct = Math.round((p.mana / Math.max(1, p.stats.manaBase)) * 100)
        return (
          <button key={p.id} onClick={() => onSetActive(i)} className={cn('min-w-[180px] text-left rounded border px-3 py-2 bg-[#161f16] border-[#3d3021]', active && 'ring-2 ring-[#6e5b3d]')}>
            <div className="font-semibold text-[#f0e7cf]">{p.name} <span className="text-[#c7bb9d] text-xs">({p.cls})</span></div>
            <div className="mt-1 h-1.5 bg-black/40 rounded overflow-hidden border border-[#3d3021]"><div className="h-full bg-[#a33b3b]" style={{ width: `${hpPct}%` }} /></div>
            <div className="mt-1 h-1.5 bg-black/40 rounded overflow-hidden border border-[#3d3021]"><div className="h-full bg-[#3b8aa3]" style={{ width: `${manaPct}%` }} /></div>
          </button>
        )
      })}
    </div>
  )
}

function SidePanel({ state }: { state: GameState }) {
  const active = state.players[state.activeIndex]
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
          {active ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Bar label="HP" value={active.hp} max={active.stats.hpBase} color="#a33b3b" icon={Heart} />
                <Bar label="Mana" value={active.mana} max={active.stats.manaBase} color="#3b8aa3" icon={FlaskConical} />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                <StatPill label="Siła" value={active.stats.strength} icon={Swords} />
                <StatPill label="Zręcz." value={active.stats.dexterity} icon={Dice5} />
                <StatPill label="Mądrość" value={active.stats.wisdom} icon={BookOpen} />
              </div>
              <p className="mt-2 text-xs text-[#bdb397]">{'Klasa: '}<b>{active.cls}</b></p>
            </>
          ) : (
            <p className="text-[#9fb19f]">{'Brak aktywnego bohatera.'}</p>
          )}
        </CardContent>
      </Card>

      <Card className="bg-[#11150f] border-[#3d3021]">
        <CardHeader className="pb-2">
          <CardTitle className="text-[#f0e7cf] flex items-center gap-2">
            <BackpackIcon />
            {'Ekwipunek (aktywny)'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1 text-[#d8cfb5] text-sm">
            {!active || active.inventory.length === 0 ? <li className="text-[#9fb19f]">{'Pusto...'}</li> : active.inventory.map((it, i) => (
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
            {state.goal ? <p className="mb-2"><span className="text-[#9fb19f]">{'Cel: '}</span>{state.goal}</p> : <p className="text-[#9fb19f]">{'Cel misji zostanie wkrótce ustalony.'}</p>}
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
              <Button onClick={() => { localStorage.setItem('rpg_state', JSON.stringify(s.state)); window.location.reload() }} className="bg-[#576f2e] hover:bg-[#4c6128] text-[#f7f2e6]">{'Wczytaj'}</Button>
              <Button onClick={() => { const all = JSON.parse(localStorage.getItem('rpg_saves') || '[]') as GameSave[]; localStorage.setItem('rpg_saves', JSON.stringify(all.filter(x => x.id !== s.id))); window.location.reload() }} variant="secondary" className="bg-[#6e3b3b] hover:bg-[#5a3232] text-[#f7f2e6] border border-[#3d3021]">{'Usuń'}</Button>
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
