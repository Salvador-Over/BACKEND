const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ dest: 'uploads/' });

const pool = new Pool({
  user: 'sa',
  host: 'dpg-d2mdc1qdbo4c73d6m020-a',
  database: 'informatica_io8k',
  password: 'ViVCliLfjbyWcEjgwwZk5LC3fy4WBVVR',
  port: 5432,
});

async function query(text, params) {
  const client = await pool.connect();
  try {
    const res = await client.query(text, params);
    return res;
  } finally {
    client.release();
  }
}

// ---- Login API ----
app.post('/api/login', async (req, res) => {
  const { usuario, contrasena } = req.body;
  try {
    const result = await query(
      'SELECT "Usuario","Rol" FROM "UsuariosRoles" WHERE "Usuario"=$1 AND "Contrasena"=$2',
      [usuario, contrasena]
    );

    if (result.rows.length > 0) {
      res.json({ success: true, user: result.rows[0] });
    } else {
      res.json({ success: false });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Error en el servidor' });
  }
});

app.listen(4000, () => console.log('Servidor corriendo'));
