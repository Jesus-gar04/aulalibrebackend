"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../db");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
function buildTeacher(t, loads) {
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
        espaciosFrecuentes: JSON.parse(t.espacios_frecuentes ?? '[]'),
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
    };
}
router.get('/', auth_1.requireAuth, (_req, res) => {
    const db = (0, db_1.getDb)();
    const teachers = db.prepare('SELECT * FROM teachers ORDER BY nombre_completo').all();
    const result = teachers.map((t) => {
        const loads = db.prepare('SELECT * FROM teacher_loads WHERE teacher_id = ?').all(t.id);
        return buildTeacher(t, loads);
    });
    res.json(result);
});
router.get('/:id', auth_1.requireAuth, (req, res) => {
    const db = (0, db_1.getDb)();
    const t = db.prepare('SELECT * FROM teachers WHERE id = ?').get(req.params.id);
    if (!t) {
        res.status(404).json({ error: 'Docente no encontrado' });
        return;
    }
    const loads = db.prepare('SELECT * FROM teacher_loads WHERE teacher_id = ?').all(t.id);
    res.json(buildTeacher(t, loads));
});
router.get('/by-email/:email', auth_1.requireAuth, (req, res) => {
    const db = (0, db_1.getDb)();
    const t = db.prepare('SELECT * FROM teachers WHERE email = ?').get(decodeURIComponent(req.params.email));
    if (!t) {
        res.status(404).json({ error: 'Docente no encontrado' });
        return;
    }
    const loads = db.prepare('SELECT * FROM teacher_loads WHERE teacher_id = ?').all(t.id);
    res.json(buildTeacher(t, loads));
});
router.post('/', auth_1.requireAuth, auth_1.requireAdmin, (req, res) => {
    const { id, nombreCompleto, tituloProfesional, email, telefono, departamento, vinculacion, maxHorasSemana } = req.body;
    if (!nombreCompleto || !email || !departamento) {
        res.status(400).json({ error: 'nombre, email y departamento son requeridos' });
        return;
    }
    const partes = nombreCompleto.trim().split(/\s+/);
    const iniciales = ((partes[0]?.[0] ?? '') + (partes[1]?.[0] ?? partes[0]?.[1] ?? '')).toUpperCase() || '??';
    const teacherId = id ?? `d-${Date.now()}`;
    const db = (0, db_1.getDb)();
    try {
        db.prepare(`
      INSERT INTO teachers (id, nombre_completo, titulo_profesional, iniciales, vinculacion, departamento, email, telefono, max_horas_semana)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(teacherId, nombreCompleto.trim(), tituloProfesional ?? 'Ing.', iniciales, vinculacion ?? 'Cátedra', departamento.trim(), email.trim().toLowerCase(), telefono ?? '—', maxHorasSemana ?? 40);
        const created = db.prepare('SELECT * FROM teachers WHERE id = ?').get(teacherId);
        res.status(201).json(buildTeacher(created, []));
    }
    catch (err) {
        if (err.message?.includes('UNIQUE')) {
            res.status(409).json({ error: 'El correo ya está registrado' });
        }
        else {
            res.status(500).json({ error: 'Error al crear docente' });
        }
    }
});
router.put('/:id', auth_1.requireAuth, auth_1.requireAdmin, (req, res) => {
    const { id } = req.params;
    const { nombreCompleto, tituloProfesional, email, telefono, departamento, vinculacion, maxHorasSemana } = req.body;
    const db = (0, db_1.getDb)();
    const existing = db.prepare('SELECT id FROM teachers WHERE id = ?').get(id);
    if (!existing) {
        res.status(404).json({ error: 'Docente no encontrado' });
        return;
    }
    const fields = [];
    const vals = [];
    if (nombreCompleto) {
        fields.push('nombre_completo = ?');
        vals.push(nombreCompleto);
    }
    if (tituloProfesional) {
        fields.push('titulo_profesional = ?');
        vals.push(tituloProfesional);
    }
    if (email) {
        fields.push('email = ?');
        vals.push(email.toLowerCase());
    }
    if (telefono !== undefined) {
        fields.push('telefono = ?');
        vals.push(telefono);
    }
    if (departamento) {
        fields.push('departamento = ?');
        vals.push(departamento);
    }
    if (vinculacion) {
        fields.push('vinculacion = ?');
        vals.push(vinculacion);
    }
    if (maxHorasSemana) {
        fields.push('max_horas_semana = ?');
        vals.push(maxHorasSemana);
    }
    if (!fields.length) {
        res.status(400).json({ error: 'Nada que actualizar' });
        return;
    }
    vals.push(id);
    db.prepare(`UPDATE teachers SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
    const t = db.prepare('SELECT * FROM teachers WHERE id = ?').get(id);
    const loads = db.prepare('SELECT * FROM teacher_loads WHERE teacher_id = ?').all(id);
    res.json(buildTeacher(t, loads));
});
router.delete('/:id', auth_1.requireAuth, auth_1.requireAdmin, (req, res) => {
    const db = (0, db_1.getDb)();
    const result = db.prepare('DELETE FROM teachers WHERE id = ?').run(req.params.id);
    if (result.changes === 0) {
        res.status(404).json({ error: 'Docente no encontrado' });
        return;
    }
    res.json({ message: 'Docente eliminado' });
});
// Availability
router.get('/:id/availability', auth_1.requireAuth, (req, res) => {
    const db = (0, db_1.getDb)();
    const rows = db.prepare('SELECT slot_key, disponible FROM teacher_availability WHERE teacher_id = ?').all(req.params.id);
    const result = {};
    for (const row of rows)
        result[row.slot_key] = Boolean(row.disponible);
    res.json(result);
});
router.put('/:id/availability', auth_1.requireAuth, (req, res) => {
    const { id } = req.params;
    const availability = req.body;
    if (!availability || Array.isArray(availability) || typeof availability !== 'object') {
        res.status(400).json({ error: 'La disponibilidad debe ser un objeto de bloques.' });
        return;
    }
    const db = (0, db_1.getDb)();
    const teacher = db.prepare('SELECT id FROM teachers WHERE id = ?').get(id);
    if (!teacher) {
        res.status(404).json({ error: 'Docente no encontrado' });
        return;
    }
    try {
        db.exec('BEGIN');
        db.prepare('DELETE FROM teacher_availability WHERE teacher_id = ?').run(id);
        const insert = db.prepare('INSERT INTO teacher_availability (teacher_id, slot_key, disponible) VALUES (?, ?, ?)');
        for (const [key, val] of Object.entries(availability)) {
            if (typeof val !== 'boolean') {
                throw new Error('INVALID_AVAILABILITY_VALUE');
            }
            insert.run(id, key, val ? 1 : 0);
        }
        db.exec('COMMIT');
        res.json({ message: 'Disponibilidad actualizada' });
    }
    catch (err) {
        db.exec('ROLLBACK');
        if (err instanceof Error && err.message === 'INVALID_AVAILABILITY_VALUE') {
            res.status(400).json({ error: 'Cada bloque de disponibilidad debe ser booleano.' });
            return;
        }
        console.error('[teachers] Error al actualizar disponibilidad', err);
        res.status(500).json({ error: 'Error al guardar disponibilidad' });
    }
});
// Reports
router.get('/:id/reports', auth_1.requireAuth, (req, res) => {
    const db = (0, db_1.getDb)();
    const rows = db.prepare('SELECT * FROM teacher_reports WHERE teacher_id = ? ORDER BY created_at DESC').all(req.params.id);
    res.json(rows);
});
router.post('/:id/reports', auth_1.requireAuth, (req, res) => {
    const { id } = req.params;
    const { tipo, subject, detail } = req.body;
    if (!subject || !detail) {
        res.status(400).json({ error: 'subject y detail son requeridos' });
        return;
    }
    const db = (0, db_1.getDb)();
    const reportId = `rep-${Date.now()}`;
    const createdAt = new Date().toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
    db.prepare(`
    INSERT INTO teacher_reports (id, teacher_id, tipo, subject, detail, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'pendiente', ?)
  `).run(reportId, id, tipo ?? 'cruce', subject.trim(), detail.trim(), createdAt);
    res.status(201).json(db.prepare('SELECT * FROM teacher_reports WHERE id = ?').get(reportId));
});
exports.default = router;
