const express = require('express');
const path = require('node:path');
const db = require('./db');

const app = express();
app.use(express.json());
app.use('/app', express.static(path.join(__dirname, '..', 'public', 'app')));
app.use('/dashboard', express.static(path.join(__dirname, '..', 'public', 'dashboard')));

// ---------- Helpers ----------
function diasHasta(fechaStr) {
  if (!fechaStr) return null;
  const hoy = new Date();
  const f = new Date(fechaStr);
  return Math.ceil((f - hoy) / (1000 * 60 * 60 * 24));
}

function productoConEstado(p) {
  const dias = diasHasta(p.fecha_vencimiento);
  return {
    ...p,
    valor_inventario: Math.round(p.precio_costo * p.stock_actual),
    dias_para_vencer: dias,
    vencimiento_proximo: dias !== null && dias <= 15,
    stock_bajo: p.stock_actual <= p.stock_minimo,
  };
}

// ---------- Auth simple (PIN) ----------
app.post('/api/login', (req, res) => {
  const { pin } = req.body;
  const op = db.prepare('SELECT id, nombre FROM operarios WHERE pin = ?').get(pin);
  if (!op) return res.status(401).json({ error: 'PIN incorrecto' });
  res.json(op);
});

// ---------- Bodegas ----------
app.get('/api/bodegas', (req, res) => {
  res.json(db.prepare('SELECT * FROM bodegas').all());
});

// ---------- Productos ----------
app.get('/api/productos', (req, res) => {
  const { bodega_id, codigo_interno } = req.query;
  let rows;
  if (codigo_interno) {
    rows = db.prepare('SELECT * FROM productos WHERE codigo_interno = ?' + (bodega_id ? ' AND bodega_id = ?' : ''))
      .all(...(bodega_id ? [codigo_interno, bodega_id] : [codigo_interno]));
  } else if (bodega_id) {
    rows = db.prepare('SELECT * FROM productos WHERE bodega_id = ? ORDER BY nombre').all(bodega_id);
  } else {
    rows = db.prepare('SELECT * FROM productos ORDER BY nombre').all();
  }
  res.json(rows.map(productoConEstado));
});

app.get('/api/productos/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM productos WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'No encontrado' });
  res.json(productoConEstado(p));
});

app.post('/api/productos', (req, res) => {
  const { bodega_id, codigo_interno, nombre, unidad_medida, lote, fecha_vencimiento, precio_costo, stock_minimo } = req.body;
  if (!bodega_id || !codigo_interno || !nombre || !unidad_medida) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }
  const info = db.prepare(`
    INSERT INTO productos (bodega_id, codigo_interno, nombre, unidad_medida, lote, fecha_vencimiento, precio_costo, stock_minimo, stock_actual)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
  `).run(bodega_id, codigo_interno, nombre, unidad_medida, lote || null, fecha_vencimiento || null, precio_costo || 0, stock_minimo || 5);
  const p = db.prepare('SELECT * FROM productos WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(productoConEstado(p));
});

// ---------- Movimientos ----------
app.get('/api/movimientos', (req, res) => {
  const { bodega_id, limit } = req.query;
  let sql = `
    SELECT m.*, p.nombre as producto_nombre, p.codigo_interno, p.lote, p.bodega_id
    FROM movimientos m JOIN productos p ON p.id = m.producto_id
    WHERE m.deshecho = 0
  `;
  const params = [];
  if (bodega_id) {
    sql += ' AND p.bodega_id = ?';
    params.push(bodega_id);
  }
  sql += ' ORDER BY m.fecha DESC, m.id DESC';
  if (limit) {
    sql += ' LIMIT ?';
    params.push(Number(limit));
  }
  res.json(db.prepare(sql).all(...params));
});

app.post('/api/movimientos', (req, res) => {
  const { producto_id, codigo_interno, bodega_id, tipo, cantidad, operario, responsable_muestra, destino_muestra } = req.body;

  let producto;
  if (producto_id) {
    producto = db.prepare('SELECT * FROM productos WHERE id = ?').get(producto_id);
  } else if (codigo_interno) {
    producto = db.prepare('SELECT * FROM productos WHERE codigo_interno = ?' + (bodega_id ? ' AND bodega_id = ?' : ''))
      .get(...(bodega_id ? [codigo_interno, bodega_id] : [codigo_interno]));
  }
  if (!producto) return res.status(404).json({ error: 'QR no reconocido: producto no encontrado' });
  if (!['ENTRADA', 'SALIDA', 'MUESTRA'].includes(tipo)) return res.status(400).json({ error: 'Tipo inválido' });
  if (!cantidad || cantidad <= 0) return res.status(400).json({ error: 'Cantidad inválida' });

  const delta = tipo === 'ENTRADA' ? cantidad : -cantidad;
  if (producto.stock_actual + delta < 0) {
    return res.status(400).json({ error: `Stock insuficiente. Disponible: ${producto.stock_actual}` });
  }

  const info = db.prepare(`
    INSERT INTO movimientos (producto_id, tipo, cantidad, operario, responsable_muestra, destino_muestra)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(producto.id, tipo, cantidad, operario || 'Operario', responsable_muestra || null, destino_muestra || null);

  db.prepare('UPDATE productos SET stock_actual = stock_actual + ? WHERE id = ?').run(delta, producto.id);

  const productoActualizado = productoConEstado(db.prepare('SELECT * FROM productos WHERE id = ?').get(producto.id));
  res.status(201).json({ movimiento_id: info.lastInsertRowid, producto: productoActualizado });
});

app.post('/api/movimientos/:id/deshacer', (req, res) => {
  const mov = db.prepare('SELECT * FROM movimientos WHERE id = ?').get(req.params.id);
  if (!mov || mov.deshecho) return res.status(404).json({ error: 'Movimiento no disponible para deshacer' });

  const inverso = mov.tipo === 'ENTRADA' ? -mov.cantidad : mov.cantidad;
  db.prepare('UPDATE productos SET stock_actual = stock_actual + ? WHERE id = ?').run(inverso, mov.producto_id);
  db.prepare('UPDATE movimientos SET deshecho = 1 WHERE id = ?').run(mov.id);
  res.json({ ok: true });
});

app.get('/api/movimientos/ultimo', (req, res) => {
  const { operario } = req.query;
  const mov = db.prepare(`
    SELECT m.*, p.nombre as producto_nombre FROM movimientos m
    JOIN productos p ON p.id = m.producto_id
    WHERE m.deshecho = 0 AND m.operario = ?
    ORDER BY m.id DESC LIMIT 1
  `).get(operario);
  res.json(mov || null);
});

// ---------- Dashboard ----------
app.get('/api/dashboard/resumen', (req, res) => {
  const { bodega_id } = req.query;
  const productos = (bodega_id
    ? db.prepare('SELECT * FROM productos WHERE bodega_id = ?').all(bodega_id)
    : db.prepare('SELECT * FROM productos').all()
  ).map(productoConEstado);

  res.json({
    total_skus: productos.length,
    unidades_totales: productos.reduce((s, p) => s + p.stock_actual, 0),
    valor_inventario: productos.reduce((s, p) => s + p.valor_inventario, 0),
    alertas_vencimiento: productos.filter(p => p.vencimiento_proximo).length,
    alertas_stock_bajo: productos.filter(p => p.stock_bajo).length,
  });
});

app.get('/api/dashboard/alertas', (req, res) => {
  const { bodega_id } = req.query;
  const productos = (bodega_id
    ? db.prepare('SELECT * FROM productos WHERE bodega_id = ?').all(bodega_id)
    : db.prepare('SELECT * FROM productos').all()
  ).map(productoConEstado);

  const sinMovimientoDias = 7;
  const ahora = Date.now();
  const ultimoMovPorProducto = {};
  for (const m of db.prepare('SELECT producto_id, MAX(fecha) as ultima FROM movimientos WHERE deshecho = 0 GROUP BY producto_id').all()) {
    ultimoMovPorProducto[m.producto_id] = m.ultima;
  }

  const alertas = [];
  for (const p of productos) {
    if (p.vencimiento_proximo) {
      alertas.push({ tipo: 'VENCIMIENTO', producto: p.nombre, detalle: `Vence en ${p.dias_para_vencer} días (lote ${p.lote || 's/n'})`, bodega_id: p.bodega_id });
    }
    if (p.stock_bajo) {
      alertas.push({ tipo: 'STOCK_BAJO', producto: p.nombre, detalle: `Stock actual ${p.stock_actual}, mínimo ${p.stock_minimo}`, bodega_id: p.bodega_id });
    }
    const ultima = ultimoMovPorProducto[p.id];
    const diasSinMov = ultima ? Math.floor((ahora - new Date(ultima + 'Z').getTime()) / (1000 * 60 * 60 * 24)) : null;
    if (diasSinMov !== null && diasSinMov >= sinMovimientoDias) {
      alertas.push({ tipo: 'SIN_MOVIMIENTO', producto: p.nombre, detalle: `${diasSinMov} días sin registrar movimientos`, bodega_id: p.bodega_id });
    }
  }
  res.json(alertas);
});

app.get('/api/dashboard/ventas-riesgo', (req, res) => {
  const { bodega_id } = req.query;
  const productos = (bodega_id
    ? db.prepare('SELECT * FROM productos WHERE bodega_id = ?').all(bodega_id)
    : db.prepare('SELECT * FROM productos').all()
  ).map(productoConEstado).filter(p => p.stock_bajo);

  res.json({
    productos,
    valor_en_riesgo: productos.reduce((s, p) => s + p.valor_inventario, 0),
  });
});

// ---------- Reportes CSV ----------
app.get('/api/reportes/csv', (req, res) => {
  const { tipo = 'movimientos', bodega_id } = req.query;
  let rows = [];
  let headers = [];
  let filename = 'reporte.csv';

  if (tipo === 'movimientos') {
    headers = ['fecha', 'tipo', 'producto', 'codigo_interno', 'lote', 'cantidad', 'operario'];
    filename = 'trazabilidad_movimientos.csv';
    let sql = `SELECT m.fecha, m.tipo, p.nombre as producto, p.codigo_interno, p.lote, m.cantidad, m.operario
               FROM movimientos m JOIN productos p ON p.id = m.producto_id WHERE m.deshecho = 0`;
    const params = [];
    if (bodega_id) { sql += ' AND p.bodega_id = ?'; params.push(bodega_id); }
    sql += ' ORDER BY m.fecha DESC';
    rows = db.prepare(sql).all(...params);
  } else if (tipo === 'mermas') {
    headers = ['fecha', 'producto', 'codigo_interno', 'lote', 'cantidad', 'responsable_muestra', 'destino_muestra'];
    filename = 'mermas_y_bajas.csv';
    let sql = `SELECT m.fecha, p.nombre as producto, p.codigo_interno, p.lote, m.cantidad, m.responsable_muestra, m.destino_muestra
               FROM movimientos m JOIN productos p ON p.id = m.producto_id WHERE m.deshecho = 0 AND m.tipo = 'MUESTRA'`;
    const params = [];
    if (bodega_id) { sql += ' AND p.bodega_id = ?'; params.push(bodega_id); }
    rows = db.prepare(sql).all(...params);
  } else if (tipo === 'valorizacion') {
    headers = ['producto', 'codigo_interno', 'lote', 'stock_actual', 'precio_costo', 'valor_inventario'];
    filename = 'valorizacion_inventario.csv';
    const productos = (bodega_id
      ? db.prepare('SELECT * FROM productos WHERE bodega_id = ?').all(bodega_id)
      : db.prepare('SELECT * FROM productos').all()
    ).map(productoConEstado);
    rows = productos.map(p => ({ producto: p.nombre, codigo_interno: p.codigo_interno, lote: p.lote, stock_actual: p.stock_actual, precio_costo: p.precio_costo, valor_inventario: p.valor_inventario }));
  }

  const csv = [headers.join(',')].concat(
    rows.map(r => headers.map(h => `"${(r[h] ?? '').toString().replace(/"/g, '""')}"`).join(','))
  ).join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
});

app.get('/', (req, res) => res.redirect('/app'));

const PORT = process.env.PORT || 3000;
// En Render, RENDER_EXTERNAL_URL trae la URL pública real (ej: https://trazipyme.onrender.com).
// Si no existe (corriendo en tu computador), se usa localhost como antes.
const BASE_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
app.listen(PORT, () => {
  console.log(`TraziPyme corriendo en ${BASE_URL}`);
  console.log(`  App móvil:   ${BASE_URL}/app`);
  console.log(`  Dashboard:   ${BASE_URL}/dashboard`);
});
