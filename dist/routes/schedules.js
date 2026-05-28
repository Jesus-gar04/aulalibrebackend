"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../db");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
function mapOffer(g) {
    return {
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
    };
}
function mapAssignment(row) {
    return {
        groupId: row.group_id,
        spaceCodigo: row.space_codigo,
        dayIndex: row.day_index,
        slotIndex: row.slot_index,
        status: row.status,
    };
}
router.get('/offer', auth_1.requireAuth, (_req, res) => {
    const db = (0, db_1.getDb)();
    const rows = db.prepare('SELECT * FROM groups WHERE asignatura IS NOT NULL ORDER BY semestre_num, asignatura').all();
    res.json(rows.map(mapOffer));
});
router.get('/assignments', auth_1.requireAuth, (req, res) => {
    const { programaId, semestreNum, grupoSeccion, status = 'draft' } = req.query;
    if (!programaId || !semestreNum || !grupoSeccion) {
        res.status(400).json({ error: 'programaId, semestreNum y grupoSeccion son requeridos' });
        return;
    }
    const db = (0, db_1.getDb)();
    const rows = db.prepare(`
    SELECT * FROM schedule_assignments
    WHERE program_id = ? AND semestre_num = ? AND grupo_seccion = ? AND status = ?
    ORDER BY day_index, slot_index
  `).all(programaId, Number(semestreNum), grupoSeccion, status);
    res.json(rows.map(mapAssignment));
});
router.put('/assignments', auth_1.requireAuth, auth_1.requireAdmin, (req, res) => {
    const { programaId, semestreNum, grupoSeccion, status = 'draft', assignments } = req.body;
    if (!programaId || !semestreNum || !grupoSeccion || !Array.isArray(assignments)) {
        res.status(400).json({ error: 'Datos de horario incompletos' });
        return;
    }
    if (!['draft', 'published'].includes(status)) {
        res.status(400).json({ error: 'Estado de horario inválido' });
        return;
    }
    const db = (0, db_1.getDb)();
    try {
        db.exec('BEGIN');
        db.prepare(`
      DELETE FROM schedule_assignments
      WHERE program_id = ? AND semestre_num = ? AND grupo_seccion = ? AND status = ?
    `).run(programaId, semestreNum, grupoSeccion, status);
        const insert = db.prepare(`
      INSERT INTO schedule_assignments
        (program_id, semestre_num, grupo_seccion, group_id, space_codigo, day_index, slot_index, status, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        const now = new Date().toISOString();
        const occupiedCells = new Set();
        for (const item of assignments) {
            if (occupiedCells.has(`${item.dayIndex}-${item.slotIndex}-${item.spaceCodigo}`)) {
                throw new Error('SPACE_CONFLICT');
            }
            occupiedCells.add(`${item.dayIndex}-${item.slotIndex}-${item.spaceCodigo}`);
            const group = db.prepare('SELECT id FROM groups WHERE id = ?').get(item.groupId);
            const space = db.prepare('SELECT codigo FROM spaces WHERE codigo = ?').get(item.spaceCodigo);
            const slot = db.prepare('SELECT slot_index FROM schedule_slots WHERE slot_index = ? AND locked = 0').get(item.slotIndex);
            const day = db.prepare('SELECT day_index FROM schedule_days WHERE day_index = ? AND active = 1').get(item.dayIndex);
            if (!group || !space || !slot || !day)
                throw new Error('INVALID_ASSIGNMENT');
            const params = [
                programaId,
                semestreNum,
                grupoSeccion,
                item.groupId,
                item.spaceCodigo,
                item.dayIndex,
                item.slotIndex,
                status,
                now,
            ];
            insert.run(...params);
        }
        db.exec('COMMIT');
        res.json({ message: status === 'published' ? 'Horario publicado' : 'Borrador guardado', count: assignments.length });
    }
    catch (err) {
        db.exec('ROLLBACK');
        if (err instanceof Error && err.message === 'SPACE_CONFLICT') {
            res.status(409).json({ error: 'Hay dos clases asignadas al mismo salón en la misma franja.' });
            return;
        }
        if (err instanceof Error && err.message === 'INVALID_ASSIGNMENT') {
            res.status(400).json({ error: 'El horario contiene grupo, salón, día o bloque inválido.' });
            return;
        }
        console.error('[schedules] Error al guardar asignaciones', err);
        res.status(500).json({ error: 'Error al guardar horario' });
    }
});
router.get('/student', auth_1.requireAuth, (_req, res) => {
    const db = (0, db_1.getDb)();
    const rows = db.prepare(`
    SELECT a.day_index, sl.label AS hora, g.asignatura, g.docente, a.space_codigo AS salon, g.horas
    FROM schedule_assignments a
    JOIN groups g ON g.id = a.group_id
    JOIN schedule_slots sl ON sl.slot_index = a.slot_index
    WHERE a.status = 'published'
    ORDER BY a.day_index, a.slot_index
  `).all();
    res.json({ bloques: rows });
});
exports.default = router;
