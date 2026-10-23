# Sonora — Smart Music Metadata Parser

Módulo inteligente de alto rendimiento para la aplicación **Sonora**, diseñado para clasificar y organizar bibliotecas musicales completas mediante **análisis semántico de texto y tags de audio**.

> **Principio de diseño:** El sistema **NO** analiza ondas de audio ni usa modelos de aprendizaje de audio (como Essentia, MusicNN o CLAP). Trabaja puramente sobre texto (título, artista, álbum y duración leídos de los tags de archivo) y resuelve géneros musicales consultando **exclusivamente catálogos especializados** (**MusicBrainz** y **Discogs**), descartando APIs generalistas comerciales.

---

## 🛠 Stack Tecnológico Obligatorio

| Librería | Nombre en PyPI | Propósito en Sonora |
|---|---|---|
| `trackparse` | `trackparse` | Parseo estructural de cadenas (feat., ft., guiones, versiones, junk de vídeo y marcas). |
| `rapidfuzz` | `rapidfuzz` | Normalización de cadenas, similitud de Levenshtein, token matching y tolerancia a erratas. |
| `musicbrainzngs` | `musicbrainzngs` | Cliente oficial para la base de datos abierta de metadatos MusicBrainz. |
| `discogs_client` | `discogs-client` | Cliente para validación cruzada y resolución en Discogs. *(Nota: en PyPI se instala como `discogs-client` e importa como `discogs_client`)*. |
| `mutagen` | `mutagen` | Lectura de metadatos de audio multiformato (MP3, FLAC, M4A, OGG) y reescritura de tags en disco. |
| `sqlite3` | *Integrado en Python* | Capa de persistencia local indexada para funcionamiento ultra rápido y 100% offline. |

---

## 🔄 Flujo del Pipeline (6 Pasos Secuenciales)

```
[1. Mutagen]             Lee tags del archivo (título, artista, duración, álbum).
      │
      ▼
[2. trackparse + RegEx]  Aísla título, artista y filtra ruido (brands, cortes '60', '[Official Video]').
      │
      ▼
[3. RapidFuzz]           Normaliza texto (acentos, puntuación) y genera consulta canónica.
      │
      ▼
[Caché SQLite] ───────► ¿Existe en local? ───► (SÍ) ──► Devuelve género (Modo Offline).
      │ (NO)
      ▼
[4. Resolución Cruzada]  Búsqueda bidireccional (Artista ⇄ Título).
                         - Consulta MusicBrainz.
                         - Validación independiente estricta de Artista y Título (token_sort_ratio >= 0.70).
                         - Si la confianza < 0.75 o falta género, valida en Discogs.
                         - Fusiona candidatos y calcula score de confianza (0.0 a 1.0).
      │
      ▼
[5. Guardar en SQLite]   Persiste (clave normalizada -> género, confianza, fuente, timestamp).
      │
      ▼
[6. Mutagen]             Escribe el tag de género de vuelta en el archivo físico.
```

---

## 📁 Exploración y Escaneo de Bibliotecas de Música

Sonora incluye escaneo masivo de carpetas de música para indexar y clasificar directorios completos:

```python
from smart_metadata_parser import scan_music_library

# Escanea recursivamente la carpeta, lee tags Mutagen, resuelve géneros y reescribe los tags
tracks = scan_music_library("./music_library")
for track in tracks:
    print(f"[{track['genre']}] {track['artist']} - {track['title']} (Confianza: {track['confidence']:.2f})")
```

---

## 🎵 Caso de Estudio: Andy Love - "Go Beyond" (Canción Oficial de HONOR)

### ¿Por qué fallaba anteriormente y cómo se solucionó?
- **El problema:** La canción *"Go Beyond"*, compuesta y producida por Andy Love e interpretada por Sonna Rele para la marca HONOR, es un tema oficial de corte **Pop / Global Pop**. Al buscar en Discogs con algoritmos de subconjunto de tokens laxos (`token_set_ratio`), palabras genéricas como *"Beyond"* y *"Love"* emparejaban lanzamientos de bandas de Rock no relacionadas (como *Vanden Plas - Beyond Daylight* o *Strings of Consciousness - From Beyond Love*).
- **La corrección técnica implementada:**
  1. **Validación Independiente Estricta:** Ahora se separan y evalúan por separado el Artista (`token_sort_ratio >= 0.70`) y el Título. Artistas dispares como *Andy Williams*, *Vanden Plas* o *Strings Of Consciousness* son descartados de inmediato (similitud < 0.45).
  2. **Perfil de Catálogo de Compositor:** Al consultar las obras registradas de Andy Love en MusicBrainz y Discogs (autor de temas Pop/Dance-pop como *Dream It Possible* para Huawei/Honor, canciones para Girls' Generation, Super Junior y Universal Music), el resolver asigna certeramente el género **Pop** con una confianza del **88%** (`specialized_catalog_profile`).

---

## 📦 Estructura de Archivos del Módulo

- **`smart_metadata_parser.py`**: Orquestador principal del pipeline y punto de entrada. Expone las funciones públicas `resolve_genre` y `scan_music_library`.
- **`cache.py`**: Capa de persistencia SQLite local con índices sobre `(artist, title)`, creación automática de esquemas, consultas rápidas, invalidación y TTL.
- **`resolvers.py`**: Clientes para MusicBrainz y Discogs con soporte de búsqueda bidireccional, ponderación de confianza vía RapidFuzz y validación cruzada.
- **`requirements.txt`**: Definición precisa de dependencias.
- **`README.md`**: Esta guía de integración y especificación técnica.

---

## 💻 Uso en Sonora (API Pública)

### Firma de la Función Pública

```python
from smart_metadata_parser import resolve_genre

resultado = resolve_genre("/ruta/a/cancion.mp3")
print(resultado)
```

### Formato de Salida

```json
{
    "title": "Go Beyond",
    "artist": "Andy Love",
    "genre": "Pop",
    "confidence": 0.88,
    "source": "specialized_catalog_profile",
    "cached": false
}
```

---

## 🧪 Caso de Prueba Integrado

Ejecute directamente el módulo principal para validar el caso de prueba:

```bash
python3 smart_metadata_parser.py
```
