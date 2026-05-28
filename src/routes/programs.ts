import { Router } from 'express'
import type { SQLInputValue } from 'node:sqlite'
import { getDb } from '../db'
import { requireAuth, requireAdmin } from '../middleware/auth'

const router = Router()

router.get('/', requireAuth, (_req, res) => {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM programs ORDER BY nombre').all()
  res.json(rows)
})

router.post('/', requireAuth, requireAdmin, (req, res) => {
  const { id, nombre, snies, semestres, creditos } = req.body as {
    id: string; nombre: string; snies: string; semestres: number; creditos: number
  }
  if (!id || !nombre || !snies) {
    res.status(400).json({ error: 'id, nombre y snies son requeridos' })
    return
  }
  const db = getDb()
  try {
    db.prepare('INSERT INTO programs (id, nombre, snies, semestres, creditos) VALUES (?, ?, ?, ?, ?)').run(
      id.trim().toLowerCase(), nombre.trim(), snies.trim(), semestres ?? 10, creditos ?? 160
    )
    const created = db.prepare('SELECT * FROM programs WHERE id = ?').get(id.trim().toLowerCase())
    res.status(201).json(created)
  } catch {
    res.status(409).json({ error: 'El programa ya existe' })
  }
})

router.put('/:id', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params
  const { nombre, snies, semestres, creditos } = req.body as {
    nombre?: string; snies?: string; semestres?: number; creditos?: number
  }
  const db = getDb()
  const prog = db.prepare('SELECT id FROM programs WHERE id = ?').get(id)
  if (!prog) { res.status(404).json({ error: 'Programa no encontrado' }); return }

  const fields: string[] = []
  const vals: SQLInputValue[] = []
  if (nombre) { fields.push('nombre = ?'); vals.push(nombre) }
  if (snies) { fields.push('snies = ?'); vals.push(snies) }
  if (semestres) { fields.push('semestres = ?'); vals.push(semestres) }
  if (creditos) { fields.push('creditos = ?'); vals.push(creditos) }
  if (!fields.length) { res.status(400).json({ error: 'Nada que actualizar' }); return }
  vals.push(id)
  db.prepare(`UPDATE programs SET ${fields.join(', ')} WHERE id = ?`).run(...vals)
  res.json(db.prepare('SELECT * FROM programs WHERE id = ?').get(id))
})

router.delete('/:id', requireAuth, requireAdmin, (req, res) => {
  const db = getDb()
  const result = db.prepare('DELETE FROM programs WHERE id = ?').run(req.params.id)
  if (result.changes === 0) { res.status(404).json({ error: 'Programa no encontrado' }); return }
  res.json({ message: 'Programa eliminado' })
})

// Subjects
router.get('/:programId/subjects', requireAuth, (req, res) => {
  const { programId } = req.params
  const { semestre } = req.query
  const db = getDb()
  let query = 'SELECT * FROM subjects WHERE program_id = ?'
  const params: SQLInputValue[] = [programId]
  if (semestre) { query += ' AND semestre = ?'; params.push(Number(semestre)) }
  query += ' ORDER BY semestre, codigo'
  res.json(db.prepare(query).all(...params))
})

router.post('/:programId/subjects', requireAuth, requireAdmin, (req, res) => {
  const { programId } = req.params
  const { semestre, codigo, nombre, creditos, hTeoria, hPractica, area, areaTone } = req.body as {
    semestre: number; codigo: string; nombre: string; creditos: number;
    hTeoria: number; hPractica: number; area: string; areaTone: string
  }
  if (!codigo || !nombre) { res.status(400).json({ error: 'código y nombre son requeridos' }); return }
  const db = getDb()
  const result = db.prepare(`
    INSERT INTO subjects (program_id, semestre, codigo, nombre, creditos, h_teoria, h_practica, area, area_tone)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(programId, semestre ?? 1, codigo.trim(), nombre.trim(), creditos ?? 3, hTeoria ?? 2, hPractica ?? 0, area ?? 'Específica', areaTone ?? 'emerald')
  res.status(201).json(db.prepare('SELECT * FROM subjects WHERE id = ?').get(result.lastInsertRowid))
})

router.delete('/subjects/:id', requireAuth, requireAdmin, (req, res) => {
  const db = getDb()
  const result = db.prepare('DELETE FROM subjects WHERE id = ?').run(req.params.id)
  if (result.changes === 0) { res.status(404).json({ error: 'Asignatura no encontrada' }); return }
  res.json({ message: 'Asignatura eliminada' })
})

export default router
