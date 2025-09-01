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
  user: 'adminsql',
  password: 'saul12AB',
  server: 'servidormovil.database.windows.net',
  database: 'android',
  options: {
    encrypt: true,
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
  const { CodigoCaso, Seleccionar, Fecha, Usuario } = req.body;
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

    const fechaValue = Fecha ? new Date(Fecha) : null;

    // Insertar el caso con el nombre de usuario
    await pool.request()
      .input('CodigoCaso', sql.VarChar(100), CodigoCaso)
      .input('Seleccionar', sql.VarChar(255), Seleccionar)
      .input('Intentos', sql.VarChar(50), intentoLabel)
      .input('ArchivoPDF', sql.VarBinary(sql.MAX), pdfBuffer)
      .input('Fecha', sql.DateTime, fechaValue)
      .input('Usuario', sql.NVarChar(100), Usuario) // Agregar el nombre de usuario
      .query(`
        INSERT INTO Casos (CodigoCaso, Seleccionar, intentos, ArchivoPDF, Fecha, Usuario) 
        VALUES (@CodigoCaso, @Seleccionar, @Intentos, @ArchivoPDF, ISNULL(@Fecha, GETDATE()), @Usuario)
      `);

    fs.unlinkSync(file.path);
    res.json({ message: `Archivo ${file.originalname} subido correctamente` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al insertar caso en la base de datos' });
  }
});

// Obtener estructura de la tabla Casos
app.get('/api/estructura-tabla', async (req, res) => {
  try {
    const pool = await getConnection();
    const result = await pool.request()
      .query(`SELECT COLUMN_NAME, DATA_TYPE 
              FROM INFORMATION_SCHEMA.COLUMNS 
              WHERE TABLE_NAME = 'Casos'`);
    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener estructura de la tabla' });
  }
});

// ---- Listar Casos ----
app.get('/api/casos', async (req, res) => {
  try {
    const pool = await getConnection();
    const result = await pool.request()
      .query('SELECT Id, CodigoCaso, Seleccionar, intentos, Fecha, COALESCE(Usuario, \'Usuario no especificado\') as Usuario FROM Casos ORDER BY Fecha DESC');
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
      .query('SELECT Id, intentos, Seleccionar, Fecha, COALESCE(Usuario, \'Usuario no especificado\') as Usuario FROM Casos WHERE CodigoCaso = @CodigoCaso ORDER BY Fecha ASC');
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

// Verificar y crear la columna Usuario si no existe
async function verificarEstructuraTabla() {
  try {
    const pool = await getConnection();
    // Verificar si la columna Usuario existe
    const checkColumn = await pool.request()
      .query(`
        IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
                      WHERE TABLE_NAME = 'Casos' AND COLUMN_NAME = 'Usuario')
        BEGIN
          ALTER TABLE Casos ADD Usuario NVARCHAR(100) NULL;
          PRINT 'Columna Usuario agregada a la tabla Casos';
        END
      `);
    console.log('Estructura de la tabla verificada');
  } catch (err) {
    console.error('Error al verificar la estructura de la tabla:', err);
  }
}

// Iniciar el servidor
async function iniciarServidor() {
  try {
    await verificarEstructuraTabla();
    app.listen(4000, () => console.log('Servidor corriendo en http://localhost:4000'));
  } catch (error) {
    console.error('Error al iniciar el servidor:', error);
  }
}

iniciarServidor();
