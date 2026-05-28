import { Router } from 'express'
import crypto from 'crypto'
import type { SQLInputValue } from 'node:sqlite'
import { getDb } from '../db'
import { requireAuth, requireAdmin, requireDocente, resolveTeacherFromUser, type AuthRequest } from '../middleware/auth'

const router = Router()

const VALID_REPORT_STATUSES = ['Enviado', 'En revisión', 'Atendido', 'Rechazado'] as const
type ReportStatus = typeof VALID_REPORT_STATUSES[number]

// Accept common alias spellings (normalize to canonical form)
const STATUS_ALIASES: Record<string, ReportStatus> = {
  'enviado': 'Enviado',
  'en revision': 'En revisión',
  'en revisión': 'En revisión',
  'atendido': 'Atendido',
  'rechazado': 'Rechazado',
}

function normalizeStatus(raw: string): ReportStatus | undefined {
  const canonical = VALID_REPORT_STATUSES.find(s => s === raw)
  if (canonical) return canonical
  return STATUS_ALIASES[raw.toLowerCase()]
}

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

function mapReport(r: Record<string, unknown>) {
  return {
    id: r.id,
    teacherId: r.teacher_id,
    tipo: r.tipo,
    subject: r.subject,
    detail: r.detail,
    status: r.status,
    adminResponse: r.admin_response ?? null,
    createdAt: r.created_at,
  }
}

// ── List all teachers ───────────────────────────────────────────────────────
router.get('/', requireAuth, (_req, res) => {
  const db = getDb()
  const teachers = db.prepare('SELECT * FROM teachers ORDER BY nombre_completo').all() as Record<string, unknown>[]
  const result = teachers.map((t) => {
    const loads = db.prepare('SELECT * FROM teacher_loads WHERE teacher_id = ?').all(t.id as string) as Record<string, unknown>[]
    return buildTeacher(t, loads)
  })
  res.json(result)
})

// IMPORTANT: named routes must come before /:id to avoid misrouting
router.get('/reports', requireAuth, requireAdmin, (_req, res) => {
  const db = getDb()
  const rows = db.prepare(`
    SELECT tr.*, t.nombre_completo AS teacher_nombre
    FROM teacher_reports tr
    JOIN teachers t ON t.id = tr.teacher_id
    ORDER BY tr.created_at DESC
  `).all() as Record<string, unknown>[]
  res.json(rows.map(r => ({ ...mapReport(r), teacherNombre: r.teacher_nombre })))
})

router.get('/by-email/:email', requireAuth, (req, res) => {
  const db = getDb()
  const t = db.prepare('SELECT * FROM teachers WHERE email = ?').get(decodeURIComponent(req.params.email)) as Record<string, unknown> | undefined
  if (!t) { res.status(404).json({ error: 'Docente no encontrado' }); return }
  const loads = db.prepare('SELECT * FROM teacher_loads WHERE teacher_id = ?').all(t.id as string) as Record<string, unknown>[]
  res.json(buildTeacher(t, loads))
})

// ── Admin: update any report (status + response) ───────────────────────────
router.put('/reports/:reportId', requireAuth, requireAdmin, (req, res) => {
  const { reportId } = req.params
  const { status, adminResponse } = req.body as { status?: string; adminResponse?: string }

  const db = getDb()
  const report = db.prepare('SELECT * FROM teacher_reports WHERE id = ?').get(reportId) as Record<string, unknown> | undefined
  if (!report) { res.status(404).json({ error: 'Reporte no encontrado' }); return }

  const normalizedStatus = status ? normalizeStatus(status) : undefined
  if (status && !normalizedStatus) {
    res.status(400).json({ error: `Estado inválido. Valores permitidos: ${VALID_REPORT_STATUSES.join(', ')}` })
    return
  }

  const fields: string[] = []
  const vals: SQLInputValue[] = []
  if (normalizedStatus) { fields.push('status = ?'); vals.push(normalizedStatus) }
  if (adminResponse !== undefined) { fields.push('admin_response = ?'); vals.push(adminResponse) }
  if (!fields.length) { res.status(400).json({ error: 'Nada que actualizar' }); return }

  vals.push(reportId)
  db.prepare(`UPDATE teacher_reports SET ${fields.join(', ')} WHERE id = ?`).run(...vals)

  // Notify the teacher about the response
  if (adminResponse || normalizedStatus === 'Atendido' || normalizedStatus === 'Rechazado') {
    const teacher = db.prepare('SELECT email FROM teachers WHERE id = ?').get(report.teacher_id as string) as { email: string } | undefined
    if (teacher) {
      const user = db.prepare('SELECT id FROM users WHERE email = ?').get(teacher.email) as { id: number } | undefined
      if (user) {
        const titulo = normalizedStatus === 'Rechazado'
          ? 'Tu reporte fue rechazado'
          : normalizedStatus === 'Atendido'
            ? 'Tu reporte fue atendido'
            : 'Hay una respuesta a tu reporte'
        db.prepare(`
          INSERT INTO notifications (user_id, tipo, titulo, mensaje, created_at)
          VALUES (?, 'reporte', ?, ?, ?)
        `).run(user.id, titulo, adminResponse ?? `El administrador actualizó el estado de tu reporte a "${normalizedStatus}".`, new Date().toISOString())
      }
    }
  }

  const updated = db.prepare('SELECT * FROM teacher_reports WHERE id = ?').get(reportId) as Record<string, unknown>
  res.json(mapReport(updated))
})

// ── Single teacher ──────────────────────────────────────────────────────────
router.get('/:id', requireAuth, (req, res) => {
  const db = getDb()
  const t = db.prepare('SELECT * FROM teachers WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined
  if (!t) { res.status(404).json({ error: 'Docente no encontrado' }); return }
  const loads = db.prepare('SELECT * FROM teacher_loads WHERE teacher_id = ?').all(t.id as string) as Record<string, unknown>[]
  res.json(buildTeacher(t, loads))
})

// ── Create teacher ──────────────────────────────────────────────────────────
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

// ── Update teacher ──────────────────────────────────────────────────────────
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

// ── Delete teacher ──────────────────────────────────────────────────────────
router.delete('/:id', requireAuth, requireAdmin, (req, res) => {
  const db = getDb()
  const result = db.prepare('DELETE FROM teachers WHERE id = ?').run(req.params.id)
  if (result.changes === 0) { res.status(404).json({ error: 'Docente no encontrado' }); return }
  res.json({ message: 'Docente eliminado' })
})

// ── Availability ────────────────────────────────────────────────────────────
router.get('/:id/availability', requireAuth, (req, res) => {
  const db = getDb()
  const rows = db.prepare('SELECT slot_key, disponible FROM teacher_availability WHERE teacher_id = ?').all(req.params.id) as { slot_key: string; disponible: number }[]
  const result: Record<string, boolean> = {}
  for (const row of rows) result[row.slot_key] = Boolean(row.disponible)
  res.json(result)
})

router.put('/:id/availability', requireAuth, requireDocente, (req: AuthRequest, res) => {
  const { id } = req.params
  const availability = req.body as unknown

  if (!availability || Array.isArray(availability) || typeof availability !== 'object') {
    res.status(400).json({ error: 'La disponibilidad debe ser un objeto de bloques.' })
    return
  }

  const db = getDb()
  const teacher = db.prepare('SELECT id FROM teachers WHERE id = ?').get(id)
  if (!teacher) { res.status(404).json({ error: 'Docente no encontrado' }); return }

  // Non-admin users can only update their own availability
  const userRol = req.user!.rol
  if (userRol !== 'admin' && userRol !== 'secretaria') {
    const linked = resolveTeacherFromUser(req.user!.id)
    if (linked?.id !== id) {
      res.status(403).json({ error: 'Solo puedes actualizar tu propia disponibilidad' })
      return
    }
  }

  try {
    db.exec('BEGIN')
    db.prepare('DELETE FROM teacher_availability WHERE teacher_id = ?').run(id)
    const insert = db.prepare('INSERT INTO teacher_availability (teacher_id, slot_key, disponible) VALUES (?, ?, ?)')
    for (const [key, val] of Object.entries(availability as Record<string, unknown>)) {
      if (typeof val !== 'boolean') throw new Error('INVALID_AVAILABILITY_VALUE')
      insert.run(id, key, val ? 1 : 0)
    }
    db.exec('COMMIT')
    res.json({ message: 'Disponibilidad actualizada' })
  } catch (err) {
    try { db.exec('ROLLBACK') } catch { /* no-op */ }
    if (err instanceof Error && err.message === 'INVALID_AVAILABILITY_VALUE') {
      res.status(400).json({ error: 'Cada bloque de disponibilidad debe ser booleano.' })
      return
    }
    console.error('[teachers] Error al actualizar disponibilidad', err)
    res.status(500).json({ error: 'Error al guardar disponibilidad' })
  }
})

// ── Reports (teacher-scoped) ────────────────────────────────────────────────
router.get('/:id/reports', requireAuth, (req: AuthRequest, res) => {
  const { id } = req.params

  // Docentes can only see their own reports
  const userRol = req.user!.rol
  if (userRol !== 'admin' && userRol !== 'secretaria') {
    const linked = resolveTeacherFromUser(req.user!.id)
    if (linked?.id !== id) {
      res.status(403).json({ error: 'Solo puedes consultar tus propios reportes' })
      return
    }
  }

  const db = getDb()
  const rows = db.prepare('SELECT * FROM teacher_reports WHERE teacher_id = ? ORDER BY created_at DESC').all(id)
  res.json((rows as Record<string, unknown>[]).map(mapReport))
})

router.post('/:id/reports', requireAuth, requireDocente, (req: AuthRequest, res) => {
  const { id } = req.params
  const { tipo, subject, detail } = req.body as { tipo: string; subject: string; detail: string }
  if (!subject || !detail) { res.status(400).json({ error: 'subject y detail son requeridos' }); return }

  const db = getDb()
  const teacher = db.prepare('SELECT id FROM teachers WHERE id = ?').get(id)
  if (!teacher) { res.status(404).json({ error: 'Docente no encontrado' }); return }

  // Non-admin users can only create reports for themselves
  const userRol = req.user!.rol
  if (userRol !== 'admin' && userRol !== 'secretaria') {
    const linked = resolveTeacherFromUser(req.user!.id)
    if (linked?.id !== id) {
      res.status(403).json({ error: 'Solo puedes crear reportes para tu propio perfil' })
      return
    }
  }

  const reportId = `rep-${crypto.randomBytes(6).toString('hex')}`
  const createdAt = new Date().toISOString().slice(0, 10)
  db.prepare(`
    INSERT INTO teacher_reports (id, teacher_id, tipo, subject, detail, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'Enviado', ?)
  `).run(reportId, id, tipo ?? 'cruce', subject.trim(), detail.trim(), createdAt)

  // Notify all admins about the new report
  const admins = db.prepare("SELECT id FROM users WHERE rol IN ('admin', 'secretaria') AND activo = 1").all() as { id: number }[]
  const teacherRow = db.prepare('SELECT nombre_completo FROM teachers WHERE id = ?').get(id) as { nombre_completo: string } | undefined
  const now = new Date().toISOString()
  for (const admin of admins) {
    db.prepare(`
      INSERT INTO notifications (user_id, tipo, titulo, mensaje, created_at)
      VALUES (?, 'reporte', ?, ?, ?)
    `).run(admin.id, 'Nuevo reporte de docente', `${teacherRow?.nombre_completo ?? 'Un docente'} reportó: ${subject.trim().slice(0, 80)}`, now)
  }

  res.status(201).json(mapReport(db.prepare('SELECT * FROM teacher_reports WHERE id = ?').get(reportId) as Record<string, unknown>))
})

export default router
