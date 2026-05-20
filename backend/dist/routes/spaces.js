"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../db");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
function calcOcupacion(db, codigo) {
    const capacity = db.prepare(`
    SELECT COUNT(*) AS total
    FROM schedule_days d
    CROSS JOIN schedule_slots s
    WHERE d.active = 1 AND s.active = 1 AND s.locked = 0
  `).get();
    const used = db.prepare(`
    SELECT COUNT(*) AS total
    FROM schedule_assignments a
    JOIN schedule_slots s ON s.slot_index = a.slot_index
    WHERE a.space_codigo = ? AND a.status = 'published' AND s.locked = 0
  `).get(codigo);
    if (!capacity.total)
        return 0;
    return Math.min(100, Math.round((used.total * 100) / capacity.total));
}
function mapSpace(s, ocupacion) {
    return {
        codigo: s.codigo,
        nombre: s.nombre,
        tipoEspacio: s.tipo_espacio,
        tipoUso: s.tipo_uso,
        capacidad: s.capacidad,
        ocupacion: ocupacion ?? 0,
        icon: s.icon,
        claseLaboratorio: s.clase_laboratorio,
        software: JSON.parse(s.software ?? '[]'),
        equipamiento: JSON.parse(s.equipamiento ?? '[]'),
    };
}
router.get('/', auth_1.requireAuth, (req, res) => {
    const db = (0, db_1.getDb)();
    const { q } = req.query;
    let query = 'SELECT * FROM spaces';
    const params = [];
    if (q?.trim()) {
        query += ' WHERE LOWER(codigo) LIKE ? OR LOWER(nombre) LIKE ?';
        const term = `%${q.trim().toLowerCase()}%`;
        params.push(term, term);
    }
    query += ' ORDER BY codigo';
    const spaces = db.prepare(query).all(...params);
    res.json(spaces.map((s) => mapSpace(s, calcOcupacion(db, s.codigo))));
});
router.post('/', auth_1.requireAuth, auth_1.requireAdmin, (req, res) => {
    const { codigo, nombre, tipoEspacio, tipoUso, capacidad, claseLaboratorio, software, equipamiento } = req.body;
    if (!codigo || !nombre) {
        res.status(400).json({ error: 'codigo y nombre son requeridos' });
        return;
    }
    const iconMap = { Aula: 'book', Laboratorio: 'flask', 'Sala de informática': 'pc' };
    const icon = iconMap[tipoEspacio] ?? 'book';
    const db = (0, db_1.getDb)();
    try {
        db.prepare(`
      INSERT INTO spaces (codigo, nombre, tipo_espacio, tipo_uso, capacidad, icon, clase_laboratorio, software, equipamiento)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(codigo.trim().toUpperCase(), nombre.trim(), tipoEspacio ?? 'Aula', tipoUso ?? 'Teórico', capacidad ?? 40, icon, claseLaboratorio ?? null, JSON.stringify(software ?? []), JSON.stringify(equipamiento ?? []));
        const created = db.prepare('SELECT * FROM spaces WHERE codigo = ?').get(codigo.trim().toUpperCase());
        res.status(201).json(mapSpace(created, calcOcupacion(db, created.codigo)));
    }
    catch {
        res.status(409).json({ error: 'El código de espacio ya existe' });
    }
});
router.put('/:codigo', auth_1.requireAuth, auth_1.requireAdmin, (req, res) => {
    const { codigo } = req.params;
    const { nombre, tipoUso, capacidad } = req.body;
    const db = (0, db_1.getDb)();
    const existing = db.prepare('SELECT codigo FROM spaces WHERE codigo = ?').get(codigo);
    if (!existing) {
        res.status(404).json({ error: 'Espacio no encontrado' });
        return;
    }
    const fields = [];
    const vals = [];
    if (nombre) {
        fields.push('nombre = ?');
        vals.push(nombre);
    }
    if (tipoUso) {
        fields.push('tipo_uso = ?');
        vals.push(tipoUso);
    }
    if (capacidad !== undefined) {
        fields.push('capacidad = ?');
        vals.push(capacidad);
    }
    if (!fields.length) {
        res.status(400).json({ error: 'Nada que actualizar' });
        return;
    }
    vals.push(codigo);
    db.prepare(`UPDATE spaces SET ${fields.join(', ')} WHERE codigo = ?`).run(...vals);
    const updated = db.prepare('SELECT * FROM spaces WHERE codigo = ?').get(codigo);
    res.json(mapSpace(updated, calcOcupacion(db, codigo)));
});
router.delete('/:codigo', auth_1.requireAuth, auth_1.requireAdmin, (req, res) => {
    const db = (0, db_1.getDb)();
    const result = db.prepare('DELETE FROM spaces WHERE codigo = ?').run(req.params.codigo);
    if (result.changes === 0) {
        res.status(404).json({ error: 'Espacio no encontrado' });
        return;
    }
    res.json({ message: 'Espacio eliminado' });
});
exports.default = router;
