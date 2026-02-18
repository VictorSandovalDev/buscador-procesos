'use client';

import { useState, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { Upload, Search, FileSpreadsheet, Loader2, AlertCircle, FileDown, CheckSquare, Square, Trash2 } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { saveAs } from 'file-saver';

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

interface SearchResult {
    sheetName: string;
    rowIndex: number;
    data: any[];
    id: string; // Unique ID for selection matching
    context?: string; // Juzgado / Header context
    stateContext?: string; // Estado / Fecha context (e.g., "ESTADO 18 DEL 10 FEBRERO 2026")
}

export default function Home() {
    const [file, setFile] = useState<File | null>(null);
    const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [results, setResults] = useState<SearchResult[]>([]);
    const [hasSearched, setHasSearched] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Store full objects to persist selection across searches
    const [selectedItems, setSelectedItems] = useState<Map<string, SearchResult>>(new Map());

    const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        if (!selectedFile) return;

        setFile(selectedFile);
        setIsLoading(true);
        setError(null);
        setWorkbook(null);
        setResults([]);
        setHasSearched(false);
        setSelectedItems(new Map()); // Clear selection on new file

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = e.target?.result;
                const wb = XLSX.read(data, { type: 'binary' });
                setWorkbook(wb);
            } catch (err) {
                console.error("Error parsing Excel file:", err);
                setError("Error al leer el archivo Excel. Asegúrate de que es un archivo válido.");
            } finally {
                setIsLoading(false);
            }
        };
        reader.readAsBinaryString(selectedFile);
    }, []);

    const handleSearch = useCallback(() => {
        if (!workbook || !searchTerm.trim()) return;

        setIsLoading(true);
        setHasSearched(true);
        // Note: We intentionally do NOT clear selectedItems here to persist selections

        const term = searchTerm.toLowerCase();
        const newResults: SearchResult[] = [];

        workbook.SheetNames.forEach(sheetName => {
            const sheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as any[][];

            let currentContext = '';
            let currentStateContext = '';

            jsonData.forEach((row, rowIndex) => {
                // Heuristic: Identify "Juzgado" headers
                const firstCell = row[0];
                const secondCell = row[1];

                if (firstCell && typeof firstCell === 'string' && (!secondCell || secondCell.toString().trim() === '')) {
                    // Normalize: remove all spaces to check for keywords
                    const text = firstCell.toString().toUpperCase().replace(/\s+/g, '');
                    // Keywords that strongly suggest a court header (e.g. "S E P T I M O   C I V I L")
                    const isCourtHeader =
                        text.includes('CIRCUITO') ||
                        text.includes('MUNICIPAL') ||
                        text.includes('TRIBUNAL') ||
                        text.includes('JUZGADO') ||
                        text.includes('CONSEJO') ||
                        text.includes('SUPREMA') ||
                        text.includes('SALA') ||
                        text.includes('FAMILIA') ||
                        text.includes('LABORAL') ||
                        text.includes('ADMINISTRATIVO') ||
                        text.includes('PROMISCUO') ||
                        text.includes('CIVIL') ||
                        text.includes('PEQUEÑAS') ||
                        text.includes('CAUSAS') ||
                        text.includes('JUEZ') ||
                        text.includes('DESPACHO') ||
                        text.includes('PRIMERO') ||
                        text.includes('SEGUNDO') ||
                        text.includes('TERCERO') ||
                        text.includes('CUARTO') ||
                        text.includes('QUINTO') ||
                        text.includes('SEXTO') ||
                        text.includes('SEPTIMO') ||
                        text.includes('OCTAVO') ||
                        text.includes('NOVENO') ||
                        text.includes('DECIMO');

                    if (isCourtHeader && text.length > 5) {
                        try {
                            const raw = firstCell.toString().trim();
                            // Strategy 1: Double spaces often separate words in spaced text
                            if (raw.includes('  ')) {
                                const words = raw.split(/\s{2,}/);
                                const cleanedWords = words.map((w: string) => w.replace(/\s+/g, ''));
                                currentContext = cleanedWords.join(' ');
                            }
                            // Strategy 2: Single space separation (e.g. "P R I M E R O D E F A M I L I A")
                            // We attempt to identify this by checking if many single letters are space-separated.
                            else if (/\s[A-Z]\s/.test(raw) || /^[A-Z](\s[A-Z])+$/.test(raw)) {
                                // Remove ALL spaces to get "PRIMERODEFAMILIA"
                                let compressed = raw.replace(/\s+/g, '');

                                // Attempt to insert spaces before known keywords to separate them
                                // This list must be ordered carefully (longest first usually helps)
                                const KEYWORDS = [
                                    'JUZGADO', 'PROMISCUO', 'MUNICIPAL', 'CIRCUITO', 'CIVIL', 'FAMILIA',
                                    'LABORAL', 'ADMINISTRATIVO', 'TRIBUNAL', 'SUPERIOR', 'SALA', 'PENAL',
                                    'PEQUEÑAS', 'CAUSAS', 'COMPETENCIA', 'MULTIPLE', 'ORAL', 'EJECUCION',
                                    'SENTENCIAS', 'RESTITUCION', 'TIERRAS', 'TRANSITO', 'ADOLESCENTES',
                                    'PRIMERO', 'SEGUNDO', 'TERCERO', 'CUARTO', 'QUINTO', 'SEXTO',
                                    'SEPTIMO', 'OCTAVO', 'NOVENO', 'DECIMO', 'UNDECIMO', 'DUODECIMO',
                                    'DE', 'DEL', 'EL', 'LA', 'LOS', 'LAS', 'Y', 'EN'
                                ];

                                // Sort by length desc
                                const sortedKeywords = KEYWORDS.sort((a, b) => b.length - a.length);

                                // Replace known keywords with space-padded versions
                                // We iterate through sorted keywords and replace instances in the compressed string
                                // NOTE: This is tricky because "DE" matches inside "DEMANDA".
                                // However, court headers are usually constructed from these words exclusively.

                                // Alternative approach: tokenizing is hard. 
                                // Let's try to match keywords from the raw string if we can, OR simply rely on the compressed string 
                                // and accept some merged words if we can't do better.
                                // BUT, the user specifically complained about "separados".
                                // "SEXTODEFAMILIA" is better than "S E X T O...".

                                // Let's try to reconstruct spacing by matching keywords in the compressed string.
                                let reconstructed = compressed;
                                sortedKeywords.forEach(word => {
                                    // Only replace if the word exists and we haven't already messed it up?
                                    // A global replace might be safe enough for these specific strings.
                                    // Use a temporary placeholder or just spaces?
                                    // Let's protect "DEMANDA" type collisions?
                                    // Actually, "DEMANDA" is not a keyword here. "DE" is.
                                    // "DE" is dangerous.
                                    if (word.length > 3) {
                                        const regex = new RegExp(word, 'g');
                                        reconstructed = reconstructed.replace(regex, ` ${word} `);
                                    }
                                });
                                // Handle short words carefully?
                                // "DE", "DEL", "Y", "LA"
                                // Maybe only replace if they are surrounded by known long keywords?
                                // For now, let's just stick with the "remove all spaces" strategy if it's spaced out text,
                                // and try to add spaces for big words.

                                currentContext = reconstructed.replace(/\s+/g, ' ').trim();

                            } else {
                                // Default fallback: use the raw text if it doesn't look like spaced-out letters
                                currentContext = raw;
                            }

                            // --- NEW LOGIC START ---
                            if (currentContext) {
                                // 1. Normalize to UPPERCASE
                                let context = currentContext.toUpperCase();

                                // 2. Expand abbreviations
                                context = context.replace(/^JDO\.?\s*/, 'JUZGADO ');
                                context = context.replace(/^J\.\s*/, 'JUZGADO ');

                                // 3. Prepend "JUZGADO" if it starts with a number (and doesn't already have JUZGADO)
                                if (/^\d/.test(context) && !context.startsWith('JUZGADO')) {
                                    context = 'JUZGADO ' + context;
                                }

                                currentContext = context;
                            }
                            // --- NEW LOGIC END ---

                        } catch (e) {
                            currentContext = firstCell.trim();
                        }
                    }

                    // Heuristic: Identify "Estado" / "Date" headers
                    // e.g. "ESTADO 18 DEL 10 FEBRERO 2026" or "ESTADOS EDICTOS Y TRASLADOS NO HAN SIDO FIJADOS"
                    if (firstCell && typeof firstCell === 'string' && (!secondCell || secondCell.toString().trim() === '')) {
                        const text = firstCell.toString().toUpperCase().trim();
                        if (text.startsWith('ESTADO') || text.includes('FIJADO') || text.includes('FEBRERO') || text.includes('ENERO') || text.includes('MARZO') || text.includes('ABRIL') || text.includes('MAYO') || text.includes('JUNIO') || text.includes('JULIO') || text.includes('AGOSTO') || text.includes('SEPTIEMBRE') || text.includes('OCTUBRE') || text.includes('NOVIEMBRE') || text.includes('DICIEMBRE')) {
                            // This is likely a date/state header, NOT a court header
                            // Prioritize it as state context, but ensure it doesn't overwrite court context if logic overlaps
                            // Actually, these are usually distinct lines.
                            if (!isCourtHeader) {
                                currentStateContext = text;
                            }
                        }
                    }
                }

                // Search in all columns of the row
                const rowString = row.map(cell => String(cell || '').toLowerCase()).join(' ');
                if (rowString.includes(term)) {
                    newResults.push({
                        sheetName,
                        rowIndex: rowIndex + 1, // 1-based index for display
                        data: row,
                        id: `${sheetName}-${rowIndex}`,
                        context: currentContext,
                        stateContext: currentStateContext
                    });
                }
            });
        });

        setResults(newResults);
        setIsLoading(false);
    }, [workbook, searchTerm]);

    // Trigger search on Enter key
    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            handleSearch();
        }
    };

    const toggleSelection = (result: SearchResult) => {
        const newSelected = new Map(selectedItems);
        if (newSelected.has(result.id)) {
            newSelected.delete(result.id);
        } else {
            newSelected.set(result.id, result);
        }
        setSelectedItems(newSelected);
    };

    const toggleSelectAll = () => {
        const newSelected = new Map(selectedItems);

        // Check if all currently visible results are selected
        const allVisibleSelected = results.length > 0 && results.every(r => newSelected.has(r.id));

        if (allVisibleSelected) {
            // Deselect visible results
            results.forEach(r => newSelected.delete(r.id));
        } else {
            // Select all visible results
            results.forEach(r => newSelected.set(r.id, r));
        }
        setSelectedItems(newSelected);
    };

    const clearSelection = () => {
        setSelectedItems(new Map());
    };

    const generatePDF = () => {
        try {
            console.log("Iniciando generación de PDF...");
            const doc = new jsPDF({ orientation: 'landscape' });
            console.log("Documento PDF creado");

            const selectedResults = Array.from(selectedItems.values());
            console.log(`Elementos seleccionados: ${selectedResults.length}`);

            if (selectedResults.length === 0) {
                console.warn("No hay elementos seleccionados");
                return;
            }

            doc.setFontSize(18);
            doc.text('Reporte de Procesos Seleccionados', 14, 22);

            doc.setFontSize(11);
            doc.text(`Fecha: ${new Date().toLocaleDateString()}`, 14, 30);
            doc.text(`Total seleccionados: ${selectedResults.length}`, 14, 36);

            const tableData = selectedResults.map(r => [
                r.context || 'Sin asignar', // Juzgado / Origen
                r.stateContext || '-', // Estado / Fecha (New Column)
                r.data[0] || '-', // Radicado
                r.data[1] || '-', // Demandante
                r.data[2] || '-', // Demandado
                r.data[3] || '-', // Estado / Actuación
                r.sheetName
            ]);

            console.log("Datos de tabla preparados", tableData);

            autoTable(doc, {
                startY: 44,
                head: [['Juzgado', 'Estado / Fecha', 'Radicado', 'Demandante', 'Demandado', 'Actuación', 'Hoja']],
                body: tableData,
                theme: 'grid',
                headStyles: { fillColor: [37, 99, 235] }, // Blue-600
                styles: { fontSize: 8, cellPadding: 2 }, // Increased font size slightly for landscape
                // Removed fixed columnStyles to allow auto-sizing in landscape
            });

            console.log("Tabla generada, guardando archivo...");

            // Use file-saver for robust saving
            const pdfBlob = doc.output('blob');
            saveAs(pdfBlob, 'reporte_procesos.pdf');

            console.log("Archivo guardado (método file-saver)");
        } catch (err) {
            console.error("Error al generar PDF:", err);
            setError("Error al generar el PDF. Revisa la consola.");
        }
    };

    return (
        <main className="min-h-screen bg-gray-50 p-8 font-sans text-gray-900">
            <div className="max-w-6xl mx-auto space-y-8">

                {/* Header */}
                <div className="text-center space-y-2">
                    <h1 className="text-4xl font-extrabold tracking-tight text-gray-900 sm:text-5xl">
                        Buscador de Procesos
                    </h1>
                    <p className="text-lg text-gray-600">
                        Sube tu boletín jurídico y busca rápidamente por nombre de empresa o persona.
                    </p>
                </div>

                {/* Upload Section */}
                <div className={cn(
                    "bg-white p-8 rounded-xl shadow-sm border transition-all duration-300",
                    workbook ? "border-green-200 shadow-md ring-1 ring-green-100" : "border-gray-100 hover:shadow-md"
                )}>
                    <div className={cn(
                        "flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-10 transition-colors cursor-pointer relative",
                        workbook ? "border-green-300 bg-green-50/50" : "border-gray-300 hover:bg-gray-50"
                    )}>
                        <input
                            type="file"
                            accept=".xlsx, .xls"
                            onChange={handleFileUpload}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        />
                        <div className="flex flex-col items-center space-y-4">
                            <div className={cn(
                                "p-4 rounded-full transition-colors",
                                workbook ? "bg-green-100 text-green-600" : "bg-blue-50 text-blue-600"
                            )}>
                                {workbook ? <CheckSquare className="w-8 h-8" /> : <FileSpreadsheet className="w-8 h-8" />}
                            </div>
                            <div className="text-center space-y-1">
                                <p className={cn("text-lg font-medium", workbook ? "text-green-800" : "text-gray-700")}>
                                    {file ? file.name : "Arrastra tu archivo Excel aquí o haz clic para subir"}
                                </p>
                                {workbook ? (
                                    <p className="text-green-600 font-semibold animate-in fade-in slide-in-from-bottom-1">
                                        ¡Archivo cargado exitosamente! Ya puedes realizar tu búsqueda.
                                    </p>
                                ) : (
                                    <p className="text-sm text-gray-500">Soporta archivos .xlsx y .xls</p>
                                )}
                            </div>
                        </div>
                    </div>
                    {error && (
                        <div className="mt-4 flex items-center text-red-600 bg-red-50 p-3 rounded-lg animate-in fade-in">
                            <AlertCircle className="w-5 h-5 mr-2" />
                            {error}
                        </div>
                    )}
                </div>

                {/* Search Section */}
                <div className={cn("transition-all duration-500", workbook ? "opacity-100 translate-y-0" : "opacity-50 translate-y-4 pointer-events-none")}>
                    <div className="flex gap-4">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                            <input
                                type="text"
                                placeholder="Buscar por nombre de empresa o persona (ej: Sobusa, Nancy...)"
                                className="w-full pl-10 pr-4 py-3 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg shadow-sm"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                onKeyDown={handleKeyDown}
                                disabled={!workbook}
                            />
                        </div>
                        <button
                            onClick={handleSearch}
                            disabled={!workbook || !searchTerm.trim() || isLoading}
                            className="px-8 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 shadow-sm"
                        >
                            {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Buscar"}
                        </button>
                    </div>
                </div>

                {/* Global Actions Bar - Always visible if items are selected */}
                {selectedItems.size > 0 && (
                    <div className="sticky top-4 z-20 bg-blue-600 text-white p-4 rounded-xl shadow-lg flex items-center justify-between animate-in slide-in-from-top-4 duration-300">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-white/20 rounded-lg">
                                <CheckSquare className="w-5 h-5 text-white" />
                            </div>
                            <div>
                                <span className="font-bold text-lg">{selectedItems.size}</span>
                                <span className="text-blue-100 ml-1">procesos seleccionados en total</span>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <button
                                onClick={clearSelection}
                                className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
                            >
                                <Trash2 className="w-4 h-4" />
                                Limpiar
                            </button>
                            <button
                                onClick={generatePDF}
                                className="px-4 py-2 bg-white text-blue-600 text-sm font-bold rounded-lg hover:bg-blue-50 transition-colors flex items-center gap-2 shadow-sm"
                            >
                                <FileDown className="w-4 h-4" />
                                Generar PDF
                            </button>
                        </div>
                    </div>
                )}

                {/* Results Section */}
                {hasSearched && (
                    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">

                        {/* Results Header with Actions */}
                        <div className="flex items-center justify-between bg-white p-4 rounded-xl border border-gray-200 shadow-sm z-10">
                            <div className="flex items-center gap-4">
                                <button
                                    onClick={toggleSelectAll}
                                    className="flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
                                    disabled={results.length === 0}
                                >
                                    {results.length > 0 && results.every(r => selectedItems.has(r.id)) ? (
                                        <CheckSquare className="w-5 h-5 text-blue-600" />
                                    ) : (
                                        <Square className="w-5 h-5" />
                                    )}
                                    Seleccionar todo visible
                                </button>
                                <div className="h-6 w-px bg-gray-200" />
                                <h2 className="text-lg font-bold text-gray-800">
                                    {results.length} resultado{results.length !== 1 && 's'}
                                </h2>
                            </div>
                        </div>

                        {results.length === 0 ? (
                            <div className="text-center py-12 bg-white rounded-xl border border-gray-200 shadow-sm">
                                <p className="text-gray-500 text-lg">No se encontraron resultados para "{searchTerm}"</p>
                            </div>
                        ) : (
                            <div className="grid gap-4">
                                {results.map((result, idx) => (
                                    <div
                                        key={result.id}
                                        className={cn(
                                            "group bg-white p-6 rounded-xl border transition-all cursor-pointer relative",
                                            selectedItems.has(result.id)
                                                ? "border-blue-500 shadow-md bg-blue-50/10"
                                                : "border-gray-200 shadow-sm hover:shadow-md hover:border-blue-200"
                                        )}
                                        onClick={() => toggleSelection(result)}
                                    >
                                        <div className="absolute top-6 left-4">
                                            <div className={cn(
                                                "w-5 h-5 rounded border flex items-center justify-center transition-colors",
                                                selectedItems.has(result.id) ? "bg-blue-600 border-blue-600" : "border-gray-300 group-hover:border-blue-400"
                                            )}>
                                                {selectedItems.has(result.id) && <CheckSquare className="w-3.5 h-3.5 text-white" />}
                                            </div>
                                        </div>

                                        <div className="pl-8">
                                            <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs font-semibold rounded uppercase tracking-wide">
                                                        Hoja: {result.sheetName}
                                                    </span>
                                                    {result.context && (
                                                        <span className="px-2 py-1 bg-purple-100 text-purple-700 text-xs font-semibold rounded uppercase tracking-wide max-w-[200px] truncate" title={result.context}>
                                                            {result.context}
                                                        </span>
                                                    )}
                                                    <span className="text-sm text-gray-500 ml-auto">Fila {result.rowIndex}</span>
                                                </div>
                                            </div>

                                            {/* Prominent State/Date Display */}
                                            {result.stateContext && (
                                                <div className="mb-4 bg-yellow-50 border border-yellow-200 text-yellow-800 p-2 rounded-lg text-sm font-bold text-center uppercase tracking-wide">
                                                    {result.stateContext}
                                                </div>
                                            )}

                                            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
                                                <div className="space-y-1">
                                                    <span className="block text-xs font-medium text-gray-500 uppercase">Radicado / ID</span>
                                                    <p className="font-mono text-gray-900 break-all">{result.data[0] || '-'}</p>
                                                </div>
                                                <div className="space-y-1">
                                                    <span className="block text-xs font-medium text-gray-500 uppercase">Demandante / Parte 1</span>
                                                    <p className="font-semibold text-gray-900">{result.data[1] || '-'}</p>
                                                </div>
                                                <div className="space-y-1">
                                                    <span className="block text-xs font-medium text-gray-500 uppercase">Demandado / Juzgado</span>
                                                    <div
                                                        className="font-semibold text-gray-900"
                                                        dangerouslySetInnerHTML={{
                                                            __html: (result.data[2] || '-').toString().replace(
                                                                new RegExp(`(${searchTerm})`, 'gi'),
                                                                '<mark class="bg-yellow-200 text-gray-900 px-0.5 rounded">$1</mark>'
                                                            )
                                                        }}
                                                    />
                                                </div>
                                                <div className="space-y-1">
                                                    <span className="block text-xs font-medium text-gray-500 uppercase">Estado / Actuación</span>
                                                    <p className="text-gray-600 line-clamp-3 hover:line-clamp-none transition-all">{result.data[3] || '-'}</p>
                                                </div>
                                            </div>

                                            {result.data.length > 4 && (
                                                <div className="mt-4 pt-3 border-t border-gray-50 text-xs text-gray-500">
                                                    <span className="font-medium mr-2">Otros datos:</span>
                                                    {result.data.slice(4).filter(Boolean).join(' | ')}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

            </div>
        </main>
    );
}
