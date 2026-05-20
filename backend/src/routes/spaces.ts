import { Router } from 'express'
import type { SQLInputValue } from 'node:sqlite'
import { getDb } from '../db'
import { requireAuth, requireAdmin } from '../middleware/auth'

const router = Router()

function calcOcupacion(db: ReturnType<typeof getDb>, codigo: string): number {
  const capacity = db.prepare(`
    SELECT COUNT(*) AS total
    FROM schedule_days d
    CROSS JOIN schedule_slots s
    WHERE d.active = 1 AND s.active = 1 AND s.locked = 0
  `).get() as { total: number }
  const used = db.prepare(`
    SELECT COUNT(*) AS total
    FROM schedule_assignments a
    JOIN schedule_slots s ON s.slot_index = a.slot_index
    WHERE a.space_codigo = ? AND a.status = 'published' AND s.locked = 0
  `).get(codigo) as { total: number }

  if (!capacity.total) return 0
  return Math.min(100, Math.round((used.total * 100) / capacity.total))
}

function mapSpace(s: Record<string, unknown>, ocupacion?: number) {
  return {
    codigo: s.codigo,
    nombre: s.nombre,
    tipoEspacio: s.tipo_espacio,
    tipoUso: s.tipo_uso,
    capacidad: s.capacidad,
    ocupacion: ocupacion ?? 0,
    icon: s.icon,
    claseLaboratorio: s.clase_laboratorio,
    software: JSON.parse((s.software as string) ?? '[]'),
    equipamiento: JSON.parse((s.equipamiento as string) ?? '[]'),
  }
}

router.get('/', requireAuth, (req, res) => {
  const db = getDb()
  const { q } = req.query as { q?: string }
  let query = 'SELECT * FROM spaces'
  const params: SQLInputValue[] = []
  if (q?.trim()) {
    query += ' WHERE LOWER(codigo) LIKE ? OR LOWER(nombre) LIKE ?'
    const term = `%${q.trim().toLowerCase()}%`
    params.push(term, term)
  }
  query += ' ORDER BY codigo'
  const spaces = db.prepare(query).all(...params) as Record<string, unknown>[]
  res.json(spaces.map((s) => mapSpace(s, calcOcupacion(db, s.codigo as string))))
})

router.post('/', requireAuth, requireAdmin, (req, res) => {
  const { codigo, nombre, tipoEspacio, tipoUso, capacidad, claseLaboratorio, software, equipamiento } = req.body as {
    codigo: string; nombre: string; tipoEspacio: string; tipoUso: string; capacidad: number;
    claseLaboratorio?: string; software?: string[]; equipamiento?: Array<{ nombre: string; cantidad: number }>
  }
  if (!codigo || !nombre) { res.status(400).json({ error: 'codigo y nombre son requeridos' }); return }

  const iconMap: Record<string, string> = { Aula: 'book', Laboratorio: 'flask', 'Sala de informática': 'pc' }
  const icon = iconMap[tipoEspacio] ?? 'book'

  const db = getDb()
  try {
    db.prepare(`
      INSERT INTO spaces (codigo, nombre, tipo_espacio, tipo_uso, capacidad, icon, clase_laboratorio, software, equipamiento)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      codigo.trim().toUpperCase(), nombre.trim(), tipoEspacio ?? 'Aula', tipoUso ?? 'Teórico',
      capacidad ?? 40, icon, claseLaboratorio ?? null,
      JSON.stringify(software ?? []), JSON.stringify(equipamiento ?? []),
    )
    const created = db.prepare('SELECT * FROM spaces WHERE codigo = ?').get(codigo.trim().toUpperCase()) as Record<string, unknown>
    res.status(201).json(mapSpace(created, calcOcupacion(db, created.codigo as string)))
  } catch {
    res.status(409).json({ error: 'El código de espacio ya existe' })
  }
})

router.put('/:codigo', requireAuth, requireAdmin, (req, res) => {
  const { codigo } = req.params
  const { nombre, tipoUso, capacidad } = req.body as Record<string, unknown>
  const db = getDb()
  const existing = db.prepare('SELECT codigo FROM spaces WHERE codigo = ?').get(codigo)
  if (!existing) { res.status(404).json({ error: 'Espacio no encontrado' }); return }

  const fields: string[] = []
  const vals: SQLInputValue[] = []
  if (nombre) { fields.push('nombre = ?'); vals.push(nombre as SQLInputValue) }
  if (tipoUso) { fields.push('tipo_uso = ?'); vals.push(tipoUso as SQLInputValue) }
  if (capacidad !== undefined) { fields.push('capacidad = ?'); vals.push(capacidad as SQLInputValue) }
  if (!fields.length) { res.status(400).json({ error: 'Nada que actualizar' }); return }
  vals.push(codigo)
  db.prepare(`UPDATE spaces SET ${fields.join(', ')} WHERE codigo = ?`).run(...vals)
  const updated = db.prepare('SELECT * FROM spaces WHERE codigo = ?').get(codigo) as Record<string, unknown>
  res.json(mapSpace(updated, calcOcupacion(db, codigo)))
})

router.delete('/:codigo', requireAuth, requireAdmin, (req, res) => {
  const db = getDb()
  const result = db.prepare('DELETE FROM spaces WHERE codigo = ?').run(req.params.codigo)
  if (result.changes === 0) { res.status(404).json({ error: 'Espacio no encontrado' }); return }
  res.json({ message: 'Espacio eliminado' })
})

export default router
