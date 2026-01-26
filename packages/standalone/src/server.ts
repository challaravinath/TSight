/**
 * TSight Standalone Server
 * Bundles API + Web UI into a single executable
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { Analyzer } from '@tsight/core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// State
const analyzer = new Analyzer();
let currentAnalysis: any = null;
let currentProject: any = null;

// Serve static files from web build
const staticPath = process.pkg 
  ? path.join(path.dirname(process.execPath), 'web')
  : path.join(__dirname, '../web/dist');

app.use(express.static(staticPath));

// ============ API ROUTES ============

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', project: currentProject, hasAnalysis: !!currentAnalysis });
});

app.post('/api/analyze', async (req, res) => {
  const { path: projectPath } = req.body;
  if (!projectPath) {
    return res.status(400).json({ success: false, error: 'Path is required' });
  }
  
  try {
    console.log(`Analyzing: ${projectPath}`);
    currentAnalysis = await analyzer.analyze(projectPath);
    currentProject = {
      path: projectPath,
      name: path.basename(projectPath),
      status: 'analyzed'
    };
    
    res.json({
      success: true,
      project: currentProject,
      stats: {
        totalFiles: currentAnalysis.files.length,
        totalLines: currentAnalysis.files.reduce((sum: number, f: any) => sum + f.lines, 0)
      }
    });
  } catch (error) {
    console.error('Analysis failed:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.get('/api/overview', (req, res) => {
  if (!currentAnalysis) {
    return res.status(404).json({ success: false, error: 'No analysis available' });
  }
  
  const totalLines = currentAnalysis.files.reduce((sum: number, f: any) => sum + f.lines, 0);
  const languageCounts: Record<string, number> = {};
  
  for (const file of currentAnalysis.files) {
    const ext = file.extension || '.ts';
    languageCounts[ext] = (languageCounts[ext] || 0) + file.lines;
  }
  
  const languages = Object.entries(languageCounts)
    .map(([ext, lines]) => ({
      language: ext === '.ts' ? 'TypeScript' : ext === '.tsx' ? 'TSX' : ext === '.js' ? 'JavaScript' : ext === '.jsx' ? 'JSX' : ext,
      percentage: Math.round((lines / totalLines) * 100),
      color: ext === '.ts' ? '#3178c6' : ext === '.tsx' ? '#61dafb' : ext === '.js' ? '#f7df1e' : '#888'
    }))
    .sort((a, b) => b.percentage - a.percentage);

  res.json({
    success: true,
    project: currentProject,
    stats: {
      totalFiles: currentAnalysis.files.length,
      totalLines,
      totalClasses: currentAnalysis.classes.length,
      totalFunctions: currentAnalysis.functions.length,
      totalInterfaces: currentAnalysis.interfaces.length,
      avgComplexity: currentAnalysis.complexity.length > 0 
        ? Math.round(currentAnalysis.complexity.reduce((sum: number, c: any) => sum + c.score, 0) / currentAnalysis.complexity.length)
        : 0,
      issueCount: currentAnalysis.issues.length,
      duplicateCount: currentAnalysis.duplicates.length
    },
    languages,
    mentalModel: currentAnalysis.mentalModel,
    issues: currentAnalysis.issues,
    duplicates: currentAnalysis.duplicates
  });
});

app.get('/api/insights', (req, res) => {
  if (!currentAnalysis) {
    return res.status(404).json({ success: false, error: 'No analysis available' });
  }
  
  const imports = currentAnalysis.imports;
  const dependentCount = new Map<string, number>();
  const importCount = new Map<string, number>();
  
  for (const imp of imports) {
    if (!imp.isExternal) {
      dependentCount.set(imp.to, (dependentCount.get(imp.to) || 0) + 1);
      importCount.set(imp.from, (importCount.get(imp.from) || 0) + 1);
    }
  }
  
  const coreFiles = Array.from(dependentCount.entries())
    .filter(([, count]) => count >= 5)
    .sort((a, b) => b[1] - a[1])
    .map(([file, count]) => ({ file, name: file.split('/').pop() || file, dependentCount: count }));
  
  const complexFiles = Array.from(importCount.entries())
    .filter(([, count]) => count >= 10)
    .sort((a, b) => b[1] - a[1])
    .map(([file, count]) => ({ file, name: file.split('/').pop() || file, importCount: count }));
  
  const filesWithImports = new Set([...dependentCount.keys(), ...importCount.keys()]);
  const isolatedFiles = currentAnalysis.files
    .filter((f: any) => !filesWithImports.has(f.path))
    .filter((f: any) => !f.path.includes('index.') && !f.path.includes('.d.ts'))
    .map((f: any) => ({ file: f.path, name: f.name }));
  
  const circularDeps = currentAnalysis.dependencyGraph?.circular?.map((cycle: string[]) => ({ cycle })) || [];
  
  // Hotspots
  const fileComplexity = new Map<string, { total: number; functions: Array<{ name: string; complexity: number; line: number }> }>();
  
  for (const func of currentAnalysis.functions) {
    const existing = fileComplexity.get(func.file) || { total: 0, functions: [] };
    existing.total += func.complexity;
    if (func.complexity >= 5) {
      existing.functions.push({ name: func.name, complexity: func.complexity, line: func.line });
    }
    fileComplexity.set(func.file, existing);
  }
  
  const hotspots: any[] = [];
  for (const [file, complexity] of fileComplexity) {
    const dependents = dependentCount.get(file) || 0;
    if (complexity.total >= 10 && dependents >= 3) {
      const riskScore = complexity.total * dependents;
      hotspots.push({
        file,
        name: file.split('/').pop() || file,
        complexity: complexity.total,
        dependents,
        riskScore,
        riskLevel: riskScore >= 500 ? 'critical' : riskScore >= 200 ? 'high' : 'medium',
        functions: complexity.functions.sort((a, b) => b.complexity - a.complexity).slice(0, 5)
      });
    }
  }
  
  res.json({
    success: true,
    insights: {
      coreFiles,
      complexFiles,
      isolatedFiles,
      circularDeps,
      hotspots: hotspots.sort((a, b) => b.riskScore - a.riskScore).slice(0, 20)
    }
  });
});

app.get('/api/blast-radius/:filePath(*)', (req, res) => {
  if (!currentAnalysis) {
    return res.status(404).json({ success: false, error: 'No analysis available' });
  }
  
  const filePath = req.params.filePath;
  const importedBy = new Map<string, Set<string>>();
  
  for (const imp of currentAnalysis.imports) {
    if (!imp.isExternal) {
      if (!importedBy.has(imp.to)) importedBy.set(imp.to, new Set());
      importedBy.get(imp.to)!.add(imp.from);
    }
  }
  
  const visited = new Set<string>();
  const levels: Array<{ level: number; files: Array<{ file: string; name: string }> }> = [];
  let currentLevel = [filePath];
  let levelNum = 0;
  visited.add(filePath);
  
  while (currentLevel.length > 0 && levelNum < 5) {
    const nextLevel: string[] = [];
    const levelFiles: Array<{ file: string; name: string }> = [];
    
    for (const file of currentLevel) {
      const dependents = importedBy.get(file) || new Set();
      for (const dep of dependents) {
        if (!visited.has(dep)) {
          visited.add(dep);
          nextLevel.push(dep);
          levelFiles.push({ file: dep, name: dep.split('/').pop() || dep });
        }
      }
    }
    
    if (levelFiles.length > 0) {
      levelNum++;
      levels.push({ level: levelNum, files: levelFiles });
    }
    currentLevel = nextLevel;
  }
  
  const directImpact = levels[0]?.files.length || 0;
  const indirectImpact = levels.slice(1).reduce((sum, l) => sum + l.files.length, 0);
  const totalImpact = directImpact + indirectImpact;
  const totalFiles = currentAnalysis.files.length;
  const percentageImpact = ((totalImpact / totalFiles) * 100).toFixed(1);
  
  let riskLevel: string = 'low';
  if (totalImpact >= 50 || parseFloat(percentageImpact) >= 10) riskLevel = 'critical';
  else if (totalImpact >= 20 || parseFloat(percentageImpact) >= 5) riskLevel = 'high';
  else if (totalImpact >= 5) riskLevel = 'medium';
  
  res.json({
    success: true,
    blastRadius: {
      file: filePath,
      name: filePath.split('/').pop() || filePath,
      directImpact,
      indirectImpact,
      totalImpact,
      totalFiles,
      percentageImpact: parseFloat(percentageImpact),
      riskLevel,
      levels,
      summary: totalImpact === 0 
        ? 'No other files depend on this file. Safe to modify.'
        : `Changing this file could affect ${totalImpact} files (${percentageImpact}% of codebase).`
    }
  });
});

app.get('/api/search', (req, res) => {
  if (!currentAnalysis) {
    return res.status(404).json({ success: false, error: 'No analysis available' });
  }
  
  const query = (req.query.q as string || '').toLowerCase();
  if (!query) return res.json({ success: true, results: [] });
  
  const results: any[] = [];
  
  for (const cls of currentAnalysis.classes) {
    if (cls.name.toLowerCase().includes(query)) {
      results.push({ type: 'class', resultType: 'class', name: cls.name, file: cls.file, line: cls.line });
    }
  }
  
  for (const func of currentAnalysis.functions) {
    if (func.name.toLowerCase().includes(query)) {
      results.push({ type: 'function', resultType: 'function', name: func.name, file: func.file, line: func.line });
    }
  }
  
  for (const iface of currentAnalysis.interfaces) {
    if (iface.name.toLowerCase().includes(query)) {
      results.push({ type: 'interface', resultType: 'interface', name: iface.name, file: iface.file, line: iface.line });
    }
  }
  
  for (const file of currentAnalysis.files) {
    if (file.name.toLowerCase().includes(query)) {
      results.push({ type: 'file', resultType: 'file', name: file.name, path: file.path });
    }
  }
  
  res.json({ success: true, results: results.slice(0, 50) });
});

app.get('/api/file/:filePath(*)', (req, res) => {
  if (!currentAnalysis) {
    return res.status(404).json({ success: false, error: 'No analysis available' });
  }
  
  const filePath = req.params.filePath;
  const file = currentAnalysis.files.find((f: any) => f.path === filePath);
  
  if (!file) {
    return res.status(404).json({ success: false, error: 'File not found' });
  }
  
  const classes = currentAnalysis.classes.filter((c: any) => c.file === filePath);
  const functions = currentAnalysis.functions.filter((f: any) => f.file === filePath);
  const interfaces = currentAnalysis.interfaces.filter((i: any) => i.file === filePath);
  
  const fileImports = currentAnalysis.imports
    .filter((imp: any) => imp.from === filePath)
    .map((imp: any) => ({ module: imp.to, items: imp.imports, isExternal: imp.isExternal }));
  
  const importedBy = currentAnalysis.imports
    .filter((imp: any) => imp.to === filePath && !imp.isExternal)
    .map((imp: any) => ({ file: imp.from, items: imp.imports }));
  
  // Generate crux
  const name = file.name.toLowerCase();
  let pattern = 'Module';
  if (name.includes('service')) pattern = 'Service';
  else if (name.startsWith('use')) pattern = 'React Hook';
  else if (name.includes('context')) pattern = 'Context Provider';
  else if (name.includes('control') && classes.some((c: any) => c.methods?.some?.((m: any) => ['init', 'updateView'].includes(m.name)))) pattern = 'PCF Control';
  else if (name.includes('.tsx') || name.includes('component')) pattern = 'Component';
  else if (name.includes('util') || name.includes('helper')) pattern = 'Utility';
  else if (name.includes('type') || name.includes('interface')) pattern = 'Type definitions';
  else if (name.includes('test') || name.includes('spec')) pattern = 'Test file';
  else if (classes.length > 0) pattern = 'Class module';
  
  const exports = [...classes, ...functions, ...interfaces].filter((x: any) => x.exported);
  const exportStr = exports.length > 0 
    ? `Exports ${exports[0].name}${exports.length > 1 ? ` +${exports.length - 1} more` : ''}.`
    : 'No exports.';
  
  const depStr = importedBy.length === 0 
    ? 'No direct imports found.'
    : importedBy.length >= 10 
      ? `Core file — ${importedBy.length} dependents.`
      : `${importedBy.length} dependents.`;
  
  const internalImports = fileImports.filter((i: any) => !i.isExternal);
  const usesStr = internalImports.length > 0
    ? `Uses ${internalImports.slice(0, 3).map((i: any) => i.module.split('/').pop()?.replace(/\.(ts|tsx)$/, '')).join(', ')}${internalImports.length > 3 ? ` +${internalImports.length - 3} more` : ''}.`
    : '';
  
  const crux = `${pattern}. ${exportStr} ${depStr}${usesStr ? ' ' + usesStr : ''}`;
  
  const allExports = [
    ...classes.filter((c: any) => c.exported).map((c: any) => ({ name: c.name, type: 'class', line: c.line })),
    ...functions.filter((f: any) => f.exported).map((f: any) => ({ name: f.name, type: 'function', line: f.line })),
    ...interfaces.filter((i: any) => i.exported).map((i: any) => ({ name: i.name, type: 'interface', line: i.line }))
  ];
  
  res.json({
    success: true,
    file: {
      path: file.path,
      name: file.name,
      lines: file.lines,
      crux,
      allExports,
      classes: classes.map((c: any) => ({ name: c.name, line: c.line, methods: c.methods?.length || 0, properties: c.properties?.length || 0, extends: c.extends, exported: c.exported })),
      functions: functions.map((f: any) => ({ name: f.name, line: f.line, params: f.parameters?.length || 0, complexity: f.complexity, async: f.async, exported: f.exported })),
      interfaces: interfaces.map((i: any) => ({ name: i.name, line: i.line, properties: i.properties?.length || 0, exported: i.exported })),
      imports: fileImports,
      importedBy,
      metrics: {
        totalClasses: classes.length,
        totalFunctions: functions.length,
        totalInterfaces: interfaces.length,
        totalExports: allExports.length,
        complexity: functions.reduce((sum: number, f: any) => sum + f.complexity, 0),
        avgComplexity: functions.length > 0 ? Math.round(functions.reduce((sum: number, f: any) => sum + f.complexity, 0) / functions.length) : 0,
        importCount: fileImports.length,
        dependentCount: importedBy.length
      },
      issues: currentAnalysis.issues.filter((i: any) => i.file === filePath),
      duplicates: currentAnalysis.duplicates.filter((d: any) => d.items.some((item: any) => item.file === filePath))
    }
  });
});

// Fallback to index.html for SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(staticPath, 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║                                                           ║');
  console.log('║   ████████╗███████╗██╗ ██████╗ ██╗  ██╗████████╗         ║');
  console.log('║   ╚══██╔══╝██╔════╝██║██╔════╝ ██║  ██║╚══██╔══╝         ║');
  console.log('║      ██║   ███████╗██║██║  ███╗███████║   ██║            ║');
  console.log('║      ██║   ╚════██║██║██║   ██║██╔══██║   ██║            ║');
  console.log('║      ██║   ███████║██║╚██████╔╝██║  ██║   ██║            ║');
  console.log('║      ╚═╝   ╚══════╝╚═╝ ╚═════╝ ╚═╝  ╚═╝   ╚═╝            ║');
  console.log('║                                                           ║');
  console.log('║   TypeScript Code Analyzer                                ║');
  console.log('║                                                           ║');
  console.log('╠═══════════════════════════════════════════════════════════╣');
  console.log('║                                                           ║');
  console.log(`║   🚀 Server running at: http://localhost:${PORT}             ║`);
  console.log('║                                                           ║');
  console.log('║   Open the URL above in your browser to get started.      ║');
  console.log('║                                                           ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');
});
