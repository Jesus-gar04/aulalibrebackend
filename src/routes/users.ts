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
    rolInterno: u.rol,
    ultimoAcceso: u.ultimo_acceso ?? '—',
    activo: Boolean(u.activo),
    iniciales: u.iniciales,
  }
}

function deriveIniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/)
  return partes.map((p) => p[0] ?? '').join('').slice(0, 2).toUpperCase() || '??'
}

const ROL_MAP: Record<string, string> = {
  Administrador: 'admin',
  Secretaria: 'secretaria',
  Docente: 'docente',
  Estudiante: 'estudiante',
  admin: 'admin',
  secretaria: 'secretaria',
  docente: 'docente',
  estudiante: 'estudiante',
}

const ROL_DISPLAY_MAP: Record<string, string> = {
  admin: 'Administrador',
  secretaria: 'Secretaria',
  docente: 'Docente',
  estudiante: 'Estudiante',
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

  const rolInterno = ROL_MAP[rol] ?? 'docente'
  const rolDisplay = ROL_DISPLAY_MAP[rolInterno] ?? rol
  const iniciales = deriveIniciales(nombre)
  const hash = bcrypt.hashSync(password ?? 'changeme123', 10)

  const db = getDb()
  try {
    const result = db.prepare(`
      INSERT INTO users (nombre, email, password_hash, rol, rol_display, activo, iniciales)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(nombre.trim(), email.trim().toLowerCase(), hash, rolInterno, rolDisplay, activo ? 1 : 0, iniciales)

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
  const { nombre, email, rol, activo, password } = req.body as {
    nombre?: string; email?: string; rol?: string; activo?: boolean; password?: string
  }

  const db = getDb()
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id)
  if (!user) {
    res.status(404).json({ error: 'Usuario no encontrado' })
    return
  }

  const fields: string[] = []
  const values: SQLInputValue[] = []

  if (nombre) {
    fields.push('nombre = ?', 'iniciales = ?')
    values.push(nombre.trim(), deriveIniciales(nombre))
  }
  if (email) { fields.push('email = ?'); values.push(email.trim().toLowerCase()) }
  if (rol) {
    const rolInterno = ROL_MAP[rol] ?? 'docente'
    const rolDisplay = ROL_DISPLAY_MAP[rolInterno] ?? rol
    fields.push('rol = ?', 'rol_display = ?')
    values.push(rolInterno, rolDisplay)
  }
  if (activo !== undefined) { fields.push('activo = ?'); values.push(activo ? 1 : 0) }
  if (password && password.length >= 6) {
    fields.push('password_hash = ?')
    values.push(bcrypt.hashSync(password, 10))
  }

  if (fields.length === 0) {
    res.status(400).json({ error: 'Nada que actualizar' })
    return
  }

  values.push(id)
  try {
    db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).message?.includes('UNIQUE')) {
      res.status(409).json({ error: 'El correo ya está registrado' })
      return
    }
    res.status(500).json({ error: 'Error al actualizar usuario' })
    return
  }
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Record<string, unknown>
  res.json(toRow(updated))
})

router.delete('/:id', requireAuth, requireAdmin, (req: AuthRequest, res) => {
  const { id } = req.params
  if (String(req.user?.id) === id) {
    res.status(400).json({ error: 'No puedes eliminar tu propia cuenta' })
    return
  }
  const db = getDb()
  const result = db.prepare('DELETE FROM users WHERE id = ?').run(id)
  if (result.changes === 0) {
    res.status(404).json({ error: 'Usuario no encontrado' })
    return
  }
  res.json({ message: 'Usuario eliminado' })
})

export default router
