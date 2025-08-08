import { NextRequest, NextResponse } from 'next/server'
import { type GameSave, type GameState } from '@/lib/game'

// Simple in-memory mirror for demo purposes
const savedBySession = new Map<string, { state?: GameState; saves: GameSave[] }>()

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const sessionId = searchParams.get('sessionId') || ''
  const data = savedBySession.get(sessionId) || { saves: [] }
  return NextResponse.json({ ok: true, ...data })
}

export async function POST(req: NextRequest) {
  const { sessionId, state, save } = (await req.json()) as {
    sessionId: string
    state?: GameState
    save?: GameSave
  }
  const entry = savedBySession.get(sessionId) || { saves: [] as GameSave[] }
  if (state) entry.state = state
  if (save) entry.saves = [save, ...entry.saves].slice(0, 50)
  savedBySession.set(sessionId, entry)
  return NextResponse.json({ ok: true })
}
