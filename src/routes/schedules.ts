import { Router } from 'express'
import type { SQLInputValue } from 'node:sqlite'
import { getDb, syncAllTeacherStats } from '../db'
import { requireAuth, requireAdmin, resolveTeacherFromUser, type AuthRequest } from '../middleware/auth'

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
    jornada: g.jornada ?? 'Diurna',
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

// ── Offer (groups with subjects) ─────────────────────────────────────────────
router.get('/offer', requireAuth, (_req, res) => {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM groups WHERE asignatura IS NOT NULL ORDER BY semestre_num, asignatura').all() as Record<string, unknown>[]
  res.json(rows.map(mapOffer))
})

// ── Schedule config (days + slots) ──────────────────────────────────────────
router.get('/config', requireAuth, (_req, res) => {
  const db = getDb()
  res.json({
    days: db.prepare('SELECT * FROM schedule_days ORDER BY day_index').all(),
    slots: db.prepare('SELECT * FROM schedule_slots ORDER BY slot_index').all(),
  })
})

// ── Published combos for student selectors ───────────────────────────────────
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

// ── Get assignments for a program/semester/section ───────────────────────────
router.get('/assignments', requireAuth, (req, res) => {
  const { programaId, semestreNum, grupoSeccion, status = 'draft' } = req.query as {
    programaId?: string; semestreNum?: string; grupoSeccion?: string; status?: string
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

// ── Save / publish assignments ────────────────────────────────────────────────
router.put('/assignments', requireAuth, requireAdmin, (req, res) => {
  const { programaId, semestreNum, grupoSeccion, status = 'draft', assignments } = req.body as {
    programaId?: string; semestreNum?: number; grupoSeccion?: string;
    status?: 'draft' | 'published'; assignments?: ScheduleAssignmentInput[]
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
    const batchTeacherCells = new Set<string>()

    for (const item of assignments) {
      // In-batch duplicate detection
      const spaceCell = `${item.dayIndex}-${item.slotIndex}-${item.spaceCodigo}`
      const groupCell = `${item.dayIndex}-${item.slotIndex}-${item.groupId}`
      if (batchSpaceCells.has(spaceCell)) throw new Error('SPACE_CONFLICT_BATCH')
      if (batchGroupCells.has(groupCell)) throw new Error('GROUP_CONFLICT_BATCH')
      batchSpaceCells.add(spaceCell)
      batchGroupCells.add(groupCell)

      // Validate referenced entities
      const group = db.prepare('SELECT id, teacher_id FROM groups WHERE id = ?').get(item.groupId) as { id: string; teacher_id: string | null } | undefined
      const space = db.prepare('SELECT codigo FROM spaces WHERE codigo = ?').get(item.spaceCodigo)
      const slot = db.prepare('SELECT slot_index FROM schedule_slots WHERE slot_index = ? AND locked = 0 AND active = 1').get(item.slotIndex)
      const day = db.prepare('SELECT day_index FROM schedule_days WHERE day_index = ? AND active = 1').get(item.dayIndex)
      if (!group || !space || !slot || !day) throw new Error('INVALID_ASSIGNMENT')

      // DB-level space conflict (another program/section already has this space at this slot)
      const spaceConflict = db.prepare(`
        SELECT id FROM schedule_assignments
        WHERE space_codigo = ? AND day_index = ? AND slot_index = ? AND status = ?
      `).get(item.spaceCodigo, item.dayIndex, item.slotIndex, status)
      if (spaceConflict) throw new Error('SPACE_CONFLICT_DB')

      // Teacher conflict detection
      if (group.teacher_id) {
        const teacherCell = `${item.dayIndex}-${item.slotIndex}-${group.teacher_id}`
        if (batchTeacherCells.has(teacherCell)) throw new Error('TEACHER_CONFLICT_BATCH')
        batchTeacherCells.add(teacherCell)

        const teacherConflict = db.prepare(`
          SELECT sa.id FROM schedule_assignments sa
          JOIN groups g ON g.id = sa.group_id
          WHERE g.teacher_id = ? AND sa.day_index = ? AND sa.slot_index = ? AND sa.status = ?
            AND sa.group_id != ?
        `).get(group.teacher_id, item.dayIndex, item.slotIndex, status, item.groupId)
        if (teacherConflict) throw new Error('TEACHER_CONFLICT_DB')
      }

      const params: SQLInputValue[] = [
        programaId, semestreNum, grupoSeccion,
        item.groupId, item.spaceCodigo, item.dayIndex, item.slotIndex,
        status, now,
      ]
      insert.run(...params)
    }

    db.exec('COMMIT')

    // When publishing, sync teacher stats and notify users
    if (status === 'published') {
      syncAllTeacherStats(db)
      notifySchedulePublished(db, programaId, semestreNum, grupoSeccion, now)
    }

    res.json({
      message: status === 'published' ? 'Horario publicado' : 'Borrador guardado',
      count: assignments.length,
    })
  } catch (err) {
    try { db.exec('ROLLBACK') } catch { /* no-op */ }
    if (err instanceof Error) {
      const errorMap: Record<string, string> = {
        SPACE_CONFLICT_BATCH: 'Dos clases del mismo lote asignadas al mismo salón en la misma franja.',
        GROUP_CONFLICT_BATCH: 'Un grupo tiene dos asignaciones en la misma franja horaria.',
        SPACE_CONFLICT_DB: 'El salón ya está ocupado en esa franja por otro programa o sección.',
        TEACHER_CONFLICT_BATCH: 'El mismo docente tiene dos grupos asignados en la misma franja horaria (mismo lote).',
        TEACHER_CONFLICT_DB: 'El docente ya tiene otro grupo asignado en esa franja horaria.',
        INVALID_ASSIGNMENT: 'El horario contiene grupo, salón, día o bloque inválido o bloqueado.',
      }
      if (errorMap[err.message]) {
        res.status(409).json({ error: errorMap[err.message] })
        return
      }
      if (err.message.includes('UNIQUE')) {
        res.status(409).json({ error: 'Conflicto de horario detectado por la base de datos.' })
        return
      }
    }
    console.error('[schedules] Error al guardar asignaciones', err)
    res.status(500).json({ error: 'Error al guardar horario' })
  }
})

function notifySchedulePublished(db: ReturnType<typeof getDb>, programaId: string, semestreNum: number, grupoSeccion: string, now: string) {
  const prog = db.prepare('SELECT nombre FROM programs WHERE id = ?').get(programaId) as { nombre: string } | undefined
  const progNombre = prog?.nombre ?? programaId
  const titulo = 'Horario publicado'
  const mensaje = `El horario de ${progNombre} - Semestre ${semestreNum}, Sección ${grupoSeccion} ha sido publicado.`

  // Notify all active students and teachers
  const users = db.prepare("SELECT id FROM users WHERE activo = 1 AND rol IN ('estudiante', 'docente')").all() as { id: number }[]
  for (const u of users) {
    db.prepare('INSERT INTO notifications (user_id, tipo, titulo, mensaje, created_at) VALUES (?, ?, ?, ?, ?)').run(
      u.id, 'horario', titulo, mensaje, now,
    )
  }
}

// ── Student schedule view (published) ────────────────────────────────────────
router.get('/student', requireAuth, (req, res) => {
  const { programaId, semestreNum, grupoSeccion } = req.query as {
    programaId?: string; semestreNum?: string; grupoSeccion?: string
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
      g.id AS group_id,
      g.asignatura,
      g.docente,
      g.docente_iniciales,
      a.space_codigo AS salon,
      g.horas,
      g.cupo_max,
      g.cupo_planeado,
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

// ── Teacher schedule view ─────────────────────────────────────────────────────
router.get('/teacher', requireAuth, (req: AuthRequest, res) => {
  const { teacherId: qTeacherId, status = 'published', dia } = req.query as {
    teacherId?: string; status?: string; dia?: string
  }

  const db = getDb()
  let resolvedTeacherId = qTeacherId

  // Docentes can only see their own schedule (admins can query any)
  const userRol = req.user!.rol
  if (userRol !== 'admin' && userRol !== 'secretaria') {
    const linked = resolveTeacherFromUser(req.user!.id)
    if (!linked) { res.status(404).json({ error: 'No tienes un perfil de docente asociado' }); return }
    resolvedTeacherId = linked.id
  }

  if (!resolvedTeacherId) {
    res.status(400).json({ error: 'teacherId es requerido' })
    return
  }

  let whereExtra = ''
  const params: SQLInputValue[] = [resolvedTeacherId, status]
  if (dia !== undefined) { whereExtra += ' AND d.day_index = ?'; params.push(Number(dia)) }

  const rows = db.prepare(`
    SELECT
      a.day_index,
      d.label AS dia,
      sl.slot_index,
      sl.label AS hora,
      sl.start_time,
      sl.end_time,
      g.id AS group_id,
      g.asignatura,
      g.nombre AS grupo_nombre,
      g.codigo AS grupo_codigo,
      g.grupo_seccion,
      a.space_codigo AS salon,
      a.program_id AS programa_id,
      p.nombre AS programa_nombre,
      a.semestre_num,
      a.status
    FROM schedule_assignments a
    JOIN groups g ON g.id = a.group_id
    JOIN schedule_slots sl ON sl.slot_index = a.slot_index
    JOIN schedule_days d ON d.day_index = a.day_index
    JOIN programs p ON p.id = a.program_id
    WHERE g.teacher_id = ? AND a.status = ?${whereExtra}
    ORDER BY a.day_index, a.slot_index
  `).all(...params) as Record<string, unknown>[]

  res.json({ teacherId: resolvedTeacherId, bloques: rows })
})

// ── Student preselection ──────────────────────────────────────────────────────

router.get('/student-preselections', requireAuth, requireAdmin, (_req, res) => {
  const db = getDb()
  const preselections = db.prepare(`
    SELECT sp.*, u.nombre AS student_nombre, u.email AS student_email
    FROM student_preselections sp
    JOIN users u ON u.id = sp.student_user_id
    ORDER BY sp.updated_at DESC
  `).all() as Record<string, unknown>[]

  const result = preselections.map(p => {
    const groups = db.prepare(`
      SELECT g.id, g.asignatura, g.nombre, g.grupo_seccion, g.docente
      FROM student_preselection_groups spg
      JOIN groups g ON g.id = spg.group_id
      WHERE spg.preselection_id = ?
    `).all(p.id as number) as Record<string, unknown>[]
    return {
      id: p.id,
      studentUserId: p.student_user_id,
      studentNombre: p.student_nombre,
      studentEmail: p.student_email,
      programId: p.program_id,
      semestreNum: p.semestre_num,
      status: p.status,
      conflicts: JSON.parse((p.conflicts as string) ?? '[]'),
      createdAt: p.created_at,
      updatedAt: p.updated_at,
      groups,
    }
  })
  res.json(result)
})

router.get('/student-preselection', requireAuth, (req: AuthRequest, res) => {
  const db = getDb()
  const userId = req.user!.id

  const preselection = db.prepare(`
    SELECT * FROM student_preselections WHERE student_user_id = ? ORDER BY updated_at DESC LIMIT 1
  `).get(userId) as Record<string, unknown> | undefined

  if (!preselection) { res.json(null); return }

  const groups = db.prepare(`
    SELECT g.id, g.asignatura, g.nombre, g.grupo_seccion, g.docente, g.horas, g.cupo_max, g.cupo_planeado
    FROM student_preselection_groups spg
    JOIN groups g ON g.id = spg.group_id
    WHERE spg.preselection_id = ?
  `).all(preselection.id as number) as Record<string, unknown>[]

  res.json({
    id: preselection.id,
    programId: preselection.program_id,
    semestreNum: preselection.semestre_num,
    status: preselection.status,
    conflicts: JSON.parse((preselection.conflicts as string) ?? '[]'),
    createdAt: preselection.created_at,
    updatedAt: preselection.updated_at,
    groups,
  })
})

router.post('/student-preselection', requireAuth, (req: AuthRequest, res) => {
  const { groupIds, programaId, semestreNum } = req.body as {
    groupIds: string[]; programaId?: string; semestreNum?: number
  }
  if (!Array.isArray(groupIds) || groupIds.length === 0) {
    res.status(400).json({ error: 'groupIds (array no vacío) es requerido' })
    return
  }

  const userId = req.user!.id
  const db = getDb()
  const now = new Date().toISOString()
  const conflicts: string[] = []

  // Build a map of day+slot -> asignatura from published schedule for selected groups
  const slotMap = new Map<string, string>()

  for (const groupId of groupIds) {
    const group = db.prepare('SELECT id, asignatura, cupo_max FROM groups WHERE id = ?').get(groupId) as {
      id: string; asignatura: string; cupo_max: number
    } | undefined

    if (!group) {
      conflicts.push(`Grupo ${groupId} no encontrado`)
      continue
    }

    // Time conflict detection (only if schedule is published)
    const assignments = db.prepare(`
      SELECT a.day_index, a.slot_index, d.label AS dia, sl.label AS hora
      FROM schedule_assignments a
      JOIN schedule_days d ON d.day_index = a.day_index
      JOIN schedule_slots sl ON sl.slot_index = a.slot_index
      WHERE a.group_id = ? AND a.status = 'published'
    `).all(groupId) as { day_index: number; slot_index: number; dia: string; hora: string }[]

    for (const a of assignments) {
      const key = `${a.day_index}-${a.slot_index}`
      if (slotMap.has(key)) {
        conflicts.push(`Cruce de horario: "${group.asignatura}" y "${slotMap.get(key)}" coinciden el ${a.dia} ${a.hora}`)
      } else {
        slotMap.set(key, group.asignatura ?? groupId)
      }
    }

    // Capacity check: count validated preselections for this group
    const enrolled = db.prepare(`
      SELECT COUNT(*) AS c FROM student_preselection_groups spg
      JOIN student_preselections sp ON sp.id = spg.preselection_id
      WHERE spg.group_id = ? AND sp.status = 'validado' AND sp.student_user_id != ?
    `).get(groupId, userId) as { c: number }

    if (enrolled.c >= group.cupo_max) {
      conflicts.push(`Cupo máximo alcanzado en "${group.asignatura ?? groupId}" (máx. ${group.cupo_max})`)
    }
  }

  const status = conflicts.length > 0 ? 'conflicto' : 'validado'

  try {
    db.exec('BEGIN')

    // Replace existing preselection for this student
    const existing = db.prepare('SELECT id FROM student_preselections WHERE student_user_id = ?').get(userId) as { id: number } | undefined
    if (existing) {
      db.prepare('DELETE FROM student_preselection_groups WHERE preselection_id = ?').run(existing.id)
      db.prepare('DELETE FROM student_preselections WHERE id = ?').run(existing.id)
    }

    const result = db.prepare(`
      INSERT INTO student_preselections (student_user_id, program_id, semestre_num, status, conflicts, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(userId, programaId ?? null, semestreNum ?? null, status, JSON.stringify(conflicts), now, now)

    const preselectionId = result.lastInsertRowid
    for (const groupId of groupIds) {
      try {
        db.prepare('INSERT INTO student_preselection_groups (preselection_id, group_id) VALUES (?, ?)').run(preselectionId, groupId)
      } catch {
        // group not found — already logged in conflicts above
      }
    }

    db.exec('COMMIT')

    // Notify student if there are conflicts
    if (conflicts.length > 0) {
      db.prepare('INSERT INTO notifications (user_id, tipo, titulo, mensaje, created_at) VALUES (?, ?, ?, ?, ?)').run(
        userId, 'conflicto',
        'Conflictos en tu preselección de horario',
        `Tu preselección tiene ${conflicts.length} conflicto(s). El primero: ${conflicts[0]}`,
        now,
      )
    }

    res.status(201).json({
      status,
      conflicts,
      message: status === 'validado'
        ? 'Preselección guardada exitosamente sin conflictos'
        : `Preselección guardada con ${conflicts.length} conflicto(s) detectado(s)`,
    })
  } catch (err) {
    try { db.exec('ROLLBACK') } catch { /* no-op */ }
    console.error('[schedules] Error al guardar preselección', err)
    res.status(500).json({ error: 'Error al guardar preselección' })
  }
})

export default router
