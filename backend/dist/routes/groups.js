"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../db");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
function mapGroup(g) {
    return {
        id: g.id,
        codigo: g.codigo,
        nombre: g.nombre,
        semestre: g.semestre,
        cupoMax: g.cupo_max,
        cupoPlaneado: g.cupo_planeado,
        docente: g.docente ?? null,
        docenteIniciales: g.docente_iniciales ?? null,
        estadoProg: g.estado_prog,
        asignatura: g.asignatura,
        horas: g.horas,
        programaId: g.programa_id,
        semestreNum: g.semestre_num,
        grupoSeccion: g.grupo_seccion,
        alerta: g.alerta ?? undefined,
        estudiantes: g.cupo_planeado,
        docente_display: g.docente ?? '—',
    };
}
router.get('/', auth_1.requireAuth, (_req, res) => {
    const db = (0, db_1.getDb)();
    const rows = db.prepare('SELECT * FROM groups ORDER BY semestre, codigo').all();
    res.json(rows.map(mapGroup));
});
router.get('/offer', auth_1.requireAuth, (_req, res) => {
    const db = (0, db_1.getDb)();
    const rows = db.prepare('SELECT * FROM groups WHERE asignatura IS NOT NULL ORDER BY semestre_num, asignatura').all();
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
    })));
});
router.post('/', auth_1.requireAuth, auth_1.requireAdmin, (req, res) => {
    const { id, codigo, nombre, semestre, cupoMax, cupoPlaneado, teacherId, docente, docenteIniciales, estadoProg, asignatura, horas, programaId, semestreNum, grupoSeccion } = req.body;
    if (!codigo || !nombre || !semestre) {
        res.status(400).json({ error: 'codigo, nombre y semestre son requeridos' });
        return;
    }
    const groupId = id ?? `g-${Date.now()}`;
    const db = (0, db_1.getDb)();
    try {
        db.prepare(`
      INSERT INTO groups (id, codigo, nombre, semestre, cupo_max, cupo_planeado, teacher_id, docente, docente_iniciales, estado_prog, asignatura, horas, programa_id, semestre_num, grupo_seccion)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(groupId, codigo.trim(), nombre.trim(), semestre.trim(), cupoMax ?? 40, cupoPlaneado ?? 40, teacherId ?? null, docente ?? null, docenteIniciales ?? null, estadoProg ?? 'pendiente', asignatura ?? null, horas ?? 4, programaId ?? null, semestreNum ?? 1, grupoSeccion ?? 'A');
        const created = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
        res.status(201).json(mapGroup(created));
    }
    catch {
        res.status(500).json({ error: 'Error al crear grupo' });
    }
});
router.put('/:id', auth_1.requireAuth, auth_1.requireAdmin, (req, res) => {
    const { id } = req.params;
    const db = (0, db_1.getDb)();
    const existing = db.prepare('SELECT id FROM groups WHERE id = ?').get(id);
    if (!existing) {
        res.status(404).json({ error: 'Grupo no encontrado' });
        return;
    }
    const { teacherId, docente, docenteIniciales, estadoProg, cupoMax, cupoPlaneado } = req.body;
    const fields = [];
    const vals = [];
    if (teacherId !== undefined) {
        fields.push('teacher_id = ?');
        vals.push(teacherId);
    }
    if (docente !== undefined) {
        fields.push('docente = ?');
        vals.push(docente);
    }
    if (docenteIniciales !== undefined) {
        fields.push('docente_iniciales = ?');
        vals.push(docenteIniciales);
    }
    if (estadoProg) {
        fields.push('estado_prog = ?');
        vals.push(estadoProg);
    }
    if (cupoMax !== undefined) {
        fields.push('cupo_max = ?');
        vals.push(cupoMax);
    }
    if (cupoPlaneado !== undefined) {
        fields.push('cupo_planeado = ?');
        vals.push(cupoPlaneado);
    }
    if (!fields.length) {
        res.status(400).json({ error: 'Nada que actualizar' });
        return;
    }
    vals.push(id);
    db.prepare(`UPDATE groups SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
    const updated = db.prepare('SELECT * FROM groups WHERE id = ?').get(id);
    res.json(mapGroup(updated));
});
router.delete('/:id', auth_1.requireAuth, auth_1.requireAdmin, (req, res) => {
    const db = (0, db_1.getDb)();
    const result = db.prepare('DELETE FROM groups WHERE id = ?').run(req.params.id);
    if (result.changes === 0) {
        res.status(404).json({ error: 'Grupo no encontrado' });
        return;
    }
    res.json({ message: 'Grupo eliminado' });
});
exports.default = router;
