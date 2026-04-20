import {
  FolderInfo,
  ImportInfo,
  ClassInfo,
  FunctionInfo,
  MentalModel,
  Layer,
  DataFlow,
} from '../types.js';

export function buildMentalModel(
  folders: FolderInfo[],
  imports: ImportInfo[],
  classes: ClassInfo[],
  functions: FunctionInfo[],
): MentalModel {
  const layers = categorizeLayers(folders, classes, functions);
  const flows = calculateDataFlows(layers, imports);
  const entryPoints = findEntryPoints(classes, functions, imports);
  const coreComponents = findCoreComponents(imports, classes, functions);

  return { layers, flows, entryPoints, coreComponents };
}

const LAYER_DEFS = [
  {
    name: 'UI',
    patterns: ['control', 'component', 'page', 'view', 'screen', 'ui', 'app'],
    color: '#61dafb',
  },
  {
    name: 'Services',
    patterns: ['service', 'provider', 'hook', 'context', 'store', 'api'],
    color: '#68d391',
  },
  {
    name: 'Models',
    patterns: ['model', 'type', 'interface', 'entity', 'schema', 'dto'],
    color: '#f6ad55',
  },
  {
    name: 'Utilities',
    patterns: ['util', 'helper', 'common', 'shared', 'lib', 'constant'],
    color: '#a78bfa',
  },
];

function categorizeLayers(
  folders: FolderInfo[],
  classes: ClassInfo[],
  _functions: FunctionInfo[],
): Layer[] {
  const layers: Layer[] = [];
  const categorized = new Set<string>();

  for (const def of LAYER_DEFS) {
    const matchingFolders: string[] = [];
    const matchingFiles: string[] = [];

    for (const folder of folders) {
      const lower = folder.path.toLowerCase();
      if (def.patterns.some((p) => lower.includes(p)) && !categorized.has(folder.path)) {
        matchingFolders.push(folder.path);
        categorized.add(folder.path);
      }
    }

    // Also check individual files
    for (const cls of classes) {
      const folderLower = cls.file.toLowerCase();
      if (
        def.patterns.some(
          (p) => folderLower.includes(p) || cls.name.toLowerCase().includes(p),
        )
      ) {
        if (!matchingFiles.includes(cls.file)) {
          matchingFiles.push(cls.file);
        }
      }
    }

    if (matchingFolders.length > 0 || matchingFiles.length > 0) {
      layers.push({
        name: def.name,
        description: `${def.name} layer`,
        folders: matchingFolders,
        files: matchingFiles,
        color: def.color,
      });
    }
  }

  // Add "Other" layer for uncategorized
  const otherFolders = folders
    .filter((f) => !categorized.has(f.path) && f.fileCount > 0)
    .map((f) => f.path)
    .slice(0, 5);

  if (otherFolders.length > 0) {
    layers.push({
      name: 'Other',
      description: 'Other code',
      folders: otherFolders,
      files: [],
      color: '#a0aec0',
    });
  }

  return layers;
}

function calculateDataFlows(layers: Layer[], imports: ImportInfo[]): DataFlow[] {
  const flows: DataFlow[] = [];
  const flowMap = new Map<string, number>();

  const getLayer = (file: string): Layer | undefined => {
    for (const layer of layers) {
      if (layer.files.includes(file)) return layer;
      for (const folder of layer.folders) {
        if (file.startsWith(folder + '/') || file.startsWith(folder)) return layer;
      }
    }
    return undefined;
  };

  for (const imp of imports) {
    if (imp.isExternal) continue;

    const fromLayer = getLayer(imp.from);
    const toLayer = getLayer(imp.to);

    if (fromLayer && toLayer && fromLayer.name !== toLayer.name) {
      const key = `${fromLayer.name}->${toLayer.name}`;
      flowMap.set(key, (flowMap.get(key) || 0) + 1);
    }
  }

  for (const [key, count] of flowMap) {
    const [from, to] = key.split('->');
    flows.push({ from, to, label: 'imports', count });
  }

  return flows.sort((a, b) => b.count - a.count);
}

function findEntryPoints(
  classes: ClassInfo[],
  functions: FunctionInfo[],
  imports: ImportInfo[],
): string[] {
  // Entry points = exported but not imported by anything internal
  const imported = new Set<string>();
  for (const imp of imports) {
    if (!imp.isExternal) {
      imported.add(imp.to);
    }
  }

  const entryPoints: string[] = [];

  for (const cls of classes) {
    if (cls.exported && !imported.has(cls.file)) {
      if (
        cls.name.includes('Control') ||
        cls.name.includes('Component') ||
        cls.decorators.some((d) => d.includes('Component'))
      ) {
        entryPoints.push(cls.name);
      }
    }
  }

  for (const func of functions) {
    if (func.exported && !imported.has(func.file)) {
      // PascalCase = likely React component
      if (func.name[0] === func.name[0].toUpperCase()) {
        entryPoints.push(func.name);
      }
    }
  }

  return entryPoints.slice(0, 10);
}

function findCoreComponents(
  imports: ImportInfo[],
  classes: ClassInfo[],
  functions: FunctionInfo[],
): string[] {
  const importCount = new Map<string, number>();

  for (const imp of imports) {
    if (!imp.isExternal) {
      importCount.set(imp.to, (importCount.get(imp.to) || 0) + 1);
    }
  }

  const sorted = Array.from(importCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const coreComponents: string[] = [];

  for (const [file] of sorted) {
    const cls = classes.find((c) => c.file === file);
    if (cls) {
      coreComponents.push(cls.name);
      continue;
    }

    const func = functions.find((f) => f.file === file);
    if (func) {
      coreComponents.push(func.name);
    }
  }

  return coreComponents;
}
