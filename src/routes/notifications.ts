import { Router } from 'express'
import { getDb } from '../db'
import { requireAuth, requireAdmin, type AuthRequest } from '../middleware/auth'

const router = Router()

function mapNotif(n: Record<string, unknown>) {
  return {
    id: n.id,
    userId: n.user_id,
    tipo: n.tipo,
    titulo: n.titulo,
    mensaje: n.mensaje,
    leida: Boolean(n.leida),
    createdAt: n.created_at,
  }
}

// ── Get notifications for current user ───────────────────────────────────────
router.get('/', requireAuth, (req: AuthRequest, res) => {
  const db = getDb()
  const { unread } = req.query as { unread?: string }
  let query = 'SELECT * FROM notifications WHERE user_id = ?'
  const params: (number | string)[] = [req.user!.id]
  if (unread === 'true') { query += ' AND leida = 0' }
  query += ' ORDER BY created_at DESC LIMIT 50'
  const rows = db.prepare(query).all(...params) as Record<string, unknown>[]
  const total = db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND leida = 0').get(req.user!.id) as { c: number }
  res.json({ notifications: rows.map(mapNotif), unreadCount: total.c })
})

// ── Mark one notification as read ────────────────────────────────────────────
router.put('/:id/read', requireAuth, (req: AuthRequest, res) => {
  const db = getDb()
  const notif = db.prepare('SELECT * FROM notifications WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined
  if (!notif) { res.status(404).json({ error: 'Notificación no encontrada' }); return }
  if (Number(notif.user_id) !== req.user!.id) {
    res.status(403).json({ error: 'No autorizado' }); return
  }
  db.prepare('UPDATE notifications SET leida = 1 WHERE id = ?').run(req.params.id)
  res.json({ message: 'Notificación marcada como leída' })
})

// ── Mark all notifications as read ───────────────────────────────────────────
router.put('/read-all', requireAuth, (req: AuthRequest, res) => {
  const db = getDb()
  db.prepare('UPDATE notifications SET leida = 1 WHERE user_id = ?').run(req.user!.id)
  res.json({ message: 'Todas las notificaciones marcadas como leídas' })
})

// ── Admin: create notification for a specific user ────────────────────────────
router.post('/', requireAuth, requireAdmin, (req, res) => {
  const { userId, tipo, titulo, mensaje } = req.body as {
    userId: number; tipo?: string; titulo: string; mensaje: string
  }
  if (!userId || !titulo || !mensaje) {
    res.status(400).json({ error: 'userId, titulo y mensaje son requeridos' })
    return
  }
  const db = getDb()
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId)
  if (!user) { res.status(404).json({ error: 'Usuario no encontrado' }); return }

  const result = db.prepare(`
    INSERT INTO notifications (user_id, tipo, titulo, mensaje, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, tipo ?? 'info', titulo, mensaje, new Date().toISOString())

  res.status(201).json(mapNotif(db.prepare('SELECT * FROM notifications WHERE id = ?').get(result.lastInsertRowid) as Record<string, unknown>))
})

// ── Admin: broadcast notification to all active users of a role ───────────────
router.post('/broadcast', requireAuth, requireAdmin, (req, res) => {
  const { rol, tipo, titulo, mensaje } = req.body as {
    rol?: string; tipo?: string; titulo: string; mensaje: string
  }
  if (!titulo || !mensaje) {
    res.status(400).json({ error: 'titulo y mensaje son requeridos' })
    return
  }
  const db = getDb()
  let query = 'SELECT id FROM users WHERE activo = 1'
  const params: (string | number)[] = []
  if (rol) { query += ' AND rol = ?'; params.push(rol) }

  const users = db.prepare(query).all(...params) as { id: number }[]
  const now = new Date().toISOString()
  const stmt = db.prepare('INSERT INTO notifications (user_id, tipo, titulo, mensaje, created_at) VALUES (?, ?, ?, ?, ?)')
  for (const u of users) stmt.run(u.id, tipo ?? 'info', titulo, mensaje, now)

  res.json({ message: `Notificación enviada a ${users.length} usuario(s)` })
})

// ── Delete notification (own or admin) ───────────────────────────────────────
router.delete('/:id', requireAuth, (req: AuthRequest, res) => {
  const db = getDb()
  const notif = db.prepare('SELECT * FROM notifications WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined
  if (!notif) { res.status(404).json({ error: 'Notificación no encontrada' }); return }

  const userRol = req.user!.rol
  if (userRol !== 'admin' && userRol !== 'secretaria' && Number(notif.user_id) !== req.user!.id) {
    res.status(403).json({ error: 'No autorizado' }); return
  }
  db.prepare('DELETE FROM notifications WHERE id = ?').run(req.params.id)
  res.json({ message: 'Notificación eliminada' })
})

export default router
