import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'

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
  if (req.user?.rol !== 'admin') {
    res.status(403).json({ error: 'Se requiere rol de administrador' })
    return
  }
  next()
}
