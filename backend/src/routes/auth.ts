import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { getDb } from '../db'

const router = Router()

router.post('/login', (req, res) => {
  const { email, password } = req.body as { email: string; password: string }
  if (!email || !password) {
    res.status(400).json({ error: 'Correo y contraseña son requeridos' })
    return
  }

  const db = getDb()
  const user = db.prepare('SELECT * FROM users WHERE email = ? AND activo = 1').get(email.trim().toLowerCase()) as
    | { id: number; nombre: string; email: string; password_hash: string; rol: string; iniciales: string }
    | undefined

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    res.status(401).json({ error: 'Credenciales incorrectas' })
    return
  }

  const now = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  db.prepare('UPDATE users SET ultimo_acceso = ? WHERE id = ?').run(now, user.id)

  const secret = process.env.JWT_SECRET!
  const expiresIn = process.env.JWT_EXPIRES_IN ?? '24h'
  const token = jwt.sign({ id: user.id, email: user.email, rol: user.rol }, secret, { expiresIn } as jwt.SignOptions)

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      role: user.rol as 'admin' | 'docente' | 'estudiante',
      nombre: user.nombre,
      iniciales: user.iniciales,
      remember: false,
    },
  })
})

router.post('/forgot-password', (req, res) => {
  const { email } = req.body as { email: string }
  if (!email) {
    res.status(400).json({ error: 'Correo requerido' })
    return
  }

  const db = getDb()
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email.trim().toLowerCase())
  if (!user) {
    res.json({ message: 'Si el correo existe, recibirás instrucciones.' })
    return
  }

  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = Date.now() + 1000 * 60 * 30 // 30 min

  db.prepare('DELETE FROM password_reset_tokens WHERE email = ?').run(email)
  db.prepare('INSERT INTO password_reset_tokens (email, token, expires_at) VALUES (?, ?, ?)').run(email, token, expiresAt)

  console.log(`[AUTH] Reset token para ${email}: ${token}`)
  res.json({ message: 'Si el correo existe, recibirás instrucciones.' })
})

router.post('/reset-password', (req, res) => {
  const { token, password } = req.body as { token: string; password: string }
  if (!token || !password || password.length < 6) {
    res.status(400).json({ error: 'Token y contraseña (mín. 6 caracteres) son requeridos' })
    return
  }

  const db = getDb()
  const record = db.prepare('SELECT * FROM password_reset_tokens WHERE token = ?').get(token) as
    | { email: string; expires_at: number }
    | undefined

  if (!record || record.expires_at < Date.now()) {
    res.status(400).json({ error: 'Token inválido o expirado' })
    return
  }

  const hash = bcrypt.hashSync(password, 10)
  db.prepare('UPDATE users SET password_hash = ? WHERE email = ?').run(hash, record.email)
  db.prepare('DELETE FROM password_reset_tokens WHERE token = ?').run(token)

  res.json({ message: 'Contraseña actualizada correctamente' })
})

export default router
