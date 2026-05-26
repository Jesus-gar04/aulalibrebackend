import { Router } from 'express'
import crypto from 'crypto'
import type { SQLInputValue } from 'node:sqlite'
import { getDb } from '../db'
import { requireAuth, requireAdmin } from '../middleware/auth'

const router = Router()

function deriveIniciales(nombreCompleto: string): string {
  const partes = nombreCompleto.trim().split(/\s+/)
  return ((partes[0]?.[0] ?? '') + (partes[1]?.[0] ?? partes[0]?.[1] ?? '')).toUpperCase() || '??'
}

function buildTeacher(t: Record<string, unknown>, loads: Record<string, unknown>[]) {
  return {
    id: t.id,
    nombreCompleto: t.nombre_completo,
    tituloProfesional: t.titulo_profesional,
    iniciales: t.iniciales,
    vinculacion: t.vinculacion,
    departamento: t.departamento,
    email: t.email,
    telefono: t.telefono ?? '—',
    maxHorasSemana: t.max_horas_semana,
    gruposActivos: t.grupos_activos,
    asignaturasDistintas: t.asignaturas_distintas,
    espaciosFrecuentes: JSON.parse((t.espacios_frecuentes as string) ?? '[]'),
    ultimaActualizacionCarga: t.ultima_actualizacion_carga,
    carga: loads.map((l) => ({
      asignatura: l.asignatura,
      codigo: l.codigo,
      grupo: l.grupo,
      programa: l.programa,
      horasSemana: l.horas_semana,
      horario: l.horario,
      salon: l.salon,
    })),
  }
}

router.get('/', requireAuth, (_req, res) => {
  const db = getDb()
  const teachers = db.prepare('SELECT * FROM teachers ORDER BY nombre_completo').all() as Record<string, unknown>[]
  const result = teachers.map((t) => {
    const loads = db.prepare('SELECT * FROM teacher_loads WHERE teacher_id = ?').all(t.id as string) as Record<string, unknown>[]
    return buildTeacher(t, loads)
  })
  res.json(result)
})

// IMPORTANT: /by-email/:email must come before /:id to avoid ambiguity in single-segment routes
router.get('/by-email/:email', requireAuth, (req, res) => {
  const db = getDb()
  const t = db.prepare('SELECT * FROM teachers WHERE email = ?').get(decodeURIComponent(req.params.email)) as Record<string, unknown> | undefined
  if (!t) { res.status(404).json({ error: 'Docente no encontrado' }); return }
  const loads = db.prepare('SELECT * FROM teacher_loads WHERE teacher_id = ?').all(t.id as string) as Record<string, unknown>[]
  res.json(buildTeacher(t, loads))
})

router.get('/:id', requireAuth, (req, res) => {
  const db = getDb()
  const t = db.prepare('SELECT * FROM teachers WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined
  if (!t) { res.status(404).json({ error: 'Docente no encontrado' }); return }
  const loads = db.prepare('SELECT * FROM teacher_loads WHERE teacher_id = ?').all(t.id as string) as Record<string, unknown>[]
  res.json(buildTeacher(t, loads))
})

router.post('/', requireAuth, requireAdmin, (req, res) => {
  const { id, nombreCompleto, tituloProfesional, email, telefono, departamento, vinculacion, maxHorasSemana } = req.body as {
    id?: string; nombreCompleto: string; tituloProfesional: string; email: string;
    telefono?: string; departamento: string; vinculacion: string; maxHorasSemana: number
  }
  if (!nombreCompleto || !email || !departamento) {
    res.status(400).json({ error: 'nombre, email y departamento son requeridos' })
    return
  }
  const iniciales = deriveIniciales(nombreCompleto)
  const teacherId = id ?? `d-${crypto.randomBytes(6).toString('hex')}`

  const db = getDb()
  try {
    db.prepare(`
      INSERT INTO teachers (id, nombre_completo, titulo_profesional, iniciales, vinculacion, departamento, email, telefono, max_horas_semana)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(teacherId, nombreCompleto.trim(), tituloProfesional ?? 'Ing.', iniciales, vinculacion ?? 'Cátedra', departamento.trim(), email.trim().toLowerCase(), telefono ?? '—', maxHorasSemana ?? 40)
    const created = db.prepare('SELECT * FROM teachers WHERE id = ?').get(teacherId) as Record<string, unknown>
    res.status(201).json(buildTeacher(created, []))
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).message?.includes('UNIQUE')) {
      res.status(409).json({ error: 'El correo ya está registrado' })
    } else {
      res.status(500).json({ error: 'Error al crear docente' })
    }
  }
})

router.put('/:id', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params
  const { nombreCompleto, tituloProfesional, email, telefono, departamento, vinculacion, maxHorasSemana } = req.body as Record<string, unknown>
  const db = getDb()
  const existing = db.prepare('SELECT id FROM teachers WHERE id = ?').get(id)
  if (!existing) { res.status(404).json({ error: 'Docente no encontrado' }); return }

  const fields: string[] = []
  const vals: SQLInputValue[] = []
  if (nombreCompleto) {
    fields.push('nombre_completo = ?', 'iniciales = ?')
    vals.push(nombreCompleto as SQLInputValue, deriveIniciales(nombreCompleto as string))
  }
  if (tituloProfesional) { fields.push('titulo_profesional = ?'); vals.push(tituloProfesional as SQLInputValue) }
  if (email) { fields.push('email = ?'); vals.push((email as string).toLowerCase()) }
  if (telefono !== undefined) { fields.push('telefono = ?'); vals.push(telefono as SQLInputValue) }
  if (departamento) { fields.push('departamento = ?'); vals.push(departamento as SQLInputValue) }
  if (vinculacion) { fields.push('vinculacion = ?'); vals.push(vinculacion as SQLInputValue) }
  if (maxHorasSemana !== undefined) { fields.push('max_horas_semana = ?'); vals.push(maxHorasSemana as SQLInputValue) }
  if (!fields.length) { res.status(400).json({ error: 'Nada que actualizar' }); return }

  vals.push(id)
  try {
    db.prepare(`UPDATE teachers SET ${fields.join(', ')} WHERE id = ?`).run(...vals)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).message?.includes('UNIQUE')) {
      res.status(409).json({ error: 'El correo ya está registrado' })
      return
    }
    res.status(500).json({ error: 'Error al actualizar docente' })
    return
  }
  const t = db.prepare('SELECT * FROM teachers WHERE id = ?').get(id) as Record<string, unknown>
  const loads = db.prepare('SELECT * FROM teacher_loads WHERE teacher_id = ?').all(id) as Record<string, unknown>[]
  res.json(buildTeacher(t, loads))
})

router.delete('/:id', requireAuth, requireAdmin, (req, res) => {
  const db = getDb()
  const result = db.prepare('DELETE FROM teachers WHERE id = ?').run(req.params.id)
  if (result.changes === 0) { res.status(404).json({ error: 'Docente no encontrado' }); return }
  res.json({ message: 'Docente eliminado' })
})

// Availability
router.get('/:id/availability', requireAuth, (req, res) => {
  const db = getDb()
  const rows = db.prepare('SELECT slot_key, disponible FROM teacher_availability WHERE teacher_id = ?').all(req.params.id) as { slot_key: string; disponible: number }[]
  const result: Record<string, boolean> = {}
  for (const row of rows) result[row.slot_key] = Boolean(row.disponible)
  res.json(result)
})

router.put('/:id/availability', requireAuth, (req, res) => {
  const { id } = req.params
  const availability = req.body as unknown
  if (!availability || Array.isArray(availability) || typeof availability !== 'object') {
    res.status(400).json({ error: 'La disponibilidad debe ser un objeto de bloques.' })
    return
  }

  const db = getDb()
  const teacher = db.prepare('SELECT id FROM teachers WHERE id = ?').get(id)
  if (!teacher) {
    res.status(404).json({ error: 'Docente no encontrado' })
    return
  }

  try {
    db.exec('BEGIN')
    db.prepare('DELETE FROM teacher_availability WHERE teacher_id = ?').run(id)
    const insert = db.prepare(
      'INSERT INTO teacher_availability (teacher_id, slot_key, disponible) VALUES (?, ?, ?)',
    )
    for (const [key, val] of Object.entries(availability as Record<string, unknown>)) {
      if (typeof val !== 'boolean') {
        throw new Error('INVALID_AVAILABILITY_VALUE')
      }
      insert.run(id, key, val ? 1 : 0)
    }
    db.exec('COMMIT')
    res.json({ message: 'Disponibilidad actualizada' })
  } catch (err) {
    try { db.exec('ROLLBACK') } catch { /* no-op si no hay transacción activa */ }
    if (err instanceof Error && err.message === 'INVALID_AVAILABILITY_VALUE') {
      res.status(400).json({ error: 'Cada bloque de disponibilidad debe ser booleano.' })
      return
    }
    console.error('[teachers] Error al actualizar disponibilidad', err)
    res.status(500).json({ error: 'Error al guardar disponibilidad' })
  }
})

// Reports
router.get('/:id/reports', requireAuth, (req, res) => {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM teacher_reports WHERE teacher_id = ? ORDER BY created_at DESC').all(req.params.id)
  res.json(rows)
})

router.post('/:id/reports', requireAuth, (req, res) => {
  const { id } = req.params
  const { tipo, subject, detail } = req.body as { tipo: string; subject: string; detail: string }
  if (!subject || !detail) { res.status(400).json({ error: 'subject y detail son requeridos' }); return }
  const db = getDb()
  const teacher = db.prepare('SELECT id FROM teachers WHERE id = ?').get(id)
  if (!teacher) { res.status(404).json({ error: 'Docente no encontrado' }); return }

  const reportId = `rep-${crypto.randomBytes(6).toString('hex')}`
  // ISO date string for correct chronological ORDER BY
  const createdAt = new Date().toISOString().slice(0, 10)
  db.prepare(`
    INSERT INTO teacher_reports (id, teacher_id, tipo, subject, detail, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'pendiente', ?)
  `).run(reportId, id, tipo ?? 'cruce', subject.trim(), detail.trim(), createdAt)
  res.status(201).json(db.prepare('SELECT * FROM teacher_reports WHERE id = ?').get(reportId))
})

export default router
