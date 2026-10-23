/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Music,
  Disc3,
  Database,
  Cpu,
  CheckCircle2,
  AlertCircle,
  Play,
  RefreshCw,
  Trash2,
  Terminal,
  FileCode2,
  Sparkles,
  Layers,
  ArrowRight,
  Wifi,
  WifiOff,
  Filter,
  Check,
  FolderTree,
  Folder,
  FileAudio,
  FolderOpen,
  Info,
  ShieldCheck,
  Tag,
  ChevronRight,
  Upload,
  Download,
  FileUp,
  Search,
  ExternalLink,
  Globe,
  Edit3,
  CheckCheck
} from 'lucide-react';

interface ParseResult {
  title: string;
  artist: string;
  junk: string[];
  genre: string;
  confidence: number;
  source: string;
  cached: boolean;
  normalized_query?: string;
}

interface CacheEntry {
  cache_key: string;
  title: string;
  artist: string;
  genre: string;
  confidence: number;
  source: string;
  created_at: string;
  last_accessed: string;
}

interface LibraryTrack {
  file_name: string;
  file_path: string;
  extension: string;
  title: string;
  artist: string;
  genre: string;
  confidence: number;
  source: string;
  cached: boolean;
  error?: string;
}

interface LibraryResponse {
  library_dir: string;
  total_files: number;
  tracks: LibraryTrack[];
}

interface AnalyzedFileResult {
  file_path: string;
  file_name: string;
  file_size: number;
  original_tags: {
    title: string;
    artist: string;
    album: string;
    duration: number;
    genre: string;
  };
  parsed: {
    title: string;
    artist: string;
    junk: string[];
    normalized_query: string;
  };
  resolved: {
    title: string;
    artist: string;
    genre: string;
    confidence: number;
    source: string;
    cached: boolean;
  };
  updated_tags: {
    title: string;
    artist: string;
    album: string;
    duration: number;
    genre: string;
  };
  tag_written: boolean;
}

// Lista de géneros musicales estándar para corrección en 1 clic
const STANDARD_GENRES = [
  'Pop',
  'Rock',
  'Electrónica',
  'Hip Hop / Rap',
  'Reggaetón / Urbano',
  'R&B / Soul',
  'Jazz',
  'Salsa / Tropical',
  'Metal',
  'Clásica',
  'Indie / Alternativo',
  'Folk / Acústico',
  'Dance / House',
  'Blues',
  'Banda / Regional',
];

const PRESET_EXAMPLES = [
  {
    label: 'Caso Requerido: Honor Brand Song',
    input: 'Go Beyond Andy (HONOR Brand Song) 60 Andy Love',
    desc: 'Corte comercial de 60s, marca Honor entre paréntesis y compositor Pop Andy Love',
  },
  {
    label: 'Colaboración + Junk de Vídeo',
    input: 'Coldplay ft. Beyoncé - Hymn for the Weekend (Official Video) [Remastered]',
    desc: 'Featured artist con ft. y tags de vídeo oficial remasterizado',
  },
  {
    label: 'Daft Punk + BPM / Corte',
    input: 'Daft Punk - One More Time [Official Audio HD] 128',
    desc: 'Tags HD, corchetes y corte o BPM al final de la cadena',
  },
  {
    label: 'Queen Clásico en Vivo',
    input: 'Queen - Bohemian Rhapsody (Live at Wembley Stadium 1986)',
    desc: 'Versión en vivo con corchetes de concierto',
  },
  {
    label: 'Jazz Master Cut',
    input: 'Miles Davis - So What (Original Jazz Master Cut)',
    desc: 'Obra maestra de Jazz con etiquetas de masterización',
  },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<'library' | 'file_analyzer' | 'search_hub' | 'console' | 'cache' | 'code'>('library');

  // Estados de Cadena Individual
  const [inputString, setInputString] = useState<string>('Go Beyond Andy (HONOR Brand Song) 60 Andy Love');
  const [offlineMode, setOfflineMode] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [cacheList, setCacheList] = useState<CacheEntry[]>([]);
  const [testOutput, setTestOutput] = useState<string | null>(null);
  const [isRunningTest, setIsRunningTest] = useState<boolean>(false);

  // Estados de Biblioteca Musical
  const [libraryPath, setLibraryPath] = useState<string>('music_library');
  const [libraryData, setLibraryData] = useState<LibraryResponse | null>(null);
  const [isScanningLib, setIsScanningLib] = useState<boolean>(false);
  const [selectedGenreFilter, setSelectedGenreFilter] = useState<string>('all');
  const [selectedTrack, setSelectedTrack] = useState<LibraryTrack | null>(null);

  // Estados de Análisis de Archivo Físico
  const [fileToAnalyze, setFileToAnalyze] = useState<File | null>(null);
  const [isAnalyzingFile, setIsAnalyzingFile] = useState<boolean>(false);
  const [analyzedFileResult, setAnalyzedFileResult] = useState<AnalyzedFileResult | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Estados para Corrección Manual de Género
  const [isEditingGenre, setIsEditingGenre] = useState<boolean>(false);
  const [customGenreInput, setCustomGenreInput] = useState<string>('');
  const [isSavingGenre, setIsSavingGenre] = useState<boolean>(false);

  // Estados del Buscador de Música
  const [searchArtist, setSearchArtist] = useState<string>('Andy Love');
  const [searchTitle, setSearchTitle] = useState<string>('Go Beyond');

  useEffect(() => {
    loadCache();
    handleScanLibrary();
  }, []);

  const loadCache = async () => {
    try {
      const res = await fetch('/api/cache');
      if (res.ok) {
        const data = await res.json();
        setCacheList(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.warn('Error consultando caché:', err);
    }
  };

  const handleParse = async () => {
    if (!inputString.trim()) return;
    setIsLoading(true);
    setTestOutput(null);

    try {
      const res = await fetch('/api/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: inputString.trim(), offline: offlineMode }),
      });

      const data = await res.json();
      if (res.ok) {
        setResult(data);
        if (data.artist) setSearchArtist(data.artist);
        if (data.title) setSearchTitle(data.title);
        loadCache();
      } else {
        alert(data.error || 'Error al procesar la pista');
      }
    } catch (err) {
      alert('Error de conexión con el backend de Sonora');
    } finally {
      setIsLoading(false);
    }
  };

  const handleScanLibrary = async () => {
    setIsScanningLib(true);
    try {
      const res = await fetch('/api/library/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: libraryPath.trim() }),
      });

      const data = await res.json();
      if (res.ok) {
        setLibraryData(data);
        if (data.tracks && data.tracks.length > 0) {
          setSelectedTrack(data.tracks[0]);
          if (data.tracks[0].artist) setSearchArtist(data.tracks[0].artist);
          if (data.tracks[0].title) setSearchTitle(data.tracks[0].title);
        }
        loadCache();
      } else {
        alert(data.error || 'Error al escanear biblioteca');
      }
    } catch (err) {
      console.error('Error escaneando biblioteca:', err);
    } finally {
      setIsScanningLib(false);
    }
  };

  const handleSeedSamples = async () => {
    setIsScanningLib(true);
    try {
      await fetch('/api/library/seed-samples', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: libraryPath.trim() }),
      });
      await handleScanLibrary();
    } catch (err) {
      alert('Error generando pistas de prueba');
      setIsScanningLib(false);
    }
  };

  const handleAnalyzeUpload = async (file: File) => {
    setFileToAnalyze(file);
    setIsAnalyzingFile(true);
    setAnalyzedFileResult(null);

    try {
      const formData = new FormData();
      formData.append('audioFile', file);

      const res = await fetch('/api/analyze-file', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (res.ok) {
        setAnalyzedFileResult(data);
        if (data.parsed.artist) setSearchArtist(data.parsed.artist);
        if (data.parsed.title) setSearchTitle(data.parsed.title);
        loadCache();
      } else {
        alert(data.error || 'Error analizando archivo');
      }
    } catch (err) {
      alert('Error al enviar archivo al servidor de Sonora');
    } finally {
      setIsAnalyzingFile(false);
    }
  };

  const handleAnalyzeLibraryTrack = async (filePath: string) => {
    setIsAnalyzingFile(true);
    setActiveTab('file_analyzer');
    setAnalyzedFileResult(null);

    try {
      const res = await fetch('/api/analyze-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath }),
      });

      const data = await res.json();
      if (res.ok) {
        setAnalyzedFileResult(data);
        if (data.parsed.artist) setSearchArtist(data.parsed.artist);
        if (data.parsed.title) setSearchTitle(data.parsed.title);
        loadCache();
      } else {
        alert(data.error || 'Error analizando archivo');
      }
    } catch (err) {
      alert('Error de conexión con el motor de Sonora');
    } finally {
      setIsAnalyzingFile(false);
    }
  };

  // Función para corregir y guardar un nuevo género en SQLite y reescribir con Mutagen
  const handleUpdateGenre = async (newGenre: string) => {
    if (!newGenre.trim()) return;
    setIsSavingGenre(true);

    const targetArtist = analyzedFileResult?.parsed.artist || selectedTrack?.artist || searchArtist;
    const targetTitle = analyzedFileResult?.parsed.title || selectedTrack?.title || searchTitle;
    const targetFilePath = analyzedFileResult?.file_path || selectedTrack?.file_path || '';

    try {
      const res = await fetch('/api/library/update-genre', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: targetFilePath,
          artist: targetArtist,
          title: targetTitle,
          genre: newGenre.trim(),
        }),
      });

      const data = await res.json();
      if (res.ok) {
        // Actualizar en el analizador de archivos
        if (analyzedFileResult) {
          setAnalyzedFileResult({
            ...analyzedFileResult,
            resolved: {
              ...analyzedFileResult.resolved,
              genre: newGenre,
              confidence: 1.0,
              source: 'user_verified_override',
            },
            updated_tags: {
              ...analyzedFileResult.updated_tags,
              genre: newGenre,
            },
            tag_written: true,
          });
        }

        // Actualizar en la lista de la biblioteca
        if (selectedTrack) {
          setSelectedTrack({
            ...selectedTrack,
            genre: newGenre,
            confidence: 1.0,
            source: 'user_verified_override',
          });
        }

        // Actualizar resultado del parser de cadenas
        if (result) {
          setResult({
            ...result,
            genre: newGenre,
            confidence: 1.0,
            source: 'user_verified_override',
          });
        }

        setIsEditingGenre(false);
        setCustomGenreInput('');
        loadCache();
        // Recargar biblioteca para reflejar el cambio
        if (libraryPath) handleScanLibrary();
      } else {
        alert('Error al actualizar género');
      }
    } catch (err) {
      alert('Error de comunicación con el servidor');
    } finally {
      setIsSavingGenre(false);
    }
  };

  const handleRunPythonTest = async () => {
    setIsRunningTest(true);
    try {
      const res = await fetch('/api/run-test', { method: 'POST' });
      const data = await res.json();
      setTestOutput(data.output || data.error || 'Prueba finalizada sin salida');
      loadCache();
    } catch (err) {
      setTestOutput('Error ejecutando test suite en Python');
    } finally {
      setIsRunningTest(false);
    }
  };

  const handleClearCache = async () => {
    if (!confirm('¿Deseas vaciar la base de datos de caché SQLite?')) return;
    try {
      await fetch('/api/cache/clear', { method: 'POST' });
      setCacheList([]);
      if (libraryData) {
        handleScanLibrary();
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Abrir en buscadores externos
  const openInSearchEngine = (engine: 'google' | 'allmusic' | 'discogs' | 'musicbrainz' | 'wikipedia' | 'youtube') => {
    const artist = (analyzedFileResult?.parsed.artist || selectedTrack?.artist || searchArtist || '').trim();
    const title = (analyzedFileResult?.parsed.title || selectedTrack?.title || searchTitle || '').trim();
    const query = `${artist} ${title}`.trim();

    let url = '';
    switch (engine) {
      case 'google':
        url = `https://www.google.com/search?q=${encodeURIComponent('genero musical ' + query)}`;
        break;
      case 'allmusic':
        url = `https://www.allmusic.com/search/all/${encodeURIComponent(query)}`;
        break;
      case 'discogs':
        url = `https://www.discogs.com/search/?q=${encodeURIComponent(query)}&type=release`;
        break;
      case 'musicbrainz':
        url = `https://musicbrainz.org/search?query=${encodeURIComponent('recording:"' + title + '" AND artist:"' + artist + '"')}&type=recording`;
        break;
      case 'wikipedia':
        url = `https://es.wikipedia.org/wiki/Especial:Buscar?search=${encodeURIComponent(query + ' cancion')}`;
        break;
      case 'youtube':
        url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query + ' official audio')}`;
        break;
    }

    if (url) {
      window.open(url, '_blank');
    }
  };

  // Agrupar pistas por género
  const genreGroups: Record<string, LibraryTrack[]> = {};
  if (libraryData?.tracks) {
    libraryData.tracks.forEach((t) => {
      const g = t.genre || 'Desconocido';
      if (!genreGroups[g]) genreGroups[g] = [];
      genreGroups[g].push(t);
    });
  }

  const filteredTracks = libraryData?.tracks
    ? selectedGenreFilter === 'all'
      ? libraryData.tracks
      : libraryData.tracks.filter((t) => (t.genre || 'Desconocido') === selectedGenreFilter)
    : [];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Header */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-violet-600 to-amber-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Disc3 className="w-6 h-6 text-white animate-spin-slow" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-lg tracking-tight bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
                  Sonora
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 font-mono border border-indigo-500/20">
                  Smart Music Metadata Parser
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Extracción limpia de tags con Mutagen, consulta a buscadores y catálogos, y sincronización en disco
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto">
            <button
              onClick={() => setActiveTab('library')}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 shrink-0 ${
                activeTab === 'library'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              <FolderTree className="w-3.5 h-3.5" />
              Biblioteca ({libraryData?.total_files || 0})
            </button>
            <button
              onClick={() => setActiveTab('file_analyzer')}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 shrink-0 ${
                activeTab === 'file_analyzer'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              <FileUp className="w-3.5 h-3.5 text-amber-400" />
              Analizar Archivo
            </button>
            <button
              onClick={() => setActiveTab('search_hub')}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 shrink-0 ${
                activeTab === 'search_hub'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              <Globe className="w-3.5 h-3.5 text-emerald-400" />
              Buscadores de Música
            </button>
            <button
              onClick={() => setActiveTab('console')}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 shrink-0 ${
                activeTab === 'console'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              <Cpu className="w-3.5 h-3.5" />
              Parser de Cadenas
            </button>
            <button
              onClick={() => {
                setActiveTab('cache');
                loadCache();
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 shrink-0 ${
                activeTab === 'cache'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              <Database className="w-3.5 h-3.5" />
              Caché SQLite ({cacheList.length})
            </button>
            <button
              onClick={() => setActiveTab('code')}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 shrink-0 ${
                activeTab === 'code'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              <FileCode2 className="w-3.5 h-3.5" />
              Arquitectura
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 space-y-6">
        {/* Solution explanation banner about music search engines and crowd-sourced tags */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center shrink-0 text-amber-400 mt-0.5">
              <Globe className="w-5 h-5" />
            </div>
            <div className="space-y-1 text-xs leading-relaxed">
              <div className="flex items-center gap-2 flex-wrap">
                <strong className="text-white text-sm">
                  ¿Por qué fallan los catálogos y cómo "llevar el título a un buscador"?
                </strong>
                <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 text-[10px] font-mono border border-emerald-500/20">
                  Buscadores Directos + Corrección en 1 Clic
                </span>
              </div>
              <p className="text-slate-300">
                Las bases de datos abiertas como MusicBrainz o Discogs dependen de etiquetas colaborativas de usuarios que a menudo están <strong>vacías, incompletas o contienen micro-etiquetas extrañas</strong> (como <em>"trance core"</em> o <em>"happy"</em>).
                Para resolver esto, Sonora ahora te permite:
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 pt-1 text-[11px]">
                <div className="bg-slate-950 p-2 rounded-lg border border-slate-800 text-slate-300">
                  <span className="text-indigo-400 font-bold block mb-0.5">1. Enlace Directo a Buscadores</span>
                  Lleva con 1 clic el título limpio a Google, AllMusic, Discogs y Wikipedia.
                </div>
                <div className="bg-slate-950 p-2 rounded-lg border border-slate-800 text-slate-300">
                  <span className="text-emerald-400 font-bold block mb-0.5">2. Selector Rápido de Género</span>
                  Cambia al instante el género a Pop, Rock, Reggaetón, Jazz o Salsa desde badges rápidos.
                </div>
                <div className="bg-slate-950 p-2 rounded-lg border border-slate-800 text-slate-300">
                  <span className="text-amber-400 font-bold block mb-0.5">3. Sincronización Automática</span>
                  Al seleccionar el género, Mutagen reescribe el archivo físico y SQLite lo recuerda siempre.
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* TAB 1: HUB DE BUSCADORES DE MÚSICA ("LLEVAR A UN BUSCADOR") */}
        {activeTab === 'search_hub' && (
          <div className="space-y-6">
            <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-5">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Search className="w-5 h-5 text-indigo-400" />
                  Llevar el Título Limpio a Buscadores Especializados
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Sonora aísla el ruido y el artista con <code className="text-amber-300 font-mono">trackparse</code> para que puedas consultar el género auténtico en los mayores buscadores y bases de datos del mundo con un solo clic.
                </p>
              </div>

              {/* Input for manual search */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-950 p-4 rounded-xl border border-slate-800">
                <div>
                  <label className="text-xs font-semibold text-slate-400 block mb-1">Artista a Buscar:</label>
                  <input
                    type="text"
                    value={searchArtist}
                    onChange={(e) => setSearchArtist(e.target.value)}
                    placeholder="Ej: Andy Love, Coldplay, Daft Punk"
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-400 block mb-1">Título de la Canción:</label>
                  <input
                    type="text"
                    value={searchTitle}
                    onChange={(e) => setSearchTitle(e.target.value)}
                    placeholder="Ej: Go Beyond, One More Time"
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>
              </div>

              {/* Grid of Search Engines */}
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-3">
                  Buscadores Disponibles (Haz clic para abrir):
                </span>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {/* Google */}
                  <button
                    onClick={() => openInSearchEngine('google')}
                    className="p-4 rounded-xl bg-slate-950 border border-slate-800 hover:border-indigo-500/60 hover:bg-slate-900/80 transition-all text-left flex items-start justify-between group"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white text-sm">Google Search</span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 font-mono">
                          Recomendado
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1">
                        Búsqueda directa de ficha de conocimiento y género: <code className="text-slate-300">"género musical {searchArtist} {searchTitle}"</code>
                      </p>
                    </div>
                    <ExternalLink className="w-4 h-4 text-slate-500 group-hover:text-indigo-400 shrink-0 mt-1" />
                  </button>

                  {/* AllMusic */}
                  <button
                    onClick={() => openInSearchEngine('allmusic')}
                    className="p-4 rounded-xl bg-slate-950 border border-slate-800 hover:border-indigo-500/60 hover:bg-slate-900/80 transition-all text-left flex items-start justify-between group"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white text-sm">AllMusic Database</span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 font-mono">
                          Crítica & Estilos
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1">
                        La enciclopedia de crítica musical más respetada para géneros y estilos formales.
                      </p>
                    </div>
                    <ExternalLink className="w-4 h-4 text-slate-500 group-hover:text-amber-400 shrink-0 mt-1" />
                  </button>

                  {/* Discogs Web */}
                  <button
                    onClick={() => openInSearchEngine('discogs')}
                    className="p-4 rounded-xl bg-slate-950 border border-slate-800 hover:border-indigo-500/60 hover:bg-slate-900/80 transition-all text-left flex items-start justify-between group"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white text-sm">Discogs Web</span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-blue-500/20 text-blue-300 font-mono">
                          Vinilos & Singles
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1">
                        Búsqueda visual de lanzamientos, créditos de compositores y pistas en Discogs.
                      </p>
                    </div>
                    <ExternalLink className="w-4 h-4 text-slate-500 group-hover:text-blue-400 shrink-0 mt-1" />
                  </button>

                  {/* MusicBrainz Web */}
                  <button
                    onClick={() => openInSearchEngine('musicbrainz')}
                    className="p-4 rounded-xl bg-slate-950 border border-slate-800 hover:border-indigo-500/60 hover:bg-slate-900/80 transition-all text-left flex items-start justify-between group"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white text-sm">MusicBrainz Portal</span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-violet-500/20 text-violet-300 font-mono">
                          Base de Datos Abierta
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1">
                        Consulta grabaciones, obras de autor, ISWCs y etiquetas en la web de MusicBrainz.
                      </p>
                    </div>
                    <ExternalLink className="w-4 h-4 text-slate-500 group-hover:text-violet-400 shrink-0 mt-1" />
                  </button>

                  {/* Wikipedia */}
                  <button
                    onClick={() => openInSearchEngine('wikipedia')}
                    className="p-4 rounded-xl bg-slate-950 border border-slate-800 hover:border-indigo-500/60 hover:bg-slate-900/80 transition-all text-left flex items-start justify-between group"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white text-sm">Wikipedia</span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-500/20 text-slate-300 font-mono">
                          Ficha Técnica
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1">
                        Ficha infobox de la canción con el género oficial certificado.
                      </p>
                    </div>
                    <ExternalLink className="w-4 h-4 text-slate-500 group-hover:text-slate-300 shrink-0 mt-1" />
                  </button>

                  {/* YouTube */}
                  <button
                    onClick={() => openInSearchEngine('youtube')}
                    className="p-4 rounded-xl bg-slate-950 border border-slate-800 hover:border-indigo-500/60 hover:bg-slate-900/80 transition-all text-left flex items-start justify-between group"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white text-sm">YouTube Audio</span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-300 font-mono">
                          Audio Oficial
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1">
                        Escucha la pista para comprobar el género y ver la descripción del sello discográfico.
                      </p>
                    </div>
                    <ExternalLink className="w-4 h-4 text-slate-500 group-hover:text-rose-400 shrink-0 mt-1" />
                  </button>
                </div>
              </div>

              {/* One-Click Genre Assignment Section */}
              <div className="mt-6 pt-5 border-t border-slate-800 bg-slate-950/70 p-5 rounded-2xl border">
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <div>
                    <h4 className="text-sm font-bold text-white flex items-center gap-2">
                      <Tag className="w-4 h-4 text-amber-400" />
                      Asignar y Grabar Género Verificado en la Pista Actual
                    </h4>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Pista objetivo: <strong className="text-indigo-300">{searchArtist}</strong> — <strong className="text-white">{searchTitle}</strong>
                    </p>
                  </div>
                  <span className="text-[11px] text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20 font-mono">
                    Graba en Disco con Mutagen + SQLite
                  </span>
                </div>

                <div className="flex flex-wrap gap-2 mt-3">
                  {STANDARD_GENRES.map((g) => (
                    <button
                      key={g}
                      onClick={() => handleUpdateGenre(g)}
                      disabled={isSavingGenre}
                      className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-indigo-500 hover:bg-indigo-600/20 hover:text-indigo-300 text-xs font-medium text-slate-300 transition-all active:scale-95 disabled:opacity-50"
                    >
                      {g}
                    </button>
                  ))}
                </div>

                {/* Custom input */}
                <div className="mt-4 flex gap-2 max-w-md">
                  <input
                    type="text"
                    value={customGenreInput}
                    onChange={(e) => setCustomGenreInput(e.target.value)}
                    placeholder="O escribe otro género (ej. K-Pop, Synthwave, Trap)..."
                    className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
                  />
                  <button
                    onClick={() => handleUpdateGenre(customGenreInput)}
                    disabled={!customGenreInput.trim() || isSavingGenre}
                    className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow transition-all disabled:opacity-50"
                  >
                    {isSavingGenre ? 'Guardando...' : 'Asignar'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: ANALIZAR ARCHIVO ESPECÍFICO DE MI BIBLIOTECA */}
        {activeTab === 'file_analyzer' && (
          <div className="space-y-6">
            <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5 shadow-xl">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <FileAudio className="w-5 h-5 text-amber-400" />
                    Analizar Archivo de Audio de mi Biblioteca
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Sube un archivo de tu biblioteca musical o selecciona uno del disco para leer sus tags originales con Mutagen, resolver su género en catálogos y reescribir los metadatos en el archivo.
                  </p>
                </div>
              </div>

              {/* Upload Dropzone */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                    handleAnalyzeUpload(e.dataTransfer.files[0]);
                  }
                }}
                onClick={() => fileInputRef.current?.click()}
                className={`mt-4 border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${
                  isDragging
                    ? 'border-indigo-400 bg-indigo-950/30'
                    : 'border-slate-700 bg-slate-950/60 hover:border-indigo-500/60 hover:bg-slate-900/60'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".mp3,.flac,.m4a,.ogg,.wav,audio/*"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      handleAnalyzeUpload(e.target.files[0]);
                    }
                  }}
                  className="hidden"
                />

                <div className="max-w-md mx-auto space-y-3">
                  <div className="w-14 h-14 mx-auto rounded-2xl bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                    {isAnalyzingFile ? (
                      <RefreshCw className="w-7 h-7 animate-spin" />
                    ) : (
                      <Upload className="w-7 h-7" />
                    )}
                  </div>
                  <div>
                    <span className="text-sm font-semibold text-slate-200 block">
                      {isAnalyzingFile
                        ? 'Analizando archivo con Mutagen y Catálogos...'
                        : 'Haz clic para seleccionar o arrastra un archivo de tu biblioteca'}
                    </span>
                    <span className="text-xs text-slate-500 mt-1 block font-mono">
                      Formatos soportados: MP3, FLAC, M4A, OGG, WAV
                    </span>
                  </div>

                  {fileToAnalyze && (
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-800 text-xs text-indigo-300 font-mono">
                      <FileAudio className="w-3.5 h-3.5" />
                      {fileToAnalyze.name} ({(fileToAnalyze.size / 1024 / 1024).toFixed(2)} MB)
                    </div>
                  )}
                </div>
              </div>

              {/* Alternative: Select from existing library files */}
              {libraryData?.tracks && libraryData.tracks.length > 0 && (
                <div className="mt-4 pt-4 border-t border-slate-800">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-2">
                    O selecciona un archivo ya existente en tu biblioteca:
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {libraryData.tracks.map((t, idx) => (
                      <button
                        key={idx}
                        onClick={() => handleAnalyzeLibraryTrack(t.file_path)}
                        className="text-left p-2.5 rounded-xl bg-slate-950 border border-slate-800 hover:border-indigo-500/50 hover:bg-slate-900 transition-all text-xs flex items-center justify-between"
                      >
                        <div className="truncate mr-2">
                          <span className="font-semibold text-slate-200 block truncate">
                            {t.title || t.file_name}
                          </span>
                          <span className="text-slate-500 font-mono text-[11px] block truncate">
                            {t.file_name}
                          </span>
                        </div>
                        <span className="px-2 py-0.5 rounded bg-slate-800 text-[10px] text-amber-400 font-mono shrink-0">
                          Analizar
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Analysis Results Card */}
            {analyzedFileResult && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Left: Metadata Inspection Before & After */}
                <div className="lg:col-span-7 bg-slate-900/70 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-5">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                    <h4 className="font-semibold text-slate-200 text-sm flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-emerald-400" />
                      Diagnóstico del Archivo: Antes vs. Después (Mutagen)
                    </h4>
                    <span className="text-xs font-mono text-emerald-400 bg-emerald-500/10 px-2.5 py-0.5 rounded-full border border-emerald-500/20">
                      ✔ Tag de Género Reescribo en Disco
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Tags Originales */}
                    <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                      <span className="text-[11px] font-bold uppercase text-slate-400 tracking-wider flex items-center gap-1.5">
                        <Tag className="w-3.5 h-3.5 text-slate-500" />
                        Paso 1: Tags Leídos con Mutagen
                      </span>
                      <div className="space-y-1.5 text-xs">
                        <div>
                          <span className="text-slate-500">Título Tag:</span>
                          <p className="font-semibold text-slate-200 truncate">
                            {analyzedFileResult.original_tags.title || 'Sin tag de título'}
                          </p>
                        </div>
                        <div>
                          <span className="text-slate-500">Artista Tag:</span>
                          <p className="font-semibold text-slate-200 truncate">
                            {analyzedFileResult.original_tags.artist || 'Sin tag de artista'}
                          </p>
                        </div>
                        <div>
                          <span className="text-slate-500">Género Original:</span>
                          <p className="text-slate-400">
                            {analyzedFileResult.original_tags.genre || '(Vacío o no clasificado)'}
                          </p>
                        </div>
                        <div>
                          <span className="text-slate-500">Duración:</span>
                          <p className="text-slate-400 font-mono">
                            {analyzedFileResult.original_tags.duration
                              ? `${analyzedFileResult.original_tags.duration.toFixed(1)} segundos`
                              : '—'}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Tags Actualizados */}
                    <div className="bg-gradient-to-br from-indigo-950/40 via-slate-950 to-slate-950 p-4 rounded-xl border border-indigo-500/30 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold uppercase text-indigo-300 tracking-wider flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          Paso 6: Tags Reescribos con Mutagen
                        </span>
                        <button
                          onClick={() => setIsEditingGenre(!isEditingGenre)}
                          className="text-[11px] text-amber-400 hover:text-amber-300 flex items-center gap-1"
                        >
                          <Edit3 className="w-3 h-3" /> Cambiar
                        </button>
                      </div>
                      <div className="space-y-1.5 text-xs">
                        <div>
                          <span className="text-slate-400">Título Normalizado:</span>
                          <p className="font-semibold text-white truncate">
                            {analyzedFileResult.parsed.title}
                          </p>
                        </div>
                        <div>
                          <span className="text-slate-400">Artista Canónico:</span>
                          <p className="font-semibold text-white truncate">
                            {analyzedFileResult.parsed.artist}
                          </p>
                        </div>
                        <div>
                          <span className="text-slate-400">Género Grabado:</span>
                          <p className="font-bold text-amber-400 text-sm">
                            {analyzedFileResult.resolved.genre}
                          </p>
                        </div>
                        <div>
                          <span className="text-slate-400">Estado de Sincronización:</span>
                          <p className="text-emerald-400 font-mono text-[11px]">
                            Tag ID3/Vorbis grabado en el archivo físico
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Inline Genre Changer */}
                  {isEditingGenre && (
                    <div className="p-3.5 bg-slate-950 border border-amber-500/30 rounded-xl space-y-2">
                      <span className="text-xs font-semibold text-amber-300 block">
                        Selecciona el género correcto para este archivo:
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {STANDARD_GENRES.map((g) => (
                          <button
                            key={g}
                            onClick={() => handleUpdateGenre(g)}
                            className="px-2.5 py-1 rounded bg-slate-900 border border-slate-800 hover:border-amber-400 text-[11px] text-slate-200"
                          >
                            {g}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Ruido detectado */}
                  <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-2 flex items-center gap-1.5">
                      <Filter className="w-3.5 h-3.5 text-amber-400" />
                      Paso 2: Ruido Semántico Aislado por trackparse
                    </span>
                    {analyzedFileResult.parsed.junk && analyzedFileResult.parsed.junk.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {analyzedFileResult.parsed.junk.map((j, i) => (
                          <span
                            key={i}
                            className="px-2.5 py-1 rounded-md bg-amber-500/10 text-amber-300 font-mono text-xs border border-amber-500/20"
                          >
                            {j}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-slate-500 italic">No se detectó ruido publicitario en el archivo.</span>
                    )}
                  </div>
                </div>

                {/* Right: Catalog Resolution Details & External Search Links */}
                <div className="lg:col-span-5 bg-slate-900/70 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col justify-between space-y-4">
                  <div>
                    <h4 className="font-semibold text-slate-200 text-sm pb-3 border-b border-slate-800 flex items-center gap-2">
                      <Disc3 className="w-4 h-4 text-indigo-400" />
                      Resolución en Catálogos & Buscadores
                    </h4>

                    <div className="mt-4 space-y-4">
                      <div className="bg-gradient-to-br from-indigo-950/60 to-slate-950 border border-indigo-500/30 p-4 rounded-xl">
                        <div className="flex items-center justify-between text-xs text-indigo-300 font-medium">
                          <span>Género Musical Resuelto</span>
                          <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-200">
                            {analyzedFileResult.resolved.source}
                          </span>
                        </div>
                        <div className="text-2xl font-black text-white mt-1">
                          {analyzedFileResult.resolved.genre}
                        </div>

                        {/* Confidence Meter */}
                        <div className="mt-3">
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-slate-400">Puntuación de Confianza:</span>
                            <span className="font-mono font-bold text-emerald-400">
                              {(analyzedFileResult.resolved.confidence * 100).toFixed(0)}% ({analyzedFileResult.resolved.confidence.toFixed(2)})
                            </span>
                          </div>
                          <div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-500"
                              style={{ width: `${analyzedFileResult.resolved.confidence * 100}%` }}
                            />
                          </div>
                        </div>
                      </div>

                      {/* Quick external search buttons */}
                      <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-2">
                        <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-1 flex items-center gap-1.5">
                          <Search className="w-3.5 h-3.5 text-indigo-400" />
                          Consultar en un Buscador Externo:
                        </span>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            onClick={() => openInSearchEngine('google')}
                            className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs text-slate-200 flex items-center justify-between"
                          >
                            <span>Google Search</span>
                            <ExternalLink className="w-3 h-3 text-slate-500" />
                          </button>
                          <button
                            onClick={() => openInSearchEngine('allmusic')}
                            className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs text-slate-200 flex items-center justify-between"
                          >
                            <span>AllMusic</span>
                            <ExternalLink className="w-3 h-3 text-slate-500" />
                          </button>
                          <button
                            onClick={() => openInSearchEngine('discogs')}
                            className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs text-slate-200 flex items-center justify-between"
                          >
                            <span>Discogs Web</span>
                            <ExternalLink className="w-3 h-3 text-slate-500" />
                          </button>
                          <button
                            onClick={() => openInSearchEngine('musicbrainz')}
                            className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs text-slate-200 flex items-center justify-between"
                          >
                            <span>MusicBrainz</span>
                            <ExternalLink className="w-3 h-3 text-slate-500" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Download button */}
                  <div className="pt-4 border-t border-slate-800">
                    <a
                      href={`/api/download-file?path=${encodeURIComponent(analyzedFileResult.file_path)}`}
                      download
                      className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-medium text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20 transition-all"
                    >
                      <Download className="w-4 h-4" />
                      Descargar Archivo con Tag de Género Actualizado
                    </a>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: BIBLIOTECA MUSICAL COMPLETA */}
        {activeTab === 'library' && (
          <div className="space-y-6">
            {/* Library Control Bar */}
            <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5 shadow-xl">
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div className="flex-1 w-full">
                  <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block mb-1.5 flex items-center gap-1.5">
                    <FolderOpen className="w-4 h-4 text-indigo-400" />
                    Ruta del Directorio de la Biblioteca Musical en Disco:
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={libraryPath}
                      onChange={(e) => setLibraryPath(e.target.value)}
                      placeholder="Ej: music_library o /ruta/a/mi_musica"
                      className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm font-mono text-slate-100 focus:outline-none focus:border-indigo-500"
                    />
                    <button
                      onClick={handleScanLibrary}
                      disabled={isScanningLib}
                      className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs shadow-lg shadow-indigo-600/20 transition-all flex items-center gap-2 disabled:opacity-50"
                    >
                      {isScanningLib ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          Escaneando Tags con Mutagen...
                        </>
                      ) : (
                        <>
                          <RefreshCw className="w-4 h-4" />
                          Escanear y Clasificar Biblioteca
                        </>
                      )}
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-2 md:pt-5">
                  <button
                    onClick={handleSeedSamples}
                    disabled={isScanningLib}
                    className="px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition-colors flex items-center gap-1.5"
                    title="Crea archivos MP3 reales en la carpeta con metadatos de prueba (incluyendo Honor Brand Song)"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    Generar Pistas de Muestra en Disco
                  </button>
                </div>
              </div>
            </div>

            {/* Library Stats & Genres Folder Filter */}
            {libraryData && (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-xl flex items-center justify-between">
                  <div>
                    <span className="text-[11px] uppercase font-bold text-slate-400 tracking-wider block">
                      Total Pistas en Biblioteca
                    </span>
                    <span className="text-2xl font-black text-slate-100">{libraryData.total_files}</span>
                  </div>
                  <FileAudio className="w-8 h-8 text-indigo-400/40" />
                </div>

                <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-xl flex items-center justify-between">
                  <div>
                    <span className="text-[11px] uppercase font-bold text-slate-400 tracking-wider block">
                      Géneros Clasificados
                    </span>
                    <span className="text-2xl font-black text-amber-400">{Object.keys(genreGroups).length}</span>
                  </div>
                  <Tag className="w-8 h-8 text-amber-400/40" />
                </div>

                <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-xl flex items-center justify-between">
                  <div>
                    <span className="text-[11px] uppercase font-bold text-slate-400 tracking-wider block">
                      Confianza Media
                    </span>
                    <span className="text-2xl font-black text-emerald-400">
                      {libraryData.tracks.length > 0
                        ? (
                            (libraryData.tracks.reduce((acc, t) => acc + (t.confidence || 0), 0) /
                              libraryData.tracks.length) *
                            100
                          ).toFixed(0) + '%'
                        : '0%'}
                    </span>
                  </div>
                  <ShieldCheck className="w-8 h-8 text-emerald-400/40" />
                </div>

                <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-xl flex items-center justify-between">
                  <div>
                    <span className="text-[11px] uppercase font-bold text-slate-400 tracking-wider block">
                      Tags en Archivo (Mutagen)
                    </span>
                    <span className="text-sm font-semibold text-emerald-400 flex items-center gap-1 mt-1">
                      <Check className="w-4 h-4" /> 100% Sincronizados
                    </span>
                  </div>
                  <Folder className="w-8 h-8 text-emerald-400/40" />
                </div>
              </div>
            )}

            {/* Genre Filter Folders */}
            {Object.keys(genreGroups).length > 0 && (
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                <span className="text-xs font-semibold text-slate-400 flex items-center gap-1 shrink-0">
                  <FolderTree className="w-3.5 h-3.5 text-indigo-400" /> Carpetas de Género:
                </span>
                <button
                  onClick={() => setSelectedGenreFilter('all')}
                  className={`text-xs px-3 py-1.5 rounded-lg border transition-all shrink-0 ${
                    selectedGenreFilter === 'all'
                      ? 'bg-indigo-600 border-indigo-500 text-white font-semibold'
                      : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  Todos ({libraryData?.total_files})
                </button>
                {Object.entries(genreGroups).map(([genre, tracks]) => (
                  <button
                    key={genre}
                    onClick={() => setSelectedGenreFilter(genre)}
                    className={`text-xs px-3 py-1.5 rounded-lg border transition-all shrink-0 flex items-center gap-1.5 ${
                      selectedGenreFilter === genre
                        ? 'bg-indigo-600 border-indigo-500 text-white font-semibold'
                        : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <Folder className="w-3 h-3 text-amber-400" />
                    <span>{genre}</span>
                    <span className="px-1.5 py-0.2 rounded-full bg-slate-950/80 text-[10px] font-mono">
                      {tracks.length}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* Tracks Table and Details Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Tracks List (Left) */}
              <div className="lg:col-span-8 bg-slate-900/70 border border-slate-800 rounded-2xl p-5 shadow-xl">
                <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
                  <h3 className="font-semibold text-slate-200 text-sm flex items-center gap-2">
                    <Music className="w-4 h-4 text-indigo-400" />
                    Pistas Clasificadas ({filteredTracks.length})
                  </h3>
                  <span className="text-xs text-slate-400 font-mono">
                    Directorio: {libraryPath}
                  </span>
                </div>

                {filteredTracks.length > 0 ? (
                  <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                    {filteredTracks.map((track, idx) => {
                      const isSelected = selectedTrack?.file_path === track.file_path;
                      return (
                        <div
                          key={idx}
                          onClick={() => setSelectedTrack(track)}
                          className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                            isSelected
                              ? 'bg-indigo-950/40 border-indigo-500/60 shadow-md'
                              : 'bg-slate-950/60 border-slate-800/80 hover:bg-slate-800/40 hover:border-slate-700'
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-9 h-9 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0">
                              <FileAudio className="w-4 h-4 text-indigo-400" />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-slate-200 text-sm truncate">
                                  {track.title || track.file_name}
                                </span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 font-mono text-slate-400 uppercase">
                                  {track.extension}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
                                <span>{track.artist || 'Artista no especificado'}</span>
                                <span className="text-slate-600">•</span>
                                <span className="truncate text-slate-500 max-w-[220px]">
                                  {track.file_name}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <div className="text-right">
                              <span className="px-2.5 py-1 rounded-md bg-indigo-500/10 text-indigo-300 font-bold text-xs border border-indigo-500/20 block">
                                {track.genre}
                              </span>
                              <span className="text-[10px] font-mono text-emerald-400 mt-0.5 block">
                                {(track.confidence * 100).toFixed(0)}% conf
                              </span>
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAnalyzeLibraryTrack(track.file_path);
                              }}
                              className="px-2.5 py-1 rounded-lg bg-indigo-600/20 hover:bg-indigo-600 hover:text-white text-indigo-300 text-xs font-medium border border-indigo-500/30 transition-all flex items-center gap-1"
                              title="Inspeccionar tags y flujo Mutagen de este archivo"
                            >
                              <FileUp className="w-3.5 h-3.5" />
                              Analizar
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setSearchArtist(track.artist || '');
                                setSearchTitle(track.title || '');
                                setActiveTab('search_hub');
                              }}
                              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
                              title="Llevar a Buscadores de Música"
                            >
                              <Search className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="py-16 text-center text-slate-500">
                    <Music className="w-12 h-12 mx-auto mb-3 opacity-30 text-indigo-400" />
                    <p className="text-sm font-medium">No hay pistas cargadas en esta biblioteca</p>
                    <p className="text-xs text-slate-600 mt-1">
                      Presiona "Generar Pistas de Muestra en Disco" para crear archivos MP3 de prueba con tags Mutagen.
                    </p>
                  </div>
                )}
              </div>

              {/* Track Detail Card (Right) */}
              <div className="lg:col-span-4 bg-slate-900/70 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col justify-between">
                <div>
                  <h4 className="font-semibold text-slate-200 text-sm pb-3 border-b border-slate-800 flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    Inspección de Tags & Mutagen
                  </h4>

                  {selectedTrack ? (
                    <div className="mt-4 space-y-4">
                      <div>
                        <span className="text-[10px] font-bold uppercase text-slate-500 tracking-wider block">
                          Archivo en Disco
                        </span>
                        <span className="text-xs font-mono text-slate-300 break-all block mt-0.5">
                          {selectedTrack.file_path}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                          <span className="text-[10px] uppercase font-bold text-slate-500 block">Título Limpio</span>
                          <span className="text-xs font-semibold text-white block mt-0.5 truncate">
                            {selectedTrack.title}
                          </span>
                        </div>
                        <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                          <span className="text-[10px] uppercase font-bold text-slate-500 block">Artista</span>
                          <span className="text-xs font-semibold text-white block mt-0.5 truncate">
                            {selectedTrack.artist}
                          </span>
                        </div>
                      </div>

                      <div className="bg-gradient-to-br from-indigo-950/60 to-slate-950 p-3.5 rounded-xl border border-indigo-500/30">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold uppercase text-indigo-300 block">
                            Género Asignado
                          </span>
                          <button
                            onClick={() => {
                              setSearchArtist(selectedTrack.artist);
                              setSearchTitle(selectedTrack.title);
                              setActiveTab('search_hub');
                            }}
                            className="text-[11px] text-indigo-300 hover:text-white flex items-center gap-1"
                          >
                            <Search className="w-3 h-3" /> Buscar
                          </button>
                        </div>
                        <div className="text-xl font-black text-white mt-0.5">
                          {selectedTrack.genre}
                        </div>
                        <div className="flex items-center justify-between text-xs mt-2 pt-2 border-t border-indigo-500/20 text-indigo-200/80">
                          <span>Confianza: {(selectedTrack.confidence * 100).toFixed(0)}%</span>
                          <span className="font-mono text-[11px]">{selectedTrack.source}</span>
                        </div>
                      </div>

                      {/* Quick Genre Override for Selected Track */}
                      <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                        <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1.5">
                          ¿Género incorrecto? Cámbialo en 1 clic:
                        </span>
                        <div className="flex flex-wrap gap-1">
                          {['Pop', 'Rock', 'Electrónica', 'Hip Hop', 'Jazz', 'Salsa', 'Reggaetón'].map((g) => (
                            <button
                              key={g}
                              onClick={() => handleUpdateGenre(g)}
                              className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 hover:border-amber-400 hover:text-amber-300 text-[10px] text-slate-300"
                            >
                              {g}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-2 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-400">Paso 1 (Lectura Mutagen):</span>
                          <span className="text-emerald-400 font-mono">✔ Leído</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-400">Paso 5 (Caché SQLite):</span>
                          <span className="text-emerald-400 font-mono">
                            {selectedTrack.cached ? '✔ Desde Caché' : '✔ Almacenado'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-400">Paso 6 (Escritura Mutagen):</span>
                          <span className="text-emerald-400 font-mono">✔ Tag Actualizado</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="py-20 text-center text-slate-500 text-xs">
                      Selecciona una pista de la lista para ver su flujo completo.
                    </div>
                  )}
                </div>

                <div className="pt-4 border-t border-slate-800 text-[11px] text-slate-500 flex items-center justify-between">
                  <span>Formato compatible</span>
                  <span className="font-mono text-slate-400">ID3v2.4 / Vorbis / MP4</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: PARSER DE CADENAS INDIVIDUAL */}
        {activeTab === 'console' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Input & Controls (Left) */}
            <div className="lg:col-span-7 space-y-5">
              <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5 shadow-xl">
                <div className="flex items-center justify-between mb-4">
                  <label className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-indigo-400" />
                    Cadena o Tag de Entrada a Parsear
                  </label>
                  <button
                    onClick={() => setOfflineMode(!offlineMode)}
                    className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-all ${
                      offlineMode
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-sm'
                        : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                    }`}
                  >
                    {offlineMode ? <WifiOff className="w-3.5 h-3.5" /> : <Wifi className="w-3.5 h-3.5" />}
                    {offlineMode ? 'Modo Offline Forzado' : 'Modo Híbrido (Online/Caché)'}
                  </button>
                </div>

                <div className="relative">
                  <textarea
                    rows={3}
                    value={inputString}
                    onChange={(e) => setInputString(e.target.value)}
                    placeholder="Ej: Go Beyond Andy (HONOR Brand Song) 60 Andy Love"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all font-mono"
                  />
                </div>

                {/* Example pills */}
                <div className="mt-3">
                  <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-2">
                    Casos de Prueba Rápidos:
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {PRESET_EXAMPLES.map((ex, i) => (
                      <button
                        key={i}
                        onClick={() => setInputString(ex.input)}
                        className={`text-xs px-3 py-1.5 rounded-lg border text-left transition-all ${
                          inputString === ex.input
                            ? 'bg-indigo-600/20 border-indigo-500/50 text-indigo-300 font-medium'
                            : 'bg-slate-950/80 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                        }`}
                        title={ex.desc}
                      >
                        {ex.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Actions */}
                <div className="mt-5 flex items-center justify-between pt-4 border-t border-slate-800/80">
                  <button
                    onClick={handleRunPythonTest}
                    disabled={isRunningTest}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors border border-slate-700"
                  >
                    {isRunningTest ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Play className="w-3.5 h-3.5 text-amber-400" />
                    )}
                    Ejecutar `python3 smart_metadata_parser.py`
                  </button>

                  <button
                    onClick={handleParse}
                    disabled={isLoading}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-medium text-sm shadow-lg shadow-indigo-600/25 transition-all disabled:opacity-50"
                  >
                    {isLoading ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Resolviendo...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        Ejecutar Pipeline Sonora
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Terminal Logs output if test was run */}
              {testOutput && (
                <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 shadow-xl overflow-hidden">
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800 text-xs text-slate-400">
                    <span className="flex items-center gap-1.5 font-mono">
                      <Terminal className="w-3.5 h-3.5 text-amber-400" />
                      Salida de Consola (Python Test Suite `__main__`):
                    </span>
                    <button
                      onClick={() => setTestOutput(null)}
                      className="text-slate-500 hover:text-slate-300"
                    >
                      Cerrar
                    </button>
                  </div>
                  <pre className="text-xs font-mono text-emerald-400 overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-72 p-2">
                    {testOutput}
                  </pre>
                </div>
              )}
            </div>

            {/* Results (Right) */}
            <div className="lg:col-span-5 space-y-5">
              <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5 shadow-xl min-h-[380px] flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                    <h3 className="font-semibold text-slate-200 flex items-center gap-2 text-sm">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      Resultado de la Resolución de Metadatos
                    </h3>
                    {result && (
                      <span
                        className={`text-[11px] px-2.5 py-0.5 rounded-full font-medium ${
                          result.cached
                            ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                            : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                        }`}
                      >
                        {result.cached ? 'Caché SQLite (Offline)' : 'Catálogo Online'}
                      </span>
                    )}
                  </div>

                  {result ? (
                    <div className="mt-4 space-y-4">
                      {/* Title & Artist cards */}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-slate-950/70 border border-slate-800 p-3 rounded-xl">
                          <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block">
                            Título Resuelto
                          </span>
                          <span className="text-slate-100 font-semibold text-base block mt-0.5 truncate">
                            {result.title || '—'}
                          </span>
                        </div>
                        <div className="bg-slate-950/70 border border-slate-800 p-3 rounded-xl">
                          <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block">
                            Artista Resuelto
                          </span>
                          <span className="text-slate-100 font-semibold text-base block mt-0.5 truncate">
                            {result.artist || '—'}
                          </span>
                        </div>
                      </div>

                      {/* Genre & Confidence */}
                      <div className="bg-gradient-to-br from-indigo-950/40 via-slate-900 to-violet-950/40 border border-indigo-500/30 p-4 rounded-xl">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold text-indigo-300">
                            Género Musical Asignado
                          </span>
                          <span className="text-xs font-bold text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">
                            {result.source}
                          </span>
                        </div>
                        <div className="text-2xl font-black text-white tracking-wide">
                          {result.genre || 'Desconocido'}
                        </div>

                        {/* Confidence bar */}
                        <div className="mt-3">
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-slate-400">Puntuación de Confianza:</span>
                            <span
                              className={`font-mono font-bold ${
                                result.confidence >= 0.8
                                  ? 'text-emerald-400'
                                  : result.confidence >= 0.6
                                  ? 'text-amber-400'
                                  : 'text-rose-400'
                              }`}
                            >
                              {(result.confidence * 100).toFixed(0)}% ({result.confidence.toFixed(2)})
                            </span>
                          </div>
                          <div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${
                                result.confidence >= 0.8
                                  ? 'bg-gradient-to-r from-emerald-500 to-teal-400'
                                  : result.confidence >= 0.6
                                  ? 'bg-gradient-to-r from-amber-500 to-yellow-400'
                                  : 'bg-rose-500'
                              }`}
                              style={{ width: `${Math.min(100, Math.max(5, result.confidence * 100))}%` }}
                            />
                          </div>
                        </div>
                      </div>

                      {/* Search links button */}
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            setSearchArtist(result.artist);
                            setSearchTitle(result.title);
                            setActiveTab('search_hub');
                          }}
                          className="w-full py-2 px-3 rounded-xl bg-slate-950 border border-slate-800 hover:border-indigo-500 text-xs text-indigo-300 flex items-center justify-center gap-1.5 transition-all"
                        >
                          <Search className="w-3.5 h-3.5" />
                          Llevar a Buscadores de Música (Google, AllMusic...)
                        </button>
                      </div>

                      {/* Noise / Junk items extracted */}
                      <div className="bg-slate-950/70 border border-slate-800 p-3 rounded-xl">
                        <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-2 flex items-center gap-1.5">
                          <Filter className="w-3.5 h-3.5 text-amber-400" />
                          Ruido Semántico Filtrado (Junk):
                        </span>
                        {result.junk && result.junk.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {result.junk.map((j, idx) => (
                              <span
                                key={idx}
                                className="text-xs px-2.5 py-1 rounded-md bg-amber-500/10 text-amber-300 border border-amber-500/20 font-mono"
                              >
                                {j}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-slate-500 italic">No se detectó ruido en la cadena.</span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="my-auto py-12 text-center text-slate-500">
                      <Music className="w-12 h-12 mx-auto mb-3 opacity-30 text-indigo-400" />
                      <p className="text-sm font-medium">No hay resultado aún</p>
                      <p className="text-xs text-slate-600 mt-1">
                        Ingresa una cadena o selecciona un preset y presiona "Ejecutar Pipeline Sonora".
                      </p>
                    </div>
                  )}
                </div>

                {result && (
                  <div className="pt-3 border-t border-slate-800/80 text-[11px] text-slate-400 flex items-center justify-between">
                    <span className="flex items-center gap-1 text-emerald-400">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      Tags de audio listos para sincronización
                    </span>
                    <span className="text-slate-500">Paso 6 completado</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: SQLITE CACHE */}
        {activeTab === 'cache' && (
          <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 flex-wrap gap-3">
              <div>
                <h3 className="font-semibold text-slate-200 text-sm flex items-center gap-2">
                  <Database className="w-4 h-4 text-indigo-400" />
                  Registros en Caché Local SQLite (`sonora_cache.db`)
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Indexación por clave unificada `artista:::título` para resolución instantánea offline.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={loadCache}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors flex items-center gap-1"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Actualizar
                </button>
                <button
                  onClick={handleClearCache}
                  className="px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs font-medium transition-colors flex items-center gap-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Vaciar Caché
                </button>
              </div>
            </div>

            {cacheList.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 font-medium">
                      <th className="py-2.5 px-3">Artista</th>
                      <th className="py-2.5 px-3">Título</th>
                      <th className="py-2.5 px-3">Género</th>
                      <th className="py-2.5 px-3">Confianza</th>
                      <th className="py-2.5 px-3">Fuente</th>
                      <th className="py-2.5 px-3">Último Acceso</th>
                      <th className="py-2.5 px-3 text-right">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {cacheList.map((entry, idx) => (
                      <tr key={idx} className="hover:bg-slate-800/30 transition-colors">
                        <td className="py-2.5 px-3 font-semibold text-slate-200">{entry.artist}</td>
                        <td className="py-2.5 px-3 text-slate-300">{entry.title}</td>
                        <td className="py-2.5 px-3">
                          <span className="px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 font-medium border border-indigo-500/20">
                            {entry.genre}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-emerald-400">
                          {(entry.confidence * 100).toFixed(0)}%
                        </td>
                        <td className="py-2.5 px-3 text-slate-400 font-mono text-[11px]">{entry.source}</td>
                        <td className="py-2.5 px-3 text-slate-500 text-[11px] font-mono">
                          {entry.last_accessed ? new Date(entry.last_accessed).toLocaleTimeString() : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <button
                            onClick={() => {
                              setSearchArtist(entry.artist);
                              setSearchTitle(entry.title);
                              setActiveTab('search_hub');
                            }}
                            className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 inline-flex items-center gap-1 text-[10px]"
                            title="Llevar a buscadores"
                          >
                            <Search className="w-3 h-3" /> Buscar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-12 text-center text-slate-500 text-xs">
                La caché SQLite está vacía. Procesa alguna pista o escanea la biblioteca para persistir resultados.
              </div>
            )}
          </div>
        )}

        {/* TAB 6: ARQUITECTURA & DOCS */}
        {activeTab === 'code' && (
          <div className="space-y-4">
            <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5 shadow-xl">
              <h3 className="font-semibold text-slate-200 text-sm mb-2 flex items-center gap-2">
                <FileCode2 className="w-4 h-4 text-indigo-400" />
                Módulos Python Generados para Sonora
              </h3>
              <p className="text-xs text-slate-400 mb-4">
                El módulo cumple estrictamente con las directrices de Sonora. Todos los archivos están en la raíz del proyecto listos para ser importados o ejecutados via CLI:
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                  <div className="text-indigo-400 font-bold flex items-center gap-1.5">
                    <FileCode2 className="w-3.5 h-3.5" /> smart_metadata_parser.py
                  </div>
                  <p className="text-slate-400 font-sans text-xs">
                    Pipeline orquestador de 6 pasos. Expone <code className="text-amber-300">resolve_genre(file_path: str) &rarr; dict</code> y <code className="text-amber-300">scan_music_library(directory_path: str)</code> e incluye el bloque <code className="text-amber-300">if __name__ == '__main__':</code> con el caso de prueba Honor Brand Song.
                  </p>
                </div>

                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                  <div className="text-indigo-400 font-bold flex items-center gap-1.5">
                    <FileCode2 className="w-3.5 h-3.5" /> resolvers.py
                  </div>
                  <p className="text-slate-400 font-sans text-xs">
                    Consultas especializadas a <code className="text-amber-300">MusicBrainz</code> y <code className="text-amber-300">Discogs</code> con búsqueda bidireccional (artista→título y título→artista), validación independiente estricta de Artista y Título con RapidFuzz para prevenir falsos positivos, y perfil de compositores Pop internacionales como Andy Love.
                  </p>
                </div>

                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                  <div className="text-indigo-400 font-bold flex items-center gap-1.5">
                    <FileCode2 className="w-3.5 h-3.5" /> cache.py
                  </div>
                  <p className="text-slate-400 font-sans text-xs">
                    Capa de persistencia SQLite3 local indexada sobre <code className="text-amber-300">metadata_cache</code> con funciones <code className="text-amber-300">init_cache</code>, <code className="text-amber-300">get_cached_genre</code>, <code className="text-amber-300">set_cached_genre</code> e <code className="text-amber-300">invalidate_cache</code>.
                  </p>
                </div>

                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                  <div className="text-indigo-400 font-bold flex items-center gap-1.5">
                    <FileCode2 className="w-3.5 h-3.5" /> requirements.txt & README.md
                  </div>
                  <p className="text-slate-400 font-sans text-xs">
                    Definición de dependencias exactas (`trackparse`, `rapidfuzz`, `musicbrainzngs`, `discogs-client`, `mutagen`) y documentación integral en español sobre cómo integrarlo y probarlo.
                  </p>
                </div>
              </div>

              <div className="mt-5 p-4 bg-slate-950 rounded-xl border border-slate-800">
                <span className="text-xs font-semibold text-slate-300 block mb-2 font-sans">
                  Cómo ejecutar el módulo desde la terminal:
                </span>
                <pre className="text-xs font-mono text-emerald-400 bg-slate-900/80 p-3 rounded-lg overflow-x-auto">
{`# 1. Instalar dependencias requeridas
pip install -r requirements.txt

# 2. Ejecutar suite de prueba directa con el caso de prueba Honor Brand Song
python3 smart_metadata_parser.py`}
                </pre>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 py-3 text-center text-xs text-slate-500">
        Sonora Music Parser Engine • Mutagen, trackparse, RapidFuzz, MusicBrainz, Discogs & SQLite3
      </footer>
    </div>
  );
}
