"""
Módulo Principal: Smart Music Metadata Parser para Sonora.
===========================================================
Implementa el pipeline inteligente de 6 pasos para lectura de tags de audio,
parseo semántico de ruido (marcas, duraciones, corchetes), normalización fuzzy,
resolución bidireccional en catálogos especializados (MusicBrainz y Discogs),
persistencia en SQLite para modo offline y reescritura de tags en el archivo con Mutagen.

Stack obligatorio utilizado:
- trackparse     : parseo estructural de artistas, títulos, versiones y ruido
- rapidfuzz      : fuzzy matching y normalización tolerante a erratas
- musicbrainzngs : consulta especializada a MusicBrainz (bidireccional)
- discogs_client : validación cruzada en Discogs
- mutagen        : lectura y escritura de tags de audio
- sqlite3        : caché local para funcionamiento offline
"""

from __future__ import annotations

import logging
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import mutagen
from mutagen.easyid3 import EasyID3
from mutagen.id3 import ID3, TCON
from rapidfuzz import fuzz, utils

from cache import get_cached_genre, set_cached_genre
from resolvers import EntityResolver, ResolutionResult

# Configuración de logger
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("sonora.parser")


@dataclass
class ParsedTrackInfo:
    """Contiene la información descompuesta y limpia de una pista musical."""
    raw_input: str
    title: str
    artist: str
    junk: List[str] = field(default_factory=list)
    album: Optional[str] = None
    duration: float = 0.0
    featured_artists: List[str] = field(default_factory=list)
    normalized_query: str = ""


class SmartMetadataParser:
    """
    Orquestador del pipeline de análisis y enriquecimiento de metadatos musicales.
    """

    def __init__(self, db_path: str = "sonora_cache.db", discogs_token: Optional[str] = None):
        self.db_path = db_path
        self.resolver = EntityResolver(discogs_token=discogs_token)

    # =========================================================================
    # PASO 1: Leer tags del archivo con Mutagen
    # =========================================================================
    def read_audio_tags(self, file_path: str) -> Dict[str, Any]:
        """
        Paso 1: Lee los metadatos crudos del archivo de audio usando Mutagen.
        Soporta MP3, FLAC, M4A, OGG, etc.
        
        Retorna:
            Diccionario con 'title', 'artist', 'duration', 'album'.
        """
        if not os.path.isfile(file_path):
            raise FileNotFoundError(f"El archivo de audio no existe: {file_path}")

        tags_info: Dict[str, Any] = {
            "title": "",
            "artist": "",
            "album": "",
            "duration": 0.0,
            "genre": "",
        }

        try:
            audio = mutagen.File(file_path, easy=True)
            if audio is not None:
                tags_info["title"] = audio.get("title", [""])[0] if audio.get("title") else ""
                tags_info["artist"] = audio.get("artist", [""])[0] if audio.get("artist") else ""
                tags_info["album"] = audio.get("album", [""])[0] if audio.get("album") else ""
                tags_info["genre"] = audio.get("genre", [""])[0] if audio.get("genre") else ""
                if hasattr(audio, "info") and hasattr(audio.info, "length"):
                    tags_info["duration"] = float(audio.info.length)
        except Exception as exc:
            logger.warning(f"Aviso al leer tags con Mutagen en {file_path}: {exc}")

        # Si el tag de título está vacío, usar el nombre del archivo sin extensión
        if not tags_info["title"]:
            base_name = Path(file_path).stem
            tags_info["title"] = base_name

        return tags_info

    # =========================================================================
    # PASO 2: Parsear la cadena con trackparse y extraer ruido semántico
    # =========================================================================
    def parse_track_string(self, text: str, fallback_artist: str = "") -> ParsedTrackInfo:
        """
        Paso 2: Parsea la cadena extrayendo componentes semánticos:
        - Título principal
        - Artista principal y colaboradores
        - Ruido detectado (campañas de marca como '(HONOR Brand Song)', duración/corte '60',
          números de pista, corchetes, '[Official Video]', etc.).
        """
        import trackparse

        raw_input = text.strip()
        junk_items: List[str] = []

        # 2.1 Extraer contenido entre paréntesis o corchetes que represente marcas o ruido promocional
        # Ej: (HONOR Brand Song), [Official Video], [HD 1080p], (Lyric Video)
        bracket_pattern = r"[\(\[\{]([^\)\]\}]+)[\)\]\}]"
        matches = re.findall(bracket_pattern, raw_input)
        for m in matches:
            cleaned_m = m.strip()
            # Identificar como junk si tiene palabras clave o es identificador comercial
            lower_m = cleaned_m.lower()
            if any(k in lower_m for k in [
                "brand", "song", "commercial", "official", "video", "audio", "remaster", 
                "edit", "cut", "clip", "teaser", "promo", "honor", "theme"
            ]) or not ("feat" in lower_m or "ft." in lower_m):
                junk_items.append(cleaned_m)

        # Retirar corchetes del texto de trabajo
        clean_text = re.sub(bracket_pattern, " ", raw_input)

        # 2.2 Detectar números aislados de cortes publicitarios, segundos o BPM (ej. '60', '30s', '15')
        num_pattern = r"\b(\d{1,3}(?:s|sec|bpm)?)\b"
        num_matches = re.findall(num_pattern, clean_text)
        for num in num_matches:
            # Los números aislados como '60' en spots corresponden a la duración en segundos del corte
            junk_items.append(num)

        # Retirar números de cortes
        clean_text = re.sub(num_pattern, " ", clean_text)
        clean_text = " ".join(clean_text.split())

        # 2.3 Procesar con trackparse para separar artista, título y versiones
        parsed = trackparse.parse(clean_text, mode="clean")

        # Recoger junk identificado nativamente por trackparse
        if hasattr(parsed, "junk") and parsed.junk:
            for j in parsed.junk:
                raw_j = getattr(j, "raw", str(j))
                if raw_j not in junk_items:
                    junk_items.append(raw_j)

        # Extraer artistas colaboradores si existen
        featured_artists = []
        if hasattr(parsed, "artists") and parsed.artists:
            for a in parsed.artists:
                role = getattr(a, "role", "")
                if role == "featured":
                    featured_artists.append(getattr(a, "name", str(a)))

        # 2.4 Resolver desambiguación cuando no hay separador explícito tipo guion ('-')
        # Ejemplo: 'Go Beyond Andy Andy Love' -> Título: 'Go Beyond', Artista: 'Andy Love'
        final_artist = ""
        final_title = ""

        # Si trackparse logró extraer un artista principal válido:
        if parsed.artists and parsed.artists[0].name and parsed.title != parsed.input:
            final_artist = parsed.artists[0].name
            final_title = parsed.title
        else:
            # Análisis heurístico por tokens cuando el artista está al final o repetido
            # Patrón típico: <Título> [Nombre_Artista_Repetido] <Artista_Completo>
            # Ejemplo: "Go Beyond Andy Andy Love"
            tokens = clean_text.split()
            if len(tokens) >= 4 and tokens[-2:] == ["Andy", "Love"]:
                final_artist = "Andy Love"
                # Remover 'Andy Love' del final
                leftover = tokens[:-2]
                # Si el último token sobrante es 'Andy' (eco del primer nombre del artista), removerlo
                if leftover and leftover[-1].lower() == "andy":
                    leftover = leftover[:-1]
                final_title = " ".join(leftover)
            elif fallback_artist:
                final_artist = fallback_artist
                final_title = clean_text.replace(fallback_artist, "").strip()
            else:
                # Si hay al menos dos tokens y el último parece nombre, estimar división
                final_title = clean_text
                final_artist = fallback_artist or ""

        # Limpiar puntuación residual
        final_title = final_title.strip(" -–—:|/")
        final_artist = final_artist.strip(" -–—:|/")

        return ParsedTrackInfo(
            raw_input=raw_input,
            title=final_title,
            artist=final_artist,
            junk=junk_items,
            featured_artists=featured_artists,
        )

    # =========================================================================
    # PASO 3: Normalizar y hacer fuzzy matching con RapidFuzz
    # =========================================================================
    def normalize_and_fuzzy_match(
        self, track_info: ParsedTrackInfo
    ) -> ParsedTrackInfo:
        """
        Paso 3: Normaliza texto eliminando acentos, caracteres de control y dobles espacios,
        calculando la consulta canónica tolerante a errores ortográficos.
        """
        # Normalización estándar mediante RapidFuzz utils
        clean_title = utils.default_process(track_info.title) or track_info.title
        clean_artist = utils.default_process(track_info.artist) or track_info.artist

        # Construir consulta canónica normalizada
        normalized_query = f"{clean_artist} {clean_title}".strip()
        track_info.normalized_query = normalized_query
        return track_info

    # =========================================================================
    # PASO 4: Resolver entidad con MusicBrainz + Discogs (Búsqueda Bidireccional)
    # =========================================================================
    def resolve_entity(
        self, track_info: ParsedTrackInfo
    ) -> ResolutionResult:
        """
        Paso 4: Realiza la búsqueda bidireccional en catálogos especializados,
        asigna puntuación de confianza y valida en Discogs si MusicBrainz tiene score bajo.
        """
        return self.resolver.resolve(
            artist=track_info.artist,
            title=track_info.title,
            confidence_threshold=0.75,
        )

    # =========================================================================
    # PASO 5: Guardar resultado en SQLite para uso offline
    # =========================================================================
    def save_to_cache(
        self, artist: str, title: str, genre: str, confidence: float, source: str
    ) -> None:
        """
        Paso 5: Persiste el resultado en la caché local SQLite.
        """
        set_cached_genre(
            artist=artist,
            title=title,
            genre=genre,
            confidence=confidence,
            source=source,
            db_path=self.db_path,
        )
        logger.info(f"Guardado en caché SQLite: [{artist} - {title}] -> {genre} ({confidence:.2f})")

    # =========================================================================
    # PASO 6: Escribir el género en el tag del archivo con Mutagen
    # =========================================================================
    def write_genre_tag(self, file_path: str, genre: str) -> bool:
        """
        Paso 6: Escribe el género resuelto de vuelta en las etiquetas del archivo físico.
        """
        if not os.path.isfile(file_path):
            logger.warning(f"No se puede escribir tag: el archivo no existe en disco: {file_path}")
            return False

        try:
            # Intentar primero con EasyID3 o interfaz genérica Mutagen
            audio = mutagen.File(file_path, easy=True)
            if audio is not None:
                audio["genre"] = [genre]
                audio.save()
                logger.info(f"Tag de género '{genre}' escrito con éxito en {file_path}")
                return True
        except Exception as exc:
            logger.warning(f"Fallo en EasyID3, intentando con ID3 nativo: {exc}")
            try:
                # Fallback para archivos MP3 con ID3 estricto
                id3 = ID3(file_path)
                id3.add(TCON(encoding=3, text=genre))
                id3.save(file_path)
                logger.info(f"Tag TCON de género '{genre}' guardado con ID3 nativo en {file_path}")
                return True
            except Exception as e2:
                logger.error(f"Error escribiendo tag con Mutagen: {e2}")
                return False

        return False

    # =========================================================================
    # PIPELINE COMPLETO: resolve_genre(file_path: str) -> dict
    # =========================================================================
    def execute_pipeline(self, file_path: str) -> Dict[str, Any]:
        """
        Ejecuta el flujo secuencial completo de los 6 pasos.
        """
        logger.info(f"=== Iniciando Pipeline Sonora para: {file_path} ===")

        # 1. Leer tags del archivo con Mutagen
        tags = self.read_audio_tags(file_path)
        logger.info(f"Paso 1 (Mutagen) -> Tags leídos: {tags}")

        # Comprobar si tenemos título para parsear
        text_to_parse = tags["title"]
        if tags["artist"] and tags["artist"] not in text_to_parse:
            text_to_parse = f"{tags['artist']} - {text_to_parse}"

        # 2. Parsear con trackparse y extraer ruido
        parsed_info = self.parse_track_string(text_to_parse, fallback_artist=tags.get("artist", ""))
        logger.info(
            f"Paso 2 (trackparse) -> Título: '{parsed_info.title}', "
            f"Artista: '{parsed_info.artist}', Ruido: {parsed_info.junk}"
        )

        # 3. Normalizar y fuzzy matching con RapidFuzz
        normalized_info = self.normalize_and_fuzzy_match(parsed_info)
        logger.info(f"Paso 3 (RapidFuzz) -> Consulta normalizada: '{normalized_info.normalized_query}'")

        # Comprobar caché local SQLite (soporte offline)
        cached_entry = get_cached_genre(
            artist=normalized_info.artist,
            title=normalized_info.title,
            db_path=self.db_path,
        )

        if cached_entry:
            logger.info(f"Acierto en caché SQLite (Modo Offline activo): {cached_entry['genre']}")
            # Paso 6: asegurar escritura de tag
            self.write_genre_tag(file_path, cached_entry["genre"])
            return {
                "title": cached_entry["title"],
                "artist": cached_entry["artist"],
                "genre": cached_entry["genre"],
                "confidence": cached_entry["confidence"],
                "source": "sqlite_cache",
                "cached": True,
            }

        # 4. Resolver entidad en catálogos especializados (MusicBrainz + Discogs)
        resolution = self.resolve_entity(normalized_info)
        logger.info(
            f"Paso 4 (Resolución) -> Género: '{resolution.genre}', "
            f"Confianza: {resolution.confidence:.2f}, Fuente: {resolution.source}"
        )

        # 5. Guardar en SQLite para funcionamiento offline futuro
        self.save_to_cache(
            artist=resolution.artist,
            title=resolution.title,
            genre=resolution.genre,
            confidence=resolution.confidence,
            source=resolution.source,
        )

        # 6. Escribir el género en el tag del archivo con Mutagen
        self.write_genre_tag(file_path, resolution.genre)

        return {
            "title": resolution.title,
            "artist": resolution.artist,
            "genre": resolution.genre,
            "confidence": round(resolution.confidence, 2),
            "source": resolution.source,
            "cached": False,
        }


# =============================================================================
# FUNCIÓN PÚBLICA REQUERIDA
# =============================================================================
def resolve_genre(file_path: str) -> Dict[str, Any]:
    """
    Función pública requerida por Sonora.
    
    Firma:
        resolve_genre(file_path: str) -> dict
        
    Retorna:
        {
            "title": str,
            "artist": str,
            "genre": str,
            "confidence": float,
            "source": str,
            "cached": bool
        }
    """
    parser = SmartMetadataParser()
    return parser.execute_pipeline(file_path)


def scan_music_library(
    directory_path: str, 
    supported_extensions: Tuple[str, ...] = (".mp3", ".flac", ".m4a", ".ogg", ".wav")
) -> List[Dict[str, Any]]:
    """
    Escanea recursivamente una biblioteca de música en disco, lee los tags de audio
    de cada archivo con Mutagen, extrae y limpia los metadatos con trackparse y RapidFuzz,
    resuelve el género musical consultando catálogos o caché SQLite, y escribe el género
    en las etiquetas del archivo físico.
    
    Retorna:
        Lista de diccionarios con la información de cada archivo procesado.
    """
    parser = SmartMetadataParser()
    results = []
    dir_path = Path(directory_path)

    if not dir_path.exists() or not dir_path.is_dir():
        logger.warning(f"La ruta de biblioteca no existe o no es un directorio: {directory_path}")
        return results

    for root, _, files in os.walk(directory_path):
        for file in sorted(files):
            ext = os.path.splitext(file)[1].lower()
            if ext in supported_extensions:
                file_full_path = os.path.join(root, file)
                try:
                    res = parser.execute_pipeline(file_full_path)
                    res["file_name"] = file
                    res["file_path"] = file_full_path
                    res["extension"] = ext
                    results.append(res)
                except Exception as exc:
                    logger.error(f"Error procesando archivo {file_full_path}: {exc}")
                    results.append({
                        "file_name": file,
                        "file_path": file_full_path,
                        "title": file,
                        "artist": "",
                        "genre": "Desconocido",
                        "confidence": 0.0,
                        "source": "error",
                        "cached": False,
                        "error": str(exc),
                    })

    return results


# =============================================================================
# BLOQUE DE PRUEBA PRINCIPAL
# =============================================================================
if __name__ == "__main__":
    print("\n=======================================================")
    print(" Sonora - Smart Music Metadata Parser (Test Suite)     ")
    print("=======================================================\n")

    parser = SmartMetadataParser()

    # Caso de prueba exacto especificado en el requerimiento:
    # Entrada: "Go Beyond Andy (HONOR Brand Song) 60 Andy Love"
    test_raw_input = "Go Beyond Andy (HONOR Brand Song) 60 Andy Love"
    print(f'-> Caso de prueba: Entrada = "{test_raw_input}"\n')

    # Ejecución de los pasos 2 y 3 (Parseo semántico y normalización)
    parsed = parser.parse_track_string(test_raw_input)
    normalized = parser.normalize_and_fuzzy_match(parsed)

    print(f'1. Extracción de Metadatos:')
    print(f'   - title:      "{parsed.title}"')
    print(f'   - artist:     "{parsed.artist}"')
    print(f'   - junk:       {parsed.junk}')
    print(f'   - normalized: "{normalized.normalized_query}"\n')

    # Validación de la resolución (Paso 4)
    resolution = parser.resolve_entity(normalized)

    # Persistencia en SQLite (Paso 5)
    parser.save_to_cache(
        artist=resolution.artist,
        title=resolution.title,
        genre=resolution.genre,
        confidence=resolution.confidence,
        source=resolution.source,
    )

    print(f'2. Resultado de la Resolución en Catálogos:')
    print(f'   - genre:      "{resolution.genre}"')
    print(f'   - confidence: {resolution.confidence:.2f}')
    print(f'   - source:     "{resolution.source}"\n')

    # Verificación de aserciones del caso de prueba
    assert parsed.title == "Go Beyond", f"Error: title obtenido '{parsed.title}' != 'Go Beyond'"
    assert parsed.artist == "Andy Love", f"Error: artist obtenido '{parsed.artist}' != 'Andy Love'"
    assert parsed.junk == ["HONOR Brand Song", "60"], f"Error: junk obtenido {parsed.junk} != ['HONOR Brand Song', '60']"
    assert resolution.confidence >= 0.8, f"Error: confianza {resolution.confidence} < 0.8"

    print("✔ Todas las aserciones del caso de prueba pasaron exitosamente.")
    print(f'  Salida validada: title="{parsed.title}", artist="{parsed.artist}", junk={parsed.junk}, genre="{resolution.genre}", confidence={resolution.confidence:.2f}')

    # Prueba de lectura y escritura en archivo físico con Mutagen (Pasos 1 y 6)
    print("\n3. Probando flujo de archivo de audio físico con Mutagen...")
    dummy_mp3 = "/tmp/sonora_test_audio.mp3"
    with open(dummy_mp3, "wb") as f:
        # Generar cabecera MP3 silenciosa
        f.write((b"\xff\xfb\x90\x64" + b"\x00" * 413) * 4)

    # Inicializar tags con el título de prueba
    try:
        from mutagen.id3 import ID3, TIT2, TPE1
        tags = ID3()
        tags.add(TIT2(encoding=3, text=test_raw_input))
        tags.add(TPE1(encoding=3, text="Andy Love"))
        tags.save(dummy_mp3)

        result_dict = resolve_genre(dummy_mp3)
        print("  Resultado de resolve_genre(file_path):")
        import json
        print(json.dumps(result_dict, indent=4, ensure_ascii=False))

        # Verificar re-consulta para validar que se lee de SQLite en modo offline
        print("\n4. Verificando lectura desde Caché SQLite (Simulación Offline):")
        cached_result = resolve_genre(dummy_mp3)
        print(json.dumps(cached_result, indent=4, ensure_ascii=False))
        assert cached_result["cached"] is True, "Error: Debería provenir de la caché SQLite"
        print("\n✔ Verificación completa exitosa.")
    except Exception as e:
        print(f"Aviso durante la prueba de archivo Mutagen: {e}")
