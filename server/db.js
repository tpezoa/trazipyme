const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// La base de datos NO se guarda dentro de la carpeta del proyecto: si esta carpeta
// está sincronizada con Drive/iCloud/Dropbox, SQLite puede fallar con "disk I/O error"
// por el bloqueo de archivos que usan esas apps de sincronización. Por eso la guardamos
// en una carpeta local fija en el computador (se puede sobreescribir con TRAZIPYME_DB_PATH).
const dataDir = path.join(os.homedir(), '.trazipyme');
fs.mkdirSync(dataDir, { recursive: true });
const dbPath = process.env.TRAZIPYME_DB_PATH || path.join(dataDir, 'trazipyme.db');

const db = new DatabaseSync(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS bodegas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS productos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bodega_id INTEGER NOT NULL,
    codigo_interno TEXT NOT NULL,
    nombre TEXT NOT NULL,
    unidad_medida TEXT NOT NULL,
    lote TEXT,
    fecha_vencimiento TEXT,
    precio_costo REAL NOT NULL DEFAULT 0,
    stock_minimo INTEGER NOT NULL DEFAULT 5,
    stock_actual INTEGER NOT NULL DEFAULT 0,
    creado_en TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (bodega_id) REFERENCES bodegas(id)
  );

  CREATE TABLE IF NOT EXISTS movimientos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    producto_id INTEGER NOT NULL,
    tipo TEXT NOT NULL CHECK (tipo IN ('ENTRADA','SALIDA','MUESTRA')),
    cantidad INTEGER NOT NULL,
    operario TEXT NOT NULL,
    responsable_muestra TEXT,
    destino_muestra TEXT,
    fecha TEXT NOT NULL DEFAULT (datetime('now')),
    deshecho INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (producto_id) REFERENCES productos(id)
  );

  CREATE TABLE IF NOT EXISTS operarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    pin TEXT NOT NULL
  );
`);

function seedIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) as c FROM bodegas').get().c;
  if (count > 0) return;

  const insertBodega = db.prepare('INSERT INTO bodegas (nombre) VALUES (?)');
  const b1 = insertBodega.run('Bodega Central - Comercial AyB').lastInsertRowid;
  const b2 = insertBodega.run('Sucursal Sur - Comercial AyB').lastInsertRowid;

  db.prepare('INSERT INTO operarios (nombre, pin) VALUES (?, ?)').run('Juan Pérez', '1234');
  db.prepare('INSERT INTO operarios (nombre, pin) VALUES (?, ?)').run('Gerente AyB', '9999');

  const insertProducto = db.prepare(`
    INSERT INTO productos (bodega_id, codigo_interno, nombre, unidad_medida, lote, fecha_vencimiento, precio_costo, stock_minimo, stock_actual)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const hoy = new Date();
  const enDias = (n) => {
    const d = new Date(hoy);
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };

  const seed = [
    [b1, 'JER-001', 'Jeringas 5ml caja x100', 'caja', 'L2026-014', enDias(12), 8500, 10, 42],
    [b1, 'GUA-002', 'Guantes nitrilo talla M caja x100', 'caja', 'L2026-022', enDias(45), 6200, 15, 8],
    [b1, 'MAS-003', 'Mascarillas quirúrgicas caja x50', 'caja', 'L2026-031', enDias(5), 3100, 20, 31],
    [b1, 'ALC-004', 'Alcohol gel 1L', 'unidad', 'L2026-009', enDias(90), 2900, 12, 3],
    [b1, 'TER-005', 'Termómetro digital infrarrojo', 'unidad', 'L2026-002', null, 15900, 5, 6],
    [b2, 'JER-001', 'Jeringas 5ml caja x100', 'caja', 'L2026-015', enDias(20), 8500, 10, 18],
    [b2, 'SUE-006', 'Suero fisiológico 500ml caja x20', 'caja', 'L2026-040', enDias(3), 11200, 8, 2],
  ];
  for (const p of seed) insertProducto.run(...p);

  const productos = db.prepare('SELECT * FROM productos').all();
  const insertMov = db.prepare(`
    INSERT INTO movimientos (producto_id, tipo, cantidad, operario, fecha)
    VALUES (?, ?, ?, ?, datetime('now', ?))
  `);
  insertMov.run(productos[0].id, 'ENTRADA', 50, 'Juan Pérez', '-2 days');
  insertMov.run(productos[0].id, 'SALIDA', 8, 'Juan Pérez', '-1 days');
  insertMov.run(productos[1].id, 'ENTRADA', 20, 'Juan Pérez', '-5 days');
  insertMov.run(productos[1].id, 'SALIDA', 12, 'Juan Pérez', '-3 hours');
  insertMov.run(productos[2].id, 'MUESTRA', 2, 'Juan Pérez', '-1 hours');
}

seedIfEmpty();

module.exports = db;
