const express = require('express');
const cors = require('cors');
const sql = require('mssql');
const multer = require('multer');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ dest: 'uploads/' });

const config = {
  user: 'sa',
  password: 'saul',
  server: 'INFORMATICA4306',
  database: 'android',
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true
  }
};

let pool = null;

async function getConnection() {
  if (!pool) {
    pool = await sql.connect(config);
  }
  return pool;
}

// ---- Login API ----
app.post('/api/login', async (req, res) => {
  const { usuario, contrasena } = req.body;
  try {
    const pool = await getConnection();
    const result = await pool.request()
      .input('usuario', sql.VarChar(50), usuario)
      .input('contrasena', sql.VarChar(100), contrasena)
      .query('SELECT Usuario, Rol FROM UsuariosRoles WHERE Usuario = @usuario AND Contrasena = @contrasena');

    if (result.recordset.length > 0) {
      res.json({ success: true, user: result.recordset[0] });
    } else {
      res.json({ success: false });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Error en el servidor' });
  }
});

// ---- Upload PDF API ----
app.post('/api/casos', upload.single('file'), async (req, res) => {
  const { CodigoCaso, Seleccionar } = req.body;
  const file = req.file;

  if (!file) return res.status(400).json({ message: 'No se recibió archivo PDF' });

  try {
    const pool = await getConnection();
    const pdfBuffer = fs.readFileSync(file.path);

    // Calcular intento actual según cantidad existente para el mismo CodigoCaso
    const countResult = await pool.request()
      .input('CodigoCaso', sql.VarChar(100), CodigoCaso)
      .query('SELECT COUNT(*) AS cnt FROM Casos WHERE CodigoCaso = @CodigoCaso');
    const cnt = countResult.recordset[0]?.cnt || 0;

    if (cnt >= 2) {
      fs.unlinkSync(file.path);
      return res.status(400).json({ message: 'Máximo 2 intentos alcanzado para este Código de caso' });
    }

    const intentoLabel = cnt === 0 ? 'Primer intento' : 'Segundo intento';

    await pool.request()
      .input('CodigoCaso', sql.VarChar(100), CodigoCaso)
      .input('Seleccionar', sql.VarChar(255), Seleccionar)
      .input('Intentos', sql.VarChar(50), intentoLabel)
      .input('ArchivoPDF', sql.VarBinary(sql.MAX), pdfBuffer)
      .query('INSERT INTO Casos (CodigoCaso, Seleccionar, intentos, ArchivoPDF) VALUES (@CodigoCaso, @Seleccionar, @Intentos, @ArchivoPDF)');

    fs.unlinkSync(file.path);
    res.json({ message: `Archivo ${file.originalname} subido correctamente` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al insertar caso en la base de datos' });
  }
});

// ---- Listar Casos ----
app.get('/api/casos', async (req, res) => {
  try {
    const pool = await getConnection();
    const result = await pool.request()
      .query('SELECT Id, CodigoCaso, Seleccionar, intentos, Fecha FROM Casos ORDER BY Id DESC');
    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener casos' });
  }
});

// ---- Obtener intentos por Código de caso ----
app.get('/api/casos/:codigo/attempts', async (req, res) => {
  const { codigo } = req.params;
  try {
    const pool = await getConnection();
    const result = await pool.request()
      .input('CodigoCaso', sql.VarChar(100), codigo)
      .query('SELECT Id, intentos, Seleccionar, Fecha FROM Casos WHERE CodigoCaso = @CodigoCaso ORDER BY Fecha ASC');
    const attempts = result.recordset || [];
    res.json({ count: attempts.length, attempts });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener intentos' });
  }
});

// ---- Obtener PDF por ID (ver o descargar) ----
app.get('/api/casos/:id/pdf', async (req, res) => {
  const { id } = req.params;
  const { dl } = req.query; // si dl=1 -> forzar descarga
  try {
    const pool = await getConnection();
    const result = await pool.request()
      .input('Id', sql.Int, Number(id))
      .query('SELECT CodigoCaso, ArchivoPDF FROM Casos WHERE Id = @Id');

    if (result.recordset.length === 0) return res.status(404).send('No encontrado');

    const row = result.recordset[0];
    const filename = `${row.CodigoCaso.replace(/:/g, '-')}.pdf`;
    const buffer = row.ArchivoPDF;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      dl === '1' ? `attachment; filename="${filename}"` : `inline; filename="${filename}"`
    );
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener PDF' });
  }
});

// ---- Iniciar servidor ----
app.listen(4000, () => console.log('Servidor corriendo en http://localhost:4000'));
