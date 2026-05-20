import { Router } from 'express'
import bcrypt from 'bcryptjs'
import type { SQLInputValue } from 'node:sqlite'
import { getDb } from '../db'
import { requireAuth, requireAdmin, type AuthRequest } from '../middleware/auth'

const router = Router()

function toRow(u: Record<string, unknown>) {
  return {
    id: String(u.id),
    nombre: u.nombre,
    email: u.email,
    rol: u.rol_display,
    ultimoAcceso: u.ultimo_acceso ?? '—',
    activo: Boolean(u.activo),
    iniciales: u.iniciales,
  }
}

router.get('/', requireAuth, requireAdmin, (_req, res) => {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM users ORDER BY id').all() as Record<string, unknown>[]
  res.json(rows.map(toRow))
})

router.post('/', requireAuth, requireAdmin, (req: AuthRequest, res) => {
  const { nombre, email, rol, activo, password } = req.body as {
    nombre: string; email: string; rol: string; activo: boolean; password?: string
  }

  if (!nombre || !email || !rol) {
    res.status(400).json({ error: 'Nombre, correo y rol son requeridos' })
    return
  }

  const rolMap: Record<string, string> = {
    Administrador: 'admin',
    Secretaria: 'secretaria',
    Docente: 'docente',
    Estudiante: 'estudiante',
  }

  const rolInterno = rolMap[rol] ?? 'docente'
  const iniciales = nombre.trim().split(/\s+/).map((p: string) => p[0]).join('').slice(0, 2).toUpperCase()
  const hash = bcrypt.hashSync(password ?? 'changeme123', 10)

  const db = getDb()
  try {
    const result = db.prepare(`
      INSERT INTO users (nombre, email, password_hash, rol, rol_display, activo, iniciales)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(nombre.trim(), email.trim().toLowerCase(), hash, rolInterno, rol, activo ? 1 : 0, iniciales)

    const created = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid) as Record<string, unknown>
    res.status(201).json(toRow(created))
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).message?.includes('UNIQUE')) {
      res.status(409).json({ error: 'El correo ya está registrado' })
    } else {
      res.status(500).json({ error: 'Error al crear usuario' })
    }
  }
})

router.put('/:id', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params
  const { nombre, email, rol, activo } = req.body as {
    nombre?: string; email?: string; rol?: string; activo?: boolean
  }

  const db = getDb()
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id)
  if (!user) {
    res.status(404).json({ error: 'Usuario no encontrado' })
    return
  }

  const rolMap: Record<string, string> = {
    Administrador: 'admin', Secretaria: 'secretaria', Docente: 'docente', Estudiante: 'estudiante',
  }

  const fields: string[] = []
  const values: SQLInputValue[] = []

  if (nombre) { fields.push('nombre = ?'); values.push(nombre.trim()) }
  if (email) { fields.push('email = ?'); values.push(email.trim().toLowerCase()) }
  if (rol) {
    fields.push('rol = ?', 'rol_display = ?')
    values.push(rolMap[rol] ?? 'docente', rol)
  }
  if (activo !== undefined) { fields.push('activo = ?'); values.push(activo ? 1 : 0) }

  if (fields.length === 0) {
    res.status(400).json({ error: 'Nada que actualizar' })
    return
  }

  values.push(id)
  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Record<string, unknown>
  res.json(toRow(updated))
})

router.delete('/:id', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params
  const db = getDb()
  const result = db.prepare('DELETE FROM users WHERE id = ?').run(id)
  if (result.changes === 0) {
    res.status(404).json({ error: 'Usuario no encontrado' })
    return
  }
  res.json({ message: 'Usuario eliminado' })
})

export default router
