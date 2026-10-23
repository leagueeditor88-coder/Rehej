import express from 'express';
import { createServer as createViteServer } from 'vite';
import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import multer from 'multer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configurar directorio de subida para archivos de audio
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (_req, file, cb) => {
    // Preservar nombre original seguro
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_ ()]/g, '_');
    cb(null, `${Date.now()}_${safeName}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // Hasta 100MB
});

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  const isProd = process.env.NODE_ENV === 'production';

  app.use(express.json());

  // API: Analizar archivo de audio subido o existente en disco
  app.post('/api/analyze-file', upload.single('audioFile'), (req, res) => {
    let targetFilePath = '';

    if (req.file) {
      targetFilePath = req.file.path;
    } else if (req.body && req.body.filePath) {
      targetFilePath = req.body.filePath;
    }

    if (!targetFilePath || !fs.existsSync(targetFilePath)) {
      res.status(400).json({ error: 'No se proporcionó un archivo válido para analizar' });
      return;
    }

    const pythonScript = path.join(__dirname, 'python_bridge.py');
    execFile('python3', [pythonScript, 'analyze_file', targetFilePath], { cwd: __dirname }, (error, stdout, stderr) => {
      if (error) {
        console.error('Error analizando archivo con Python:', stderr || error.message);
        res.status(500).json({ error: 'Fallo al analizar archivo con Mutagen/Sonora', details: stderr || error.message });
        return;
      }
      try {
        const lines = stdout.trim().split('\n');
        const jsonLine = lines[lines.length - 1];
        const data = JSON.parse(jsonLine);
        res.json(data);
      } catch (parseErr) {
        console.error('Error parseando JSON de Python:', stdout);
        res.status(500).json({ error: 'Respuesta inválida del motor Python', raw: stdout });
      }
    });
  });

  // API: Descargar archivo con tags actualizados
  app.get('/api/download-file', (req, res) => {
    const filePath = req.query.path as string;
    if (!filePath || !fs.existsSync(filePath)) {
      res.status(404).send('Archivo no encontrado');
      return;
    }
    res.download(filePath);
  });

  // API: Actualizar género manualmente en SQLite y reescribir tag con Mutagen
  app.post('/api/library/update-genre', (req, res) => {
    const { filePath, artist, title, genre } = req.body || {};
    if (!genre || !artist || !title) {
      res.status(400).json({ error: 'Se requieren artist, title y genre' });
      return;
    }

    const pythonScript = path.join(__dirname, 'python_bridge.py');
    const safePath = filePath || '';
    const args = ['update_genre', safePath, artist, title, genre];

    execFile('python3', [pythonScript, ...args], { cwd: __dirname }, (error, stdout, stderr) => {
      if (error) {
        console.error('Error actualizando género:', stderr || error.message);
        res.status(500).json({ error: 'Error actualizando tag de género' });
        return;
      }
      try {
        const lines = stdout.trim().split('\n');
        const jsonLine = lines[lines.length - 1];
        res.json(JSON.parse(jsonLine));
      } catch (e) {
        res.json({ success: true, genre, file_path: safePath });
      }
    });
  });

  // API: Parse track string through Python Sonora Pipeline
  app.post('/api/parse', (req, res) => {
    const { input, offline = false } = req.body;
    if (!input || typeof input !== 'string') {
      res.status(400).json({ error: 'El campo "input" es requerido' });
      return;
    }

    const pythonScript = path.join(__dirname, 'python_bridge.py');
    const args = ['parse_string', input, offline ? 'true' : 'false'];

    execFile('python3', [pythonScript, ...args], { cwd: __dirname }, (error, stdout, stderr) => {
      if (error) {
        console.error('Error ejecutando script Python:', stderr || error.message);
        res.status(500).json({ error: 'Fallo al procesar con Sonora Parser', details: stderr || error.message });
        return;
      }

      try {
        // Encontrar la última línea JSON de la salida
        const lines = stdout.trim().split('\n');
        const jsonLine = lines[lines.length - 1];
        const data = JSON.parse(jsonLine);
        res.json(data);
      } catch (parseErr) {
        console.error('Error parseando JSON de Python:', stdout);
        res.status(500).json({ error: 'Respuesta inválida del motor Python', raw: stdout });
      }
    });
  });

  // API: Run test case directly and return stdout logs
  app.post('/api/run-test', (_req, res) => {
    const testScript = path.join(__dirname, 'smart_metadata_parser.py');
    execFile('python3', [testScript], { cwd: __dirname }, (error, stdout, stderr) => {
      res.json({
        success: !error,
        output: stdout,
        error: stderr,
      });
    });
  });

  // API: Scan entire Music Library
  app.post('/api/library/scan', (req, res) => {
    const { path: dirPath } = req.body || {};
    const pythonScript = path.join(__dirname, 'python_bridge.py');
    const targetDir = dirPath && typeof dirPath === 'string' && dirPath.trim() 
      ? dirPath.trim() 
      : path.join(__dirname, 'music_library');

    execFile('python3', [pythonScript, 'scan_library', targetDir], { cwd: __dirname }, (error, stdout, stderr) => {
      if (error) {
        console.error('Error escaneando biblioteca:', stderr || error.message);
        res.status(500).json({ error: 'Error al escanear biblioteca de música', details: stderr || error.message });
        return;
      }
      try {
        const lines = stdout.trim().split('\n');
        const jsonLine = lines[lines.length - 1];
        const data = JSON.parse(jsonLine);
        res.json(data);
      } catch (e) {
        res.status(500).json({ error: 'Error decodificando respuesta de biblioteca', raw: stdout });
      }
    });
  });

  // API: Seed sample tracks in Music Library
  app.post('/api/library/seed-samples', (req, res) => {
    const { path: dirPath } = req.body || {};
    const pythonScript = path.join(__dirname, 'python_bridge.py');
    const targetDir = dirPath && typeof dirPath === 'string' && dirPath.trim() 
      ? dirPath.trim() 
      : path.join(__dirname, 'music_library');

    execFile('python3', [pythonScript, 'seed_samples', targetDir], { cwd: __dirname }, (error, stdout, stderr) => {
      if (error) {
        res.status(500).json({ error: 'Error generando pistas de prueba' });
        return;
      }
      try {
        const lines = stdout.trim().split('\n');
        const jsonLine = lines[lines.length - 1];
        res.json(JSON.parse(jsonLine));
      } catch (e) {
        res.status(500).json({ error: 'Error al generar muestras' });
      }
    });
  });

  // API: Get SQLite Cache entries
  app.get('/api/cache', (_req, res) => {
    const pythonScript = path.join(__dirname, 'python_bridge.py');
    execFile('python3', [pythonScript, 'get_cache'], { cwd: __dirname }, (error, stdout, stderr) => {
      if (error) {
        res.status(500).json({ error: 'Fallo al obtener caché SQLite' });
        return;
      }
      try {
        const lines = stdout.trim().split('\n');
        const jsonLine = lines[lines.length - 1];
        const data = JSON.parse(jsonLine);
        res.json(data);
      } catch (e) {
        res.status(500).json({ error: 'Error decodificando caché SQLite' });
      }
    });
  });

  // API: Clear SQLite Cache
  app.post('/api/cache/clear', (_req, res) => {
    const pythonScript = path.join(__dirname, 'python_bridge.py');
    execFile('python3', [pythonScript, 'clear_cache'], { cwd: __dirname }, (error, stdout) => {
      if (error) {
        res.status(500).json({ error: 'Fallo al limpiar caché SQLite' });
        return;
      }
      res.json({ success: true, message: 'Caché SQLite eliminada' });
    });
  });

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Sonora Smart Metadata Parser server corriendo en http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Error iniciando servidor:', err);
  process.exit(1);
});
