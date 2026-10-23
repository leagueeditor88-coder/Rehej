"""
Módulo de Caché Local SQLite para Sonora - Smart Music Metadata Parser.
Permite el almacenamiento y recuperación offline de resoluciones de género musical.
"""

from __future__ import annotations

import datetime
import os
import sqlite3
from typing import Any, Dict, List, Optional


def get_db_connection(db_path: str = "sonora_cache.db") -> sqlite3.Connection:
    """
    Obtiene una conexión a la base de datos SQLite con formato de fila accesible por clave.
    """
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def init_cache(db_path: str = "sonora_cache.db") -> None:
    """
    Inicializa la base de datos SQLite y crea la tabla e índices si no existen.
    
    Esquema:
    - cache_key: Clave unificada (normalizada: artista:::título)
    - title: Título normalizado de la pista
    - artist: Artista principal normalizado
    - genre: Género musical resuelto
    - confidence: Puntuación de confianza (0.0 a 1.0)
    - source: Fuente ('musicbrainz', 'discogs', 'cross_validated', etc.)
    - created_at: Timestamp ISO-8601 de inserción
    - last_accessed: Timestamp ISO-8601 del último acceso
    """
    with get_db_connection(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS metadata_cache (
                cache_key TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                artist TEXT NOT NULL,
                genre TEXT NOT NULL,
                confidence REAL NOT NULL,
                source TEXT NOT NULL,
                created_at TEXT NOT NULL,
                last_accessed TEXT NOT NULL
            );
            """
        )
        cursor.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_cache_artist_title 
            ON metadata_cache (artist, title);
            """
        )
        cursor.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_cache_genre 
            ON metadata_cache (genre);
            """
        )
        conn.commit()


def make_cache_key(artist: str, title: str) -> str:
    """
    Genera una clave canónica normalizada para búsqueda en caché.
    """
    clean_artist = " ".join((artist or "").strip().lower().split())
    clean_title = " ".join((title or "").strip().lower().split())
    return f"{clean_artist}:::{clean_title}"


def get_cached_genre(
    artist: str, 
    title: str, 
    db_path: str = "sonora_cache.db"
) -> Optional[Dict[str, Any]]:
    """
    Recupera el género y metadatos cacheados para una tupla (artista, título).
    Actualiza la fecha de último acceso si se encuentra el registro.
    
    Retorna:
        Dict con los datos o None si no existe en la caché.
    """
    init_cache(db_path)
    key = make_cache_key(artist, title)
    now = datetime.datetime.utcnow().isoformat()

    with get_db_connection(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT title, artist, genre, confidence, source, created_at, last_accessed
            FROM metadata_cache
            WHERE cache_key = ?
            """,
            (key,),
        )
        row = cursor.fetchone()

        if row:
            cursor.execute(
                """
                UPDATE metadata_cache
                SET last_accessed = ?
                WHERE cache_key = ?
                """,
                (now, key),
            )
            conn.commit()
            return {
                "title": row["title"],
                "artist": row["artist"],
                "genre": row["genre"],
                "confidence": float(row["confidence"]),
                "source": row["source"],
                "cached": True,
                "created_at": row["created_at"],
                "last_accessed": now,
            }

    return None


def set_cached_genre(
    artist: str,
    title: str,
    genre: str,
    confidence: float,
    source: str,
    db_path: str = "sonora_cache.db",
) -> None:
    """
    Inserta o actualiza una entrada en la caché local SQLite.
    """
    init_cache(db_path)
    key = make_cache_key(artist, title)
    now = datetime.datetime.utcnow().isoformat()

    with get_db_connection(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO metadata_cache (
                cache_key, title, artist, genre, confidence, source, created_at, last_accessed
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(cache_key) DO UPDATE SET
                genre = excluded.genre,
                confidence = excluded.confidence,
                source = excluded.source,
                last_accessed = excluded.last_accessed
            """,
            (key, title.strip(), artist.strip(), genre.strip(), float(confidence), source, now, now),
        )
        conn.commit()


def invalidate_cache(
    artist: Optional[str] = None,
    title: Optional[str] = None,
    db_path: str = "sonora_cache.db",
) -> int:
    """
    Invalida entradas de la caché.
    Si se especifican artista y título, elimina la coincidencia exacta.
    Si solo se pasa artista, elimina todas las pistas de dicho artista.
    Si no se pasan argumentos, no elimina nada (use clear_all_cache).
    
    Retorna:
        Número de filas eliminadas.
    """
    init_cache(db_path)
    with get_db_connection(db_path) as conn:
        cursor = conn.cursor()
        if artist and title:
            key = make_cache_key(artist, title)
            cursor.execute("DELETE FROM metadata_cache WHERE cache_key = ?", (key,))
        elif artist:
            clean_artist = " ".join(artist.strip().lower().split())
            cursor.execute(
                "DELETE FROM metadata_cache WHERE lower(artist) = ?", (clean_artist,)
            )
        elif title:
            clean_title = " ".join(title.strip().lower().split())
            cursor.execute(
                "DELETE FROM metadata_cache WHERE lower(title) = ?", (clean_title,)
            )
        else:
            return 0
        deleted = cursor.rowcount
        conn.commit()
        return deleted


def list_cached_entries(
    db_path: str = "sonora_cache.db", 
    limit: int = 100
) -> List[Dict[str, Any]]:
    """
    Devuelve las entradas de la caché ordenadas por último acceso descendente.
    """
    init_cache(db_path)
    with get_db_connection(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT cache_key, title, artist, genre, confidence, source, created_at, last_accessed
            FROM metadata_cache
            ORDER BY last_accessed DESC
            LIMIT ?
            """,
            (limit,),
        )
        rows = cursor.fetchall()
        return [
            {
                "cache_key": row["cache_key"],
                "title": row["title"],
                "artist": row["artist"],
                "genre": row["genre"],
                "confidence": float(row["confidence"]),
                "source": row["source"],
                "created_at": row["created_at"],
                "last_accessed": row["last_accessed"],
            }
            for row in rows
        ]


def clear_all_cache(db_path: str = "sonora_cache.db") -> None:
    """
    Elimina todos los registros de la caché SQLite.
    """
    init_cache(db_path)
    with get_db_connection(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM metadata_cache")
        conn.commit()
