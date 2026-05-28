import { Router } from 'express'
import { getDb } from '../db'
import { requireAuth, type AuthRequest } from '../middleware/auth'

const router = Router()

const DEEPSEEK_BASE = 'https://api.deepseek.com'
const DEEPSEEK_MODEL = 'deepseek-chat'

async function askDeepSeek(messages: { role: string; content: string }[]): Promise<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY no configurada')

  const response = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages,
      temperature: 0.7,
      max_tokens: 1024,
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`DeepSeek API error ${response.status}: ${body}`)
  }

  const data = await response.json() as {
    choices: { message: { content: string } }[]
  }
  return data.choices[0]?.message?.content ?? ''
}

function buildSystemPrompt(db: ReturnType<typeof getDb>): string {
  const programs = db.prepare('SELECT id, nombre FROM programs').all() as { id: string; nombre: string }[]
  const teachers = db.prepare('SELECT id, nombre_completo, departamento, vinculacion, max_horas_semana FROM teachers').all() as Record<string, unknown>[]
  const spaces = db.prepare('SELECT codigo, nombre, tipo_espacio, capacidad FROM spaces').all() as Record<string, unknown>[]
  const slots = db.prepare('SELECT label, start_time, end_time FROM schedule_slots WHERE active = 1 AND locked = 0 ORDER BY slot_index').all() as Record<string, unknown>[]
  const days = db.prepare('SELECT label FROM schedule_days WHERE active = 1 ORDER BY day_index').all() as { label: string }[]

  return `Eres AulaLibre IA, un asistente inteligente especializado en la gestión y optimización de horarios académicos universitarios.

CONTEXTO DEL SISTEMA:
- Programas: ${programs.map(p => p.nombre).join(', ')}
- Docentes disponibles: ${(teachers as { nombre_completo: string; vinculacion: string; max_horas_semana: number }[]).map(t => `${t.nombre_completo} (${t.vinculacion}, máx ${t.max_horas_semana}h/sem)`).join('; ')}
- Espacios físicos: ${(spaces as { codigo: string; nombre: string; tipo_espacio: string; capacidad: number }[]).map(s => `${s.codigo} - ${s.nombre} (${s.tipo_espacio}, cap. ${s.capacidad})`).join('; ')}
- Franjas horarias disponibles: ${(slots as { label: string }[]).map(s => s.label).join(', ')}
- Días activos: ${days.map(d => d.label).join(', ')}

REGLAS DE NEGOCIO:
- Un docente no puede tener dos grupos al mismo tiempo
- Un salón no puede tener dos clases al mismo tiempo
- Grupos con jornada Nocturna deben asignarse a franjas 17:00 en adelante
- La preselección de un estudiante es una solicitud, no un horario definitivo
- El administrador construye y publica el horario oficial

Responde siempre en español de forma concisa y práctica. Cuando hagas sugerencias de horario, explica el razonamiento considerando las restricciones del sistema.`
}

// ── Get or create a session ───────────────────────────────────────────────────
router.post('/sessions', requireAuth, (req: AuthRequest, res) => {
  const { titulo } = req.body as { titulo?: string }
  const db = getDb()
  const now = new Date().toISOString()
  const result = db.prepare('INSERT INTO chat_sessions (user_id, titulo, created_at) VALUES (?, ?, ?)').run(
    req.user!.id, titulo ?? 'Nueva conversación', now,
  )
  const session = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(result.lastInsertRowid) as Record<string, unknown>
  res.status(201).json(session)
})

router.get('/sessions', requireAuth, (req: AuthRequest, res) => {
  const db = getDb()
  const sessions = db.prepare(`
    SELECT cs.*, (SELECT COUNT(*) FROM chat_messages WHERE session_id = cs.id) AS message_count
    FROM chat_sessions cs
    WHERE cs.user_id = ?
    ORDER BY cs.created_at DESC
    LIMIT 20
  `).all(req.user!.id) as Record<string, unknown>[]
  res.json(sessions)
})

// ── Get messages in a session ─────────────────────────────────────────────────
router.get('/sessions/:sessionId/messages', requireAuth, (req: AuthRequest, res) => {
  const { sessionId } = req.params
  const db = getDb()
  const session = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(sessionId) as { user_id: number } | undefined
  if (!session) { res.status(404).json({ error: 'Sesión no encontrada' }); return }

  // Only own sessions or admin
  const userRol = req.user!.rol
  if (userRol !== 'admin' && userRol !== 'secretaria' && session.user_id !== req.user!.id) {
    res.status(403).json({ error: 'No autorizado' }); return
  }
  const messages = db.prepare('SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at').all(sessionId)
  res.json(messages)
})

// ── Send a message and get AI response ───────────────────────────────────────
router.post('/sessions/:sessionId/messages', requireAuth, (req: AuthRequest, res) => {
  const { sessionId } = req.params
  const { content } = req.body as { content: string }

  if (!content?.trim()) {
    res.status(400).json({ error: 'El mensaje no puede estar vacío' })
    return
  }

  const db = getDb()
  const session = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(sessionId) as { id: number; user_id: number } | undefined
  if (!session) { res.status(404).json({ error: 'Sesión no encontrada' }); return }

  const userRol = req.user!.rol
  if (userRol !== 'admin' && userRol !== 'secretaria' && session.user_id !== req.user!.id) {
    res.status(403).json({ error: 'No autorizado' }); return
  }

  const now = new Date().toISOString()
  // Persist user message
  db.prepare('INSERT INTO chat_messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)').run(
    sessionId, 'user', content.trim(), now,
  )

  // Build conversation history (last 20 messages for context)
  const history = db.prepare(`
    SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY created_at DESC LIMIT 20
  `).all(sessionId) as { role: string; content: string }[]
  history.reverse()

  const systemPrompt = buildSystemPrompt(db)
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history,
  ]

  // Call DeepSeek async and respond
  askDeepSeek(messages)
    .then(reply => {
      const replyTime = new Date().toISOString()
      db.prepare('INSERT INTO chat_messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)').run(
        sessionId, 'assistant', reply, replyTime,
      )
      res.json({ role: 'assistant', content: reply, createdAt: replyTime })
    })
    .catch(err => {
      console.error('[chat] Error DeepSeek:', err)
      const fallback = 'Lo siento, no pude conectar con el servicio de IA en este momento. Por favor, inténtalo de nuevo más tarde.'
      const replyTime = new Date().toISOString()
      db.prepare('INSERT INTO chat_messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)').run(
        sessionId, 'assistant', fallback, replyTime,
      )
      res.json({ role: 'assistant', content: fallback, createdAt: replyTime })
    })
})

// ── Delete a session ──────────────────────────────────────────────────────────
router.delete('/sessions/:sessionId', requireAuth, (req: AuthRequest, res) => {
  const { sessionId } = req.params
  const db = getDb()
  const session = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(sessionId) as { user_id: number } | undefined
  if (!session) { res.status(404).json({ error: 'Sesión no encontrada' }); return }

  const userRol = req.user!.rol
  if (userRol !== 'admin' && userRol !== 'secretaria' && session.user_id !== req.user!.id) {
    res.status(403).json({ error: 'No autorizado' }); return
  }
  db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(sessionId)
  res.json({ message: 'Sesión eliminada' })
})

export default router
