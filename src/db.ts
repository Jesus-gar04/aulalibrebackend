import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import bcrypt from 'bcryptjs'
import path from 'node:path'

const DB_PATH = process.env.DB_PATH ?? './aulalibre.db'

let _db: DatabaseSync | null = null

export function getDb(): DatabaseSync {
  if (!_db) {
    _db = new DatabaseSync(path.resolve(DB_PATH))
    _db.exec(`PRAGMA journal_mode = WAL`)
    _db.exec(`PRAGMA foreign_keys = ON`)
  }
  return _db
}

export function initDb() {
  const db = getDb()

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      rol TEXT NOT NULL DEFAULT 'estudiante',
      rol_display TEXT NOT NULL DEFAULT 'Estudiante',
      activo INTEGER NOT NULL DEFAULT 1,
      ultimo_acceso TEXT,
      iniciales TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS programs (
      id TEXT PRIMARY KEY,
      nombre TEXT NOT NULL,
      snies TEXT NOT NULL,
      semestres INTEGER NOT NULL DEFAULT 10,
      creditos INTEGER NOT NULL DEFAULT 160
    );

    CREATE TABLE IF NOT EXISTS subjects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      program_id TEXT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
      semestre INTEGER NOT NULL DEFAULT 1,
      codigo TEXT NOT NULL,
      nombre TEXT NOT NULL,
      creditos INTEGER NOT NULL DEFAULT 3,
      h_teoria INTEGER NOT NULL DEFAULT 2,
      h_practica INTEGER NOT NULL DEFAULT 0,
      area TEXT NOT NULL DEFAULT 'Específica',
      area_tone TEXT NOT NULL DEFAULT 'emerald'
    );

    CREATE TABLE IF NOT EXISTS teachers (
      id TEXT PRIMARY KEY,
      nombre_completo TEXT NOT NULL,
      titulo_profesional TEXT NOT NULL DEFAULT 'Ing.',
      iniciales TEXT NOT NULL,
      vinculacion TEXT NOT NULL DEFAULT 'Cátedra',
      departamento TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      telefono TEXT DEFAULT '—',
      max_horas_semana INTEGER NOT NULL DEFAULT 40,
      grupos_activos INTEGER NOT NULL DEFAULT 0,
      asignaturas_distintas INTEGER NOT NULL DEFAULT 0,
      espacios_frecuentes TEXT NOT NULL DEFAULT '[]',
      ultima_actualizacion_carga TEXT NOT NULL DEFAULT 'Sin asignaciones'
    );

    CREATE TABLE IF NOT EXISTS teacher_loads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
      asignatura TEXT NOT NULL,
      codigo TEXT NOT NULL,
      grupo TEXT NOT NULL,
      programa TEXT NOT NULL,
      horas_semana INTEGER NOT NULL DEFAULT 0,
      horario TEXT NOT NULL DEFAULT '',
      salon TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS teacher_reports (
      id TEXT PRIMARY KEY,
      teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
      tipo TEXT NOT NULL DEFAULT 'cruce',
      subject TEXT NOT NULL,
      detail TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Enviado',
      admin_response TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS teacher_availability (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
      slot_key TEXT NOT NULL,
      disponible INTEGER NOT NULL DEFAULT 1,
      UNIQUE(teacher_id, slot_key)
    );

    CREATE TABLE IF NOT EXISTS spaces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo TEXT NOT NULL UNIQUE,
      nombre TEXT NOT NULL,
      tipo_espacio TEXT NOT NULL DEFAULT 'Aula',
      tipo_uso TEXT NOT NULL DEFAULT 'Teórico',
      capacidad INTEGER NOT NULL DEFAULT 40,
      ocupacion INTEGER NOT NULL DEFAULT 0,
      icon TEXT NOT NULL DEFAULT 'book',
      clase_laboratorio TEXT,
      software TEXT DEFAULT '[]',
      equipamiento TEXT DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS schedule_days (
      day_index INTEGER PRIMARY KEY,
      label TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS schedule_slots (
      slot_index INTEGER PRIMARY KEY,
      label TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      duration_hours REAL NOT NULL,
      locked INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      codigo TEXT NOT NULL,
      nombre TEXT NOT NULL,
      semestre TEXT NOT NULL,
      cupo_max INTEGER NOT NULL DEFAULT 40,
      cupo_planeado INTEGER NOT NULL DEFAULT 40,
      teacher_id TEXT REFERENCES teachers(id),
      docente TEXT,
      docente_iniciales TEXT,
      estado_prog TEXT NOT NULL DEFAULT 'pendiente',
      asignatura TEXT,
      horas INTEGER DEFAULT 4,
      programa_id TEXT REFERENCES programs(id),
      semestre_num INTEGER DEFAULT 1,
      grupo_seccion TEXT DEFAULT 'A',
      jornada TEXT NOT NULL DEFAULT 'Diurna',
      alerta TEXT
    );

    CREATE TABLE IF NOT EXISTS schedule_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      program_id TEXT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
      semestre_num INTEGER NOT NULL,
      grupo_seccion TEXT NOT NULL,
      group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      space_codigo TEXT NOT NULL REFERENCES spaces(codigo) ON DELETE CASCADE,
      day_index INTEGER NOT NULL REFERENCES schedule_days(day_index),
      slot_index INTEGER NOT NULL REFERENCES schedule_slots(slot_index),
      status TEXT NOT NULL DEFAULT 'draft',
      updated_at TEXT NOT NULL,
      UNIQUE(group_id, day_index, slot_index, status),
      UNIQUE(space_codigo, day_index, slot_index, status)
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tipo TEXT NOT NULL DEFAULT 'info',
      titulo TEXT NOT NULL,
      mensaje TEXT NOT NULL,
      leida INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS student_preselections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      program_id TEXT REFERENCES programs(id),
      semestre_num INTEGER,
      status TEXT NOT NULL DEFAULT 'pendiente',
      conflicts TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS student_preselection_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      preselection_id INTEGER NOT NULL REFERENCES student_preselections(id) ON DELETE CASCADE,
      group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      UNIQUE(preselection_id, group_id)
    );

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      titulo TEXT NOT NULL DEFAULT 'Nueva conversación',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `)

  migrateDb(db)
  seedScheduleReferenceData(db)
  seedIfEmpty(db)
}

function migrateDb(db: DatabaseSync) {
  // Migration 1: Fix broken UNIQUE constraint on schedule_assignments
  const tableRow = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='schedule_assignments'"
  ).get() as { sql: string } | undefined

  if (
    tableRow?.sql &&
    tableRow.sql.includes('UNIQUE(program_id, semestre_num, grupo_seccion, group_id, status)')
  ) {
    console.log('[DB] Migración 1: corrigiendo UNIQUE constraint de schedule_assignments...')
    db.exec('DROP TABLE IF EXISTS schedule_assignments')
    db.exec(`
      CREATE TABLE schedule_assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        program_id TEXT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
        semestre_num INTEGER NOT NULL,
        grupo_seccion TEXT NOT NULL,
        group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        space_codigo TEXT NOT NULL REFERENCES spaces(codigo) ON DELETE CASCADE,
        day_index INTEGER NOT NULL REFERENCES schedule_days(day_index),
        slot_index INTEGER NOT NULL REFERENCES schedule_slots(slot_index),
        status TEXT NOT NULL DEFAULT 'draft',
        updated_at TEXT NOT NULL,
        UNIQUE(group_id, day_index, slot_index, status),
        UNIQUE(space_codigo, day_index, slot_index, status)
      )
    `)
    console.log('[DB] Migración 1: completada.')
  }

  // Migration 2: Add indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_schedule_assignments_lookup
      ON schedule_assignments(program_id, semestre_num, grupo_seccion, status);
    CREATE INDEX IF NOT EXISTS idx_teacher_loads_teacher
      ON teacher_loads(teacher_id);
    CREATE INDEX IF NOT EXISTS idx_teacher_reports_teacher
      ON teacher_reports(teacher_id);
    CREATE INDEX IF NOT EXISTS idx_groups_program
      ON groups(programa_id, semestre_num);
    CREATE INDEX IF NOT EXISTS idx_notifications_user
      ON notifications(user_id, leida);
    CREATE INDEX IF NOT EXISTS idx_student_preselections_user
      ON student_preselections(student_user_id);
  `)

  // Migration 3: Add admin_response to teacher_reports (if not exists)
  const repCols = db.prepare('PRAGMA table_info(teacher_reports)').all() as { name: string }[]
  if (!repCols.find(c => c.name === 'admin_response')) {
    db.exec('ALTER TABLE teacher_reports ADD COLUMN admin_response TEXT')
    console.log('[DB] Migración 3: admin_response añadido a teacher_reports.')
  }

  // Migration 4: Add jornada to groups (if not exists)
  const grpCols = db.prepare('PRAGMA table_info(groups)').all() as { name: string }[]
  if (!grpCols.find(c => c.name === 'jornada')) {
    db.exec("ALTER TABLE groups ADD COLUMN jornada TEXT NOT NULL DEFAULT 'Diurna'")
    console.log('[DB] Migración 4: jornada añadido a groups.')
  }

  // Migration 5: Normalize legacy teacher_reports status values
  db.prepare("UPDATE teacher_reports SET status = 'Enviado' WHERE status = 'pendiente'").run()
  db.prepare("UPDATE teacher_reports SET status = 'En revisión' WHERE status = 'en_revision'").run()
  db.prepare("UPDATE teacher_reports SET status = 'Atendido' WHERE status = 'resuelto'").run()

  // Migration 6: Unlock all schedule slots (no hardcoded lunch break — admin configures schedule freely)
  db.prepare('UPDATE schedule_slots SET locked = 0 WHERE locked = 1').run()
}

function run(db: DatabaseSync, sql: string, ...params: SQLInputValue[]) {
  return db.prepare(sql).run(...params)
}

function seedScheduleReferenceData(db: DatabaseSync) {
  const days = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
  days.forEach((label, index) => {
    run(db, 'INSERT OR IGNORE INTO schedule_days (day_index, label) VALUES (?, ?)', index, label)
  })

  const slots = [
    { label: '07:00 - 09:00', start: '07:00', end: '09:00', hours: 2, locked: 0 },
    { label: '09:00 - 11:00', start: '09:00', end: '11:00', hours: 2, locked: 0 },
    { label: '11:00 - 13:00', start: '11:00', end: '13:00', hours: 2, locked: 0 },
    { label: '13:00 - 15:00', start: '13:00', end: '15:00', hours: 2, locked: 0 },
    { label: '15:00 - 17:00', start: '15:00', end: '17:00', hours: 2, locked: 0 },
    { label: '17:00 - 19:00', start: '17:00', end: '19:00', hours: 2, locked: 0 },
    { label: '19:00 - 21:00', start: '19:00', end: '21:00', hours: 2, locked: 0 },
  ]
  slots.forEach((slot, index) => {
    run(
      db,
      'INSERT OR IGNORE INTO schedule_slots (slot_index, label, start_time, end_time, duration_hours, locked) VALUES (?, ?, ?, ?, ?, ?)',
      index, slot.label, slot.start, slot.end, slot.hours, slot.locked,
    )
  })
}

export function syncTeacherStats(db: DatabaseSync, teacherId: string) {
  const stats = db.prepare(`
    SELECT
      COUNT(DISTINCT g.id) AS grupos_activos,
      COUNT(DISTINCT g.asignatura) AS asignaturas_distintas
    FROM schedule_assignments sa
    JOIN groups g ON g.id = sa.group_id
    WHERE g.teacher_id = ? AND sa.status = 'published'
  `).get(teacherId) as { grupos_activos: number; asignaturas_distintas: number }

  const espacios = db.prepare(`
    SELECT DISTINCT sa.space_codigo
    FROM schedule_assignments sa
    JOIN groups g ON g.id = sa.group_id
    WHERE g.teacher_id = ? AND sa.status = 'published'
    LIMIT 5
  `).all(teacherId) as { space_codigo: string }[]

  const now = new Date().toLocaleString('es-CO', {
    timeZone: 'America/Bogota', day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit',
  })

  db.prepare(`
    UPDATE teachers SET
      grupos_activos = ?,
      asignaturas_distintas = ?,
      espacios_frecuentes = ?,
      ultima_actualizacion_carga = ?
    WHERE id = ?
  `).run(
    stats.grupos_activos,
    stats.asignaturas_distintas,
    JSON.stringify(espacios.map(e => e.space_codigo)),
    now,
    teacherId,
  )
}

export function syncAllTeacherStats(db: DatabaseSync) {
  const teachers = db.prepare('SELECT id FROM teachers').all() as { id: string }[]
  for (const t of teachers) syncTeacherStats(db, t.id)
}

function seedIfEmpty(db: DatabaseSync) {
  const row = db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }
  if (row.c > 0) return

  const hash = bcrypt.hashSync('admin123', 10)
  const hashDoc = bcrypt.hashSync('docente123', 10)
  const hashEst = bcrypt.hashSync('estud123', 10)

  run(db, `INSERT INTO users (nombre, email, password_hash, rol, rol_display, activo, ultimo_acceso, iniciales) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    'Ana María López', 'ana.lopez@unilibre.edu.co', hash, 'admin', 'Administrador', 1, 'Hoy, 09:23 AM', 'AL')
  run(db, `INSERT INTO users (nombre, email, password_hash, rol, rol_display, activo, ultimo_acceso, iniciales) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    'Carlos Ruiz', 'carlos.ruiz@unilibre.edu.co', hashDoc, 'docente', 'Docente', 1, '12 Oct, 10:30 AM', 'CR')
  run(db, `INSERT INTO users (nombre, email, password_hash, rol, rol_display, activo, ultimo_acceso, iniciales) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    'María Fernanda Soto', 'mf.soto@unilibre.edu.co', hash, 'secretaria', 'Secretaria', 0, '11 Oct, 04:15 PM', 'MS')
  run(db, `INSERT INTO users (nombre, email, password_hash, rol, rol_display, activo, ultimo_acceso, iniciales) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    'Alberto Martínez', 'alberto.martinez@unilibre.edu.co', hashDoc, 'docente', 'Docente', 1, 'Hoy, 07:10 AM', 'AM')
  run(db, `INSERT INTO users (nombre, email, password_hash, rol, rol_display, activo, ultimo_acceso, iniciales) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    'Laura Gómez', 'laura.gomez@unilibre.edu.co', hashDoc, 'docente', 'Docente', 1, '09 Oct, 02:00 PM', 'LG')
  run(db, `INSERT INTO users (nombre, email, password_hash, rol, rol_display, activo, ultimo_acceso, iniciales) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    'Estudiante Demo', 'admin.estudiante@unilibre.edu.co', hashEst, 'estudiante', 'Estudiante', 1, 'Hoy', 'ED')

  run(db, `INSERT INTO programs (id, nombre, snies, semestres, creditos) VALUES (?, ?, ?, ?, ?)`, 'sis', 'Ingeniería de Sistemas', '12345', 10, 160)
  run(db, `INSERT INTO programs (id, nombre, snies, semestres, creditos) VALUES (?, ?, ?, ?, ?)`, 'ind', 'Ingeniería Industrial', '22334', 10, 158)
  run(db, `INSERT INTO programs (id, nombre, snies, semestres, creditos) VALUES (?, ?, ?, ?, ?)`, 'civ', 'Ingeniería Civil', '33445', 10, 165)

  const si = (p: string, s: number, c: string, n: string, cr: number, ht: number, hp: number, a: string, at: string) =>
    run(db, `INSERT INTO subjects (program_id, semestre, codigo, nombre, creditos, h_teoria, h_practica, area, area_tone) VALUES (?,?,?,?,?,?,?,?,?)`, p, s, c, n, cr, ht, hp, a, at)
  si('sis', 1, 'IS-101', 'Introducción a la Ingeniería', 2, 2, 0, 'Básica Institucional', 'slate')
  si('sis', 1, 'CB-102', 'Cálculo Diferencial', 4, 4, 0, 'Ciencias Básicas', 'blue')
  si('sis', 1, 'IS-103', 'Lógica de Programación', 4, 2, 4, 'Específica', 'emerald')
  si('sis', 1, 'HU-104', 'Comunicación Oral y Escrita', 3, 3, 0, 'Humanidades', 'pink')
  si('sis', 1, 'CB-105', 'Álgebra Lineal', 3, 3, 0, 'Ciencias Básicas', 'blue')
  si('sis', 1, 'IS-106', 'Fundamentos de Organización', 2, 2, 0, 'Específica', 'emerald')
  si('sis', 3, 'ING-SIS-301', 'Programación Orientada a Objetos', 4, 2, 4, 'Específica', 'emerald')
  si('sis', 4, 'ING-SIS-401', 'Programación Avanzada', 6, 4, 4, 'Específica', 'emerald')
  si('sis', 4, 'ING-SIS-302', 'Estructuras de Datos', 4, 2, 4, 'Específica', 'emerald')
  si('sis', 5, 'ING-SIS-350', 'Ingeniería de Software I', 4, 3, 2, 'Específica', 'emerald')
  si('ind', 3, 'IND-301', 'Procesos Industriales', 4, 3, 2, 'Específica', 'emerald')
  si('ind', 3, 'CB-FIS-110', 'Física I', 4, 3, 2, 'Ciencias Básicas', 'blue')

  const it = (id: string, nc: string, tp: string, ini: string, vin: string, dep: string, em: string, tel: string, mh: number, ga: number, ad: number, ef: string, uac: string) =>
    run(db, `INSERT INTO teachers (id, nombre_completo, titulo_profesional, iniciales, vinculacion, departamento, email, telefono, max_horas_semana, grupos_activos, asignaturas_distintas, espacios_frecuentes, ultima_actualizacion_carga) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, nc, tp, ini, vin, dep, em, tel, mh, ga, ad, ef, uac)
  const il = (tid: string, a: string, c: string, g: string, p: string, h: number, ho: string, s: string) =>
    run(db, `INSERT INTO teacher_loads (teacher_id, asignatura, codigo, grupo, programa, horas_semana, horario, salon) VALUES (?,?,?,?,?,?,?,?)`, tid, a, c, g, p, h, ho, s)

  it('d-martinez', 'Alberto Martínez', 'Ing.', 'AM', 'Titular', 'Departamento de Ingeniería de Sistemas', 'alberto.martinez@unilibre.edu.co', '+57 300 000 0000', 40, 6, 4, JSON.stringify(['C-305', 'L-101', 'B-203']), 'Hace 2 días')
  il('d-martinez', 'Programación Avanzada', 'ING-SIS-401', 'Grupo A1', 'Ing. de Sistemas', 6, 'Lun / Mié 07:00 - 09:00', 'C-305 (Sistemas)')
  il('d-martinez', 'Programación Avanzada', 'ING-SIS-401', 'Grupo B1', 'Ing. de Sistemas', 6, 'Mar / Jue 09:00 - 11:00', 'C-305 (Sistemas)')
  il('d-martinez', 'Estructuras de Datos', 'ING-SIS-302', 'Grupo A2', 'Ing. de Sistemas', 4, 'Lun / Mié 14:00 - 16:00', 'B-203')
  il('d-martinez', 'Estructuras de Datos', 'ING-SIS-302', 'Grupo C1', 'Ing. de Sistemas', 4, 'Vie 18:00 - 22:00', 'B-203')
  il('d-martinez', 'Arquitectura de Computadores', 'ING-SIS-315', 'Grupo A1', 'Ing. de Sistemas', 6, 'Mar 14:00 - 16:00 (Teoría) / Jue 14:00 - 16:00 (Lab)', 'B-203 / L-101')
  il('d-martinez', 'Trabajo de Grado I', 'ING-SIS-490', 'Tutoría', 'Ing. de Sistemas', 10, 'Horario flexible', 'Sala de Profesores')

  it('d-gomez', 'Laura Gómez', 'Ing.', 'LG', 'Cátedra', 'Departamento de Ingeniería de Sistemas', 'laura.gomez@unilibre.edu.co', '+57 301 111 2233', 24, 2, 2, JSON.stringify(['C-201', 'C-305']), 'Hace 5 horas')
  il('d-gomez', 'Programación Orientada a Objetos', 'ING-SIS-301', 'Grupo 02', 'Ing. de Sistemas', 4, 'Mar / Jue 07:00 - 09:00', 'C-201')
  il('d-gomez', 'Ingeniería de Software I', 'ING-SIS-350', 'Grupo A', 'Ing. de Sistemas', 4, 'Lun / Mié 14:00 - 16:00', 'C-305')

  it('d-ruiz', 'Carlos Ruiz', 'Msc.', 'CR', 'Ocasional', 'Departamento de Ciencias Básicas', 'carlos.ruiz@unilibre.edu.co', '+57 302 444 5566', 12, 1, 1, JSON.stringify(['A-102']), 'Ayer')
  il('d-ruiz', 'Física I', 'CB-FIS-110', 'Grupo 01', 'Ing. Industrial', 4, 'Vie 07:00 - 11:00', 'A-102')

  run(db, `INSERT INTO teacher_reports (id, teacher_id, tipo, subject, detail, status, created_at) VALUES (?,?,?,?,?,?,?)`,
    'rep-1', 'd-martinez', 'cruce', 'Estructuras de Datos - Grupo B', 'Tengo cruce con comité curricular el martes 9:00-11:00.', 'En revisión', '2026-03-12')
  run(db, `INSERT INTO teacher_reports (id, teacher_id, tipo, subject, detail, status, created_at) VALUES (?,?,?,?,?,?,?)`,
    'rep-2', 'd-martinez', 'no_disponibilidad', 'Bases de Datos - Grupo A', 'No dispongo del bloque jueves 11:00-13:00 por incapacidad médica.', 'Atendido', '2026-03-07')

  run(db, `INSERT INTO spaces (codigo, nombre, tipo_espacio, tipo_uso, capacidad, ocupacion, icon) VALUES (?,?,?,?,?,?,?)`, 'B-201', 'Bloque B - Aula 201', 'Aula', 'Teórico', 40, 0, 'book')
  run(db, `INSERT INTO spaces (codigo, nombre, tipo_espacio, tipo_uso, capacidad, ocupacion, icon) VALUES (?,?,?,?,?,?,?)`, 'L-101', 'Laboratorio 101', 'Laboratorio', 'Práctico', 24, 0, 'flask')
  run(db, `INSERT INTO spaces (codigo, nombre, tipo_espacio, tipo_uso, capacidad, ocupacion, icon) VALUES (?,?,?,?,?,?,?)`, 'C-305', 'Sala Sistemas 305', 'Sala de informática', 'Mixto', 40, 0, 'pc')
  run(db, `INSERT INTO spaces (codigo, nombre, tipo_espacio, tipo_uso, capacidad, ocupacion, icon) VALUES (?,?,?,?,?,?,?)`, 'SC-02', 'Sala de Cómputo 02', 'Sala de informática', 'Mixto', 30, 0, 'pc')
  run(db, `INSERT INTO spaces (codigo, nombre, tipo_espacio, tipo_uso, capacidad, ocupacion, icon) VALUES (?,?,?,?,?,?,?)`, 'A-102', 'Aula A-102', 'Aula', 'Teórico', 50, 0, 'book')

  const ig = (id: string, c: string, n: string, sem: string, cmax: number, cpl: number, tid: string | null, doc: string | null, ini: string | null, ep: string, asig: string | null, h: number, pid: string | null, sn: number, gs: string, jor: string) =>
    run(db, `INSERT INTO groups (id, codigo, nombre, semestre, cupo_max, cupo_planeado, teacher_id, docente, docente_iniciales, estado_prog, asignatura, horas, programa_id, semestre_num, grupo_seccion, jornada) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, c, n, sem, cmax, cpl, tid, doc, ini, ep, asig, h, pid, sn, gs, jor)
  ig('01', '01', 'Grupo 01', 'Semestre 3', 40, 40, 'd-martinez', 'Alberto Martínez', 'AM', 'horario', 'Programación Orientada a Objetos', 4, 'sis', 3, 'A', 'Diurna')
  ig('02', '02', 'Grupo 02', 'Semestre 3', 40, 40, 'd-gomez', 'Laura Gómez', 'LG', 'pendiente', 'Programación Orientada a Objetos', 4, 'sis', 3, 'B', 'Diurna')
  ig('03', '03', 'Grupo 03', 'Semestre 3', 40, 40, null, null, null, 'pendiente', 'Programación Orientada a Objetos', 4, 'sis', 3, 'C', 'Diurna')
  ig('04', '04', 'Grupo 04', 'Semestre 3', 40, 40, 'd-ruiz', 'Carlos Ruiz', 'CR', 'horario', 'Programación Orientada a Objetos', 4, 'sis', 3, 'D', 'Nocturna')
  ig('sis-4a-poo', 'A', 'Grupo A', 'Semestre 4', 38, 38, 'd-gomez', 'Gómez, L.', 'LG', 'horario', 'Programación Orientada a Objetos', 4, 'sis', 4, 'A', 'Diurna')
  ig('sis-4b-poo', 'B', 'Grupo B', 'Semestre 4', 40, 40, 'd-martinez', 'Martinez, A.', 'AM', 'horario', 'Programación Orientada a Objetos', 4, 'sis', 4, 'B', 'Diurna')
  ig('sis-5a-ed', 'A', 'Grupo A', 'Semestre 5', 35, 35, 'd-martinez', 'Martinez, A.', 'AM', 'horario', 'Estructuras de Datos', 4, 'sis', 5, 'A', 'Diurna')
  ig('sis-5a-bd', 'A', 'Grupo A', 'Semestre 5', 35, 35, 'd-martinez', 'Martinez, A.', 'AM', 'horario', 'Bases de Datos', 4, 'sis', 5, 'A', 'Diurna')
  ig('sis-5a-iso', 'A', 'Grupo A', 'Semestre 5', 34, 34, 'd-gomez', 'Gómez, L.', 'LG', 'horario', 'Ingeniería de Software I', 4, 'sis', 5, 'A', 'Diurna')

  console.log('✓ Base de datos inicializada con datos semilla')
}
