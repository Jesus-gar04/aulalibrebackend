import { Router } from 'express'
import crypto from 'crypto'
import type { SQLInputValue } from 'node:sqlite'
import { getDb } from '../db'
import { requireAuth, requireAdmin } from '../middleware/auth'

const router = Router()

function mapGroup(g: Record<string, unknown>) {
  return {
    id: g.id,
    codigo: g.codigo,
    nombre: g.nombre,
    semestre: g.semestre,
    cupoMax: g.cupo_max,
    cupoPlaneado: g.cupo_planeado,
    teacherId: g.teacher_id ?? null,
    docente: g.docente ?? null,
    docenteIniciales: g.docente_iniciales ?? null,
    estadoProg: g.estado_prog,
    asignatura: g.asignatura ?? null,
    horas: g.horas ?? 4,
    programaId: g.programa_id ?? null,
    semestreNum: g.semestre_num ?? 1,
    grupoSeccion: g.grupo_seccion ?? 'A',
    alerta: g.alerta ?? null,
    estudiantes: g.cupo_planeado,
    docente_display: g.docente ?? '—',
  }
}

router.get('/', requireAuth, (_req, res) => {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM groups ORDER BY semestre_num, codigo').all() as Record<string, unknown>[]
  res.json(rows.map(mapGroup))
})

router.get('/offer', requireAuth, (_req, res) => {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM groups WHERE asignatura IS NOT NULL ORDER BY semestre_num, asignatura').all() as Record<string, unknown>[]
  res.json(rows.map((g) => ({
    id: g.id,
    programaId: g.programa_id,
    semestreNum: g.semestre_num,
    grupoSeccion: g.grupo_seccion,
    semestre: g.semestre,
    asignatura: g.asignatura,
    horas: g.horas,
    docente: g.docente ?? '—',
    estudiantes: g.cupo_planeado,
    alerta: g.alerta ?? undefined,
  })))
})

router.post('/', requireAuth, requireAdmin, (req, res) => {
  const {
    id, codigo, nombre, semestre, cupoMax, cupoPlaneado,
    teacherId, docente, docenteIniciales, estadoProg,
    asignatura, horas, programaId, semestreNum, grupoSeccion,
  } = req.body as {
    id?: string; codigo: string; nombre: string; semestre: string;
    cupoMax?: number; cupoPlaneado?: number;
    teacherId?: string; docente?: string; docenteIniciales?: string; estadoProg?: string;
    asignatura?: string; horas?: number; programaId?: string; semestreNum?: number; grupoSeccion?: string
  }
  if (!codigo || !nombre || !semestre) {
    res.status(400).json({ error: 'codigo, nombre y semestre son requeridos' })
    return
  }
  const groupId = id ?? `g-${crypto.randomBytes(6).toString('hex')}`
  const db = getDb()
  try {
    db.prepare(`
      INSERT INTO groups (id, codigo, nombre, semestre, cupo_max, cupo_planeado, teacher_id, docente, docente_iniciales, estado_prog, asignatura, horas, programa_id, semestre_num, grupo_seccion)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      groupId, codigo.trim(), nombre.trim(), semestre.trim(),
      cupoMax ?? 40, cupoPlaneado ?? 40,
      teacherId ?? null, docente ?? null, docenteIniciales ?? null,
      estadoProg ?? 'pendiente', asignatura ?? null, horas ?? 4,
      programaId ?? null, semestreNum ?? 1, grupoSeccion ?? 'A',
    )
    const created = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId) as Record<string, unknown>
    res.status(201).json(mapGroup(created))
  } catch {
    res.status(500).json({ error: 'Error al crear grupo' })
  }
})

router.put('/:id', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params
  const db = getDb()
  const existing = db.prepare('SELECT id FROM groups WHERE id = ?').get(id)
  if (!existing) { res.status(404).json({ error: 'Grupo no encontrado' }); return }

  const {
    codigo, nombre, semestre,
    teacherId, docente, docenteIniciales, estadoProg,
    cupoMax, cupoPlaneado,
    asignatura, horas, programaId, semestreNum, grupoSeccion, alerta,
  } = req.body as Record<string, unknown>

  const fields: string[] = []
  const vals: SQLInputValue[] = []

  if (codigo !== undefined) { fields.push('codigo = ?'); vals.push(codigo as SQLInputValue) }
  if (nombre !== undefined) { fields.push('nombre = ?'); vals.push(nombre as SQLInputValue) }
  if (semestre !== undefined) { fields.push('semestre = ?'); vals.push(semestre as SQLInputValue) }
  if (teacherId !== undefined) { fields.push('teacher_id = ?'); vals.push(teacherId as SQLInputValue) }
  if (docente !== undefined) { fields.push('docente = ?'); vals.push(docente as SQLInputValue) }
  if (docenteIniciales !== undefined) { fields.push('docente_iniciales = ?'); vals.push(docenteIniciales as SQLInputValue) }
  if (estadoProg !== undefined) { fields.push('estado_prog = ?'); vals.push(estadoProg as SQLInputValue) }
  if (cupoMax !== undefined) { fields.push('cupo_max = ?'); vals.push(cupoMax as SQLInputValue) }
  if (cupoPlaneado !== undefined) { fields.push('cupo_planeado = ?'); vals.push(cupoPlaneado as SQLInputValue) }
  if (asignatura !== undefined) { fields.push('asignatura = ?'); vals.push(asignatura as SQLInputValue) }
  if (horas !== undefined) { fields.push('horas = ?'); vals.push(horas as SQLInputValue) }
  if (programaId !== undefined) { fields.push('programa_id = ?'); vals.push(programaId as SQLInputValue) }
  if (semestreNum !== undefined) { fields.push('semestre_num = ?'); vals.push(semestreNum as SQLInputValue) }
  if (grupoSeccion !== undefined) { fields.push('grupo_seccion = ?'); vals.push(grupoSeccion as SQLInputValue) }
  if (alerta !== undefined) { fields.push('alerta = ?'); vals.push(alerta as SQLInputValue) }

  if (!fields.length) { res.status(400).json({ error: 'Nada que actualizar' }); return }
  vals.push(id)
  db.prepare(`UPDATE groups SET ${fields.join(', ')} WHERE id = ?`).run(...vals)
  const updated = db.prepare('SELECT * FROM groups WHERE id = ?').get(id) as Record<string, unknown>
  res.json(mapGroup(updated))
})

router.delete('/:id', requireAuth, requireAdmin, (req, res) => {
  const db = getDb()
  const result = db.prepare('DELETE FROM groups WHERE id = ?').run(req.params.id)
  if (result.changes === 0) { res.status(404).json({ error: 'Grupo no encontrado' }); return }
  res.json({ message: 'Grupo eliminado' })
})

export default router
