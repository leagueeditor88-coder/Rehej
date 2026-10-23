"""
Módulo de Gestión y Organización de Bibliotecas Musicales para Sonora.
=====================================================================
Permite escanear directorios de música, leer tags de audio con Mutagen,
procesar pistas en lote o individuales con el Smart Music Metadata Parser,
organizar archivos en carpetas estructuradas por género resuelto y generar
bibliotecas de demostración con archivos de audio reales y tags ID3.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

import mutagen
from mutagen.easyid3 import EasyID3
from mutagen.id3 import ID3, TALB, TCON, TIT2, TPE1

from cache import get_cached_genre, init_cache
from smart_metadata_parser import SmartMetadataParser, resolve_genre

logger = logging.getLogger("sonora.library")
SUPPORTED_EXTENSIONS = {".mp3", ".flac", ".m4a", ".ogg", ".wav", ".opus", ".aac"}


def create_sample_mp3(
    file_path: str,
    raw_title: str,
    raw_artist: str = "",
    album: str = "",
    genre: str = "",
) -> str:
    """
    Crea un archivo MP3 válido con contenedor ID3 para pruebas y demostración.
    """
    os.makedirs(os.path.dirname(os.path.abspath(file_path)), exist_ok=True)
    with open(file_path, "wb") as f:
        # Escribir 6 frames silenciosos MPEG-1 Layer 3 estándar
        frame = b"\xff\xfb\x90\x64" + b"\x00" * 413
        f.write(frame * 6)

    try:
        tags = ID3()
        tags.add(TIT2(encoding=3, text=raw_title))
        if raw_artist:
            tags.add(TPE1(encoding=3, text=raw_artist))
        if album:
            tags.add(TALB(encoding=3, text=album))
        if genre:
            tags.add(TCON(encoding=3, text=genre))
        tags.save(file_path)
    except Exception as exc:
        logger.warning(f"Aviso escribiendo tags iniciales en {file_path}: {exc}")

    return file_path


def seed_demo_library(target_dir: str = "sonora_music_library") -> List[Dict[str, Any]]:
    """
    Crea una biblioteca musical de prueba con archivos de audio reales y tags caóticos/con ruido.
    """
    base_path = Path(target_dir)
    base_path.mkdir(parents=True, exist_ok=True)

    sample_tracks = [
        {
            "filename": "Go Beyond Andy (HONOR Brand Song) 60 Andy Love.mp3",
            "title": "Go Beyond Andy (HONOR Brand Song) 60 Andy Love",
            "artist": "Andy Love",
            "album": "Honor Brand Themes 2021",
            "genre": "",
        },
        {
            "filename": "Daft Punk - One More Time [Official Audio HD] 128.mp3",
            "title": "One More Time [Official Audio HD] 128",
            "artist": "Daft Punk",
            "album": "Discovery",
            "genre": "",
        },
        {
            "filename": "Coldplay ft. Beyoncé - Hymn for the Weekend (Official Video) [Remastered].mp3",
            "title": "Hymn for the Weekend (Official Video) [Remastered]",
            "artist": "Coldplay ft. Beyoncé",
            "album": "A Head Full of Dreams",
            "genre": "",
        },
        {
            "filename": "Queen - Bohemian Rhapsody (Live at Wembley Stadium 1986).mp3",
            "title": "Bohemian Rhapsody (Live at Wembley Stadium 1986)",
            "artist": "Queen",
            "album": "Live at Wembley",
            "genre": "",
        },
        {
            "filename": "Miles Davis - So What (Original 1959 Master Cut).mp3",
            "title": "So What (Original 1959 Master Cut)",
            "artist": "Miles Davis",
            "album": "Kind of Blue",
            "genre": "",
        },
    ]

    created_files = []
    for item in sample_tracks:
        file_dest = str(base_path / item["filename"])
        create_sample_mp3(
            file_path=file_dest,
            raw_title=item["title"],
            raw_artist=item["artist"],
            album=item["album"],
            genre=item["genre"],
        )
        created_files.append(item)

    return scan_library(str(base_path))


def scan_library(directory_path: str) -> List[Dict[str, Any]]:
    """
    Escanea un directorio en busca de archivos de audio soportados y lee sus tags con Mutagen.
    También comprueba si ya existen resultados en la caché SQLite de Sonora.
    """
    dir_p = Path(directory_path)
    if not dir_p.exists() or not dir_p.is_dir():
        return []

    tracks: List[Dict[str, Any]] = []
    parser = SmartMetadataParser()

    for root, _, files in os.walk(dir_p):
        for file in sorted(files):
            ext = Path(file).suffix.lower()
            if ext in SUPPORTED_EXTENSIONS:
                full_path = os.path.join(root, file)
                rel_path = os.path.relpath(full_path, directory_path)
                
                # Leer tags físicos con Mutagen
                tags = parser.read_audio_tags(full_path)
                file_size = os.path.getsize(full_path)

                # Descomponer el texto para ver si está en la caché local
                parsed_preview = parser.parse_track_string(
                    tags.get("title") or Path(file).stem,
                    fallback_artist=tags.get("artist", ""),
                )
                cached = get_cached_genre(parsed_preview.artist, parsed_preview.title)

                tracks.append({
                    "file_path": full_path,
                    "relative_path": rel_path,
                    "file_name": file,
                    "file_size": file_size,
                    "title": tags.get("title", ""),
                    "artist": tags.get("artist", ""),
                    "album": tags.get("album", ""),
                    "duration": round(tags.get("duration", 0.0), 1),
                    "current_genre": tags.get("genre", ""),
                    "parsed_preview": {
                        "title": parsed_preview.title,
                        "artist": parsed_preview.artist,
                        "junk": parsed_preview.junk,
                    },
                    "cached_genre": cached.get("genre") if cached else None,
                    "confidence": cached.get("confidence") if cached else None,
                    "source": cached.get("source") if cached else None,
                    "is_resolved": bool(cached or tags.get("genre")),
                })

    return tracks


def process_single_file(file_path: str) -> Dict[str, Any]:
    """
    Ejecuta el pipeline completo de Sonora sobre un archivo individual.
    """
    return resolve_genre(file_path)


def batch_process_library(directory_path: str) -> List[Dict[str, Any]]:
    """
    Procesa todos los archivos de audio de un directorio, resuelve sus géneros
    y actualiza las etiquetas con Mutagen.
    """
    tracks = scan_library(directory_path)
    results = []
    for t in tracks:
        res = resolve_genre(t["file_path"])
        results.append({
            "file_path": t["file_path"],
            "file_name": t["file_name"],
            "resolution": res,
        })
    return results


def organize_library_by_genre(
    source_dir: str,
    target_dir: Optional[str] = None,
    action: str = "copy",
) -> Dict[str, Any]:
    """
    Organiza los archivos de la biblioteca en subcarpetas clasificadas por género:
    ej: /destino/Pop/Go Beyond.mp3, /destino/Rock/Bohemian Rhapsody.mp3
    """
    src_p = Path(source_dir)
    dst_p = Path(target_dir) if target_dir else src_p / "Organized_By_Genre"
    dst_p.mkdir(parents=True, exist_ok=True)

    tracks = scan_library(source_dir)
    organized_counts: Dict[str, int] = {}
    details: List[Dict[str, str]] = []

    for t in tracks:
        # Resolver o tomar género ya resuelto
        res = resolve_genre(t["file_path"])
        genre_folder = res.get("genre") or "Unknown"
        # Limpiar caracteres ilegales en nombres de carpeta
        safe_genre = "".join(c for c in genre_folder if c.isalnum() or c in (" ", "-", "_")).strip() or "Unclassified"

        genre_dir = dst_p / safe_genre
        genre_dir.mkdir(parents=True, exist_ok=True)

        target_file = genre_dir / t["file_name"]
        if action == "move":
            shutil.move(t["file_path"], str(target_file))
        else:
            shutil.copy2(t["file_path"], str(target_file))

        organized_counts[safe_genre] = organized_counts.get(safe_genre, 0) + 1
        details.append({
            "original": t["file_path"],
            "target": str(target_file),
            "genre": safe_genre,
        })

    return {
        "status": "success",
        "target_directory": str(dst_p),
        "total_files": len(details),
        "genres_distribution": organized_counts,
        "details": details,
    }


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Comando no provisto"}))
        sys.exit(1)

    cmd = sys.argv[1]

    if cmd == "scan":
        path = sys.argv[2] if len(sys.argv) > 2 else "sonora_music_library"
        tracks = scan_library(path)
        print(json.dumps(tracks, ensure_ascii=False))

    elif cmd == "seed_demo":
        path = sys.argv[2] if len(sys.argv) > 2 else "sonora_music_library"
        tracks = seed_demo_library(path)
        print(json.dumps(tracks, ensure_ascii=False))

    elif cmd == "process_file":
        if len(sys.argv) < 3:
            print(json.dumps({"error": "Falta file_path"}))
            sys.exit(1)
        res = process_single_file(sys.argv[2])
        print(json.dumps(res, ensure_ascii=False))

    elif cmd == "batch_process":
        path = sys.argv[2] if len(sys.argv) > 2 else "sonora_music_library"
        results = batch_process_library(path)
        print(json.dumps(results, ensure_ascii=False))

    elif cmd == "organize":
        src = sys.argv[2] if len(sys.argv) > 2 else "sonora_music_library"
        dst = sys.argv[3] if len(sys.argv) > 3 else ""
        res = organize_library_by_genre(src, dst or None)
        print(json.dumps(res, ensure_ascii=False))

    else:
        print(json.dumps({"error": f"Comando desconocido: {cmd}"}))


if __name__ == "__main__":
    main()
