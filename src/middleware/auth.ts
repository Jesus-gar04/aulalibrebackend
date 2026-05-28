import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { getDb } from '../db'

export interface AuthRequest extends Request {
  user?: { id: number; email: string; rol: string }
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'No autorizado' })
    return
  }
  const token = header.slice(7)
  try {
    const secret = process.env.JWT_SECRET!
    const payload = jwt.verify(token, secret) as { id: number; email: string; rol: string }
    req.user = payload
    next()
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' })
  }
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  const rol = req.user?.rol
  if (rol !== 'admin' && rol !== 'secretaria') {
    res.status(403).json({ error: 'Se requiere rol de administrador' })
    return
  }
  next()
}

export function requireDocente(req: AuthRequest, res: Response, next: NextFunction): void {
  const rol = req.user?.rol
  if (rol !== 'docente' && rol !== 'admin' && rol !== 'secretaria') {
    res.status(403).json({ error: 'Se requiere rol de docente' })
    return
  }
  next()
}

/** Resolves the teacher record linked to the authenticated user (by email match). */
export function resolveTeacherFromUser(userId: number): { id: string; email: string } | undefined {
  const db = getDb()
  const user = db.prepare('SELECT email FROM users WHERE id = ?').get(userId) as { email: string } | undefined
  if (!user) return undefined
  return db.prepare('SELECT id, email FROM teachers WHERE email = ?').get(user.email) as { id: string; email: string } | undefined
}
