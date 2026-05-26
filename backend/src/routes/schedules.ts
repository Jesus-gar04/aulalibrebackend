import { Router } from 'express'
import type { SQLInputValue } from 'node:sqlite'
import { getDb } from '../db'
import { requireAuth, requireAdmin } from '../middleware/auth'

const router = Router()

type ScheduleAssignmentInput = {
  groupId: string
  spaceCodigo: string
  dayIndex: number
  slotIndex: number
}

function mapOffer(g: Record<string, unknown>) {
  return {
    id: g.id,
    codigo: g.codigo,
    nombre: g.nombre,
    semestre: g.semestre,
    cupoMax: g.cupo_max,
    cupoPlaneado: g.cupo_planeado,
    docente: g.docente ?? '—',
    docenteIniciales: g.docente_iniciales ?? null,
    estadoProg: g.estado_prog,
    asignatura: g.asignatura ?? null,
    horas: g.horas ?? 4,
    programaId: g.programa_id ?? null,
    semestreNum: g.semestre_num ?? null,
    grupoSeccion: g.grupo_seccion ?? null,
    alerta: g.alerta ?? undefined,
    estudiantes: g.cupo_planeado,
  }
}

function mapAssignment(row: Record<string, unknown>) {
  return {
    groupId: row.group_id,
    spaceCodigo: row.space_codigo,
    dayIndex: row.day_index,
    slotIndex: row.slot_index,
    status: row.status,
  }
}

router.get('/offer', requireAuth, (_req, res) => {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM groups WHERE asignatura IS NOT NULL ORDER BY semestre_num, asignatura').all() as Record<string, unknown>[]
  res.json(rows.map(mapOffer))
})

router.get('/assignments', requireAuth, (req, res) => {
  const { programaId, semestreNum, grupoSeccion, status = 'draft' } = req.query as {
    programaId?: string
    semestreNum?: string
    grupoSeccion?: string
    status?: string
  }
  if (!programaId || !semestreNum || !grupoSeccion) {
    res.status(400).json({ error: 'programaId, semestreNum y grupoSeccion son requeridos' })
    return
  }

  const db = getDb()
  const rows = db.prepare(`
    SELECT * FROM schedule_assignments
    WHERE program_id = ? AND semestre_num = ? AND grupo_seccion = ? AND status = ?
    ORDER BY day_index, slot_index
  `).all(programaId, Number(semestreNum), grupoSeccion, status) as Record<string, unknown>[]
  res.json(rows.map(mapAssignment))
})

router.put('/assignments', requireAuth, requireAdmin, (req, res) => {
  const { programaId, semestreNum, grupoSeccion, status = 'draft', assignments } = req.body as {
    programaId?: string
    semestreNum?: number
    grupoSeccion?: string
    status?: 'draft' | 'published'
    assignments?: ScheduleAssignmentInput[]
  }

  if (!programaId || semestreNum === undefined || !grupoSeccion || !Array.isArray(assignments)) {
    res.status(400).json({ error: 'Datos de horario incompletos' })
    return
  }
  if (!['draft', 'published'].includes(status)) {
    res.status(400).json({ error: 'Estado de horario inválido' })
    return
  }

  const db = getDb()
  try {
    db.exec('BEGIN')

    db.prepare(`
      DELETE FROM schedule_assignments
      WHERE program_id = ? AND semestre_num = ? AND grupo_seccion = ? AND status = ?
    `).run(programaId, semestreNum, grupoSeccion, status)

    const insert = db.prepare(`
      INSERT INTO schedule_assignments
        (program_id, semestre_num, grupo_seccion, group_id, space_codigo, day_index, slot_index, status, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const now = new Date().toISOString()

    const batchSpaceCells = new Set<string>()
    const batchGroupCells = new Set<string>()

    for (const item of assignments) {
      const spaceCell = `${item.dayIndex}-${item.slotIndex}-${item.spaceCodigo}`
      const groupCell = `${item.dayIndex}-${item.slotIndex}-${item.groupId}`

      if (batchSpaceCells.has(spaceCell)) throw new Error('SPACE_CONFLICT_BATCH')
      if (batchGroupCells.has(groupCell)) throw new Error('GROUP_CONFLICT_BATCH')
      batchSpaceCells.add(spaceCell)
      batchGroupCells.add(groupCell)

      const group = db.prepare('SELECT id FROM groups WHERE id = ?').get(item.groupId)
      const space = db.prepare('SELECT codigo FROM spaces WHERE codigo = ?').get(item.spaceCodigo)
      const slot = db.prepare('SELECT slot_index FROM schedule_slots WHERE slot_index = ? AND locked = 0 AND active = 1').get(item.slotIndex)
      const day = db.prepare('SELECT day_index FROM schedule_days WHERE day_index = ? AND active = 1').get(item.dayIndex)
      if (!group || !space || !slot || !day) throw new Error('INVALID_ASSIGNMENT')

      const existingSpaceConflict = db.prepare(`
        SELECT id FROM schedule_assignments
        WHERE space_codigo = ? AND day_index = ? AND slot_index = ? AND status = ?
      `).get(item.spaceCodigo, item.dayIndex, item.slotIndex, status)
      if (existingSpaceConflict) throw new Error('SPACE_CONFLICT_DB')

      const params: SQLInputValue[] = [
        programaId, semestreNum, grupoSeccion,
        item.groupId, item.spaceCodigo, item.dayIndex, item.slotIndex,
        status, now,
      ]
      insert.run(...params)
    }

    db.exec('COMMIT')
    res.json({
      message: status === 'published' ? 'Horario publicado' : 'Borrador guardado',
      count: assignments.length,
    })
  } catch (err) {
    try { db.exec('ROLLBACK') } catch { /* no-op */ }
    if (err instanceof Error) {
      if (err.message === 'SPACE_CONFLICT_BATCH') {
        res.status(409).json({ error: 'Dos clases del mismo lote asignadas al mismo salón en la misma franja.' })
        return
      }
      if (err.message === 'GROUP_CONFLICT_BATCH') {
        res.status(409).json({ error: 'Un grupo tiene dos asignaciones en la misma franja horaria.' })
        return
      }
      if (err.message === 'SPACE_CONFLICT_DB') {
        res.status(409).json({ error: 'El salón ya está ocupado en esa franja por otro programa o sección.' })
        return
      }
      if (err.message === 'INVALID_ASSIGNMENT') {
        res.status(400).json({ error: 'El horario contiene grupo, salón, día o bloque inválido o bloqueado.' })
        return
      }
      if ((err as NodeJS.ErrnoException).message?.includes('UNIQUE')) {
        res.status(409).json({ error: 'Conflicto de horario detectado por la base de datos.' })
        return
      }
    }
    console.error('[schedules] Error al guardar asignaciones', err)
    res.status(500).json({ error: 'Error al guardar horario' })
  }
})

// Student schedule view — filterable by programaId, semestreNum, grupoSeccion
router.get('/student', requireAuth, (req, res) => {
  const { programaId, semestreNum, grupoSeccion } = req.query as {
    programaId?: string
    semestreNum?: string
    grupoSeccion?: string
  }

  const db = getDb()

  let whereExtra = ''
  const params: SQLInputValue[] = ['published']
  if (programaId) { whereExtra += ' AND a.program_id = ?'; params.push(programaId) }
  if (semestreNum) { whereExtra += ' AND a.semestre_num = ?'; params.push(Number(semestreNum)) }
  if (grupoSeccion) { whereExtra += ' AND a.grupo_seccion = ?'; params.push(grupoSeccion) }

  const rows = db.prepare(`
    SELECT
      a.day_index,
      d.label AS dia,
      sl.label AS hora,
      sl.start_time,
      sl.end_time,
      g.asignatura,
      g.docente,
      a.space_codigo AS salon,
      g.horas,
      a.semestre_num,
      a.program_id AS programa_id,
      a.grupo_seccion
    FROM schedule_assignments a
    JOIN groups g ON g.id = a.group_id
    JOIN schedule_slots sl ON sl.slot_index = a.slot_index
    JOIN schedule_days d ON d.day_index = a.day_index
    WHERE a.status = ?${whereExtra}
    ORDER BY a.day_index, a.slot_index
  `).all(...params) as Record<string, unknown>[]
  res.json({ bloques: rows })
})

// Returns distinct published program+semester+section combos with program name — used by student "Mi horario" selectors
router.get('/published-combos', requireAuth, (_req, res) => {
  const db = getDb()
  const rows = db.prepare(`
    SELECT DISTINCT a.program_id, a.semestre_num, a.grupo_seccion, p.nombre AS programa_nombre
    FROM schedule_assignments a
    JOIN programs p ON p.id = a.program_id
    WHERE a.status = 'published'
    ORDER BY p.nombre, a.semestre_num, a.grupo_seccion
  `).all() as { program_id: string; semestre_num: number; grupo_seccion: string; programa_nombre: string }[]
  res.json(rows)
})

// GET schedule_days and schedule_slots for frontend configuration
router.get('/config', requireAuth, (_req, res) => {
  const db = getDb()
  const days = db.prepare('SELECT * FROM schedule_days ORDER BY day_index').all()
  const slots = db.prepare('SELECT * FROM schedule_slots ORDER BY slot_index').all()
  res.json({ days, slots })
})

export default router
