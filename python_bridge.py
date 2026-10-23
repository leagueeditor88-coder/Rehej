"""
Script Puente CLI para Sonora Web UI.
Permite ejecutar el pipeline de análisis desde la interfaz web o terminal y devolver JSON estructurado,
incluyendo escaneo de bibliotecas completas y generación de pistas de audio de muestra.
"""

import json
import os
import sys
from pathlib import Path
from cache import get_cached_genre, list_cached_entries, clear_all_cache
from smart_metadata_parser import SmartMetadataParser, scan_music_library
import mutagen
from mutagen.id3 import ID3, TIT2, TPE1, TALB, TCON

DEFAULT_LIBRARY_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "music_library")

def create_sample_mp3(file_path: str, title: str, artist: str, album: str = ""):
    """Crea un contenedor MP3 minimal con tags ID3 completos usando Mutagen."""
    os.makedirs(os.path.dirname(file_path), exist_ok=True)
    with open(file_path, "wb") as f:
        # Cabecera MP3 silenciosa (MPEG-1 Layer 3, 128kbps, 44.1kHz)
        header = b"\xff\xfb\x90\x64" + b"\x00" * 413
        f.write(header * 5)
    
    tags = ID3()
    tags.add(TIT2(encoding=3, text=title))
    tags.add(TPE1(encoding=3, text=artist))
    if album:
        tags.add(TALB(encoding=3, text=album))
    tags.save(file_path)

def seed_sample_library(library_dir: str = DEFAULT_LIBRARY_PATH) -> list:
    """Genera una biblioteca de audio realista para pruebas de Sonora con Mutagen."""
    os.makedirs(library_dir, exist_ok=True)
    sample_tracks = [
        {
            "filename": "Go Beyond Andy (HONOR Brand Song) 60 Andy Love.mp3",
            "title": "Go Beyond Andy (HONOR Brand Song) 60 Andy Love",
            "artist": "Andy Love",
            "album": "HONOR Global Campaign",
        },
        {
            "filename": "Coldplay ft. Beyoncé - Hymn for the Weekend (Official Video) [Remastered].mp3",
            "title": "Hymn for the Weekend (Official Video) [Remastered]",
            "artist": "Coldplay ft. Beyoncé",
            "album": "A Head Full of Dreams",
        },
        {
            "filename": "Daft Punk - One More Time [Official Audio HD] 128.mp3",
            "title": "One More Time [Official Audio HD] 128",
            "artist": "Daft Punk",
            "album": "Discovery",
        },
        {
            "filename": "Queen - Bohemian Rhapsody (Live at Wembley Stadium 1986).mp3",
            "title": "Bohemian Rhapsody (Live at Wembley Stadium 1986)",
            "artist": "Queen",
            "album": "Live at Wembley '86",
        },
        {
            "filename": "Miles Davis - So What (Original Jazz Master Cut).mp3",
            "title": "So What (Original Jazz Master Cut)",
            "artist": "Miles Davis",
            "album": "Kind of Blue",
        },
    ]

    created = []
    for item in sample_tracks:
        full_path = os.path.join(library_dir, item["filename"])
        create_sample_mp3(full_path, item["title"], item["artist"], item["album"])
        created.append({
            "filename": item["filename"],
            "path": full_path,
            "title": item["title"],
            "artist": item["artist"],
        })

    return created

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Falta comando"}))
        sys.exit(1)

    cmd = sys.argv[1]
    parser = SmartMetadataParser()

    if cmd == "parse_string":
        text = sys.argv[2] if len(sys.argv) > 2 else ""
        force_offline = sys.argv[3].lower() == "true" if len(sys.argv) > 3 else False

        parsed = parser.parse_track_string(text)
        normalized = parser.normalize_and_fuzzy_match(parsed)

        cached_entry = get_cached_genre(normalized.artist, normalized.title)
        
        if cached_entry:
            res_dict = {
                "title": cached_entry["title"],
                "artist": cached_entry["artist"],
                "junk": parsed.junk,
                "genre": cached_entry["genre"],
                "confidence": cached_entry["confidence"],
                "source": "sqlite_cache",
                "cached": True,
                "normalized_query": normalized.normalized_query,
            }
        elif force_offline:
            res_dict = {
                "title": parsed.title,
                "artist": parsed.artist,
                "junk": parsed.junk,
                "genre": "Sin conexión (No en caché)",
                "confidence": 0.0,
                "source": "offline_no_cache",
                "cached": False,
                "normalized_query": normalized.normalized_query,
            }
        else:
            res = parser.resolve_entity(normalized)
            parser.save_to_cache(
                artist=res.artist,
                title=res.title,
                genre=res.genre,
                confidence=res.confidence,
                source=res.source,
            )
            res_dict = {
                "title": res.title,
                "artist": res.artist,
                "junk": parsed.junk,
                "genre": res.genre,
                "confidence": round(res.confidence, 2),
                "source": res.source,
                "cached": False,
                "normalized_query": normalized.normalized_query,
            }

        print(json.dumps(res_dict, ensure_ascii=False))

    elif cmd == "analyze_file":
        if len(sys.argv) < 3:
            print(json.dumps({"error": "Falta la ruta del archivo"}))
            sys.exit(1)
        
        file_path = sys.argv[2]
        if not os.path.exists(file_path):
            print(json.dumps({"error": f"El archivo no existe en el sistema: {file_path}"}))
            sys.exit(1)

        # 1. Leer tags originales con Mutagen
        original_tags = parser.read_audio_tags(file_path)

        # 2. Parsear y normalizar
        text_to_parse = original_tags.get("title") or Path(file_path).stem
        if original_tags.get("artist") and original_tags["artist"] not in text_to_parse:
            text_to_parse = f"{original_tags['artist']} - {text_to_parse}"
        
        parsed = parser.parse_track_string(text_to_parse, fallback_artist=original_tags.get("artist", ""))
        normalized = parser.normalize_and_fuzzy_match(parsed)

        # 3. Ejecutar pipeline completo (resolución, caché y reescritura de tags en el archivo)
        result = parser.execute_pipeline(file_path)

        # 4. Verificar tags actualizados tras la escritura con Mutagen
        updated_tags = parser.read_audio_tags(file_path)

        output_payload = {
            "file_path": file_path,
            "file_name": os.path.basename(file_path),
            "file_size": os.path.getsize(file_path),
            "original_tags": original_tags,
            "parsed": {
                "title": parsed.title,
                "artist": parsed.artist,
                "junk": parsed.junk,
                "normalized_query": normalized.normalized_query,
            },
            "resolved": result,
            "updated_tags": updated_tags,
            "tag_written": updated_tags.get("genre") == result.get("genre"),
        }
        print(json.dumps(output_payload, ensure_ascii=False))

    elif cmd == "update_genre":
        if len(sys.argv) < 6:
            print(json.dumps({"error": "Faltan argumentos (file_path, artist, title, new_genre)"}))
            sys.exit(1)
        
        file_path = sys.argv[2]
        artist = sys.argv[3]
        title = sys.argv[4]
        new_genre = sys.argv[5].strip()

        # 1. Guardar en SQLite
        parser.save_to_cache(
            artist=artist,
            title=title,
            genre=new_genre,
            confidence=1.0,
            source="user_verified_override",
        )

        # 2. Escribir tag con Mutagen si el archivo existe
        written = False
        if os.path.exists(file_path):
            written = parser.write_genre_tag(file_path, new_genre)

        print(json.dumps({
            "success": True,
            "genre": new_genre,
            "file_path": file_path,
            "tag_written": written,
            "source": "user_verified_override",
            "confidence": 1.0,
        }, ensure_ascii=False))

    elif cmd == "scan_library":
        lib_dir = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2].strip() else DEFAULT_LIBRARY_PATH
        # Si la carpeta no existe o está vacía, sembrar pistas de prueba automáticamente
        if not os.path.exists(lib_dir) or not os.listdir(lib_dir):
            seed_sample_library(lib_dir)
        
        results = scan_music_library(lib_dir)
        print(json.dumps({
            "library_dir": lib_dir,
            "total_files": len(results),
            "tracks": results
        }, ensure_ascii=False))

    elif cmd == "seed_samples":
        lib_dir = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2].strip() else DEFAULT_LIBRARY_PATH
        created = seed_sample_library(lib_dir)
        print(json.dumps({"status": "seeded", "library_dir": lib_dir, "files": created}, ensure_ascii=False))

    elif cmd == "get_cache":
        entries = list_cached_entries()
        print(json.dumps(entries, ensure_ascii=False))

    elif cmd == "clear_cache":
        clear_all_cache()
        print(json.dumps({"status": "cleared"}))

    else:
        print(json.dumps({"error": f"Comando desconocido: {cmd}"}))

if __name__ == "__main__":
    main()
